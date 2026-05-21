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

async function startServer() {
    await sequelize.authenticate();
    await sequelize.sync({ alter: true });
    console.log("Database connected.");

    const count = await Satellite.count();
    console.log(`Current satellite count in DB: ${count}`);

    if (count === 0) {
        console.log("Database empty. Starting initial sync...");
        await syncSatellites();
    } else {
        const { getCatalogStatus } = require("./services/satelliteCatalogService");
        const status = await getCatalogStatus();
        // If data is older than 1 hour (3600s), sync immediately on startup
        if (status.dataAgeSeconds === null || status.dataAgeSeconds > 3600) {
            console.log(`Catalog data is stale (${Math.round(status.dataAgeSeconds / 60)} minutes old). Triggering refresh...`);
            syncSatellites().catch(err => console.error("Initial stale sync failed:", err.message));
        } else {
            await seedCatalogHistoryIfMissing();
        }
    }

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

    // Periodic catalog sync every hour (3600000 ms)
    setInterval(async () => {
        try {
            console.log(`[${new Date().toISOString()}] Starting periodic catalog sync...`);
            const count = await syncSatellites();
            console.log(`[${new Date().toISOString()}] Periodic sync complete. Total satellites: ${count}`);
        } catch (error) {
            console.error(`[${new Date().toISOString()}] Periodic sync failed:`, error.message);
        }
    }, 3600000);
}

module.exports = {
    startServer
};
