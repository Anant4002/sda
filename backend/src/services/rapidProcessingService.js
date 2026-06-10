/**
 * Rapid Processing Service (Phase-1 Upgrade)
 *
 * Delivers rapid identification of ballistic missiles, HGVs, ASATs, meteors,
 * and orbital debris using:
 *   - Least-squares track fitting for velocity/acceleration estimation
 *   - Exponential state smoothing for noise reduction
 *   - Weighted feature-score classification engine
 *   - Physics-aware trajectory prediction (ballistic arc, glide, orbital)
 *   - Sensor adapter integration for multi-format ingestion
 */

'use strict';

const { RapidExecution } = require('../models/rapidExecution');
const { recordOperationalAlert } = require('./operationalAlertService');
const { haversineKm } = require('./orbitalPropagationService');
const { normalizeSensorTrack, getSensor } = require('./sensorAdapterService');
const { Op } = require('sequelize');

// ---------------------------------------------------------------------------
// CONSTANTS
// ---------------------------------------------------------------------------

const INDIA_CENTROID = { lat: 20.5937, lon: 78.9629 };
const EARTH_RADIUS_KM = 6371.0;
const G_KM_S2 = 0.00981; // 9.81 m/s² → km/s²

const OBJECT_TYPES = {
    BALLISTIC_MISSILE: 'Ballistic Missile',
    HGV: 'Hypersonic Glide Vehicle',
    ASAT: 'Anti-Satellite Threat',
    ORBITAL_OBJECT: 'Orbital Object',
    METEOR: 'Meteor',
    SATELLITE_DEBRIS: 'Satellite Debris',
    UNKNOWN: 'Unknown Object'
};

const PREDICTION_MODES = {
    BALLISTIC: 'BALLISTIC',
    GLIDE: 'GLIDE',
    ORBITAL: 'ORBITAL'
};

// In-memory track store (low-latency, no DB round-trip for recent tracks)
let recentRapidTracks = [];

// ---------------------------------------------------------------------------
// 1. TRACK FITTING ENGINE — least-squares over all observations
// ---------------------------------------------------------------------------

/**
 * Fit a linear model to the track using least-squares regression.
 * Returns smoothed velocity, approximate acceleration, and curvature.
 *
 * @param {object[]} points  - Raw track points with x, y, z, altKm, time
 * @returns {{ velocity: number, acceleration: number, curvature: number, confidence: number }}
 */
function fitTrack(points) {
    if (!Array.isArray(points) || points.length < 2) {
        return { velocity: 0, acceleration: 0, curvature: 0, confidence: 0 };
    }

    // Build time-indexed position vectors (ECI km)
    const t0 = new Date(points[0].time).getTime() / 1000; // seconds
    const samples = points.map(p => ({
        t: new Date(p.time).getTime() / 1000 - t0,
        x: p.x || 0,
        y: p.y || 0,
        z: p.z || 0,
        alt: p.altKm || 0
    })).filter(s => Number.isFinite(s.t) && s.t >= 0);

    if (samples.length < 2) {
        return { velocity: 0, acceleration: 0, curvature: 0, confidence: 0 };
    }

    // Least-squares linear fit for each axis: pos = a + b*t
    function lsFit(axis) {
        const n = samples.length;
        let sumT = 0, sumV = 0, sumT2 = 0, sumTV = 0;
        for (const s of samples) {
            sumT += s.t;
            sumV += s[axis];
            sumT2 += s.t * s.t;
            sumTV += s.t * s[axis];
        }
        const denom = n * sumT2 - sumT * sumT;
        if (Math.abs(denom) < 1e-12) return { slope: 0, intercept: sumV / n };
        return {
            slope: (n * sumTV - sumT * sumV) / denom,
            intercept: (sumV * sumT2 - sumT * sumTV) / denom
        };
    }

    const fx = lsFit('x');
    const fy = lsFit('y');
    const fz = lsFit('z');

    // Velocity magnitude from fitted slopes (km/s)
    const velocity = Math.sqrt(fx.slope ** 2 + fy.slope ** 2 + fz.slope ** 2);

    // Acceleration: estimate from residuals of consecutive velocity differences
    let accelSum = 0;
    let accelCount = 0;
    for (let i = 1; i < samples.length; i++) {
        const dt = samples[i].t - samples[i - 1].t;
        if (dt <= 0) continue;
        const dvx = ((samples[i].x - samples[i - 1].x) / dt) - fx.slope;
        const dvy = ((samples[i].y - samples[i - 1].y) / dt) - fy.slope;
        const dvz = ((samples[i].z - samples[i - 1].z) / dt) - fz.slope;
        accelSum += Math.sqrt(dvx ** 2 + dvy ** 2 + dvz ** 2) / dt;
        accelCount++;
    }
    const acceleration = accelCount > 0 ? accelSum / accelCount : 0;

    // Curvature: variance in altitude trend
    const altSlope = lsFit('alt');
    let altResidualSum = 0;
    for (const s of samples) {
        const predicted = altSlope.intercept + altSlope.slope * s.t;
        altResidualSum += Math.abs(s.alt - predicted);
    }
    const curvature = samples.length > 1 ? altResidualSum / samples.length : 0;

    // Confidence: more points → higher confidence, capped at 0.95
    const confidence = Math.min(0.95, 0.5 + (samples.length - 2) * 0.09);

    return { velocity, acceleration, curvature, altSlope: altSlope.slope, confidence };
}

