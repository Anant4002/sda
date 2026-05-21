const { DataTypes } = require("sequelize");
const { sequelize } = require("../db");

const TrainingSession = sequelize.define("TrainingSession", {
    scenarioId: {
        type: DataTypes.INTEGER,
        allowNull: true,
        field: "scenario_id"
    },
    sessionName: {
        type: DataTypes.STRING,
        allowNull: false,
        field: "session_name"
    },
    status: {
        type: DataTypes.STRING,
        allowNull: false,
        defaultValue: "active" // active, paused, finished
    },
    startTime: {
        type: DataTypes.DATE,
        allowNull: false,
        field: "start_time"
    },
    currentSimTime: {
        type: DataTypes.DATE,
        allowNull: false,
        field: "current_sim_time"
    },
    speed: {
        type: DataTypes.FLOAT,
        allowNull: false,
        defaultValue: 1.0
    },
    lastUpdateRealTime: {
        type: DataTypes.DATE,
        allowNull: false,
        field: "last_update_real_time"
    }
}, {
    tableName: "training_sessions",
    timestamps: true,
    underscored: true
});

module.exports = {
    TrainingSession
};
