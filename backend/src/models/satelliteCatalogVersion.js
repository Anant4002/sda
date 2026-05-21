const { DataTypes } = require("sequelize");
const { sequelize } = require("../db");

const SatelliteCatalogVersion = sequelize.define("SatelliteCatalogVersion", {
    sourceName: {
        type: DataTypes.STRING,
        allowNull: false
    },
    sourceUrl: {
        type: DataTypes.STRING,
        allowNull: false
    },
    fetchedAt: {
        type: DataTypes.DATE,
        allowNull: false
    },
    syncedAt: {
        type: DataTypes.DATE,
        allowNull: false
    },
    recordCount: {
        type: DataTypes.INTEGER,
        allowNull: false
    },
    checksum: {
        type: DataTypes.STRING,
        allowNull: true
    },
    status: {
        type: DataTypes.STRING,
        allowNull: false,
        defaultValue: "success"
    },
    errorMessage: {
        type: DataTypes.TEXT,
        allowNull: true
    }
}, {
    tableName: "satellite_catalog_versions",
    timestamps: true
});

module.exports = {
    SatelliteCatalogVersion
};
