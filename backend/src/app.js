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

    // Security Hardening: Only serve the public and shared folders statically
    const projectRoot = path.resolve(__dirname, "..", "..");
    const publicPath = path.join(projectRoot, "public");
    
    app.use(express.static(publicPath));
    app.use("/shared", express.static(path.join(projectRoot, "shared")));

    // Serve the main HTML file as the root
    app.get("/", (req, res) => {
        res.sendFile(path.join(publicPath, "simulation.html"));
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
