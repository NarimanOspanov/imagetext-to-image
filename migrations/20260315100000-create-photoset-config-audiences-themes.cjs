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

    if (!(await tableExists('PhotosetConfigAudiences'))) {
      await qi.createTable(
        { tableName: 'PhotosetConfigAudiences', schema: 'dbo' },
        {
          PhotosetConfigId: {
            type: Sequelize.INTEGER,
            allowNull: false,
            primaryKey: true,
            references: { model: { tableName: 'PhotosetConfigs', schema: 'dbo' }, key: 'Id' },
            onUpdate: 'CASCADE',
            onDelete: 'CASCADE',
          },
          AudienceId: {
            type: Sequelize.INTEGER,
            allowNull: false,
            primaryKey: true,
            references: { model: { tableName: 'Audiences', schema: 'dbo' }, key: 'Id' },
            onUpdate: 'CASCADE',
            onDelete: 'CASCADE',
          },
        }
      );
    }
    if (!(await indexExists('PhotosetConfigAudiences', 'photoset_config_audiences__config_id'))) {
      await qi.addIndex({ tableName: 'PhotosetConfigAudiences', schema: 'dbo' }, ['PhotosetConfigId']);
    }
    if (!(await indexExists('PhotosetConfigAudiences', 'photoset_config_audiences__audience_id'))) {
      await qi.addIndex({ tableName: 'PhotosetConfigAudiences', schema: 'dbo' }, ['AudienceId']);
    }

    if (!(await tableExists('PhotosetConfigThemes'))) {
      await qi.createTable(
        { tableName: 'PhotosetConfigThemes', schema: 'dbo' },
        {
          PhotosetConfigId: {
            type: Sequelize.INTEGER,
            allowNull: false,
            primaryKey: true,
            references: { model: { tableName: 'PhotosetConfigs', schema: 'dbo' }, key: 'Id' },
            onUpdate: 'CASCADE',
            onDelete: 'CASCADE',
          },
          ThemeId: {
            type: Sequelize.INTEGER,
            allowNull: false,
            primaryKey: true,
            references: { model: { tableName: 'Themes', schema: 'dbo' }, key: 'Id' },
            onUpdate: 'CASCADE',
            onDelete: 'CASCADE',
          },
        }
      );
    }
    if (!(await indexExists('PhotosetConfigThemes', 'photoset_config_themes__config_id'))) {
      await qi.addIndex({ tableName: 'PhotosetConfigThemes', schema: 'dbo' }, ['PhotosetConfigId']);
    }
    if (!(await indexExists('PhotosetConfigThemes', 'photoset_config_themes__theme_id'))) {
      await qi.addIndex({ tableName: 'PhotosetConfigThemes', schema: 'dbo' }, ['ThemeId']);
    }
  },

  async down(queryInterface) {
    const qi = queryInterface;
    await qi.dropTable({ tableName: 'PhotosetConfigThemes', schema: 'dbo' });
    await qi.dropTable({ tableName: 'PhotosetConfigAudiences', schema: 'dbo' });
  },
};
