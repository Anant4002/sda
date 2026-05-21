const { TrainingScenario } = require("../models/trainingScenario");
const { TrainingSession } = require("../models/trainingSession");
const { OperationalAlert } = require("../models/operationalAlert");
const { recordOperationalAlert } = require("./operationalAlertService");
const { Op } = require("sequelize");

async function listScenarios() {
    return TrainingScenario.findAll();
}

async function startSession(scenarioId, sessionName) {
    const scenario = scenarioId ? await TrainingScenario.findByPk(scenarioId) : null;
    const startTime = scenario ? scenario.initialStartTime : new Date();
    
    const session = await TrainingSession.create({
        scenarioId: scenario ? scenario.id : null,
        sessionName: sessionName || (scenario ? `Training: ${scenario.name}` : "Manual Simulation"),
        status: "active",
        startTime,
        currentSimTime: startTime,
        speed: 1.0,
        lastUpdateRealTime: new Date()
    });

    // If scenario has pre-defined events, we could schedule them, 
    // but for POC, we'll just let the client trigger them or load them on start.
    return session;
}

async function getSession(sessionId) {
    return TrainingSession.findByPk(sessionId);
}

async function updateSession(sessionId, updates) {
    const session = await TrainingSession.findByPk(sessionId);
    if (!session) throw new Error("Session not found");

    if (updates.status) session.status = updates.status;
    if (updates.speed !== undefined) session.speed = updates.speed;
    
    // Manual time set
    if (updates.currentSimTime) {
        session.currentSimTime = new Date(updates.currentSimTime);
        session.lastUpdateRealTime = new Date();
    }

    await session.save();
    return session;
}

async function tickSession(sessionId) {
    const session = await TrainingSession.findByPk(sessionId);
    if (!session || session.status !== "active") return session;

    const now = new Date();
    const elapsedRealMs = now - session.lastUpdateRealTime;
    const elapsedSimMs = elapsedRealMs * session.speed;

    session.currentSimTime = new Date(session.currentSimTime.getTime() + elapsedSimMs);
    session.lastUpdateRealTime = now;

    await session.save();
    return session;
}

async function injectSimulatedAlert(sessionId, alertData) {
    const session = await TrainingSession.findByPk(sessionId);
    if (!session) throw new Error("Session not found");

    const alert = {
        ...alertData,
        occurredAt: alertData.occurredAt || session.currentSimTime,
        sourceType: "simulation",
        sourceName: "Training Simulator",
        trainingSessionId: session.id
    };

    // We use a modified version of recordOperationalAlert or just direct creation
    // to avoid eventKey collisions if we're replaying real alerts.
    // For simulation, we'll generate a unique eventKey.
    const simEventKey = `sim_${session.id}_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    
    return OperationalAlert.create({
        ...alert,
        eventKey: simEventKey
    });
}

async function getSessionAlerts(sessionId, options = {}) {
    const { limit = 50 } = options;
    return OperationalAlert.findAll({
        where: {
            trainingSessionId: sessionId
        },
        order: [["occurredAt", "DESC"]],
        limit
    });
}

/**
 * Replays historical alerts into a simulation session by copying them 
 * and associating them with the session.
 */
async function loadHistoricalReplay(sessionId, startTime, endTime, filter = {}) {
    const session = await TrainingSession.findByPk(sessionId);
    if (!session) throw new Error("Session not found");

    const historicalAlerts = await OperationalAlert.findAll({
        where: {
            trainingSessionId: null, // Only real alerts
            occurredAt: {
                [Op.between]: [new Date(startTime), new Date(endTime)]
            },
            ...filter
        }
    });

    const replayedAlerts = [];
    for (const alert of historicalAlerts) {
        const simEventKey = `replay_${session.id}_${alert.eventKey}`;
        
        // Check if already replayed
        const existing = await OperationalAlert.findOne({ where: { eventKey: simEventKey } });
        if (existing) continue;

        const newAlert = await OperationalAlert.create({
            ...alert.get({ plain: true }),
            id: undefined, // Let DB generate new ID
            eventKey: simEventKey,
            trainingSessionId: session.id,
            sourceType: "replay",
            sourceName: `Replay: ${alert.sourceName || "System"}`
        });
        replayedAlerts.push(newAlert);
    }

    return replayedAlerts;
}

module.exports = {
    listScenarios,
    startSession,
    getSession,
    updateSession,
    tickSession,
    injectSimulatedAlert,
    getSessionAlerts,
    loadHistoricalReplay
};
