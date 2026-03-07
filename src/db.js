import { createRequire } from 'node:module';
import { Sequelize } from 'sequelize';
import { config } from './config.js';

const require = createRequire(import.meta.url);
const initModels = require('../models/init-models.js');

const sequelize = new Sequelize(config.db.database, config.db.username, config.db.password, {
  host: config.db.host,
  port: config.db.port,
  dialect: config.db.dialect,
  dialectOptions: {
    options: {
      encrypt: true,
      trustServerCertificate: false,
    },
  },
  logging: false,
});

const models = initModels(sequelize);

export { sequelize, models };
