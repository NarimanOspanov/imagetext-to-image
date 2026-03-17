import { DataTypes } from 'sequelize';

/**
 * One row per referred user. Referrer gets +1 bonus generation; BonusUsed tracks if it was consumed.
 */
export default function defineReferral(sequelize) {
  const Referral = sequelize.define(
    'Referral',
    {
      Id: {
        type: DataTypes.INTEGER,
        autoIncrement: true,
        primaryKey: true,
        allowNull: false,
      },
      ReferrerUserId: {
        type: DataTypes.INTEGER,
        allowNull: false,
        references: { model: 'Users', key: 'Id' },
      },
      ReferredUserId: {
        type: DataTypes.INTEGER,
        allowNull: false,
        references: { model: 'Users', key: 'Id' },
      },
      ReferredAt: {
        type: DataTypes.DATE,
        allowNull: false,
        defaultValue: DataTypes.NOW,
      },
      BonusUsed: {
        type: DataTypes.BOOLEAN,
        allowNull: false,
        defaultValue: false,
      },
      BonusRemaining: {
        type: DataTypes.INTEGER,
        allowNull: true,
      },
      ReferrerNotifiedAt: {
        type: DataTypes.DATE,
        allowNull: true,
        comment: 'When we sent the "friend registered" message to the referrer',
      },
    },
    {
      tableName: 'Referrals',
      schema: 'dbo',
      timestamps: false,
      indexes: [
        { fields: ['ReferrerUserId'] },
        { fields: ['ReferredUserId'] },
        { unique: true, fields: ['ReferrerUserId', 'ReferredUserId'] },
      ],
    }
  );
  return Referral;
}
