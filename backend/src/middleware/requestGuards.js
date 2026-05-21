const { serverConfig } = require("../config");
const { logger } = require("../utils/logger");
const { OperationalError } = require("../utils/errors");

function getClientIp(req) {
    const forwardedFor = req.headers["x-forwarded-for"];
    const forwardedIp = Array.isArray(forwardedFor) ? forwardedFor[0] : forwardedFor?.split(",")[0];
    return (forwardedIp || req.ip || req.socket?.remoteAddress || "").trim();
}

function isLoopbackIp(ipAddress) {
    return ipAddress === "::1" || ipAddress === "127.0.0.1" || ipAddress === "::ffff:127.0.0.1";
}

function getBearerToken(headerValue) {
    if (!headerValue || typeof headerValue !== "string") {
        return "";
    }

    const match = headerValue.match(/^Bearer\s+(.+)$/i);
    return match ? match[1].trim() : "";
}

function requireApiKey(req, res, next) {
    const expectedKey = serverConfig.apiKey;
    if (!expectedKey) {
        return next();
    }

    const suppliedKey = req.get("x-api-key") || getBearerToken(req.get("authorization"));
    if (suppliedKey === expectedKey) {
        return next();
    }

    return res.status(401).json({
        error: "Unauthorized",
        message: "A valid API key is required for this endpoint."
    });
}

function requireSyncAccess(req, res, next) {
    const expectedKey = serverConfig.syncApiKey;
    const clientIp = getClientIp(req);

    if (expectedKey) {
        const suppliedKey = req.get("x-api-key") || getBearerToken(req.get("authorization"));
        if (suppliedKey === expectedKey) {
            return next();
        }

        return res.status(401).json({
            error: "Unauthorized",
            message: "A valid API key is required to trigger a sync."
        });
    }

    if (isLoopbackIp(clientIp)) {
        return next();
    }

    return res.status(403).json({
        error: "Forbidden",
        message: "Sync requests are only allowed from localhost unless SYNC_API_KEY is configured."
    });
}

function createRateLimiter() {
    const requestBuckets = new Map();

    return function rateLimiter(req, res, next) {
        const now = Date.now();
        const key = `${getClientIp(req)}:${req.path}`;
        const currentBucket = requestBuckets.get(key);

        if (!currentBucket || now - currentBucket.windowStart >= serverConfig.rateLimitWindowMs) {
            requestBuckets.set(key, {
                count: 1,
                windowStart: now
            });
            return next();
        }

        currentBucket.count += 1;
        if (currentBucket.count <= serverConfig.rateLimitMaxRequests) {
            return next();
        }

        res.set("Retry-After", String(Math.ceil(serverConfig.rateLimitWindowMs / 1000)));
        return res.status(429).json({
            error: "Too Many Requests",
            message: "Rate limit exceeded. Please retry shortly."
        });
    };
}

function validateJsonBody(req, res, next) {
    if (req.method === "GET") {
        return next();
    }

    if (!req.is("application/json") && req.get("content-length") && Number(req.get("content-length")) > 0) {
        return res.status(415).json({
            error: "Unsupported Media Type",
            message: "Only application/json request bodies are supported."
        });
    }

    return next();
}

function validateSatelliteQuery(req, res, next) {
    const { limit, offset, search } = req.query;

    if (limit !== undefined) {
        const parsedLimit = Number.parseInt(limit, 10);
        if (!Number.isInteger(parsedLimit) || parsedLimit < 1 || parsedLimit > 5000) {
            return res.status(400).json({
                error: "Invalid Query",
                message: "limit must be an integer between 1 and 5000."
            });
        }
    }

    if (offset !== undefined) {
        const parsedOffset = Number.parseInt(offset, 10);
        if (!Number.isInteger(parsedOffset) || parsedOffset < 0) {
            return res.status(400).json({
                error: "Invalid Query",
                message: "offset must be a non-negative integer."
            });
        }
    }

    if (search !== undefined && (typeof search !== "string" || search.trim().length > 80)) {
        return res.status(400).json({
            error: "Invalid Query",
            message: "search must be a string up to 80 characters."
        });
    }

    return next();
}

function handleError(error, req, res, next) {
    if (res.headersSent) {
        return next(error);
    }

    logger.error("HTTP", `Error processing ${req.method} ${req.originalUrl}`, error, {
        requestId: req.id,
        body: req.body,
        query: req.query
    });

    if (error instanceof OperationalError) {
        const statusMap = {
            ValidationError: 400,
            AnalysisTimeoutError: 504,
            ExternalSourceError: 502,
            PropagationError: 422,
            ConfigurationError: 500
        };
        const status = statusMap[error.name] || 400;
        return res.status(status).json({
            error: error.name,
            message: error.message,
            details: error.details
        });
    }

    return res.status(error.statusCode || 500).json({
        error: "Internal Server Error",
        message: error.expose ? error.message : "Unexpected server error."
    });
}

module.exports = {
    createRateLimiter,
    handleError,
    requireApiKey,
    requireSyncAccess,
    validateJsonBody,
    validateSatelliteQuery
};
