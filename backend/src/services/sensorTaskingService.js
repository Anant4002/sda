/**
 * Sensor Tasking Service (Phase-1 Upgrade)
 *
 * Provides deterministic sensor tasking recommendations and coverage gap analysis
 * for satellite tracking operations.
 *
 * Upgrades over previous version:
 *  - Expanded sensor inventory (3 → 10 representative Indian tracking sensors)
 *  - Full sensor metadata (type, range, accuracy, elevation, update rate)
 *  - Sensor type filtering via getRecommendationsForSensorType()
 *  - Coverage gap detection via findCoverageGaps()
 *  - Priority queue sorted by: Indian asset → threat score → pass quality
 *  - SENSOR_INVENTORY exported for reuse by blind spot / other modules
 */

'use strict';

const satelliteService = require('./orbitalPropagationService');

// Sensor Inventory
const SENSOR_INVENTORY = [
    {
        id: 'S-OPT-MNTABU',
        name: 'Mount Abu Electro-Optical Station',
        type: 'OPTICAL',
        lat: 24.5926,
        lon: 72.7156,
        maxRangeKm: 2000,
        minElevationDeg: 10,
        trackingAccuracyKm: 0.5,
        updateRateSeconds: 30,
        operationalStatus: 'ACTIVE',
        isRepresentative: true
    },
    {
        id: 'S-RAD-BLURU',
        name: 'Bengaluru Space Tracking Radar',
        type: 'RADAR',
        lat: 13.0827,
        lon: 77.5877,
        maxRangeKm: 3000,
        minElevationDeg: 5,
        trackingAccuracyKm: 0.8,
        updateRateSeconds: 15,
        operationalStatus: 'ACTIVE',
        isRepresentative: true
    },
    {
        id: 'S-MM-GUW',
        name: 'Guwahati Tracking Station (Multi-Mode)',
        type: 'MULTI_MODE',
        lat: 26.1445,
        lon: 91.7362,
        maxRangeKm: 2500,
        minElevationDeg: 8,
        trackingAccuracyKm: 0.6,
        updateRateSeconds: 20,
        operationalStatus: 'ACTIVE',
        isRepresentative: true
    },
    {
        id: 'S-OPT-TERLS',
        name: 'Thumba TERLS Optical Station',
        type: 'OPTICAL',
        lat: 8.5252,
        lon: 76.8796,
        maxRangeKm: 1800,
        minElevationDeg: 12,
        trackingAccuracyKm: 0.4,
        updateRateSeconds: 30,
        operationalStatus: 'ACTIVE',
        isRepresentative: true
    },
    {
        id: 'S-RAD-SHAR',
        name: 'Sriharikota ISRO Tracking Radar (SDSC)',
        type: 'RADAR',
        lat: 13.7226,
        lon: 80.2279,
        maxRangeKm: 3500,
        minElevationDeg: 4,
        trackingAccuracyKm: 0.3,
        updateRateSeconds: 10,
        operationalStatus: 'ACTIVE',
        isRepresentative: true
    },
    {
        id: 'S-RAD-PORTBLAIR',
        name: 'Port Blair Andaman Surveillance Radar',
        type: 'RADAR',
        lat: 11.6234,
        lon: 92.7265,
        maxRangeKm: 2800,
        minElevationDeg: 6,
        trackingAccuracyKm: 1.0,
        updateRateSeconds: 20,
        operationalStatus: 'ACTIVE',
        isRepresentative: true
    },
    {
        id: 'S-RAD-DELHI',
        name: 'Delhi Air Defence Tracking Radar',
        type: 'RADAR',
        lat: 28.6139,
        lon: 77.2090,
        maxRangeKm: 2000,
        minElevationDeg: 10,
        trackingAccuracyKm: 1.2,
        updateRateSeconds: 15,
        operationalStatus: 'ACTIVE',
        isRepresentative: true
    },
    {
        id: 'S-RAD-JODHPUR',
        name: 'Jodhpur Western Sector Radar',
        type: 'RADAR',
        lat: 26.2389,
        lon: 73.0243,
        maxRangeKm: 2200,
        minElevationDeg: 8,
        trackingAccuracyKm: 1.0,
        updateRateSeconds: 15,
        operationalStatus: 'ACTIVE',
        isRepresentative: true
    },
    {
        id: 'S-OPT-CHENNAI',
        name: 'Chennai Optical Tracking Station',
        type: 'OPTICAL',
        lat: 13.0827,
        lon: 80.2707,
        maxRangeKm: 1600,
        minElevationDeg: 15,
        trackingAccuracyKm: 0.4,
        updateRateSeconds: 30,
        operationalStatus: 'ACTIVE',
        isRepresentative: true
    },
    {
        id: 'S-MM-HYD',
        name: 'Hyderabad DRDO Multi-Mode Ground Station',
        type: 'MULTI_MODE',
        lat: 17.3850,
        lon: 78.4867,
        maxRangeKm: 3000,
        minElevationDeg: 6,
        trackingAccuracyKm: 0.5,
        updateRateSeconds: 10,
        operationalStatus: 'ACTIVE',
        isRepresentative: true
    }
];

