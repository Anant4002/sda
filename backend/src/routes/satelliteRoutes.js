const express = require("express");
const {
    batchCharacteriseSatellites,
    getCatalogStatus,
    listCatalogEvents,
    listCatalogHistory,
    listSatellites,
    updateSatelliteIntData,
    ingestTrackObservation
} = require("../services/satelliteCatalogService");
const {
    listOperationalAlerts,
    recordConjunctionAnalysis,
    recordNeighbourhoodWatchAnalysis,
    recordRegionScanAnalysis,
    recordBlindSpotAnalysis,
    recordManoeuvreDetections
} = require("../services/operationalAlertService");
const {
    runBackendConjunctionAnalysis,
    runBackendNeighbourhoodWatch,
    runBackendRegionScan,
    runBackendBlindSpot,
    runBackendRegionalPresence
} = require("../services/operationalAnalysisService");
const { syncSatellites, fetchSatelliteCatalog } = require("../services/satelliteSyncService");
const { Satellite } = require("../models/satellite");
const { serializeSatellite, isIndianSatelliteName } = require("../services/satelliteMetadataService");
const { 
    evaluateCatalogManoeuvres, 
    analyzeSatelliteManoeuvreHistory,
    detectManoeuvresFromLatestRevisions,
    analyzeTargetManoeuvre
} = require("../services/manoeuvreDetectionService");
const { predictSatelliteReentry } = require("../services/reentryPredictionService");
const rapidProcessingService = require("../services/rapidProcessingService");
const orbitalDriftService = require("../services/orbitalDriftService");
const { getRevisionHistory: getTleHistory } = require("../services/tleRevisionHistoryService");
const { getSensorRegistry } = require("../services/sensorAdapterService");
const {
    requireApiKey,
    requireSyncAccess,
    validateSatelliteQuery
} = require("../middleware/requestGuards");

const router = express.Router();
const MAX_REGION_ANALYSIS_HORIZON_MINUTES = 4320;


function normalizeAnalysisHorizonMinutes(value, fallbackMinutes = 60) {
    const parsed = Number(value);
    if (!Number.isFinite(parsed) || parsed <= 0) {
        return fallbackMinutes;
    }

    return Math.min(Math.round(parsed), MAX_REGION_ANALYSIS_HORIZON_MINUTES);
}

function persistAnalysisInBackground(taskName, persistFn, result, context) {
    setImmediate(() => {
        Promise.resolve(persistFn(result, context)).catch((error) => {
            console.error(`${taskName} persistence failed:`, error);
        });
    });
}

function respondAnalysisFailure(res, error, fallbackMessage) {
    if (error && (error.code === "ANALYSIS_TIMEOUT" || error.statusCode === 504)) {
        return res.status(504).json({
            error: "Analysis timed out",
            message: "The analysis took longer than 15 seconds. Please trace a smaller region or use a shorter forecast window."
        });
    }

    return res.status(500).json({ error: fallbackMessage });
}

router.get("/health", (req, res) => {
    res.json({
        ok: true,
        uptimeSeconds: Math.round(process.uptime()),
        timestamp: new Date().toISOString()
    });
});

/**
 * GET /api/sensors
 * Returns the sensor registry with transparency metadata.
 * All sensors are currently representative placeholders — dataSource: 'REPRESENTATIVE'.
 */
router.get("/sensors", requireApiKey, (req, res) => {
    const registry = getSensorRegistry();
    res.json({
        sensors: registry,
        totalCount: registry.length,
        liveCount: registry.filter(s => s.dataSource === 'LIVE').length,
        representativeCount: registry.filter(s => s.isRepresentative).length,
        disclaimer: 'All sensors in this registry are representative placeholders. No live sensor integration is active in this deployment.'
    });
});

router.post("/satellites/:id/int-data", requireApiKey, async (req, res) => {
    try {
        const { intData } = req.body;
        const updated = await updateSatelliteIntData(req.params.id, intData);
        res.json(updated);
    } catch (error) {
        console.error(`INT Data Update Failure for satellite ${req.params.id}:`, error);
        res.status(500).json({ 
            error: "Unable to update INT data.",
            message: error.message
        });
    }
});

