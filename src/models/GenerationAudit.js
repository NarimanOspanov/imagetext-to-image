import { DataTypes } from 'sequelize';

/**
 * Audit log for each user generation request: prompt, attached images path, status, error, result file, UTC time.
 * Media files live under media/{TelegramChatId}/{RequestId}/request/ and .../response/
 */
export default function defineGenerationAudit(sequelize) {
  const GenerationAudit = sequelize.define(
    'GenerationAudit',
    {
      Id: {
        type: DataTypes.INTEGER,
        autoIncrement: true,
        primaryKey: true,
        allowNull: false,
      },
      UserId: {
        type: DataTypes.INTEGER,
        allowNull: true,
        references: { model: 'Users', key: 'Id' },
      },
      TelegramChatId: {
        type: DataTypes.STRING(32),
        allowNull: false,
      },
      SentPrompt: {
        type: DataTypes.TEXT,
        allowNull: true,
      },
      RequestId: {
        type: DataTypes.STRING(36),
        allowNull: false,
      },
      Status: {
        type: DataTypes.STRING(20),
        allowNull: false,
        defaultValue: 'pending',
      },
      ErrorDetails: {
        type: DataTypes.TEXT,
        allowNull: true,
      },
      ResultFileName: {
        type: DataTypes.STRING(500),
        allowNull: true,
      },
      AttachedImageFileNames: {
        type: DataTypes.STRING(500),
        allowNull: true,
      },
      UserPhotosetId: {
        type: DataTypes.INTEGER,
        allowNull: true,
        references: { model: 'UserPhotosets', key: 'Id' },
      },
      CreatedAt: {
        type: DataTypes.DATE,
        allowNull: false,
        defaultValue: sequelize.options.dialect === 'mssql' ? sequelize.literal('GETUTCDATE()') : DataTypes.NOW,
      },
    },
    {
      tableName: 'GenerationAudits',
      schema: 'dbo',
      timestamps: false,
      indexes: [
        { fields: ['UserId'] },
        { fields: ['TelegramChatId'] },
        { fields: ['RequestId'] },
        { fields: ['Status'] },
        { fields: ['CreatedAt'] },
        { fields: ['UserPhotosetId'] },
      ],
    }
  );
  return GenerationAudit;
}
