require("dotenv").config();

const databaseConfig = {
    database: process.env.DB_NAME,
    username: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    host: process.env.DB_HOST,
    port: process.env.DB_PORT ? Number(process.env.DB_PORT) : undefined,
    dialect: "postgres",
    logging: false,
    pool: {
        max: process.env.DB_POOL_MAX ? Number(process.env.DB_POOL_MAX) : 10,
        min: process.env.DB_POOL_MIN ? Number(process.env.DB_POOL_MIN) : 0,
        acquire: process.env.DB_POOL_ACQUIRE_MS ? Number(process.env.DB_POOL_ACQUIRE_MS) : 30000,
        idle: process.env.DB_POOL_IDLE_MS ? Number(process.env.DB_POOL_IDLE_MS) : 10000
    }
};

const corsAllowedOrigins = process.env.CORS_ALLOWED_ORIGINS
    ? process.env.CORS_ALLOWED_ORIGINS.split(",").map((origin) => origin.trim()).filter(Boolean)
    : [];

const serverConfig = {
    port: process.env.PORT ? Number(process.env.PORT) : 3000,
    corsAllowedOrigins,
    apiKey: (process.env.API_KEY || "").trim(),
    syncApiKey: (process.env.SYNC_API_KEY || process.env.API_KEY || "").trim(),
    rateLimitWindowMs: process.env.RATE_LIMIT_WINDOW_MS ? Number(process.env.RATE_LIMIT_WINDOW_MS) : 60000,
    rateLimitMaxRequests: process.env.RATE_LIMIT_MAX_REQUESTS ? Number(process.env.RATE_LIMIT_MAX_REQUESTS) : 120,
    satelliteCacheTtlMs: process.env.SATELLITE_CACHE_TTL_MS ? Number(process.env.SATELLITE_CACHE_TTL_MS) : 300000
};

const tleSourceUrl = "https://celestrak.org/NORAD/elements/gp.php?GROUP=active&FORMAT=tle";
const catalogSource = {
    name: "CelesTrak Active Catalog",
    url: tleSourceUrl
};

const spacetrackConfig = {
    username: process.env.SPACETRACK_USERNAME || "",
    password: process.env.SPACETRACK_PASSWORD || "",
    debrisUrl: process.env.SPACETRACK_DEBRIS_URL || "",
    rocketBodiesUrl: process.env.SPACETRACK_ROCKET_BODIES_URL || ""
};

module.exports = {
    databaseConfig,
    serverConfig,
    tleSourceUrl,
    catalogSource,
    spacetrackConfig
};
