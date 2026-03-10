'use strict';

/** @type {import('sequelize-cli').Migration} */
module.exports = {
  async up(queryInterface) {
    const qi = queryInterface;

    async function columnExists(tableName, columnName) {
      const [rows] = await qi.sequelize.query(
        "SELECT 1 AS existsFlag FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA = 'dbo' AND TABLE_NAME = :table AND COLUMN_NAME = :column",
        { replacements: { table: tableName, column: columnName } }
      );
      return rows.length > 0;
    }

    if (!(await columnExists('Presets', 'Image'))) {
      await qi.sequelize.query(
        'ALTER TABLE [dbo].[Presets] ADD [Image] NVARCHAR(255) NULL'
      );
    }
  },

  async down(queryInterface) {
    const qi = queryInterface;

    async function columnExists(tableName, columnName) {
      const [rows] = await qi.sequelize.query(
        "SELECT 1 AS existsFlag FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA = 'dbo' AND TABLE_NAME = :table AND COLUMN_NAME = :column",
        { replacements: { table: tableName, column: columnName } }
      );
      return rows.length > 0;
    }

    if (await columnExists('Presets', 'Image')) {
      await qi.sequelize.query(
        'ALTER TABLE [dbo].[Presets] DROP COLUMN [Image]'
      );
    }
  },
};
