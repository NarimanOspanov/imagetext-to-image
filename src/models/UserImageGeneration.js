import { DataTypes } from 'sequelize';

/**
 * Code-first UserImageGeneration model. Tracks each image generation:
 * when it was generated, who generated it, result file name.
 */
export default function defineUserImageGeneration(sequelize) {
  const UserImageGeneration = sequelize.define(
    'UserImageGeneration',
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
      GeneratedAt: {
        type: DataTypes.DATE,
        allowNull: false,
        defaultValue: DataTypes.NOW,
      },
      ResultFileName: {
        type: DataTypes.STRING(255),
        allowNull: false,
      },
    },
    {
      tableName: 'UserImageGenerations',
      schema: 'dbo',
      timestamps: false,
      indexes: [
        { fields: ['UserId'] },
        { fields: ['GeneratedAt'] },
      ],
    }
  );
  return UserImageGeneration;
}
