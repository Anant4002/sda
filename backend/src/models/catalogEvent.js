const { DataTypes } = require("sequelize");
const { sequelize } = require("../db");
const { SatelliteCatalogVersion } = require("./satelliteCatalogVersion");

const CatalogEvent = sequelize.define("CatalogEvent", {
    eventType: {
        type: DataTypes.STRING,
        allowNull: false
    },
    severity: {
        type: DataTypes.STRING,
        allowNull: false,
        defaultValue: "info"
    },
    message: {
        type: DataTypes.STRING,
        allowNull: false
    },
    details: {
        type: DataTypes.JSONB,
        allowNull: true
    },
    sourceName: {
        type: DataTypes.STRING,
        allowNull: true
    },
    sourceUrl: {
        type: DataTypes.STRING,
        allowNull: true
    },
    versionId: {
        type: DataTypes.INTEGER,
        allowNull: true,
        field: "version_id",
        references: {
            model: SatelliteCatalogVersion,
            key: "id"
        }
    }
}, {
    tableName: "catalog_events",
    timestamps: true
});

module.exports = {
    CatalogEvent
};