// ---------------------------------------------------------------------------
// 2. STATE SMOOTHING (Exponential)
// ---------------------------------------------------------------------------

/**
 * Apply exponential smoothing to a sequence of track observations.
 * Alpha controls responsiveness vs noise rejection.
 *
 * @param {object[]} points
 * @returns {{ smoothedVelocity: number, smoothedAcceleration: number, smoothedAltitude: number }}
 */
function smoothTrackHistory(points) {
    if (!Array.isArray(points) || points.length < 2) {
        return { smoothedVelocity: 0, smoothedAcceleration: 0, smoothedAltitude: 0 };
    }

    const ALPHA = 0.4; // smoothing factor

    // Compute raw per-step velocities and altitudes
    const steps = [];
    for (let i = 1; i < points.length; i++) {
        const dt = (new Date(points[i].time) - new Date(points[i - 1].time)) / 1000;
        if (dt <= 0) continue;
        const dx = (points[i].x || 0) - (points[i - 1].x || 0);
        const dy = (points[i].y || 0) - (points[i - 1].y || 0);
        const dz = (points[i].z || 0) - (points[i - 1].z || 0);
        steps.push({
            v: Math.sqrt(dx ** 2 + dy ** 2 + dz ** 2) / dt,
            alt: points[i].altKm || 0
        });
    }

    if (!steps.length) return { smoothedVelocity: 0, smoothedAcceleration: 0, smoothedAltitude: 0 };

    // Exponential smoothing
    let sv = steps[0].v;
    let sa = steps[0].alt;
    for (let i = 1; i < steps.length; i++) {
        sv = ALPHA * steps[i].v + (1 - ALPHA) * sv;
        sa = ALPHA * steps[i].alt + (1 - ALPHA) * sa;
    }

    // Acceleration: change in smoothed velocity across first/last step
    const totalTime = (new Date(points[points.length - 1].time) - new Date(points[0].time)) / 1000;
    const dv = steps[steps.length - 1].v - steps[0].v;
    const smoothedAcceleration = totalTime > 0 ? dv / totalTime : 0;

    return {
        smoothedVelocity: sv,
        smoothedAcceleration,
        smoothedAltitude: sa
    };
}

// ---------------------------------------------------------------------------
// 3. THREAT CLASSIFICATION ENGINE — weighted feature scoring
// ---------------------------------------------------------------------------

/**
 * Classify a track using weighted feature scores across multiple dimensions.
 *
 * @param {object} fit     - Output of fitTrack()
 * @param {object} smooth  - Output of smoothTrackHistory()
 * @returns {{ classification: string, confidence: number, featureScores: object, explanation: string }}
 */
