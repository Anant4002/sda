const { operationalConfig } = require("../config/operationalConfig");
const { createAnalysisDeadline, assertAnalysisWithinDeadline } = require("./analysisBudget");
const {
    computeCentroid,
    buildOrbitPathSamples,
    distanceBetweenEci,
    findTcaBetweenRecords,
    calculateFosterPc,
    haversineKm,
    pointInPolygon,
    toRadians,
    propagateState
} = require("./orbitalPropagationService");
const { analyzeRegionScanFromRecords } = require("./regionAnalysisService");

const {
    analysisStepSeconds: ANALYSIS_STEP_SECONDS,
    conjunctionSampleSeconds: CONJUNCTION_SAMPLE_SECONDS,
    defaultConjunctionDistanceKm: DEFAULT_CONJUNCTION_DISTANCE_KM,
    maxConjunctionCandidates: MAX_CONJUNCTION_CANDIDATES,
    otherSatellitePathColor: OTHER_SATELLITE_PATH_COLOR,
    indianSatellitePathColor: INDIAN_SATELLITE_PATH_COLOR,
    visibilityElevationDeg: VISIBILITY_ELEVATION_DEG
} = operationalConfig;

/**
 * Core analytical loop for detecting conjunctions and close approaches.
 * Aligned with SDA Operational Standards.
 */
