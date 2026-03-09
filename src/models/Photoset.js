import { DataTypes } from 'sequelize';

export default function definePhotoset(sequelize) {
  const Photoset = sequelize.define(
    'Photoset',
    {
      Id: {
        type: DataTypes.INTEGER,
        autoIncrement: true,
        primaryKey: true,
        allowNull: false,
      },
      PhotosetConfigId: {
        type: DataTypes.INTEGER,
        allowNull: false,
        references: { model: 'PhotosetConfigs', key: 'Id' },
      },
      PresetId: {
        type: DataTypes.INTEGER,
        allowNull: false,
        references: { model: 'Presets', key: 'Id' },
      },
    },
    {
      tableName: 'Photosets',
      schema: 'dbo',
      timestamps: false,
      indexes: [
        { fields: ['PhotosetConfigId'] },
        { fields: ['PresetId'] },
      ],
    }
  );

  return Photoset;
}

