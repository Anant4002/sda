const crypto = require("node:crypto");
const { sequelize } = require("../db");
const {
    createPropagationRecord,
    createPropagationRecords,
    distanceBetweenEci,
    parseTleLine2OrbitalMetrics,
    propagateState,
    getOrbitMinutes,
    getOrbitSampleSeconds
} = require("./orbitalPropagationService");
const { isIndianSatelliteName } = require("./satelliteOwnershipService");
const tleRevisionHistoryService = require("./tleRevisionHistoryService");

const ANALYSIS_STEP_SECONDS = 120;

const DEFAULT_THRESHOLDS = {
    routineMaxInclinationDeltaDeg: 0.005,
    routineMaxMeanMotionDeltaRevPerDay: 0.005,
    routineMaxEccentricityDelta: 0.0001,
    routineMaxEpochResidualKm: 5,
    significantMinInclinationDeltaDeg: 0.02,
    significantMinMeanMotionDeltaRevPerDay: 0.01,
    significantMinEccentricityDelta: 0.0002,
    significantMinEpochResidualKm: 15,
    proximityHorizonMinutes: 180,
    proximityCloserByKm: 50,
    proximityAbsoluteNearKm: 250
};

function normalizeThresholds(overrides = {}) {
    return { ...DEFAULT_THRESHOLDS, ...overrides };
}

function satelliteKey(row) {
    if (Number.isFinite(row.noradId) && row.noradId > 0) {
        return `id:${row.noradId}`;
    }
    return `name:${String(row.name || "").trim().toUpperCase()}`;
}

function buildPreviousMap(rows) {
    const map = new Map();
    for (const row of rows) {
        map.set(satelliteKey(row), row);
    }
    return map;
}

function tleChecksum(line1, line2) {
    const hash = crypto.createHash("sha256");
    hash.update(`${line1}|${line2}`);
    return hash.digest("hex");
}

function minSeparationOverHorizon(subjectRecord, otherRecord, startDate, horizonMinutes) {
    let minimumDistanceKm = Infinity;
    const startMs = startDate.getTime();
    const horizonSeconds = Math.max(60, horizonMinutes * 60);

    for (let offsetSeconds = 0; offsetSeconds <= horizonSeconds; offsetSeconds += ANALYSIS_STEP_SECONDS) {
        const sampleDate = new Date(startMs + offsetSeconds * 1000);
        const primaryState = propagateState(subjectRecord, sampleDate, null);
        const secondaryState = propagateState(otherRecord, sampleDate, null);
        if (!primaryState || !secondaryState) {
            continue;
        }
        const distanceKm = distanceBetweenEci(primaryState.eci, secondaryState.eci);
        if (distanceKm < minimumDistanceKm) {
            minimumDistanceKm = distanceKm;
        }
    }

    return Number.isFinite(minimumDistanceKm) ? minimumDistanceKm : Infinity;
}

