import { appState } from "../../state.js";
import { setStatus } from "../../ui.js";
import { ListenerScope } from "../../ui/panelSystem.js";
import { eventBus, events } from "../eventBus.js";
import * as simService from "../../simulationService.js";
import { escapeHtml, formatDateTime, formatNumber } from "../../utils.js";

const SPEED_OPTIONS = [1, 5, 10, 50, 100];

const EVENT_TYPES = [
    { value: "conjunction", label: "Conjunction Alert" },
    { value: "manoeuvre", label: "Manoeuvre Alert" },
    { value: "uct", label: "Unknown Object" },
    { value: "communication_loss", label: "Communication Loss" },
    { value: "reentry", label: "Re-entry Alert" },
    { value: "sensor_blackout", label: "Sensor Blackout" },
    { value: "surveillance_pass", label: "Adversary Pass" }
];

const FILTER_OPTIONS = [
    { value: "all", label: "All Scenarios" },
    { value: "historical", label: "Historical" },
    { value: "synthetic", label: "Synthetic" }
];

let sidebarScope = new ListenerScope();
let busScope = new ListenerScope();
let tickHandle = null;

function getScenarios() {
    return Array.isArray(appState.trainingScenarioLibrary) ? appState.trainingScenarioLibrary : [];
}

function getSelectedScenario() {
    const scenarios = getScenarios();
    if (!scenarios.length) {
        return null;
    }

    const selectedId = appState.trainingSelectedScenarioId || scenarios[0].id;
    return scenarios.find((scenario) => scenario.id === selectedId) || scenarios[0];
}

function getActiveSession() {
    return appState.activeTrainingSession;
}

function formatMinutes(minuteValue) {
    if (!Number.isFinite(minuteValue)) {
        return "--";
    }

    if (minuteValue < 1) {
        return "T+0m";
    }

    return `T+${Math.round(minuteValue)}m`;
}

function formatProgress(elapsedMinutes, durationMinutes) {
    if (!Number.isFinite(elapsedMinutes) || !Number.isFinite(durationMinutes) || durationMinutes <= 0) {
        return 0;
    }

    return Math.max(0, Math.min(100, (elapsedMinutes / durationMinutes) * 100));
}

function countCompletedObjectives(session) {
    if (!session || !Array.isArray(session.objectives)) {
        return 0;
    }
    return session.objectives.filter((objective) => objective.status === "complete").length;
}

function getScenarioFilter() {
    return appState.trainingLibraryFilter || "all";
}

function getVisibleScenarios() {
    const filter = getScenarioFilter();
    const scenarios = getScenarios();
    if (filter === "all") {
        return scenarios;
    }
    return scenarios.filter((scenario) => scenario.type === filter);
}

function getEventTypeLabel(value) {
    return EVENT_TYPES.find((item) => item.value === value)?.label || "Training Event";
}

function buildScenarioPreview(scenario, isSelected, isActive) {
    const stateLabel = isActive ? "Active Exercise" : (scenario.type === "historical" ? "Historical Replay" : "Synthetic Scenario");
    const stateClass = isActive ? "success" : (scenario.type === "historical" ? "warning" : "badge-info");
    const assets = Array.isArray(scenario.participatingAssets) ? scenario.participatingAssets : [];

    return `
        <div class="list-item ${isSelected ? "success" : ""}" data-scenario-id="${escapeHtml(scenario.id)}" style="cursor:pointer;">
            <div class="alert-title-row" style="margin-bottom:6px;">
                <strong>${escapeHtml(scenario.title)}</strong>
                <span class="badge badge-${isSelected ? "success" : "info"}">${escapeHtml(scenario.difficulty)}</span>
            </div>
            <div class="badge-row" style="margin-bottom: 8px;">
                <span class="badge ${stateClass === "badge-info" ? "badge-info" : `badge-${stateClass}`}" style="margin-right:6px;">${escapeHtml(stateLabel)}</span>
                <span class="badge badge-outline">${escapeHtml(scenario.category)}</span>
                <span class="badge badge-outline">${escapeHtml(`${scenario.durationMinutes} min`)}</span>
            </div>
            <div class="hint" style="margin-bottom: 8px;">${escapeHtml(scenario.description)}</div>
            <div class="readout" style="margin-bottom: 8px;">
                <strong>Assets:</strong> ${escapeHtml(assets.join(", ") || "None")}
            </div>
            <div class="split">
                <button type="button" class="secondary" data-load-scenario="${escapeHtml(scenario.id)}">Load Scenario</button>
                <button type="button" class="secondary" data-preview-scenario="${escapeHtml(scenario.id)}">Preview</button>
            </div>
        </div>
    `;
}

