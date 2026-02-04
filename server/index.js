import express from 'express';
import { Telegraf, Markup } from 'telegraf';
import cron from 'node-cron';
import cors from 'cors';
import dotenv from 'dotenv';
import { PrismaClient, Prisma } from '@prisma/client';
import crypto from 'crypto';
import multer from 'multer';
import fs from 'fs';
import { Readable } from 'stream';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { getPhotoUrl, deletePhoto, testS3Connection } from './s3Service.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

dotenv.config();

const app = express();
const prisma = new PrismaClient({
  log: process.env.NODE_ENV === 'development' ? ['query', 'error', 'warn'] : ['error'],
});

// Configure multer for file uploads
const upload = multer({ dest: '/tmp/' });

// Helper function for structured logging
function log(level, category, message, data = {}) {
  const timestamp = new Date().toISOString();
  const logEntry = {
    timestamp,
    level,
    category,
    message,
    ...data
  };
  
  const logString = `[${timestamp}] [${level}] [${category}] ${message}${Object.keys(data).length > 0 ? ' | ' + JSON.stringify(data) : ''}`;
  
  if (level === 'ERROR') {
    console.error(logString);
  } else if (level === 'WARN') {
    console.warn(logString);
  } else {
    console.log(logString);
  }
}

function parseDeviceInfo(userAgent, platformHint) {
  const ua = (userAgent || '').toLowerCase();
  const platform = (platformHint || '').replace(/"/g, '');
  const isIpad = ua.includes('ipad');
  const isIphone = ua.includes('iphone');
  const isAndroid = ua.includes('android');
  let os = 'unknown';
  let deviceType = 'unknown';
  if (isIphone || isIpad) {
    os = 'iOS';
    deviceType = 'ios';
  } else if (isAndroid) {
    os = 'Android';
    deviceType = 'android';
  } else if (ua.includes('windows')) {
    os = 'Windows';
    deviceType = 'desktop';
  } else if (ua.includes('mac os')) {
    os = 'macOS';
    deviceType = 'desktop';
  } else if (ua.includes('linux')) {
    os = 'Linux';
    deviceType = 'desktop';
  }
  const isMobile = ua.includes('mobile') || isIphone || isAndroid;
  return {
    deviceType,
    os,
    isMobile,
    platform: platform || undefined
  };
}

function getRequestDeviceContext(req) {
  const userAgent = req.get('user-agent') || '';
  const platformHint = req.get('sec-ch-ua-platform') || '';
  return {
    userAgent,
    deviceInfo: parseDeviceInfo(userAgent, platformHint)
  };
}

function getUploadFileMeta(file) {
  if (!file) {
    return {};
  }
  return {
    fileSize: file.size,
    fileType: file.mimetype,
    originalName: file.originalname
  };
}

async function clearCheckInButton(telegramId, messageId, context = {}) {
  if (!telegramId || !messageId) return;
  try {
    await bot.telegram.editMessageReplyMarkup(
      telegramId,
      messageId,
      undefined,
      { inline_keyboard: [] }
    );
  } catch (error) {
    log('WARN', 'CHECKIN', 'Failed to clear check-in button', {
      telegramId,
      telegramMessageId: messageId,
      error: error.message,
      ...context
    });
  }
}

async function finalizeCheckInIfReady(requestId) {
  try {
    const request = await prisma.checkInRequest.findUnique({
      where: { id: requestId },
      include: { user: true, result: true }
    });

    if (!request?.result) {
      return false;
    }

    const hasLocation = request.result.locationLat !== 0 || request.result.locationLon !== 0;
    const hasPhoto = Boolean(request.result.photoPath || request.result.photoFileId || request.result.photoUrl);

    if (!hasLocation || !hasPhoto) {
      return false;
    }

    if (request.status !== 'COMPLETED') {
      await prisma.checkInRequest.update({
        where: { id: requestId },
        data: { status: 'COMPLETED' }
      });
    }

    if (request.telegramMessageId && request.user?.telegramId) {
      await clearCheckInButton(request.user.telegramId, request.telegramMessageId, {
        requestId
      });
    }

    return true;
  } catch (error) {
    log('ERROR', 'CHECKIN', 'Error finalizing check-in', {
      requestId,
      error: error.message
    });
    return false;
  }
}
// Helper function to mask sensitive data in DATABASE_URL for logging
function maskDatabaseUrl(url) {
  if (!url) return 'NOT SET';
  try {
    const urlObj = new URL(url);
    if (urlObj.password) {
      urlObj.password = '***';
    }
    return urlObj.toString();
  } catch {
    return 'INVALID FORMAT';
  }
}

const REQUIRED_TABLES = [
  'users',
  'zones',
  'zone_employees',
  'check_in_requests',
  'check_in_results'
];

async function getMissingTables() {
  const rows = await prisma.$queryRaw`
    SELECT table_name
    FROM information_schema.tables
    WHERE table_schema = 'public'
      AND table_name IN (${Prisma.join(REQUIRED_TABLES)})
  `;
  const existing = new Set(rows.map((row) => row.table_name));
  return REQUIRED_TABLES.filter((table) => !existing.has(table));
}

async function ensureSchema() {
  try {
    const missing = await getMissingTables();
    if (missing.length === 0) {
      log('INFO', 'MIGRATION', 'All required tables exist', {});
      return true;
    }

    log('WARN', 'MIGRATION', 'Missing tables detected, applying schema', {
      missingTables: missing
    });

    const { spawn } = await import('child_process');
    const result = await new Promise((resolve) => {
      const process = spawn('npx', ['prisma', 'db', 'push', '--schema=../prisma/schema.prisma', '--accept-data-loss'], {
        stdio: 'inherit',
        cwd: '/app/server',
        shell: true
      });

      process.on('close', (code) => {
        resolve(code === 0);
      });

      process.on('error', () => resolve(false));
    });

    if (!result) {
      log('ERROR', 'MIGRATION', 'Schema apply failed while ensuring tables');
      return false;
    }

    const missingAfter = await getMissingTables();
    if (missingAfter.length > 0) {
      log('ERROR', 'MIGRATION', 'Tables still missing after schema apply', {
        missingTables: missingAfter
      });
      return false;
    }

    log('INFO', 'MIGRATION', 'Schema ensured successfully');
    return true;
  } catch (error) {
    log('ERROR', 'MIGRATION', 'Error ensuring schema', { error: error.message });
    return false;
  }
}

// Run database migrations
async function runMigrations(maxRetries = 15, delay = 3000) {
  log('INFO', 'MIGRATION', 'Starting database migrations', { maxRetries, delay });
  
  // Проверяем наличие DATABASE_URL
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) {
    log('ERROR', 'MIGRATION', 'DATABASE_URL environment variable is not set!');
    return false;
  }

  log('INFO', 'MIGRATION', 'Database connection info', {
    url: maskDatabaseUrl(databaseUrl)
  });
  
  // Проверяем формат DATABASE_URL
  try {
    const urlObj = new URL(databaseUrl);
    log('INFO', 'MIGRATION', 'Database URL parsed', {
      host: urlObj.hostname,
      port: urlObj.port || '5432',
      database: urlObj.pathname.slice(1)
    });
  } catch (error) {
    log('ERROR', 'MIGRATION', 'Invalid DATABASE_URL format', { error: error.message });
    return false;
  }

  // Сначала проверяем подключение к БД с retry логикой
  log('INFO', 'MIGRATION', 'Checking database connection before applying schema');
  let dbConnected = false;
  const maxConnectionAttempts = 20;
  const initialDelay = 3000;

  for (let attempt = 1; attempt <= maxConnectionAttempts; attempt++) {
    try {
      await Promise.race([
        prisma.$queryRaw`SELECT 1`,
        new Promise((_, reject) => 
          setTimeout(() => reject(new Error('Connection timeout')), 5000)
        )
      ]);
      dbConnected = true;
      log('INFO', 'MIGRATION', 'Database connection established', { attempt });
      break;
    } catch (error) {
      const isLastAttempt = attempt === maxConnectionAttempts;
      const errorInfo = {
        code: error.code || error.errorCode || 'UNKNOWN',
        message: error.message,
        attempt,
        maxAttempts: maxConnectionAttempts
      };

      if (isLastAttempt) {
        log('ERROR', 'MIGRATION', 'Failed to connect to database after all attempts', errorInfo);
        return false;
      } else {
        const waitTime = initialDelay + (attempt - 1) * 3000;
        log('WARN', 'MIGRATION', `Connection attempt failed, retrying`, {
          attempt,
          waitTime,
          error: error.message.substring(0, 100)
        });
        await new Promise((resolve) => setTimeout(resolve, waitTime));
      }
    }
  }

  if (!dbConnected) {
    log('ERROR', 'MIGRATION', 'Failed to connect to database. Cannot apply schema.');
    return false;
  }

  // Теперь применяем схему
  const { spawn } = await import('child_process');

  for (let i = 0; i < maxRetries; i++) {
    try {
      const result = await new Promise((resolve) => {
        log('INFO', 'MIGRATION', 'Applying database schema', { attempt: i + 1, maxRetries });
        const process = spawn('npx', ['prisma', 'db', 'push', '--schema=../prisma/schema.prisma', '--accept-data-loss'], {
          stdio: 'inherit',
          cwd: '/app/server',
          shell: true
        });

        process.on('close', (code) => {
          if (code === 0) {
            log('INFO', 'MIGRATION', 'Database schema applied successfully');
            resolve(true);
          } else {
            log('ERROR', 'MIGRATION', 'Schema application failed', { attempt: i + 1, exitCode: code });
            resolve(false);
          }
        });

        process.on('error', (error) => {
          log('ERROR', 'MIGRATION', 'Error applying schema', { attempt: i + 1, error: error.message });
          resolve(false);
        });
      });

      if (result) {
        return true;
      }

      if (i < maxRetries - 1) {
        log('INFO', 'MIGRATION', 'Retrying schema application', { delay });
        await new Promise(resolve => setTimeout(resolve, delay));
      }
    } catch (error) {
      log('ERROR', 'MIGRATION', 'Error in migration attempt', { attempt: i + 1, error: error.message });
      if (i < maxRetries - 1) {
        await new Promise(resolve => setTimeout(resolve, delay));
      }
    }
  }

  return false;
}

const BOT_TOKEN = process.env.BOT_TOKEN;
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || 'admin123';
const ADMIN_GEO_TG = (process.env.ADMIN_GEO_TG || process.env.ADMIN_TELEGRAM_ID || process.env.ADMIN_TG || '').trim();
const PORT = process.env.PORT || 3000;

if (!BOT_TOKEN) {
  log('ERROR', 'STARTUP', 'BOT_TOKEN is required!');
  process.exit(1);
}

const bot = new Telegraf(BOT_TOKEN);

const isAdminTelegram = (telegramId) => {
  if (!ADMIN_GEO_TG) return false;
  return String(telegramId) === ADMIN_GEO_TG;
};

const ensureAdminUser = async (telegramId, name = null) => {
  if (!isAdminTelegram(telegramId)) return null;
  const existing = await prisma.user.findUnique({
    where: { telegramId: String(telegramId) }
  });
  if (!existing) {
    return prisma.user.create({
      data: {
        telegramId: String(telegramId),
        name,
        role: 'DIRECTOR'
      }
    });
  }
  if (existing.role !== 'DIRECTOR') {
    return prisma.user.update({
      where: { telegramId: String(telegramId) },
      data: { role: 'DIRECTOR' }
    });
  }
  return existing;
};

const clearStartButton = async (telegramId) => {
  const record = await prisma.startMessage.findUnique({
    where: { telegramId: String(telegramId) }
  });
  if (!record) return;
  try {
    await bot.telegram.editMessageReplyMarkup(
      String(telegramId),
      record.messageId,
      undefined,
      null
    );
  } catch (error) {
    log('WARN', 'BOT', 'Failed to remove start button', {
      telegramId,
      messageId: record.messageId,
      error: error.message
    });
  } finally {
    await prisma.startMessage.delete({
      where: { telegramId: String(telegramId) }
    });
  }
};

// Track if bot is running
let botRunning = false;

// Middleware для логирования всех HTTP запросов
app.use((req, res, next) => {
  const startTime = Date.now();
  const requestId = crypto.randomBytes(8).toString('hex');
  req.requestId = requestId;

  log('INFO', 'HTTP', 'Incoming request', {
    requestId,
    method: req.method,
    path: req.path,
    ip: req.ip,
    userAgent: req.get('user-agent')?.substring(0, 100)
  });

  // Логируем ответ после завершения
  res.on('finish', () => {
    const duration = Date.now() - startTime;
    log('INFO', 'HTTP', 'Request completed', {
      requestId,
      method: req.method,
      path: req.path,
      statusCode: res.statusCode,
      duration: `${duration}ms`
    });
  });

  next();
});

// Middleware
app.use(cors());
app.use(express.json());
app.use(express.static(join(__dirname, '../client/dist')));

// Verify Telegram Web App data
function verifyTelegramWebAppData(initData) {
  try {
    const urlParams = new URLSearchParams(initData);
    const hash = urlParams.get('hash');
    if (!hash) {
      log('ERROR', 'AUTH', 'Hash not found in initData');
      return false;
    }
    urlParams.delete('hash');

    const dataCheckString = Array.from(urlParams.entries())
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([key, value]) => `${key}=${value}`)
      .join('\n');

    const secretKey = crypto
      .createHmac('sha256', 'WebAppData')
      .update(BOT_TOKEN)
      .digest();

    const calculatedHash = crypto
      .createHmac('sha256', secretKey)
      .update(dataCheckString)
      .digest('hex');

    if (calculatedHash !== hash) {
      log('ERROR', 'AUTH', 'Hash mismatch', {
        calculated: calculatedHash.substring(0, 10) + '...',
        received: hash.substring(0, 10) + '...',
        dataCheckStringLength: dataCheckString.length
      });
    }

    return calculatedHash === hash;
  } catch (error) {
    log('ERROR', 'AUTH', 'Error verifying Telegram data', { error: error.message });
    return false;
  }
}

