import { DataTypes } from 'sequelize';

/**
 * Key-value config table. Keys = config key name, Value = integer value.
 */
export default function defineConfig(sequelize) {
  const Config = sequelize.define(
    'Config',
    {
      Id: {
        type: DataTypes.INTEGER,
        autoIncrement: true,
        primaryKey: true,
        allowNull: false,
      },
      Keys: {
        type: DataTypes.STRING(100),
        allowNull: false,
        unique: true,
      },
      Value: {
        type: DataTypes.INTEGER,
        allowNull: false,
      },
    },
    {
      tableName: 'Config',
      schema: 'dbo',
      timestamps: false,
      indexes: [{ unique: true, fields: ['Keys'] }],
    }
  );
  return Config;
}
