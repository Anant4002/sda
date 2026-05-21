const { operationalConfig } = require("../config/operationalConfig");
const { createAnalysisDeadline, assertAnalysisWithinDeadline } = require("./analysisBudget");
const {
    distanceBetweenEci,
    propagateState
} = require("./orbitalPropagationService");

const {
    neighbourhoodWatchThresholdKm: NEIGHBOURHOOD_WATCH_THRESHOLD_KM,
    neighbourhoodWatchCriticalKm: NEIGHBOURHOOD_WATCH_CRITICAL_KM,
    maxNeighbourhoodResults: MAX_NEIGHBOURHOOD_RESULTS
} = operationalConfig;

/**
 * Core analytical loop for Asset-centric proximity monitoring (Neighbourhood Watch).
 */
function analyzeNeighbourhoodWatchFromRecords(records, satelliteId, startTime, thresholdKm = NEIGHBOURHOOD_WATCH_THRESHOLD_KM) {
    const startDate = new Date(startTime);
    const analysisTimeoutMs = operationalConfig.analysisTimeoutMs;
    const deadlineMs = createAnalysisDeadline(analysisTimeoutMs);
    const alerts = [];

    // Pre-propagate all records once to avoid redundant SGP4 calls in the nested loop
    const stateMap = new Map();
    for (const record of records) {
        assertAnalysisWithinDeadline(deadlineMs, "Neighbourhood watch", analysisTimeoutMs);
        const state = propagateState(record, startDate, null);
        if (state) {
            stateMap.set(record.id, state);
        }
    }

    // If satelliteId is provided, run for that specific satellite.
    // Otherwise, run for ALL Indian satellites.
    const primaryRecords = satelliteId
        ? records.filter(r => r.id === satelliteId)
        : records.filter(r => r.isIndian);

    if (primaryRecords.length === 0) {
        return null;
    }

    for (const primaryRecord of primaryRecords) {
        assertAnalysisWithinDeadline(deadlineMs, "Neighbourhood watch", analysisTimeoutMs);
        const primaryState = stateMap.get(primaryRecord.id);
        if (!primaryState) continue;

        for (const nearbyRecord of records) {
            assertAnalysisWithinDeadline(deadlineMs, "Neighbourhood watch", analysisTimeoutMs);
            if (nearbyRecord.id === primaryRecord.id) {
                continue;
            }

            const nearbyState = stateMap.get(nearbyRecord.id);
            if (!nearbyState) continue;

            const distanceKm = distanceBetweenEci(primaryState.eci, nearbyState.eci);
            if (distanceKm > thresholdKm) {
                continue;
            }

            const dx = (primaryState.velocityEci?.x || 0) - (nearbyState.velocityEci?.x || 0);
            const dy = (primaryState.velocityEci?.y || 0) - (nearbyState.velocityEci?.y || 0);
            const dz = (primaryState.velocityEci?.z || 0) - (nearbyState.velocityEci?.z || 0);
            const relativeVelocityKmS = (primaryState.velocityEci && nearbyState.velocityEci)
                ? Math.sqrt(dx * dx + dy * dy + dz * dz)
                : null;

            alerts.push({
                primaryId: primaryRecord.id,
                secondaryId: nearbyRecord.id,
                closestDistanceKm: distanceKm,
                relativeVelocityKmS,
                time: startDate.toISOString(),
                severity: distanceKm <= NEIGHBOURHOOD_WATCH_CRITICAL_KM ? "critical" : "warning",
                // Include positions for globe markers
                primaryPos: primaryState.ecf,
                secondaryPos: nearbyState.ecf
            });
        }
    }

    alerts.sort((first, second) => first.closestDistanceKm - second.closestDistanceKm);

    return {
        primaryId: satelliteId || "All Indian Assets",
        primaryIsIndian: primaryRecords && primaryRecords.length ? Boolean(primaryRecords[0].isIndian) : undefined,
        isGlobal: !satelliteId,
        thresholdKm,
        sampleSeconds: 0,
        time: startDate.toISOString(),
        alerts: alerts.slice(0, MAX_NEIGHBOURHOOD_RESULTS * (satelliteId ? 1 : 2))
    };
}

module.exports = {
    analyzeNeighbourhoodWatchFromRecords
};