router.get("/satellites/:id/drift-history", requireApiKey, async (req, res) => {
    try {
        const id = req.params.id;
        const isNumeric = /^\d+$/.test(id);
        const noradId = isNumeric ? Number.parseInt(id, 10) : null;
        const satelliteName = id;
        const days = Number.parseInt(req.query.days, 10) || 5;
        const startTime = req.query.startTime || null;

        const drift = await orbitalDriftService.generateDriftHistory(noradId, satelliteName, days, startTime);
        if (!drift) {
            return res.status(404).json({ error: "No historical drift data available for this satellite." });
        }

        res.json(drift);
    } catch (error) {
        console.error("Drift History Load Failure:", error);
        res.status(500).json({ error: "Unable to load orbital drift history." });
    }
});

router.get("/satellites/:id/tle-history", requireApiKey, async (req, res) => {

    try {
        const id = req.params.id;
        const isNumeric = /^\d+$/.test(id);
        const noradId = isNumeric ? Number.parseInt(id, 10) : null;
        const satelliteName = id; // Always try as name too

        const history = await getTleHistory(noradId, satelliteName, {
            limit: parseHistoryLimit(req.query.limit) || 100
        });

        res.json(history);
    } catch (error) {
        console.error("TLE History Load Failure:", error);
        res.status(500).json({ error: "Unable to load TLE history." });
    }
});

router.get("/satellites/:id/manoeuvre-history", requireApiKey, async (req, res) => {
    try {
        const id = req.params.id;
        const isNumeric = /^\d+$/.test(id);
        const noradId = isNumeric ? Number.parseInt(id, 10) : null;
        const satelliteName = id;

        const analysis = await analyzeSatelliteManoeuvreHistory(noradId, satelliteName, {
            limit: parseHistoryLimit(req.query.limit) || 500
        });

        res.json(analysis);
    } catch (error) {
        console.error("Manoeuvre History Load Failure:", error);
        res.status(500).json({ error: "Unable to run historical manoeuvre analysis." });
    }
});

function parseHistoryLimit(value) {
    if (value === undefined) {
        return undefined;
    }

    const parsed = Number.parseInt(value, 10);
    if (!Number.isInteger(parsed) || parsed < 1) {
        return undefined;
    }

    return parsed;
}

function parseAlertLimit(value) {
    return parseHistoryLimit(value);
}

function parseAlertType(value) {
    if (typeof value !== "string") {
        return undefined;
    }

    const trimmedValue = value.trim();
    return trimmedValue ? trimmedValue : undefined;
}

function validateAreaPayload(area) {
    return area && Array.isArray(area.points) && area.points.length >= 3;
}

function normalizeAltitude(value, fallback) {
    if (value === undefined || value === null || value === "") {
        return fallback;
    }

    const parsed = Number.parseFloat(value);
    return Number.isFinite(parsed) ? parsed : fallback;
}

router.get("/satellites", requireApiKey, validateSatelliteQuery, async (req, res) => {
    try {
        const limit = req.query.limit !== undefined ? Number.parseInt(req.query.limit, 10) : null;
        const offset = req.query.offset !== undefined ? Number.parseInt(req.query.offset, 10) : 0;
        const satellites = await listSatellites({
            search: req.query.search,
            catalogStatus: req.query.catalogStatus,
            isIndigenous: req.query.isIndigenous === "true" ? true : (req.query.isIndigenous === "false" ? false : undefined),
            limit,
            offset
        });
        res.json(satellites);
    } catch (error) {
        res.status(500).json({ error: "Unable to load satellites." });
    }
});

router.get("/satellites/indian", requireApiKey, validateSatelliteQuery, async (req, res) => {
    try {
        const limit = req.query.limit !== undefined ? Number.parseInt(req.query.limit, 10) : null;
        const offset = req.query.offset !== undefined ? Number.parseInt(req.query.offset, 10) : 0;
        const satellites = await listSatellites({
            indianOnly: true,
            search: req.query.search,
            limit,
            offset
        });
        res.json(satellites);
    } catch (error) {
        res.status(500).json({ error: "Unable to load Indian satellites." });
    }
});

router.get("/catalog/status", requireApiKey, async (req, res) => {
    try {
        const status = await getCatalogStatus();
        const { getSchedulerStatus } = require("../services/catalogSyncScheduler");
        status.scheduler = getSchedulerStatus();
        res.json(status);
    } catch (error) {
        res.status(500).json({ error: "Unable to load catalog status." });
    }
});

