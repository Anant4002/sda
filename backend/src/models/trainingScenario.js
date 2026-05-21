const { DataTypes } = require("sequelize");
const { sequelize } = require("../db");

const TrainingScenario = sequelize.define("TrainingScenario", {
    name: {
        type: DataTypes.STRING,
        allowNull: false
    },
    description: {
        type: DataTypes.TEXT,
        allowNull: true
    },
    initialStartTime: {
        type: DataTypes.DATE,
        allowNull: false,
        field: "initial_start_time"
    },
    events: {
        type: DataTypes.JSONB,
        allowNull: false,
        defaultValue: []
    }
}, {
    tableName: "training_scenarios",
    timestamps: true,
    underscored: true
});

module.exports = {
    TrainingScenario
};
