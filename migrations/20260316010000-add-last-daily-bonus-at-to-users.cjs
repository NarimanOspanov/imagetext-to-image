"use strict";

/** @type {import('sequelize-cli').Migration} */
module.exports = {
  async up(queryInterface, Sequelize) {
    const qi = queryInterface;

    async function columnExists(tableName, columnName) {
      const [rows] = await qi.sequelize.query(
        `SELECT 1 AS existsFlag
         FROM INFORMATION_SCHEMA.COLUMNS
         WHERE TABLE_SCHEMA = 'dbo' AND TABLE_NAME = :table AND COLUMN_NAME = :col`,
        { replacements: { table: tableName, col: columnName } }
      );
      return rows.length > 0;
    }

    if (!(await columnExists("Users", "LastDailyBonusAt"))) {
      await qi.addColumn(
        { tableName: "Users", schema: "dbo" },
        "LastDailyBonusAt",
        {
          type: Sequelize.DATE,
          allowNull: true,
        }
      );
    }
  },

  async down(queryInterface) {
    const qi = queryInterface;
    await qi.removeColumn({ tableName: "Users", schema: "dbo" }, "LastDailyBonusAt");
  },
};