router.get("/catalog/latest-new-satellites", requireApiKey, async (req, res) => {
    try {
        const { CatalogSyncRun } = require("../models/catalogSyncRun");
        const { CatalogSyncNewSatellite } = require("../models/catalogSyncNewSatellite");
        const { Satellite } = require("../models/satellite");

        // Find the most recent sync run
        const latestSyncRun = await CatalogSyncRun.findOne({
            order: [["completedAt", "DESC"]]
        });

        if (!latestSyncRun) {
            return res.json({ satellites: [] });
        }

        // Fetch all CatalogSyncNewSatellite rows for that run
        const newSats = await CatalogSyncNewSatellite.findAll({
            where: { syncRunId: latestSyncRun.id }
        });

        if (newSats.length === 0) {
            return res.json({ satellites: [] });
        }

        const noradIds = newSats.map(ns => ns.noradId);
        const { serializeSatellite } = require("../services/satelliteMetadataService");

        const satellites = await Satellite.findAll({
            where: {
                noradId: noradIds
            }
        });

        const serialized = satellites.map(serializeSatellite);
        res.json({ satellites: serialized });
    } catch (error) {
        console.error("Failed to load latest new satellites:", error);
        res.status(500).json({ error: "Unable to load latest new satellites." });
    }
});

router.get("/catalog/history", requireApiKey, async (req, res) => {
    try {
        const history = await listCatalogHistory(parseHistoryLimit(req.query.limit));
        res.json(history);
    } catch (error) {
        res.status(500).json({ error: "Unable to load catalog history." });
    }
});

router.get("/catalog/events", requireApiKey, async (req, res) => {
    try {
        const events = await listCatalogEvents(parseHistoryLimit(req.query.limit));
        res.json(events);
    } catch (error) {
        res.status(500).json({ error: "Unable to load catalog events." });
    }
});

router.get("/alerts", requireApiKey, async (req, res) => {
    try {
        const alerts = await listOperationalAlerts({
            limit: parseAlertLimit(req.query.limit),
            alertType: parseAlertType(req.query.type)
        });
        res.json(alerts);
    } catch (error) {
        res.status(500).json({ error: "Unable to load operational alerts." });
    }
});

router.post("/alerts/conjunctions", requireApiKey, async (req, res) => {
    try {
        const result = req.body && req.body.result;
        if (!result || !Array.isArray(result.conjunctions)) {
            return res.status(400).json({
                error: "Invalid Body",
                message: "A conjunction analysis result is required."
            });
        }

        const outcome = await recordConjunctionAnalysis(result, {
            sourceName: req.body.sourceName || "Frontend Region Analysis",
            sourceType: req.body.sourceType || "frontend_analysis",
            analysisTime: req.body.analysisTime
        });

        res.json({
            message: "Conjunction alerts recorded.",
            persistedCount: outcome.persistedCount
        });
    } catch (error) {
        res.status(500).json({ error: "Unable to record conjunction alerts." });
    }
});

router.post("/alerts/neighbourhood-watch", requireApiKey, async (req, res) => {
    try {
        const result = req.body && req.body.result;
        if (!result || !Array.isArray(result.alerts)) {
            return res.status(400).json({
                error: "Invalid Body",
                message: "A neighbourhood watch result is required."
            });
        }

        const outcome = await recordNeighbourhoodWatchAnalysis(result, {
            sourceName: req.body.sourceName || "Frontend Neighborhood Watch",
            sourceType: req.body.sourceType || "frontend_neighbourhood_watch",
            analysisTime: req.body.analysisTime
        });

        res.json({
            message: "Neighbourhood watch alerts recorded.",
            persistedCount: outcome.persistedCount
        });
    } catch (error) {
        res.status(500).json({ error: "Unable to record neighbourhood watch alerts." });
    }
});

