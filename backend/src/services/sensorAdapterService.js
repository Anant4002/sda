/**
 * Sensor Adapter Service
 *
 * Provides a normalisation layer for sensor track data ingested from multiple
 * sources (JSON REST, ASTERIX stub, NMEA stub). Core classification logic
 * in rapidProcessingService remains format-agnostic.
 *
 * Also hosts the SENSOR_REGISTRY — a configurable list of representative
 * tracking sensors with metadata for future real-sensor integration.
 */

'use strict';

// ---------------------------------------------------------------------------
// SENSOR REGISTRY
// ---------------------------------------------------------------------------
// Each entry represents a representative ground-truth or tracking asset.
// isRepresentative = true means this is a placeholder for a real sensor
// category; the configuration can be replaced with live endpoint data.
// ---------------------------------------------------------------------------
const SENSOR_REGISTRY = [
    {
        id: 'S-OPT-MNTABU',
        name: 'Mount Abu Electro-Optical Station',
        type: 'OPTICAL',
        latitude: 24.5926,
        longitude: 72.7156,
        maxRangeKm: 2000,
        minElevationDeg: 10,
        trackingAccuracyKm: 0.5,
        updateRateSeconds: 30,
        operationalStatus: 'ACTIVE',
        isRepresentative: true,
        dataSource: 'REPRESENTATIVE',
        disclaimer: 'Parameters are representative estimates. Not connected to a live sensor feed.'
    },
    {
        id: 'S-RAD-BLURU',
        name: 'Bengaluru Space Tracking Radar',
        type: 'RADAR',
        latitude: 13.0827,
        longitude: 77.5877,
        maxRangeKm: 3000,
        minElevationDeg: 5,
        trackingAccuracyKm: 0.8,
        updateRateSeconds: 15,
        operationalStatus: 'ACTIVE',
        isRepresentative: true,
        dataSource: 'REPRESENTATIVE',
        disclaimer: 'Parameters are representative estimates. Not connected to a live sensor feed.'
    },
    {
        id: 'S-RF-GUW',
        name: 'Guwahati Tracking Station (RF)',
        type: 'MULTI_MODE',
        latitude: 26.1445,
        longitude: 91.7362,
        maxRangeKm: 2500,
        minElevationDeg: 8,
        trackingAccuracyKm: 0.6,
        updateRateSeconds: 20,
        operationalStatus: 'ACTIVE',
        isRepresentative: true,
        dataSource: 'REPRESENTATIVE',
        disclaimer: 'Parameters are representative estimates. Not connected to a live sensor feed.'
    },
    {
        id: 'S-OPT-TERLS',
        name: 'Thumba Equatorial Rocket Launching Station (TERLS)',
        type: 'OPTICAL',
        latitude: 8.5252,
        longitude: 76.8796,
        maxRangeKm: 1800,
        minElevationDeg: 12,
        trackingAccuracyKm: 0.4,
        updateRateSeconds: 30,
        operationalStatus: 'ACTIVE',
        isRepresentative: true,
        dataSource: 'REPRESENTATIVE',
        disclaimer: 'Parameters are representative estimates. Not connected to a live sensor feed.'
    },
    {
        id: 'S-RAD-SHAR',
        name: 'Sriharikota ISRO Tracking Radar (SDSC)',
        type: 'RADAR',
        latitude: 13.7226,
        longitude: 80.2279,
        maxRangeKm: 3500,
        minElevationDeg: 4,
        trackingAccuracyKm: 0.3,
        updateRateSeconds: 10,
        operationalStatus: 'ACTIVE',
        isRepresentative: true,
        dataSource: 'REPRESENTATIVE',
        disclaimer: 'Parameters are representative estimates. Not connected to a live sensor feed.'
    },
    {
        id: 'S-RAD-PORTBLAIR',
        name: 'Port Blair Andaman Surveillance Radar',
        type: 'RADAR',
        latitude: 11.6234,
        longitude: 92.7265,
        maxRangeKm: 2800,
        minElevationDeg: 6,
        trackingAccuracyKm: 1.0,
        updateRateSeconds: 20,
        operationalStatus: 'ACTIVE',
        isRepresentative: true,
        dataSource: 'REPRESENTATIVE',
        disclaimer: 'Parameters are representative estimates. Not connected to a live sensor feed.'
    },
    {
        id: 'S-RAD-DELHI',
        name: 'Delhi Air Defence Tracking Radar',
        type: 'RADAR',
        latitude: 28.6139,
        longitude: 77.2090,
        maxRangeKm: 2000,
        minElevationDeg: 10,
        trackingAccuracyKm: 1.2,
        updateRateSeconds: 15,
        operationalStatus: 'ACTIVE',
        isRepresentative: true,
        dataSource: 'REPRESENTATIVE',
        disclaimer: 'Parameters are representative estimates. Not connected to a live sensor feed.'
    },
    {
        id: 'S-RAD-JODHPUR',
        name: 'Jodhpur Western Sector Radar',
        type: 'RADAR',
        latitude: 26.2389,
        longitude: 73.0243,
        maxRangeKm: 2200,
        minElevationDeg: 8,
        trackingAccuracyKm: 1.0,
        updateRateSeconds: 15,
        operationalStatus: 'ACTIVE',
        isRepresentative: true,
        dataSource: 'REPRESENTATIVE',
        disclaimer: 'Parameters are representative estimates. Not connected to a live sensor feed.'
    },
    {
        id: 'S-OPT-CHENNAI',
        name: 'Chennai Optical Tracking Station',
        type: 'OPTICAL',
        latitude: 13.0827,
        longitude: 80.2707,
        maxRangeKm: 1600,
        minElevationDeg: 15,
        trackingAccuracyKm: 0.4,
        updateRateSeconds: 30,
        operationalStatus: 'ACTIVE',
        isRepresentative: true,
        dataSource: 'REPRESENTATIVE',
        disclaimer: 'Parameters are representative estimates. Not connected to a live sensor feed.'
    },
    {
        id: 'S-MM-HYD',
        name: 'Hyderabad DRDO Multi-Mode Ground Station',
        type: 'MULTI_MODE',
        latitude: 17.3850,
        longitude: 78.4867,
        maxRangeKm: 3000,
        minElevationDeg: 6,
        trackingAccuracyKm: 0.5,
        updateRateSeconds: 10,
        operationalStatus: 'ACTIVE',
        isRepresentative: true,
        dataSource: 'REPRESENTATIVE',
        disclaimer: 'Parameters are representative estimates. Not connected to a live sensor feed.'
    }
];

