const crypto = require("node:crypto");
const { Satellite } = require("../models/satellite");
const { Debris } = require("../models/debris");
const { RocketBody } = require("../models/rocketBody");
const { serializeSatellite } = require("./satelliteMetadataService");
const { createPropagationRecords, haversineKm } = require("./orbitalPropagationService");
const { operationalConfig } = require("../config/operationalConfig");

const {
    defaultRegionMinAltitudeKm: DEFAULT_REGION_MIN_ALTITUDE_KM,
    defaultRegionMaxAltitudeKm: DEFAULT_REGION_MAX_ALTITUDE_KM
} = operationalConfig;

let cachedPropagationRecords = null;

/**
 * Loads and serializes all satellites into propagation-ready records.
 * Uses a simple in-memory cache to avoid re-parsing TLEs on every request.
 */
async function loadPropagationRecords() {
    if (cachedPropagationRecords) {
        return cachedPropagationRecords;
    }

    const satellites = await Satellite.findAll({ order: [["name", "ASC"]] });
    const debris = await Debris.findAll({ order: [["name", "ASC"]] });
    const rocketBodies = await RocketBody.findAll({ order: [["name", "ASC"]] });
    const allObjects = [...satellites, ...debris, ...rocketBodies];

    cachedPropagationRecords = createPropagationRecords(allObjects.map((satelliteRow) => ({
        ...serializeSatellite(satelliteRow),
        name: satelliteRow.name,
        line1: satelliteRow.line1,
        line2: satelliteRow.line2
    })));

    return cachedPropagationRecords;
}

/**
 * Invalidates the propagation record cache.
 * Should be called whenever the satellite catalog is updated.
 */
function clearPropagationCache() {
    cachedPropagationRecords = null;
}

/**
 * Standardizes altitude windows for regional analysis.
 */
function normalizeAltitudeWindow(minAltitudeKm, maxAltitudeKm) {
    const normalizedMin = Number.isFinite(minAltitudeKm) ? Math.max(0, minAltitudeKm) : DEFAULT_REGION_MIN_ALTITUDE_KM;
    const normalizedMax = Number.isFinite(maxAltitudeKm) ? Math.max(normalizedMin, maxAltitudeKm) : DEFAULT_REGION_MAX_ALTITUDE_KM;
    return {
        minAltitudeKm: normalizedMin,
        maxAltitudeKm: normalizedMax
    };
}

/**
 * Generates a unique hash for a region/time configuration to support analysis tracking.
 */
function buildRegionHash(area, startTime, horizonMinutes, minAltitudeKm, maxAltitudeKm, proximityThresholdKm) {
    const hash = crypto.createHash("sha256");
    hash.update(JSON.stringify({
        points: Array.isArray(area?.points) ? area.points : [],
        centroid: area?.centroid || null,
        startTime: new Date(startTime).toISOString(),
        horizonMinutes,
        minAltitudeKm,
        maxAltitudeKm,
        proximityThresholdKm
    }));
    return hash.digest("hex");
}

/**
 * Calculates the Euclidean distance from a state to the nearest point in a polygon.
 */
function closestPointDistanceKm(state, points) {
    if (!state || !Array.isArray(points) || !points.length) {
        return Infinity;
    }

    let closestDistanceKm = Infinity;
    for (const point of points) {
        const distanceKm = haversineKm(point.lat, point.lon, state.lat, state.lon);
        if (distanceKm < closestDistanceKm) {
            closestDistanceKm = distanceKm;
        }
    }

    return closestDistanceKm;
}

module.exports = {
    loadPropagationRecords,
    clearPropagationCache,
    normalizeAltitudeWindow,
    buildRegionHash,
    closestPointDistanceKm
};