router.post("/analysis/conjunction", requireApiKey, async (req, res) => {
    try {
        const { area, horizonMinutes, conjunctionThresholdKm, minAltitudeKm, maxAltitudeKm, filters, time } = req.body || {};
        
        // Relax validation: area is optional for global operational screening
        if (area && !validateAreaPayload(area)) {
            return res.status(400).json({
                error: "Invalid Body",
                message: "If provided, the traced area must have at least three points."
            });
        }

        const result = await runBackendConjunctionAnalysis({
            area,
            horizonMinutes: normalizeAnalysisHorizonMinutes(horizonMinutes, 60),
            conjunctionThresholdKm: Number(conjunctionThresholdKm),
            minAltitudeKm: normalizeAltitude(minAltitudeKm, 0),
            maxAltitudeKm: normalizeAltitude(maxAltitudeKm, 42000),
            filters,
            time: time || new Date().toISOString()
        });

        persistAnalysisInBackground("Conjunction analysis", recordConjunctionAnalysis, result, {
            sourceName: "Backend Conjunction Analysis",
            sourceType: "backend_conjunction",
            analysisTime: time || new Date().toISOString()
        });

        res.json({
            result,
            persistedCount: 0
        });
    } catch (error) {
        return respondAnalysisFailure(res, error, "Unable to run conjunction analysis.");
    }
});

router.post("/analysis/region-scan", requireApiKey, async (req, res) => {
    try {
        const { area, horizonMinutes, minAltitudeKm, maxAltitudeKm, proximityThresholdKm, time } = req.body || {};
        if (!validateAreaPayload(area)) {
            return res.status(400).json({
                error: "Invalid Body",
                message: "A traced area with at least three points is required."
            });
        }

        const result = await runBackendRegionScan({
            area,
            horizonMinutes: normalizeAnalysisHorizonMinutes(horizonMinutes, 180),
            minAltitudeKm: normalizeAltitude(minAltitudeKm, 0),
            maxAltitudeKm: normalizeAltitude(maxAltitudeKm, 42000),
            proximityThresholdKm: normalizeAltitude(proximityThresholdKm, 25),
            time: time || new Date().toISOString()
        });

        persistAnalysisInBackground("Volumetric scan", recordRegionScanAnalysis, result, {
            sourceName: "Backend Volumetric Scan",
            sourceType: "backend_volumetric_scan",
            analysisTime: time || new Date().toISOString()
        });

        res.json({
            result,
            persistedCount: 0
        });
    } catch (error) {
        return respondAnalysisFailure(res, error, "Unable to run volumetric scan.");
    }
});

router.post("/analysis/neighbourhood-watch", requireApiKey, async (req, res) => {
    try {
        const { satelliteId, thresholdKm, time } = req.body || {};
        if (!satelliteId) {
            return res.status(400).json({
                error: "Invalid Body",
                message: "A satelliteId is required."
            });
        }

        const result = await runBackendNeighbourhoodWatch({
            satelliteId,
            thresholdKm: Number(thresholdKm),
            time: time || new Date().toISOString()
        });

        if (!result) {
            return res.status(404).json({
                error: "Not Found",
                message: "The requested satellite was not found."
            });
        }

        persistAnalysisInBackground("Neighbourhood watch", recordNeighbourhoodWatchAnalysis, result, {
            sourceName: "Backend Neighborhood Watch",
            sourceType: "backend_neighbourhood_watch",
            analysisTime: time || new Date().toISOString()
        });

        res.json({
            result,
            persistedCount: 0
        });
    } catch (error) {
        return respondAnalysisFailure(res, error, "Unable to run neighbourhood watch analysis.");
    }
});

router.post("/analysis/batch-manoeuvre-forensics", requireApiKey, async (req, res) => {
    try {
        const satellites = await Satellite.findAll();
        let detectedManoeuvres = 0;
        const findings = [];

        for (const sat of satellites) {
            const analysis = await analyzeSatelliteManoeuvreHistory(sat.noradId, sat.name, { limit: 100 });
            if (analysis.manoeuvres.length > 0) {
                detectedManoeuvres += analysis.manoeuvres.length;
                findings.push(...analysis.manoeuvres);
            }
        }

        // Persist the detected manoeuvres to the alert feed
        const outcome = await recordManoeuvreDetections(findings, {
            sourceName: "Batch Historical Forensics",
            sourceType: "backend_manoeuvre_forensics_batch",
            analysisTime: new Date().toISOString()
        });

        res.json({
            result: {
                evaluatedSatellites: satellites.length,
                detectedManoeuvres
            },
            persistedCount: outcome.persistedCount
        });
    } catch (error) {
        console.error("Batch forensics failed:", error);
        res.status(500).json({ error: "Unable to run batch forensics." });
    }
});

