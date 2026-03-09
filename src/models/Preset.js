import { DataTypes } from 'sequelize';

export default function definePreset(sequelize) {
  const Preset = sequelize.define(
    'Preset',
    {
      Id: {
        type: DataTypes.INTEGER,
        autoIncrement: true,
        primaryKey: true,
        allowNull: false,
      },
      Prompt: {
        type: DataTypes.TEXT,
        allowNull: false,
      },
    },
    {
      tableName: 'Presets',
      schema: 'dbo',
      timestamps: false,
    }
  );

  return Preset;
}