function renderScenarioList() {
    const activeSession = getActiveSession();
    const selectedScenario = getSelectedScenario();
    const scenarios = getVisibleScenarios();

    if (!scenarios.length) {
        return `<div class="hint">No scenarios match the current filter.</div>`;
    }

    return scenarios.map((scenario) => buildScenarioPreview(
        scenario,
        selectedScenario?.id === scenario.id,
        activeSession?.scenarioId === scenario.id
    )).join("");
}

function renderScenarioDetail() {
    const selectedScenario = getSelectedScenario();
    const activeSession = getActiveSession();

    if (!selectedScenario) {
        return `<div class="micro-card">No scenario selected.</div>`;
    }

    const planCount = Array.isArray(selectedScenario.timeline) ? selectedScenario.timeline.length : 0;
    const objectives = Array.isArray(selectedScenario.objectives) ? selectedScenario.objectives : [];
    const assets = Array.isArray(selectedScenario.participatingAssets) ? selectedScenario.participatingAssets : [];
    const activeLabel = activeSession?.scenarioId === selectedScenario.id ? "Currently loaded" : "Ready to load";

    return `
        <div class="micro-card">
            <div class="badge-row" style="margin-bottom:8px;">
                <span class="badge ${selectedScenario.type === "historical" ? "badge-warning" : "badge-info"}">${escapeHtml(selectedScenario.type.toUpperCase())}</span>
                <span class="badge badge-outline">${escapeHtml(selectedScenario.category)}</span>
                <span class="badge badge-outline">${escapeHtml(selectedScenario.difficulty)}</span>
            </div>
            <strong style="display:block; margin-bottom:6px;">${escapeHtml(selectedScenario.title)}</strong>
            <div class="hint" style="margin-bottom:8px;">${escapeHtml(selectedScenario.description)}</div>
            <div class="readout" style="margin-bottom:8px;">
                <strong>${escapeHtml(activeLabel)}</strong><br>
                Duration: ${escapeHtml(`${selectedScenario.durationMinutes} minutes`)}<br>
                Timeline items: ${planCount}<br>
                Participating assets: ${escapeHtml(assets.join(", ") || "None")}
            </div>
            <div class="readout">
                <strong>Training Objectives</strong><br>
                ${objectives.map((objective) => `- ${escapeHtml(objective.label)}`).join("<br>")}
            </div>
        </div>
    `;
}

