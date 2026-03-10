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
console.log('Config: env loaded (path:', envPath, ')');

// Returns the value or empty string — does NOT throw at module load time.
// Validation happens later in main() via checkEnvLoaded().
function getEnv(name) {
  return process.env[name] || '';
}

const isProduction = process.env.NODE_ENV === 'production';
const port = process.env.PORT || 3000;
const defaultWebhookUrl = isProduction
  ? 'https://imagetext-to-image-bot-asd9azexgqhxb2hs.northeurope-01.azurewebsites.net'
  : `http://localhost:${port}`;

export const config = {
  isProduction,
  telegramBotToken: getEnv('TELEGRAM_BOT_TOKEN'),
  geminiApiKey: getEnv('GEMINI_API_KEY'),
  webhookUrl: getEnv('WEBHOOK_URL') || defaultWebhookUrl,
  geminiImageModel: process.env.GEMINI_IMAGE_MODEL || 'gemini-3.1-flash-image-preview',
  maxImagesPerRequest: Math.min(parseInt(process.env.MAX_IMAGES_PER_REQUEST, 10) || 1, 4),
  azureStorageConnectionString: getEnv('AZURE_STORAGE_CONNECTION_STRING'),
  azureStorageContainer: process.env.AZURE_STORAGE_CONTAINER || 'images',
  // MSSQL (Azure SQL) – override with DB_HOST, DB_NAME, DB_USER, DB_PASSWORD, DB_PORT
  db: {
    host: process.env.DB_HOST || 'sql-st-prod.database.windows.net',
    port: parseInt(process.env.DB_PORT, 10) || 1433,
    database: process.env.DB_NAME || 'sql-photo-ai-prod',
    username: process.env.DB_USER || 'stadmin',
    password: process.env.DB_PASSWORD || 'Password123!',
    dialect: 'mssql',
  },
};