router.post("/analysis/target-manoeuvre-detection", requireApiKey, async (req, res) => {
    try {
        const { noradId, satelliteName, thresholds } = req.body || {};
        const result = await analyzeTargetManoeuvre(noradId, satelliteName, { thresholds });
        res.json({ result });
    } catch (error) {
        console.error("Target manoeuvre detection failed:", error);
        res.status(500).json({ error: "Unable to analyze target manoeuvre." });
    }
});

router.post("/analysis/manoeuvre-detection", requireApiKey, async (req, res) => {
    try {
        const { time, thresholds, forceSync = false } = req.body || {};
        const referenceDate = time ? new Date(time) : new Date();
        const activeThresholds = thresholds && typeof thresholds === "object" ? thresholds : {};

        let evaluation;
        let sourceName = "Database Audit";

        if (forceSync) {
            console.log("Force sync requested for manoeuvre detection...");
            try {
                const incomingBatch = await fetchSatelliteCatalog();
                const existingRows = await Satellite.findAll();

                const previousSatellites = existingRows.map((row) => serializeSatellite(row));
                const incomingSatellites = incomingBatch.map((row) => ({
                    ...row,
                    isIndian: isIndianSatelliteName(row.name)
                }));

                evaluation = await evaluateCatalogManoeuvres({
                    previousSatellites,
                    incomingSatellites,
                    referenceDate,
                    thresholds: activeThresholds
                });
                sourceName = "Live Sync Evaluation";
            } catch (fetchError) {
                console.warn("Live fetch failed during manoeuvre detection, falling back to database audit:", fetchError.message);
                // Fall through to database audit
            }
        }

        // If no evaluation yet (either no forceSync or fetch failed), run database audit
        if (!evaluation) {
            evaluation = await detectManoeuvresFromLatestRevisions({
                thresholds: activeThresholds
            });
        }

        if (evaluation.evaluatedPairs === 0) {
            return res.status(200).json({
                message: "Insufficient historical TLE revisions available for manoeuvre analysis.",
                result: evaluation,
                persistedCount: 0
            });
        }

        const outcome = await recordManoeuvreDetections(evaluation.findings, {
            sourceName: `Backend Manoeuvre Detection (${sourceName})`,
            sourceType: "backend_manoeuvre_detection_manual",
            analysisTime: referenceDate.toISOString()
        });

        res.json({
            result: evaluation,
            persistedCount: outcome.persistedCount,
            dataSource: sourceName
        });
    } catch (error) {
         console.error("Manoeuvre detection failed:", error);
         res.status(500).json({
             error: "Unable to run manoeuvre detection.",
             details: error.message
         });
    }
});
router.post("/analysis/blind-spot", requireApiKey, async (req, res) => {
    try {
        const { area, horizonMinutes, minAltitudeKm, maxAltitudeKm, visibilityThresholdDeg, time } = req.body || {};
        if (!validateAreaPayload(area)) {
            return res.status(400).json({
                error: "Invalid Body",
                message: "A traced area with at least three points is required."
            });
        }

        const result = await runBackendBlindSpot({
            area,
            horizonMinutes: normalizeAnalysisHorizonMinutes(horizonMinutes, 180),
            minAltitudeKm: normalizeAltitude(minAltitudeKm, 0),
            maxAltitudeKm: normalizeAltitude(maxAltitudeKm, 42000),
            visibilityThresholdDeg: normalizeAltitude(visibilityThresholdDeg, 10),
            time: time || new Date().toISOString()
        });

        persistAnalysisInBackground("Blind spot", recordBlindSpotAnalysis, result, {
            sourceName: "Backend Blind Spot Analysis",
            sourceType: "backend_blind_spot",
            analysisTime: time || new Date().toISOString()
        });

        res.json({
            result,
            persistedCount: 0
        });
    } catch (error) {
        return respondAnalysisFailure(res, error, "Unable to run blind spot analysis.");
    }
});

router.post("/analysis/regional-presence/details", requireApiKey, async (req, res) => {
    try {
        const {
            area,
            region,
            timeframeDays,
            baselineSplitDays,
            visibilityThresholdDeg,
            satelliteName,
            noradId,
            time
        } = req.body || {};

        const { getRegionalAccessDetails } = require("../services/regionalPresenceAnalysisService");
        
        const result = await getRegionalAccessDetails({
            area: area || region || null,
            timeframeDays,
            baselineSplitDays,
            visibilityThresholdDeg,
            satelliteName,
            noradId: Number.isFinite(Number(noradId)) ? Number(noradId) : undefined,
            time: time || new Date().toISOString()
        });

        res.json({ result });
    } catch (error) {
        return respondAnalysisFailure(res, error, "Unable to fetch regional presence details.");
    }
});