// Core pass prediction

/**
 * Find the next visible pass of a satellite over a given sensor.
 *
 * @param {object} record      - SGP4 propagation record
 * @param {object} sensor      - Sensor entry from SENSOR_INVENTORY
 * @param {Date}   now         - Reference time
 * @param {number} orbitMinutes
 * @returns {object|null}      - Pass recommendation or null if no pass found
 */
function _findNextPass(record, sensor, now, orbitMinutes) {
    const observer = {
        longitude: satelliteService.toRadians(sensor.lon),
        latitude: satelliteService.toRadians(sensor.lat),
        height: 0
    };

    const searchWindowMinutes = Math.max(orbitMinutes * 6, 120);
    const windowEnd = new Date(now.getTime() + searchWindowMinutes * 60 * 1000);
    const stepMs = 30 * 1000;
    const minElevDeg = sensor.minElevationDeg || satelliteService.VISIBILITY_ELEVATION_DEG || 5;

    let passStart = null;
    let passEnd = null;
    let maxElevation = -Infinity;

    for (let t = now.getTime(); t <= windowEnd.getTime(); t += stepMs) {
        const time = new Date(t);
        const state = satelliteService.propagateState(record, time, observer);
        if (!state) continue;

        if (state.elevationDeg > minElevDeg) {
            if (!passStart) passStart = time;
            passEnd = time;
            if (state.elevationDeg > maxElevation) maxElevation = state.elevationDeg;
        } else {
            if (passStart && passEnd) break; // First complete pass found
        }
    }

    if (!passStart || !passEnd) return null;

    const durationSec = Math.round((passEnd.getTime() - passStart.getTime()) / 1000) || 10;
    const midpoint = new Date((passStart.getTime() + passEnd.getTime()) / 2);
    const midpointState = satelliteService.propagateState(record, midpoint, null);
    const predictedPassCentroid = midpointState ? { lat: midpointState.lat, lon: midpointState.lon } : null;

    const elevScore = Math.max(0, Math.min(1, (maxElevation - minElevDeg) / 50));
    const durScore = Math.max(0, Math.min(1, durationSec / 180));
    // Accuracy bonus: lower trackingAccuracyKm → better
    const accScore = Math.max(0, Math.min(1, 1 - (sensor.trackingAccuracyKm - 0.3) / 2));
    const confidence = Math.max(0.2, Math.min(0.99, (0.5 * elevScore + 0.3 * durScore + 0.2 * accScore)));

    return {
        sensorId: sensor.id,
        sensorName: sensor.name,
        sensorType: sensor.type,
        maxRangeKm: sensor.maxRangeKm,
        trackingAccuracyKm: sensor.trackingAccuracyKm,
        updateRateSeconds: sensor.updateRateSeconds,
        recommendedTime: midpoint.toISOString(),
        passStart: passStart.toISOString(),
        passEnd: passEnd.toISOString(),
        estimatedPassDurationSec: durationSec,
        predictedPassCentroid,
        maxElevationDeg: Math.round(maxElevation * 10) / 10,
        confidence,
        priority: confidence > 0.7 ? 'High' : (confidence > 0.4 ? 'Medium' : 'Low')
    };
}

// Priority scoring

/**
 * Compute a sort score for a recommendation — higher = sooner first.
 * Priority order: Indian asset → high threat → early time → high confidence.
 *
 * @param {object} rec         - Recommendation from _findNextPass
 * @param {boolean} isIndian   - Whether the satellite is Indian-owned
 * @param {number} threatScore - Optional threat score from correlation engine (0–100)
 */
function _sortScore(rec, isIndian, threatScore) {
    const priorityWeight = { High: 3, Medium: 2, Low: 1 };
    const pw = priorityWeight[rec.priority] || 1;
    const indianBonus = isIndian ? 10 : 0;
    const threatBonus = Number.isFinite(threatScore) ? threatScore / 20 : 0;
    return pw + indianBonus + threatBonus;
}

// Public API

/**
 * Get sensor tasking recommendations for a satellite (all sensor types).
 * Preserves original function signature for full backward compatibility.
 *
 * @param {object} satellite
 * @param {object} [options]
 * @param {boolean} [options.isIndian]
 * @param {number}  [options.threatScore]
 * @returns {object[]}
 */
