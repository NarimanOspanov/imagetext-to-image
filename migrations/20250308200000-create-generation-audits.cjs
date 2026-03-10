'use strict';

/** @type {import('sequelize-cli').Migration} */
module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.createTable(
      { tableName: 'GenerationAudits', schema: 'dbo' },
      {
        Id: {
          type: Sequelize.INTEGER,
          autoIncrement: true,
          primaryKey: true,
          allowNull: false,
        },
        UserId: {
          type: Sequelize.INTEGER,
          allowNull: true,
          references: { model: { tableName: 'Users', schema: 'dbo' }, key: 'Id' },
          onUpdate: 'CASCADE',
          onDelete: 'SET NULL',
        },
        TelegramChatId: {
          type: Sequelize.STRING(32),
          allowNull: false,
        },
        SentPrompt: {
          type: Sequelize.TEXT,
          allowNull: true,
        },
        RequestId: {
          type: Sequelize.STRING(36),
          allowNull: false,
        },
        Status: {
          type: Sequelize.STRING(20),
          allowNull: false,
        },
        ErrorDetails: {
          type: Sequelize.TEXT,
          allowNull: true,
        },
        ResultFileName: {
          type: Sequelize.STRING(500),
          allowNull: true,
        },
        AttachedImageFileNames: {
          type: Sequelize.STRING(500),
          allowNull: true,
        },
        CreatedAt: {
          type: Sequelize.DATE,
          allowNull: false,
          defaultValue: Sequelize.literal('GETUTCDATE()'),
        },
      }
    );
    await queryInterface.addIndex(
      { tableName: 'GenerationAudits', schema: 'dbo' },
      ['UserId']
    );
    await queryInterface.addIndex(
      { tableName: 'GenerationAudits', schema: 'dbo' },
      ['TelegramChatId']
    );
    await queryInterface.addIndex(
      { tableName: 'GenerationAudits', schema: 'dbo' },
      ['RequestId']
    );
    await queryInterface.addIndex(
      { tableName: 'GenerationAudits', schema: 'dbo' },
      ['Status']
    );
    await queryInterface.addIndex(
      { tableName: 'GenerationAudits', schema: 'dbo' },
      ['CreatedAt']
    );
  },

  async down(queryInterface) {
    await queryInterface.dropTable({ tableName: 'GenerationAudits', schema: 'dbo' });
  },
};