// In-memory sensor map for fast lookup
const _sensorMap = new Map(SENSOR_REGISTRY.map(s => [s.id, s]));

// ---------------------------------------------------------------------------
// NORMALISATION HELPERS
// ---------------------------------------------------------------------------

/**
 * Normalise a JSON REST format track point.
 * This is the native format produced by the rapid processing frontend.
 */
function _normalizeJsonPoint(raw) {
    return {
        timestamp: raw.time ? new Date(raw.time).toISOString() : new Date().toISOString(),
        lat: typeof raw.lat === 'number' ? raw.lat : null,
        lon: typeof raw.lon === 'number' ? raw.lon : null,
        altitude: typeof raw.altKm === 'number' ? raw.altKm : null,
        x: typeof raw.x === 'number' ? raw.x : null,
        y: typeof raw.y === 'number' ? raw.y : null,
        z: typeof raw.z === 'number' ? raw.z : null,
        confidence: 0.85, // default for directly injected tracks
        observationErrorKm: 0.5
    };
}

/**
 * ASTERIX Category 048 (radar) — stub implementation.
 * A real integration would parse the binary ASTERIX protocol.
 * This stub accepts a pre-decoded JS object with ASTERIX-style field names.
 */
function _normalizeAsterixPoint(raw) {
    return {
        timestamp: raw.timeOfDay ? new Date(raw.timeOfDay).toISOString() : new Date().toISOString(),
        lat: raw.latitude ?? null,
        lon: raw.longitude ?? null,
        altitude: raw.flightLevel != null ? raw.flightLevel * 0.03048 : null, // FL → km
        x: null,
        y: null,
        z: null,
        confidence: 0.75,
        observationErrorKm: 1.0
    };
}

