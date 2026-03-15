import { DataTypes } from 'sequelize';

export default function definePresetAudience(sequelize) {
  const PresetAudience = sequelize.define(
    'PresetAudience',
    {
      PresetId: {
        type: DataTypes.INTEGER,
        primaryKey: true,
        allowNull: false,
      },
      AudienceId: {
        type: DataTypes.INTEGER,
        primaryKey: true,
        allowNull: false,
      },
    },
    {
      tableName: 'PresetAudiences',
      schema: 'dbo',
      timestamps: false,
    }
  );
  return PresetAudience;
}
