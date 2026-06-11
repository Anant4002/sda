const { sequelize } = require("../db");
const { getCommonSchema } = require("./commonSchema");

const RocketBody = sequelize.define("RocketBody", getCommonSchema(), {
    tableName: "rocket_bodies",
    timestamps: false
});

module.exports = {
    RocketBody
};