function getSensorTaskingRecommendations(satellite, options = {}) {
    if (!satellite || !satellite.line1 || !satellite.line2) return [];

    try {
        const record = satelliteService.createPropagationRecord(satellite);
        if (!record) return [];

        const now = new Date();
        const orbitMinutes = satelliteService.getOrbitMinutes(record);
        const activeSensors = SENSOR_INVENTORY.filter(s => s.operationalStatus === 'ACTIVE');
        const isIndian = options.isIndian || false;
        const threatScore = options.threatScore || 0;

        const recommendations = [];
        for (const sensor of activeSensors) {
            const rec = _findNextPass(record, sensor, now, orbitMinutes);
            if (rec) recommendations.push(rec);
        }

        // Sort by priority queue: Indian → threat → pass quality → earliest time
        recommendations.sort((a, b) => {
            const scoreA = _sortScore(a, isIndian, threatScore);
            const scoreB = _sortScore(b, isIndian, threatScore);
            if (scoreB !== scoreA) return scoreB - scoreA;
            return new Date(a.recommendedTime) - new Date(b.recommendedTime);
        });

        return recommendations.slice(0, 5); // top 5 recommendations
    } catch (e) {
        console.warn('Sensor tasking failed:', e);
        return [];
    }
}

/**
 * Get recommendations filtered to a specific sensor type.
 *
 * @param {object} satellite
 * @param {string} sensorType   - 'RADAR' | 'OPTICAL' | 'MULTI_MODE'
 * @param {object} [options]
 * @returns {object[]}
 */
function getRecommendationsForSensorType(satellite, sensorType, options = {}) {
    if (!satellite || !satellite.line1 || !satellite.line2) return [];

    try {
        const record = satelliteService.createPropagationRecord(satellite);
        if (!record) return [];

        const now = new Date();
        const orbitMinutes = satelliteService.getOrbitMinutes(record);
        const sensors = SENSOR_INVENTORY.filter(
            s => s.operationalStatus === 'ACTIVE' && s.type === sensorType.toUpperCase()
        );

        const recommendations = [];
        for (const sensor of sensors) {
            const rec = _findNextPass(record, sensor, now, orbitMinutes);
            if (rec) recommendations.push(rec);
        }

        const isIndian = options.isIndian || false;
        const threatScore = options.threatScore || 0;

        recommendations.sort((a, b) => {
            const scoreA = _sortScore(a, isIndian, threatScore);
            const scoreB = _sortScore(b, isIndian, threatScore);
            if (scoreB !== scoreA) return scoreB - scoreA;
            return new Date(a.recommendedTime) - new Date(b.recommendedTime);
        });

        return recommendations.slice(0, 3);
    } catch (e) {
        console.warn('Sensor type filtering failed:', e);
        return [];
    }
}

/**
 * Find coverage gaps — windows where no sensor has line-of-sight to any
 * satellite in the provided list, over a given time window.
 *
 * @param {object[]} satellites      - Array of satellite objects with line1/line2
 * @param {number}   windowMinutes   - Look-ahead window in minutes
 * @returns {{ start: string, end: string, durationMinutes: number }[]}
 */
function findCoverageGaps(satellites, windowMinutes = 120) {
    if (!Array.isArray(satellites) || !satellites.length) return [];

    try {
        const now = new Date();
        const windowEnd = new Date(now.getTime() + windowMinutes * 60 * 1000);
        const stepMs = 60 * 1000; // 1-minute steps for coverage scan
        const activeSensors = SENSOR_INVENTORY.filter(s => s.operationalStatus === 'ACTIVE');

        // Pre-build propagation records
        const records = satellites.map(sat => {
            try {
                return satelliteService.createPropagationRecord(sat);
            } catch {
                return null;
            }
        }).filter(Boolean);

        if (!records.length) return [];

        const gaps = [];
        let gapStart = null;

        for (let t = now.getTime(); t <= windowEnd.getTime(); t += stepMs) {
            const time = new Date(t);
            let anyCovered = false;

            // Check if any sensor covers any satellite at this time
            outer: for (const record of records) {
                for (const sensor of activeSensors) {
                    const observer = {
                        longitude: satelliteService.toRadians(sensor.lon),
                        latitude: satelliteService.toRadians(sensor.lat),
                        height: 0
                    };
                    const state = satelliteService.propagateState(record, time, observer);
                    if (state && state.elevationDeg > (sensor.minElevationDeg || 5)) {
                        anyCovered = true;
                        break outer;
                    }
                }
            }

            if (!anyCovered) {
                if (!gapStart) gapStart = time;
            } else {
                if (gapStart) {
                    const durationMs = t - gapStart.getTime();
                    gaps.push({
                        start: gapStart.toISOString(),
                        end: time.toISOString(),
                        durationMinutes: Math.round(durationMs / 60000)
                    });
                    gapStart = null;
                }
            }
        }

        // Close any open gap at window end
        if (gapStart) {
            gaps.push({
                start: gapStart.toISOString(),
                end: windowEnd.toISOString(),
                durationMinutes: Math.round((windowEnd.getTime() - gapStart.getTime()) / 60000)
            });
        }

        return gaps;
    } catch (e) {
        console.warn('Coverage gap detection failed:', e);
        return [];
    }
}

module.exports = {
    SENSOR_INVENTORY,
    getSensorTaskingRecommendations,
    getRecommendationsForSensorType,
    findCoverageGaps
};