function renderStatusPanel() {
    const session = getActiveSession();
    const scenario = session ? session.scenario : getSelectedScenario();

    if (!scenario) {
        return `<div class="micro-card">No scenario loaded.</div>`;
    }

    const elapsedMinutes = session ? (session.currentSimTime.getTime() - session.startTime.getTime()) / 60000 : 0;
    const completion = session ? formatProgress(elapsedMinutes, Number(scenario.durationMinutes)) : 0;
    const objectives = Array.isArray(session?.objectives) ? session.objectives : (Array.isArray(scenario.objectives) ? scenario.objectives.map((objective) => ({ ...objective, status: "pending" })) : []);
    const completedObjectives = session ? countCompletedObjectives(session) : 0;
    const score = session?.score || { triggeredEvents: 0, acknowledgedEvents: 0, onTimeResponses: 0, lateResponses: 0, averageResponseSeconds: 0 };
    const nextEvent = session
        ? (scenario.timeline || []).find((item) => item.minute > elapsedMinutes)
        : (scenario.timeline || [])[0];

    return `
        <div class="metric-grid" style="margin-bottom:12px;">
            <div class="metric-card">
                <div class="label">Mission Mode</div>
                <div class="value" style="font-size:18px;">${escapeHtml(session ? "Isolated Sandbox" : "Live Ready")}</div>
            </div>
            <div class="metric-card">
                <div class="label">Progress</div>
                <div class="value" style="font-size:18px;">${escapeHtml(completion.toFixed(0))}%</div>
            </div>
            <div class="metric-card">
                <div class="label">Objectives</div>
                <div class="value" style="font-size:18px;">${completedObjectives}/${objectives.length || 0}</div>
            </div>
            <div class="metric-card">
                <div class="label">Ack Rate</div>
                <div class="value" style="font-size:18px;">${score.triggeredEvents ? escapeHtml(Math.round((score.acknowledgedEvents / Math.max(1, score.triggeredEvents)) * 100).toString()) : "0"}%</div>
            </div>
        </div>
        <div class="list">
            <div class="list-item ${session ? "success" : "warning"}">
                <strong>${escapeHtml(session ? session.sessionName : `${scenario.title} Preview`)}</strong>
                ${escapeHtml(session ? "Sandbox clock is isolated from live operations." : "Select this scenario and load it into the sandbox to rehearse it.")}<br>
                <small>${escapeHtml(`Difficulty: ${scenario.difficulty} | Duration: ${scenario.durationMinutes} min | Type: ${scenario.type}`)}</small>
            </div>
            <div class="list-item">
                <strong>Next Event</strong>
                ${escapeHtml(nextEvent ? `${formatMinutes(nextEvent.minute)} - ${nextEvent.title}` : "No additional planned events.")}<br>
                <small>${escapeHtml(nextEvent ? nextEvent.summary : "The exercise timeline is complete.")}</small>
            </div>
            <div class="list-item ${session ? "success" : "warning"}">
                <strong>Scorecard</strong>
                Triggered: ${score.triggeredEvents || 0} | Acknowledged: ${score.acknowledgedEvents || 0} | On-time: ${score.onTimeResponses || 0} | Late: ${score.lateResponses || 0}<br>
                <small>Average response: ${score.averageResponseSeconds ? `${formatNumber(score.averageResponseSeconds, 0)}s` : "N/A"}</small>
            </div>
            ${session?.status === "completed" ? `
                <div class="list-item success">
                    <strong>Exercise Complete</strong>
                    The scenario has reached its final checkpoint. Use Replay Scenario to run it again, or Reset to return to the start and pause for debrief.
                </div>
            ` : ""}
        </div>
    `;
}

function buildSpeedButtons() {
    const session = getActiveSession();
    const activeSpeed = session?.speed || appState.simulationSpeed || 1;

    return SPEED_OPTIONS.map((speed) => `
        <button type="button" class="${activeSpeed === speed ? "primary" : "secondary"}" data-speed="${speed}">${speed}x</button>
    `).join("");
}

function buildEventTypeOptions() {
    return EVENT_TYPES.map((item) => `
        <option value="${escapeHtml(item.value)}">${escapeHtml(item.label)}</option>
    `).join("");
}

function buildTargetAssetOptions() {
    const scenario = getActiveSession()?.scenario || getSelectedScenario();
    const assets = Array.isArray(scenario?.participatingAssets) && scenario.participatingAssets.length
        ? scenario.participatingAssets
        : ["SENSOR-NET", "MISSION-TRACK", "UCT-001"];

    return assets.map((asset) => `<option value="${escapeHtml(asset)}">${escapeHtml(asset)}</option>`).join("");
}

function buildFilterButtons() {
    const filter = getScenarioFilter();
    return FILTER_OPTIONS.map((item) => `
        <button type="button" class="${filter === item.value ? "primary" : "secondary"}" data-scenario-filter="${escapeHtml(item.value)}">${escapeHtml(item.label)}</button>
    `).join("");
}

function renderFeedList() {
    const session = getActiveSession();
    if (!session) {
        return `<div class="hint">Start an exercise to see live event acknowledgements and instructor injections here.</div>`;
    }

    if (!Array.isArray(session.feed) || !session.feed.length) {
        return `<div class="hint">No active feed items yet. Scheduled scenario events will appear here as the clock advances.</div>`;
    }

    return session.feed.slice(0, 10).map((entry) => {
        const severityClass = entry.severity === "critical" ? "danger" : (entry.severity === "warning" ? "warning" : "success");
        const ackLabel = entry.acknowledged
            ? `Acknowledged in ${entry.responseSeconds || 0}s`
            : (entry.requiresAck ? "Awaiting operator acknowledgement" : "Informational");
        const ackButton = entry.requiresAck && !entry.acknowledged
            ? `<button type="button" class="secondary" data-ack-event="${escapeHtml(entry.id)}" style="margin-top:8px;">Acknowledge</button>`
            : "";

        return `
            <div class="list-item ${severityClass}" style="line-height:1.45;">
                <strong>${escapeHtml(entry.title)}</strong>
                ${escapeHtml(entry.summary)}<br>
                <small>${escapeHtml(`${formatMinutes(entry.minute)} | ${entry.type.toUpperCase()} | ${ackLabel}`)}</small>
                ${ackButton}
            </div>
        `;
    }).join("");
}