function evaluatePair({ previous, incoming, referenceDate, thresholds }) {
    if (!previous || !incoming) {
        return null;
    }

    if (previous.line1 === incoming.line1 && previous.line2 === incoming.line2) {
        return null;
    }

    const metricsPrev = parseTleLine2OrbitalMetrics(previous.line2);
    const metricsNew = parseTleLine2OrbitalMetrics(incoming.line2);
    if (!metricsPrev || !metricsNew) {
        return null;
    }

    const deltaInc = Math.abs(metricsNew.inclinationDeg - metricsPrev.inclinationDeg);
    const deltaEcc = Math.abs(metricsNew.eccentricity - metricsPrev.eccentricity);
    const deltaMm = Math.abs(metricsNew.meanMotionRevPerDay - metricsPrev.meanMotionRevPerDay);
    const deltaRaan = Math.abs(metricsNew.raanDeg - metricsPrev.raanDeg);
    const deltaSma = Math.abs((metricsNew.semiMajorAxisKm || 0) - (metricsPrev.semiMajorAxisKm || 0));

    const recordPrev = createPropagationRecord({
        name: incoming.name,
        line1: previous.line1,
        line2: previous.line2,
        noradId: incoming.noradId,
        isIndian: Boolean(incoming.isIndian)
    });
    const recordNew = createPropagationRecord({
        name: incoming.name,
        line1: incoming.line1,
        line2: incoming.line2,
        noradId: incoming.noradId,
        isIndian: Boolean(incoming.isIndian)
    });

    if (!recordPrev || !recordNew) {
        return null;
    }

    const statePrev = propagateState(recordPrev, referenceDate, null);
    const stateNew = propagateState(recordNew, referenceDate, null);
    if (!statePrev || !stateNew) {
        return null;
    }

    const epochResidualKm = distanceBetweenEci(statePrev.eci, stateNew.eci);

    const routineCandidate =
        deltaInc <= thresholds.routineMaxInclinationDeltaDeg &&
        deltaEcc <= thresholds.routineMaxEccentricityDelta &&
        deltaMm <= thresholds.routineMaxMeanMotionDeltaRevPerDay &&
        epochResidualKm <= thresholds.routineMaxEpochResidualKm;

    const significant =
        deltaInc >= thresholds.significantMinInclinationDeltaDeg ||
        deltaEcc >= thresholds.significantMinEccentricityDelta ||
        deltaMm >= thresholds.significantMinMeanMotionDeltaRevPerDay ||
        epochResidualKm >= thresholds.significantMinEpochResidualKm;

    return {
        satelliteId: incoming.name,
        satelliteName: incoming.name,
        noradId: incoming.noradId,
        previous,
        incoming,
        metricsPrev,
        metricsNew,
        orbitalElementDelta: {
            inclinationDeg: deltaInc,
            eccentricity: deltaEcc,
            meanMotionRevPerDay: deltaMm,
            raanDeg: deltaRaan,
            semiMajorAxisKm: deltaSma
        },
        deltaOrbitalParameters: {
            inclinationDeg: deltaInc,
            eccentricity: deltaEcc,
            meanMotionRevPerDay: deltaMm,
            raanDeg: deltaRaan,
            semiMajorAxisKm: deltaSma
        },
        epochResidualKm,
        routineCandidate,
        significant,
        confidence: significant ? 0.75 : 0.55
    };
}

/**
 * Lightweight helper to yield control back to the event loop.
 */
function yieldToEventLoop() {
    return new Promise(resolve => setImmediate(resolve));
}

async function finalizeProximityDraft(draft, incomingCatalog, referenceDate, thresholds) {
    if (!draft) {
        return null;
    }

    const recordNew = createPropagationRecord({
        name: draft.incoming.name,
        line1: draft.incoming.line1,
        line2: draft.incoming.line2,
        noradId: draft.incoming.noradId,
        isIndian: Boolean(draft.incoming.isIndian)
    });
    const recordOld = createPropagationRecord({
        name: draft.previous.name,
        line1: draft.previous.line1,
        line2: draft.previous.line2,
        noradId: draft.incoming.noradId,
        isIndian: Boolean(draft.incoming.isIndian)
    });

    if (!recordNew || !recordOld) {
        return null;
    }

    let bestIndianId = null;
    let bestIndianNoradId = null;
    let bestMinNew = Infinity;
    let bestMinOld = Infinity;

    for (const candidate of incomingCatalog) {
        if (!candidate || candidate.name === draft.incoming.name) {
            continue;
        }
        if (!isIndianSatelliteName(candidate.name)) {
            continue;
        }

        const indianRecord = createPropagationRecords([candidate])[0];
        if (!indianRecord) {
            continue;
        }

        const minOld = minSeparationOverHorizon(recordOld, indianRecord, referenceDate, thresholds.proximityHorizonMinutes);
        const minNew = minSeparationOverHorizon(recordNew, indianRecord, referenceDate, thresholds.proximityHorizonMinutes);

        if (minNew < bestMinNew) {
            bestMinNew = minNew;
            bestMinOld = minOld;
            bestIndianId = candidate.name;
            bestIndianNoradId = candidate.noradId || null;
        }
    }

    const minDistanceAfterKm = Number.isFinite(bestMinNew) ? bestMinNew : null;
    const minDistanceBeforeKm = Number.isFinite(bestMinOld) ? bestMinOld : null;

    const closerApproach = minDistanceAfterKm !== null && minDistanceBeforeKm !== null
        && minDistanceAfterKm < minDistanceBeforeKm - thresholds.proximityCloserByKm;
    const absoluteNear = minDistanceAfterKm !== null && minDistanceAfterKm < thresholds.proximityAbsoluteNearKm;
    const proximityThreat = draft.significant && (closerApproach || absoluteNear);

    return {
        ...draft,
        proximityThreat,
        minDistanceBeforeKm,
        minDistanceAfterKm,
        nearestIndianId: bestIndianId,
        nearestIndianNoradId: bestIndianNoradId
    };
}