async function analyzeConjunctionsFromRecords(records, area, startTime, horizonMinutes, conjunctionThresholdKm, filters = {}) {
    if (area && Array.isArray(area.points) && area.points.length >= 3) {
        // Use the conjunctionThreshold as the proximity threshold for region scans
        return analyzeRegionScanFromRecords(records, area, startTime, horizonMinutes, filters.minAltitudeKm, filters.maxAltitudeKm, conjunctionThresholdKm);
    }
    const startDate = new Date(startTime);
    const thresholdKm = conjunctionThresholdKm || DEFAULT_CONJUNCTION_DISTANCE_KM;
    const thresholdSq = thresholdKm * thresholdKm;
    const minAltitudeKm = Number.isFinite(filters.minAltitudeKm) ? filters.minAltitudeKm : 0;
    const maxAltitudeKm = Number.isFinite(filters.maxAltitudeKm) ? filters.maxAltitudeKm : 42000;

    const durationSeconds = horizonMinutes * 60;
    const COARSE_STEP = horizonMinutes > 1440 ? 600 : (horizonMinutes > 360 ? 300 : 120);
    const statesMap = new Map();

    // 1. Initial Batch Propagation (ECI states only)
    let propagationCount = 0;
    for (const record of records) {
        propagationCount++;
        if (propagationCount % 500 === 0) await new Promise(resolve => setImmediate(resolve));

        const states = [];
        for (let offset = 0; offset <= durationSeconds; offset += COARSE_STEP) {
            const time = new Date(startDate.getTime() + offset * 1000);
            const state = propagateState(record, time, null);
            states.push(state ? { x: state.eci.x, y: state.eci.y, z: state.eci.z, alt: state.altKm } : null);
        }
        // Compute altitude window for this record and skip if outside requested window
        const altSamples = states.filter(s => s && typeof s.alt === "number").map(s => s.alt);
        if (!altSamples.length) continue;
        const minAlt = Math.min(...altSamples);
        const maxAlt = Math.max(...altSamples);
        const avgAlt = altSamples.reduce((a, b) => a + b, 0) / altSamples.length;
        // Skip satellites completely outside the requested altitude band
        if (maxAlt < minAltitudeKm || minAlt > maxAltitudeKm) continue;

        // Attach some metadata to the record for later use
        record._minPropAltKm = minAlt;
        record._maxPropAltKm = maxAlt;
        record._avgPropAltKm = avgAlt;

        statesMap.set(record.id, states);
    }

    const conjunctions = [];
    const thresholdMarginSq = thresholdSq * 25;
    const altDiffLimitKm = Math.max(1000, thresholdKm * 5);

    let primaryPool = records;
    let secondaryPool = records;
    let isSymmetric = true;

    if (filters.assetFilter === "indian" || filters.indianOnly) {
        primaryPool = records.filter(r => r.isIndian);
        isSymmetric = false;
    } else if (filters.assetFilter === "adversary") {
        primaryPool = records.filter(r => /YAOGAN|GAOFEN|SHIJIAN|TIANHUI|ZHUHAI|COSMOS/i.test((r.id || "").toUpperCase()));
        isSymmetric = false;
    } else if (filters.assetFilter === "custom" && Array.isArray(filters.customList) && filters.customList.length) {
        const set = new Set(filters.customList.map(String).map(s => s.trim().toLowerCase()));
        primaryPool = records.filter(r => set.has(String(r.id).toLowerCase()) || set.has(String(r.noradId)));
        isSymmetric = false;
    }

    // 2. Optimized Pairwise Screening (Non-blocking)
    let pairsProcessed = 0;
    for (let i = 0; i < primaryPool.length; i += 1) {
        const primary = primaryPool[i];
        const states1 = statesMap.get(primary.id);
        if (!states1) continue;

        const jStart = isSymmetric ? i + 1 : 0;

        for (let j = jStart; j < secondaryPool.length; j += 1) {
            pairsProcessed++;
            // Yield every 10,000 pairs to keep event loop alive for other modules
            if (pairsProcessed % 10000 === 0) await new Promise(resolve => setImmediate(resolve));

            const secondary = secondaryPool[j];
            if (primary.id === secondary.id) continue;

            const states2 = statesMap.get(secondary.id);
            if (!states2) continue;

            let minCoarseDistSq = Infinity;
            let bestOffsetIndex = -1;

            for (let k = 0; k < states1.length; k++) {
                const s1 = states1[k];
                const s2 = states2[k];
                if (!s1 || !s2) continue;
                const dAlt = s1.alt - s2.alt;
                if (Math.abs(dAlt) > altDiffLimitKm) continue;

                const dx = s1.x - s2.x;
                const dy = s1.y - s2.y;
                const dz = s1.z - s2.z;
                const distSq = dx * dx + dy * dy + dz * dz;

                if (distSq < minCoarseDistSq) {
                    minCoarseDistSq = distSq;
                    bestOffsetIndex = k;
                }
            }

            // 3. High-Resolution Refinement
            // Optionally enforce indian vs foreign only pairing
            if (filters.assetFilter === "indian_vs_foreign") {
                // Skip pairs where both are Indian or both are non-Indian
                if ((primary.isIndian && secondary.isIndian) || (!primary.isIndian && !secondary.isIndian)) {
                    continue;
                }
            }

            if (bestOffsetIndex !== -1 && minCoarseDistSq <= thresholdMarginSq) {
                const bestCoarseTime = new Date(startDate.getTime() + (bestOffsetIndex * COARSE_STEP) * 1000);
                const refStart = new Date(bestCoarseTime.getTime() - (COARSE_STEP * 1000));

                let bestTca = bestCoarseTime;
                let minDistance = Math.sqrt(minCoarseDistSq);

                for (let offset = 0; offset <= COARSE_STEP * 2; offset += 5) {
                    const time = new Date(refStart.getTime() + offset * 1000);
                    const s1 = propagateState(primary, time, null);
                    const s2 = propagateState(secondary, time, null);
                    if (!s1 || !s2) continue;

                    const dist = distanceBetweenEci(s1.eci, s2.eci);
                    if (dist < minDistance) {
                        minDistance = dist;
                        bestTca = time;
                    }
                }

                if (minDistance <= thresholdKm) {
                    const state1 = propagateState(primary, bestTca, null);
                    const state2 = propagateState(secondary, bestTca, null);

                    let relVelKmS = 0;
                    if (state1?.velocityEci && state2?.velocityEci) {
                        const dvx = state1.velocityEci.x - state2.velocityEci.x;
                        const dvy = state1.velocityEci.y - state2.velocityEci.y;
                        const dvz = state1.velocityEci.z - state2.velocityEci.z;
                        relVelKmS = Math.sqrt(dvx * dvx + dvy * dvy + dvz * dvz);
                    }

                    const pc = calculateFosterPc(minDistance, relVelKmS, primary.satrec, secondary.satrec, bestTca);

                    let severity = "informational";
                    if (minDistance < 1.0 || pc > 1e-4) severity = "critical";
                    else if (minDistance < 5.0 || pc > 1e-5) severity = "high";
                    else if (minDistance < 15.0) severity = "medium";

                    const severityColorMap = {
                        critical: "#ff0000",
                        high: "#ff8c00",
                        medium: "#ffd700",
                        informational: "#00a000"
                    };
                    const severityColor = severityColorMap[severity] || "#00a000";

                    // Classify orbit using the altitude at TCA (average of both satellites)
                    const avgAltAtTca = ((state1?.altKm || primary._avgPropAltKm || 0) + (state2?.altKm || secondary._avgPropAltKm || 0)) / 2;
                    let orbitClass = "HEO";
                    if (avgAltAtTca < 2000) orbitClass = "LEO";
                    else if (avgAltAtTca < 20000) orbitClass = "MEO";
                    else if (Math.abs(avgAltAtTca - 35786) < 1000) orbitClass = "GEO";

                    conjunctions.push({
                        primaryId: primary.id,
                        primaryNoradId: primary.noradId || null,
                        primaryIsIndian: primary.isIndian,
                        secondaryId: secondary.id,
                        secondaryNoradId: secondary.noradId || null,
                        secondaryIsIndian: secondary.isIndian,
                        closestDistanceKm: minDistance,
                        time: bestTca.toISOString(),
                        relativeVelocityKmS: relVelKmS,
                        collisionProbability: pc,
                        severity,
                        severityColor,
                        orbitClass,
                        primaryPath: buildOrbitPathSamples(primary, new Date(bestTca.getTime() - 120000), new Date(bestTca.getTime() + 120000)),
                        secondaryPath: buildOrbitPathSamples(secondary, new Date(bestTca.getTime() - 120000), new Date(bestTca.getTime() + 120000)),
                        primaryPos: state1.ecf,
                        secondaryPos: state2.ecf
                    });
                }
            }
        }
    }

    conjunctions.sort((a, b) => a.closestDistanceKm - b.closestDistanceKm);

    return {
        analysisType: "conjunction_analysis",
        startTime: startTime,
        horizonMinutes,
        conjunctionThresholdKm: thresholdKm,
        conjunctions: conjunctions.slice(0, 50),
        summary: {
            critical: conjunctions.filter(c => c.severity === "critical").length,
            high: conjunctions.filter(c => c.severity === "high").length,
            medium: conjunctions.filter(c => c.severity === "medium").length,
            total: conjunctions.length
        }
    };
}

module.exports = {
    analyzeConjunctionsFromRecords
};
