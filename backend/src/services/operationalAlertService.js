const crypto = require("node:crypto");
const { OperationalAlert } = require("../models/operationalAlert");
let correlationEngineService = null;

const {
    neighbourhoodWatchWarningKm: NEIGHBOURHOOD_WATCH_WARNING_KM,
    neighbourhoodWatchCriticalKm: NEIGHBOURHOOD_WATCH_CRITICAL_KM
} = require("../config/operationalConfig").operationalConfig;

const DEFAULT_ALERT_LIMIT = 20;
const MAX_ALERT_LIMIT = 100;

function normalizeLimit(limit, fallback = DEFAULT_ALERT_LIMIT) {
    if (limit === undefined || limit === null || limit === "") {
        return fallback;
    }

    const parsedLimit = Number.parseInt(limit, 10);
    if (!Number.isInteger(parsedLimit) || parsedLimit < 1) {
        return fallback;
    }

    return Math.min(parsedLimit, MAX_ALERT_LIMIT);
}

function classifySeverity(alertType, alert, thresholdKm) {
    const closestDistanceKm = alert.closestDistanceKm;
    const collisionProbability = alert.collisionProbability;

    // Pc > 1e-4 is an industry standard for CRITICAL alerts (Foster/Alfano)
    if (Number.isFinite(collisionProbability) && collisionProbability > 1e-4) {
        return "critical";
    }

    if (!Number.isFinite(closestDistanceKm)) {
        return "info";
    }

    if (alertType === "conjunction") {
        if (closestDistanceKm <= 10) {
            return "critical";
        }
        if (closestDistanceKm <= thresholdKm) {
            return "warning";
        }
        return "info";
    }

    if (closestDistanceKm <= NEIGHBOURHOOD_WATCH_CRITICAL_KM) {
        return "critical";
    }

    if (closestDistanceKm <= NEIGHBOURHOOD_WATCH_WARNING_KM) {
        return "warning";
    }

    return "info";
}

function toPositiveFiniteNumber(value) {
    if (value === undefined || value === null || value === "") {
        return null;
    }

    const parsed = Number(value);
    if (!Number.isFinite(parsed) || parsed <= 0) {
        return null;
    }

    return parsed;
}

function pickFirstText(...values) {
    for (const value of values) {
        if (value === undefined || value === null) {
            continue;
        }
        const text = String(value).trim();
        if (text) {
            return text;
        }
    }
    return null;
}

function buildObjectLabel(name, noradId, cosparId) {
    const cleanName = pickFirstText(name);
    if (cleanName) {
        return cleanName;
    }

    const parsedNorad = toPositiveFiniteNumber(noradId);
    if (parsedNorad !== null) {
        return `NORAD ID ${parsedNorad}`;
    }

    const cleanCospar = pickFirstText(cosparId);
    if (cleanCospar) {
        return `COSPAR ID ${cleanCospar}`;
    }

    return null;
}

