import { DataTypes } from 'sequelize';

/**
 * Channels that users must be subscribed to before photoset preview.
 */
export default function defineRequiredChannel(sequelize) {
  const RequiredChannel = sequelize.define(
    'RequiredChannel',
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
        unique: true,
      },
      JoinUrl: {
        type: DataTypes.STRING(500),
        allowNull: false,
      },
      IsActive: {
        type: DataTypes.BOOLEAN,
        allowNull: false,
        defaultValue: true,
      },
      SortOrder: {
        type: DataTypes.INTEGER,
        allowNull: false,
        defaultValue: 0,
      },
      CreatedAtUtc: {
        type: DataTypes.DATE,
        allowNull: false,
      },
    },
    {
      tableName: 'RequiredChannels',
      schema: 'dbo',
      timestamps: false,
      indexes: [
        { unique: true, fields: ['ChannelId'] },
        { fields: ['IsActive', 'SortOrder'] },
      ],
    }
  );
  return RequiredChannel;
}