router.post("/analysis/regional-presence", requireApiKey, async (req, res) => {
    try {
        const {
            area,
            region,
            timeframeDays,
            baselineSplitDays,
            sampleMinutes,
            visibilityThresholdDeg,
            maxFindings,
            satelliteName,
            noradId,
            time,
            maxSatellites
        } = req.body || {};

        const result = await runBackendRegionalPresence({
            area: area || region || null,
            timeframeDays,
            baselineSplitDays,
            sampleMinutes,
            visibilityThresholdDeg,
            maxFindings,
            satelliteName,
            noradId: Number.isFinite(Number(noradId)) ? Number(noradId) : undefined,
            time: time || new Date().toISOString(),
            maxSatellites
        });

        res.json({
            result,
            persistedCount: 0
        });
    } catch (error) {
        return respondAnalysisFailure(res, error, "Unable to run regional presence analysis.");
    }
});

router.post("/analysis/reentry-prediction", requireApiKey, async (req, res) => {
    try {
        const { noradId, satelliteName, limit } = req.body || {};
        if (!noradId && !satelliteName) {
            return res.status(400).json({
                error: "Invalid Body",
                message: "A noradId or satelliteName is required."
            });
        }

        const prediction = await predictSatelliteReentry(noradId, satelliteName, {
            limit: parseHistoryLimit(limit) || 50
        });

        res.json(prediction);
    } catch (error) {
        console.error("Re-entry prediction failed:", error);
        res.status(500).json({ error: "Unable to run re-entry prediction." });
    }
});

router.post("/satellites/recharacterise", requireSyncAccess, async (req, res) => {
    try {
        const result = await batchCharacteriseSatellites();
        res.json({ 
            message: "Characterisation complete", 
            ...result 
        });
    } catch (error) {
        console.error("Characterisation error:", error);
        res.status(500).json({ error: "Unable to recharacterise satellites." });
    }
});

router.post("/sync", requireSyncAccess, async (req, res) => {
    try {
        const syncedCount = await syncSatellites();
        res.json({ message: "Sync complete", syncedCount });
    } catch (error) {
        res.status(500).json({ error: "Unable to sync satellites." });
    }
});

router.post("/satellites", requireApiKey, async (req, res) => {
    try {
        const { name, line1, line2, intData } = req.body;
        if (!line1 || !line2) {
            return res.status(400).json({ error: "Line1 and Line2 are required (TLE format)." });
        }

        const result = await ingestTrackObservation({ name, line1, line2, intData });
        res.status(201).json(result);
    } catch (error) {
        console.error("Manual ingestion error:", error);
        res.status(500).json({ error: error.message || "Unable to ingest manual track." });
    }
});

router.post("/rapid-processing/ingest", requireApiKey, async (req, res) => {
    try {
        const result = await rapidProcessingService.ingestSensorTrack(req.body);
        res.json(result);
    } catch (error) {
        console.error("Ingestion error:", error);
        res.status(500).json({ error: "Unable to ingest sensor track." });
    }
});

router.get("/rapid-processing/tracks", requireApiKey, async (req, res) => {
    try {
        const tracks = await rapidProcessingService.getRapidTracks();
        res.json(tracks);
    } catch (error) {
        res.status(500).json({ error: "Unable to fetch rapid tracks." });
    }
});

router.get("/rapid-processing/latest", async (req, res) => {
    try {
        const latest = await rapidProcessingService.getLatestExecution();
        res.json(latest);
    } catch (error) {
        res.status(500).json({ error: "Unable to fetch latest rapid execution." });
    }
});

router.post("/rapid-processing/run", requireSyncAccess, async (req, res) => {
    try {
        // Start pipeline in background (it can take time)
        rapidProcessingService.runRapidProcessingPipeline().catch(err => {
            console.error("Background Rapid Pipeline Failure:", err);
        });
        
        res.json({ message: "Rapid Processing Pipeline started in background." });
    } catch (error) {
        res.status(500).json({ error: "Unable to initiate rapid processing." });
    }
});

module.exports = {
    satelliteRouter: router
};
