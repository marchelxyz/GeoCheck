import express from 'express';
import { Telegraf, Markup } from 'telegraf';
import cron from 'node-cron';
import cors from 'cors';
import dotenv from 'dotenv';
import { PrismaClient } from '@prisma/client';
import crypto from 'crypto';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

dotenv.config();

const app = express();
const prisma = new PrismaClient();


// Run database migrations
// Run database migrations using prisma db push
// Run database migrations using prisma db push
async function runMigrations(maxRetries = 10, delay = 3000) {
  // Сначала проверяем подключение к БД с retry логикой (как в mariko_vld)
  console.log("🔄 Checking database connection before applying schema...");
  let dbConnected = false;
  const maxConnectionAttempts = 10;
  
  for (let attempt = 1; attempt <= maxConnectionAttempts; attempt++) {
    try {
      // Используем prisma.$queryRaw для проверки подключения (аналог SELECT 1 из mariko_vld)
      await prisma.$queryRaw`SELECT 1`;
      dbConnected = true;
      console.log("✅ Database connection established");
      break;
    } catch (error) {
      const isLastAttempt = attempt === maxConnectionAttempts;
      const errorInfo = {
        code: error.code || "UNKNOWN",
        message: error.message,
      };
      
      if (isLastAttempt) {
        console.error("❌ Ошибка подключения к БД после всех попыток:");
        console.error("Код ошибки:", errorInfo.code);
        console.error("Сообщение:", errorInfo.message);
        console.error("Полная ошибка:", error);
        return false;
      } else {
        // Экспоненциальная задержка как в mariko_vld: 2, 4, 6 секунд...
        const waitTime = attempt * 2000;
        console.warn(`⚠️  Попытка ${attempt} не удалась. Повтор через ${waitTime}мс...`);
        console.warn("Ошибка:", errorInfo.message);
        await new Promise((resolve) => setTimeout(resolve, waitTime));
      }
    }
  }
  
  if (!dbConnected) {
    console.error("❌ Failed to connect to database. Cannot apply schema.");
    return false;
  }
  
  // Теперь применяем схему
  const { spawn } = await import('child_process');
  
  for (let i = 0; i < maxRetries; i++) {
    try {
      const result = await new Promise((resolve) => {
        console.log(`🔄 Applying database schema (attempt ${i + 1}/${maxRetries})...`);
        const process = spawn('npx', ['prisma', 'db', 'push', '--schema=../prisma/schema.prisma', '--accept-data-loss'], {
          stdio: 'inherit',
          cwd: '/app/server',
          shell: true
        });
        
        process.on('close', (code) => {
          if (code === 0) {
            console.log("✅ Database schema applied successfully");
            resolve(true);
          } else {
            console.error(`❌ Schema application attempt ${i + 1}/${maxRetries} failed with code ${code}`);
            resolve(false);
          }
        });
        
        process.on('error', (error) => {
          console.error(`❌ Error applying schema (attempt ${i + 1}/${maxRetries}):`, error.message);
          resolve(false);
        });
      });
      
      if (result) {
        return true;
      }
      
      if (i < maxRetries - 1) {
        console.log(`⏳ Retrying schema application in ${delay}ms...`);
        await new Promise(resolve => setTimeout(resolve, delay));
      }
    } catch (error) {
      console.error(`❌ Error in migration attempt ${i + 1}/${maxRetries}:`, error.message);
      if (i < maxRetries - 1) {
        console.log(`⏳ Retrying schema application in ${delay}ms...`);
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
  console.error('BOT_TOKEN is required!');
  process.exit(1);
}

const bot = new Telegraf(BOT_TOKEN);

// Track if bot is running
let botRunning = false;

// Middleware
app.use(cors());
app.use(express.json());
app.use(express.static(join(__dirname, '../client/dist')));

// Verify Telegram Web App data
function verifyTelegramWebAppData(initData) {
  try {
    const urlParams = new URLSearchParams(initData);
    const hash = urlParams.get('hash');
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
    
    return calculatedHash === hash;
  } catch (error) {
    console.error('Error verifying Telegram data:', error);
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
  const initData = req.headers['x-telegram-init-data'];
  if (!initData) {
    return res.status(401).json({ error: 'Missing Telegram init data' });
  }
  
  if (!verifyTelegramWebAppData(initData)) {
    return res.status(401).json({ error: 'Invalid Telegram init data' });
  }
  
  const user = parseInitData(initData);
  if (!user) {
    return res.status(401).json({ error: 'Invalid user data' });
  }
  
  req.telegramUser = user;
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

// Check if location is within any zone
async function checkLocationInZones(lat, lon) {
  const zones = await prisma.zone.findMany();
  
  for (const zone of zones) {
    const distance = calculateDistance(lat, lon, zone.latitude, zone.longitude);
    if (distance <= zone.radius) {
      return { isWithinZone: true, distanceToZone: distance, zoneId: zone.id };
    }
  }
  
  // Find closest zone
  const distances = zones.map(zone => ({
    zone,
    distance: calculateDistance(lat, lon, zone.latitude, zone.longitude)
  }));
  
  const closest = distances.reduce((min, current) => 
    current.distance < min.distance ? current : min
  , distances[0] || { distance: Infinity });
  
  return { 
    isWithinZone: false, 
    distanceToZone: closest.distance || null,
    zoneId: null
  };
}

// API Routes

// Get or create user
app.post('/api/user', verifyTelegramWebApp, async (req, res) => {
  try {
    const { id, first_name, last_name, username } = req.telegramUser;
    const name = `${first_name || ''} ${last_name || ''}`.trim() || username || `User ${id}`;
    
    let user = await prisma.user.findUnique({
      where: { telegramId: String(id) }
    });
    
    if (!user) {
      // First user becomes director
      const userCount = await prisma.user.count();
      user = await prisma.user.create({
        data: {
          telegramId: String(id),
          name,
          role: userCount === 0 ? 'DIRECTOR' : 'EMPLOYEE'
        }
      });
    } else {
      user = await prisma.user.update({
        where: { telegramId: String(id) },
        data: { name }
      });
    }
    
    res.json(user);
  } catch (error) {
    console.error('Error in /api/user:', error);
    res.status(500).json({ error: error.message });
  }
});

// Get user role
app.get('/api/user/role', verifyTelegramWebApp, async (req, res) => {
  try {
    const { id } = req.telegramUser;
    const user = await prisma.user.findUnique({
      where: { telegramId: String(id) },
      select: { role: true }
    });
    
    if (!user) {
      return res.status(404).json({ error: 'User not found' });
    }
    
    res.json({ role: user.role });
  } catch (error) {
    console.error('Error in /api/user/role:', error);
    res.status(500).json({ error: error.message });
  }
});

// Admin command to claim director role
app.post('/api/admin/claim', verifyTelegramWebApp, async (req, res) => {
  try {
    const { password } = req.body;
    const { id } = req.telegramUser;
    
    if (password !== ADMIN_PASSWORD) {
      return res.status(401).json({ error: 'Invalid password' });
    }
    
    const user = await prisma.user.update({
      where: { telegramId: String(id) },
      data: { role: 'DIRECTOR' }
    });
    
    res.json(user);
  } catch (error) {
    console.error('Error in /api/admin/claim:', error);
    res.status(500).json({ error: error.message });
  }
});

// Zones CRUD
app.get('/api/zones', verifyTelegramWebApp, async (req, res) => {
  try {
    const { id } = req.telegramUser;
    const user = await prisma.user.findUnique({
      where: { telegramId: String(id) }
    });
    
    if (!user || user.role !== 'DIRECTOR') {
      return res.status(403).json({ error: 'Access denied' });
    }
    
    const zones = await prisma.zone.findMany({
      include: {
        createdByUser: {
          select: { name: true }
        }
      },
      orderBy: { createdAt: 'desc' }
    });
    
    res.json(zones);
  } catch (error) {
    console.error('Error in /api/zones:', error);
    res.status(500).json({ error: error.message });
  }
});

app.post('/api/zones', verifyTelegramWebApp, async (req, res) => {
  try {
    const { id } = req.telegramUser;
    const { name, latitude, longitude, radius } = req.body;
    
    const user = await prisma.user.findUnique({
      where: { telegramId: String(id) }
    });
    
    if (!user || user.role !== 'DIRECTOR') {
      return res.status(403).json({ error: 'Access denied' });
    }
    
    if (!name || latitude === undefined || longitude === undefined || !radius) {
      return res.status(400).json({ error: 'Missing required fields' });
    }
    
    const zone = await prisma.zone.create({
      data: {
        name,
        latitude: parseFloat(latitude),
        longitude: parseFloat(longitude),
        radius: parseFloat(radius),
        createdBy: user.id
      }
    });
    
    res.json(zone);
  } catch (error) {
    console.error('Error in /api/zones POST:', error);
    res.status(500).json({ error: error.message });
  }
});

app.delete('/api/zones/:id', verifyTelegramWebApp, async (req, res) => {
  try {
    const { id: userId } = req.telegramUser;
    const { id: zoneId } = req.params;
    
    const user = await prisma.user.findUnique({
      where: { telegramId: String(userId) }
    });
    
    if (!user || user.role !== 'DIRECTOR') {
      return res.status(403).json({ error: 'Access denied' });
    }
    
    await prisma.zone.delete({
      where: { id: zoneId }
    });
    
    res.json({ success: true });
  } catch (error) {
    console.error('Error in /api/zones DELETE:', error);
    res.status(500).json({ error: error.message });
  }
});

// Get check-in results (Director dashboard)
app.get('/api/check-ins', verifyTelegramWebApp, async (req, res) => {
  try {
    const { id } = req.telegramUser;
    const user = await prisma.user.findUnique({
      where: { telegramId: String(id) }
    });
    
    if (!user || user.role !== 'DIRECTOR') {
      return res.status(403).json({ error: 'Access denied' });
    }
    
    const { status, startDate, endDate } = req.query;
    
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
    
    res.json(checkIns);
  } catch (error) {
    console.error('Error in /api/check-ins:', error);
    res.status(500).json({ error: error.message });
  }
});

// Health check
app.get('/health', (req, res) => {
  res.json({ status: 'ok' });
});

const WEB_APP_URL = process.env.WEB_APP_URL || `http://localhost:${PORT}`;

// Bot handlers
bot.start(async (ctx) => {
  const userId = String(ctx.from.id);
  
  // Get or create user
  let user = await prisma.user.findUnique({
    where: { telegramId: userId }
  });
  
  if (!user) {
    const userCount = await prisma.user.count();
    user = await prisma.user.create({
      data: {
        telegramId: userId,
        name: `${ctx.from.first_name || ''} ${ctx.from.last_name || ''}`.trim() || ctx.from.username || `User ${userId}`,
        role: userCount === 0 ? 'DIRECTOR' : 'EMPLOYEE'
      }
    });
  }
  
  const keyboard = Markup.keyboard([
    [Markup.button.webApp('Открыть GeoCheck', WEB_APP_URL)]
  ]).resize();
  
  await ctx.reply(
    `Привет, ${user.name}! 👋\n\n` +
    `Это бот для отслеживания геолокации сотрудников.\n` +
    `Нажмите кнопку ниже, чтобы открыть приложение.`,
    keyboard
  );
});

bot.command('admin', async (ctx) => {
  const args = ctx.message.text.split(' ');
  const password = args[1];
  
  if (password !== ADMIN_PASSWORD) {
    return ctx.reply('❌ Неверный пароль');
  }
  
  const userId = String(ctx.from.id);
  const user = await prisma.user.update({
    where: { telegramId: userId },
    data: { role: 'DIRECTOR' }
  });
  
  await ctx.reply('✅ Вы получили права директора!');
});

// Handle location
bot.on('location', async (ctx) => {
  const userId = String(ctx.from.id);
  const location = ctx.message.location;
  
  // Find pending check-in request
  const user = await prisma.user.findUnique({
    where: { telegramId: userId }
  });
  
  if (!user) {
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
    return ctx.reply('Нет активных запросов на проверку');
  }
  
  // Check location
  const locationCheck = await checkLocationInZones(location.latitude, location.longitude);
  
  // Update request status
  await prisma.checkInRequest.update({
    where: { id: pendingRequest.id },
    data: { status: 'COMPLETED' }
  });
  
  // Create result
  await prisma.checkInResult.create({
    data: {
      requestId: pendingRequest.id,
      locationLat: location.latitude,
      locationLon: location.longitude,
      isWithinZone: locationCheck.isWithinZone,
      distanceToZone: locationCheck.distanceToZone
    }
  });
  
  const status = locationCheck.isWithinZone ? '✅ Вы в рабочей зоне!' : '❌ Вы вне рабочей зоны';
  await ctx.reply(`${status}\nРасстояние до ближайшей зоны: ${Math.round(locationCheck.distanceToZone || 0)}м`);
});

// Handle photo
bot.on('photo', async (ctx) => {
  const userId = String(ctx.from.id);
  const photo = ctx.message.photo[ctx.message.photo.length - 1];
  
  const user = await prisma.user.findUnique({
    where: { telegramId: userId }
  });
  
  if (!user) {
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
    // Update result with photo
    const result = await prisma.checkInResult.findUnique({
      where: { requestId: pendingRequest.id }
    });
    
    if (result) {
      await prisma.checkInResult.update({
        where: { id: result.id },
        data: { photoFileId: photo.file_id }
      });
      await ctx.reply('✅ Фото сохранено!');
    }
  }
});

// Cron job for random check-ins
cron.schedule('*/30 * * * *', async () => {
  const now = new Date();
  const hour = now.getHours();
  
  // Only between 9:00 and 18:00
  if (hour < 9 || hour >= 18) {
    return;
  }
  
  // Get all employees
  const employees = await prisma.user.findMany({
    where: { role: 'EMPLOYEE' }
  });
  
  if (employees.length === 0) {
    return;
  }
  
  // Filter employees who haven't been checked in last 2 hours
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
  
  if (availableEmployees.length === 0) {
    return;
  }
  
  // Pick random employee
  const randomEmployee = availableEmployees[Math.floor(Math.random() * availableEmployees.length)];
  
  // Create check-in request
  await prisma.checkInRequest.create({
    data: {
      userId: randomEmployee.id,
      status: 'PENDING'
    }
  });
  
  // Send notification
  try {
    await bot.telegram.sendMessage(
      randomEmployee.telegramId,
      '📍 Проверка местоположения!\n\nПожалуйста, отправьте ваше текущее местоположение (Live Location) и фото.'
    );
  } catch (error) {
    console.error('Error sending check-in notification:', error);
  }
  
  // Notify director if employee is not in zone
  const directors = await prisma.user.findMany({
    where: { role: 'DIRECTOR' }
  });
  
  for (const director of directors) {
    try {
      await bot.telegram.sendMessage(
        director.telegramId,
        `🔔 Запрос на проверку отправлен сотруднику ${randomEmployee.name}`
      );
    } catch (error) {
      console.error('Error notifying director:', error);
    }
  }
});

// Start server
app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});

// Start bot with database connection check
async function startBot() {
  console.log("🔄 Running database migrations...");
  const migrationsOk = await runMigrations();
  if (!migrationsOk) {
    console.error("❌ Failed to run database migrations");
    process.exit(1);
  }
  
  // runMigrations() already checks database connection and applies schema
  // No need for additional connectToDatabase() call
  
  try {
    await bot.launch();
    botRunning = true;
    console.log("✅ Bot started successfully");
  } catch (error) {
    console.error("❌ Error starting bot:", error);
    process.exit(1);
  }
}

startBot();

// Graceful shutdown
process.once("SIGINT", async () => {
  if (botRunning) {
    await bot.stop("SIGINT");
  }
  await prisma.$disconnect();
});

process.once("SIGTERM", async () => {
  if (botRunning) {
    await bot.stop("SIGTERM");
  }
  await prisma.$disconnect();
});
