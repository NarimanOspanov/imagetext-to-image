'use strict';

/** @type {import('sequelize-cli').Migration} */
module.exports = {
  async up(queryInterface, Sequelize) {
    const qi = queryInterface;

    async function tableExists(tableName) {
      const [rows] = await qi.sequelize.query(
        "SELECT 1 AS existsFlag FROM INFORMATION_SCHEMA.TABLES WHERE TABLE_SCHEMA = 'dbo' AND TABLE_NAME = :name",
        { replacements: { name: tableName } }
      );
      return rows.length > 0;
    }

    async function columnExists(tableName, columnName) {
      const [rows] = await qi.sequelize.query(
        "SELECT 1 AS existsFlag FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA = 'dbo' AND TABLE_NAME = :table AND COLUMN_NAME = :column",
        { replacements: { table: tableName, column: columnName } }
      );
      return rows.length > 0;
    }

    async function indexExists(tableName, indexName) {
      const [rows] = await qi.sequelize.query(
        'SELECT 1 AS existsFlag FROM sys.indexes WHERE name = :indexName AND object_id = OBJECT_ID(:fullName)',
        {
          replacements: {
            indexName,
            fullName: `dbo.${tableName}`,
          },
        }
      );
      return rows.length > 0;
    }

    // Presets
    if (!(await tableExists('Presets'))) {
      await qi.createTable(
        { tableName: 'Presets', schema: 'dbo' },
        {
          Id: {
            type: Sequelize.INTEGER,
            autoIncrement: true,
            primaryKey: true,
            allowNull: false,
          },
          Prompt: {
            type: Sequelize.TEXT,
            allowNull: false,
          },
        }
      );
    }

    // PhotosetConfigs
    if (!(await tableExists('PhotosetConfigs'))) {
      await qi.createTable(
        { tableName: 'PhotosetConfigs', schema: 'dbo' },
        {
          Id: {
            type: Sequelize.INTEGER,
            autoIncrement: true,
            primaryKey: true,
            allowNull: false,
          },
          Name: {
            type: Sequelize.STRING(255),
            allowNull: false,
          },
          Description: {
            type: Sequelize.TEXT,
            allowNull: false,
          },
          Image: {
            type: Sequelize.STRING(255),
            allowNull: false,
          },
        }
      );
    }

    // Photosets
    if (!(await tableExists('Photosets'))) {
      await qi.createTable(
        { tableName: 'Photosets', schema: 'dbo' },
        {
          Id: {
            type: Sequelize.INTEGER,
            autoIncrement: true,
            primaryKey: true,
            allowNull: false,
          },
          PhotosetConfigId: {
            type: Sequelize.INTEGER,
            allowNull: false,
            references: { model: { tableName: 'PhotosetConfigs', schema: 'dbo' }, key: 'Id' },
            onUpdate: 'CASCADE',
            onDelete: 'CASCADE',
          },
          PresetId: {
            type: Sequelize.INTEGER,
            allowNull: false,
            references: { model: { tableName: 'Presets', schema: 'dbo' }, key: 'Id' },
            onUpdate: 'CASCADE',
            onDelete: 'CASCADE',
          },
        }
      );
    }
    if (!(await indexExists('Photosets', 'photosets__photoset_config_id'))) {
      await qi.addIndex({ tableName: 'Photosets', schema: 'dbo' }, ['PhotosetConfigId']);
    }
    if (!(await indexExists('Photosets', 'photosets__preset_id'))) {
      await qi.addIndex({ tableName: 'Photosets', schema: 'dbo' }, ['PresetId']);
    }

    // UserPhotosets
    if (!(await tableExists('UserPhotosets'))) {
      await qi.createTable(
        { tableName: 'UserPhotosets', schema: 'dbo' },
        {
          Id: {
            type: Sequelize.INTEGER,
            autoIncrement: true,
            primaryKey: true,
            allowNull: false,
          },
          UserId: {
            type: Sequelize.INTEGER,
            allowNull: false,
            references: { model: { tableName: 'Users', schema: 'dbo' }, key: 'Id' },
            onUpdate: 'CASCADE',
            onDelete: 'CASCADE',
          },
          PhotosetId: {
            type: Sequelize.INTEGER,
            allowNull: false,
            references: { model: { tableName: 'Photosets', schema: 'dbo' }, key: 'Id' },
            onUpdate: 'CASCADE',
            onDelete: 'CASCADE',
          },
          DateTimeUtc: {
            type: Sequelize.DATE,
            allowNull: false,
            defaultValue: Sequelize.literal('GETUTCDATE()'),
          },
          NumberOfPicturesInPhotoset: {
            type: Sequelize.INTEGER,
            allowNull: false,
          },
        }
      );
    }
    if (!(await indexExists('UserPhotosets', 'user_photosets__user_id'))) {
      await qi.addIndex({ tableName: 'UserPhotosets', schema: 'dbo' }, ['UserId']);
    }
    if (!(await indexExists('UserPhotosets', 'user_photosets__photoset_id'))) {
      await qi.addIndex({ tableName: 'UserPhotosets', schema: 'dbo' }, ['PhotosetId']);
    }
    if (!(await indexExists('UserPhotosets', 'user_photosets__date_time_utc'))) {
      await qi.addIndex({ tableName: 'UserPhotosets', schema: 'dbo' }, ['DateTimeUtc']);
    }

    // GenerationAudits: add UserPhotosetId (without FK, to be maximally compatible)
    if (!(await columnExists('GenerationAudits', 'UserPhotosetId'))) {
      try {
        await qi.sequelize.query(
          'ALTER TABLE [dbo].[GenerationAudits] ADD [UserPhotosetId] INT NULL'
        );
      } catch (e) {
        // If it already exists or cannot be added, continue; we'll just skip index creation below.
      }
    }
    if (await columnExists('GenerationAudits', 'UserPhotosetId')) {
      if (!(await indexExists('GenerationAudits', 'generation_audits__user_photoset_id'))) {
        await qi.addIndex(
          { tableName: 'GenerationAudits', schema: 'dbo' },
          ['UserPhotosetId']
        );
      }
    }

    // Seed PhotosetConfigs (3 records) moved to a separate seeder migration.
  },

  async down(queryInterface) {
    // This migration is now idempotent and structural-only; we keep down empty
    // to avoid accidentally dropping live tables.
  },
};