function renderTimelineList() {
    const session = getActiveSession();
    const scenario = session ? session.scenario : getSelectedScenario();

    if (!scenario) {
        return `<div class="hint">No scenario loaded.</div>`;
    }

    const elapsedMinutes = session ? (session.currentSimTime.getTime() - session.startTime.getTime()) / 60000 : -1;
    const actualEntries = session ? [...(session.timelineEntries || [])].sort((a, b) => new Date(b.occurredAt) - new Date(a.occurredAt)) : [];
    const futurePlan = (scenario.timeline || []).filter((item) => item.minute > elapsedMinutes);

    const rows = [];
    if (actualEntries.length) {
        for (const entry of actualEntries) {
            const rowClass = entry.operatorAction ? "success" : (entry.severity === "critical" ? "danger" : (entry.severity === "warning" ? "warning" : ""));
            rows.push(`
                <div class="list-item ${rowClass}" style="line-height:1.4;">
                    <strong>${escapeHtml(entry.operatorAction ? "Operator Action" : entry.title)}</strong>
                    ${escapeHtml(entry.summary)}<br>
                    <small>${escapeHtml(`${formatMinutes(entry.minute)} | ${entry.source.toUpperCase()}${entry.acknowledged ? ` | ${Math.round(entry.responseSeconds || 0)}s response` : ""}`)}</small>
                </div>
            `);
        }
    }

    for (const item of futurePlan.slice(0, 6)) {
        rows.push(`
            <div class="list-item" style="opacity:0.65; border-left-color: rgba(111, 226, 255, 0.3);">
                <strong>${escapeHtml(item.kind === "checkpoint" ? `Checkpoint: ${item.title}` : item.title)}</strong>
                ${escapeHtml(item.summary)}<br>
                <small>${escapeHtml(`${formatMinutes(item.minute)} | Pending ${item.kind === "checkpoint" ? "checkpoint" : "scenario event"}`)}</small>
            </div>
        `);
    }

    return rows.join("");
}

