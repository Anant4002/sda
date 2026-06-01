const { DataTypes } = require("sequelize");
const { sequelize } = require("../db");

const CorrelationRule = sequelize.define("CorrelationRule", {
    ruleKey: {
        type: DataTypes.STRING,
        allowNull: false,
        unique: true,
        field: "rule_key"
    },
    ruleType: {
        type: DataTypes.STRING,
        allowNull: false,
        field: "rule_type"
    },
    category: {
        type: DataTypes.STRING,
        allowNull: true
    },
    enabled: {
        type: DataTypes.BOOLEAN,
        allowNull: false,
        defaultValue: true
    },
    weight: {
        type: DataTypes.FLOAT,
        allowNull: false,
        defaultValue: 0
    },
    minScore: {
        type: DataTypes.INTEGER,
        allowNull: true,
        field: "min_score"
    },
    maxScore: {
        type: DataTypes.INTEGER,
        allowNull: true,
        field: "max_score"
    },
    priority: {
        type: DataTypes.STRING,
        allowNull: true
    },
    recommendationText: {
        type: DataTypes.TEXT,
        allowNull: true,
        field: "recommendation_text"
    },
    description: {
        type: DataTypes.TEXT,
        allowNull: true
    },
    requiredCategories: {
        type: DataTypes.JSONB,
        allowNull: true,
        field: "required_categories"
    },
    requiredClassifications: {
        type: DataTypes.JSONB,
        allowNull: true,
        field: "required_classifications"
    },
    windowMinutes: {
        type: DataTypes.INTEGER,
        allowNull: true,
        field: "window_minutes"
    },
    config: {
        type: DataTypes.JSONB,
        allowNull: true
    }
}, {
    tableName: "correlation_rules",
    timestamps: true
});

module.exports = {
    CorrelationRule
};
