import { DataTypes } from 'sequelize';

export default function definePresetTheme(sequelize) {
  const PresetTheme = sequelize.define(
    'PresetTheme',
    {
      PresetId: {
        type: DataTypes.INTEGER,
        primaryKey: true,
        allowNull: false,
      },
      ThemeId: {
        type: DataTypes.INTEGER,
        primaryKey: true,
        allowNull: false,
      },
    },
    {
      tableName: 'PresetThemes',
      schema: 'dbo',
      timestamps: false,
    }
  );
  return PresetTheme;
}