/**
 * NMEA GGA sentence — stub implementation.
 * Accepts a pre-parsed GGA object.
 */
function _normalizeNmeaPoint(raw) {
    return {
        timestamp: new Date().toISOString(),
        lat: raw.lat ?? null,
        lon: raw.lon ?? null,
        altitude: raw.altitude != null ? raw.altitude / 1000 : null, // m → km
        x: null,
        y: null,
        z: null,
        confidence: 0.65,
        observationErrorKm: 2.0
    };
}

// ---------------------------------------------------------------------------
// PUBLIC API
// ---------------------------------------------------------------------------

/**
 * Normalise a raw sensor track into the canonical observation array.
 *
 * @param {object} rawData   - Raw track data from the sensor
 * @param {string} format    - One of: 'json' | 'asterix_stub' | 'nmea_stub'
 * @returns {{ sensorId: string, observations: object[], valid: boolean, error?: string }}
 */
function normalizeSensorTrack(rawData, format = 'json') {
    try {
        const sensorId = rawData.sensorId || rawData.sensor_id || 'UNKNOWN';
        const rawPoints = Array.isArray(rawData.points) ? rawData.points
            : Array.isArray(rawData.observations) ? rawData.observations
            : rawData.point ? [rawData.point] : [];

        if (!rawPoints.length) {
            return { sensorId, observations: [], valid: false, error: 'No track points found in input.' };
        }

        let normalizer;
        switch (format) {
            case 'asterix_stub': normalizer = _normalizeAsterixPoint; break;
            case 'nmea_stub':    normalizer = _normalizeNmeaPoint; break;
            case 'json':
            default:             normalizer = _normalizeJsonPoint; break;
        }

        const observations = rawPoints.map(normalizer).filter(p => p.lat !== null || p.x !== null);

        return {
            sensorId,
            format,
            observations,
            valid: observations.length >= 2,
            error: observations.length < 2 ? 'Insufficient valid observations for track fitting.' : undefined
        };
    } catch (err) {
        return { sensorId: 'UNKNOWN', observations: [], valid: false, error: err.message };
    }
}

/**
 * Register a new sensor at runtime (for testing or dynamic configuration).
 * Does NOT persist to disk.
 */
function registerSensor(sensor) {
    if (!sensor || !sensor.id || !sensor.name) {
        throw new Error('registerSensor: sensor must have id and name fields.');
    }
    _sensorMap.set(sensor.id, { ...sensor });
}

/**
 * Look up a sensor by ID.
 * @param {string} sensorId
 * @returns {object|null}
 */
function getSensor(sensorId) {
    return _sensorMap.get(sensorId) || null;
}

/**
 * Validate a normalised track (post-normalisation sanity checks).
 * Returns { valid, issues[] }.
 */
function validateTrack(track) {
    const issues = [];
    if (!track || !Array.isArray(track.observations)) {
        return { valid: false, issues: ['Missing observations array.'] };
    }
    if (track.observations.length < 2) {
        issues.push('Fewer than 2 observations — cannot compute velocity.');
    }
    for (const obs of track.observations) {
        if (obs.lat == null && obs.x == null) {
            issues.push('Observation missing both lat and ECI-x coordinates.');
        }
    }
    return { valid: issues.length === 0, issues };
}

module.exports = {
    SENSOR_REGISTRY,
    normalizeSensorTrack,
    registerSensor,
    getSensor,
    getSensorRegistry: () => SENSOR_REGISTRY,
    validateTrack
};