// Parse Telegram Web App init data
function parseInitData(initData) {
  const urlParams = new URLSearchParams(initData);
  const userStr = urlParams.get('user');
  if (!userStr) return null;
  return JSON.parse(userStr);
}

// Middleware to verify Telegram Web App
function verifyTelegramWebApp(req, res, next) {
  const initData = req.headers['x-telegram-init-data'] || 
                   req.headers['X-Telegram-Init-Data'] ||
                   req.headers['X-TELEGRAM-INIT-DATA'] ||
                   req.query?.initData ||
                   req.query?.tgInitData;
  
  if (!initData) {
    log('WARN', 'AUTH', 'Missing Telegram init data header', {
      requestId: req.requestId,
      availableHeaders: Object.keys(req.headers).filter(h => h.toLowerCase().includes('telegram'))
    });
    return res.status(401).json({ 
      error: 'Missing Telegram init data. Пожалуйста, откройте приложение через Telegram бота.' 
    });
  }

  if (!verifyTelegramWebAppData(initData)) {
    log('WARN', 'AUTH', 'Invalid Telegram init data', {
      requestId: req.requestId,
      initDataLength: initData.length
    });
    return res.status(401).json({ 
      error: 'Invalid Telegram init data. Пожалуйста, перезагрузите страницу.' 
    });
  }

  const user = parseInitData(initData);
  if (!user) {
    log('WARN', 'AUTH', 'Failed to parse user data from initData', { requestId: req.requestId });
    return res.status(401).json({ 
      error: 'Invalid user data. Пожалуйста, перезагрузите страницу.' 
    });
  }

  req.telegramUser = user;
  log('INFO', 'AUTH', 'Telegram user authenticated', {
    requestId: req.requestId,
    userId: user.id,
    username: user.username
  });
  next();
}

