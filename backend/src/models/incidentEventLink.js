const { DataTypes } = require("sequelize");
const { sequelize } = require("../db");

const IncidentEventLink = sequelize.define("IncidentEventLink", {
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
        field: "alert_id",
        references: {
            model: "operational_alerts",
            key: "id"
        },
        onDelete: "CASCADE",
        onUpdate: "CASCADE"
    },
    alertCorrelationId: {
        type: DataTypes.INTEGER,
        allowNull: true,
        field: "alert_correlation_id",
        references: {
            model: "alert_correlations",
            key: "id"
        },
        onDelete: "SET NULL",
        onUpdate: "CASCADE"
    },
    eventKey: {
        type: DataTypes.STRING,
        allowNull: false,
        field: "event_key"
    },
    relationType: {
        type: DataTypes.STRING,
        allowNull: false,
        defaultValue: "member",
        field: "relation_type"
    },
    linkRole: {
        type: DataTypes.STRING,
        allowNull: false,
        defaultValue: "supporting",
        field: "link_role"
    },
    sourceType: {
        type: DataTypes.STRING,
        allowNull: true,
        field: "source_type"
    },
    moduleName: {
        type: DataTypes.STRING,
        allowNull: true,
        field: "module_name"
    },
    linkedAt: {
        type: DataTypes.DATE,
        allowNull: false,
        field: "linked_at"
    },
    metadata: {
        type: DataTypes.JSONB,
        allowNull: true
    }
}, {
    tableName: "incident_event_links",
    timestamps: true
});

module.exports = {
    IncidentEventLink
};
