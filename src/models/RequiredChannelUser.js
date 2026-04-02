import { DataTypes } from 'sequelize';

/**
 * Tracks users who were verified as subscribed to required channels.
 * One row per (ChannelId, UserId).
 */
export default function defineRequiredChannelUser(sequelize) {
  const RequiredChannelUser = sequelize.define(
    'RequiredChannelUser',
    {
      Id: {
        type: DataTypes.INTEGER,
        autoIncrement: true,
        primaryKey: true,
        allowNull: false,
      },
      ChannelId: {
        type: DataTypes.STRING(64),
        allowNull: false,
      },
      UserId: {
        type: DataTypes.BIGINT,
        allowNull: false,
      },
      DateTime: {
        type: DataTypes.DATE,
        allowNull: false,
      },
    },
    {
      tableName: 'RequiredChannelUsers',
      schema: 'dbo',
      timestamps: false,
      indexes: [
        { unique: true, fields: ['ChannelId', 'UserId'] },
        { fields: ['DateTime'] },
      ],
    }
  );
  return RequiredChannelUser;
}

