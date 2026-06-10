const { startCatalogSyncScheduler } = require("../services/catalogSyncScheduler");
const { purgeStaleTleRevisions } = require("../services/tleRetentionService");
const { logger } = require("../utils/logger");

const TWENTY_FOUR_HOURS_MS = 24 * 60 * 60 * 1000;

/**
 * Schedule the nightly TLE retention purge.
 * Delayed by 60 seconds on startup to avoid competing with the initial catalog sync.
 */
function scheduleTleRetentionPurge() {
    // First run: 60 seconds after startup
    const firstRunDelay = 60 * 1000;
    setTimeout(async () => {
        try {
            const result = await purgeStaleTleRevisions();
            logger.info("Scheduler", "Scheduled TLE retention purge complete", result);
        } catch (err) {
            logger.error("Scheduler", "Scheduled TLE retention purge failed", err);
        }

        // Subsequent runs: every 24 hours
        setInterval(async () => {
            try {
                const result = await purgeStaleTleRevisions();
                logger.info("Scheduler", "Scheduled TLE retention purge complete", result);
            } catch (err) {
                logger.error("Scheduler", "Scheduled TLE retention purge failed", err);
            }
        }, TWENTY_FOUR_HOURS_MS);
    }, firstRunDelay);
}

async function startSchedulers(isDatabaseEmpty) {
    await startCatalogSyncScheduler(isDatabaseEmpty);
    scheduleTleRetentionPurge();
}

module.exports = { startSchedulers };
