const { Sequelize } = require("sequelize");
require("dotenv").config();

const sequelize = new Sequelize(process.env.DB_NAME, process.env.DB_USER, process.env.DB_PASSWORD, {
    host: process.env.DB_HOST,
    port: process.env.DB_PORT,
    dialect: "postgres",
    logging: false
});

async function main() {
    try {
        await sequelize.authenticate();
        console.log("DB Connected successfully.");
        const [versions] = await sequelize.query("SELECT COUNT(*) FROM satellite_catalog_versions");
        console.log("Versions Count:", versions);
        const [runs] = await sequelize.query("SELECT COUNT(*) FROM catalog_sync_runs");
        console.log("Sync Runs Count:", runs);
        const [runsList] = await sequelize.query("SELECT * FROM catalog_sync_runs LIMIT 5");
        console.log("Sync Runs Sample:", runsList);
    } catch (err) {
        console.error("DB Query failed:", err);
    } finally {
        await sequelize.close();
    }
}

main();
