import { appState } from "./state.js";
import { eventBus, events } from "./modules/eventBus.js";
import { viewer } from "./viewer.js";
import { getTrainingScenarioById, trainingScenarios } from "./modules/definitions/trainingScenarioLibrary.js";

const ALLOWED_SPEEDS = [1, 5, 10, 50, 100];

function clone(value) {
    return typeof structuredClone === "function"
        ? structuredClone(value)
        : JSON.parse(JSON.stringify(value));
}

function nowIso() {
    return new Date().toISOString();
}

function makeSessionId() {
    return `train-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
}

function normaliseSpeed(speed) {
    const numeric = Number(speed);
    if (!Number.isFinite(numeric) || numeric <= 0) {
        return 1;
    }

    let nearest = ALLOWED_SPEEDS[0];
    let distance = Math.abs(numeric - nearest);

    for (const candidate of ALLOWED_SPEEDS) {
        const candidateDistance = Math.abs(numeric - candidate);
        if (candidateDistance < distance) {
            nearest = candidate;
            distance = candidateDistance;
        }
    }

    return nearest;
}

function formatSimElapsedMinutes(session) {
    if (!session?.startTime || !session?.currentSimTime) {
        return 0;
    }

    return (session.currentSimTime.getTime() - session.startTime.getTime()) / 60000;
}

function addTrainingEntity(entityDefinition) {
    if (!viewer || !viewer.entities) {
        return null;
    }

    const entity = viewer.entities.add(entityDefinition);
    appState.trainingEntities.push(entity);
    return entity;
}

function clearTrainingEntities() {
    if (!viewer || !viewer.entities) {
        appState.trainingEntities = [];
        return;
    }

    for (const entity of appState.trainingEntities) {
        try {
            viewer.entities.remove(entity);
        } catch (error) {
            console.warn("Failed to remove training entity.", error);
        }
    }
    appState.trainingEntities = [];
}

function pointFromDegrees(position) {
    if (!position) {
        return null;
    }

    return Cesium.Cartesian3.fromDegrees(position.lon, position.lat, (position.altKm || 0) * 1000);
}

function updateViewerClock(simTime) {
    if (!viewer || !viewer.clock || !simTime) {
        return;
    }

    viewer.clock.currentTime = Cesium.JulianDate.fromDate(simTime);
    viewer.clock.shouldAnimate = true;
    viewer.clock.multiplier = 1.0;
}

function clearTrainingState() {
    clearTrainingEntities();
    appState.trainingSummary = null;
}

function recordFeedEntry(session, entry) {
    const feedEntry = {
        id: entry.id || `feed-${session.feed.length + 1}-${Date.now()}`,
        type: entry.type || "event",
        title: entry.title || "Training Event",
        summary: entry.summary || "",
        severity: entry.severity || "info",
        source: entry.source || "scenario",
        minute: Number.isFinite(entry.minute) ? entry.minute : formatSimElapsedMinutes(session),
        occurredAt: entry.occurredAt || session.currentSimTime.toISOString(),
        assetIds: entry.assetIds || [],
        requiresAck: Boolean(entry.requiresAck),
        acknowledged: Boolean(entry.acknowledged),
        acknowledgedAt: entry.acknowledgedAt || null,
        responseSeconds: Number.isFinite(entry.responseSeconds) ? entry.responseSeconds : null,
        targetResponseMinutes: Number.isFinite(entry.targetResponseMinutes) ? entry.targetResponseMinutes : null,
        operatorAction: Boolean(entry.operatorAction),
        timelineKind: entry.timelineKind || "event",
        eventId: entry.eventId || null,
        objectiveIds: entry.objectiveIds || [],
        visualKind: entry.visualKind || null
    };

    session.feed.unshift(feedEntry);
    session.timelineEntries.unshift({
        id: feedEntry.id,
        type: feedEntry.type,
        title: feedEntry.title,
        summary: feedEntry.summary,
        severity: feedEntry.severity,
        source: feedEntry.source,
        minute: feedEntry.minute,
        occurredAt: feedEntry.occurredAt,
        operatorAction: feedEntry.operatorAction,
        acknowledged: feedEntry.acknowledged,
        responseSeconds: feedEntry.responseSeconds,
        timelineKind: feedEntry.timelineKind,
        eventId: feedEntry.eventId,
        objectiveIds: feedEntry.objectiveIds
    });

    if (feedEntry.operatorAction) {
        session.score.operatorActions += 1;
    } else if (feedEntry.timelineKind !== "checkpoint") {
        session.score.triggeredEvents += 1;
    }

    return feedEntry;
}

function markObjectivesComplete(session, objectiveIds = []) {
    if (!Array.isArray(objectiveIds) || !objectiveIds.length) {
        return;
    }

    for (const objectiveId of objectiveIds) {
        const objective = session.objectives.find((item) => item.id === objectiveId);
        if (objective) {
            objective.status = "complete";
            objective.completedAt = session.currentSimTime.toISOString();
        }
    }
}

function createOverlayLabel(text, color) {
    return {
        text,
        font: "bold 14px monospace",
        fillColor: color,
        outlineColor: Cesium.Color.BLACK,
        outlineWidth: 2,
        style: Cesium.LabelStyle.FILL_AND_OUTLINE,
        verticalOrigin: Cesium.VerticalOrigin.BOTTOM,
        pixelOffset: new Cesium.Cartesian2(0, -18),
        disableDepthTestDistance: Number.POSITIVE_INFINITY
    };
}

function drawTrainingOverlay(eventRecord) {
    if (!eventRecord?.visual) {
        return;
    }

    const palette = {
        critical: Cesium.Color.RED,
        warning: Cesium.Color.ORANGE,
        info: Cesium.Color.CYAN,
        success: Cesium.Color.LIME
    };
    const color = palette[eventRecord.severity] || Cesium.Color.WHITE;
    const { visual } = eventRecord;

    if (visual.kind === "conjunction") {
        const primary = pointFromDegrees(visual.primaryPosition);
        const secondary = pointFromDegrees(visual.secondaryPosition);
        if (!primary || !secondary) return;

        const midpoint = Cesium.Cartesian3.lerp(primary, secondary, 0.5, new Cesium.Cartesian3());
        addTrainingEntity({
            polyline: {
                positions: [primary, secondary],
                width: 4,
                material: new Cesium.PolylineGlowMaterialProperty({
                    glowPower: 0.18,
                    color: color
                }),
                arcType: Cesium.ArcType.NONE
            }
        });
        addTrainingEntity({
            position: midpoint,
            point: {
                pixelSize: 14,
                color,
                outlineColor: Cesium.Color.WHITE,
                outlineWidth: 2,
                disableDepthTestDistance: Number.POSITIVE_INFINITY
            },
            label: createOverlayLabel(
                `${eventRecord.title}\n${Number.isFinite(eventRecord.closestDistanceKm) ? `${eventRecord.closestDistanceKm.toFixed(2)} km` : "Miss distance"}`,
                color
            )
        });
        return;
    }

    if (visual.kind === "reentry") {
        const corridor = Array.isArray(visual.corridor) ? visual.corridor.map(pointFromDegrees).filter(Boolean) : [];
        if (corridor.length < 2) return;

        addTrainingEntity({
            polyline: {
                positions: corridor,
                width: 32,
                material: new Cesium.PolylineDashMaterialProperty({
                    color: Cesium.Color.RED.withAlpha(0.35),
                    dashLength: 14
                }),
                clampToGround: true
            }
        });
        addTrainingEntity({
            polyline: {
                positions: corridor,
                width: 2,
                material: Cesium.Color.RED,
                clampToGround: true
            }
        });
        addTrainingEntity({
            position: corridor[Math.floor(corridor.length / 2)],
            point: {
                pixelSize: 15,
                color: Cesium.Color.RED,
                outlineColor: Cesium.Color.WHITE,
                outlineWidth: 2,
                disableDepthTestDistance: Number.POSITIVE_INFINITY
            },
            label: createOverlayLabel(eventRecord.title, Cesium.Color.RED)
        });
        return;
    }

    if (visual.kind === "blackout" || visual.kind === "spread") {
        const center = pointFromDegrees(visual.position || visual.center);
        if (!center) return;

        addTrainingEntity({
            position: center,
            ellipse: {
                semiMinorAxis: (visual.radiusKm || 1000) * 1000,
                semiMajorAxis: (visual.radiusKm || 1000) * 1000,
                material: color.withAlpha(0.12),
                outline: true,
                outlineColor: color.withAlpha(0.75)
            },
            label: createOverlayLabel(eventRecord.title, color)
        });
        return;
    }

    if (visual.kind === "track") {
        const from = pointFromDegrees(visual.from);
        const to = pointFromDegrees(visual.to);
        if (!from || !to) return;

        const midpoint = Cesium.Cartesian3.lerp(from, to, 0.5, new Cesium.Cartesian3());
        addTrainingEntity({
            polyline: {
                positions: [from, to],
                width: 5,
                material: new Cesium.PolylineGlowMaterialProperty({
                    glowPower: 0.15,
                    color
                }),
                arcType: Cesium.ArcType.NONE
            }
        });
        addTrainingEntity({
            position: midpoint,
            point: {
                pixelSize: 13,
                color,
                outlineColor: Cesium.Color.BLACK,
                outlineWidth: 2,
                disableDepthTestDistance: Number.POSITIVE_INFINITY
            },
            label: createOverlayLabel(visual.label || eventRecord.title, color)
        });
        return;
    }

    if (visual.kind === "marker") {
        const position = pointFromDegrees(visual.position);
        if (!position) return;

        addTrainingEntity({
            position,
            point: {
                pixelSize: 14,
                color,
                outlineColor: Cesium.Color.WHITE,
                outlineWidth: 2,
                disableDepthTestDistance: Number.POSITIVE_INFINITY
            },
            label: createOverlayLabel(visual.label || eventRecord.title, color)
        });
    }
}

function syncSessionState(session) {
    appState.activeTrainingSession = session;
    appState.simulationMode = Boolean(session);
    appState.simulationClock = session ? new Date(session.currentSimTime) : null;
    appState.simulationSpeed = session ? session.speed : 1;
    appState.simulationPaused = session ? session.status !== "active" : true;
    appState.trainingSummary = session ? {
        scenarioId: session.scenarioId,
        scenarioTitle: session.scenario?.title || session.sessionName,
        mode: session.scenario?.type || "synthetic",
        feedCount: session.feed.length,
        timelineCount: session.timelineEntries.length
    } : null;

    if (session) {
        updateViewerClock(session.currentSimTime);
    }
}

function initialiseSession(scenario, sessionName = null, speed = 1) {
    const startTime = new Date(scenario.startTime || nowIso());
    return {
        id: makeSessionId(),
        sessionName: sessionName || scenario.title,
        scenarioId: scenario.id,
        scenario: clone(scenario),
        mode: scenario.type || "synthetic",
        status: "active",
        startTime,
        currentSimTime: new Date(startTime),
        speed: normaliseSpeed(speed),
        lastUpdateRealTime: new Date(),
        feed: [],
        timelineEntries: [],
        objectives: clone(scenario.objectives || []).map((objective) => ({
            ...objective,
            status: "pending",
            completedAt: null
        })),
        processedEventIds: [],
        processedCheckpointIds: [],
        score: {
            triggeredEvents: 0,
            operatorActions: 0,
            acknowledgedEvents: 0,
            onTimeResponses: 0,
            lateResponses: 0,
            averageResponseSeconds: 0
        }
    };
}

function queueScenarioEvents(session) {
    const scenarioTimeline = Array.isArray(session.scenario?.timeline) ? session.scenario.timeline : [];
    const elapsedMinutes = formatSimElapsedMinutes(session);

    for (let index = 0; index < scenarioTimeline.length; index += 1) {
        const item = scenarioTimeline[index];
        const minute = Number(item.minute);
        if (!Number.isFinite(minute) || minute > elapsedMinutes) {
            continue;
        }

        const eventKey = item.id || `${session.scenarioId}:${index}:${minute}`;
        if (item.kind === "checkpoint") {
            if (session.processedCheckpointIds.includes(eventKey)) {
                continue;
            }
            session.processedCheckpointIds.push(eventKey);
            recordFeedEntry(session, {
                id: `checkpoint-${eventKey}`,
                type: "checkpoint",
                title: item.title,
                summary: item.summary,
                severity: "info",
                source: "scenario",
                minute,
                occurredAt: new Date(session.startTime.getTime() + minute * 60000).toISOString(),
                requiresAck: false,
                timelineKind: "checkpoint"
            });
            continue;
        }

        if (session.processedEventIds.includes(eventKey)) {
            continue;
        }
        session.processedEventIds.push(eventKey);

        const eventRecord = recordFeedEntry(session, {
            id: `event-${eventKey}`,
            type: item.type || "event",
            title: item.title,
            summary: item.summary,
            severity: item.severity || "info",
            source: "scenario",
            minute,
            occurredAt: new Date(session.startTime.getTime() + minute * 60000).toISOString(),
            assetIds: item.assetIds || [],
            requiresAck: item.requiresAck !== false,
            targetResponseMinutes: item.targetResponseMinutes,
            objectiveIds: item.objectiveIds || [],
            visualKind: item.visual?.kind || null,
            eventId: eventKey,
            visual: item.visual,
            closestDistanceKm: item.closestDistanceKm
        });

        if (eventRecord.requiresAck) {
            session.score.acknowledgedEvents += 0;
        }

        markObjectivesComplete(session, item.objectiveIds);
        drawTrainingOverlay({
            ...eventRecord,
            visual: item.visual,
            closestDistanceKm: item.closestDistanceKm
        });
    }
}

function maybeCompleteScenario(session) {
    if (session.status === "completed") {
        return true;
    }

    const scenarioDuration = Number(session.scenario?.durationMinutes);
    if (!Number.isFinite(scenarioDuration)) {
        return false;
    }

    const elapsedMinutes = formatSimElapsedMinutes(session);
    if (elapsedMinutes < scenarioDuration) {
        return false;
    }

    const unresolved = session.feed.some((entry) => entry.requiresAck && !entry.acknowledged);
    session.status = unresolved ? "completed" : "completed";
    session.currentSimTime = new Date(session.startTime.getTime() + scenarioDuration * 60000);
    appState.simulationPaused = true;
    appState.simulationClock = new Date(session.currentSimTime);
    updateViewerClock(session.currentSimTime);
    recordFeedEntry(session, {
        id: `complete-${session.id}`,
        type: "operator_action",
        title: "Exercise Complete",
        summary: "Scenario duration has elapsed. Review the timeline, scorecard, and next-step recommendations.",
        severity: "info",
        source: "system",
        minute: scenarioDuration,
        occurredAt: session.currentSimTime.toISOString(),
        operatorAction: true,
        requiresAck: false,
        timelineKind: "completion"
    });
    appState.trainingSummary = {
        scenarioId: session.scenarioId,
        scenarioTitle: session.scenario.title,
        mode: session.mode,
        feedCount: session.feed.length,
        timelineCount: session.timelineEntries.length,
        completed: true
    };
    return true;
}

export async function fetchScenarios() {
    return clone(trainingScenarios);
}

export async function startSimulation(scenarioId = null, sessionName = null) {
    const selectedScenario = scenarioId ? getTrainingScenarioById(scenarioId) : trainingScenarios[0];
    if (!selectedScenario) {
        throw new Error("No training scenario available.");
    }

    clearTrainingState();
    const session = initialiseSession(selectedScenario, sessionName);
    queueScenarioEvents(session);
    syncSessionState(session);
    appState.trainingSelectedScenarioId = selectedScenario.id;
    appState.trainingLastTickAt = new Date();
    eventBus.emit(events.SIMULATION_STARTED, clone(session));
    eventBus.emit(events.SIMULATION_UPDATED, clone(session));
    return clone(session);
}

export async function updateSimulationStatus(updates = {}) {
    const session = appState.activeTrainingSession;
    if (!session) {
        return null;
    }

    if (updates.speed !== undefined) {
        session.speed = normaliseSpeed(updates.speed);
    }

    if (updates.status) {
        session.status = updates.status === "paused" ? "paused" : "active";
        appState.simulationPaused = session.status !== "active";
    }

    if (updates.currentSimTime) {
        session.currentSimTime = new Date(updates.currentSimTime);
    }

    if (updates.sessionName) {
        session.sessionName = updates.sessionName;
    }

    session.lastUpdateRealTime = new Date();

    syncSessionState(session);
    eventBus.emit(events.SIMULATION_UPDATED, clone(session));
    return clone(session);
}

export async function tickSimulation() {
    const session = appState.activeTrainingSession;
    if (!session || session.status !== "active" || appState.simulationPaused) {
        return session ? clone(session) : null;
    }

    const now = new Date();
    const elapsedRealMs = now - session.lastUpdateRealTime;
    const elapsedSimMs = elapsedRealMs * session.speed;
    session.currentSimTime = new Date(session.currentSimTime.getTime() + elapsedSimMs);
    session.lastUpdateRealTime = now;
    appState.trainingLastTickAt = now;
    appState.simulationClock = new Date(session.currentSimTime);

    const beforeEventCount = session.feed.length;
    queueScenarioEvents(session);
    maybeCompleteScenario(session);
    syncSessionState(session);

    eventBus.emit(events.SIMULATION_TICK, clone(session));
    if (session.feed.length !== beforeEventCount) {
        eventBus.emit(events.SIMULATION_UPDATED, clone(session));
    }

    return clone(session);
}

export async function stopSimulation() {
    clearTrainingState();
    appState.simulationMode = false;
    appState.activeTrainingSession = null;
    appState.simulationClock = null;
    appState.simulationSpeed = 1.0;
    appState.simulationPaused = true;
    appState.trainingLastTickAt = null;
    appState.trainingSummary = null;
    appState.realTimeMultiplier = 60;
    appState.realTimeClock = new Date();

    updateViewerClock(appState.realTimeClock);
    eventBus.emit(events.SIMULATION_STOPPED);
    return true;
}

export async function resetSimulation() {
    const session = appState.activeTrainingSession;
    if (!session) {
        return null;
    }

    clearTrainingState();
    const scenario = getTrainingScenarioById(session.scenarioId);
    if (!scenario) {
        return stopSimulation();
    }

    const freshSession = initialiseSession(scenario, session.sessionName, session.speed);
    freshSession.status = "paused";
    queueScenarioEvents(freshSession);
    syncSessionState(freshSession);
    eventBus.emit(events.SIMULATION_UPDATED, clone(freshSession));
    return clone(freshSession);
}

export async function replayScenario() {
    const session = appState.activeTrainingSession;
    if (!session) {
        return startSimulation(appState.trainingSelectedScenarioId || trainingScenarios[0]?.id || null);
    }

    const scenario = getTrainingScenarioById(session.scenarioId);
    if (!scenario) {
        throw new Error("Scenario not found.");
    }

    clearTrainingState();
    const replaySession = initialiseSession(scenario, `${scenario.title} Replay`, session.speed);
    queueScenarioEvents(replaySession);
    syncSessionState(replaySession);
    eventBus.emit(events.SIMULATION_STARTED, clone(replaySession));
    eventBus.emit(events.SIMULATION_UPDATED, clone(replaySession));
    return clone(replaySession);
}

export async function acknowledgeSimulationEvent(eventId) {
    const session = appState.activeTrainingSession;
    if (!session || !eventId) {
        return null;
    }

    const feedEntry = session.feed.find((entry) => entry.id === eventId);
    if (!feedEntry || feedEntry.acknowledged) {
        return clone(session);
    }

    feedEntry.acknowledged = true;
    feedEntry.acknowledgedAt = session.currentSimTime.toISOString();
    const responseSeconds = Math.max(0, Math.round((session.currentSimTime.getTime() - new Date(feedEntry.occurredAt).getTime()) / 1000));
    feedEntry.responseSeconds = responseSeconds;

    if (feedEntry.targetResponseMinutes && responseSeconds <= feedEntry.targetResponseMinutes * 60) {
        session.score.onTimeResponses += 1;
    } else {
        session.score.lateResponses += 1;
    }

    session.score.acknowledgedEvents += 1;
    const acknowledgedCount = session.score.acknowledgedEvents;
    const previousAverage = session.score.averageResponseSeconds;
    session.score.averageResponseSeconds = acknowledgedCount === 1
        ? responseSeconds
        : Math.round(((previousAverage * (acknowledgedCount - 1)) + responseSeconds) / acknowledgedCount);

    recordFeedEntry(session, {
        id: `ack-${feedEntry.id}-${Date.now()}`,
        type: "operator_action",
        title: `Acknowledged: ${feedEntry.title}`,
        summary: `Operator acknowledged the alert in ${responseSeconds}s.`,
        severity: feedEntry.severity,
        source: "operator",
        minute: formatSimElapsedMinutes(session),
        occurredAt: session.currentSimTime.toISOString(),
        operatorAction: true,
        requiresAck: false,
        timelineKind: "operator_action",
        eventId: feedEntry.id,
        objectiveIds: feedEntry.objectiveIds || []
    });

    syncSessionState(session);
    eventBus.emit(events.SIMULATION_UPDATED, clone(session));
    return clone(session);
}

export async function injectSimAlert(alertData = {}) {
    const session = appState.activeTrainingSession;
    if (!session) {
        return null;
    }

    const injectedEvent = {
        id: `inject-${Date.now()}`,
        type: alertData.alertType || alertData.type || "event",
        title: alertData.title || "Injected Training Event",
        summary: alertData.message || alertData.summary || "Synthetic instructor injection.",
        severity: alertData.severity || "warning",
        source: "instructor",
        minute: formatSimElapsedMinutes(session),
        occurredAt: session.currentSimTime.toISOString(),
        assetIds: [alertData.primaryId, alertData.secondaryId].filter(Boolean),
        requiresAck: alertData.requiresAck !== false,
        targetResponseMinutes: alertData.targetResponseMinutes || 10,
        objectiveIds: alertData.objectiveIds || [],
        visualKind: alertData.visual?.kind || "marker",
        visual: alertData.visual || {
            kind: "marker",
            position: alertData.position || null,
            label: alertData.title || "Injected Event"
        },
        eventId: `inject-${Date.now()}`
    };

    const record = recordFeedEntry(session, injectedEvent);
    drawTrainingOverlay(record);
    markObjectivesComplete(session, injectedEvent.objectiveIds);
    syncSessionState(session);
    eventBus.emit(events.SIMULATION_UPDATED, clone(session));
    return clone(record);
}

export async function loadHistoricalReplay(startTime, endTime, filter = {}) {
    const session = appState.activeTrainingSession;
    const scenario = session ? getTrainingScenarioById(session.scenarioId) : null;
    if (!scenario) {
        return { message: "No active training scenario to replay.", count: 0 };
    }

    const start = startTime ? new Date(startTime) : new Date(scenario.startTime);
    const end = endTime ? new Date(endTime) : new Date(start.getTime() + (scenario.durationMinutes || 60) * 60000);
    const selectedItems = scenario.timeline.filter((item) => {
        const absolute = new Date(new Date(scenario.startTime).getTime() + (item.minute || 0) * 60000);
        if (absolute < start || absolute > end) {
            return false;
        }

        if (filter.type && item.type !== filter.type) {
            return false;
        }

        return true;
    });

    session.timelineEntries = selectedItems.map((item) => ({
        id: item.id || `${scenario.id}:${item.minute}`,
        type: item.type,
        title: item.title,
        summary: item.summary,
        severity: item.severity || "info",
        source: "replay",
        minute: item.minute,
        occurredAt: new Date(new Date(scenario.startTime).getTime() + (item.minute || 0) * 60000).toISOString(),
        operatorAction: false,
        acknowledged: false,
        responseSeconds: null,
        timelineKind: item.kind || "event",
        objectiveIds: item.objectiveIds || []
    }));

    session.feed = [...session.timelineEntries];
    syncSessionState(session);
    eventBus.emit(events.SIMULATION_UPDATED, clone(session));
    return {
        message: `Loaded ${selectedItems.length} timeline entries into the sandbox replay.`,
        count: selectedItems.length
    };
}
