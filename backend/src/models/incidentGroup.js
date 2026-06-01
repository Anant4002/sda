const { DataTypes } = require("sequelize");
const { sequelize } = require("../db");

const IncidentGroup = sequelize.define("IncidentGroup", {
    incidentUid: {
        type: DataTypes.STRING,
        allowNull: false,
        unique: true,
        field: "incident_uid"
    },
    incidentKey: {
        type: DataTypes.STRING,
        allowNull: false,
        field: "incident_key"
    },
    title: {
        type: DataTypes.STRING,
        allowNull: false
    },
    summary: {
        type: DataTypes.TEXT,
        allowNull: true
    },
    recommendation: {
        type: DataTypes.TEXT,
        allowNull: true
    },
    priority: {
        type: DataTypes.STRING,
        allowNull: false,
        defaultValue: "LOW"
    },
    status: {
        type: DataTypes.STRING,
        allowNull: false,
        defaultValue: "open"
    },
    assetClassification: {
        type: DataTypes.STRING,
        allowNull: false,
        defaultValue: "UNKNOWN",
        field: "asset_classification"
    },
    threatCategory: {
        type: DataTypes.STRING,
        allowNull: false,
        defaultValue: "general",
        field: "threat_category"
    },
    primarySatelliteId: {
        type: DataTypes.INTEGER,
        allowNull: true,
        field: "primary_satellite_id",
        references: {
            model: "satellites",
            key: "id"
        }
    },
    secondarySatelliteId: {
        type: DataTypes.INTEGER,
        allowNull: true,
        field: "secondary_satellite_id",
        references: {
            model: "satellites",
            key: "id"
        }
    },
    trainingSessionId: {
        type: DataTypes.INTEGER,
        allowNull: true,
        field: "training_session_id",
        references: {
            model: "training_sessions",
            key: "id"
        }
    },
    primaryObjectName: {
        type: DataTypes.STRING,
        allowNull: true,
        field: "primary_object_name"
    },
    secondaryObjectName: {
        type: DataTypes.STRING,
        allowNull: true,
        field: "secondary_object_name"
    },
    regionName: {
        type: DataTypes.STRING,
        allowNull: true,
        field: "region_name"
    },
    regionHash: {
        type: DataTypes.STRING,
        allowNull: true,
        field: "region_hash"
    },
    firstDetectedAt: {
        type: DataTypes.DATE,
        allowNull: false,
        field: "first_detected_at"
    },
    lastDetectedAt: {
        type: DataTypes.DATE,
        allowNull: false,
        field: "last_detected_at"
    },
    lastCorrelationAt: {
        type: DataTypes.DATE,
        allowNull: false,
        field: "last_correlation_at"
    },
    eventCount: {
        type: DataTypes.INTEGER,
        allowNull: false,
        defaultValue: 0,
        field: "event_count"
    },
    linkCount: {
        type: DataTypes.INTEGER,
        allowNull: false,
        defaultValue: 0,
        field: "link_count"
    },
    confidence: {
        type: DataTypes.FLOAT,
        allowNull: true
    },
    threatScore: {
        type: DataTypes.INTEGER,
        allowNull: false,
        defaultValue: 0,
        field: "threat_score"
    },
    categorySummary: {
        type: DataTypes.JSONB,
        allowNull: true,
        field: "category_summary"
    },
    sourceTypes: {
        type: DataTypes.JSONB,
        allowNull: true,
        field: "source_types"
    },
    metadata: {
        type: DataTypes.JSONB,
        allowNull: true
    }
}, {
    tableName: "incident_groups",
    timestamps: true
});

module.exports = {
    IncidentGroup
};
