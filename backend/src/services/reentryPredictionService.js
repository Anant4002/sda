const tleRevisionHistoryService = require("./tleRevisionHistoryService");
const { recordOperationalAlert } = require("./operationalAlertService");
const { parseTleLine2OrbitalMetrics, propagateState, toRadians, haversineKm } = require("./orbitalPropagationService");
const { Satellite } = require("../models/satellite");
const { Debris } = require("../models/debris");
const { RocketBody } = require("../models/rocketBody");
const satellite = require("satellite.js");

/**
 * Re-entry Prediction Service
 * 
 * Analyzes historical orbital decay and simulates atmospheric re-entry 
 * using a drag-based model to predict impact corridors and strategic risks.
 */

const REENTRY_ALTITUDE_THRESHOLD_KM = 80; // Re-entry typically considered complete at 80km
const MIN_REVISIONS_FOR_PREDICTION = 3;

// IAF-defined strategic installations
const STRATEGIC_INSTALLATIONS = [
    { name: "Pokhran Test Range", lat: 27.095, lon: 71.753 },
    { name: "Sriharikota", lat: 13.720, lon: 80.230 },
    { name: "Andaman & Nicobar", lat: 11.740, lon: 92.658 },
    { name: "New Delhi", lat: 28.613, lon: 77.209 },
    { name: "Karachi", lat: 24.860, lon: 67.001 },
    { name: "Sri Lanka", lat: 7.873, lon: 80.771 },
    { name: "Indian Ocean (Central)", lat: -5.0, lon: 80.0 }
];

/**
 * Simplified Atmospheric Density Model (Approximating NRLMSISE-00 behavior)
 * Density (kg/m^3) based on altitude (km)
 */
function getAtmosphericDensity(altitudeKm) {
    if (altitudeKm > 1000) return 0;
    
    // Exponential model with scale heights for different layers
    // H (km), rho0 (kg/m^3) at base altitude h0 (km)
    const layers = [
        { h0: 0, rho0: 1.225, H: 8.5 },
        { h0: 100, rho0: 5.297e-7, H: 5.8 },
        { h0: 150, rho0: 2.0e-9, H: 22.5 },
        { h0: 200, rho0: 2.789e-10, H: 37.5 },
        { h0: 300, rho0: 1.916e-11, H: 53.8 },
        { h0: 400, rho0: 2.803e-12, H: 58.2 },
        { h0: 500, rho0: 5.215e-13, H: 63.8 },
        { h0: 700, rho0: 3.070e-14, H: 75.3 }
    ];

    let layer = layers[0];
    for (let i = 1; i < layers.length; i++) {
        if (altitudeKm > layers[i].h0) layer = layers[i];
        else break;
    }

    return layer.rho0 * Math.exp(-(altitudeKm - layer.h0) / layer.H);
}

/**
 * Predict satellite re-entry window and impact corridor
 */
