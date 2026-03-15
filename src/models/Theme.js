import { DataTypes } from 'sequelize';

export default function defineTheme(sequelize) {
  const Theme = sequelize.define(
    'Theme',
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
      ParentId: {
        type: DataTypes.INTEGER,
        allowNull: true,
      },
      SortOrder: {
        type: DataTypes.INTEGER,
        allowNull: false,
        defaultValue: 0,
      },
    },
    {
      tableName: 'Themes',
      schema: 'dbo',
      timestamps: false,
    }
  );

  return Theme;
}