function generateAssessment(finding, thresholds) {
    const deltas = finding.orbitalElementDelta;
    const { inclinationDeg, semiMajorAxisKm, meanMotionRevPerDay } = deltas;

    if (finding.proximityThreat) {
        return `Critical proximity threat: Abrupt manoeuvre bringing satellite within ${finding.minDistanceAfterKm?.toFixed(1)}km of an Indian asset.`;
    }

    if (inclinationDeg >= thresholds.significantMinInclinationDeltaDeg * 2) {
        return `Significant plane-change manoeuvre detected (Inclination shift: ${inclinationDeg.toFixed(3)}°).`;
    }

    if (Math.abs(semiMajorAxisKm) >= 10) {
        return `Major orbital repositioning detected (Altitude delta: ${Math.abs(semiMajorAxisKm).toFixed(1)}km).`;
    }

    if (inclinationDeg >= thresholds.significantMinInclinationDeltaDeg) {
        return `Possible station-keeping manoeuvre (Inclination shift: ${inclinationDeg.toFixed(3)}°).`;
    }

    if (Math.abs(semiMajorAxisKm) >= 2) {
        return `Orbital maintenance / station-keeping (Altitude delta: ${Math.abs(semiMajorAxisKm).toFixed(1)}km).`;
    }

    if (Math.abs(meanMotionRevPerDay) >= thresholds.significantMinMeanMotionDeltaRevPerDay) {
        return `Abnormal mean motion drift detected (${Math.abs(meanMotionRevPerDay).toFixed(4)} rev/day).`;
    }

    return "Routine orbital drift.";
}

function classifyFinding(finding) {
    if (finding.proximityThreat) {
        return "proximity_approach";
    }
    if (finding.significant) {
        return "significant_manoeuvre";
    }
    return "routine";
}

function severityForClassification(classification) {
    switch (classification) {
        case "proximity_approach": return "danger";
        case "significant_manoeuvre": return "warning";
        case "routine": return "success";
        default: return "info";
    }
}

/**
 * Analyze the entire TLE revision history for a single satellite to identify all historical manoeuvres.
 * This is the "Forensics" engine for Phase 2.
 */
