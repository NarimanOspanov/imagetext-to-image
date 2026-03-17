import { DataTypes } from 'sequelize';

export default function definePhotosetConfigTheme(sequelize) {
  const PhotosetConfigTheme = sequelize.define(
    'PhotosetConfigTheme',
    {
      PhotosetConfigId: {
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
      tableName: 'PhotosetConfigThemes',
      schema: 'dbo',
      timestamps: false,
    }
  );
  return PhotosetConfigTheme;
}