function classifyTrack(fit, smooth) {
    const { velocity, acceleration, curvature, altSlope } = fit;
    const { smoothedVelocity, smoothedAcceleration, smoothedAltitude } = smooth;

    // Use smoothed where available, fall back to fit
    const vel = smoothedVelocity > 0 ? smoothedVelocity : velocity;
    const acc = Math.abs(smoothedAcceleration > 0 ? smoothedAcceleration : acceleration);
    const alt = smoothedAltitude;

    // Feature scoring — each score 0..1
    const featureScores = {
        velocityScore: 0,
        accelerationScore: 0,
        altitudeScore: 0,
        curvatureScore: 0,
        altSlopeScore: Math.max(0, Math.min(1, 1 - Math.abs(altSlope || 0) / 5))
    };

    // Velocity score: binned across regime boundaries
    if (vel > 11) {
        featureScores.velocityScore = 1.0; // Meteor regime
    } else if (vel > 7.5) {
        featureScores.velocityScore = 0.8; // Orbital / ASAT
    } else if (vel > 5) {
        featureScores.velocityScore = 0.6; // HGV regime
    } else if (vel > 1.5) {
        featureScores.velocityScore = 0.4; // Ballistic regime
    } else {
        featureScores.velocityScore = 0.1; // Slow / debris
    }

    // Acceleration score: high acc → active propulsion
    featureScores.accelerationScore = Math.min(1, acc / 0.5);

    // Altitude score
    if (alt > 160) {
        featureScores.altitudeScore = 1.0; // Orbital
    } else if (alt > 80) {
        featureScores.altitudeScore = 0.7; // Upper atmosphere
    } else if (alt > 30) {
        featureScores.altitudeScore = 0.4; // Stratosphere
    } else {
        featureScores.altitudeScore = 0.1; // Ground approach
    }

    // Curvature score: higher curvature → more ballistic arc
    featureScores.curvatureScore = Math.min(1, curvature / 10);

    // ---
    // Rule-based classifier using feature combinations
    // ---

    // METEOR: very fast, any altitude, high curvature
    if (vel > 11) {
        return {
            classification: OBJECT_TYPES.METEOR,
            confidence: Math.min(0.95, 0.80 + featureScores.velocityScore * 0.15),
            featureScores,
            explanation: `Velocity ${vel.toFixed(2)} km/s exceeds orbital escape; consistent with meteoric entry.`
        };
    }

    // ORBITAL / ASAT: orbital velocity, high altitude
    if (vel > 7.0 && alt > 150) {
        // ASAT: high velocity, declining altitude (altSlope < -0.5 km/s)
        if (altSlope != null && altSlope < -0.5) {
            return {
                classification: OBJECT_TYPES.ASAT,
                confidence: Math.min(0.90, 0.70 + featureScores.accelerationScore * 0.2),
                featureScores,
                explanation: `Orbital velocity with descending altitude profile; consistent with ASAT intercept trajectory.`
            };
        }
        return {
            classification: OBJECT_TYPES.ORBITAL_OBJECT,
            confidence: Math.min(0.95, 0.75 + featureScores.altitudeScore * 0.2),
            featureScores,
            explanation: `Velocity ${vel.toFixed(2)} km/s at ${alt.toFixed(0)} km altitude; consistent with orbital object.`
        };
    }

    // HGV: moderate velocity, low-mid altitude, low curvature (glide)
    if (vel > 4.5 && vel <= 7.5 && alt < 120 && curvature < 5) {
        return {
            classification: OBJECT_TYPES.HGV,
            confidence: Math.min(0.90, 0.70 + (1 - featureScores.curvatureScore) * 0.20),
            featureScores,
            explanation: `Velocity ${vel.toFixed(2)} km/s at ${alt.toFixed(0)} km with low curvature; consistent with hypersonic glide profile.`
        };
    }

    // BALLISTIC MISSILE: lower velocity, high curvature, declining altitude
    if (vel > 1.0 && vel <= 6.0 && curvature > 3) {
        return {
            classification: OBJECT_TYPES.BALLISTIC_MISSILE,
            confidence: Math.min(0.90, 0.65 + featureScores.curvatureScore * 0.25),
            featureScores,
            explanation: `Velocity ${vel.toFixed(2)} km/s with parabolic arc profile; consistent with ballistic missile trajectory.`
        };
    }

    // SATELLITE DEBRIS: orbital-ish velocity, lower altitude, low acceleration
    if (vel > 4.0 && alt > 80 && acc < 0.05) {
        return {
            classification: OBJECT_TYPES.SATELLITE_DEBRIS,
            confidence: Math.min(0.85, 0.60 + featureScores.altitudeScore * 0.25),
            featureScores,
            explanation: `Orbital-range velocity at ${alt.toFixed(0)} km with near-zero acceleration; consistent with uncontrolled debris.`
        };
    }

    // UNKNOWN fallback
    return {
        classification: OBJECT_TYPES.UNKNOWN,
        confidence: 0.40,
        featureScores,
        explanation: `Track characteristics do not match any known threat signature. Continued monitoring recommended.`
    };
}

// ---------------------------------------------------------------------------
// 4. TRAJECTORY PREDICTION — physics-aware
// ---------------------------------------------------------------------------

/**
 * Compute a geodetic position along a ballistic arc given initial conditions.
 * Uses simplified flat-Earth gravity for short-range tracks.
 */
function _ballisticStep(lat, lon, alt, vLat, vLon, vAlt, dt) {
    return {
        lat: lat + vLat * dt,
        lon: lon + vLon * dt,
        altKm: alt + vAlt * dt - 0.5 * G_KM_S2 * dt * dt
    };
}

