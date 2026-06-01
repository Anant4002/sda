const { DataTypes } = require("sequelize");
const { sequelize } = require("../db");

const ThreatScore = sequelize.define("ThreatScore", {
    incidentGroupId: {
        type: DataTypes.INTEGER,
        allowNull: false,
        field: "incident_group_id",
        references: {
            model: "incident_groups",
            key: "id"
        }
    },
    score: {
        type: DataTypes.INTEGER,
        allowNull: false
    },
    priority: {
        type: DataTypes.STRING,
        allowNull: false
    },
    level: {
        type: DataTypes.STRING,
        allowNull: false,
        field: "level"
    },
    breakdown: {
        type: DataTypes.JSONB,
        allowNull: false
    },
    weightedCategories: {
        type: DataTypes.JSONB,
        allowNull: true,
        field: "weighted_categories"
    },
    sourceCount: {
        type: DataTypes.INTEGER,
        allowNull: false,
        defaultValue: 0,
        field: "source_count"
    },
    confidence: {
        type: DataTypes.FLOAT,
        allowNull: true
    },
    recommendedAction: {
        type: DataTypes.TEXT,
        allowNull: true,
        field: "recommended_action"
    },
    algorithmVersion: {
        type: DataTypes.STRING,
        allowNull: false,
        field: "algorithm_version"
    },
    modelVersion: {
        type: DataTypes.STRING,
        allowNull: true,
        field: "model_version"
    },
    computedAt: {
        type: DataTypes.DATE,
        allowNull: false,
        field: "computed_at"
    }
}, {
    tableName: "threat_scores",
    timestamps: true
});

module.exports = {
    ThreatScore
};
