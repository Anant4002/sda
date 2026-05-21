require("dotenv").config();

const databaseConfig = {
    database: process.env.DB_NAME || "Satellite",
    username: process.env.DB_USER || "postgres",
    password: process.env.DB_PASSWORD || "1234",
    host: process.env.DB_HOST || "127.0.0.1",
    dialect: "postgres",
    logging: false,
    pool: {
        max: Number(process.env.DB_POOL_MAX || 10),
        min: Number(process.env.DB_POOL_MIN || 0),
        acquire: Number(process.env.DB_POOL_ACQUIRE_MS || 30000),
        idle: Number(process.env.DB_POOL_IDLE_MS || 10000)
    }
};

const defaultAllowedOrigins = [
    "http://localhost:3000",
    "http://127.0.0.1:3000",
    "http://localhost:5500",
    "http://127.0.0.1:5500",
    "null"
];

const corsAllowedOrigins = (process.env.CORS_ALLOWED_ORIGINS || defaultAllowedOrigins.join(","))
    .split(",")
    .map((origin) => origin.trim())
    .filter(Boolean);

const serverConfig = {
    port: Number(process.env.PORT || 3000),
    corsAllowedOrigins,
    apiKey: (process.env.API_KEY || "").trim(),
    syncApiKey: (process.env.SYNC_API_KEY || process.env.API_KEY || "").trim(),
    rateLimitWindowMs: Number(process.env.RATE_LIMIT_WINDOW_MS || 60000),
    rateLimitMaxRequests: Number(process.env.RATE_LIMIT_MAX_REQUESTS || 120),
    satelliteCacheTtlMs: Number(process.env.SATELLITE_CACHE_TTL_MS || 300000)
};

const tleSourceUrl = "https://celestrak.org/NORAD/elements/gp.php?GROUP=active&FORMAT=tle";
const catalogSource = {
    name: "CelesTrak Active Catalog",
    url: tleSourceUrl
};

module.exports = {
    databaseConfig,
    serverConfig,
    tleSourceUrl,
    catalogSource
};
