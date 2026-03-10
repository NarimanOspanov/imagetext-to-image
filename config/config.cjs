'use strict';

require('dotenv').config({ path: require('path').resolve(process.cwd(), '.env') });

const db = {
  host: process.env.DB_HOST || 'sql-st-prod.database.windows.net',
  port: parseInt(process.env.DB_PORT, 10) || 1433,
  database: process.env.DB_NAME || 'sql-photo-ai-prod',
  username: process.env.DB_USER || 'stadmin',
  password: process.env.DB_PASSWORD || 'Password123!',
  dialect: 'mssql',
  dialectOptions: {
    options: {
      encrypt: true,
      trustServerCertificate: false,
    },
  },
  logging: false,
};

module.exports = {
  development: db,
  test: db,
  production: db,
};
