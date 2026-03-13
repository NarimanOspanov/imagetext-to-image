'use strict';

/** @type {import('sequelize-cli').Migration} */
module.exports = {
  async up(queryInterface) {
    await queryInterface.sequelize.query(`
      IF NOT EXISTS (SELECT 1 FROM [dbo].[Config] WHERE [Keys] = N'GenerationsPerRegistration')
      INSERT INTO [dbo].[Config] ([Keys], [Value]) VALUES (N'GenerationsPerRegistration', 5);
    `);
  },

  async down(queryInterface) {
    await queryInterface.sequelize.query(
      "DELETE FROM [dbo].[Config] WHERE [Keys] = N'GenerationsPerRegistration';"
    );
  },
};
