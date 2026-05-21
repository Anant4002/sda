/**
 * Operational Analysis Service (Facade)
 *
 * Orchestrates high-level analytical requests by delegating to specialized
 * domain services while preserving the existing public API for routes.
 */

const { loadPropagationRecords } = require("./propagationCoordinator");
// Conjunction operational analyzer (new, detailed screening)
const { analyzeConjunctionsFromRecords: analyzeConjunctionsOperational } = require("./conjunctionService");
const { analyzeNeighbourhoodWatchFromRecords } = require("./proximityService");
const {
    analyzeRegionScanFromRecords,
    analyzeBlindSpotFromRecords
} = require("./regionAnalysisService");

async function runBackendConjunctionAnalysis({ area, horizonMinutes, conjunctionThresholdKm, minAltitudeKm, maxAltitudeKm, filters, time }) {
    const records = await loadPropagationRecords();
    const effectiveFilters = { ...(filters || {}), minAltitudeKm: Number.isFinite(minAltitudeKm) ? minAltitudeKm : undefined, maxAltitudeKm: Number.isFinite(maxAltitudeKm) ? maxAltitudeKm : undefined };

    // Operational backend entry point should call the conjunction module's operational analyzer.
    return analyzeConjunctionsOperational(records, area, time, horizonMinutes, conjunctionThresholdKm, effectiveFilters);
}

async function runBackendNeighbourhoodWatch({ satelliteId, thresholdKm, time }) {
    const records = await loadPropagationRecords();
    return analyzeNeighbourhoodWatchFromRecords(records, satelliteId, time, thresholdKm);
}

async function runBackendRegionScan({ area, horizonMinutes, minAltitudeKm, maxAltitudeKm, proximityThresholdKm, time }) {
    const records = await loadPropagationRecords();
    return analyzeRegionScanFromRecords(
        records,
        area,
        time,
        horizonMinutes,
        minAltitudeKm,
        maxAltitudeKm,
        proximityThresholdKm
    );
}

async function runBackendBlindSpot({ area, horizonMinutes, minAltitudeKm, maxAltitudeKm, visibilityThresholdDeg, time }) {
    const records = await loadPropagationRecords();
    return analyzeBlindSpotFromRecords(
        records,
        area,
        time,
        horizonMinutes,
        minAltitudeKm,
        maxAltitudeKm,
        visibilityThresholdDeg
    );
}

module.exports = {
    // Domain Services (Exporting original function names for backward compatibility if needed)
    // NOTE: preserve legacy symbol name for callers/tests that expect the volumetric region scan behavior
    analyzeConjunctionsFromRecords: function(records, area, startTime, horizonMinutes, proximityThresholdKm) {
        // Delegate to volumetric region scan and then augment the response with legacy summary fields
        const res = analyzeRegionScanFromRecords(records, area, startTime, horizonMinutes, undefined, undefined, proximityThresholdKm);

        try {
            const startDate = new Date(startTime);
            const passes = Array.isArray(res.passes) ? res.passes : [];

            const currentOverhead = passes.filter(p => new Date(p.startTime) <= startDate && new Date(p.endTime) > startDate);
            res.currentOverheadCount = currentOverhead.length;
            // Visibility detection is expensive; preserve previous default of 0 for POC parity
            res.currentVisibleCount = 0;
            res.currentIndianOverheadCount = currentOverhead.filter(p => p.isIndian).length;
            res.totalFuturePasses = passes.length;
            res.futureIndianPasses = passes.filter(p => p.isIndian).length;
            // Ensure conjunctions array exists for compatibility with legacy callers
            if (!Array.isArray(res.conjunctions)) res.conjunctions = [];
        } catch (e) {
            // On any error computing legacy metrics, fail gracefully without breaking the primary scan result
            console.warn('Failed to compute legacy conjunction summary fields:', e?.message || e);
        }

        return res;
    },
    analyzeNeighbourhoodWatchFromRecords,
    analyzeRegionScanFromRecords,
    analyzeBlindSpotFromRecords,

    // Orchestration Entry Points
    runBackendConjunctionAnalysis,
    runBackendNeighbourhoodWatch,
    runBackendRegionScan,
    runBackendBlindSpot
};