function buildAlertDetails(alertType, alert, context, analysisTime) {
    const primaryObjectName = pickFirstText(
        alert.primaryObjectName,
        alert.primaryName,
        alert.satelliteName,
        alert.primaryId
    );
    const secondaryObjectName = pickFirstText(
        alert.secondaryObjectName,
        alert.secondaryName,
        alert.secondaryId
    );
    const primaryNoradId = toPositiveFiniteNumber(alert.primaryNoradId ?? alert.noradId ?? alert.primaryNorad);
    const secondaryNoradId = toPositiveFiniteNumber(alert.secondaryNoradId ?? alert.secondaryNorad);
    const primaryCosparId = pickFirstText(alert.primaryCosparId, alert.primaryCospar);
    const secondaryCosparId = pickFirstText(alert.secondaryCosparId, alert.secondaryCospar);

    const details = {
        analysisTime,
        area: context.area || null,
        sampleSeconds: context.sampleSeconds || null,
        altitudeRangeKm: context.altitudeRangeKm || null,
        primaryObjectName,
        secondaryObjectName,
        primaryNoradId,
        secondaryNoradId,
        primaryCosparId,
        secondaryCosparId,
        relativeVelocityKmS: alert.relativeVelocityKmS ?? null,
        collisionProbability: alert.collisionProbability ?? null,
        altitudeKm: alert.altitudeKm ?? null,
        classification: alert.classification || null,
        orbitalElementDelta: alert.orbitalElementDelta || alert.deltaOrbitalParameters || null,
        deltaOrbitalParameters: alert.deltaOrbitalParameters || alert.orbitalElementDelta || null,
        epochResidualKm: alert.epochResidualKm ?? null,
        proximityBeforeKm: alert.minDistanceBeforeKm ?? null,
        proximityAfterKm: alert.minDistanceAfterKm ?? null,
        previousTle: alert.previousTle || null,
        newTle: alert.newTle || null,
        tca: alert.tca || alert.time || null,
        missDistanceKm: alert.missDistanceKm ?? alert.closestDistanceKm ?? null,
        closestDistanceKm: alert.closestDistanceKm ?? null,
        observationWindow: alert.observationWindow || null,
        region: alert.region || null,
        regionHash: alert.regionHash || null,
        regionName: alert.regionName || null,
        startTime: alert.startTime || null,
        endTime: alert.endTime || null,
        durationMinutes: alert.durationMinutes ?? null,
        reentryWindow: alert.reentryWindow || null,
        impactCorridor: alert.impactCorridor || null,
        riskLevel: alert.riskLevel || null,
        confidence: alert.confidence ?? null,
        strategicRisks: alert.strategicRisks || null,
        indiaSpecificRisk: alert.indiaSpecificRisk || null,
        rawAlert: alert
    };

    if (alertType === "neighbourhood_watch") {
        details.observationWindow = alert.observationWindow || {
            start: alert.time || analysisTime,
            end: alert.time || analysisTime
        };
    }

    if (alertType === "blind_spot") {
        details.region = alert.region || context.area || null;
        details.regionHash = alert.regionHash || context.analysisKey || null;
        details.regionName = alert.regionName || (context.area && context.area.name) || null;
    }

    if (alertType === "manoeuvre") {
        details.satelliteName = alert.satelliteName || primaryObjectName || null;
        details.primaryObjectName = alert.satelliteName || primaryObjectName || null;
        details.confidence = alert.confidence ?? details.confidence;
    }

    if (alertType === "reentry") {
        details.satelliteName = alert.satelliteName || primaryObjectName || null;
        details.primaryObjectName = alert.satelliteName || primaryObjectName || null;
        details.primaryNoradId = primaryNoradId ?? null;
        details.predictedReentryDate = alert.estimatedReentryDate || alert.predictedReentryDate || null;
    }

    if (alertType === "conjunction") {
        details.primaryName = primaryObjectName;
        details.secondaryName = secondaryObjectName;
        details.primaryNoradId = primaryNoradId;
        details.secondaryNoradId = secondaryNoradId;
        details.tca = alert.tca || alert.time || analysisTime;
        details.missDistanceKm = alert.missDistanceKm ?? alert.closestDistanceKm ?? null;
    }

    return details;
}

function buildEventKey(alertType, alert, context) {
    const hash = crypto.createHash("sha256");
    hash.update([
        alertType,
        context.sourceType || "frontend_analysis",
        alert.primaryId || "",
        alert.secondaryId || "",
        alert.time || "",
        context.horizonMinutes ?? "",
        context.thresholdKm ?? "",
        context.analysisKey || "",
        alert.classification || ""
    ].join("|"));
    return hash.digest("hex");
}

function buildAlertTitle(alertType, alert) {
    if (alertType === "neighbourhood_watch") {
        return `Neighbourhood watch: ${buildObjectLabel(alert.primaryName || alert.primaryObjectName || alert.primaryId, alert.primaryNoradId, alert.primaryCosparId) || "Monitored Asset"} / ${buildObjectLabel(alert.secondaryName || alert.secondaryObjectName || alert.secondaryId, alert.secondaryNoradId, alert.secondaryCosparId) || "Nearby Object"}`;
    }

    if (alertType === "volumetric_scan") {
        return `Region scan: ${buildObjectLabel(alert.primaryName || alert.primaryObjectName || alert.primaryId, alert.primaryNoradId, alert.primaryCosparId) || "Region scan"}`;
    }

    if (alertType === "blind_spot") {
        return `Blind spot detected`;
    }

    if (alertType === "manoeuvre") {
        return `Manoeuvre: ${buildObjectLabel(alert.satelliteName || alert.primaryName || alert.primaryId, alert.primaryNoradId, alert.primaryCosparId) || "Satellite"} (${alert.classification || "unknown"})`;
    }

    if (alertType === "reentry") {
        return `Re-entry: ${buildObjectLabel(alert.primaryObjectName || alert.satelliteName || alert.primaryId, alert.primaryNoradId, alert.primaryCosparId) || "Satellite"}`;
    }

    return `Conjunction: ${buildObjectLabel(alert.primaryName || alert.primaryObjectName || alert.primaryId, alert.primaryNoradId, alert.primaryCosparId) || "Primary"} / ${buildObjectLabel(alert.secondaryName || alert.secondaryObjectName || alert.secondaryId, alert.secondaryNoradId, alert.secondaryCosparId) || "Secondary"}`;
}

