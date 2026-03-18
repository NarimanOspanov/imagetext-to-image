import { DataTypes } from 'sequelize';

/**
 * Manual payout requests. Admin processes and marks as paid/rejected.
 */
export default function definePayoutRequest(sequelize) {
  const PayoutRequest = sequelize.define(
    'PayoutRequest',
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
      RequestedAmountUsdCents: {
        type: DataTypes.INTEGER,
        allowNull: false,
      },
      Status: {
        type: DataTypes.STRING(20),
        allowNull: false,
        defaultValue: 'requested',
      },
      RequestedAtUtc: {
        type: DataTypes.DATE,
        allowNull: false,
      },
      ProcessedAtUtc: {
        type: DataTypes.DATE,
        allowNull: true,
      },
      AdminNote: {
        type: DataTypes.STRING(500),
        allowNull: true,
      },
    },
    {
      tableName: 'PayoutRequests',
      schema: 'dbo',
      timestamps: false,
      indexes: [
        { fields: ['UserId'] },
        { fields: ['Status', 'RequestedAtUtc'] },
      ],
    }
  );
  return PayoutRequest;
}