function buildSidebar() {
    const session = getActiveSession();
    const selectedScenario = getSelectedScenario();
    const scenario = session?.scenario || selectedScenario;
    const modeLabel = session ? "Isolated Sandbox" : "Live Operational Mode";
    const modeClass = session ? "success" : "warning";

    return `
        <div class="section">
            <div class="section-title">Training Mission Rehearsal</div>
            <div class="micro-card">
                Dedicated practice mode instance loaded with historical and synthetic scenario data. The sandbox never writes to the live operational catalog or alert history.
            </div>
            <div class="readout" style="margin-top:8px;">
                <span class="badge badge-${modeClass}">${escapeHtml(modeLabel)}</span>
                <span class="badge badge-outline">${session ? "Frozen live state" : "Awaiting exercise load"}</span>
            </div>
        </div>

        <div class="section">
            <div class="section-title">Scenario Library</div>
            <div style="display:grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 10px; margin-bottom:10px;">
                ${buildFilterButtons()}
            </div>
            <div id="scenarioDetail">${renderScenarioDetail()}</div>
            <div class="list" id="scenarioList" style="max-height: 280px; overflow-y: auto; margin-top: 12px;">
                ${renderScenarioList()}
            </div>
        </div>

        <div class="section">
            <div class="section-title">Exercise Controls</div>
            <div class="split">
                <button type="button" id="startExerciseButton" class="primary">${session ? "Restart Selected Scenario" : "Start Exercise"}</button>
                <button type="button" id="pauseResumeButton" class="secondary" ${(session && session.status !== "completed") ? "" : "disabled"}>${appState.simulationPaused ? "Resume" : "Pause"}</button>
            </div>
            <div class="split">
                <button type="button" id="replayScenarioButton" class="secondary" ${session ? "" : "disabled"}>Replay Scenario</button>
                <button type="button" id="resetExerciseButton" class="secondary" ${session ? "" : "disabled"}>Reset</button>
            </div>
            <button type="button" id="exitSimulationButton" class="danger" ${session ? "" : "disabled"}>Exit Simulation</button>
        </div>

        <div class="section">
            <div class="section-title">Simulation Clock</div>
            <div class="metric-grid">
                <div class="metric-card">
                    <div class="label">Simulated Time</div>
                    <div class="value" id="simClockValue">${session ? formatDateTime(session.currentSimTime) : "Live clock"}</div>
                </div>
                <div class="metric-card">
                    <div class="label">Elapsed</div>
                    <div class="value" id="simElapsedValue">${session ? formatMinutes((session.currentSimTime.getTime() - session.startTime.getTime()) / 60000) : "T+0m"}</div>
                </div>
                <div class="metric-card">
                    <div class="label">Speed</div>
                    <div class="value" id="simSpeedValue">${session ? `${session.speed}x` : `${appState.simulationSpeed}x`}</div>
                </div>
                <div class="metric-card">
                    <div class="label">Acks</div>
                    <div class="value" id="simAckValue">${session ? session.score.acknowledgedEvents : 0}</div>
                </div>
            </div>
            <div class="section-title" style="margin-top: 12px;">Clock Multiplier</div>
            <div id="speedButtonRow" style="display:grid; grid-template-columns: repeat(5, minmax(0, 1fr)); gap: 10px;">
                ${buildSpeedButtons()}
            </div>
        </div>

        <div class="section">
            <div class="section-title">Event Injection Panel</div>
            <div class="field">
                <label for="trainingEventType">Synthetic Event Type</label>
                <select id="trainingEventType" class="field">
                    ${buildEventTypeOptions()}
                </select>
            </div>
            <div class="field">
                <label for="trainingTargetAsset">Target Asset</label>
                <select id="trainingTargetAsset" class="field">
                    ${buildTargetAssetOptions()}
                </select>
            </div>
            <div class="field">
                <label for="trainingInjectNote">Instructor Note</label>
                <input id="trainingInjectNote" class="search-input" type="text" placeholder="Optional note for the event log">
            </div>
            <button type="button" id="injectEventButton" class="secondary" ${session ? "" : "disabled"}>Inject Event</button>
        </div>

        <div class="section">
            <div class="section-title">Scenario Status Panel</div>
            <div id="scenarioStatusPanel">${renderStatusPanel()}</div>
        </div>

        <div class="section">
            <div class="section-title">Mission Timeline</div>
            <div id="missionTimeline" class="list">${renderTimelineList()}</div>
        </div>

        <div class="section">
            <div class="section-title">Active Exercise Feed</div>
            <div id="activeExerciseFeed" class="list">${renderFeedList()}</div>
        </div>
    `;
}

function updateClockReadouts() {
    const session = getActiveSession();
    const clock = document.getElementById("simClockValue");
    const elapsed = document.getElementById("simElapsedValue");
    const speed = document.getElementById("simSpeedValue");
    const ack = document.getElementById("simAckValue");
    const statusPanel = document.getElementById("scenarioStatusPanel");
    const timeline = document.getElementById("missionTimeline");
    const feed = document.getElementById("activeExerciseFeed");
    const pauseBtn = document.getElementById("pauseResumeButton");
    const startBtn = document.getElementById("startExerciseButton");
    const replayBtn = document.getElementById("replayScenarioButton");
    const resetBtn = document.getElementById("resetExerciseButton");
    const exitBtn = document.getElementById("exitSimulationButton");

    if (clock) {
        clock.textContent = session ? formatDateTime(session.currentSimTime) : "Live clock";
    }
    if (elapsed) {
        elapsed.textContent = session ? formatMinutes((session.currentSimTime.getTime() - session.startTime.getTime()) / 60000) : "T+0m";
    }
    if (speed) {
        speed.textContent = session ? `${session.speed}x` : `${appState.simulationSpeed}x`;
    }
    if (ack) {
        ack.textContent = session ? session.score.acknowledgedEvents : 0;
    }
    if (pauseBtn) {
        pauseBtn.textContent = appState.simulationPaused ? "Resume" : "Pause";
        pauseBtn.disabled = !session || session.status === "completed";
    }
    if (startBtn) {
        startBtn.textContent = session ? "Restart Selected Scenario" : "Start Exercise";
    }
    if (replayBtn) {
        replayBtn.disabled = !session;
    }
    if (resetBtn) {
        resetBtn.disabled = !session;
    }
    if (exitBtn) {
        exitBtn.disabled = !session;
    }
    if (statusPanel && session) {
        statusPanel.innerHTML = renderStatusPanel();
    }
}

