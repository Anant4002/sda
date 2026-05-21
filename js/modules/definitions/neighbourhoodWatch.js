import { fetchBackendNeighbourhoodWatch } from "../../analysisService.js";
import { NEIGHBOURHOOD_WATCH_THRESHOLD_KM } from "../../config.js";
import { appState } from "../../state.js";
import { setStatus } from "../../ui.js";
import { escapeHtml, formatDateTime, formatNumber } from "../../utils.js";
import { field, selectControl, ListenerScope } from "../../ui/panelSystem.js";
import { eventBus, events } from "../eventBus.js";
import { drawProximityAlerts, clearProximityAlerts } from "../../viewer.js";

const THRESHOLD_OPTIONS = [
    { value: "50", label: "50 km" },
    { value: "250", label: "250 km" },
    { value: "500", label: "500 km", selected: true },
    { value: "1000", label: "1000 km" },
    { value: "2000", label: "2000 km" }
];

function buildSidebar() {
    return `
        <div class="section">
            <div class="section-title">Screening Scope</div>
            <div class="field">
                <label for="neighbourhoodWatchSelect">Asset Selection</label>
                <select id="neighbourhoodWatchSelect">
                    <option value="">Global (All Indian Assets)</option>
                </select>
                <div class="readout" style="margin-top: 5px; font-size: 0.85em;">
                    Selecting 'Global' will screen every Indian satellite against the full catalog.
                </div>
            </div>
            ${field("Proximity Threshold", selectControl("neighbourhoodThresholdSelect", THRESHOLD_OPTIONS), { id: "neighbourhoodThresholdSelect" })}
            <button id="neighbourhoodWatchRunButton" type="button">Execute Neighbourhood Watch</button>
        </div>
        <div class="section">
            <div class="section-title">Proximity Event Log</div>
            <div id="neighbourhoodWatchSummary" class="micro-card">Configure screening scope and threshold to begin.</div>
            <div id="neighbourhoodWatchList" class="list"></div>
        </div>
    `;
}

function populateSatelliteOptions() {
    const select = document.getElementById("neighbourhoodWatchSelect");
    if (!select) return;
    
    const indianSatellites = (appState.satellites || []).filter((satellite) => satellite.isIndian);
    
    // Always keep the Global option
    let html = `<option value="">Global (All Indian Assets)</option>`;
    html += indianSatellites.map((satellite) => 
        `<option value="${escapeHtml(satellite.name)}">${escapeHtml(satellite.name)}</option>`
    ).join("");
    
    select.innerHTML = html;
}

function renderResult(result) {
    const summary = document.getElementById("neighbourhoodWatchSummary");
    const list = document.getElementById("neighbourhoodWatchList");
    if (!summary || !list) return;

    if (!result || !Array.isArray(result.alerts) || !result.alerts.length) {
        summary.textContent = "No proximity events detected within the selected threshold.";
        list.innerHTML = "";
        clearProximityAlerts();
        return;
    }

    const scopeText = result.isGlobal ? "All Indian Assets" : result.primaryId;
    summary.textContent = `${result.alerts.length} events detected within ${formatNumber(result.thresholdKm, 0)} km of ${scopeText}.`;

    // Render Globe Markers
    drawProximityAlerts(result.alerts);

    // Sortable-like list (already sorted by distance from backend)
    list.innerHTML = result.alerts.map((alert) => {
        const severityClass = alert.severity === "critical" ? "danger" : "warning";
        return `
            <div class="list-item ${severityClass}">
                <div style="display: flex; justify-content: space-between; align-items: flex-start;">
                    <strong>${escapeHtml(alert.primaryId)} ↔ ${escapeHtml(alert.secondaryId)}</strong>
                    <span class="badge ${alert.severity === "critical" ? "badge-danger" : "badge-warning"}">${alert.severity.toUpperCase()}</span>
                </div>
                <div style="font-size: 0.9em; margin-top: 5px; color: var(--text-dim);">
                    Distance: <strong>${formatNumber(alert.closestDistanceKm, 2)} km</strong><br>
                    Relative Velocity: ${Number.isFinite(alert.relativeVelocityKmS) ? `${formatNumber(alert.relativeVelocityKmS, 3)} km/s` : "N/A"}<br>
                    Time (UTC): ${formatDateTime(alert.time)}
                </div>
            </div>
        `;
    }).join("");
}

function runWatch(ctx) {
    const select = document.getElementById("neighbourhoodWatchSelect");
    const thresholdSelect = document.getElementById("neighbourhoodThresholdSelect");
    
    const satelliteId = select ? select.value : ""; // Empty string means ALL
    const thresholdKm = Number(thresholdSelect?.value || 500);

    setStatus(`Initializing Neighbourhood Watch for ${satelliteId || "All Indian Assets"}...`);
    
    fetchBackendNeighbourhoodWatch({
        satelliteId, // Backend now handles empty/null as "All Indian"
        thresholdKm,
        time: Cesium.JulianDate.toDate(ctx.shared.viewer.clock.currentTime).toISOString()
    }, appState.catalogApiBaseUrl).then(async (response) => {
        renderResult(response.result);
        await ctx.shared.refreshOperationalAlerts(response.apiBaseUrl);
        setStatus(`Screening complete. ${response.result.alerts?.length || 0} events identified.`);
    }).catch((error) => {
        ctx.shared.handleAnalysisFailure("Neighbourhood watch", error?.message || "Unknown backend analysis error.");
    });
}

export default {
    id: "neighbourhood-watch",
    label: "Neighbourhood Watch",
    eyebrow: "Proximity Operations",
    description: "Screen proximity events for Indian assets against the full catalog.",
    dockEyebrow: "Proximity",
    dockLabel: "Neighbourhood",
    status: "ready",
    mount(ctx) {
        const root = ctx.containers.sidebarRoot;
        root.innerHTML = buildSidebar();
        populateSatelliteOptions();

        const scope = new ListenerScope();
        scope.add(document.getElementById("neighbourhoodWatchRunButton"), "click", () => runWatch(ctx));
        scope.addCleanup(eventBus.on(events.catalogReady, () => populateSatelliteOptions()));

        setStatus("Neighbourhood Watch module active. Configure scope and threshold.");
        return {
            unmount() {
                clearProximityAlerts();
                scope.dispose();
            }
        };
    }
};
