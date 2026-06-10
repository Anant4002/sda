/**
 * Structured Logging — Dual Output (Console + Rotating File)
 *
 * Writes structured log lines to:
 *   1. Standard console (preserves existing dev-mode behaviour)
 *   2. logs/sda-YYYY-MM-DD.log  (JSON-lines format, new file each UTC day)
 *
 * Uses only Node.js built-ins — no additional npm packages required.
 * Log files older than LOG_RETENTION_DAYS (default 7) are pruned on startup.
 */

'use strict';

const fs = require('fs');
const path = require('path');

// ---------------------------------------------------------------------------
// Configuration
// ---------------------------------------------------------------------------
const LOG_DIR = path.resolve(process.cwd(), 'logs');
const LOG_RETENTION_DAYS = Number(process.env.LOG_RETENTION_DAYS) || 7;
const FILE_LOGGING_ENABLED = process.env.FILE_LOGGING !== 'false'; // opt-out via env

// ---------------------------------------------------------------------------
// Directory bootstrap + log rotation
// ---------------------------------------------------------------------------
function ensureLogDir() {
    try {
        if (!fs.existsSync(LOG_DIR)) {
            fs.mkdirSync(LOG_DIR, { recursive: true });
        }
    } catch (err) {
        // Non-fatal: file logging degrades gracefully
        console.warn('[LOGGER] Could not create log directory:', err.message);
    }
}

function pruneOldLogs() {
    try {
        const cutoff = Date.now() - LOG_RETENTION_DAYS * 24 * 60 * 60 * 1000;
        const files = fs.readdirSync(LOG_DIR);
        for (const file of files) {
            if (!/^sda-\d{4}-\d{2}-\d{2}\.log$/.test(file)) continue;
            const fullPath = path.join(LOG_DIR, file);
            const stat = fs.statSync(fullPath);
            if (stat.mtimeMs < cutoff) {
                fs.unlinkSync(fullPath);
            }
        }
    } catch (_) {
        // Non-fatal
    }
}

// Initialise file logging on module load
if (FILE_LOGGING_ENABLED) {
    ensureLogDir();
    pruneOldLogs();
}

// ---------------------------------------------------------------------------
// File writer — appends a single JSON-line per call
// ---------------------------------------------------------------------------
function getLogFilePath() {
    const now = new Date();
    const date = now.toISOString().slice(0, 10); // YYYY-MM-DD (UTC)
    return path.join(LOG_DIR, `sda-${date}.log`);
}

function writeToFile(level, context, message, meta) {
    if (!FILE_LOGGING_ENABLED) return;
    try {
        const entry = JSON.stringify({
            timestamp: new Date().toISOString(),
            level,
            context,
            message,
            ...(meta && Object.keys(meta).length ? { meta } : {})
        });
        fs.appendFileSync(getLogFilePath(), entry + '\n', 'utf8');
    } catch (_) {
        // Non-fatal: file write failures must never crash the server
    }
}

// ---------------------------------------------------------------------------
// Console formatter (preserves the original format)
// ---------------------------------------------------------------------------
function formatMessage(level, context, message, meta) {
    const timestamp = new Date().toISOString();
    const metaString = meta && Object.keys(meta).length ? ` | ${JSON.stringify(meta)}` : '';
    return `[${timestamp}] [${level}] [${context}] ${message}${metaString}`;
}

// ---------------------------------------------------------------------------
// Public logger API
// ---------------------------------------------------------------------------
const logger = {
    info: (context, message, meta = {}) => {
        console.log(formatMessage('INFO', context, message, meta));
        writeToFile('INFO', context, message, meta);
    },
    warn: (context, message, meta = {}) => {
        console.warn(formatMessage('WARN', context, message, meta));
        writeToFile('WARN', context, message, meta);
    },
    error: (context, message, error, meta = {}) => {
        const errorMeta = error ? { error: error.message, stack: error.stack } : {};
        const combined = { ...meta, ...errorMeta };
        console.error(formatMessage('ERROR', context, message, combined));
        writeToFile('ERROR', context, message, combined);
    },
    debug: (context, message, meta = {}) => {
        if (process.env.DEBUG_LOGGING === 'true') {
            console.log(formatMessage('DEBUG', context, message, meta));
            writeToFile('DEBUG', context, message, meta);
        }
    }
};

module.exports = { logger };