// Haversine distance calculation
function calculateDistance(lat1, lon1, lat2, lon2) {
  const R = 6371000; // Earth radius in meters
  const dLat = (lat2 - lat1) * Math.PI / 180;
  const dLon = (lon2 - lon1) * Math.PI / 180;
  const a = 
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *
    Math.sin(dLon / 2) * Math.sin(dLon / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return R * c;
}

// Check if location is within employee's zones
async function checkLocationInZones(lat, lon, userId) {
  log('INFO', 'LOCATION', 'Checking location in zones', { userId, lat, lon });
  
  const user = await prisma.user.findUnique({
    where: { id: userId },
    include: {
      zones: {
        include: {
          zone: true
        }
      }
    }
  });

  if (!user || !user.zones || user.zones.length === 0) {
    log('INFO', 'LOCATION', 'User has no zones assigned', { userId });
    return { 
      isWithinZone: false, 
      distanceToZone: null,
      zoneId: null
    };
  }

  const employeeZones = user.zones.map(ze => ze.zone);
  log('INFO', 'LOCATION', 'Checking against employee zones', {
    userId,
    zoneCount: employeeZones.length,
    zoneIds: employeeZones.map(z => z.id)
  });

  for (const zone of employeeZones) {
    const distance = calculateDistance(lat, lon, zone.latitude, zone.longitude);
    if (distance <= zone.radius) {
      log('INFO', 'LOCATION', 'Location is within zone', {
        userId,
        zoneId: zone.id,
        zoneName: zone.name,
        distance: Math.round(distance)
      });
      return { isWithinZone: true, distanceToZone: distance, zoneId: zone.id };
    }
  }

  // Find closest zone
  const distances = employeeZones.map(zone => ({
    zone,
    distance: calculateDistance(lat, lon, zone.latitude, zone.longitude)
  }));

  const closest = distances.reduce((min, current) => 
    current.distance < min.distance ? current : min
  , distances[0] || { distance: Infinity });

  log('INFO', 'LOCATION', 'Location is outside all zones', {
    userId,
    closestZoneId: closest.zone?.id,
    closestDistance: Math.round(closest.distance || 0)
  });

  return { 
    isWithinZone: false, 
    distanceToZone: closest.distance || null,
    zoneId: closest.zone?.id || null
  };
}

const DEFAULT_WORK_DAYS = [1, 2, 3, 4, 5]; // Пн-Пт (0 - Вс)
const MIN_CHECKIN_MINUTES = 25;
const MAX_CHECKIN_MINUTES = 95;
const TIMEZONE_OFFSET_MINUTES = Number.parseInt(process.env.TIMEZONE_OFFSET_MINUTES, 10);
const SCHEDULER_OFFSET_MINUTES = Number.isFinite(TIMEZONE_OFFSET_MINUTES)
  ? TIMEZONE_OFFSET_MINUTES
  : 180;
const DAILY_SCHEDULE_CRON = process.env.DAILY_SCHEDULE_CRON || '0 2 * * *';
const MIN_SCHEDULE_GAP_MINUTES = 5;

function parseWorkDays(value) {
  if (Array.isArray(value)) {
    return value
      .map((item) => Number(item))
      .filter((day) => Number.isInteger(day) && day >= 0 && day <= 6);
  }
  if (typeof value === 'string') {
    const parsed = value
      .split(',')
      .map((item) => Number(item.trim()))
      .filter((day) => Number.isInteger(day) && day >= 0 && day <= 6);
    return parsed.length ? [...new Set(parsed)] : DEFAULT_WORK_DAYS;
  }
  return DEFAULT_WORK_DAYS;
}

function normalizeWorkWindow(startMinutes, endMinutes) {
  const start = Number.isInteger(startMinutes) ? startMinutes : 540;
  const end = Number.isInteger(endMinutes) ? endMinutes : 1080;
  if (start < 0 || start >= 1440 || end <= start || end > 1440) {
    return { startMinutes: 540, endMinutes: 1080 };
  }
  return { startMinutes: start, endMinutes: end };
}

function minutesSinceMidnight(date) {
  return date.getHours() * 60 + date.getMinutes();
}

function buildTimeOnDate(date, totalMinutes) {
  const result = new Date(date);
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  result.setHours(hours, minutes, 0, 0);
  return result;
}

function isWorkingDay(date, workDays) {
  return workDays.includes(date.getDay());
}

function isWithinWorkWindow(date, workDays, startMinutes, endMinutes) {
  if (!isWorkingDay(date, workDays)) return false;
  const minutes = minutesSinceMidnight(date);
  return minutes >= startMinutes && minutes < endMinutes;
}

function randomInt(min, max) {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

function calculateNextCheckInAt(now, workDays, startMinutes, endMinutes) {
  const normalized = normalizeWorkWindow(startMinutes, endMinutes);
  const validWorkDays = workDays.length ? workDays : DEFAULT_WORK_DAYS;
  const minDelayMs = MIN_CHECKIN_MINUTES * 60 * 1000;
  const maxDelayMs = MAX_CHECKIN_MINUTES * 60 * 1000;

  for (let dayOffset = 0; dayOffset < 14; dayOffset += 1) {
    const candidateDate = new Date(now);
    candidateDate.setDate(now.getDate() + dayOffset);
    if (!isWorkingDay(candidateDate, validWorkDays)) {
      continue;
    }

    const dayStart = buildTimeOnDate(candidateDate, normalized.startMinutes);
    const dayEnd = buildTimeOnDate(candidateDate, normalized.endMinutes);

    let windowStart = dayStart;
    if (dayOffset === 0) {
      const earliest = new Date(now.getTime() + minDelayMs);
      if (earliest > windowStart) {
        windowStart = earliest;
      }
    }

    if (windowStart >= dayEnd) {
      continue;
    }

    const availableMs = dayEnd.getTime() - windowStart.getTime();
    if (availableMs < 60000) {
      continue;
    }
    const maxAvailableMs = availableMs - 60000;
    const minDelay = Math.min(minDelayMs, maxAvailableMs);
    const maxDelay = Math.min(maxDelayMs, maxAvailableMs);
    const randomDelayMs = randomInt(minDelay, maxDelay);
    const next = new Date(windowStart.getTime() + randomDelayMs);
    next.setSeconds(randomInt(5, 55), 0);
    return next;
  }

  return null;
}

function toLocalDate(date) {
  return new Date(date.getTime() + SCHEDULER_OFFSET_MINUTES * 60 * 1000);
}

function toUtcDate(date) {
  return new Date(date.getTime() - SCHEDULER_OFFSET_MINUTES * 60 * 1000);
}

function getSchedulerNow() {
  return toLocalDate(new Date());
}

function startOfLocalDay(date) {
  const local = new Date(date);
  local.setHours(0, 0, 0, 0);
  return local;
}

function endOfLocalDay(date) {
  const local = new Date(date);
  local.setHours(23, 59, 59, 999);
  return local;
}

/**
 * Returns the start of the next local day.
 */
function getNextLocalDayStart(date) {
  const next = startOfLocalDay(date);
  next.setDate(next.getDate() + 1);
  return next;
}

function generateRandomScheduleTimes(baseDate, count, startMinutes, endMinutes) {
  if (!count) return [];
  const normalized = normalizeWorkWindow(startMinutes, endMinutes);
  const dayStart = buildTimeOnDate(baseDate, normalized.startMinutes);
  const dayEnd = buildTimeOnDate(baseDate, normalized.endMinutes);
  const availableMinutes = Math.floor((dayEnd - dayStart) / 60000);
  if (availableMinutes <= 0) return [];

  const maxSlots = Math.floor(availableMinutes / MIN_SCHEDULE_GAP_MINUTES);
  const target = Math.min(count, maxSlots);
  if (target <= 0) return [];

  const picked = new Set();
  const times = [];

  while (times.length < target) {
    const offsetMinutes = randomInt(0, availableMinutes - 1);
    const slot = Math.floor(offsetMinutes / MIN_SCHEDULE_GAP_MINUTES);
    if (picked.has(slot)) {
      continue;
    }
    picked.add(slot);
    const scheduled = new Date(dayStart);
    scheduled.setMinutes(dayStart.getMinutes() + slot * MIN_SCHEDULE_GAP_MINUTES);
    scheduled.setSeconds(randomInt(5, 55), 0);
    times.push(scheduled);
  }

  return times.sort((a, b) => a.getTime() - b.getTime());
}

// API Routes

// Register employee (only through web app)
app.post('/api/user/register', verifyTelegramWebApp, async (req, res) => {
  try {
    const { id, first_name, last_name, username } = req.telegramUser;
    const name = `${first_name || ''} ${last_name || ''}`.trim() || username || `User ${id}`;

    log('INFO', 'USER', 'User registration attempt', {
      requestId: req.requestId,
      telegramId: id,
      name
    });

    let user = await prisma.user.findUnique({
      where: { telegramId: String(id) }
    });

    if (user) {
      log('WARN', 'USER', 'User already registered', {
        requestId: req.requestId,
        telegramId: id,
        userId: user.id
      });
      return res.status(400).json({ error: 'User already registered' });
    }

    const userCount = await prisma.user.count();
    const role = isAdminTelegram(id)
      ? 'DIRECTOR'
      : userCount === 0
        ? 'DIRECTOR'
        : 'EMPLOYEE';
    
    user = await prisma.user.create({
      data: {
        telegramId: String(id),
        name,
        role
      }
    });

    log('INFO', 'USER', 'User registered successfully', {
      requestId: req.requestId,
      userId: user.id,
      telegramId: id,
      name,
      role,
      isFirstUser: userCount === 0
    });

    await clearStartButton(id);
    res.json(user);
  } catch (error) {
    log('ERROR', 'USER', 'Error in user registration', {
      requestId: req.requestId,
      telegramId: req.telegramUser?.id,
      error: error.message,
      stack: error.stack
    });
    res.status(500).json({ error: error.message });
  }
});

// Get or update user (for existing users)
app.post('/api/user', verifyTelegramWebApp, async (req, res) => {
  try {
    const { id, first_name, last_name, username } = req.telegramUser;
    const name = `${first_name || ''} ${last_name || ''}`.trim() || username || `User ${id}`;

    log('INFO', 'USER', 'User update/get request', {
      requestId: req.requestId,
      telegramId: id
    });

    let user = await prisma.user.findUnique({
      where: { telegramId: String(id) }
    });

    if (!user && isAdminTelegram(id)) {
      user = await ensureAdminUser(id, name);
    }

    if (!user) {
      log('WARN', 'USER', 'User not found', {
        requestId: req.requestId,
        telegramId: id
      });
      return res.status(404).json({ error: 'User not registered. Please register first.' });
    }

    const newData = { name };
    if (isAdminTelegram(id) && user.role !== 'DIRECTOR') {
      newData.role = 'DIRECTOR';
    }

    user = await prisma.user.update({
      where: { telegramId: String(id) },
      data: newData
    });

    log('INFO', 'USER', 'User updated successfully', {
      requestId: req.requestId,
      userId: user.id,
      telegramId: id,
      name
    });

    res.json(user);
  } catch (error) {
    log('ERROR', 'USER', 'Error in user update', {
      requestId: req.requestId,
      telegramId: req.telegramUser?.id,
      error: error.message,
      stack: error.stack
    });
    res.status(500).json({ error: error.message });
  }
});

// Get user role
app.get('/api/user/role', verifyTelegramWebApp, async (req, res) => {
  try {
    const { id } = req.telegramUser;
    
    log('INFO', 'USER', 'Get user role request', {
      requestId: req.requestId,
      telegramId: id
    });

    let user = await prisma.user.findUnique({
      where: { telegramId: String(id) },
      select: { role: true }
    });

    if (!user && isAdminTelegram(id)) {
      const adminUser = await ensureAdminUser(id);
      user = adminUser ? { role: adminUser.role } : null;
    }

    if (!user) {
      log('WARN', 'USER', 'User not found for role check', {
        requestId: req.requestId,
        telegramId: id
      });
      return res.status(404).json({ error: 'User not found' });
    }

    log('INFO', 'USER', 'User role retrieved', {
      requestId: req.requestId,
      telegramId: id,
      role: user.role
    });

    res.json({ role: user.role });
  } catch (error) {
    log('ERROR', 'USER', 'Error getting user role', {
      requestId: req.requestId,
      telegramId: req.telegramUser?.id,
      error: error.message
    });
    res.status(500).json({ error: error.message });
  }
});

// Get list of employees (Director only)
app.get('/api/employees', verifyTelegramWebApp, async (req, res) => {
  try {
    const { id } = req.telegramUser;
    
    log('INFO', 'EMPLOYEE', 'Get employees list request', {
      requestId: req.requestId,
      directorTelegramId: id
    });

    const user = await prisma.user.findUnique({
      where: { telegramId: String(id) }
    });

    if (!user || user.role !== 'DIRECTOR') {
      log('WARN', 'EMPLOYEE', 'Access denied - not a director', {
        requestId: req.requestId,
        telegramId: id,
        role: user?.role
      });
      return res.status(403).json({ error: 'Access denied' });
    }

    const employees = await prisma.user.findMany({
      where: { role: 'EMPLOYEE' },
      select: {
        id: true,
        telegramId: true,
        name: true,
        displayName: true,
        dailyCheckInTarget: true,
        dailyCheckInTargetPending: true,
        dailyCheckInTargetPendingFrom: true,
        checkInsEnabled: true,
        cameraManualStartDisabled: true,
        workDays: true,
        workStartMinutes: true,
        workEndMinutes: true,
        createdAt: true
      },
      orderBy: { createdAt: 'desc' }
    });

    log('INFO', 'EMPLOYEE', 'Employees list retrieved', {
      requestId: req.requestId,
      directorId: user.id,
      employeeCount: employees.length
    });

    res.json(employees);
  } catch (error) {
    log('ERROR', 'EMPLOYEE', 'Error getting employees list', {
      requestId: req.requestId,
      telegramId: req.telegramUser?.id,
      error: error.message,
      stack: error.stack
    });
    res.status(500).json({ error: error.message });
  }
});

// Toggle manual camera start override for employee (Director only)
app.put('/api/employees/:id/camera-manual-start', verifyTelegramWebApp, async (req, res) => {
  try {
    const { id: directorId } = req.telegramUser;
    const { id: employeeId } = req.params;
    const { cameraManualStartDisabled } = req.body || {};

    const director = await prisma.user.findUnique({
      where: { telegramId: String(directorId) }
    });

    if (!director || director.role !== 'DIRECTOR') {
      return res.status(403).json({ error: 'Access denied' });
    }

    if (typeof cameraManualStartDisabled !== 'boolean') {
      return res.status(400).json({ error: 'Некорректное значение настройки камеры' });
    }

    const updatedEmployee = await prisma.user.update({
      where: { id: employeeId },
      data: { cameraManualStartDisabled },
      select: { id: true, cameraManualStartDisabled: true }
    });

    res.json(updatedEmployee);
  } catch (error) {
    log('ERROR', 'EMPLOYEE', 'Error updating camera manual start setting', {
      requestId: req.requestId,
      telegramId: req.telegramUser?.id,
      error: error.message
    });
    res.status(500).json({ error: error.message });
  }
});

// Update employee daily auto-checkin target (Director only)
app.put('/api/employees/:id/daily-checkins', verifyTelegramWebApp, async (req, res) => {
  try {
    const { id: directorId } = req.telegramUser;
    const { id: employeeId } = req.params;
    const { dailyCheckInTarget } = req.body || {};

    const director = await prisma.user.findUnique({
      where: { telegramId: String(directorId) }
    });

    if (!director || director.role !== 'DIRECTOR') {
      return res.status(403).json({ error: 'Access denied' });
    }

    const parsed = Number(dailyCheckInTarget);
    if (!Number.isInteger(parsed) || parsed < 0 || parsed > 20) {
      return res.status(400).json({ error: 'Некорректное количество проверок' });
    }

    const employee = await prisma.user.findUnique({
      where: { id: employeeId },
      select: {
        id: true,
        name: true,
        displayName: true,
        dailyCheckInTarget: true,
        dailyCheckInTargetPending: true,
        dailyCheckInTargetPendingFrom: true
      }
    });

    if (!employee) {
      return res.status(404).json({ error: 'Employee not found' });
    }

    let updatedEmployee;
    if (parsed === employee.dailyCheckInTarget) {
      updatedEmployee = await prisma.user.update({
        where: { id: employeeId },
        data: {
          dailyCheckInTargetPending: null,
          dailyCheckInTargetPendingFrom: null
        },
        select: {
          id: true,
          name: true,
          displayName: true,
          dailyCheckInTarget: true,
          dailyCheckInTargetPending: true,
          dailyCheckInTargetPendingFrom: true
        }
      });
    } else {
      const nextLocalStart = getNextLocalDayStart(getSchedulerNow());
      updatedEmployee = await prisma.user.update({
        where: { id: employeeId },
        data: {
          dailyCheckInTargetPending: parsed,
          dailyCheckInTargetPendingFrom: toUtcDate(nextLocalStart)
        },
        select: {
          id: true,
          name: true,
          displayName: true,
          dailyCheckInTarget: true,
          dailyCheckInTargetPending: true,
          dailyCheckInTargetPendingFrom: true
        }
      });
    }

    res.json(updatedEmployee);
  } catch (error) {
    log('ERROR', 'EMPLOYEE', 'Error updating daily check-in target', {
      requestId: req.requestId,
      telegramId: req.telegramUser?.id,
      error: error.message
    });
    res.status(500).json({ error: error.message });
  }
});

// Update employee display name (Director only)
app.put('/api/employees/:id/display-name', verifyTelegramWebApp, async (req, res) => {
  try {
    const { id } = req.telegramUser;
    const { id: employeeId } = req.params;
    const { displayName } = req.body || {};

    const director = await prisma.user.findUnique({
      where: { telegramId: String(id) }
    });

    if (!director || director.role !== 'DIRECTOR') {
      return res.status(403).json({ error: 'Access denied' });
    }

    const normalized = typeof displayName === 'string' ? displayName.trim() : '';

    const updatedEmployee = await prisma.user.update({
      where: { id: employeeId },
      data: { displayName: normalized ? normalized : null },
      select: { id: true, name: true, displayName: true }
    });

    res.json(updatedEmployee);
  } catch (error) {
    log('ERROR', 'EMPLOYEE', 'Error updating employee display name', {
      requestId: req.requestId,
      telegramId: req.telegramUser?.id,
      error: error.message
    });
    res.status(500).json({ error: error.message });
  }
});

// Toggle check-ins enabled/disabled for employee (Director only)
app.put('/api/employees/:id/toggle-checkins', verifyTelegramWebApp, async (req, res) => {
  try {
    const { id: directorId } = req.telegramUser;
    const { id: employeeId } = req.params;

    log('INFO', 'EMPLOYEE', 'Toggle check-ins request', {
      requestId: req.requestId,
      directorTelegramId: directorId,
      employeeId
    });

    const director = await prisma.user.findUnique({
      where: { telegramId: String(directorId) }
    });

    if (!director || director.role !== 'DIRECTOR') {
      log('WARN', 'EMPLOYEE', 'Access denied - not a director', {
        requestId: req.requestId,
        telegramId: directorId,
        role: director?.role
      });
      return res.status(403).json({ error: 'Access denied' });
    }

    const employee = await prisma.user.findUnique({
      where: { id: employeeId }
    });

    if (!employee || employee.role !== 'EMPLOYEE') {
      log('WARN', 'EMPLOYEE', 'Employee not found', {
        requestId: req.requestId,
        directorId: director.id,
        employeeId
      });
      return res.status(404).json({ error: 'Employee not found' });
    }

    const updatedEmployee = await prisma.user.update({
      where: { id: employeeId },
      data: {
        checkInsEnabled: !employee.checkInsEnabled,
        nextCheckInAt: employee.checkInsEnabled
          ? null
          : toUtcDate(calculateNextCheckInAt(
            getSchedulerNow(),
            parseWorkDays(employee.workDays),
            employee.workStartMinutes,
            employee.workEndMinutes
          ))
      }
    });

    log('INFO', 'EMPLOYEE', 'Check-ins status toggled', {
      requestId: req.requestId,
      directorId: director.id,
      employeeId: employee.id,
      employeeName: employee.name,
      newStatus: updatedEmployee.checkInsEnabled
    });

    res.json(updatedEmployee);
  } catch (error) {
    log('ERROR', 'EMPLOYEE', 'Error toggling check-ins', {
      requestId: req.requestId,
      directorTelegramId: req.telegramUser?.id,
      employeeId: req.params.id,
      error: error.message,
      stack: error.stack
    });
    res.status(500).json({ error: error.message });
  }
});

// Update employee work schedule (Director only)
app.put('/api/employees/:id/work-schedule', verifyTelegramWebApp, async (req, res) => {
  try {
    const { id: directorId } = req.telegramUser;
    const { id: employeeId } = req.params;
    const { workDays, workStartMinutes, workEndMinutes } = req.body;

    log('INFO', 'EMPLOYEE', 'Update work schedule request', {
      requestId: req.requestId,
      directorTelegramId: directorId,
      employeeId
    });

    const director = await prisma.user.findUnique({
      where: { telegramId: String(directorId) }
    });

    if (!director || director.role !== 'DIRECTOR') {
      log('WARN', 'EMPLOYEE', 'Access denied - not a director', {
        requestId: req.requestId,
        telegramId: directorId,
        role: director?.role
      });
      return res.status(403).json({ error: 'Access denied' });
    }

    const employee = await prisma.user.findUnique({
      where: { id: employeeId }
    });

    if (!employee || employee.role !== 'EMPLOYEE') {
      log('WARN', 'EMPLOYEE', 'Employee not found', {
        requestId: req.requestId,
        directorId: director.id,
        employeeId
      });
      return res.status(404).json({ error: 'Employee not found' });
    }

    const parsedDays = parseWorkDays(workDays);
    if (parsedDays.length === 0) {
      return res.status(400).json({ error: 'Необходимо выбрать хотя бы один рабочий день' });
    }

    const normalized = normalizeWorkWindow(workStartMinutes, workEndMinutes);

    const updatedEmployee = await prisma.user.update({
      where: { id: employeeId },
      data: {
        workDays: parsedDays.join(','),
        workStartMinutes: normalized.startMinutes,
        workEndMinutes: normalized.endMinutes,
        nextCheckInAt: toUtcDate(calculateNextCheckInAt(
          getSchedulerNow(),
          parsedDays,
          normalized.startMinutes,
          normalized.endMinutes
        ))
      }
    });

    log('INFO', 'EMPLOYEE', 'Work schedule updated', {
      requestId: req.requestId,
      directorId: director.id,
      employeeId: employee.id,
      workDays: updatedEmployee.workDays,
      workStartMinutes: updatedEmployee.workStartMinutes,
      workEndMinutes: updatedEmployee.workEndMinutes
    });

    res.json(updatedEmployee);
  } catch (error) {
    log('ERROR', 'EMPLOYEE', 'Error updating work schedule', {
      requestId: req.requestId,
      directorTelegramId: req.telegramUser?.id,
      employeeId: req.params.id,
      error: error.message,
      stack: error.stack
    });
    res.status(500).json({ error: error.message });
  }
});

// Delete employee (Director only)
app.delete('/api/employees/:id', verifyTelegramWebApp, async (req, res) => {
  try {
    const { id: directorId } = req.telegramUser;
    const { id: employeeId } = req.params;

    log('INFO', 'EMPLOYEE', 'Delete employee request', {
      requestId: req.requestId,
      directorTelegramId: directorId,
      employeeId
    });

    const director = await prisma.user.findUnique({
      where: { telegramId: String(directorId) }
    });

    if (!director || director.role !== 'DIRECTOR') {
      log('WARN', 'EMPLOYEE', 'Access denied - not a director', {
        requestId: req.requestId,
        telegramId: directorId,
        role: director?.role
      });
      return res.status(403).json({ error: 'Access denied' });
    }

    const employee = await prisma.user.findUnique({
      where: { id: employeeId }
    });

    if (!employee || employee.role !== 'EMPLOYEE') {
      log('WARN', 'EMPLOYEE', 'Employee not found', {
        requestId: req.requestId,
        directorId: director.id,
        employeeId
      });
      return res.status(404).json({ error: 'Employee not found' });
    }

    const requests = await prisma.checkInRequest.findMany({
      where: { userId: employeeId },
      include: {
        result: {
          select: { photoPath: true }
        }
      }
    });
    const photoPaths = requests
      .map((request) => request.result?.photoPath)
      .filter(Boolean);

    if (photoPaths.length > 0) {
      const { deletePhotoByKey } = await import('./s3Service.js');
      for (const path of photoPaths) {
        const key = path.startsWith('photos/') ? path : `photos/${path}`;
        try {
          await deletePhotoByKey(key);
        } catch (error) {
          log('WARN', 'EMPLOYEE', 'Failed to delete photo from storage', {
            requestId: req.requestId,
            employeeId,
            photoPath: path,
            error: error.message
          });
        }
      }
    }

    const zoneLinks = await prisma.zoneEmployee.findMany({
      where: { userId: employeeId },
      select: {
        zoneId: true,
        zone: { select: { isShared: true, createdBy: true } }
      }
    });
    const sharedZoneIds = zoneLinks
      .filter((link) => link.zone?.isShared)
      .map((link) => link.zoneId);
    const singleZoneIds = zoneLinks
      .filter((link) => !link.zone?.isShared)
      .map((link) => link.zoneId);
    const createdSingleZones = zoneLinks
      .filter((link) => !link.zone?.isShared && link.zone?.createdBy === employeeId)
      .map((link) => link.zoneId);

    await prisma.$transaction([
      prisma.checkInResult.deleteMany({
        where: { requestId: { in: requests.map((item) => item.id) } }
      }),
      prisma.checkInRequest.deleteMany({ where: { userId: employeeId } }),
      prisma.zoneEmployee.deleteMany({ where: { userId: employeeId } }),
      prisma.zoneEmployee.deleteMany({ where: { zoneId: { in: singleZoneIds } } }),
      prisma.zone.deleteMany({ where: { id: { in: singleZoneIds } } }),
      prisma.zone.deleteMany({ where: { id: { in: createdSingleZones } } }),
      prisma.user.delete({ where: { id: employeeId } })
    ]);

    log('INFO', 'EMPLOYEE', 'Employee deleted successfully', {
      requestId: req.requestId,
      directorId: director.id,
      employeeId: employee.id,
      employeeName: employee.name
    });

    res.json({ success: true });
  } catch (error) {
    log('ERROR', 'EMPLOYEE', 'Error deleting employee', {
      requestId: req.requestId,
      directorTelegramId: req.telegramUser?.id,
      employeeId: req.params.id,
      error: error.message,
      stack: error.stack
    });
    res.status(500).json({ error: error.message });
  }
});

// Admin command to claim director role
app.post('/api/admin/claim', verifyTelegramWebApp, async (req, res) => {
  try {
    const { password } = req.body;
    const { id } = req.telegramUser;

    log('INFO', 'ADMIN', 'Admin claim attempt', {
      requestId: req.requestId,
      telegramId: id
    });

    if (password !== ADMIN_PASSWORD) {
      log('WARN', 'ADMIN', 'Invalid admin password', {
        requestId: req.requestId,
        telegramId: id
      });
      return res.status(401).json({ error: 'Invalid password' });
    }

    const user = await prisma.user.update({
      where: { telegramId: String(id) },
      data: { role: 'DIRECTOR' }
    });

    log('INFO', 'ADMIN', 'Admin role claimed successfully', {
      requestId: req.requestId,
      userId: user.id,
      telegramId: id
    });

    res.json(user);
  } catch (error) {
    log('ERROR', 'ADMIN', 'Error claiming admin role', {
      requestId: req.requestId,
      telegramId: req.telegramUser?.id,
      error: error.message,
      stack: error.stack
    });
    res.status(500).json({ error: error.message });
  }
});

// Zones CRUD
app.get('/api/zones', verifyTelegramWebApp, async (req, res) => {
  try {
    const { id } = req.telegramUser;
    
    log('INFO', 'ZONE', 'Get zones list request', {
      requestId: req.requestId,
      telegramId: id
    });

    const user = await prisma.user.findUnique({
      where: { telegramId: String(id) }
    });

    if (!user || user.role !== 'DIRECTOR') {
      log('WARN', 'ZONE', 'Access denied - not a director', {
        requestId: req.requestId,
        telegramId: id,
        role: user?.role
      });
      return res.status(403).json({ error: 'Access denied' });
    }

    const zones = await prisma.zone.findMany({
      include: {
        createdByUser: {
          select: { name: true }
        },
        employees: {
          include: {
            user: {
              select: { id: true, name: true, displayName: true, telegramId: true }
            }
          }
        }
      },
      orderBy: { createdAt: 'desc' }
    });

    log('INFO', 'ZONE', 'Zones list retrieved', {
      requestId: req.requestId,
      directorId: user.id,
      zoneCount: zones.length
    });

    res.json(zones);
  } catch (error) {
    log('ERROR', 'ZONE', 'Error getting zones list', {
      requestId: req.requestId,
      telegramId: req.telegramUser?.id,
      error: error.message,
      stack: error.stack
    });
    res.status(500).json({ error: error.message });
  }
});

// Get director settings
app.get('/api/director/settings', verifyTelegramWebApp, async (req, res) => {
  try {
    const { id } = req.telegramUser;

    const user = await prisma.user.findUnique({
      where: { telegramId: String(id) },
      select: {
        role: true,
        notificationsEnabled: true,
        weeklyZoneReminderEnabled: true,
        reportDeadlineMinutes: true
      }
    });

    if (!user || user.role !== 'DIRECTOR') {
      return res.status(403).json({ error: 'Access denied' });
    }

    res.json({
      notificationsEnabled: user.notificationsEnabled,
      weeklyZoneReminderEnabled: user.weeklyZoneReminderEnabled,
      reportDeadlineMinutes: user.reportDeadlineMinutes ?? 5
    });
  } catch (error) {
    log('ERROR', 'DIRECTOR', 'Error getting director settings', {
      requestId: req.requestId,
      telegramId: req.telegramUser?.id,
      error: error.message
    });
    res.status(500).json({ error: error.message });
  }
});

// Update director settings
app.put('/api/director/settings', verifyTelegramWebApp, async (req, res) => {
  try {
    const { id } = req.telegramUser;
    const { notificationsEnabled, weeklyZoneReminderEnabled, reportDeadlineMinutes } = req.body || {};

    const user = await prisma.user.findUnique({
      where: { telegramId: String(id) },
      select: { id: true, role: true }
    });

    if (!user || user.role !== 'DIRECTOR') {
      return res.status(403).json({ error: 'Access denied' });
    }

    const data = {};
    if (typeof notificationsEnabled === 'boolean') {
      data.notificationsEnabled = notificationsEnabled;
    }
    if (typeof weeklyZoneReminderEnabled === 'boolean') {
      data.weeklyZoneReminderEnabled = weeklyZoneReminderEnabled;
    }
    if (reportDeadlineMinutes !== undefined) {
      const value = Math.max(1, Math.min(120, Number(reportDeadlineMinutes)));
      if (Number.isFinite(value)) {
        data.reportDeadlineMinutes = Math.round(value);
      }
    }

    const updated = await prisma.user.update({
      where: { id: user.id },
      data,
      select: {
        notificationsEnabled: true,
        weeklyZoneReminderEnabled: true,
        reportDeadlineMinutes: true
      }
    });

    res.json(updated);
  } catch (error) {
    log('ERROR', 'DIRECTOR', 'Error updating director settings', {
      requestId: req.requestId,
      telegramId: req.telegramUser?.id,
      error: error.message
    });
    res.status(500).json({ error: error.message });
  }
});

// Get employee zones (for employee view)
app.get('/api/zones/my', verifyTelegramWebApp, async (req, res) => {
  try {
    const { id } = req.telegramUser;
    
    log('INFO', 'ZONE', 'Get employee zones request', {
      requestId: req.requestId,
      telegramId: id
    });

    const user = await prisma.user.findUnique({
      where: { telegramId: String(id) },
      include: {
        zones: {
          include: {
            zone: true
          }
        }
      }
    });

    if (!user) {
      log('WARN', 'ZONE', 'User not found', {
        requestId: req.requestId,
        telegramId: id
      });
      return res.status(404).json({ error: 'User not found' });
    }

    const zones = user.zones.map(ze => ze.zone);
    
    log('INFO', 'ZONE', 'Employee zones retrieved', {
      requestId: req.requestId,
      userId: user.id,
      zoneCount: zones.length
    });

    res.json(zones);
  } catch (error) {
    log('ERROR', 'ZONE', 'Error getting employee zones', {
      requestId: req.requestId,
      telegramId: req.telegramUser?.id,
      error: error.message,
      stack: error.stack
    });
    res.status(500).json({ error: error.message });
  }
});

app.post('/api/zones', verifyTelegramWebApp, async (req, res) => {
  try {
    const { id } = req.telegramUser;
    const { name, latitude, longitude, radius, employeeIds, isShared } = req.body;
    const sharedZone = Boolean(isShared);

    log('INFO', 'ZONE', 'Create zone request', {
      requestId: req.requestId,
      telegramId: id,
      zoneName: name,
      latitude,
      longitude,
      radius,
      providedEmployeeIds: employeeIds
    });

    const user = await prisma.user.findUnique({
      where: { telegramId: String(id) }
    });

    if (!user || user.role !== 'DIRECTOR') {
      log('WARN', 'ZONE', 'Access denied - not a director', {
        requestId: req.requestId,
        telegramId: id,
        role: user?.role
      });
      return res.status(403).json({ error: 'Access denied' });
    }

    const employeeCount = await prisma.user.count({
      where: { role: 'EMPLOYEE' }
    });

    if (employeeCount === 0) {
      log('WARN', 'ZONE', 'Cannot create zone - no employees', {
        requestId: req.requestId,
        directorId: user.id
      });
      return res.status(400).json({ error: 'Cannot create zones. No employees registered yet.' });
    }

    if (!name || latitude === undefined || longitude === undefined || !radius) {
      log('WARN', 'ZONE', 'Missing required fields', {
        requestId: req.requestId,
        directorId: user.id,
        providedFields: { name: !!name, latitude, longitude, radius }
      });
      return res.status(400).json({ error: 'Missing required fields' });
    }

    // Если employeeIds не передан или пустой, автоматически назначаем всех сотрудников
    let finalEmployeeIds = employeeIds;
    if (!employeeIds || !Array.isArray(employeeIds) || employeeIds.length === 0) {
      log('INFO', 'ZONE', 'Auto-assigning all employees to zone', {
        requestId: req.requestId,
        directorId: user.id
      });
      const allEmployees = await prisma.user.findMany({
        where: { role: 'EMPLOYEE' },
        select: { id: true }
      });
      finalEmployeeIds = allEmployees.map(emp => emp.id);
    }

    if (finalEmployeeIds.length === 0) {
      log('WARN', 'ZONE', 'No employees to assign to zone', {
        requestId: req.requestId,
        directorId: user.id
      });
      return res.status(400).json({ error: 'At least one employee must be assigned to the zone' });
    }

    if (!sharedZone && finalEmployeeIds.length !== 1) {
      return res.status(400).json({ error: 'Single zone must have exactly one employee' });
    }

    log('INFO', 'ZONE', 'Creating zone', {
      requestId: req.requestId,
      directorId: user.id,
      zoneName: name,
      latitude,
      longitude,
      radius,
      employeeCount: finalEmployeeIds.length
    });

    const zone = await prisma.zone.create({
      data: {
        name,
        latitude: parseFloat(latitude),
        longitude: parseFloat(longitude),
        radius: parseFloat(radius),
        isShared: sharedZone,
        createdBy: user.id,
        employees: {
          create: finalEmployeeIds.map(empId => ({
            userId: empId
          }))
        }
      },
      include: {
        employees: {
          include: {
            user: {
              select: { id: true, name: true, displayName: true, telegramId: true }
            }
          }
        }
      }
    });

    log('INFO', 'ZONE', 'Zone created successfully', {
      requestId: req.requestId,
      zoneId: zone.id,
      zoneName: zone.name,
      directorId: user.id,
      employeeCount: zone.employees.length
    });

    res.json(zone);
  } catch (error) {
    log('ERROR', 'ZONE', 'Error creating zone', {
      requestId: req.requestId,
      telegramId: req.telegramUser?.id,
      error: error.message,
      stack: error.stack
    });
    res.status(500).json({ error: error.message });
  }
});

// Update zone radius
app.put('/api/zones/:id/radius', verifyTelegramWebApp, async (req, res) => {
  try {
    const { id: userId } = req.telegramUser;
    const { id: zoneId } = req.params;
    const { radius } = req.body || {};

    log('INFO', 'ZONE', 'Update zone radius request', {
      requestId: req.requestId,
      zoneId,
      telegramId: userId,
      radius
    });

    const user = await prisma.user.findUnique({
      where: { telegramId: String(userId) }
    });

    if (!user || user.role !== 'DIRECTOR') {
      log('WARN', 'ZONE', 'Access denied - not a director', {
        requestId: req.requestId,
        telegramId: userId,
        role: user?.role
      });
      return res.status(403).json({ error: 'Access denied' });
    }

    const parsedRadius = Number(radius);
    if (!Number.isFinite(parsedRadius) || parsedRadius < 10 || parsedRadius > 5000) {
      return res.status(400).json({ error: 'Некорректный радиус зоны' });
    }

    const updatedZone = await prisma.zone.update({
      where: { id: zoneId },
      data: { radius: parseFloat(parsedRadius.toFixed(2)) },
      select: { id: true, radius: true }
    });

    log('INFO', 'ZONE', 'Zone radius updated', {
      requestId: req.requestId,
      zoneId,
      radius: updatedZone.radius
    });

    res.json(updatedZone);
  } catch (error) {
    log('ERROR', 'ZONE', 'Error updating zone radius', {
      requestId: req.requestId,
      telegramId: req.telegramUser?.id,
      error: error.message,
      stack: error.stack
    });
    res.status(500).json({ error: error.message });
  }
});

// Update zone employees
app.put('/api/zones/:id/employees', verifyTelegramWebApp, async (req, res) => {
  try {
    const { id: userId } = req.telegramUser;
    const { id: zoneId } = req.params;
    const { employeeIds } = req.body;

    log('INFO', 'ZONE', 'Update zone employees request', {
      requestId: req.requestId,
      zoneId,
      telegramId: userId,
      employeeIds
    });

    const user = await prisma.user.findUnique({
      where: { telegramId: String(userId) }
    });

    if (!user || user.role !== 'DIRECTOR') {
      log('WARN', 'ZONE', 'Access denied - not a director', {
        requestId: req.requestId,
        telegramId: userId,
        role: user?.role
      });
      return res.status(403).json({ error: 'Access denied' });
    }

    if (!employeeIds || !Array.isArray(employeeIds)) {
      log('WARN', 'ZONE', 'Invalid employeeIds format', {
        requestId: req.requestId,
        zoneId,
        providedEmployeeIds: employeeIds
      });
      return res.status(400).json({ error: 'employeeIds must be an array' });
    }

    const zoneMeta = await prisma.zone.findUnique({
      where: { id: zoneId },
      select: { isShared: true }
    });

    if (!zoneMeta) {
      return res.status(404).json({ error: 'Zone not found' });
    }

    if (!zoneMeta.isShared && employeeIds.length !== 1) {
      return res.status(400).json({ error: 'Single zone must have exactly one employee' });
    }

    log('INFO', 'ZONE', 'Updating zone employees', {
      requestId: req.requestId,
      zoneId,
      directorId: user.id,
      newEmployeeCount: employeeIds.length
    });

    await prisma.zoneEmployee.deleteMany({
      where: { zoneId }
    });

    if (employeeIds.length > 0) {
      await prisma.zoneEmployee.createMany({
        data: employeeIds.map(empId => ({
          zoneId,
          userId: empId
        }))
      });
    }

    const zone = await prisma.zone.findUnique({
      where: { id: zoneId },
      include: {
        employees: {
          include: {
            user: {
              select: { id: true, name: true, displayName: true, telegramId: true }
            }
          }
        }
      }
    });

    log('INFO', 'ZONE', 'Zone employees updated successfully', {
      requestId: req.requestId,
      zoneId,
      employeeCount: zone.employees.length
    });

    res.json(zone);
  } catch (error) {
    log('ERROR', 'ZONE', 'Error updating zone employees', {
      requestId: req.requestId,
      zoneId: req.params.id,
      telegramId: req.telegramUser?.id,
      error: error.message,
      stack: error.stack
    });
    res.status(500).json({ error: error.message });
  }
});

app.delete('/api/zones/:id', verifyTelegramWebApp, async (req, res) => {
  try {
    const { id: userId } = req.telegramUser;
    const { id: zoneId } = req.params;

    log('INFO', 'ZONE', 'Delete zone request', {
      requestId: req.requestId,
      zoneId,
      telegramId: userId
    });

    const user = await prisma.user.findUnique({
      where: { telegramId: String(userId) }
    });

    if (!user || user.role !== 'DIRECTOR') {
      log('WARN', 'ZONE', 'Access denied - not a director', {
        requestId: req.requestId,
        telegramId: userId,
        role: user?.role
      });
      return res.status(403).json({ error: 'Access denied' });
    }

    await prisma.zone.delete({
      where: { id: zoneId }
    });

    log('INFO', 'ZONE', 'Zone deleted successfully', {
      requestId: req.requestId,
      zoneId,
      directorId: user.id
    });

    res.json({ success: true });
  } catch (error) {
    log('ERROR', 'ZONE', 'Error deleting zone', {
      requestId: req.requestId,
      zoneId: req.params.id,
      telegramId: req.telegramUser?.id,
      error: error.message,
      stack: error.stack
    });
    res.status(500).json({ error: error.message });
  }
});

// Get pending check-in request for employee
app.get('/api/check-in/pending', verifyTelegramWebApp, async (req, res) => {
  try {
    const { id } = req.telegramUser;
    
    log('INFO', 'CHECKIN', 'Get pending check-in request', {
      requestId: req.requestId,
      telegramId: id
    });

    const user = await prisma.user.findUnique({
      where: { telegramId: String(id) }
    });

    if (!user) {
      log('WARN', 'CHECKIN', 'User not found', {
        requestId: req.requestId,
        telegramId: id
      });
      return res.status(404).json({ error: 'User not found' });
    }

    const pendingRequest = await prisma.checkInRequest.findFirst({
      where: {
        userId: user.id,
        status: 'PENDING'
      },
      orderBy: { requestedAt: 'desc' }
    });

    if (!pendingRequest) {
      log('INFO', 'CHECKIN', 'No pending check-in request found', {
        requestId: req.requestId,
        userId: user.id
      });
      return res.status(404).json({ error: 'No pending check-in request' });
    }

    log('INFO', 'CHECKIN', 'Pending check-in request found', {
      requestId: req.requestId,
      userId: user.id,
      checkInRequestId: pendingRequest.id
    });

    res.json(pendingRequest);
  } catch (error) {
    log('ERROR', 'CHECKIN', 'Error getting pending check-in', {
      requestId: req.requestId,
      telegramId: req.telegramUser?.id,
      error: error.message,
      stack: error.stack
    });
    res.status(500).json({ error: error.message });
  }
});

// Submit location for check-in
app.post('/api/check-in/location', verifyTelegramWebApp, async (req, res) => {
  try {
    const { id } = req.telegramUser;
    const { latitude, longitude, accuracy } = req.body;
    const { userAgent, deviceInfo } = getRequestDeviceContext(req);

    log('INFO', 'CHECKIN', 'Submit location for check-in', {
      requestId: req.requestId,
      telegramId: id,
      latitude,
      longitude,
      accuracy,
      ip: req.ip,
      userAgent,
      deviceInfo
    });

    const user = await prisma.user.findUnique({
      where: { telegramId: String(id) }
    });

    if (!user) {
      log('WARN', 'CHECKIN', 'User not found', {
        requestId: req.requestId,
        telegramId: id
      });
      return res.status(404).json({ error: 'User not found' });
    }

    const pendingRequest = await prisma.checkInRequest.findFirst({
      where: {
        userId: user.id,
        status: 'PENDING'
      },
      orderBy: { requestedAt: 'desc' }
    });

    if (!pendingRequest) {
      log('WARN', 'CHECKIN', 'No pending check-in request', {
        requestId: req.requestId,
        userId: user.id
      });
      return res.status(404).json({ error: 'No pending check-in request' });
    }

    if (pendingRequest.expiresAt && new Date() > pendingRequest.expiresAt) {
      await prisma.checkInRequest.update({
        where: { id: pendingRequest.id },
        data: { status: 'MISSED' }
      });
      if (pendingRequest.telegramMessageId) {
        await clearCheckInButton(user.telegramId, pendingRequest.telegramMessageId, {
          requestId: req.requestId
        });
      }
      return res.status(410).json({ error: 'Время на отчет истекло' });
    }

    const locationCheck = await checkLocationInZones(latitude, longitude, user.id);

    const existingResult = await prisma.checkInResult.findUnique({
      where: { requestId: pendingRequest.id }
    });

    if (existingResult) {
      await prisma.checkInResult.update({
        where: { id: existingResult.id },
        data: {
          locationLat: latitude,
          locationLon: longitude,
          isWithinZone: locationCheck.isWithinZone,
          distanceToZone: locationCheck.distanceToZone
        }
      });
      log('INFO', 'CHECKIN', 'Check-in result updated', {
        requestId: req.requestId,
        userId: user.id,
        checkInRequestId: pendingRequest.id,
        isWithinZone: locationCheck.isWithinZone,
        distanceToZone: locationCheck.distanceToZone
      });
    } else {
      await prisma.checkInResult.create({
        data: {
          requestId: pendingRequest.id,
          locationLat: latitude,
          locationLon: longitude,
          isWithinZone: locationCheck.isWithinZone,
          distanceToZone: locationCheck.distanceToZone
        }
      });
      log('INFO', 'CHECKIN', 'Check-in result created', {
        requestId: req.requestId,
        userId: user.id,
        checkInRequestId: pendingRequest.id,
        isWithinZone: locationCheck.isWithinZone,
        distanceToZone: locationCheck.distanceToZone
      });
    }

    await finalizeCheckInIfReady(pendingRequest.id);

    res.json({
      success: true,
      isWithinZone: locationCheck.isWithinZone,
      distanceToZone: locationCheck.distanceToZone
    });
  } catch (error) {
    log('ERROR', 'CHECKIN', 'Error submitting location', {
      requestId: req.requestId,
      telegramId: req.telegramUser?.id,
      error: error.message,
      stack: error.stack
    });
    res.status(500).json({ error: error.message });
  }
});

// Receive client-side diagnostic events for check-in flows
app.post('/api/check-in/client-event', verifyTelegramWebApp, async (req, res) => {
  try {
    const { id } = req.telegramUser;
    const { eventType, eventData } = req.body || {};
    const { userAgent, deviceInfo } = getRequestDeviceContext(req);

    if (!eventType || typeof eventType !== 'string') {
      log('WARN', 'CHECKIN', 'Invalid client event payload', {
        requestId: req.requestId,
        telegramId: id,
        eventType,
        eventData
      });
      return res.status(400).json({ error: 'Invalid event payload' });
    }

    log('INFO', 'CHECKIN', 'Client event', {
      requestId: req.requestId,
      telegramId: id,
      eventType,
      eventData,
      ip: req.ip,
      userAgent,
      deviceInfo
    });

    res.json({ success: true });
  } catch (error) {
    log('ERROR', 'CHECKIN', 'Error handling client event', {
      requestId: req.requestId,
      telegramId: req.telegramUser?.id,
      error: error.message,
      stack: error.stack
    });
    res.status(500).json({ error: error.message });
  }
});

// Submit photo for check-in
app.post('/api/check-in/photo', verifyTelegramWebApp, upload.single('photo'), async (req, res) => {
  try {
    const { id } = req.telegramUser;
    const { userAgent, deviceInfo } = getRequestDeviceContext(req);
    const fileMeta = getUploadFileMeta(req.file);

    log('INFO', 'CHECKIN', 'Submit photo for check-in', {
      requestId: req.requestId,
      telegramId: id,
      hasFile: !!req.file,
      ip: req.ip,
      userAgent,
      deviceInfo,
      ...fileMeta
    });

    const user = await prisma.user.findUnique({
      where: { telegramId: String(id) }
    });

    if (!user) {
      log('WARN', 'CHECKIN', 'User not found', {
        requestId: req.requestId,
        telegramId: id
      });
      return res.status(404).json({ error: 'User not found' });
    }

    const pendingRequest = await prisma.checkInRequest.findFirst({
      where: {
        userId: user.id,
        status: 'PENDING'
      },
      orderBy: { requestedAt: 'desc' }
    });

    if (!pendingRequest) {
      const requestedId = req.body?.requestId;
      if (requestedId) {
        const existingRequest = await prisma.checkInRequest.findFirst({
          where: { id: requestedId, userId: user.id },
          select: { status: true }
        });
        if (existingRequest?.status === 'COMPLETED') {
          return res.json({ success: true, alreadyCompleted: true });
        }
        if (existingRequest?.status === 'MISSED') {
          return res.status(410).json({ error: 'Время на отчет истекло' });
        }
      }

      log('WARN', 'CHECKIN', 'No pending check-in request for photo', {
        requestId: req.requestId,
        userId: user.id
      });
      return res.status(404).json({ error: 'No pending check-in request' });
    }

    if (pendingRequest.expiresAt && new Date() > pendingRequest.expiresAt) {
      await prisma.checkInRequest.update({
        where: { id: pendingRequest.id },
        data: { status: 'MISSED' }
      });
      if (pendingRequest.telegramMessageId) {
        await clearCheckInButton(user.telegramId, pendingRequest.telegramMessageId, {
          requestId: req.requestId
        });
      }
      return res.status(410).json({ error: 'Время на отчет истекло' });
    }

    let photoFileId = null;
    let photoPath = null;
    let photoUrl = null;

    // Если файл загружен через multer, сохраняем его в S3
    if (req.file) {
      try {
        const { uploadPhoto } = await import('./s3Service.js');
        const fileName = `check-in-${pendingRequest.id}-${Date.now()}.jpg`;
        photoPath = fileName;
        photoUrl = await uploadPhoto(req.file.path, fileName, req.file.mimetype || 'image/jpeg');
        
        // Удаляем временный файл
        fs.unlinkSync(req.file.path);
        
        log('INFO', 'CHECKIN', 'Photo uploaded to S3', {
          requestId: req.requestId,
          userId: user.id,
          checkInRequestId: pendingRequest.id,
          photoPath,
          ...fileMeta
        });
      } catch (error) {
        log('ERROR', 'CHECKIN', 'Error uploading photo to S3', {
          requestId: req.requestId,
          userId: user.id,
          checkInRequestId: pendingRequest.id,
          error: error.message
        });
        // Продолжаем с file_id если S3 не работает
      }
    }

    // Если photoFileId передан в теле запроса (для совместимости)
    if (req.body.photoFileId && !photoPath) {
      photoFileId = req.body.photoFileId;
    }

    const result = await prisma.checkInResult.findUnique({
      where: { requestId: pendingRequest.id }
    });

    if (result) {
      await prisma.checkInResult.update({
        where: { id: result.id },
        data: {
          photoFileId: photoFileId || result.photoFileId,
          photoPath: photoPath || result.photoPath,
          photoUrl: photoUrl || result.photoUrl
        }
      });
      log('INFO', 'CHECKIN', 'Photo added to existing check-in result', {
        requestId: req.requestId,
        userId: user.id,
        checkInRequestId: pendingRequest.id,
        resultId: result.id
      });
    } else {
      await prisma.checkInResult.create({
        data: {
          requestId: pendingRequest.id,
          locationLat: 0,
          locationLon: 0,
          isWithinZone: false,
          photoFileId,
          photoPath,
          photoUrl
        }
      });
      log('INFO', 'CHECKIN', 'Check-in result created with photo', {
        requestId: req.requestId,
        userId: user.id,
        checkInRequestId: pendingRequest.id
      });
    }

    await finalizeCheckInIfReady(pendingRequest.id);

    res.json({ success: true });
  } catch (error) {
    log('ERROR', 'CHECKIN', 'Error submitting photo', {
      requestId: req.requestId,
      telegramId: req.telegramUser?.id,
      error: error.message,
      stack: error.stack
    });
    res.status(500).json({ error: error.message });
  }
});

// Get photo URL for check-in result (Director only)
app.get('/api/check-ins/:id/photo', verifyTelegramWebApp, async (req, res) => {
  try {
    const { id } = req.telegramUser;
    const { id: requestId } = req.params;

    log('INFO', 'CHECKIN', 'Get photo URL request', {
      requestId: req.requestId,
      checkInRequestId: requestId,
      telegramId: id
    });

    const user = await prisma.user.findUnique({
      where: { telegramId: String(id) }
    });

    if (!user || user.role !== 'DIRECTOR') {
      log('WARN', 'CHECKIN', 'Access denied - not a director', {
        requestId: req.requestId,
        telegramId: id,
        role: user?.role
      });
      return res.status(403).json({ error: 'Access denied' });
    }

    const result = await prisma.checkInResult.findUnique({
      where: { requestId },
      include: {
        request: {
          include: {
            user: {
              select: { name: true, displayName: true }
            }
          }
        }
      }
    });

    if (!result) {
      log('WARN', 'CHECKIN', 'Check-in result not found', {
        requestId: req.requestId,
        checkInRequestId: requestId
      });
      return res.status(404).json({ error: 'Check-in result not found' });
    }

    if (result.photoPath) {
      const normalizedPath = result.photoPath.startsWith('photos/')
        ? result.photoPath.slice('photos/'.length)
        : result.photoPath;
      try {
        const photoUrl = await getPhotoUrl(normalizedPath, 3600);
        const employeeName = result.request.user.displayName || result.request.user.name;
        log('INFO', 'CHECKIN', 'Photo URL retrieved from S3', {
          requestId: req.requestId,
          checkInRequestId: requestId,
          employeeName
        });
        return res.json({ 
          url: photoUrl,
          requestId: result.requestId,
          employeeName
        });
      } catch (error) {
        log('ERROR', 'CHECKIN', 'Error getting photo URL from S3', {
          requestId: req.requestId,
          checkInRequestId: requestId,
          error: error.message
        });
        return res.status(500).json({ error: 'Failed to get photo URL from S3' });
      }
    }

    if (result.photoFileId) {
      const employeeName = result.request.user.displayName || result.request.user.name;
      log('INFO', 'CHECKIN', 'Photo file ID returned (legacy format)', {
        requestId: req.requestId,
        checkInRequestId: requestId,
        employeeName
      });
      return res.json({ 
        fileId: result.photoFileId,
        requestId: result.requestId,
        employeeName,
        note: 'This photo is stored in Telegram Bot API. Consider migrating to S3.'
      });
    }

    log('WARN', 'CHECKIN', 'Photo not found for check-in', {
      requestId: req.requestId,
      checkInRequestId: requestId
    });
    return res.status(404).json({ error: 'Photo not found for this check-in' });
  } catch (error) {
    log('ERROR', 'CHECKIN', 'Error getting photo URL', {
      requestId: req.requestId,
      checkInRequestId: req.params.id,
      telegramId: req.telegramUser?.id,
      error: error.message,
      stack: error.stack
    });
    res.status(500).json({ error: error.message });
  }
});

// Get photo file for check-in result (Director only)
app.get('/api/check-ins/:id/photo/file', verifyTelegramWebApp, async (req, res) => {
  try {
    const { id } = req.telegramUser;
    const { id: requestId } = req.params;

    log('INFO', 'CHECKIN', 'Get photo file request', {
      requestId: req.requestId,
      checkInRequestId: requestId,
      telegramId: id
    });

    const user = await prisma.user.findUnique({
      where: { telegramId: String(id) }
    });

    if (!user || user.role !== 'DIRECTOR') {
      log('WARN', 'CHECKIN', 'Access denied - not a director', {
        requestId: req.requestId,
        telegramId: id,
        role: user?.role
      });
      return res.status(403).json({ error: 'Access denied' });
    }

    const result = await prisma.checkInResult.findUnique({
      where: { requestId }
    });

    if (!result || !result.photoPath) {
      log('WARN', 'CHECKIN', 'Photo file not found for check-in', {
        requestId: req.requestId,
        checkInRequestId: requestId
      });
      return res.status(404).json({ error: 'Photo not found for this check-in' });
    }

    const normalizedPath = result.photoPath.startsWith('photos/')
      ? result.photoPath.slice('photos/'.length)
      : result.photoPath;
    const signedUrl = await getPhotoUrl(normalizedPath, 300);
    const photoResponse = await fetch(signedUrl);

    if (!photoResponse.ok) {
      log('ERROR', 'CHECKIN', 'Failed to fetch photo from storage', {
        requestId: req.requestId,
        checkInRequestId: requestId,
        status: photoResponse.status
      });
      return res.status(502).json({ error: 'Failed to fetch photo from storage' });
    }

    const contentType = photoResponse.headers.get('content-type') || 'image/jpeg';
    res.setHeader('Content-Type', contentType);
    res.setHeader('Cache-Control', 'private, max-age=300');

    if (photoResponse.body) {
      const stream = Readable.fromWeb(photoResponse.body);
      stream.pipe(res);
      return;
    }

    const buffer = Buffer.from(await photoResponse.arrayBuffer());
    res.end(buffer);
  } catch (error) {
    log('ERROR', 'CHECKIN', 'Error getting photo file', {
      requestId: req.requestId,
      checkInRequestId: req.params.id,
      telegramId: req.telegramUser?.id,
      error: error.message,
      stack: error.stack
    });
    res.status(500).json({ error: error.message });
  }
});

// Get check-in results (Director dashboard)
app.get('/api/check-ins', verifyTelegramWebApp, async (req, res) => {
  try {
    const { id } = req.telegramUser;
    const { status, startDate, endDate } = req.query;

    log('INFO', 'CHECKIN', 'Get check-ins list request', {
      requestId: req.requestId,
      telegramId: id,
      filters: { status, startDate, endDate }
    });

    const user = await prisma.user.findUnique({
      where: { telegramId: String(id) }
    });

    if (!user || user.role !== 'DIRECTOR') {
      log('WARN', 'CHECKIN', 'Access denied - not a director', {
        requestId: req.requestId,
        telegramId: id,
        role: user?.role
      });
      return res.status(403).json({ error: 'Access denied' });
    }

    const where = {};
    if (status) {
      where.status = status;
    }
    if (startDate || endDate) {
      where.requestedAt = {};
      if (startDate) {
        const start = new Date(`${startDate}T00:00:00`);
        where.requestedAt.gte = start;
      }
      if (endDate) {
        const end = new Date(`${endDate}T23:59:59.999`);
        where.requestedAt.lte = end;
      }
    }

    const checkIns = await prisma.checkInRequest.findMany({
      where,
      include: {
        user: {
          select: { name: true, displayName: true, telegramId: true }
        },
        result: true
      },
      orderBy: { requestedAt: 'desc' },
      take: 1000
    });

    log('INFO', 'CHECKIN', 'Check-ins list retrieved', {
      requestId: req.requestId,
      directorId: user.id,
      checkInCount: checkIns.length,
      filters: { status, startDate, endDate }
    });

    res.json(checkIns);
  } catch (error) {
    log('ERROR', 'CHECKIN', 'Error getting check-ins list', {
      requestId: req.requestId,
      telegramId: req.telegramUser?.id,
      error: error.message,
      stack: error.stack
    });
    res.status(500).json({ error: error.message });
  }
});

// Get daily auto-checkin schedule (Director only)
app.get('/api/check-ins/schedule', verifyTelegramWebApp, async (req, res) => {
  try {
    const { id } = req.telegramUser;
    const { employeeId, date } = req.query;

    const director = await prisma.user.findUnique({
      where: { telegramId: String(id) }
    });

    if (!director || director.role !== 'DIRECTOR') {
      return res.status(403).json({ error: 'Access denied' });
    }

    if (!employeeId) {
      return res.status(400).json({ error: 'Employee ID is required' });
    }

    const localDate = date ? new Date(`${date}T00:00:00`) : getSchedulerNow();
    const dayStartLocal = startOfLocalDay(localDate);
    const dayEndLocal = endOfLocalDay(localDate);
    const dayStartUtc = toUtcDate(dayStartLocal);
    const dayEndUtc = toUtcDate(dayEndLocal);

    const items = await prisma.checkInSchedule.findMany({
      where: {
        userId: employeeId,
        scheduledAt: {
          gte: dayStartUtc,
          lte: dayEndUtc
        }
      },
      orderBy: { scheduledAt: 'asc' }
    });

    res.json({
      date: dayStartLocal.toISOString(),
      items: items.map((item) => ({
        id: item.id,
        status: item.status,
        scheduledAtLocal: toLocalDate(item.scheduledAt).toISOString().slice(11, 16)
      }))
    });
  } catch (error) {
    log('ERROR', 'CHECKIN', 'Error getting check-in schedule', {
      requestId: req.requestId,
      telegramId: req.telegramUser?.id,
      error: error.message
    });
    res.status(500).json({ error: error.message });
  }
});

// Request check-in for specific employee (Director only)
app.post('/api/check-ins/request', verifyTelegramWebApp, async (req, res) => {
  try {
    const { id } = req.telegramUser;
    const { employeeId } = req.body;

    log('INFO', 'CHECKIN', 'Request check-in for employee', {
      requestId: req.requestId,
      directorTelegramId: id,
      employeeId
    });

    const director = await prisma.user.findUnique({
      where: { telegramId: String(id) }
    });

    if (!director || director.role !== 'DIRECTOR') {
      log('WARN', 'CHECKIN', 'Access denied - not a director', {
        requestId: req.requestId,
        telegramId: id,
        role: director?.role
      });
      return res.status(403).json({ error: 'Access denied' });
    }

    if (!employeeId) {
      log('WARN', 'CHECKIN', 'Employee ID is required', {
        requestId: req.requestId,
        directorId: director.id
      });
      return res.status(400).json({ error: 'Employee ID is required' });
    }

    const employee = await prisma.user.findUnique({
      where: { id: employeeId }
    });

    if (!employee || employee.role !== 'EMPLOYEE') {
      log('WARN', 'CHECKIN', 'Employee not found', {
        requestId: req.requestId,
        directorId: director.id,
        employeeId
      });
      return res.status(404).json({ error: 'Employee not found' });
    }

    const pendingRequest = await prisma.checkInRequest.findFirst({
      where: {
        userId: employee.id,
        status: 'PENDING'
      }
    });

    if (pendingRequest) {
      log('INFO', 'CHECKIN', 'Cancelling old pending request', {
        requestId: req.requestId,
        directorId: director.id,
        employeeId: employee.id,
        oldRequestId: pendingRequest.id
      });
      await prisma.checkInRequest.update({
        where: { id: pendingRequest.id },
        data: { status: 'MISSED' }
      });
    }

    const deadlineMinutes = Number.isInteger(director.reportDeadlineMinutes)
      ? director.reportDeadlineMinutes
      : 5;
    const checkInRequest = await prisma.checkInRequest.create({
      data: {
        userId: employee.id,
        status: 'PENDING',
        expiresAt: new Date(Date.now() + deadlineMinutes * 60 * 1000)
      }
    });

    log('INFO', 'CHECKIN', 'Check-in request created', {
      requestId: req.requestId,
      directorId: director.id,
      employeeId: employee.id,
      employeeName: employee.displayName || employee.name,
      checkInRequestId: checkInRequest.id
    });

    const checkInUrl = `${WEB_APP_URL}/check-in?requestId=${checkInRequest.id}`;
    try {
      const employeeLabel = employee.displayName || employee.name;
      const sentMessage = await bot.telegram.sendMessage(
        employee.telegramId,
        `📍 Проверка местоположения!\n\nПожалуйста, отправьте ваше текущее местоположение и фото.\n⏱ На сдачу отчета есть ${deadlineMinutes} мин.`,
        Markup.inlineKeyboard([
          [Markup.button.webApp('Открыть интерфейс проверки', checkInUrl)]
        ])
      );
      await prisma.checkInRequest.update({
        where: { id: checkInRequest.id },
        data: { telegramMessageId: sentMessage.message_id }
      });
      log('INFO', 'BOT', 'Check-in notification sent to employee', {
        requestId: req.requestId,
        employeeId: employee.id,
        employeeTelegramId: employee.telegramId,
        checkInRequestId: checkInRequest.id
      });
    } catch (error) {
      log('ERROR', 'BOT', 'Error sending check-in notification', {
        requestId: req.requestId,
        employeeId: employee.id,
        employeeTelegramId: employee.telegramId,
        error: error.message,
        stack: error.stack
      });
    }

    res.json(checkInRequest);
  } catch (error) {
    log('ERROR', 'CHECKIN', 'Error requesting check-in', {
      requestId: req.requestId,
      telegramId: req.telegramUser?.id,
      employeeId: req.body?.employeeId,
      error: error.message,
      stack: error.stack
    });
    res.status(500).json({ error: error.message });
  }
});

// Add location for employee (Director only) - директор отправляет геолокацию от имени сотрудника
app.post('/api/employees/:id/location', verifyTelegramWebApp, async (req, res) => {
  try {
    const { id: directorId } = req.telegramUser;
    const { id: employeeId } = req.params;
    const { latitude, longitude } = req.body;

    log('INFO', 'EMPLOYEE', 'Add location for employee', {
      requestId: req.requestId,
      directorTelegramId: directorId,
      employeeId,
      latitude,
      longitude
    });

    const director = await prisma.user.findUnique({
      where: { telegramId: String(directorId) }
    });

    if (!director || director.role !== 'DIRECTOR') {
      log('WARN', 'EMPLOYEE', 'Access denied - not a director', {
        requestId: req.requestId,
        telegramId: directorId,
        role: director?.role
      });
      return res.status(403).json({ error: 'Access denied' });
    }

    if (!latitude || !longitude) {
      log('WARN', 'EMPLOYEE', 'Missing latitude or longitude', {
        requestId: req.requestId,
        directorId: director.id,
        employeeId,
        provided: { latitude: !!latitude, longitude: !!longitude }
      });
      return res.status(400).json({ error: 'Latitude and longitude are required' });
    }

    const employee = await prisma.user.findUnique({
      where: { id: employeeId }
    });

    if (!employee || employee.role !== 'EMPLOYEE') {
      log('WARN', 'EMPLOYEE', 'Employee not found', {
        requestId: req.requestId,
        directorId: director.id,
        employeeId
      });
      return res.status(404).json({ error: 'Employee not found' });
    }

    const checkInRequest = await prisma.checkInRequest.create({
      data: {
        userId: employee.id,
        status: 'COMPLETED'
      }
    });

    const locationCheck = await checkLocationInZones(latitude, longitude, employee.id);

    await prisma.checkInResult.create({
      data: {
        requestId: checkInRequest.id,
        locationLat: latitude,
        locationLon: longitude,
        isWithinZone: locationCheck.isWithinZone,
        distanceToZone: locationCheck.distanceToZone
      }
    });

    log('INFO', 'EMPLOYEE', 'Location added for employee', {
      requestId: req.requestId,
      directorId: director.id,
      employeeId: employee.id,
      employeeName: employee.name,
      checkInRequestId: checkInRequest.id,
      isWithinZone: locationCheck.isWithinZone,
      distanceToZone: locationCheck.distanceToZone
    });

    res.json({
      success: true,
      isWithinZone: locationCheck.isWithinZone,
      distanceToZone: locationCheck.distanceToZone,
      requestId: checkInRequest.id
    });
  } catch (error) {
    log('ERROR', 'EMPLOYEE', 'Error adding location for employee', {
      requestId: req.requestId,
      directorTelegramId: req.telegramUser?.id,
      employeeId: req.params.id,
      error: error.message,
      stack: error.stack
    });
    res.status(500).json({ error: error.message });
  }
});

// Health check
app.get('/health', (req, res) => {
  log('INFO', 'HEALTH', 'Health check', {
    requestId: req.requestId,
    timestamp: new Date().toISOString()
  });
  res.json({ status: 'ok' });
});

// SPA fallback route - serve index.html for all non-API routes
app.get('*', (req, res) => {
  // Skip API routes and static assets
  if (req.path.startsWith('/api/') || req.path.startsWith('/assets/')) {
    return res.status(404).json({ error: 'Not found' });
  }
  
  log('INFO', 'SPA', 'Serving index.html for SPA route', {
    requestId: req.requestId,
    path: req.path
  });
  
  res.sendFile(join(__dirname, '../client/dist/index.html'));
});

const WEB_APP_URL = process.env.WEB_APP_URL || `http://localhost:${PORT}`;

// Bot handlers
bot.start(async (ctx) => {
  const userId = String(ctx.from.id);
  
  log('INFO', 'BOT', 'Bot /start command received', {
    telegramId: userId,
    username: ctx.from.username
  });

  const user = await prisma.user.findUnique({
    where: { telegramId: userId }
  });

  if (!user) {
    log('INFO', 'BOT', 'New user started bot - not registered', {
      telegramId: userId
    });
    const message = await ctx.reply(
      '👋 Привет!\n\nДля использования бота необходимо зарегистрироваться через веб-приложение.\nНажмите кнопку ниже, чтобы открыть приложение и зарегистрироваться.',
      Markup.inlineKeyboard([
        [Markup.button.webApp('Открыть GeoCheck', WEB_APP_URL)]
      ])
    );
    await prisma.startMessage.upsert({
      where: { telegramId: userId },
      update: { messageId: message.message_id },
      create: { telegramId: userId, messageId: message.message_id }
    });
    return;
  }

  log('INFO', 'BOT', 'Registered user started bot', {
    telegramId: userId,
    userId: user.id,
    userName: user.name,
    role: user.role
  });

  await ctx.reply(
    `Привет, ${user.name}! 👋\n\n` +
    `Это бот для отслеживания геолокации сотрудников.\n` +
    `Нажмите кнопку ниже, чтобы открыть приложение.`,
    Markup.inlineKeyboard([
      [Markup.button.webApp('Открыть GeoCheck', WEB_APP_URL)]
    ])
  );
});

bot.command('admin', async (ctx) => {
  const args = ctx.message.text.split(' ');
  const password = args[1];
  const userId = String(ctx.from.id);

  log('INFO', 'BOT', 'Admin command received', {
    telegramId: userId,
    hasPassword: !!password
  });

  if (password !== ADMIN_PASSWORD) {
    log('WARN', 'BOT', 'Invalid admin password', {
      telegramId: userId
    });
    return ctx.reply('❌ Неверный пароль');
  }

  const user = await prisma.user.update({
    where: { telegramId: userId },
    data: { role: 'DIRECTOR' }
  });

  log('INFO', 'BOT', 'Admin role granted via command', {
    telegramId: userId,
    userId: user.id,
    userName: user.name
  });

  await ctx.reply('✅ Вы получили права директора!');
});

// Handle location (fallback for direct location send)
bot.on('location', async (ctx) => {
  const userId = String(ctx.from.id);
  const location = ctx.message.location;

  log('INFO', 'BOT', 'Location received via bot', {
    telegramId: userId,
    latitude: location.latitude,
    longitude: location.longitude
  });

  const user = await prisma.user.findUnique({
    where: { telegramId: userId }
  });

  if (!user) {
    log('WARN', 'BOT', 'User not found for location', {
      telegramId: userId
    });
    return ctx.reply('Пользователь не найден. Отправьте /start');
  }

  const pendingRequest = await prisma.checkInRequest.findFirst({
    where: {
      userId: user.id,
      status: 'PENDING'
    },
    orderBy: { requestedAt: 'desc' }
  });

  if (!pendingRequest) {
    log('WARN', 'BOT', 'No pending request for location', {
      telegramId: userId,
      userId: user.id
    });
    return ctx.reply('Нет активных запросов на проверку');
  }

  if (pendingRequest.expiresAt && new Date() > pendingRequest.expiresAt) {
    await prisma.checkInRequest.update({
      where: { id: pendingRequest.id },
      data: { status: 'MISSED' }
    });
    if (pendingRequest.telegramMessageId) {
      await clearCheckInButton(user.telegramId, pendingRequest.telegramMessageId, {
        telegramId: userId
      });
    }
    return ctx.reply('⏱ Время на отчет истекло. Запрос закрыт.');
  }

  const locationCheck = await checkLocationInZones(location.latitude, location.longitude, user.id);

  const existingResult = await prisma.checkInResult.findUnique({
    where: { requestId: pendingRequest.id }
  });

  if (existingResult) {
    await prisma.checkInResult.update({
      where: { id: existingResult.id },
      data: {
        locationLat: location.latitude,
        locationLon: location.longitude,
        isWithinZone: locationCheck.isWithinZone,
        distanceToZone: locationCheck.distanceToZone
      }
    });
  } else {
    await prisma.checkInResult.create({
      data: {
        requestId: pendingRequest.id,
        locationLat: location.latitude,
        locationLon: location.longitude,
        isWithinZone: locationCheck.isWithinZone,
        distanceToZone: locationCheck.distanceToZone
      }
    });
  }

  log('INFO', 'BOT', 'Location processed via bot', {
    telegramId: userId,
    userId: user.id,
    checkInRequestId: pendingRequest.id,
    isWithinZone: locationCheck.isWithinZone,
    distanceToZone: locationCheck.distanceToZone
  });

  await finalizeCheckInIfReady(pendingRequest.id);

  const status = locationCheck.isWithinZone ? '✅ Вы в рабочей зоне!' : '❌ Вы вне рабочей зоны';
  await ctx.reply(`${status}\nРасстояние до ближайшей зоны: ${Math.round(locationCheck.distanceToZone || 0)}м`);
});

// Handle photo (fallback for direct photo send)
bot.on('photo', async (ctx) => {
  const userId = String(ctx.from.id);
  const photo = ctx.message.photo[ctx.message.photo.length - 1];

  log('INFO', 'BOT', 'Photo received via bot', {
    telegramId: userId,
    photoFileId: photo.file_id
  });

  const user = await prisma.user.findUnique({
    where: { telegramId: userId }
  });

  if (!user) {
    log('WARN', 'BOT', 'User not found for photo', {
      telegramId: userId
    });
    return ctx.reply('Пользователь не найден. Отправьте /start');
  }

  const pendingRequest = await prisma.checkInRequest.findFirst({
    where: {
      userId: user.id,
      status: 'PENDING'
    },
    orderBy: { requestedAt: 'desc' }
  });

  if (pendingRequest) {
    if (pendingRequest.expiresAt && new Date() > pendingRequest.expiresAt) {
      await prisma.checkInRequest.update({
        where: { id: pendingRequest.id },
        data: { status: 'MISSED' }
      });
      if (pendingRequest.telegramMessageId) {
        await clearCheckInButton(user.telegramId, pendingRequest.telegramMessageId, {
          telegramId: userId
        });
      }
      await ctx.reply('⏱ Время на отчет истекло. Запрос закрыт.');
      return;
    }

    const result = await prisma.checkInResult.findUnique({
      where: { requestId: pendingRequest.id }
    });

    if (result) {
      await prisma.checkInResult.update({
        where: { id: result.id },
        data: { photoFileId: photo.file_id }
      });
      log('INFO', 'BOT', 'Photo added to existing result', {
        telegramId: userId,
        userId: user.id,
        checkInRequestId: pendingRequest.id,
        resultId: result.id
      });
    } else {
      await prisma.checkInResult.create({
        data: {
          requestId: pendingRequest.id,
          locationLat: 0,
          locationLon: 0,
          isWithinZone: false,
          photoFileId: photo.file_id
        }
      });
      log('INFO', 'BOT', 'Check-in result created with photo', {
        telegramId: userId,
        userId: user.id,
        checkInRequestId: pendingRequest.id
      });
    }
    await finalizeCheckInIfReady(pendingRequest.id);
    await ctx.reply('✅ Фото сохранено!');
  } else {
    log('WARN', 'BOT', 'No pending request for photo', {
      telegramId: userId,
      userId: user.id
    });
  }
});

// Cron job for randomized check-ins
cron.schedule('* * * * *', async () => {
  const now = getSchedulerNow();

  log('INFO', 'CRON', 'Random check-in scheduler tick', {
    timestamp: now.toISOString()
  });

  const employees = await prisma.user.findMany({
    where: {
      role: 'EMPLOYEE',
      checkInsEnabled: true
    },
    select: {
      id: true,
      telegramId: true,
      name: true,
        displayName: true,
      dailyCheckInTarget: true,
      workDays: true,
      workStartMinutes: true,
      workEndMinutes: true,
      nextCheckInAt: true
    }
  });

  if (employees.length === 0) {
    log('INFO', 'CRON', 'No employees with check-ins enabled found, skipping', {});
    return;
  }

  const employeeIds = employees.map((employee) => employee.id);
  const pendingRequests = await prisma.checkInRequest.findMany({
    where: {
      userId: { in: employeeIds },
      status: 'PENDING'
    },
    select: { userId: true }
  });
  const pendingUserIds = new Set(pendingRequests.map((request) => request.userId));

  const directors = await prisma.user.findMany({
    where: { role: 'DIRECTOR' }
  });

  const defaultDeadlineMinutes = Number.isInteger(directors[0]?.reportDeadlineMinutes)
    ? directors[0].reportDeadlineMinutes
    : 5;

  const nowUtc = toUtcDate(now);
  for (const employee of employees) {
    const workDays = parseWorkDays(employee.workDays);
    const normalized = normalizeWorkWindow(employee.workStartMinutes, employee.workEndMinutes);
    let nextCheckInAt = employee.nextCheckInAt
      ? toLocalDate(new Date(employee.nextCheckInAt))
      : null;

    if (!nextCheckInAt || Number.isNaN(nextCheckInAt.getTime())) {
      if (isWithinWorkWindow(now, workDays, normalized.startMinutes, normalized.endMinutes)) {
        const quickMinutes = randomInt(5, 15);
        nextCheckInAt = new Date(now.getTime() + quickMinutes * 60 * 1000);
        nextCheckInAt.setSeconds(randomInt(5, 55), 0);
      } else {
        nextCheckInAt = calculateNextCheckInAt(now, workDays, normalized.startMinutes, normalized.endMinutes);
      }
    } else if (!isWithinWorkWindow(nextCheckInAt, workDays, normalized.startMinutes, normalized.endMinutes)) {
      nextCheckInAt = calculateNextCheckInAt(now, workDays, normalized.startMinutes, normalized.endMinutes);
    }

    if (!nextCheckInAt) {
      continue;
    }

    const scheduleItem = await prisma.checkInSchedule.findFirst({
      where: {
        userId: employee.id,
        status: 'PENDING',
        scheduledAt: { lte: nowUtc }
      },
      orderBy: { scheduledAt: 'asc' }
    });

    const scheduledDue = scheduleItem
      ? toLocalDate(new Date(scheduleItem.scheduledAt))
      : null;

    const shouldTrigger = scheduledDue
      ? scheduledDue <= now
      : nextCheckInAt <= now;

    if (shouldTrigger) {
      if (pendingUserIds.has(employee.id)) {
        const rescheduled = calculateNextCheckInAt(now, workDays, normalized.startMinutes, normalized.endMinutes);
        await prisma.user.update({
          where: { id: employee.id },
          data: { nextCheckInAt: toUtcDate(rescheduled) }
        });
        if (scheduleItem) {
          await prisma.checkInSchedule.update({
            where: { id: scheduleItem.id },
            data: { status: 'SKIPPED' }
          });
        }
        continue;
      }

      const employeeLabel = employee.displayName || employee.name;
      log('INFO', 'CRON', 'Triggering randomized check-in', {
        employeeId: employee.id,
        employeeName: employeeLabel,
        scheduledAt: nextCheckInAt.toISOString()
      });

      const checkInRequest = await prisma.checkInRequest.create({
        data: {
          userId: employee.id,
          status: 'PENDING',
          expiresAt: new Date(Date.now() + defaultDeadlineMinutes * 60 * 1000)
        }
      });

      const checkInUrl = `${WEB_APP_URL}/check-in?requestId=${checkInRequest.id}`;
      try {
        const sentMessage = await bot.telegram.sendMessage(
          employee.telegramId,
          `📍 Проверка местоположения!\n\nПожалуйста, отправьте ваше текущее местоположение и фото.\n⏱ На сдачу отчета есть ${defaultDeadlineMinutes} мин.`,
          Markup.inlineKeyboard([
            [Markup.button.webApp('Открыть интерфейс проверки', checkInUrl)]
          ])
        );
        await prisma.checkInRequest.update({
          where: { id: checkInRequest.id },
          data: { telegramMessageId: sentMessage.message_id }
        });
        log('INFO', 'CRON', 'Check-in notification sent to employee', {
          employeeId: employee.id,
          checkInRequestId: checkInRequest.id
        });
      } catch (error) {
        log('ERROR', 'CRON', 'Error sending check-in notification', {
          employeeId: employee.id,
          employeeTelegramId: employee.telegramId,
          error: error.message,
          stack: error.stack
        });
      }

      for (const director of directors) {
        try {
          await bot.telegram.sendMessage(
            director.telegramId,
            `🔔 Запрос на проверку отправлен сотруднику ${employeeLabel}`
          );
          log('INFO', 'CRON', 'Director notified about check-in', {
            directorId: director.id,
            directorTelegramId: director.telegramId,
            employeeName: employeeLabel
          });
        } catch (error) {
          log('ERROR', 'CRON', 'Error notifying director', {
            directorId: director.id,
            directorTelegramId: director.telegramId,
            error: error.message
          });
        }
      }

      const rescheduled = calculateNextCheckInAt(now, workDays, normalized.startMinutes, normalized.endMinutes);
      await prisma.user.update({
        where: { id: employee.id },
        data: { nextCheckInAt: toUtcDate(rescheduled) }
      });

      if (scheduleItem) {
        await prisma.checkInSchedule.update({
          where: { id: scheduleItem.id },
          data: { status: 'SENT' }
        });
      }

      log('INFO', 'CRON', 'Random check-in completed', {
        employeeId: employee.id,
        checkInRequestId: checkInRequest.id
      });
    } else if (!employee.nextCheckInAt || employee.nextCheckInAt.getTime() !== toUtcDate(nextCheckInAt).getTime()) {
      await prisma.user.update({
        where: { id: employee.id },
        data: { nextCheckInAt: toUtcDate(nextCheckInAt) }
      });
    }
  }
});

// Daily schedule generation (defaults to 2:00 MSK)
cron.schedule(DAILY_SCHEDULE_CRON, async () => {
  try {
    const now = getSchedulerNow();
    const todayLocal = startOfLocalDay(now);
    const todayUtcStart = toUtcDate(todayLocal);
    const todayUtcEnd = toUtcDate(endOfLocalDay(now));

    const employees = await prisma.user.findMany({
      where: {
        role: 'EMPLOYEE',
        checkInsEnabled: true
      },
      select: {
        id: true,
        workDays: true,
        workStartMinutes: true,
        workEndMinutes: true,
        dailyCheckInTarget: true,
        dailyCheckInTargetPending: true,
        dailyCheckInTargetPendingFrom: true
      }
    });

    if (employees.length === 0) {
      return;
    }

    for (const employee of employees) {
      const pendingTarget = Number.isInteger(employee.dailyCheckInTargetPending)
        ? employee.dailyCheckInTargetPending
        : null;
      const pendingFromLocal = employee.dailyCheckInTargetPendingFrom
        ? toLocalDate(new Date(employee.dailyCheckInTargetPendingFrom))
        : null;
      const shouldApplyPending = pendingTarget !== null
        && pendingFromLocal
        && pendingFromLocal <= todayLocal;

      if (shouldApplyPending) {
        await prisma.user.update({
          where: { id: employee.id },
          data: {
            dailyCheckInTarget: pendingTarget,
            dailyCheckInTargetPending: null,
            dailyCheckInTargetPendingFrom: null
          }
        });
      }

      const effectiveDailyTarget = shouldApplyPending
        ? pendingTarget
        : employee.dailyCheckInTarget;
      const workDays = parseWorkDays(employee.workDays);
      if (!isWorkingDay(todayLocal, workDays)) {
        continue;
      }

      const existingCount = await prisma.checkInSchedule.count({
        where: {
          userId: employee.id,
          scheduledAt: {
            gte: todayUtcStart,
            lte: todayUtcEnd
          }
        }
      });

      if (existingCount > 0) {
        continue;
      }

      const times = generateRandomScheduleTimes(
        todayLocal,
        effectiveDailyTarget ?? 8,
        employee.workStartMinutes,
        employee.workEndMinutes
      );

      if (times.length === 0) {
        continue;
      }

      await prisma.checkInSchedule.createMany({
        data: times.map((time) => ({
          userId: employee.id,
          scheduledAt: toUtcDate(time)
        }))
      });
    }
  } catch (error) {
    log('ERROR', 'CRON', 'Error generating daily schedules', {
      error: error.message
    });
  }
});

// Cleanup broken photos (daily)
cron.schedule('15 4 * * *', async () => {
  try {
    log('INFO', 'CRON', 'Starting broken photo cleanup');
    const { cleanupPhotos } = await import('./s3Service.js');
    const result = await cleanupPhotos({ minSizeBytes: 1024 });
    log('INFO', 'CRON', 'Broken photo cleanup finished', result);
  } catch (error) {
    log('ERROR', 'CRON', 'Broken photo cleanup failed', { error: error.message });
  }
});

// Cleanup photos older than 6 months (runs twice a year on Jan 1 and Jul 1)
cron.schedule('0 5 1 1,7 *', async () => {
  try {
    log('INFO', 'CRON', 'Starting old photo cleanup');
    const { cleanupPhotos } = await import('./s3Service.js');
    const result = await cleanupPhotos({ olderThanDays: 182 });
    log('INFO', 'CRON', 'Old photo cleanup finished', result);
  } catch (error) {
    log('ERROR', 'CRON', 'Old photo cleanup failed', { error: error.message });
  }
});

// Mark expired check-ins as missed (every minute)
cron.schedule('* * * * *', async () => {
  try {
    const now = new Date();
    const expired = await prisma.checkInRequest.findMany({
      where: {
        status: 'PENDING',
        expiresAt: { lt: now }
      },
      select: { id: true, userId: true, telegramMessageId: true }
    });

    if (expired.length === 0) {
      return;
    }

    await prisma.checkInRequest.updateMany({
      where: { id: { in: expired.map((item) => item.id) } },
      data: { status: 'MISSED' }
    });

    for (const item of expired) {
      if (item.telegramMessageId) {
        try {
          const user = await prisma.user.findUnique({
            where: { id: item.userId },
            select: { telegramId: true }
          });
          if (user?.telegramId) {
            await clearCheckInButton(user.telegramId, item.telegramMessageId, {
              checkInRequestId: item.id
            });
          }
        } catch (error) {
          log('WARN', 'CHECKIN', 'Failed to clear expired check-in button', {
            checkInRequestId: item.id,
            telegramMessageId: item.telegramMessageId,
            error: error.message
          });
        }
      }
    }

    log('INFO', 'CRON', 'Expired check-ins marked as missed', { count: expired.length });
  } catch (error) {
    log('ERROR', 'CRON', 'Failed to mark expired check-ins', { error: error.message });
  }
});

// Cron job for cleaning up old photos (older than 6 months)
cron.schedule('0 2 * * *', async () => {
  try {
    log('INFO', 'CRON', 'Photo cleanup cron job started', {});
    
    const sixMonthsAgo = new Date();
    sixMonthsAgo.setMonth(sixMonthsAgo.getMonth() - 6);
    
    const oldResults = await prisma.checkInResult.findMany({
      where: {
        timestamp: {
          lt: sixMonthsAgo
        },
        photoPath: {
          not: null
        }
      },
      select: {
        id: true,
        photoPath: true,
        requestId: true
      }
    });

    if (oldResults.length === 0) {
      log('INFO', 'CRON', 'No old photos to clean up', {});
      return;
    }

    log('INFO', 'CRON', 'Found old photos to delete', {
      count: oldResults.length,
      cutoffDate: sixMonthsAgo.toISOString()
    });

    let deletedCount = 0;
    let errorCount = 0;

    for (const result of oldResults) {
      try {
        const fileName = result.photoPath.startsWith('photos/') 
          ? result.photoPath.substring(7) 
          : result.photoPath;
        
        await deletePhoto(fileName);
        
        await prisma.checkInResult.update({
          where: { id: result.id },
          data: {
            photoPath: null,
            photoUrl: null
          }
        });
        
        deletedCount++;
      } catch (error) {
        log('ERROR', 'CRON', 'Error deleting photo', {
          resultId: result.id,
          photoPath: result.photoPath,
          error: error.message
        });
        errorCount++;
      }
    }

    log('INFO', 'CRON', 'Photo cleanup completed', {
      totalFound: oldResults.length,
      deletedCount,
      errorCount
    });
  } catch (error) {
    log('ERROR', 'CRON', 'Error in photo cleanup cron job', {
      error: error.message,
      stack: error.stack
    });
  }
});

// Start server
app.listen(PORT, () => {
  log('INFO', 'STARTUP', 'Server started', {
    port: PORT,
    nodeEnv: process.env.NODE_ENV || 'production',
    webAppUrl: WEB_APP_URL
  });
});

// Start bot with database connection check
async function startBot() {
  log('INFO', 'STARTUP', 'Starting bot initialization', {});
  
  const migrationsOk = await runMigrations();
  if (!migrationsOk) {
    log('ERROR', 'STARTUP', 'Failed to run database migrations');
    log('WARN', 'STARTUP', 'Application will continue, but database operations may fail');
  } else {
    await ensureSchema();
  }

  if (process.env.YC_S3_BUCKET) {
    log('INFO', 'STARTUP', 'Testing S3 connection', {});
    await testS3Connection();
  } else {
    log('WARN', 'STARTUP', 'S3 not configured', {});
  }

  try {
    await bot.launch();
    botRunning = true;
    log('INFO', 'STARTUP', 'Bot started successfully', {});
  } catch (error) {
    if (error.response?.error_code === 409 || error.code === 409) {
      log('WARN', 'STARTUP', 'Bot conflict detected (409), retrying', {
        error: error.message
      });
      await new Promise(resolve => setTimeout(resolve, 5000));
      try {
        await bot.launch();
        botRunning = true;
        log('INFO', 'STARTUP', 'Bot started successfully after retry', {});
      } catch (retryError) {
        log('ERROR', 'STARTUP', 'Error starting bot after retry', {
          error: retryError.message,
          stack: retryError.stack
        });
        log('WARN', 'STARTUP', 'Application will continue without bot');
      }
    } else {
      log('ERROR', 'STARTUP', 'Error starting bot', {
        error: error.message,
        stack: error.stack
      });
      log('WARN', 'STARTUP', 'Application will continue without bot');
    }
  }
}

startBot();

// Graceful shutdown
process.once('SIGINT', async () => {
  log('INFO', 'SHUTDOWN', 'Received SIGINT, shutting down gracefully', {});
  if (botRunning) {
    await bot.stop('SIGINT');
  }
  await prisma.$disconnect();
  process.exit(0);
});

process.once('SIGTERM', async () => {
  log('INFO', 'SHUTDOWN', 'Received SIGTERM, shutting down gracefully', {});
  if (botRunning) {
    await bot.stop('SIGTERM');
  }
  await prisma.$disconnect();
  process.exit(0);
});