/**
 * Predict the future trajectory of a track.
 *
 * @param {object[]} points         - Historical track points (with lat, lon, altKm)
 * @param {string}   classification - One of OBJECT_TYPES values
 * @param {object}   fit            - Output of fitTrack()
 * @returns {{ mode: string, path: object[], impactPoint: object|null, impactTime: string|null }}
 */
function predictTrajectory(points, classification, fit) {
    const last = points[points.length - 1];
    const prev = points.length >= 2 ? points[points.length - 2] : last;

    const lastTime = new Date(last.time);
    const dt_obs = Math.max(1, (lastTime - new Date(prev.time)) / 1000); // seconds between last two obs

    // Derive velocity components in geodetic space (deg/s, km/s)
    const vLat = (last.lat - prev.lat) / dt_obs;
    const vLon = (last.lon - prev.lon) / dt_obs;
    const vAlt = ((last.altKm || 0) - (prev.altKm || 0)) / dt_obs;

    const STEP_S = 10;
    const MAX_STEPS = 120; // 20 min look-ahead

    let mode;
    if (classification === OBJECT_TYPES.BALLISTIC_MISSILE || classification === OBJECT_TYPES.ASAT) {
        mode = PREDICTION_MODES.BALLISTIC;
    } else if (classification === OBJECT_TYPES.HGV) {
        mode = PREDICTION_MODES.GLIDE;
    } else {
        mode = PREDICTION_MODES.ORBITAL;
    }

    const path = [...points];
    let curLat = last.lat || 0;
    let curLon = last.lon || 0;
    let curAlt = last.altKm || 0;
    let curVAlt = vAlt;
    let curTime = lastTime.getTime();
    let impactPoint = null;
    let impactTime = null;

    for (let i = 0; i < MAX_STEPS; i++) {
        let nextLat, nextLon, nextAlt;

        if (mode === PREDICTION_MODES.BALLISTIC) {
            // Gravity-accelerated arc
            nextLat = curLat + vLat * STEP_S;
            nextLon = curLon + vLon * STEP_S;
            nextAlt = curAlt + curVAlt * STEP_S - 0.5 * G_KM_S2 * STEP_S * STEP_S;
            curVAlt = curVAlt - G_KM_S2 * STEP_S; // gravity decelerates upward component
        } else if (mode === PREDICTION_MODES.GLIDE) {
            // Glide: shallow declining altitude, near-constant lateral speed
            nextLat = curLat + vLat * STEP_S;
            nextLon = curLon + vLon * STEP_S;
            nextAlt = curAlt + (curVAlt > 0 ? -0.05 : curVAlt) * STEP_S; // slowly descend
        } else {
            // Orbital: near-constant velocity, altitude maintained
            nextLat = curLat + vLat * STEP_S;
            nextLon = curLon + vLon * STEP_S;
            nextAlt = curAlt + vAlt * STEP_S * 0.1; // minimal altitude change
        }

        curTime += STEP_S * 1000;
        curLat = nextLat;
        curLon = nextLon;
        curAlt = nextAlt;

        // Wrap longitude
        if (curLon > 180) curLon -= 360;
        if (curLon < -180) curLon += 360;

        // Clamp latitude
        curLat = Math.max(-90, Math.min(90, curLat));

        path.push({
            lat: curLat,
            lon: curLon,
            altKm: curAlt,
            x: last.x ? last.x + vLon * STEP_S * (i + 1) : undefined,
            y: last.y ? last.y + vLat * STEP_S * (i + 1) : undefined,
            z: last.z,
            time: new Date(curTime).toISOString(),
            predicted: true
        });

        if (curAlt <= 0 && !impactPoint) {
            impactPoint = { lat: curLat, lon: curLon };
            impactTime = new Date(curTime).toISOString();
            break;
        }
    }

    return { mode, path, impactPoint, impactTime };
}

// ---------------------------------------------------------------------------
// 5. THREAT ASSESSMENT
// ---------------------------------------------------------------------------

function assessThreat(prediction, classification) {
    if (classification === OBJECT_TYPES.METEOR) {
        return { level: 'NON-THREAT', message: 'Meteor detected. Natural phenomenon, no threat to space assets.' };
    }

    const impactDist = prediction.impactPoint
        ? haversineKm(INDIA_CENTROID.lat, INDIA_CENTROID.lon, prediction.impactPoint.lat, prediction.impactPoint.lon)
        : 9999;

    if (classification === OBJECT_TYPES.ASAT) {
        return { level: 'CRITICAL', message: `Anti-satellite threat trajectory detected. Intercept profile identified. Indian space assets at risk.` };
    }

    if ((classification === OBJECT_TYPES.BALLISTIC_MISSILE || classification === OBJECT_TYPES.HGV) && impactDist < 1500) {
        return { level: 'CRITICAL', message: `${classification} trajectory toward national territory (est. impact ${impactDist.toFixed(0)} km from centroid).` };
    }

    if (classification === OBJECT_TYPES.SATELLITE_DEBRIS) {
        return { level: 'WARNING', message: 'Satellite debris track detected. Potential LEO collision risk to operational assets.' };
    }

    if (classification === OBJECT_TYPES.UNKNOWN) {
        return { level: 'WARNING', message: 'Unclassified object detected. Continued tracking recommended pending identification.' };
    }

    return { level: 'LOW', message: `${classification} trajectory monitored. No immediate threat to national assets.` };
}

