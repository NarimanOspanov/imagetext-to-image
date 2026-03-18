import { DataTypes } from 'sequelize';

/**
 * Ledger of referral commissions (2-level).
 * pending -> available -> reserved -> paid (or void)
 */
export default function defineReferralEarning(sequelize) {
  const ReferralEarning = sequelize.define(
    'ReferralEarning',
    {
      Id: {
        type: DataTypes.INTEGER,
        autoIncrement: true,
        primaryKey: true,
        allowNull: false,
      },
      BeneficiaryUserId: {
        type: DataTypes.INTEGER,
        allowNull: false,
        references: { model: 'Users', key: 'Id' },
      },
      SourceUserId: {
        type: DataTypes.INTEGER,
        allowNull: false,
        references: { model: 'Users', key: 'Id' },
      },
      TelegramPaymentId: {
        type: DataTypes.INTEGER,
        allowNull: false,
        references: { model: 'TelegramPayments', key: 'Id' },
      },
      PricingId: {
        type: DataTypes.INTEGER,
        allowNull: false,
        references: { model: 'Pricings', key: 'Id' },
      },
      Level: {
        type: DataTypes.INTEGER,
        allowNull: false,
      },
      PercentBps: {
        type: DataTypes.INTEGER,
        allowNull: false,
      },
      AmountUsdCents: {
        type: DataTypes.INTEGER,
        allowNull: false,
      },
      Status: {
        type: DataTypes.STRING(20),
        allowNull: false,
        defaultValue: 'pending',
      },
      HoldUntilUtc: {
        type: DataTypes.DATE,
        allowNull: false,
      },
      CreatedAtUtc: {
        type: DataTypes.DATE,
        allowNull: false,
      },
    },
    {
      tableName: 'ReferralEarnings',
      schema: 'dbo',
      timestamps: false,
      indexes: [
        { fields: ['BeneficiaryUserId'] },
        { fields: ['SourceUserId'] },
        { fields: ['TelegramPaymentId'] },
        { fields: ['Status', 'HoldUntilUtc'] },
        { unique: true, fields: ['TelegramPaymentId', 'BeneficiaryUserId', 'Level'] },
      ],
    }
  );
  return ReferralEarning;
}