function buildAlertMessage(alertType, alert, thresholdKm) {
    const distanceKm = Number.isFinite(alert.closestDistanceKm) ? alert.closestDistanceKm.toFixed(2) : "unknown";
    if (alertType === "neighbourhood_watch") {
        const relativeVelocityKmS = Number.isFinite(alert.relativeVelocityKmS)
            ? alert.relativeVelocityKmS.toFixed(3)
            : "unknown";
        return `Nearby object within ${distanceKm} km at ${alert.time}. Relative velocity ${relativeVelocityKmS} km/s. Threshold: ${thresholdKm} km.`;
    }

    if (alertType === "volumetric_scan") {
        const altitudeKm = Number.isFinite(alert.altitudeKm)
            ? alert.altitudeKm.toFixed(0)
            : "unknown";
        return `Satellite entered the traced region at ${alert.time}. Closest approach ${distanceKm} km. Altitude ${altitudeKm} km. Forecast threshold: ${thresholdKm} km.`;
    }

    if (alertType === "blind_spot") {
        return `No satellite coverage detected in the traced region starting at ${alert.time}. Visibility threshold: ${thresholdKm} deg.`;
    }

    if (alertType === "manoeuvre") {
        const residual = Number.isFinite(alert.epochResidualKm) ? `${alert.epochResidualKm.toFixed(1)} km` : "unknown";
        const proxBefore = Number.isFinite(alert.minDistanceBeforeKm) ? `${alert.minDistanceBeforeKm.toFixed(0)} km` : "unknown";
        const proxAfter = Number.isFinite(alert.minDistanceAfterKm) ? `${alert.minDistanceAfterKm.toFixed(0)} km` : "unknown";
        const indian = alert.secondaryId ? ` Closest Indian asset ${alert.secondaryId}.` : "";
        return `Classification ${alert.classification}. Epoch position residual ${residual}.${indian} Proximity window min range before ${proxBefore}, after ${proxAfter}.`;
    }

    if (alertType === "conjunction") {
        const pc = alert.collisionProbability;
        const pcStr = Number.isFinite(pc)
            ? ` Probability of Collision (Pc): ${pc < 1e-7 ? "< 1e-7" : pc.toExponential(2)}.`
            : "";
        return `Closest distance ${distanceKm} km at ${alert.time}.${pcStr} Threshold: ${thresholdKm} km.`;
    }

    return `Closest sampled distance ${distanceKm} km at ${alert.time}. Threshold: ${thresholdKm} km.`;
}