async function analyzeSatelliteManoeuvreHistory(noradId, satelliteName, options = {}) {
    const { thresholds: thresholdOverrides = {}, limit = 500 } = options;
    const thresholds = normalizeThresholds(thresholdOverrides);

    // Fetch history (sorted by ingestedAt DESC by default in the service)
    const history = await tleRevisionHistoryService.getRevisionHistory(noradId, satelliteName, { limit });

    if (history.length < 2) {
        return {
            satelliteName,
            noradId,
            evaluatedRevisions: history.length,
            manoeuvres: []
        };
    }

    // Sort ascending for chronological analysis
    const chronological = [...history].sort((a, b) => new Date(a.tleEpoch || a.ingestedAt) - new Date(b.tleEpoch || b.ingestedAt));

    const manoeuvres = [];

    for (let i = 0; i < chronological.length - 1; i++) {
        const previous = chronological[i];
        const incoming = chronological[i + 1];

        // Use the same evaluation logic as catalog sync
        const draft = evaluatePair({
            previous,
            incoming,
            referenceDate: new Date(incoming.tleEpoch || incoming.ingestedAt),
            thresholds
        });

        if (draft && (draft.significant || draft.routineCandidate)) {
            // No proximity catalog available during history forensics POC
            const finalized = await finalizeProximityDraft(draft, [], new Date(incoming.tleEpoch || incoming.ingestedAt), thresholds);
            if (finalized) {
                const classification = classifyFinding(finalized);
                manoeuvres.push({
                    ...finalized,
                    classification,
                    severity: severityForClassification(classification),
                    assessment: generateAssessment(finalized, thresholds),
                    occurredAt: new Date(incoming.tleEpoch || incoming.ingestedAt).toISOString(),
                    analysisKey: `${previous.tleChecksum}|${incoming.tleChecksum}`
                });
            }
        }

        if (i % 200 === 0) {
            await yieldToEventLoop();
        }
    }

    return {
        satelliteName,
        noradId,
        evaluatedRevisions: history.length,
        manoeuvres: manoeuvres.reverse() // Most recent first
    };
}

async function evaluateCatalogManoeuvres({ previousSatellites = [], incomingSatellites = [], referenceDate = new Date(), thresholds: thresholdOverrides = {} } = {}) {
    const thresholds = normalizeThresholds(thresholdOverrides);
    const previousMap = buildPreviousMap(previousSatellites);
    const findings = [];

    let processedCount = 0;
    for (const incoming of incomingSatellites) {
        processedCount++;
        if (processedCount % 500 === 0) {
            await yieldToEventLoop();
        }

        const previous = previousMap.get(satelliteKey(incoming));
        if (!previous) {
            continue;
        }

        const draft = evaluatePair({ previous, incoming, referenceDate, thresholds });
        if (!draft) {
            continue;
        }

        // Optimization: Only run expensive proximity analysis for "significant" manoeuvres.
        // Routine TLE updates (drift) don't need millions of propagation steps against Indian assets.
        let finalized;
        if (draft.significant) {
            finalized = await finalizeProximityDraft(draft, incomingSatellites, referenceDate, thresholds);
        } else {
            finalized = {
                ...draft,
                proximityThreat: false,
                minDistanceBeforeKm: null,
                minDistanceAfterKm: null,
                nearestIndianId: null
            };
        }

        if (!finalized) {
            continue;
        }

        const classification = classifyFinding(finalized);
        findings.push({
            ...finalized,
            classification,
            severity: severityForClassification(classification),
            assessment: generateAssessment(finalized, thresholds),
            occurredAt: referenceDate.toISOString(),
            analysisKey: `${tleChecksum(previous.line1, previous.line2)}|${tleChecksum(incoming.line1, incoming.line2)}`
        });
    }

    const persistedFindings = findings.filter((finding) => finding.classification !== "routine");
    const routineCount = findings.length - persistedFindings.length;

    return {
        referenceTime: referenceDate.toISOString(),
        evaluatedPairs: findings.length,
        routineSuppressed: routineCount,
        findings: persistedFindings,
        thresholds
    };
}


