const satellite = require("satellite.js");
const { getSampleIntervalSeconds } = require("../../../shared/orbitUtils");

const VISIBILITY_ELEVATION_DEG = 10;

function toRadians(degrees) {
    return (degrees * Math.PI) / 180;
}

function toDegrees(radians) {
    return (radians * 180) / Math.PI;
}

function normalizeLongitude(lon) {
    let value = lon;
    while (value > 180) {
        value -= 360;
    }
    while (value < -180) {
        value += 360;
    }
    return value;
}

function computeCentroid(points) {
    return points.reduce((accumulator, point) => ({
        lat: accumulator.lat + point.lat / points.length,
        lon: accumulator.lon + point.lon / points.length
    }), { lat: 0, lon: 0 });
}

function pointInPolygon(point, polygon) {
    let isInside = false;
    const testLon = normalizeLongitude(point.lon);
    const testLat = point.lat;

    for (let firstIndex = 0, secondIndex = polygon.length - 1; firstIndex < polygon.length; secondIndex = firstIndex++) {
        const firstPoint = polygon[firstIndex];
        const secondPoint = polygon[secondIndex];
        const firstLon = normalizeLongitude(firstPoint.lon);
        const secondLon = normalizeLongitude(secondPoint.lon);
        const intersects = ((firstPoint.lat > testLat) !== (secondPoint.lat > testLat)) &&
            (testLon < ((secondLon - firstLon) * (testLat - firstPoint.lat)) / ((secondPoint.lat - firstPoint.lat) || Number.EPSILON) + firstLon);

        if (intersects) {
            isInside = !isInside;
        }
    }

    return isInside;
}

