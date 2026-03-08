'use strict';

/** @type {import('sequelize-cli').Migration} */
module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.createTable(
      { tableName: 'TelegramPayments', schema: 'dbo' },
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
        PricingId: {
          type: Sequelize.INTEGER,
          allowNull: false,
          references: { model: { tableName: 'Pricings', schema: 'dbo' }, key: 'Id' },
          onUpdate: 'CASCADE',
          onDelete: 'NO ACTION',
        },
        TelegramPaymentChargeId: {
          type: Sequelize.STRING(255),
          allowNull: false,
        },
        ProviderPaymentChargeId: {
          type: Sequelize.STRING(255),
          allowNull: true,
        },
        InvoicePayload: {
          type: Sequelize.STRING(500),
          allowNull: false,
        },
        StarsAmount: {
          type: Sequelize.INTEGER,
          allowNull: false,
        },
        Currency: {
          type: Sequelize.STRING(10),
          allowNull: false,
          defaultValue: 'XTR',
        },
        Status: {
          type: Sequelize.STRING(20),
          allowNull: false,
          defaultValue: 'completed',
        },
        PaidAt: {
          type: Sequelize.DATE,
          allowNull: false,
        },
      }
    );
    await queryInterface.addIndex(
      { tableName: 'TelegramPayments', schema: 'dbo' },
      ['TelegramPaymentChargeId'],
      { unique: true }
    );
    await queryInterface.addIndex(
      { tableName: 'TelegramPayments', schema: 'dbo' },
      ['UserId']
    );
    await queryInterface.addIndex(
      { tableName: 'TelegramPayments', schema: 'dbo' },
      ['PaidAt']
    );
    await queryInterface.addIndex(
      { tableName: 'TelegramPayments', schema: 'dbo' },
      ['Status']
    );
  },

  async down(queryInterface) {
    await queryInterface.dropTable({ tableName: 'TelegramPayments', schema: 'dbo' });
  },
};
