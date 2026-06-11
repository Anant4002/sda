const { sequelize } = require("../db");
const { getCommonSchema } = require("./commonSchema");

const Debris = sequelize.define("Debris", getCommonSchema(), {
    tableName: "debris",
    timestamps: false
});

module.exports = {
    Debris
};
