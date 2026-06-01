const { DataTypes, Op } = require("sequelize");
const { sequelize } = require("../db");

async function deleteCorrelationChildren(where, transaction) {
    const { AlertCorrelation } = require("./alertCorrelation");
    const { IncidentEventLink } = require("./incidentEventLink");

    const alerts = await OperationalAlert.findAll({
        where,
        attributes: ["id"],
        raw: true,
        transaction
    });

    const alertIds = alerts.map((alert) => alert.id).filter((id) => Number.isFinite(Number(id)));
    if (!alertIds.length) {
        return;
    }

    await IncidentEventLink.destroy({
        where: {
            alertId: { [Op.in]: alertIds }
        },
        transaction
    });

    await AlertCorrelation.destroy({
        where: {
            alertId: { [Op.in]: alertIds }
        },
        transaction
    });
}

const OperationalAlert = sequelize.define("OperationalAlert", {
    eventKey: {
        type: DataTypes.STRING,
        allowNull: false,
        unique: true,
        field: "event_key"
    },
    alertType: {
        type: DataTypes.STRING,
        allowNull: false,
        field: "alert_type"
    },
    severity: {
        type: DataTypes.STRING,
        allowNull: false,
        defaultValue: "warning"
    },
    title: {
        type: DataTypes.STRING,
        allowNull: false
    },
    message: {
        type: DataTypes.TEXT,
        allowNull: false
    },
    primaryId: {
        type: DataTypes.STRING,
        allowNull: true,
        field: "primary_id"
    },
    secondaryId: {
        type: DataTypes.STRING,
        allowNull: true,
        field: "secondary_id"
    },
    closestDistanceKm: {
        type: DataTypes.FLOAT,
        allowNull: true,
        field: "closest_distance_km"
    },
    thresholdKm: {
        type: DataTypes.FLOAT,
        allowNull: true,
        field: "threshold_km"
    },
    horizonMinutes: {
        type: DataTypes.INTEGER,
        allowNull: true,
        field: "horizon_minutes"
    },
    occurredAt: {
        type: DataTypes.DATE,
        allowNull: false,
        field: "occurred_at"
    },
    sourceName: {
        type: DataTypes.STRING,
        allowNull: true,
        field: "source_name"
    },
    sourceType: {
        type: DataTypes.STRING,
        allowNull: true,
        field: "source_type"
    },
    trainingSessionId: {
        type: DataTypes.INTEGER,
        allowNull: true,
        field: "training_session_id"
    },
    details: {
        type: DataTypes.JSONB,
        allowNull: true
    }
}, {
    tableName: "operational_alerts",
    timestamps: true,
    hooks: {
        beforeBulkDestroy: async (options) => {
            await deleteCorrelationChildren(options.where || {}, options.transaction || null);
        }
    }
});

module.exports = {
    OperationalAlert
};
