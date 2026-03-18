'use strict';

/** @type {import('sequelize-cli').Migration} */
module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.createTable(
      { tableName: 'ReferralEarnings', schema: 'dbo' },
      {
        Id: {
          type: Sequelize.INTEGER,
          autoIncrement: true,
          primaryKey: true,
          allowNull: false,
        },
        BeneficiaryUserId: {
          type: Sequelize.INTEGER,
          allowNull: false,
          references: { model: { tableName: 'Users', schema: 'dbo' }, key: 'Id' },
        },
        SourceUserId: {
          type: Sequelize.INTEGER,
          allowNull: false,
          references: { model: { tableName: 'Users', schema: 'dbo' }, key: 'Id' },
        },
        TelegramPaymentId: {
          type: Sequelize.INTEGER,
          allowNull: false,
          references: { model: { tableName: 'TelegramPayments', schema: 'dbo' }, key: 'Id' },
        },
        PricingId: {
          type: Sequelize.INTEGER,
          allowNull: false,
          references: { model: { tableName: 'Pricings', schema: 'dbo' }, key: 'Id' },
        },
        Level: {
          type: Sequelize.INTEGER,
          allowNull: false,
        },
        PercentBps: {
          type: Sequelize.INTEGER,
          allowNull: false,
        },
        AmountUsdCents: {
          type: Sequelize.INTEGER,
          allowNull: false,
        },
        Status: {
          type: Sequelize.STRING(20),
          allowNull: false,
          defaultValue: 'pending', // pending -> available -> reserved -> paid (or void)
        },
        HoldUntilUtc: {
          type: Sequelize.DATE,
          allowNull: false,
        },
        CreatedAtUtc: {
          type: Sequelize.DATE,
          allowNull: false,
          defaultValue: Sequelize.fn('GETUTCDATE'),
        },
      }
    );

    await queryInterface.addIndex(
      { tableName: 'ReferralEarnings', schema: 'dbo' },
      ['BeneficiaryUserId']
    );
    await queryInterface.addIndex(
      { tableName: 'ReferralEarnings', schema: 'dbo' },
      ['SourceUserId']
    );
    await queryInterface.addIndex(
      { tableName: 'ReferralEarnings', schema: 'dbo' },
      ['TelegramPaymentId']
    );
    await queryInterface.addIndex(
      { tableName: 'ReferralEarnings', schema: 'dbo' },
      ['Status', 'HoldUntilUtc']
    );
    await queryInterface.addIndex(
      { tableName: 'ReferralEarnings', schema: 'dbo' },
      ['TelegramPaymentId', 'BeneficiaryUserId', 'Level'],
      { unique: true, name: 'UX_ReferralEarnings_TelegramPayment_Beneficiary_Level' }
    );

    await queryInterface.createTable(
      { tableName: 'PayoutRequests', schema: 'dbo' },
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
        },
        RequestedAmountUsdCents: {
          type: Sequelize.INTEGER,
          allowNull: false,
        },
        Status: {
          type: Sequelize.STRING(20),
          allowNull: false,
          defaultValue: 'requested',
        },
        RequestedAtUtc: {
          type: Sequelize.DATE,
          allowNull: false,
          defaultValue: Sequelize.fn('GETUTCDATE'),
        },
        ProcessedAtUtc: {
          type: Sequelize.DATE,
          allowNull: true,
        },
        AdminNote: {
          type: Sequelize.STRING(500),
          allowNull: true,
        },
      }
    );

    await queryInterface.addIndex(
      { tableName: 'PayoutRequests', schema: 'dbo' },
      ['UserId']
    );
    await queryInterface.addIndex(
      { tableName: 'PayoutRequests', schema: 'dbo' },
      ['Status', 'RequestedAtUtc']
    );
  },

  async down(queryInterface) {
    await queryInterface.dropTable({ tableName: 'PayoutRequests', schema: 'dbo' });
    await queryInterface.dropTable({ tableName: 'ReferralEarnings', schema: 'dbo' });
  },
};

