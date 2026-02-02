import express from 'express';
import { Telegraf, Markup } from 'telegraf';
import cron from 'node-cron';
import cors from 'cors';
import dotenv from 'dotenv';
import { PrismaClient } from '@prisma/client';
import crypto from 'crypto';
import multer from 'multer';
import fs from 'fs';
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
const PORT = process.env.PORT || 3000;

if (!BOT_TOKEN) {
  log('ERROR', 'STARTUP', 'BOT_TOKEN is required!');
  process.exit(1);
}

const bot = new Telegraf(BOT_TOKEN);

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
                   req.headers['X-TELEGRAM-INIT-DATA'];
  
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
    const role = userCount === 0 ? 'DIRECTOR' : 'EMPLOYEE';
    
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

    if (!user) {
      log('WARN', 'USER', 'User not found', {
        requestId: req.requestId,
        telegramId: id
      });
      return res.status(404).json({ error: 'User not registered. Please register first.' });
    }

    user = await prisma.user.update({
      where: { telegramId: String(id) },
      data: { name }
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

    const user = await prisma.user.findUnique({
      where: { telegramId: String(id) },
      select: { role: true }
    });

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
        checkInsEnabled: true,
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
        checkInsEnabled: !employee.checkInsEnabled
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

    // Delete employee (cascade will handle related records)
    await prisma.user.delete({
      where: { id: employeeId }
    });

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
              select: { id: true, name: true, telegramId: true }
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
    const { name, latitude, longitude, radius, employeeIds } = req.body;

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
              select: { id: true, name: true, telegramId: true }
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
              select: { id: true, name: true, telegramId: true }
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
    const { latitude, longitude } = req.body;

    log('INFO', 'CHECKIN', 'Submit location for check-in', {
      requestId: req.requestId,
      telegramId: id,
      latitude,
      longitude
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

    const locationCheck = await checkLocationInZones(latitude, longitude, user.id);

    await prisma.checkInRequest.update({
      where: { id: pendingRequest.id },
      data: { status: 'COMPLETED' }
    });

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

// Submit photo for check-in
app.post('/api/check-in/photo', verifyTelegramWebApp, upload.single('photo'), async (req, res) => {
  try {
    const { id } = req.telegramUser;

    log('INFO', 'CHECKIN', 'Submit photo for check-in', {
      requestId: req.requestId,
      telegramId: id,
      hasFile: !!req.file
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
      log('WARN', 'CHECKIN', 'No pending check-in request for photo', {
        requestId: req.requestId,
        userId: user.id
      });
      return res.status(404).json({ error: 'No pending check-in request' });
    }

    let photoFileId = null;
    let photoPath = null;
    let photoUrl = null;

    // Если файл загружен через multer, сохраняем его в S3
    if (req.file) {
      try {
        const { uploadPhoto } = await import('./s3Service.js');
        const fileName = `check-in-${pendingRequest.id}-${Date.now()}.jpg`;
        photoPath = `photos/${fileName}`;
        photoUrl = await uploadPhoto(req.file.path, photoPath);
        
        // Удаляем временный файл
        fs.unlinkSync(req.file.path);
        
        log('INFO', 'CHECKIN', 'Photo uploaded to S3', {
          requestId: req.requestId,
          userId: user.id,
          checkInRequestId: pendingRequest.id,
          photoPath
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
              select: { name: true }
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
      try {
        const photoUrl = await getPhotoUrl(result.photoPath, 3600);
        log('INFO', 'CHECKIN', 'Photo URL retrieved from S3', {
          requestId: req.requestId,
          checkInRequestId: requestId,
          employeeName: result.request.user.name
        });
        return res.json({ 
          url: photoUrl,
          requestId: result.requestId,
          employeeName: result.request.user.name
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
      log('INFO', 'CHECKIN', 'Photo file ID returned (legacy format)', {
        requestId: req.requestId,
        checkInRequestId: requestId,
        employeeName: result.request.user.name
      });
      return res.json({ 
        fileId: result.photoFileId,
        requestId: result.requestId,
        employeeName: result.request.user.name,
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
      if (startDate) where.requestedAt.gte = new Date(startDate);
      if (endDate) where.requestedAt.lte = new Date(endDate);
    }

    const checkIns = await prisma.checkInRequest.findMany({
      where,
      include: {
        user: {
          select: { name: true, telegramId: true }
        },
        result: true
      },
      orderBy: { requestedAt: 'desc' },
      take: 100
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

    const checkInRequest = await prisma.checkInRequest.create({
      data: {
        userId: employee.id,
        status: 'PENDING'
      }
    });

    log('INFO', 'CHECKIN', 'Check-in request created', {
      requestId: req.requestId,
      directorId: director.id,
      employeeId: employee.id,
      employeeName: employee.name,
      checkInRequestId: checkInRequest.id
    });

    const checkInUrl = `${WEB_APP_URL}/check-in?requestId=${checkInRequest.id}`;
    try {
      await bot.telegram.sendMessage(
        employee.telegramId,
        '📍 Проверка местоположения!\\n\\nПожалуйста, отправьте ваше текущее местоположение и фото.',
        Markup.inlineKeyboard([
          [Markup.button.webApp('Открыть интерфейс проверки', checkInUrl)]
        ])
      );
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
    const keyboard = Markup.keyboard([
      [Markup.button.webApp('Открыть GeoCheck', WEB_APP_URL)]
    ]).resize();
    
    await ctx.reply(
      '👋 Привет!\\n\\nДля использования бота необходимо зарегистрироваться через веб-приложение.\\nНажмите кнопку ниже, чтобы открыть приложение и зарегистрироваться.',
      keyboard
    );
    return;
  }

  log('INFO', 'BOT', 'Registered user started bot', {
    telegramId: userId,
    userId: user.id,
    userName: user.name,
    role: user.role
  });

  const keyboard = Markup.keyboard([
    [Markup.button.webApp('Открыть GeoCheck', WEB_APP_URL)]
  ]).resize();

  await ctx.reply(
    `Привет, ${user.name}! 👋\\n\\n` +
    `Это бот для отслеживания геолокации сотрудников.\\n` +
    `Нажмите кнопку ниже, чтобы открыть приложение.`,
    keyboard
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

  const locationCheck = await checkLocationInZones(location.latitude, location.longitude, user.id);

  await prisma.checkInRequest.update({
    where: { id: pendingRequest.id },
    data: { status: 'COMPLETED' }
  });

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

  const status = locationCheck.isWithinZone ? '✅ Вы в рабочей зоне!' : '❌ Вы вне рабочей зоны';
  await ctx.reply(`${status}\\nРасстояние до ближайшей зоны: ${Math.round(locationCheck.distanceToZone || 0)}м`);
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
    await ctx.reply('✅ Фото сохранено!');
  } else {
    log('WARN', 'BOT', 'No pending request for photo', {
      telegramId: userId,
      userId: user.id
    });
  }
});

// Cron job for random check-ins
cron.schedule('*/30 * * * *', async () => {
  const now = new Date();
  const hour = now.getHours();

  log('INFO', 'CRON', 'Random check-in cron job started', {
    hour,
    isWorkingHours: hour >= 9 && hour < 18
  });

  if (hour < 9 || hour >= 18) {
    log('INFO', 'CRON', 'Outside working hours, skipping', { hour });
    return;
  }

  // Only get employees with check-ins enabled
  const employees = await prisma.user.findMany({
    where: { 
      role: 'EMPLOYEE',
      checkInsEnabled: true
    }
  });

  if (employees.length === 0) {
    log('INFO', 'CRON', 'No employees with check-ins enabled found, skipping', {});
    return;
  }

  log('INFO', 'CRON', 'Found employees for check-in', {
    totalEmployees: employees.length
  });

  const twoHoursAgo = new Date(now.getTime() - 2 * 60 * 60 * 1000);
  const recentCheckIns = await prisma.checkInRequest.findMany({
    where: {
      requestedAt: { gte: twoHoursAgo },
      status: 'COMPLETED'
    },
    select: { userId: true }
  });

  const recentUserIds = new Set(recentCheckIns.map(c => c.userId));
  const availableEmployees = employees.filter(e => !recentUserIds.has(e.id));

  log('INFO', 'CRON', 'Filtered available employees', {
    totalEmployees: employees.length,
    recentCheckIns: recentCheckIns.length,
    availableEmployees: availableEmployees.length
  });

  if (availableEmployees.length === 0) {
    log('INFO', 'CRON', 'No available employees, skipping', {});
    return;
  }

  const randomEmployee = availableEmployees[Math.floor(Math.random() * availableEmployees.length)];

  log('INFO', 'CRON', 'Selected random employee for check-in', {
    employeeId: randomEmployee.id,
    employeeName: randomEmployee.name,
    employeeTelegramId: randomEmployee.telegramId
  });

  const checkInRequest = await prisma.checkInRequest.create({
    data: {
      userId: randomEmployee.id,
      status: 'PENDING'
    }
  });

  const checkInUrl = `${WEB_APP_URL}/check-in?requestId=${checkInRequest.id}`;
  try {
    await bot.telegram.sendMessage(
      randomEmployee.telegramId,
      '📍 Проверка местоположения!\\n\\nПожалуйста, отправьте ваше текущее местоположение и фото.',
      Markup.inlineKeyboard([
        [Markup.button.webApp('Открыть интерфейс проверки', checkInUrl)]
      ])
    );
    log('INFO', 'CRON', 'Check-in notification sent to employee', {
      employeeId: randomEmployee.id,
      checkInRequestId: checkInRequest.id
    });
  } catch (error) {
    log('ERROR', 'CRON', 'Error sending check-in notification', {
      employeeId: randomEmployee.id,
      employeeTelegramId: randomEmployee.telegramId,
      error: error.message,
      stack: error.stack
    });
  }

  const directors = await prisma.user.findMany({
    where: { role: 'DIRECTOR' }
  });

  for (const director of directors) {
    try {
      await bot.telegram.sendMessage(
        director.telegramId,
        `🔔 Запрос на проверку отправлен сотруднику ${randomEmployee.name}`
      );
      log('INFO', 'CRON', 'Director notified about check-in', {
        directorId: director.id,
        directorTelegramId: director.telegramId,
        employeeName: randomEmployee.name
      });
    } catch (error) {
      log('ERROR', 'CRON', 'Error notifying director', {
        directorId: director.id,
        directorTelegramId: director.telegramId,
        error: error.message
      });
    }
  }

  log('INFO', 'CRON', 'Random check-in cron job completed', {
    employeeId: randomEmployee.id,
    checkInRequestId: checkInRequest.id
  });
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
