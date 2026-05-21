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
    analysisStepSeconds: ANALYSIS_STEP_SECONDS,
    defaultRegionProximityThresholdKm: DEFAULT_REGION_PROXIMITY_THRESHOLD_KM,
    otherSatellitePathColor: OTHER_SATELLITE_PATH_COLOR,
    indianSatellitePathColor: INDIAN_SATELLITE_PATH_COLOR,
    visibilityElevationDeg: VISIBILITY_ELEVATION_DEG
} = operationalConfig;

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
 * Identifies coverage gaps (Blind Spots) where no satellites provide visibility coverage for a region.
 */
function analyzeBlindSpotFromRecords(records, area, startTime, horizonMinutes, minAltitudeKm, maxAltitudeKm, visibilityThresholdDeg) {
    const startDate = new Date(startTime);
    const analysisTimeoutMs = operationalConfig.analysisTimeoutMs;
    const deadlineMs = createAnalysisDeadline(analysisTimeoutMs);
    const altitudeWindow = normalizeAltitudeWindow(minAltitudeKm, maxAltitudeKm);
    const thresholdDeg = Number.isFinite(visibilityThresholdDeg) ? visibilityThresholdDeg : VISIBILITY_ELEVATION_DEG;
    const centroid = area.centroid || computeCentroid(area.points);
    const regionHash = buildRegionHash(area, startDate, horizonMinutes, altitudeWindow.minAltitudeKm, altitudeWindow.maxAltitudeKm, thresholdDeg);
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

    let hasCoverage = false;
    let evaluatedSatelliteCount = 0;

    for (const record of records) {
        assertAnalysisWithinDeadline(deadlineMs, "Blind spot analysis", analysisTimeoutMs);
        evaluatedSatelliteCount += 1;
        let satelliteHasCoverage = false;

        for (let offsetSeconds = 0; offsetSeconds <= horizonMinutes * 60; offsetSeconds += ANALYSIS_STEP_SECONDS) {
            assertAnalysisWithinDeadline(deadlineMs, "Blind spot analysis", analysisTimeoutMs);
            const sampleDate = new Date(startDate.getTime() + offsetSeconds * 1000);
            const state = propagateState(record, sampleDate, observer);
            if (!state) {
                continue;
            }

            const altitudeInRange = state.altKm >= altitudeWindow.minAltitudeKm && state.altKm <= altitudeWindow.maxAltitudeKm;
            const isWithinBBox = state.lat >= minLat && state.lat <= maxLat && 
                                state.lon >= minLon && state.lon <= maxLon;
            
            const isInsideArea = altitudeInRange && isWithinBBox && pointInPolygon({ lat: state.lat, lon: state.lon }, area.points);
            const isVisible = state.elevationDeg >= thresholdDeg;

            if (isInsideArea && isVisible) {
                satelliteHasCoverage = true;
                hasCoverage = true;
                break;
            }
        }

        if (satelliteHasCoverage) {
            break;
        }
    }

    const alerts = [];
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
        sampleSeconds: ANALYSIS_STEP_SECONDS,
        evaluatedSatelliteCount,
        hasCoverage,
        alerts
    };
}

module.exports = {
    analyzeRegionScanFromRecords,
    analyzeBlindSpotFromRecords
};
