const { createApp } = require("./app");
const { sequelize } = require("./db");
const { Satellite } = require("./models/satellite");
require("./models/satelliteCatalogVersion");
require("./models/catalogEvent");
require("./models/operationalAlert");
require("./models/satelliteTleRevision");
require("./models/rapidExecution");
require("./models/trainingScenario");
require("./models/trainingSession");
const { syncSatellites } = require("./services/satelliteSyncService");
const { cleanupStuckExecutions } = require("./services/rapidProcessingService");
const { seedCatalogHistoryIfMissing } = require("./services/satelliteCatalogService");
const { serverConfig } = require("./config");
const { startSchedulers } = require("./bootstrap/startSchedulers");

async function startServer() {
    await sequelize.authenticate();
    await sequelize.sync({ alter: true });
    console.log("Database connected.");

    const count = await Satellite.count();
    console.log(`Current satellite count in DB: ${count}`);

    // Cleanup any orphaned "running" tasks from previous sessions
    await cleanupStuckExecutions().catch(err => {
        console.error("Failed to cleanup stuck executions:", err);
    });

    const app = createApp();
    const server = app.listen(serverConfig.port, "0.0.0.0", () => {
        console.log(`Backend running on http://0.0.0.0:${serverConfig.port}`);
    });

    server.timeout = 180000; // 3 minutes timeout for heavy analysis tasks

    server.on("error", (error) => {
        console.error("Server failed to start:", error);
        process.exit(1);
    });

    server.on("close", () => {
        console.log("Server closed.");
    });

    setInterval(() => {
        console.log(`[${new Date().toISOString()}] Server heart-beat: Active handles: ${process._getActiveHandles().length}`);
    }, 10000);

    // Initialize centralized catalog sync orchestration
    await startSchedulers(count === 0).catch(err => {
        console.error("Failed to start schedulers:", err);
    });
}

module.exports = {
    startServer
};