function haversineKm(lat1, lon1, lat2, lon2) {
    const earthRadiusKm = 6371;
    const dLat = toRadians(lat2 - lat1);
    const dLon = toRadians(lon2 - lon1);
    const a =
        Math.sin(dLat / 2) * Math.sin(dLat / 2) +
        Math.cos(toRadians(lat1)) * Math.cos(toRadians(lat2)) *
        Math.sin(dLon / 2) * Math.sin(dLon / 2);

    return 2 * earthRadiusKm * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

function distanceBetweenEci(first, second) {
    const dx = first.x - second.x;
    const dy = first.y - second.y;
    const dz = first.z - second.z;
    return Math.sqrt(dx * dx + dy * dy + dz * dz);
}

function parseMeanMotion(line2) {
    if (!line2 || line2.length < 63) {
        return 15;
    }

    const rawValue = line2.substring(52, 63).trim();
    const parsedValue = Number.parseFloat(rawValue);
    return Number.isFinite(parsedValue) && parsedValue > 0 ? parsedValue : 15;
}

/**
 * Parse classical orbital fields from TLE line 2 (fixed-width GP format).
 * Indices follow CelesTrak / NORAD GP documentation (0-based substring end exclusive).
 */
function parseTleLine2OrbitalMetrics(line2) {
    if (!line2 || line2.length < 63) {
        return null;
    }

    const inclinationDeg = Number.parseFloat(line2.substring(8, 16).trim());
    const raanDeg = Number.parseFloat(line2.substring(16, 25).trim());
    const eccentricityToken = line2.substring(26, 33).trim();
    const eccentricity = Number.parseFloat(eccentricityToken ? `0.${eccentricityToken}` : "0");
    const argPerigeeDeg = Number.parseFloat(line2.substring(34, 42).trim());
    const meanAnomalyDeg = Number.parseFloat(line2.substring(43, 51).trim());
    const meanMotionRevPerDay = parseMeanMotion(line2);

    if (![inclinationDeg, raanDeg, eccentricity, argPerigeeDeg, meanAnomalyDeg, meanMotionRevPerDay].every(Number.isFinite)) {
        return null;
    }

    // Calculate Semi-Major Axis (SMA)
    // mu = 398600.4418 km^3/s^2
    // n (rad/s) = meanMotionRevPerDay * 2 * pi / 86400
    // a = (mu / n^2)^(1/3)
    const mu = 398600.4418;
    const nRadS = (meanMotionRevPerDay * 2 * Math.PI) / 86400;
    const semiMajorAxisKm = Math.pow(mu / (nRadS * nRadS), 1 / 3);

    return {
        inclinationDeg,
        raanDeg,
        eccentricity,
        argPerigeeDeg,
        meanAnomalyDeg,
        meanMotionRevPerDay,
        semiMajorAxisKm
    };
}

function createPropagationRecord(satelliteRow) {
    if (!satelliteRow) {
        return null;
    }

    return {
        id: satelliteRow.name,
        noradId: satelliteRow.noradId,
        isIndian: Boolean(satelliteRow.isIndian),
        meanMotionRevPerDay: parseMeanMotion(satelliteRow.line2),
        satrec: satellite.twoline2satrec(satelliteRow.line1, satelliteRow.line2)
    };
}

function createPropagationRecords(satellites) {
    return (Array.isArray(satellites) ? satellites : [])
        .filter((satelliteRow) => satelliteRow && typeof satelliteRow.name === "string" && typeof satelliteRow.line1 === "string" && typeof satelliteRow.line2 === "string")
        .map(createPropagationRecord)
        .filter((record) => record && !Number.isNaN(record.satrec?.satnum));
}

function getOrbitMinutes(record) {
    return 1440 / record.meanMotionRevPerDay;
}

function getOrbitSampleSeconds(record) {
    // Why: all orbit-path producers should share the same satrec-driven sampling rule to keep shapes consistent.
    return getSampleIntervalSeconds(record?.satrec);
}

function buildOrbitPathSamples(record, startDate, endDate) {
    if (!record || !(startDate instanceof Date) || !(endDate instanceof Date) || endDate < startDate) {
        return [];
    }

    const sampleStepSeconds = getOrbitSampleSeconds(record);
    const samples = [];

    // Why: visualization paths need dense, period-scaled resampling instead of inheriting coarse analysis step spacing.
    for (let timeMs = startDate.getTime(); timeMs <= endDate.getTime(); timeMs += sampleStepSeconds * 1000) {
        const time = new Date(timeMs);
        const state = propagateState(record, time, null);
        if (!state) {
            continue;
        }

        samples.push({
            x: state.eci.x * 1000,
            y: state.eci.y * 1000,
            z: state.eci.z * 1000,
            lat: state.lat,
            lon: state.lon,
            altKm: state.altKm,
            time: time.toISOString()
        });
    }

    const finalSampleTimeMs = endDate.getTime();
    if (!samples.length || samples[samples.length - 1].time !== endDate.toISOString()) {
        const finalState = propagateState(record, endDate, null);
        if (finalState) {
            samples.push({
                x: finalState.eci.x * 1000,
                y: finalState.eci.y * 1000,
                z: finalState.eci.z * 1000,
                lat: finalState.lat,
                lon: finalState.lon,
                altKm: finalState.altKm,
                time: endDate.toISOString()
            });
        }
    }

    return samples;
}

let lastGmstTime = null;
let lastGmstValue = null;

function propagateState(record, date, observer = null, fixedGmst = null) {
    const pva = satellite.propagate(record.satrec, date);
    if (!pva.position) {
        return null;
    }

    const timeMs = date.getTime();
    const gmst = fixedGmst !== null ? fixedGmst : (timeMs === lastGmstTime ? lastGmstValue : (lastGmstTime = timeMs, lastGmstValue = satellite.gstime(date)));
    
    const geodetic = satellite.eciToGeodetic(pva.position, gmst);
    const ecf = satellite.eciToEcf(pva.position, gmst);
    const lookAngles = observer ? satellite.ecfToLookAngles(observer, ecf) : null;

    return {
        eci: pva.position,
        ecf: ecf,
        velocityEci: pva.velocity || null,
        lat: satellite.degreesLat(geodetic.latitude),
        lon: satellite.degreesLong(geodetic.longitude),
        altKm: geodetic.height,
        elevationDeg: lookAngles ? toDegrees(lookAngles.elevation) : -90
    };
}

/**
 * Iterative Time of Closest Approach (TCA) Refinement
 */
function findTcaBetweenRecords(record1, record2, windowStart, windowDurationSeconds) {
    let bestTca = windowStart;
    let minDistance = Infinity;
    
    // Pass 1: 15-second steps for efficiency
    for (let offset = 0; offset <= windowDurationSeconds; offset += 15) {
        const time = new Date(windowStart.getTime() + offset * 1000);
        const s1 = propagateState(record1, time, null);
        const s2 = propagateState(record2, time, null);
        if (!s1 || !s2) continue;
        
        const dist = distanceBetweenEci(s1.eci, s2.eci);
        if (dist < minDistance) {
            minDistance = dist;
            bestTca = time;
        }
    }
    
    // Pass 2: 1-second refinement around the best coarse point
    const refStart = new Date(bestTca.getTime() - 15000);
    for (let offset = 0; offset <= 30; offset += 1) {
        const time = new Date(refStart.getTime() + offset * 1000);
        const s1 = propagateState(record1, time, null);
        const s2 = propagateState(record2, time, null);
        if (!s1 || !s2) continue;
        
        const dist = distanceBetweenEci(s1.eci, s2.eci);
        if (dist < minDistance) {
            minDistance = dist;
            bestTca = time;
        }
    }
    
    return { tca: bestTca, missDistanceKm: minDistance };
}

/**
 * Analytical Probability of Collision (Pc) using the Foster method (2D simplification).
 * Why: Standard in space operations for TLE-based risk assessment.
 * 
 * @param {number} missDistanceKm - Euclidean distance at TCA
 * @param {number} relativeVelocityKmS - Speed at TCA
 * @param {Object} primarySatrec - satrec of the subject satellite
 * @param {Object} secondarySatrec - satrec of the object
 * @param {Date} tcaDate - The date of TCA
 * @param {number} combinedRadiusMeters - Hard-body radius (default 10m)
 */
function calculateFosterPc(missDistanceKm, relativeVelocityKmS, primarySatrec, secondarySatrec, tcaDate, combinedRadiusMeters = 10) {
    if (missDistanceKm <= 0) return 1.0;

    // 1. Estimate Positional Uncertainty (Sigma)
    // TLEs do not provide covariance. We use a standard heuristic: 
    // Error grows ~2km per day since epoch.
    const julianDateToDate = (julianDate) => new Date((julianDate - 2440587.5) * 86400000);
    const getSigma = (satrec, date) => {
        const epochDate = Number.isFinite(satrec?.jdsatepoch)
            ? julianDateToDate(satrec.jdsatepoch)
            : null;
        if (!epochDate) {
            return 1.0;
        }
        const daysSinceEpoch = Math.abs(date.getTime() - epochDate.getTime()) / (1000 * 60 * 60 * 24);
        // Base uncertainty (1km) + 2km per day
        return (1.0 + 2.0 * daysSinceEpoch);
    };

    const sigma1 = getSigma(primarySatrec, tcaDate);
    const sigma2 = getSigma(secondarySatrec, tcaDate);
    
    // Combined Sigma in the encounter plane
    const sigma = Math.sqrt(sigma1 * sigma1 + sigma2 * sigma2);
    
    // 2. Foster 2D Integration (Simplified for circular hard-body)
    // Pc = exp(-0.5 * (d/sigma)^2) * (1 - exp(-0.5 * (R/sigma)^2))
    // Where d = miss distance, R = combined hard-body radius
    const R = combinedRadiusMeters / 1000; // km
    const d = missDistanceKm;

    const term1 = Math.exp(-0.5 * Math.pow(d / sigma, 2));
    const term2 = 1 - Math.exp(-0.5 * Math.pow(R / sigma, 2));
    
    const pc = term1 * term2;
    
    // Clamp to 0..1 range
    return Math.max(0, Math.min(1.0, pc));
}

module.exports = {
    VISIBILITY_ELEVATION_DEG,
    computeCentroid,
    createPropagationRecord,
    createPropagationRecords,
    distanceBetweenEci,
    findTcaBetweenRecords,
    calculateFosterPc,
    getOrbitMinutes,
    buildOrbitPathSamples,
    getOrbitSampleSeconds,
    haversineKm,
    parseMeanMotion,
    parseTleLine2OrbitalMetrics,
    pointInPolygon,
    propagateState,
    toDegrees,
    toRadians
};
