const { syncSatellites } = require("./satelliteSyncService");
const { getCatalogStatus, seedCatalogHistoryIfMissing } = require("./satelliteCatalogService");

/**
 * PRODUCTION-GRADE CATALOG SYNC SCHEDULER
 * 
 * DESIGN NOTES:
 * - Single-instance assumption: This scheduler assumes a single backend process. 
 *   In a horizontally scaled environment, a distributed lock (e.g., Redis) 
 *   must be integrated into the `syncInProgress` check.
 * - Non-blocking startup: Stale checks trigger async syncs to prevent platform boot delays.
 * - Self-rescheduling: Uses setTimeout recursion to prevent interval drift and overlaps.
 */

let syncInProgress = false;
let schedulerTimeout = null;
let nextSyncTime = null;

// Operational Metrics & State
const state = {
    status: "HEALTHY", // HEALTHY, SYNCING, STALE, DEGRADED, FAILED, RECOVERING
    consecutiveFailures: 0,
    lastSuccessAt: null,
    lastFailureAt: null,
    lastFailureReason: null,
    lastSyncDurationMs: null,
    isInitialized: false
};

const CONFIG = {
    NORMAL_INTERVAL_MS: 60 * 60 * 1000,    // 1 hour
    RETRY_BACKOFFS_MS: [
        5 * 60 * 1000,   // 5 mins
        15 * 60 * 1000,  // 15 mins
        30 * 60 * 1000   // 30 mins
    ],
    STALE_THRESHOLD_MS: 90 * 60 * 1000    // 1.5 hours
};

async function runSyncCycle(reason = "scheduled") {
    if (syncInProgress) {
        console.warn(`[Scheduler] Sync cycle skipped: already in progress. Reason: ${reason}`);
        return;
    }

    const previousStatus = state.status;
    syncInProgress = true;
    state.status = "SYNCING";
    const startTime = Date.now();

    try {
        console.log(`[Scheduler] Executing sync cycle. Reason: ${reason}`);
        const count = await syncSatellites();

        state.lastSuccessAt = new Date();
        state.lastSyncDurationMs = Date.now() - startTime;
        state.consecutiveFailures = 0;
        state.status = "HEALTHY";
        state.lastFailureReason = null;

        console.log(`[Scheduler] Sync success. Count: ${count}. Duration: ${state.lastSyncDurationMs}ms.`);
    } catch (error) {
        state.lastFailureAt = new Date();
        state.lastFailureReason = error.message;
        state.consecutiveFailures++;
        state.lastSyncDurationMs = Date.now() - startTime;

        // Determine health state based on failure depth
        if (state.consecutiveFailures === 1) {
            state.status = "DEGRADED";
        } else if (state.consecutiveFailures > 3) {
            state.status = "FAILED";
        } else {
            state.status = "RECOVERING";
        }

        console.error(`[Scheduler] Sync failure (Attempt ${state.consecutiveFailures}). Error: ${error.message}`);
    } finally {
        syncInProgress = false;
        scheduleNext();
    }
}

function scheduleNext() {
    if (schedulerTimeout) {
        clearTimeout(schedulerTimeout);
    }

    let delay = CONFIG.NORMAL_INTERVAL_MS;

    // Apply exponential backoff if in error state
    if (state.consecutiveFailures > 0) {
        const backoffIndex = Math.min(state.consecutiveFailures - 1, CONFIG.RETRY_BACKOFFS_MS.length - 1);
        delay = CONFIG.RETRY_BACKOFFS_MS[backoffIndex];
        console.log(`[Scheduler] Entering backoff. Retrying in ${delay / 60000} minutes.`);
    }

    nextSyncTime = new Date(Date.now() + delay);
    schedulerTimeout = setTimeout(() => {
        runSyncCycle("scheduled_timeout");
    }, delay);

    console.log(`[Scheduler] Next cycle scheduled for ${nextSyncTime.toISOString()}`);
}

async function startCatalogSyncScheduler(isDatabaseEmpty) {
    if (state.isInitialized) {
        console.warn("[Scheduler] Initialization aborted: Scheduler already running.");
        return;
    }

    console.log("[Scheduler] Initializing...");
    state.isInitialized = true;

    if (isDatabaseEmpty) {
        console.log("[Scheduler] DB Empty. Triggering initial async sync.");
        runSyncCycle("initial_bootstrap");
    } else {
        const catalogStatus = await getCatalogStatus();
        state.lastSuccessAt = catalogStatus.latestVersion ? new Date(catalogStatus.latestVersion.syncedAt) : null;

        const isStale = !state.lastSuccessAt || (Date.now() - state.lastSuccessAt.getTime() > CONFIG.NORMAL_INTERVAL_MS);

        if (isStale) {
            const ageMins = state.lastSuccessAt ? Math.round((Date.now() - state.lastSuccessAt.getTime()) / 60000) : "N/A";
            console.log(`[Scheduler] Data is stale (${ageMins}m old). Triggering immediate refresh.`);
            runSyncCycle("startup_stale_check");
        } else {
            console.log("[Scheduler] Data is fresh. Seeding history and scheduling in background.");
            setImmediate(async () => {
                try {
                    await seedCatalogHistoryIfMissing();
                } catch (err) {
                    console.error("[Scheduler] Background seeding failed:", err.message);
                }
                scheduleNext();
            });
        }
    }
}

/**
 * Returns a rich telemetry object for the UI and monitoring.
 */
function getSchedulerStatus() {
    // Derived health check: Even if the loop is "HEALTHY", if data age exceeds threshold, mark as STALE
    let effectiveStatus = state.status;
    const now = Date.now();
    const ageMs = state.lastSuccessAt ? now - state.lastSuccessAt.getTime() : Infinity;

    if (state.status === "HEALTHY" && ageMs > CONFIG.STALE_THRESHOLD_MS) {
        effectiveStatus = "STALE";
    }

    return {
        status: effectiveStatus,
        healthy: effectiveStatus === "HEALTHY" || effectiveStatus === "SYNCING",
        syncInProgress,
        nextScheduledSync: nextSyncTime ? nextSyncTime.toISOString() : null,
        lastSuccessAt: state.lastSuccessAt ? state.lastSuccessAt.toISOString() : null,
        lastFailureAt: state.lastFailureAt ? state.lastFailureAt.toISOString() : null,
        lastFailureReason: state.lastFailureReason,
        lastSyncDurationMs: state.lastSyncDurationMs,
        consecutiveFailures: state.consecutiveFailures,
        catalogAgeMinutes: ageMs === Infinity ? null : Math.round(ageMs / 60000)
    };
}

/**
 * Manual trigger for debugging or force-refresh.
 */
async function forceSync() {
    return runSyncCycle("manual_force_trigger");
}

/**
 * Stop the scheduler cleanly and clear active timeouts.
 */
function stopCatalogSyncScheduler() {
    if (schedulerTimeout) {
        clearTimeout(schedulerTimeout);
        schedulerTimeout = null;
    }
    state.isInitialized = false;
    console.log("[Scheduler] Stopped.");
}

module.exports = {
    startCatalogSyncScheduler,
    stopCatalogSyncScheduler,
    getSchedulerStatus,
    forceSync
};