async function predictSatelliteReentry(noradId, satelliteName, options = {}) {
    const { limit = 100, transaction = null } = options;
    
    let history = await tleRevisionHistoryService.getRevisionHistory(noradId, satelliteName, { limit });
    
    if (history.length === 0) {
        let currentSat = await Satellite.findOne({
            where: noradId ? { noradId } : { name: satelliteName },
            transaction
        });
        if (!currentSat) {
            currentSat = await Debris.findOne({
                where: noradId ? { noradId } : { name: satelliteName },
                transaction
            });
        }
        if (!currentSat) {
            currentSat = await RocketBody.findOne({
                where: noradId ? { noradId } : { name: satelliteName },
                transaction
            });
        }
        if (currentSat) {
            history = [{
                line1: currentSat.line1,
                line2: currentSat.line2,
                ingestedAt: new Date(),
                tleEpoch: new Date()
            }];
        }
    }

    const samples = history
        .filter(h => (h.semiMajorAxisKm || h.line2) && (h.tleEpoch || h.ingestedAt))
        .map(h => {
            const metrics = h.semiMajorAxisKm ? h : parseTleLine2OrbitalMetrics(h.line2);
            return {
                line1: h.line1,
                line2: h.line2,
                sma: h.semiMajorAxisKm || metrics?.semiMajorAxisKm,
                altitude: h.meanAltitudeKm || (metrics ? metrics.semiMajorAxisKm - 6371 : null),
                perigee: h.perigeeKm || (metrics ? (metrics.semiMajorAxisKm * (1 - metrics.eccentricity)) - 6371 : null),
                date: h.tleEpoch || h.ingestedAt,
                time: new Date(h.tleEpoch || h.ingestedAt).getTime() / (1000 * 60 * 60 * 24)
            };
        })
        .filter(s => s.sma && s.altitude)
        .sort((a, b) => a.time - b.time);

    const latest = samples.length > 0 ? samples[samples.length - 1] : null;
    const currentAltitude = latest ? latest.altitude : null;
    const currentPerigee = latest ? latest.perigee : null;

    if (samples.length === 0) {
        return {
            satelliteName, noradId, status: "insufficient_data",
            currentAltitudeKm: null, riskLevel: "UNKNOWN", message: "Insufficient historical TLE data."
        };
    }

    // Decay monitoring check (Proposal Requirement 1)
    const isFlaggedForDecay = currentPerigee < 300 || (samples.length >= 3 && calculateDecayAcceleration(samples) > 0.05);
    
    let riskLevel = "LOW";
    if (currentAltitude < 200) riskLevel = "HIGH";
    else if (currentAltitude < 350) riskLevel = "ELEVATED";
    else if (isFlaggedForDecay) riskLevel = "MONITOR";

    if (!isFlaggedForDecay && currentAltitude > 400) {
        return {
            satelliteName, noradId, status: "stable",
            currentAltitudeKm: currentAltitude,
            currentPerigeeKm: currentPerigee,
            timeToImpact: "Stable (> 10 years)",
            indiaSpecificRisk: "No immediate threat to Indian mainland detected (Stable Orbit).",
            riskLevel: "LOW",
            message: "Satellite orbit is stable. No near-term re-entry risk detected.",
            history: samples.map(s => ({ date: s.date, altitude: s.altitude })).reverse()
        };
    }

    // Drag-based Orbit Decay Simulation (Proposal Requirement 2)
    const simulation = simulateDecay(latest.line1, latest.line2);
    
    const reentryDate = new Date(simulation.reentryDate);
    const now = new Date();
    const diffMs = reentryDate.getTime() - now.getTime();
    
    let timeToImpact = "N/A";
    if (diffMs > 0) {
        const days = Math.floor(diffMs / (1000 * 60 * 60 * 24));
        const hours = Math.floor((diffMs % (1000 * 60 * 60 * 24)) / (1000 * 60 * 60));
        const minutes = Math.floor((diffMs % (1000 * 60 * 60)) / (1000 * 60));
        
        if (days > 365) {
            const years = (days / 365).toFixed(1);
            timeToImpact = `~${years} years`;
        } else if (days > 0) {
            timeToImpact = `${days}d ${hours}h`;
        } else {
            timeToImpact = `${hours}h ${minutes}m`;
        }
    }

    const strategicRisks = checkStrategicRisks(simulation.impactCorridor);
    const indiaRisks = strategicRisks.filter(r => 
        ["Pokhran Test Range", "Sriharikota", "Andaman & Nicobar", "New Delhi"].includes(r.name)
    );

    const prediction = {
        satelliteName,
        noradId,
        status: isFlaggedForDecay ? "decaying" : "stable",
        currentAltitudeKm: currentAltitude,
        currentPerigeeKm: currentPerigee,
        estimatedReentryDate: simulation.reentryDate.toISOString(),
        timeToImpact,
        reentryWindow: simulation.reentryWindow, // e.g. "±6 hours"
        impactCorridor: simulation.impactCorridor, // Array of {lat, lon}
        riskLevel,
        confidence: isFlaggedForDecay ? (riskLevel === "HIGH" ? 0.9 : 0.75) : 0.55,
        strategicRisks,
        indiaSpecificRisk: indiaRisks.length > 0 ? `Threat detected over ${indiaRisks.map(r => r.name).join(", ")}` : "No immediate threat to Indian mainland detected.",
        message: simulation.message,
        history: samples.map(s => ({ date: s.date, altitude: s.altitude })).reverse()
    };

    // Priority Alerting (Proposal Requirement 3)
    if (prediction.strategicRisks.length > 0 || riskLevel === "HIGH") {
        await recordOperationalAlert({
            alertType: "reentry",
            title: "Re-entry Priority Alert",
            severity: prediction.strategicRisks.length > 0 ? "critical" : "warning",
            message: prediction.strategicRisks.length > 0
                ? `${satelliteName} re-entry corridor passes over ${prediction.strategicRisks.map(r => r.name).join(", ")}.`
                : `${satelliteName} re-entry corridor is clear of strategic installations.`,
            primaryId: satelliteName,
            primaryObjectName: satelliteName,
            primaryNoradId: noradId,
            occurredAt: new Date().toISOString(),
            details: prediction
        }, { transaction });
    }

    return prediction;
}

function calculateDecayAcceleration(samples) {
    if (samples.length < 4) return 0;
    const mid = Math.floor(samples.length / 2);
    const early = samples.slice(0, mid);
    const late = samples.slice(mid);
    
    const earlySlope = (early[early.length - 1].sma - early[0].sma) / (early[early.length - 1].time - early[0].time);
    const lateSlope = (late[late.length - 1].sma - late[0].sma) / (late[late.length - 1].time - late[0].time);
    
    return Math.abs(lateSlope) - Math.abs(earlySlope);
}

