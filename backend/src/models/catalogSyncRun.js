const { DataTypes } = require("sequelize");
const { sequelize } = require("../db");

const CatalogSyncRun = sequelize.define("CatalogSyncRun", {
    startedAt: {
        type: DataTypes.DATE,
        allowNull: false,
        field: "started_at"
    },
    completedAt: {
        type: DataTypes.DATE,
        allowNull: false,
        field: "completed_at"
    },
    totalBefore: {
        type: DataTypes.INTEGER,
        allowNull: false,
        field: "total_before"
    },
    totalAfter: {
        type: DataTypes.INTEGER,
        allowNull: false,
        field: "total_after"
    },
    newSatellitesFound: {
        type: DataTypes.INTEGER,
        allowNull: false,
        field: "new_satellites_found"
    }
}, {
    tableName: "catalog_sync_runs",
    timestamps: false
});

module.exports = {
    CatalogSyncRun
};
