import express from 'express';
import { Telegraf, Markup } from 'telegraf';
import cron from 'node-cron';
import cors from 'cors';
import dotenv from 'dotenv';
import { PrismaClient } from '@prisma/client';
import crypto from 'crypto';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import multer from 'multer';
import FormData from 'form-data';
import fs from 'fs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

dotenv.config();

const app = express();
const prisma = new PrismaClient({
  log: process.env.NODE_ENV === 'development' ? ['query', 'error', 'warn'] : ['error'],
});

// Configure multer for file uploads
const upload = multer({ dest: '/tmp/' });

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

// ... existing code for runMigrations, BOT_TOKEN, etc. ...
