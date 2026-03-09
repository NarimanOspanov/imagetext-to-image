import { DataTypes } from 'sequelize';

/**
 * Code-first User model. Maps to existing dbo.Users table.
 */
export default function defineUser(sequelize) {
  const User = sequelize.define(
    'User',
    {
      Id: {
        type: DataTypes.INTEGER,
        autoIncrement: true,
        primaryKey: true,
        allowNull: false,
      },
      TelegramUserName: {
        type: DataTypes.STRING(255),
        allowNull: true,
      },
      TelegramChatId: {
        type: DataTypes.BIGINT,
        allowNull: false,
        unique: true,
      },
      DateJoined: {
        type: DataTypes.DATE,
        allowNull: false,
      },
      Promocode: {
        type: DataTypes.STRING(50),
        allowNull: true,
      },
      IsBlocked: {
        type: DataTypes.BOOLEAN,
        allowNull: false,
        defaultValue: false,
      },
      MuteBotUntil: {
        type: DataTypes.DATE,
        allowNull: true,
      },
      Timezone: {
        type: DataTypes.DATE,
        allowNull: true,
      },
      ActiveModel: {
        type: DataTypes.STRING(50),
        allowNull: true,
      },
      FreeGenerationsRemaining: {
        type: DataTypes.INTEGER,
        allowNull: false,
        defaultValue: 3,
      },
    },
    {
      tableName: 'Users',
      schema: 'dbo',
      timestamps: false,
      indexes: [
        { unique: true, fields: ['TelegramChatId'] },
      ],
    }
  );
  return User;
}
