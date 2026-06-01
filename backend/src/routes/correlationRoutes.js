const express = require("express");
const {
    getCorrelationRules,
    listUnifiedThreatInsights,
    rebuildIncidentsFromAlerts
} = require("../services/correlationEngineService");
const { requireApiKey, requireSyncAccess } = require("../middleware/requestGuards");

const router = express.Router();

router.get("/incidents", requireApiKey, async (req, res) => {
    try {
        const result = await listUnifiedThreatInsights({
            classification: req.query.classification || null,
            priority: req.query.priority || null,
            page: req.query.page || 1,
            pageSize: req.query.pageSize || req.query.limit || 5,
            viewMode: req.query.viewMode || req.query.view || "top10",
            trainingSessionId: req.query.trainingSessionId || null
        });

        res.json(result);
    } catch (error) {
        console.error("Failed to load unified threat insights:", error);
        res.status(500).json({ error: "Unable to load unified threat insights." });
    }
});

router.get("/rules", requireApiKey, async (req, res) => {
    try {
        const rules = await getCorrelationRules();
        res.json({ rules });
    } catch (error) {
        console.error("Failed to load correlation rules:", error);
        res.status(500).json({ error: "Unable to load correlation rules." });
    }
});

router.post("/rebuild", requireSyncAccess, async (req, res) => {
    try {
        const result = await rebuildIncidentsFromAlerts({
            limit: req.body?.limit || 5000
        });
        res.json({
            message: "Unified threat insights rebuilt.",
            processedCount: result.processedCount
        });
    } catch (error) {
        console.error("Failed to rebuild unified threat insights:", error);
        res.status(500).json({ error: "Unable to rebuild unified threat insights." });
    }
});

module.exports = {
    correlationRouter: router
};
