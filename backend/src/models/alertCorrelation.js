const { DataTypes } = require("sequelize");
const { sequelize } = require("../db");

const AlertCorrelation = sequelize.define("AlertCorrelation", {
    correlationKey: {
        type: DataTypes.STRING,
        allowNull: false,
        unique: true,
        field: "correlation_key"
    },
    incidentGroupId: {
        type: DataTypes.INTEGER,
        allowNull: false,
        field: "incident_group_id",
        references: {
            model: "incident_groups",
            key: "id"
        },
        onDelete: "CASCADE",
        onUpdate: "CASCADE"
    },
    alertId: {
        type: DataTypes.INTEGER,
        allowNull: false,
        unique: true,
        field: "alert_id",
        references: {
            model: "operational_alerts",
            key: "id"
        },
        onDelete: "CASCADE",
        onUpdate: "CASCADE"
    },
    correlationType: {
        type: DataTypes.STRING,
        allowNull: false,
        field: "correlation_type"
    },
    sourceType: {
        type: DataTypes.STRING,
        allowNull: true,
        field: "source_type"
    },
    sourceModule: {
        type: DataTypes.STRING,
        allowNull: true,
        field: "source_module"
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
    regionHash: {
        type: DataTypes.STRING,
        allowNull: true,
        field: "region_hash"
    },
    matchedCategories: {
        type: DataTypes.JSONB,
        allowNull: true,
        field: "matched_categories"
    },
    matchScore: {
        type: DataTypes.INTEGER,
        allowNull: false,
        defaultValue: 0,
        field: "match_score"
    },
    confidence: {
        type: DataTypes.FLOAT,
        allowNull: true
    },
    rationale: {
        type: DataTypes.TEXT,
        allowNull: true
    },
    summary: {
        type: DataTypes.TEXT,
        allowNull: true
    },
    decision: {
        type: DataTypes.STRING,
        allowNull: false,
        defaultValue: "merged"
    },
    windowStart: {
        type: DataTypes.DATE,
        allowNull: true,
        field: "window_start"
    },
    windowEnd: {
        type: DataTypes.DATE,
        allowNull: true,
        field: "window_end"
    },
    algorithmVersion: {
        type: DataTypes.STRING,
        allowNull: false,
        field: "algorithm_version"
    },
    metadata: {
        type: DataTypes.JSONB,
        allowNull: true
    }
}, {
    tableName: "alert_correlations",
    timestamps: true
});

module.exports = {
    AlertCorrelation
};