/**
 * Numerical integration for drag-based decay
 * Note: Simplified for performance in a web environment
 */
function simulateDecay(line1, line2) {
    const satrec = satellite.twoline2satrec(line1, line2);
    const epochDate = tleRevisionHistoryService.extractTleEpoch(line1);
    
    // Fallback if epoch extraction fails
    let currentTime = epochDate ? new Date(epochDate) : new Date();
    let currentPosVel = satellite.propagate(satrec, currentTime);
    
    const impactCorridor = [];
    let iterations = 0;
    const MAX_ITERATIONS = 5000;
    
    // Heuristic drag coefficient and area/mass ratio based on B* if available
    const bstar = satrec.bstar;
    
    // Faster step for long term, finer for re-entry
    let stepMinutes = 90; 
    
    while (iterations < MAX_ITERATIONS) {
        if (!currentPosVel || !currentPosVel.position) break;
        
        const gmst = satellite.gstime(currentTime);
        const geodetic = satellite.eciToGeodetic(currentPosVel.position, gmst);
        const altitude = geodetic.height;
        
        if (altitude < REENTRY_ALTITUDE_THRESHOLD_KM) break;
        
        // Record corridor in the last stages
        if (altitude < 200) {
            impactCorridor.push({
                lat: satellite.degreesLat(geodetic.latitude),
                lon: satellite.degreesLong(geodetic.longitude),
                alt: altitude
            });
            stepMinutes = 1; // Fine resolution for impact swath
        } else if (altitude < 300) {
            stepMinutes = 10;
        }

        currentTime = new Date(currentTime.getTime() + stepMinutes * 60 * 1000);
        currentPosVel = satellite.propagate(satrec, currentTime);
        
        iterations++;
    }

    return {
        reentryDate: currentTime,
        reentryWindow: "±6 hours",
        impactCorridor: impactCorridor.slice(-100), // Swath of last points
        message: iterations >= MAX_ITERATIONS ? "Stable orbit projected." : `Atmospheric re-entry predicted on ${currentTime.toDateString()}.`
    };
}

function checkStrategicRisks(impactCorridor) {
    const risks = [];
    for (const site of STRATEGIC_INSTALLATIONS) {
        for (const point of impactCorridor) {
            const dist = haversineKm(site.lat, site.lon, point.lat, point.lon);
            if (dist < 200) { // 200km threshold for "impact corridor" risk
                if (!risks.find(r => r.name === site.name)) {
                    risks.push({ name: site.name, distanceKm: dist });
                }
            }
        }
    }
    return risks;
}

const { SatelliteTleRevision } = require("../models/satelliteTleRevision");
const { Op } = require("sequelize");

/**
 * Scan all satellites for orbital decay and update predictions
 */
async function evaluateReentryRisks(options = {}) {
    const { transaction = null } = options;
    
    // Get all active payload NORAD IDs from the Satellite table.
    // Debris and Rocket Bodies must be strictly excluded from all analysis modules per requirements.
    const activePayloads = await Satellite.findAll({
        attributes: ["noradId"],
        transaction
    });
    const payloadNoradIds = activePayloads.map(s => s.noradId).filter(id => id !== null);

    if (payloadNoradIds.length === 0) {
        return [];
    }

    // Find ONLY active payload satellites with low perigee (< 300km) from the latest revisions
    const decayingCandidates = await SatelliteTleRevision.findAll({
        attributes: ["satelliteName", "noradId", "perigeeKm"],
        where: {
            noradId: { [Op.in]: payloadNoradIds },
            perigeeKm: { [Op.lt]: 300 },
            ingestedAt: {
                [Op.gte]: new Date(Date.now() - 24 * 60 * 60 * 1000) // Within last 24h
            }
        },
        group: ["satelliteName", "noradId", "perigeeKm"],
        transaction
    });

    console.log(`Evaluating re-entry risks for ${decayingCandidates.length} active payload candidates...`);

    const results = [];
    for (const candidate of decayingCandidates) {
        try {
            const prediction = await predictSatelliteReentry(candidate.noradId, candidate.satelliteName, { transaction });
            results.push(prediction);
        } catch (error) {
            console.error(`Failed to predict re-entry for ${candidate.satelliteName}:`, error);
        }
        // Yield control to allow HTTP requests and database queries to execute
        await new Promise(resolve => setImmediate(resolve));
    }

    return results;
}

module.exports = {
    predictSatelliteReentry,
    evaluateReentryRisks,
    checkStrategicRisks
};
