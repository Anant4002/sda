const { DataTypes } = require("sequelize");
const { sequelize } = require("../db");
const { CatalogSyncRun } = require("./catalogSyncRun");

const CatalogSyncNewSatellite = sequelize.define("CatalogSyncNewSatellite", {
    syncRunId: {
        type: DataTypes.INTEGER,
        allowNull: false,
        field: "sync_run_id",
        references: {
            model: CatalogSyncRun,
            key: "id"
        }
    },
    noradId: {
        type: DataTypes.INTEGER,
        allowNull: false,
        field: "norad_id"
    },
    detectedAt: {
        type: DataTypes.DATE,
        allowNull: false,
        field: "detected_at"
    }
}, {
    tableName: "catalog_sync_new_satellites",
    timestamps: false
});

module.exports = {
    CatalogSyncNewSatellite
};