async function detectManoeuvresFromLatestRevisions(options = {}) {
    const { thresholds: thresholdOverrides = {} } = options;
    const thresholds = normalizeThresholds(thresholdOverrides);

    // Efficiently get the latest 2 revisions for every satellite name using a window function
    // We use raw SQL because Sequelize doesn't have a clean way to do PARTITION BY / ROW_NUMBER
    const [revisions] = await sequelize.query(`
        WITH RankedRevisions AS (
            SELECT *,
                   ROW_NUMBER() OVER (PARTITION BY satellite_name ORDER BY ingested_at DESC) as rank
            FROM satellite_tle_revisions
        )
        SELECT * FROM RankedRevisions WHERE rank <= 2
        ORDER BY satellite_name, rank ASC
    `);

    const findings = [];
    const processedMap = new Map();

    // Group into pairs
    for (const rev of revisions) {
        if (!processedMap.has(rev.satellite_name)) {
            processedMap.set(rev.satellite_name, []);
        }
        processedMap.get(rev.satellite_name).push(rev);
    }

    let evaluatedPairs = 0;
    for (const [name, pairs] of processedMap.entries()) {
        if (pairs.length < 2) continue;

        // pairs[0] is oldest (rank 2), pairs[1] is newest (rank 1)
        const previous = pairs[0];
        const incoming = pairs[1];
        evaluatedPairs++;

        if (evaluatedPairs % 500 === 0) {
            await yieldToEventLoop();
        }

        // Remap DB fields to match what evaluatePair expects
        const mappedPrev = {
            ...previous,
            name: previous.satellite_name,
            noradId: previous.norad_id,
            line1: previous.line1,
            line2: previous.line2
        };
        const mappedInc = {
            ...incoming,
            name: incoming.satellite_name,
            noradId: incoming.norad_id,
            line1: incoming.line1,
            line2: incoming.line2,
            isIndian: incoming.is_indian
        };

        const draft = evaluatePair({
            previous: mappedPrev,
            incoming: mappedInc,
            referenceDate: new Date(incoming.ingested_at),
            thresholds
        });

        if (draft && (draft.significant || draft.routineCandidate)) {
            // No proximity catalog available during global audit
            const finalized = await finalizeProximityDraft(draft, [], new Date(incoming.ingested_at), thresholds);
            if (finalized) {
                const classification = classifyFinding(finalized);
                findings.push({
                    ...finalized,
                    classification,
                    severity: severityForClassification(classification),
                    assessment: generateAssessment(finalized, thresholds),
                    occurredAt: new Date(incoming.ingested_at).toISOString(),
                    analysisKey: `${previous.tle_checksum}|${incoming.tle_checksum}`
                });
            }
        }
    }

    const persistedFindings = findings.filter((f) => f.classification !== "routine");

    return {
        referenceTime: new Date().toISOString(),
        evaluatedPairs,
        routineSuppressed: findings.length - persistedFindings.length,
        findings: persistedFindings,
        thresholds
    };
}

/**
 * Implements Requirement 5.3.2.6: Target Manoeuvre Detection.
 * Compares the latest TLE with the previous one, calculates deltas, classifies, and assesses threat.
 */