// ---------------------------------------------------------------------------
// 6. MAIN INGEST ENTRY POINT
// ---------------------------------------------------------------------------

/**
 * Ingest a sensor track — normalise, fit, classify, predict, alert.
 *
 * @param {object} trackData   - Raw track (points[], sensorId, format?)
 * @returns {object}           - Full track result
 */
async function ingestSensorTrack(trackData) {
    // Normalise through adapter layer
    const normalized = normalizeSensorTrack(trackData, trackData.format || 'json');
    const { points } = trackData; // retain original for backward compatibility
    const workingPoints = (points && points.length >= 2) ? points : normalized.observations;

    // Enrich observations with sensorId reference
    const sensorInfo = getSensor(normalized.sensorId) || { id: normalized.sensorId, name: normalized.sensorId };

    // Track fitting
    const fit = fitTrack(workingPoints);
    // State smoothing
    const smooth = smoothTrackHistory(workingPoints);
    // Classification
    const classResult = classifyTrack(fit, smooth);
    // Trajectory prediction
    const prediction = predictTrajectory(workingPoints, classResult.classification, fit);
    // Threat assessment
    const threatStatus = assessThreat(prediction, classResult.classification);

    const result = {
        id: `TRK-${Date.now()}`,
        type: classResult.classification,
        confidence: classResult.confidence,
        featureScores: classResult.featureScores,
        explanation: classResult.explanation,
        predictionMode: prediction.mode,
        trajectory: prediction.path,
        impactPoint: prediction.impactPoint,
        impactTime: prediction.impactTime,
        threatLevel: threatStatus.level,
        threatMessage: threatStatus.message,
        sensorId: normalized.sensorId,
        sensorName: sensorInfo.name,
        fitStats: { velocity: fit.velocity, acceleration: fit.acceleration, curvature: fit.curvature },
        smoothStats: { smoothedVelocity: smooth.smoothedVelocity, smoothedAcceleration: smooth.smoothedAcceleration },
        // Processing transparency metadata
        processingMethod: 'least_squares_feature_scoring',
        processingMethodDescription: 'Least-squares track fitting + exponential state smoothing + weighted feature-score classification. No Kalman filter. Confidence improves with more track points (≥5 recommended).',
        disclaimer: 'Classification uses kinematic feature scoring only. Confidence is indicative, not certified. Real radar/sensor integration is not active in this deployment. Results require operator validation before operational use.',
        timestamp: new Date().toISOString()
    };

    // Store in memory
    recentRapidTracks.unshift(result);
    if (recentRapidTracks.length > 50) recentRapidTracks.pop();

    // Alert if threat level warrants
    if (result.threatLevel !== 'NON-THREAT' && result.threatLevel !== 'LOW') {
        await recordOperationalAlert({
            alertType: 'rapid_threat',
            title: `Rapid Threat Detected: ${result.type}`,
            severity: result.threatLevel === 'CRITICAL' ? 'critical' : 'warning',
            message: result.threatMessage,
            primaryId: result.id,
            primaryObjectName: result.id,
            occurredAt: result.timestamp,
            details: result
        });
    }

    return result;
}

// ---------------------------------------------------------------------------
// LEGACY / UTILITY FUNCTIONS
// ---------------------------------------------------------------------------

async function getRapidTracks() {
    return recentRapidTracks;
}

async function cleanupStuckExecutions() {
    const threshold = new Date(Date.now() - 5 * 60 * 1000);
    await RapidExecution.update({ status: 'failed', endTime: new Date() }, {
        where: { status: 'running', startTime: { [Op.lt]: threshold } }
    });
}

async function getLatestExecution() {
    return RapidExecution.findOne({ order: [['start_time', 'DESC']] });
}

module.exports = {
    ingestSensorTrack,
    getRapidTracks,
    getLatestExecution,
    cleanupStuckExecutions,
    // Exported for testing
    fitTrack,
    smoothTrackHistory,
    classifyTrack,
    predictTrajectory
};
