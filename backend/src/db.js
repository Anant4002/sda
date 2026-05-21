const { Sequelize } = require("sequelize");
const { databaseConfig } = require("./config");

const sequelize = new Sequelize(
    databaseConfig.database,
    databaseConfig.username,
    databaseConfig.password,
    databaseConfig
);

module.exports = {
    sequelize
};
