const express = require("express");
const cors = require("cors");
const path = require("path");
const { randomUUID } = require("node:crypto");
const { serverConfig } = require("./config");
const { satelliteRouter } = require("./routes/satelliteRoutes");
const { trainingRouter } = require("./routes/trainingRoutes");
const { correlationRouter } = require("./routes/correlationRoutes");
const { logger } = require("./utils/logger");
const {
    createRateLimiter,
    handleError,
    validateJsonBody
} = require("./middleware/requestGuards");

function createApp() {
    const app = express();
    app.use((req, res, next) => {
        req.id = randomUUID();
        const start = performance.now();
        res.on("finish", () => {
            const duration = Math.round(performance.now() - start);
            logger.info("HTTP", `${req.method} ${req.originalUrl} -> ${res.statusCode}`, {
                durationMs: duration,
                requestId: req.id,
                ip: req.ip
            });
        });
        next();
    });
    app.use(cors({
        origin(origin, callback) {
            if (!origin) {
                return callback(null, true);
            }

            if (serverConfig.corsAllowedOrigins.includes(origin)) {
                return callback(null, true);
            }

            try {
                const parsedOrigin = new URL(origin);
                const isLocalhost = parsedOrigin.hostname === "localhost" || parsedOrigin.hostname === "127.0.0.1" || parsedOrigin.hostname === "::1";
                if (isLocalhost) {
                    return callback(null, true);
                }
            } catch (error) {
                // Ignore malformed origins and fall through to denial.
            }

            return callback(null, false);
        }
    }));
    app.use(createRateLimiter());
    app.use(validateJsonBody);
    app.use(express.json({ limit: "64kb" }));

    // Serve static files from the project root (HTML, JS, data)
    const projectRoot = path.resolve(__dirname, "..", "..");
    app.use(express.static(projectRoot));

    // Serve the main HTML file as the root
    app.get("/", (req, res) => {
        res.sendFile(path.join(projectRoot, "simulation.html"));
    });

    // API routes
    app.use("/api", satelliteRouter);
    app.use("/api/training", trainingRouter);
    app.use("/api/threat-insights", correlationRouter);
    app.use(handleError);
    return app;
}

module.exports = {
    createApp
};