function renderSidebar() {
    const root = document.getElementById("moduleSidebarRoot");
    if (!root) {
        return;
    }

    sidebarScope.dispose();
    sidebarScope = new ListenerScope();
    root.innerHTML = buildSidebar();

    sidebarScope.add(document.getElementById("startExerciseButton"), "click", async () => {
        const scenario = getSelectedScenario();
        if (!scenario) {
            setStatus("No training scenario is available.");
            return;
        }

        setStatus(`Loading sandbox scenario: ${scenario.title}`);
        try {
            await simService.startSimulation(scenario.id, scenario.title);
            setStatus(`Sandbox loaded: ${scenario.title}. The live catalog is frozen.`);
        } catch (error) {
            console.error("Failed to start training scenario:", error);
            setStatus("Failed to load the training scenario.");
        }
    });

    sidebarScope.add(document.getElementById("pauseResumeButton"), "click", async () => {
        const session = getActiveSession();
        if (!session) {
            return;
        }

        const nextStatus = appState.simulationPaused ? "active" : "paused";
        await simService.updateSimulationStatus({ status: nextStatus });
        setStatus(nextStatus === "active" ? "Simulation resumed." : "Simulation paused.");
    });

    sidebarScope.add(document.getElementById("replayScenarioButton"), "click", async () => {
        const session = getActiveSession();
        if (!session) {
            return;
        }

        setStatus(`Replaying scenario: ${session.scenario.title}`);
        await simService.replayScenario();
    });

    sidebarScope.add(document.getElementById("resetExerciseButton"), "click", async () => {
        const session = getActiveSession();
        if (!session) {
            return;
        }

        await simService.resetSimulation();
        setStatus("Sandbox reset to scenario start and paused.");
    });

    sidebarScope.add(document.getElementById("exitSimulationButton"), "click", async () => {
        await simService.stopSimulation();
        setStatus("Exited simulation mode. Returned to live operations.");
    });

    sidebarScope.add(document.getElementById("injectEventButton"), "click", async () => {
        const session = getActiveSession();
        if (!session) {
            return;
        }

        const eventType = document.getElementById("trainingEventType")?.value || "conjunction";
        const targetAsset = document.getElementById("trainingTargetAsset")?.value || session.scenario.participatingAssets?.[0] || "MISSION-ASSET";
        const note = document.getElementById("trainingInjectNote")?.value?.trim() || "";
        const scenarioTitle = session.scenario.title;

        const visual = buildInjectedVisual(eventType, targetAsset, session);
        await simService.injectSimAlert({
            alertType: eventType,
            title: `${getEventTypeLabel(eventType)} - Instructor Injection`,
            message: note || `Synthetic ${getEventTypeLabel(eventType).toLowerCase()} injected against ${targetAsset} during ${scenarioTitle}.`,
            severity: inferSeverity(eventType),
            primaryId: targetAsset,
            visual
        });
        setStatus(`Injected ${getEventTypeLabel(eventType)} against ${targetAsset}.`);
    });

    sidebarScope.addMany("[data-load-scenario]", "click", async (event) => {
        const scenarioId = event.currentTarget.dataset.loadScenario;
        if (!scenarioId) {
            return;
        }

        appState.trainingSelectedScenarioId = scenarioId;
        renderSidebar();
    });

    sidebarScope.addMany("[data-preview-scenario]", "click", async (event) => {
        const scenarioId = event.currentTarget.dataset.previewScenario;
        if (!scenarioId) {
            return;
        }

        appState.trainingSelectedScenarioId = scenarioId;
        renderSidebar();
        setStatus("Scenario preview updated.");
    });

    sidebarScope.addMany("[data-scenario-filter]", "click", async (event) => {
        const filter = event.currentTarget.dataset.scenarioFilter || "all";
        appState.trainingLibraryFilter = filter;
        renderSidebar();
    });

    sidebarScope.addMany("[data-speed]", "click", async (event) => {
        const speed = Number(event.currentTarget.dataset.speed);
        if (!Number.isFinite(speed)) {
            return;
        }

        await simService.updateSimulationStatus({ speed });
        setStatus(`Simulation speed set to ${speed}x.`);
    });

    sidebarScope.addMany("[data-ack-event]", "click", async (event) => {
        const feedId = event.currentTarget.dataset.ackEvent;
        if (!feedId) {
            return;
        }

        await simService.acknowledgeSimulationEvent(feedId);
        setStatus("Operator acknowledgement recorded.");
    });

    updateClockReadouts();
}