async function persistAlertBatch(alertType, alerts, context = {}) {
    if (!Array.isArray(alerts) || !alerts.length) {
        return {
            persistedCount: 0,
            alerts: []
        };
    }

    const thresholdKm = Number.isFinite(context.thresholdKm) ? context.thresholdKm : null;
    const horizonMinutes = Number.isFinite(context.horizonMinutes) ? context.horizonMinutes : null;
    const sourceName = context.sourceName || "Frontend Region Analysis";
    const sourceType = context.sourceType || (alertType === "neighbourhood_watch" ? "frontend_neighbourhood_watch" : "frontend_analysis");

    const analysisTime = context.analysisTime || new Date().toISOString();

    const payloads = alerts.map(alert => {
        const details = buildAlertDetails(alertType, alert, context, analysisTime);
        const primaryDisplay = buildObjectLabel(
            details.primaryObjectName,
            details.primaryNoradId,
            details.primaryCosparId
        ) || buildObjectLabel(alert.primaryId, alert.primaryNoradId, alert.primaryCosparId);
        const secondaryDisplay = buildObjectLabel(
            details.secondaryObjectName,
            details.secondaryNoradId,
            details.secondaryCosparId
        ) || buildObjectLabel(alert.secondaryId, alert.secondaryNoradId, alert.secondaryCosparId);

        return {
        eventKey: buildEventKey(alertType, alert, {
            sourceType,
            horizonMinutes,
            thresholdKm,
            analysisKey: alert.analysisKey || context.analysisKey || ""
        }),
        alertType,
        severity: alert.severity || classifySeverity(alertType, alert, thresholdKm || 0),
        title: alert.title || buildAlertTitle(alertType, alert),
        message: alert.message || buildAlertMessage(alertType, alert, thresholdKm || 0),
        primaryId: primaryDisplay || alert.primaryId,
        secondaryId: secondaryDisplay || alert.secondaryId,
        closestDistanceKm: alert.closestDistanceKm,
        thresholdKm,
        horizonMinutes,
        occurredAt: alert.time ? new Date(alert.time) : new Date(analysisTime),
        sourceName,
        sourceType,
        details
        };
    });

    // Process in parallel batches to prevent connection pool exhaustion and timeouts
    const CHUNK_SIZE = 25;
    for (let i = 0; i < payloads.length; i += CHUNK_SIZE) {
        const chunk = payloads.slice(i, i + CHUNK_SIZE);
        await Promise.all(chunk.map(p => OperationalAlert.upsert(p, context.sequelizeOptions || {})));
    }

    if (!correlationEngineService) {
        correlationEngineService = require("./correlationEngineService");
    }

    try {
        await correlationEngineService.ingestOperationalAlerts(payloads, {
            ...context,
            alertType
        });
    } catch (error) {
        console.warn("Correlation engine ingestion failed:", error);
    }

    return {
        persistedCount: payloads.length,
        alerts: payloads
    };
}

async function recordConjunctionAnalysis(result, context = {}) {
    if (!result || !Array.isArray(result.conjunctions) || !result.conjunctions.length) {
        return {
            persistedCount: 0,
            alerts: []
        };
    }

    const thresholdKm = Number.isFinite(result.conjunctionThresholdKm) ? result.conjunctionThresholdKm : context.thresholdKm;
    const horizonMinutes = Number.isFinite(result.horizonMinutes) ? result.horizonMinutes : context.horizonMinutes;

    return persistAlertBatch("conjunction", result.conjunctions, {
        ...context,
        thresholdKm,
        horizonMinutes,
        area: result.area || null,
        sampleSeconds: result.conjunctionSampleSeconds || null
    });
}

async function recordNeighbourhoodWatchAnalysis(result, context = {}) {
    if (!result || !Array.isArray(result.alerts) || !result.alerts.length) {
        return {
            persistedCount: 0,
            alerts: []
        };
    }

    const thresholdKm = Number.isFinite(result.thresholdKm) ? result.thresholdKm : context.thresholdKm;
    const horizonMinutes = Number.isFinite(result.horizonMinutes) ? result.horizonMinutes : context.horizonMinutes;

    return persistAlertBatch("neighbourhood_watch", result.alerts, {
        ...context,
        thresholdKm,
        horizonMinutes,
        area: result.area || null,
        sampleSeconds: result.sampleSeconds || null
    });
}

async function recordRegionScanAnalysis(result, context = {}) {
    if (!result || !Array.isArray(result.alerts) || !result.alerts.length) {
        return {
            persistedCount: 0,
            alerts: []
        };
    }

    const thresholdKm = Number.isFinite(result.proximityThresholdKm) ? result.proximityThresholdKm : context.thresholdKm;
    const horizonMinutes = Number.isFinite(result.forecastWindowMinutes) ? result.forecastWindowMinutes : context.horizonMinutes;

    return persistAlertBatch("volumetric_scan", result.alerts, {
        ...context,
        thresholdKm,
        horizonMinutes,
        area: result.region || null,
        sampleSeconds: result.sampleSeconds || null,
        analysisKey: result.regionHash || context.analysisKey || "",
        altitudeRangeKm: {
            min: result.minAltitudeKm ?? null,
            max: result.maxAltitudeKm ?? null
        }
    });
}

