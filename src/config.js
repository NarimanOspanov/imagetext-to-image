import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import dotenv from 'dotenv';

// Load .env from project root (same folder as package.json) so it works from any cwd
const __dirname = dirname(fileURLToPath(import.meta.url));
const envPath = join(__dirname, '..', '.env');
const result = dotenv.config({ path: envPath });
if (result.error && result.error.code !== 'ENOENT') {
  console.error('Error loading .env:', result.error.message);
}

function requireEnv(name) {
  const value = process.env[name];
  if (!value) {
    throw new Error(`Missing required environment variable: ${name}. Add it to ${envPath} (see .env.example)`);
  }
  return value;
}

export const config = {
  telegramBotToken: requireEnv('TELEGRAM_BOT_TOKEN'),
  geminiApiKey: requireEnv('GEMINI_API_KEY'),
  // Webhook URL for Telegram (required when not using long polling)
  webhookUrl: process.env.WEBHOOK_URL || 'https://imagetext-to-image-bot-asd9azexgqhxb2hs.northeurope-01.azurewebsites.net',
  // Gemini model with native image generation (text and image+text → image)
  geminiImageModel: process.env.GEMINI_IMAGE_MODEL || 'gemini-3.1-flash-image-preview',
  maxImagesPerRequest: Math.min(parseInt(process.env.MAX_IMAGES_PER_REQUEST, 10) || 1, 4),
};