function buildInjectedVisual(eventType, targetAsset, session) {
    const baseLat = 12 + (session.feed.length % 10) * 1.6;
    const baseLon = 72 + (session.feed.length % 8) * 1.7;
    const assetLabel = targetAsset || "MISSION-ASSET";

    if (eventType === "conjunction") {
        return {
            kind: "conjunction",
            primaryPosition: { lat: baseLat, lon: baseLon, altKm: 700 },
            secondaryPosition: { lat: baseLat + 0.6, lon: baseLon + 0.8, altKm: 699.5 }
        };
    }

    if (eventType === "reentry") {
        return {
            kind: "reentry",
            corridor: [
                { lat: baseLat + 2.0, lon: baseLon - 2.0 },
                { lat: baseLat + 1.0, lon: baseLon + 0.5 },
                { lat: baseLat - 0.2, lon: baseLon + 2.4 },
                { lat: baseLat - 1.5, lon: baseLon + 4.0 }
            ]
        };
    }

    if (eventType === "sensor_blackout" || eventType === "communication_loss" || eventType === "blind_spot") {
        return {
            kind: "blackout",
            position: { lat: baseLat, lon: baseLon, altKm: 0 },
            radiusKm: eventType === "communication_loss" ? 650 : 900
        };
    }

    if (eventType === "surveillance_pass" || eventType === "manoeuvre" || eventType === "uct") {
        return {
            kind: "track",
            from: { lat: baseLat, lon: baseLon, altKm: eventType === "uct" ? 740 : 600 },
            to: { lat: baseLat + 1.2, lon: baseLon + 1.8, altKm: eventType === "uct" ? 744 : 605 },
            label: assetLabel
        };
    }

    return {
        kind: "marker",
        position: { lat: baseLat, lon: baseLon, altKm: 0 },
        label: `${assetLabel}`
    };
}

function inferSeverity(eventType) {
    if (eventType === "reentry" || eventType === "surveillance_pass") {
        return "critical";
    }
    if (eventType === "conjunction" || eventType === "manoeuvre" || eventType === "uct") {
        return "warning";
    }
    return "warning";
}

export default {
    id: "training-simulation",
    label: "Training & Simulation",
    eyebrow: "Training Mode",
    description: "Mission rehearsal sandbox for historical and synthetic SDA exercises.",
    dockEyebrow: "Training",
    dockLabel: "Simulation",
    status: "ready",
    async mount(ctx) {
        const scenarios = await simService.fetchScenarios();
        appState.trainingScenarioLibrary = scenarios;

        if (!appState.trainingSelectedScenarioId && scenarios.length) {
            appState.trainingSelectedScenarioId = scenarios[0].id;
        }

        renderSidebar();

        busScope.dispose();
        busScope = new ListenerScope();
        busScope.addCleanup(eventBus.on(events.SIMULATION_STARTED, () => {
            renderSidebar();
            setStatus("Training sandbox activated.");
        }));

        busScope.addCleanup(eventBus.on(events.SIMULATION_UPDATED, () => {
            renderSidebar();
        }));

        busScope.addCleanup(eventBus.on(events.SIMULATION_TICK, () => {
            updateClockReadouts();
        }));

        busScope.addCleanup(eventBus.on(events.SIMULATION_STOPPED, () => {
            renderSidebar();
        }));

        if (tickHandle) {
            clearInterval(tickHandle);
        }
        tickHandle = setInterval(() => {
            if (appState.simulationMode && !appState.simulationPaused) {
                simService.tickSimulation().catch((error) => {
                    console.warn("Training tick failed:", error);
                });
            }
        }, 150);

        setStatus("Training & Simulation ready. Choose a scenario to enter the isolated sandbox.");

        return {
            unmount() {
                if (tickHandle) {
                    clearInterval(tickHandle);
                    tickHandle = null;
                }
                sidebarScope.dispose();
                busScope.dispose();
                simService.stopSimulation().catch((error) => {
                    console.warn("Failed to stop training sandbox cleanly:", error);
                });
            }
        };
    }
};