async function recordBlindSpotAnalysis(result, context = {}) {
    if (!result || !Array.isArray(result.alerts) || !result.alerts.length) {
        return {
            persistedCount: 0,
            alerts: []
        };
    }

    const thresholdKm = Number.isFinite(result.visibilityThresholdDeg) ? result.visibilityThresholdDeg : context.thresholdKm;
    const horizonMinutes = Number.isFinite(result.forecastWindowMinutes) ? result.horizonMinutes : context.horizonMinutes;

    return persistAlertBatch("blind_spot", result.alerts, {
        ...context,
        thresholdKm,
        horizonMinutes,
        area: result.region || null,
        sampleSeconds: result.sampleSeconds || null,
        analysisKey: result.regionHash || context.analysisKey || "",
        altitudeRangeKm: {
            min: result.minAltitudeKm ?? null,
            max: result.maxAltitudeKm ?? null
        }
    });
}

function mapManoeuvreFindingToAlert(finding) {
    return {
        primaryId: finding.satelliteName || finding.satelliteId,
        primaryName: finding.satelliteName || finding.satelliteId,
        primaryNoradId: finding.noradId || null,
        secondaryId: finding.nearestIndianId || null,
        secondaryName: finding.nearestIndianId || null,
        secondaryNoradId: finding.proximity?.nearestIndianNoradId || finding.nearestIndianNoradId || null,
        closestDistanceKm: finding.minDistanceAfterKm,
        time: finding.occurredAt,
        severity: finding.severity,
        classification: finding.classification,
        epochResidualKm: finding.epochResidualKm,
        orbitalElementDelta: finding.orbitalElementDelta,
        deltaOrbitalParameters: finding.orbitalElementDelta,
        confidence: finding.confidence ?? null,
        minDistanceBeforeKm: finding.minDistanceBeforeKm,
        minDistanceAfterKm: finding.minDistanceAfterKm,
        analysisKey: finding.analysisKey,
        previousTle: {
            line1: finding.previous.line1,
            line2: finding.previous.line2
        },
        newTle: {
            line1: finding.incoming.line1,
            line2: finding.incoming.line2
        }
    };
}

async function recordManoeuvreDetections(findings, context = {}) {
    if (!Array.isArray(findings) || !findings.length) {
        return {
            persistedCount: 0,
            alerts: []
        };
    }

    const alerts = findings.map(mapManoeuvreFindingToAlert);

    return persistAlertBatch("manoeuvre", alerts, {
        ...context,
        thresholdKm: context.thresholdKm ?? null,
        horizonMinutes: context.horizonMinutes ?? null,
        sourceName: context.sourceName || "Backend Manoeuvre Detection",
        sourceType: context.sourceType || "backend_manoeuvre_detection"
    });
}

async function listOperationalAlerts(limit = DEFAULT_ALERT_LIMIT) {
    const normalizedOptions = typeof limit === "object" && limit !== null
        ? limit
        : { limit };

    const alertLimit = normalizeLimit(normalizedOptions.limit);
    const where = {
        trainingSessionId: null // Only show real alerts in the main feed
    };

    if (normalizedOptions.alertType) {
        where.alertType = normalizedOptions.alertType;
    }

    const alerts = await OperationalAlert.findAll({
        where,
        order: [["occurredAt", "DESC"], ["createdAt", "DESC"]],
        limit: alertLimit
    });

    return alerts.map((alert) => alert.get({ plain: true }));
}

async function recordOperationalAlert(alert, context = {}) {
    const alertWithTime = {
        ...alert,
        time: alert.time || alert.occurredAt
    };
    return persistAlertBatch(alert.alertType || "generic", [alertWithTime], {
        ...context,
        sourceName: alert.sourceName || context.sourceName || "System Service",
        sourceType: alert.sourceType || context.sourceType || "backend_service"
    });
}

module.exports = {
    listOperationalAlerts,
    recordOperationalAlert,
    recordConjunctionAnalysis,
    recordNeighbourhoodWatchAnalysis,
    recordRegionScanAnalysis,
    recordBlindSpotAnalysis,
    recordManoeuvreDetections
};
