'use strict';

/** @type {import('sequelize-cli').Migration} */
module.exports = {
  async up(queryInterface) {
    const qi = queryInterface;
    await qi.sequelize.query(`
      IF OBJECT_ID(N'dbo.Config', N'U') IS NULL
      CREATE TABLE [dbo].[Config] (
        [Id] INT IDENTITY(1,1) NOT NULL PRIMARY KEY,
        [Keys] NVARCHAR(100) NOT NULL,
        [Value] INT NOT NULL,
        CONSTRAINT [UQ_Config_Keys] UNIQUE ([Keys])
      );
    `);
    await qi.sequelize.query(`
      IF NOT EXISTS (SELECT 1 FROM [dbo].[Config] WHERE [Keys] = N'GenerationsPerReferral')
      INSERT INTO [dbo].[Config] ([Keys], [Value]) VALUES (N'GenerationsPerReferral', 1);
    `);
  },

  async down(queryInterface) {
    await queryInterface.sequelize.query(
      'IF OBJECT_ID(N\'dbo.Config\', N\'U\') IS NOT NULL DROP TABLE [dbo].[Config];'
    );
  },
};
