const express = require("express");
const trainingService = require("../services/trainingSimulationService");
const { requireApiKey } = require("../middleware/requestGuards");

const router = express.Router();

router.get("/scenarios", requireApiKey, async (req, res) => {
    try {
        const scenarios = await trainingService.listScenarios();
        res.json(scenarios);
    } catch (error) {
        res.status(500).json({ error: "Unable to load scenarios." });
    }
});

router.post("/sessions", requireApiKey, async (req, res) => {
    try {
        const { scenarioId, sessionName } = req.body;
        const session = await trainingService.startSession(scenarioId, sessionName);
        res.json(session);
    } catch (error) {
        res.status(500).json({ error: "Unable to start simulation session." });
    }
});

router.get("/sessions/:id", requireApiKey, async (req, res) => {
    try {
        const session = await trainingService.getSession(req.params.id);
        if (!session) return res.status(404).json({ error: "Session not found." });
        res.json(session);
    } catch (error) {
        res.status(500).json({ error: "Unable to load session." });
    }
});

router.patch("/sessions/:id", requireApiKey, async (req, res) => {
    try {
        const session = await trainingService.updateSession(req.params.id, req.body);
        res.json(session);
    } catch (error) {
        res.status(500).json({ error: "Unable to update session." });
    }
});

router.post("/sessions/:id/tick", requireApiKey, async (req, res) => {
    try {
        const session = await trainingService.tickSession(req.params.id);
        res.json(session);
    } catch (error) {
        res.status(500).json({ error: "Unable to tick session." });
    }
});

router.get("/sessions/:id/alerts", requireApiKey, async (req, res) => {
    try {
        const alerts = await trainingService.getSessionAlerts(req.params.id, req.query);
        res.json(alerts);
    } catch (error) {
        res.status(500).json({ error: "Unable to load session alerts." });
    }
});

router.post("/sessions/:id/inject-alert", requireApiKey, async (req, res) => {
    try {
        const alert = await trainingService.injectSimulatedAlert(req.params.id, req.body);
        res.json(alert);
    } catch (error) {
        res.status(500).json({ error: "Unable to inject alert." });
    }
});

router.post("/sessions/:id/load-replay", requireApiKey, async (req, res) => {
    try {
        const { startTime, endTime, filter } = req.body;
        const alerts = await trainingService.loadHistoricalReplay(req.params.id, startTime, endTime, filter);
        res.json({ message: `Loaded ${alerts.length} alerts for replay.`, count: alerts.length });
    } catch (error) {
        res.status(500).json({ error: "Unable to load historical replay." });
    }
});

module.exports = {
    trainingRouter: router
};
