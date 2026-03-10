import { DataTypes } from 'sequelize';

/**
 * Code-first UserPurchase model. One row per purchase; BalanceRemaining tracks how many
 * generations are left from that purchase (consumed when user generates).
 */
export default function defineUserPurchase(sequelize) {
  const UserPurchase = sequelize.define(
    'UserPurchase',
    {
      Id: {
        type: DataTypes.INTEGER,
        autoIncrement: true,
        primaryKey: true,
        allowNull: false,
      },
      UserId: {
        type: DataTypes.INTEGER,
        allowNull: false,
        references: { model: 'Users', key: 'Id' },
      },
      PricingId: {
        type: DataTypes.INTEGER,
        allowNull: false,
        references: { model: 'Pricings', key: 'Id' },
      },
      PurchasedAt: {
        type: DataTypes.DATE,
        allowNull: false,
        defaultValue: DataTypes.NOW,
      },
      GenerationsIncluded: {
        type: DataTypes.INTEGER,
        allowNull: false,
      },
      BalanceRemaining: {
        type: DataTypes.INTEGER,
        allowNull: false,
      },
      TelegramPaymentId: {
        type: DataTypes.INTEGER,
        allowNull: true,
        references: { model: 'TelegramPayments', key: 'Id' },
      },
    },
    {
      tableName: 'UserPurchases',
      schema: 'dbo',
      timestamps: false,
      indexes: [
        { fields: ['UserId'] },
        { fields: ['PurchasedAt'] },
        { fields: ['TelegramPaymentId'] },
      ],
    }
  );
  return UserPurchase;
}