async function analyzeTargetManoeuvre(noradId, satelliteName, options = {}) {
    const { thresholds: thresholdOverrides = {} } = options;
    const thresholds = normalizeThresholds(thresholdOverrides);

    // 1. Fetch latest 2 TLEs
    const history = await tleRevisionHistoryService.getRevisionHistory(noradId, satelliteName, { limit: 2 });
    if (history.length < 2) {
        return {
            status: "insufficient_data",
            message: "At least two historical TLEs are required for manoeuvre detection."
        };
    }

    // history[0] is newest, history[1] is previous
    const incoming = history[0];
    const previous = history[1];

    // 2. Perform comparison analysis
    const draft = evaluatePair({
        previous: {
            ...previous,
            name: previous.satelliteName,
            noradId: previous.noradId
        },
        incoming: {
            ...incoming,
            name: incoming.satelliteName,
            noradId: incoming.noradId,
            isIndian: isIndianSatelliteName(incoming.satelliteName)
        },
        referenceDate: new Date(incoming.tleEpoch || incoming.ingestedAt),
        thresholds
    });

    if (!draft) {
        return {
            status: "no_change",
            message: "No significant orbital change detected between revisions."
        };
    }

    // 3. Proximity check against Indian Assets
    const { Satellite } = require("../models/satellite");
    const allSats = await Satellite.findAll({
        // Why: some deployments still run the pre-2026-05-15 satellite schema, so keep this proximity lookup on legacy-safe columns.
        attributes: ["name", "line1", "line2", "noradId"]
    });
    const incomingCatalog = allSats.map(s => ({
        name: s.name,
        line1: s.line1,
        line2: s.line2,
        noradId: s.noradId
    }));

    const finalized = await finalizeProximityDraft(draft, incomingCatalog, new Date(incoming.tleEpoch || incoming.ingestedAt), thresholds);

    if (!finalized) {
        return {
            status: "error",
            message: "Failed to finalize manoeuvre analysis."
        };
    }

    // 4. Classification & Threat Assessment
    const classification = classifyFinding(finalized);
    const severity = severityForClassification(classification);
    const threatScore = classification === "proximity_approach" ? 95 : (classification === "significant_manoeuvre" ? 45 : 10);

    // 5. Orbit Visualization Samples
    const oldRecord = createPropagationRecord({ ...previous, name: previous.satelliteName });
    const newRecord = createPropagationRecord({ ...incoming, name: incoming.satelliteName });

    if (!oldRecord || !newRecord) {
        return {
            status: "error",
            message: "Unable to create propagation records for visualization."
        };
    }

    const oldOrbitSamples = [];
    const newOrbitSamples = [];

    const orbitMinutes = getOrbitMinutes(newRecord);
    const sampleStepSeconds = getOrbitSampleSeconds(newRecord);
    const visualRefDate = new Date(incoming.tleEpoch || incoming.ingestedAt);

    // Propagate for slightly more than one full orbit so the ring closes without drawing a second lap.
    for (let offset = 0; offset <= orbitMinutes * 1.08 * 60; offset += sampleStepSeconds) {
        const time = new Date(visualRefDate.getTime() + offset * 1000);
        const sOld = propagateState(oldRecord, time);
        const sNew = propagateState(newRecord, time);

        if (sOld) {
            oldOrbitSamples.push({
                x: sOld.eci.x * 1000,
                y: sOld.eci.y * 1000,
                z: sOld.eci.z * 1000,
                time: time.toISOString()
            });
        }
        if (sNew) {
            newOrbitSamples.push({
                x: sNew.eci.x * 1000,
                y: sNew.eci.y * 1000,
                z: sNew.eci.z * 1000,
                time: time.toISOString()
            });
        }
    }

    return {
        status: "success",
        satelliteId: satelliteName,
        noradId,
        classification,
        severity,
        threatScore,
        confidence: Math.max(0.1, Math.min(1, threatScore / 100)),
        assessment: generateAssessment(finalized, thresholds),
        occurredAt: incoming.tleEpoch || incoming.ingestedAt,
        deltas: finalized.orbitalElementDelta,
        epochResidualKm: finalized.epochResidualKm,
        proximity: {
            nearestIndianId: finalized.nearestIndianId,
            nearestIndianNoradId: finalized.nearestIndianNoradId || null,
            minDistanceBeforeKm: finalized.minDistanceBeforeKm,
            minDistanceAfterKm: finalized.minDistanceAfterKm
        },
        visualization: {
            oldOrbit: { id: `${satelliteName} (PREV)`, samples: oldOrbitSamples, color: "#99b7c8", style: "dotted", renderFrame: "inertial" },
            newOrbit: { id: `${satelliteName} (NEW)`, samples: newOrbitSamples, color: severity === "danger" ? "#ff7b7b" : (severity === "warning" ? "#ff9933" : "#6fe2ff"), style: "solid", renderFrame: "inertial" }
        }
    };
}

module.exports = {
    evaluateCatalogManoeuvres,
    analyzeSatelliteManoeuvreHistory,
    detectManoeuvresFromLatestRevisions,
    analyzeTargetManoeuvre,
    normalizeThresholds,
    DEFAULT_THRESHOLDS
};
