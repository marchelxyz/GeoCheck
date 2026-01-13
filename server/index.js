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

// Check and log DATABASE_URL
const DATABASE_URL = process.env.DATABASE_URL;
console.log("🔍 Checking DATABASE_URL...");
if (!DATABASE_URL) {
  console.error("❌ DATABASE_URL environment variable is not set!");
  console.error("Please make sure PostgreSQL service is connected in Railway.");
  console.error("Railway should automatically provide DATABASE_URL when PostgreSQL is connected.");
  process.exit(1);
} else {
  // Check if DATABASE_URL contains template syntax (not resolved)
  if (DATABASE_URL.includes("${{") || DATABASE_URL.includes("{{")) {
    console.error("❌ DATABASE_URL contains unresolved template syntax:", DATABASE_URL);
    console.error("This usually means Railway did not resolve the variable.");
    console.error("Please check:");
    console.error("1. PostgreSQL service is connected to your app service in Railway");
    console.error("2. Variable name matches the service name (e.g., if service is named 'Postgres', use ${{Postgres.DATABASE_URL}})");
    console.error("3. Or use Railway's automatic variables like POSTGRES_URL, POSTGRES_HOST, etc.");
    process.exit(1);
  }
  // Mask password in DATABASE_URL for logging
  const maskedUrl = DATABASE_URL.replace(/:([^:@]+)@/, ":***@");
  console.log("📊 DATABASE_URL:", maskedUrl);
  console.log("📊 DATABASE_URL length:", DATABASE_URL.length);
  console.log("📊 DATABASE_URL starts with:", DATABASE_URL.substring(0, 20));
}

