/**
 * Structured Logging Foundation
 */

function formatMessage(level, context, message, meta) {
    const timestamp = new Date().toISOString();
    const metaString = meta && Object.keys(meta).length ? ` | ${JSON.stringify(meta)}` : "";
    return `[${timestamp}] [${level}] [${context}] ${message}${metaString}`;
}

const logger = {
    info: (context, message, meta = {}) => {
        console.log(formatMessage("INFO", context, message, meta));
    },
    warn: (context, message, meta = {}) => {
        console.warn(formatMessage("WARN", context, message, meta));
    },
    error: (context, message, error, meta = {}) => {
        const errorMeta = error ? { error: error.message, stack: error.stack } : {};
        console.error(formatMessage("ERROR", context, message, { ...meta, ...errorMeta }));
    },
    debug: (context, message, meta = {}) => {
        if (process.env.DEBUG_LOGGING === "true") {
            console.log(formatMessage("DEBUG", context, message, meta));
        }
    }
};

module.exports = { logger };
