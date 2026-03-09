import { DataTypes } from 'sequelize';

export default function definePhotosetConfig(sequelize) {
  const PhotosetConfig = sequelize.define(
    'PhotosetConfig',
    {
      Id: {
        type: DataTypes.INTEGER,
        autoIncrement: true,
        primaryKey: true,
        allowNull: false,
      },
      Name: {
        type: DataTypes.STRING(255),
        allowNull: false,
      },
      Description: {
        type: DataTypes.TEXT,
        allowNull: false,
      },
      Image: {
        type: DataTypes.STRING(255),
        allowNull: false,
      },
    },
    {
      tableName: 'PhotosetConfigs',
      schema: 'dbo',
      timestamps: false,
    }
  );

  return PhotosetConfig;
}

