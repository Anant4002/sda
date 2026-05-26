const { operationalConfig } = require("../config/operationalConfig");
const { createAnalysisDeadline, assertAnalysisWithinDeadline } = require("./analysisBudget");
const {
    buildOrbitPathSamples,
    computeCentroid,
    pointInPolygon,
    toRadians,
    propagateState
} = require("./orbitalPropagationService");
const { 
    normalizeAltitudeWindow, 
    buildRegionHash, 
    closestPointDistanceKm 
} = require("./propagationCoordinator");
const {
    isEffectivelyCovered,
    resolveSensorProfile
} = require("../../../shared/blindSpotCoverageUtils");

const {
    analysisStepSeconds: ANALYSIS_STEP_SECONDS,
    defaultRegionProximityThresholdKm: DEFAULT_REGION_PROXIMITY_THRESHOLD_KM,
    otherSatellitePathColor: OTHER_SATELLITE_PATH_COLOR,
    indianSatellitePathColor: INDIAN_SATELLITE_PATH_COLOR,
    visibilityElevationDeg: VISIBILITY_ELEVATION_DEG
} = operationalConfig;
const BLIND_SPOT_SAMPLE_SECONDS = Math.max(60, Math.min(ANALYSIS_STEP_SECONDS, 300));

/**
 * Scans for all satellite passes and close approaches within a defined 3D volumetric region.
 */
