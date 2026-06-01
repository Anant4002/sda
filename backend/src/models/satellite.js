const { DataTypes } = require("sequelize");
const { sequelize } = require("../db");

const Satellite = sequelize.define("Satellite", {
    name: { type: DataTypes.STRING, allowNull: false },
    line1: { type: DataTypes.STRING, allowNull: false },
    line2: { type: DataTypes.STRING, allowNull: false },
    noradId: {
        type: DataTypes.INTEGER,
        unique: true,
        field: "norad_id"
    },
    characterisation: {
        type: DataTypes.JSONB,
        allowNull: true
    },
    catalogStatus: {
        type: DataTypes.STRING,
        allowNull: false,
        defaultValue: "CORRELATED",
        field: "catalog_status"
    },
    dataSource: {
        type: DataTypes.STRING,
        allowNull: false,
        defaultValue: "CELESTRAK",
        field: "data_source"
    },
    intData: {
        type: DataTypes.JSONB,
        allowNull: true,
        field: "int_data"
    },
    isIndigenous: {
        type: DataTypes.BOOLEAN,
        allowNull: false,
        defaultValue: false,
        field: "is_indigenous"
    },
    lastObservedAt: {
        type: DataTypes.DATE,
        allowNull: true,
        field: "last_observed_at"
    },
    firstAddedAt: {
        type: DataTypes.DATE,
        allowNull: true,
        defaultValue: DataTypes.NOW,
        field: "first_added_at"
    }
}, {
    tableName: "satellites",
    timestamps: false
});

module.exports = {
    Satellite
};
