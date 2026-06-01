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
const { cleanupStuckExecutions } = require("./services/rapidProcessingService");
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

    const http = require("http");
    const app = createApp();
    const server = http.createServer(app);

    // Track active client TCP sockets BEFORE server starts listening
    const activeSockets = new Set();
    server.on("connection", (socket) => {
        activeSockets.add(socket);
        socket.on("close", () => {
            activeSockets.delete(socket);
        });
    });

    server.listen(serverConfig.port, "0.0.0.0", () => {
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

    const heartbeatInterval = setInterval(() => {
        console.log(`[${new Date().toISOString()}] Server heart-beat: Active handles: ${process._getActiveHandles().length}`);
    }, 10000);

    // Initialize centralized catalog sync orchestration
    await startSchedulers(count === 0).catch(err => {
        console.error("Failed to start schedulers:", err);
    });

    let isShuttingDown = false;
    async function gracefulShutdown(signal) {
        if (isShuttingDown) return;
        isShuttingDown = true;

        console.log(`\n[${signal}] Graceful shutdown initiated...`);

        // Set safety timeout to prevent hanging on client connections
        const forceExitTimeout = setTimeout(() => {
            console.warn("Forced shutdown due to timeout.");
            process.exit(1);
        }, 3000);
        forceExitTimeout.unref();

        // 1. Clear heartbeat interval
        clearInterval(heartbeatInterval);

        // 2. Stop schedulers
        try {
            const { stopCatalogSyncScheduler } = require("./services/catalogSyncScheduler");
            stopCatalogSyncScheduler();
        } catch (schedErr) {
            console.error("Error stopping schedulers:", schedErr);
        }

        // 3. Close database connection
        try {
            await sequelize.close();
            console.log("Database connection closed.");
        } catch (dbErr) {
            console.error("Error closing database connection:", dbErr);
        }

        // 4. Forcefully destroy all active connections with TCP RST to bypass TIME_WAIT
        if (activeSockets.size > 0) {
            console.log(`Destroying ${activeSockets.size} active TCP connections with TCP RST to prevent TIME_WAIT...`);
            for (const socket of activeSockets) {
                try {
                    if (typeof socket.setLinger === "function") {
                        socket.setLinger(true, 0);
                    }
                    socket.destroy();
                } catch (err) {}
            }
            activeSockets.clear();
        }

        // 5. Close Express server
        if (server) {
            server.close(() => {
                console.log("HTTP server closed.");
                clearTimeout(forceExitTimeout);
                process.exit(0);
            });
        } else {
            clearTimeout(forceExitTimeout);
            process.exit(0);
        }
    }

    process.on("SIGINT", () => gracefulShutdown("SIGINT"));
    process.on("SIGTERM", () => gracefulShutdown("SIGTERM"));
}

module.exports = {
    startServer
};