function analyzeRegionScanFromRecords(records, area, startTime, horizonMinutes, minAltitudeKm, maxAltitudeKm, proximityThresholdKm) {
    const startDate = new Date(startTime);
    const analysisTimeoutMs = operationalConfig.analysisTimeoutMs;
    const deadlineMs = createAnalysisDeadline(analysisTimeoutMs);
    const altitudeWindow = normalizeAltitudeWindow(minAltitudeKm, maxAltitudeKm);
    const thresholdKm = Number.isFinite(proximityThresholdKm) && proximityThresholdKm > 0
        ? proximityThresholdKm
        : DEFAULT_REGION_PROXIMITY_THRESHOLD_KM;
    const centroid = area.centroid || computeCentroid(area.points);
    const regionHash = buildRegionHash(area, startDate, horizonMinutes, altitudeWindow.minAltitudeKm, altitudeWindow.maxAltitudeKm, thresholdKm);
    const observer = {
        longitude: toRadians(centroid.lon),
        latitude: toRadians(centroid.lat),
        height: 0
    };

    // Performance Optimization: Pre-calculate Area Bounding Box
    let minLat = 90, maxLat = -90, minLon = 180, maxLon = -180;
    for (const p of area.points) {
        if (p.lat < minLat) minLat = p.lat;
        if (p.lat > maxLat) maxLat = p.lat;
        if (p.lon < minLon) minLon = p.lon;
        if (p.lon > maxLon) maxLon = p.lon;
    }

    const passes = [];
    const alerts = [];

    for (const record of records) {
        assertAnalysisWithinDeadline(deadlineMs, "Volumetric scan", analysisTimeoutMs);
        let inPass = false;
        let passStart = null;
        let peakAltitudeKm = -Infinity;
        let minAltitudeKmSeen = Infinity;
        let closestApproachKm = Infinity;
        let closestApproachTime = null;

        for (let offsetSeconds = 0; offsetSeconds <= horizonMinutes * 60; offsetSeconds += ANALYSIS_STEP_SECONDS) {
            assertAnalysisWithinDeadline(deadlineMs, "Volumetric scan", analysisTimeoutMs);
            const sampleDate = new Date(startDate.getTime() + offsetSeconds * 1000);
            const state = propagateState(record, sampleDate, observer);
            if (!state) {
                continue;
            }

            const altitudeInRange = state.altKm >= altitudeWindow.minAltitudeKm && state.altKm <= altitudeWindow.maxAltitudeKm;
            const isWithinBBox = state.lat >= minLat && state.lat <= maxLat && 
                                state.lon >= minLon && state.lon <= maxLon;
            
            const isInsideArea = altitudeInRange && isWithinBBox && pointInPolygon({ lat: state.lat, lon: state.lon }, area.points);

            if (!isInsideArea) {
                if (inPass) {
                    passes.push({
                        id: record.id,
                        record, // Temporarily store for sampling later
                        noradId: record.noradId,
                        isIndian: record.isIndian,
                        startTime: passStart.toISOString(),
                        endTime: sampleDate.toISOString(),
                        closestApproachKm,
                        closestApproachTime,
                        peakAltitudeKm,
                        minAltitudeKm: minAltitudeKmSeen
                    });
                    inPass = false;
                }
                continue;
            }

            const distanceKm = closestPointDistanceKm(state, area.points);
            if (!inPass) {
                inPass = true;
                passStart = sampleDate;
                peakAltitudeKm = state.altKm;
                minAltitudeKmSeen = state.altKm;
                closestApproachKm = distanceKm;
                closestApproachTime = sampleDate.toISOString();
            }

            peakAltitudeKm = Math.max(peakAltitudeKm, state.altKm);
            minAltitudeKmSeen = Math.min(minAltitudeKmSeen, state.altKm);

            if (distanceKm < closestApproachKm) {
                closestApproachKm = distanceKm;
                closestApproachTime = sampleDate.toISOString();
            }

        }

        if (inPass && passStart) {
            const endDate = new Date(startDate.getTime() + horizonMinutes * 60 * 1000);
            passes.push({
                id: record.id,
                record,
                noradId: record.noradId,
                isIndian: record.isIndian,
                startTime: passStart.toISOString(),
                endTime: endDate.toISOString(),
                closestApproachKm,
                closestApproachTime,
                peakAltitudeKm,
                minAltitudeKm: minAltitudeKmSeen
            });
        }
    }

    passes.sort((first, second) => {
        if (first.startTime !== second.startTime) {
            return new Date(first.startTime) - new Date(second.startTime);
        }
        return first.closestApproachKm - second.closestApproachKm;
    });

    // Sample only the top 3 paths to keep response payload lean and CPU usage low
    const topPasses = passes.slice(0, 10);
    for (const pass of topPasses) {
        assertAnalysisWithinDeadline(deadlineMs, "Volumetric scan", analysisTimeoutMs);
        pass.pathSamples = buildOrbitPathSamples(pass.record, new Date(pass.startTime), new Date(pass.endTime));
    }
    // Clean up record references
    for (const pass of passes) {
        delete pass.record;
    }

    for (const pass of passes) {
        alerts.push({
            primaryId: pass.id,
            secondaryId: null,
            closestDistanceKm: pass.closestApproachKm,
            altitudeKm: pass.peakAltitudeKm,
            time: pass.closestApproachTime || pass.startTime,
            severity: pass.closestApproachKm <= thresholdKm ? "critical" : "warning"
        });
    }

    return {
        analysisType: "volumetric_scan",
        regionHash,
        region: {
            centroid,
            points: area.points
        },
        forecastWindowMinutes: horizonMinutes,
        minAltitudeKm: altitudeWindow.minAltitudeKm,
        maxAltitudeKm: altitudeWindow.maxAltitudeKm,
        proximityThresholdKm: thresholdKm,
        sampleSeconds: ANALYSIS_STEP_SECONDS,
        passes,
        alerts,
        topPaths: topPasses.slice(0, 3).map((pass) => ({
            id: pass.id,
            color: pass.isIndian ? INDIAN_SATELLITE_PATH_COLOR : OTHER_SATELLITE_PATH_COLOR,
            width: pass.isIndian ? 3.2 : 2.5,
            samples: pass.pathSamples
        }))
    };
}

/**
 * Identifies coverage gaps (Blind Spots) where no satellites provide effective ISR coverage of a region.
 *
 * ROOT CAUSE FIX (Component 5 — Backend Parity):
 *   Previous implementation used a satellite-centric loop with a short-circuit break that declared
 *   hasCoverage=true as soon as any satellite had a 10-minute streak — never producing a temporal
 *   schedule and allowing GEO comm satellites to permanently suppress blind-spot detection.
 *
 *   New implementation is time-step-driven: at each sample time we evaluate ALL satellites against
 *   the observer and determine whether any ISR-capable satellite provides effective coverage.
 *   GEO comms receive isrFactor=0.05 in computeCoverageStrength (via blindSpotCoverageUtils),
 *   so they never exceed the coverage threshold. The result is a proper temporal blind-spot schedule
 *   matching the frontend generateSchedule logic.
 */
