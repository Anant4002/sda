const { DataTypes } = require("sequelize");
const { sequelize } = require("../db");

const RapidExecution = sequelize.define("RapidExecution", {
    status: {
        type: DataTypes.STRING,
        allowNull: false,
        defaultValue: "pending"
    },
    startTime: {
        type: DataTypes.DATE,
        allowNull: false,
        defaultValue: DataTypes.NOW,
        field: "start_time"
    },
    endTime: {
        type: DataTypes.DATE,
        allowNull: true,
        field: "end_time"
    },
    summary: {
        type: DataTypes.JSONB,
        allowNull: true
    },
    errorMessage: {
        type: DataTypes.TEXT,
        allowNull: true,
        field: "error_message"
    }
}, {
    tableName: "rapid_executions",
    timestamps: true,
    underscored: true
});

module.exports = {
    RapidExecution
};
