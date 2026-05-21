const { RapidExecution } = require("../models/rapidExecution");
const { recordOperationalAlert } = require("./operationalAlertService");
const { haversineKm } = require("./orbitalPropagationService");
const { Op } = require("sequelize");

/**
 * Rapid Processing Service (Enhanced for Sub-orbital Threats)
 * 
 * Delivers rapid identification of ballistic missiles, HGVs, meteors, and debris
 * using low-latency sensor track ingestion and trajectory fitting.
 */

const INDIA_CENTROID = { lat: 20.5937, lon: 78.9629 };

// Object Types as per proposal
const OBJECT_TYPES = {
    MISSILE: "Ballistic Missile",
    HGV: "Hypersonic Glide Vehicle",
    ORBITAL: "Orbital Object",
    METEOR: "Meteor",
    DEBRIS: "Satellite Debris"
};

// Internal list to store recent "Rapid Tracks" (In-memory for POC low-latency simulation)
let recentRapidTracks = [];

/**
 * Ingest direct radar/sensor track data (Low-latency)
 */
async function ingestSensorTrack(trackData) {
    const { points, sensorId } = trackData;
    
    // 1. Trajectory Fitting & Classification
    const classification = classifyTrack(points);
    
    // 2. Trajectory Prediction
    const prediction = predictTrajectory(points, classification.type);
    
    // 3. Threat Assessment
    const threatStatus = assessThreat(prediction, classification.type);
    
    const result = {
        id: `TRK-${Date.now()}`,
        type: classification.type,
        confidence: classification.confidence,
        trajectory: prediction.path,
        impactPoint: prediction.impactPoint,
        impactTime: prediction.impactTime,
        threatLevel: threatStatus.level,
        threatMessage: threatStatus.message,
        timestamp: new Date().toISOString()
    };

    recentRapidTracks.unshift(result);
    if (recentRapidTracks.length > 50) recentRapidTracks.pop();

    // 4. Instant Threat Alerting (Proposal Requirement 3)
    if (result.threatLevel !== "NON-THREAT") {
        await recordOperationalAlert({
            title: `Rapid Threat Detected: ${result.type}`,
            severity: result.threatLevel.toLowerCase(),
            message: result.threatMessage,
            primaryId: result.id,
            occurredAt: result.timestamp,
            details: result
        });
    }

    return result;
}

/**
 * Classify track based on velocity, altitude, and trajectory profile
 */
function classifyTrack(points) {
    if (points.length < 2) return { type: OBJECT_TYPES.ORBITAL, confidence: 0.5 };

    const p1 = points[0];
    const p2 = points[points.length - 1];
    
    const durationSec = (new Date(p2.time) - new Date(p1.time)) / 1000;
    const distKm = Math.sqrt(Math.pow(p2.x - p1.x, 2) + Math.pow(p2.y - p1.y, 2) + Math.pow(p2.z - p1.z, 2));
    const velocityKmS = distKm / durationSec;
    const avgAltKm = points.reduce((acc, p) => acc + p.altKm, 0) / points.length;

    // Classification Logic (Proposal Requirement 2)
    if (velocityKmS > 11) return { type: OBJECT_TYPES.METEOR, confidence: 0.9 };
    if (avgAltKm < 100) {
        if (velocityKmS > 5 && velocityKmS < 10) return { type: OBJECT_TYPES.HGV, confidence: 0.85 };
        return { type: OBJECT_TYPES.MISSILE, confidence: 0.8 };
    }
    if (avgAltKm > 160 && avgAltKm < 2000) return { type: OBJECT_TYPES.ORBITAL, confidence: 0.95 };
    
    return { type: OBJECT_TYPES.DEBRIS, confidence: 0.7 };
}

/**
 * Simple parabolic or linear trajectory prediction
 */
function predictTrajectory(points, type) {
    const lastPoint = points[points.length - 1];
    const path = [...points];
    
    // Simplified: extend trajectory for 10 minutes
    const steps = 60;
    const stepSec = 10;
    
    let currentPos = { ...lastPoint };
    // Basic velocity vector from last two points
    const pPrev = points[points.length - 2] || points[points.length - 1];
    const vx = (lastPoint.x - pPrev.x) / ((new Date(lastPoint.time) - new Date(pPrev.time)) / 1000 || 1);
    const vy = (lastPoint.y - pPrev.y) / ((new Date(lastPoint.time) - new Date(pPrev.time)) / 1000 || 1);
    const vz = (lastPoint.z - pPrev.z) / ((new Date(lastPoint.time) - new Date(pPrev.time)) / 1000 || 1);

    let impactPoint = null;
    let impactTime = null;

    for (let i = 1; i <= steps; i++) {
        currentPos = {
            x: currentPos.x + vx * stepSec,
            y: currentPos.y + vy * stepSec,
            z: currentPos.z + vz * stepSec,
            altKm: currentPos.altKm - (type === OBJECT_TYPES.MISSILE ? 2 : 0.5), // Heuristic sink rate
            time: new Date(new Date(currentPos.time).getTime() + stepSec * 1000).toISOString()
        };
        
        // Approx lat/lon for visual
        currentPos.lat = lastPoint.lat + (i * 0.1); 
        currentPos.lon = lastPoint.lon + (i * 0.1);

        path.push(currentPos);
        
        if (currentPos.altKm <= 0 && !impactPoint) {
            impactPoint = { lat: currentPos.lat, lon: currentPos.lon };
            impactTime = currentPos.time;
            break;
        }
    }

    return { path, impactPoint, impactTime };
}

/**
 * Assess threat level (Proposal Requirement: CRITICAL, WARNING, NON-THREAT)
 */
function assessThreat(prediction, type) {
    if (type === OBJECT_TYPES.METEOR) return { level: "NON-THREAT", message: "Meteor detected. No threat to assets." };
    
    const impactDist = prediction.impactPoint ? haversineKm(INDIA_CENTROID.lat, INDIA_CENTROID.lon, prediction.impactPoint.lat, prediction.impactPoint.lon) : 9999;
    
    if ((type === OBJECT_TYPES.MISSILE || type === OBJECT_TYPES.HGV) && impactDist < 1500) {
        return { level: "CRITICAL", message: `${type} trajectory identified toward national territory.` };
    }
    
    if (type === OBJECT_TYPES.DEBRIS) {
        return { level: "WARNING", message: "Satellite debris posing potential collision risk to LEO assets." };
    }

    return { level: "LOW", message: "Object trajectory monitored. No immediate threat." };
}

async function getRapidTracks() {
    return recentRapidTracks;
}

// Keep existing legacy methods for compatibility
async function cleanupStuckExecutions() {
    const threshold = new Date(Date.now() - 5 * 60 * 1000);
    await RapidExecution.update({ status: "failed", endTime: new Date() }, {
        where: { status: "running", startTime: { [Op.lt]: threshold } }
    });
}

async function getLatestExecution() {
    return RapidExecution.findOne({ order: [["start_time", "DESC"]] });
}

module.exports = {
    ingestSensorTrack,
    getRapidTracks,
    getLatestExecution,
    cleanupStuckExecutions
};