function analyzeBlindSpotFromRecords(records, area, startTime, horizonMinutes, minAltitudeKm, maxAltitudeKm, visibilityThresholdDeg) {
    const startDate = new Date(startTime);
    const analysisTimeoutMs = operationalConfig.analysisTimeoutMs;
    const deadlineMs = createAnalysisDeadline(analysisTimeoutMs);
    const altitudeWindow = normalizeAltitudeWindow(minAltitudeKm, maxAltitudeKm);
    const thresholdDeg = Number.isFinite(visibilityThresholdDeg) ? visibilityThresholdDeg : VISIBILITY_ELEVATION_DEG;
    const centroid = area.centroid || computeCentroid(area.points);
    const regionHash = buildRegionHash(area, startDate, horizonMinutes, altitudeWindow.minAltitudeKm, altitudeWindow.maxAltitudeKm, thresholdDeg);

    // Align with frontend: 4-minute minimum observation threshold, 2-sample streak at BLIND_SPOT_SAMPLE_SECONDS resolution
    const minimumObservationMinutes = 4;
    const requiredCoverageSamples = Math.max(1, Math.ceil(minimumObservationMinutes * 60 / BLIND_SPOT_SAMPLE_SECONDS));

    const debugMetrics = {
        totalEvaluations: 0,
        visibleCount: 0,
        effectiveCoverageCount: 0,
        rejectedByRange: 0,
        rejectedByOffNadir: 0,
        rejectedByElevation: 0,
        rejectedByThreshold: 0,
        coverageStrengthSum: 0,
        coverageStrengthMin: Number.POSITIVE_INFINITY,
        coverageStrengthMax: 0,
        profileUsageCounts: {},
        geoContributionCount: 0,
        isrContributionCount: 0
    };

    // Pre-resolve sensor profiles once per satellite record to avoid repeated regex lookups
    const satelliteProfiles = records.map(record => ({
        record,
        profile: resolveSensorProfile(record.id || record.noradId || "")
    }));

    // --- Time-step-driven temporal schedule ---
    // At each time step, evaluate ALL satellites against the observer.
    // A step is "covered" only if at least one satellite passes isEffectivelyCovered.
    // GEO comms will not pass because their isrFactor=0.05 keeps coverageStrength << threshold.
    const blindWindows = [];
    const schedule = [];
    let currentBlindSpot = null;
    let pendingCoverageStart = null;
    let coverageStreak = 0;
    let hasCoverage = false;
    let totalCoveredSteps = 0;
    let totalStepsEvaluated = 0;

    const totalSteps = Math.ceil((horizonMinutes * 60) / BLIND_SPOT_SAMPLE_SECONDS);

    for (let i = 0; i <= totalSteps; i++) {
        assertAnalysisWithinDeadline(deadlineMs, "Blind spot analysis", analysisTimeoutMs);
        const currentOffset = i * BLIND_SPOT_SAMPLE_SECONDS;
        const sampleDate = new Date(startDate.getTime() + currentOffset * 1000);

        let stepIsEffectivelyCovered = false;
        let stepHasIsrContributor = false;
        let stepHasGeoOnlyContributor = false;

        for (const { record, profile } of satelliteProfiles) {
            const state = propagateState(record, sampleDate, {
                longitude: toRadians(centroid.lon),
                latitude: toRadians(centroid.lat),
                height: 0
            });
            if (!state) continue;

            // Altitude range pre-filter
            if (state.altKm < altitudeWindow.minAltitudeKm || state.altKm > altitudeWindow.maxAltitudeKm) {
                continue;
            }

            const coverage = isEffectivelyCovered({
                elevationDeg: state.elevationDeg,
                rangeKm: state.rangeKm,
                altKm: state.altKm,
                profile,
                minElevationDeg: Math.max(profile.minElevationDeg, thresholdDeg)
            });

            debugMetrics.totalEvaluations += 1;
            debugMetrics.profileUsageCounts[profile.key] = (debugMetrics.profileUsageCounts[profile.key] || 0) + 1;
            debugMetrics.coverageStrengthSum += coverage.coverageStrength || 0;
            debugMetrics.coverageStrengthMin = Math.min(debugMetrics.coverageStrengthMin, coverage.coverageStrength || 0);
            debugMetrics.coverageStrengthMax = Math.max(debugMetrics.coverageStrengthMax, coverage.coverageStrength || 0);
            if (coverage.isGeometricallyVisible) debugMetrics.visibleCount += 1;
            if (coverage.isEffectivelyCovered) debugMetrics.effectiveCoverageCount += 1;
            if (coverage.rejectedByRange) debugMetrics.rejectedByRange += 1;
            if (coverage.rejectedByOffNadir) debugMetrics.rejectedByOffNadir += 1;
            if (coverage.rejectedByElevation) debugMetrics.rejectedByElevation += 1;
            if (coverage.rejectedByThreshold) debugMetrics.rejectedByThreshold += 1;

            if (coverage.isEffectivelyCovered) {
                stepIsEffectivelyCovered = true;
                if (profile.isrCapable === false) {
                    stepHasGeoOnlyContributor = true;
                } else {
                    stepHasIsrContributor = true;
                }
                // Do NOT break — accumulate debug metrics for all satellites
            }
        }

        if (stepIsEffectivelyCovered) {
            hasCoverage = true;
            totalCoveredSteps++;
            if (stepHasIsrContributor) {
                debugMetrics.isrContributionCount += 1;
            } else if (stepHasGeoOnlyContributor) {
                debugMetrics.geoContributionCount += 1;
            }
        }
        totalStepsEvaluated++;

        schedule.push({ time: sampleDate.toISOString(), isCovered: stepIsEffectivelyCovered });

        // Temporal blind-spot schedule construction with hysteresis (matching frontend generateSchedule)
        if (stepIsEffectivelyCovered) {
            if (!pendingCoverageStart) {
                pendingCoverageStart = sampleDate;
                coverageStreak = 1;
            } else {
                coverageStreak += 1;
            }

            if (coverageStreak >= requiredCoverageSamples && currentBlindSpot) {
                currentBlindSpot.endTime = pendingCoverageStart.toISOString();
                const durationMinutes = Math.max(
                    0,
                    Math.round((new Date(currentBlindSpot.endTime) - new Date(currentBlindSpot.startTime)) / 60000)
                );
                currentBlindSpot.durationMinutes = durationMinutes;
                if (durationMinutes > 0) {
                    blindWindows.push(currentBlindSpot);
                }
                currentBlindSpot = null;
            }
        } else {
            pendingCoverageStart = null;
            coverageStreak = 0;
            if (!currentBlindSpot) {
                currentBlindSpot = { startTime: sampleDate.toISOString() };
            }
        }
    }

    // Close any trailing blind window at the end of the horizon
    if (currentBlindSpot) {
        const endDate = new Date(startDate.getTime() + horizonMinutes * 60 * 1000);
        currentBlindSpot.endTime = endDate.toISOString();
        currentBlindSpot.durationMinutes = Math.round(
            (endDate - new Date(currentBlindSpot.startTime)) / 60000
        );
        blindWindows.push(currentBlindSpot);
    }

    const alerts = blindWindows.map(bw => ({
        primaryId: null,
        secondaryId: null,
        closestDistanceKm: null,
        time: bw.startTime,
        durationMinutes: bw.durationMinutes,
        severity: bw.durationMinutes > 60 ? "critical" : "warning"
    }));

    // Legacy compat: if no coverage at all, still surface a global alert
    if (!hasCoverage) {
        alerts.push({
            primaryId: null,
            secondaryId: null,
            closestDistanceKm: null,
            time: startDate.toISOString(),
            severity: horizonMinutes > 60 ? "critical" : "warning"
        });
    }

    return {
        analysisType: "blind_spot",
        regionHash,
        region: {
            centroid,
            points: area.points
        },
        forecastWindowMinutes: horizonMinutes,
        minAltitudeKm: altitudeWindow.minAltitudeKm,
        maxAltitudeKm: altitudeWindow.maxAltitudeKm,
        visibilityThresholdDeg: thresholdDeg,
        minimumObservationMinutes,
        requiredCoverageSamples,
        sampleSeconds: BLIND_SPOT_SAMPLE_SECONDS,
        evaluatedSatelliteCount: records.length,
        hasCoverage,
        coveragePercentage: totalStepsEvaluated > 0 ? (totalCoveredSteps / totalStepsEvaluated) * 100 : 0,
        blindWindows,
        schedule,
        alerts,
        debugMetrics: {
            ...debugMetrics,
            coveragePassRate: debugMetrics.totalEvaluations > 0
                ? debugMetrics.effectiveCoverageCount / debugMetrics.totalEvaluations
                : 0,
            averageCoverageStrength: debugMetrics.totalEvaluations > 0
                ? debugMetrics.coverageStrengthSum / debugMetrics.totalEvaluations
                : 0,
            coverageStrengthMin: Number.isFinite(debugMetrics.coverageStrengthMin) ? debugMetrics.coverageStrengthMin : 0,
            coverageStrengthMax: Number.isFinite(debugMetrics.coverageStrengthMax) ? debugMetrics.coverageStrengthMax : 0
        }
    };
}

module.exports = {
    analyzeRegionScanFromRecords,
    analyzeBlindSpotFromRecords
};
