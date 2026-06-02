import { fetchBackendNeighbourhoodWatch } from "../../analysisService.js";
import { 
    NEIGHBOURHOOD_WATCH_THRESHOLD_KM,
    NEIGHBOURHOOD_WATCH_WARNING_KM,
    NEIGHBOURHOOD_WATCH_CRITICAL_KM
} from "../../config.js";
import { appState } from "../../state.js";
import { setStatus, renderAnalysisLoader } from "../../ui.js";
import { escapeHtml, formatDateTime, formatNumber } from "../../utils.js";
import { field, selectControl, ListenerScope } from "../../ui/panelSystem.js";
import { eventBus, events } from "../eventBus.js";
import { drawProximityAlerts, clearProximityAlerts } from "../../viewer.js";

const THRESHOLD_OPTIONS = [
    { value: "100", label: "100 km (Critical Only)" },
    { value: "250", label: "250 km (Warning Only)" },
    { value: "500", label: "500 km", selected: true },
    { value: "1000", label: "1000 km" },
    { value: "2000", label: "2000 km" }
];

let currentResult = null; // Store full results for client-side advanced filtering

function buildSidebar() {
    return `
        <div class="section">
            <div class="section-title">Screening Scope</div>
            <div class="field">
                <label for="neighbourhoodWatchSelect">Asset Selection</label>
                <select id="neighbourhoodWatchSelect">
                    <option value="">Global (All Indian Assets)</option>
                </select>
                <div class="readout" style="margin-top: 5px; font-size: 0.85em; line-height: 1.4;">
                    Selecting 'Global' will screen every Indian satellite against the full catalog.
                </div>
            </div>
            ${field("Proximity Threshold", selectControl("neighbourhoodThresholdSelect", THRESHOLD_OPTIONS), { id: "neighbourhoodThresholdSelect" })}
            
            <button id="neighbourhoodWatchRunButton" class="primary" style="margin-top: 12px; width: 100%;">Execute Neighbourhood Watch</button>
        </div>


        <div class="section">
            <div class="section-title">Proximity Severity Reference</div>
            <div class="micro-card" style="font-size: 11px; line-height: 1.4;">
                <div style="display: flex; align-items: center; gap: 6px; margin-bottom: 2px;">
                    <span class="badge badge-danger" style="min-width: 60px;">Critical</span> <span>&lt; ${NEIGHBOURHOOD_WATCH_CRITICAL_KM} km</span>
                </div>
                <div style="display: flex; align-items: center; gap: 6px; margin-bottom: 2px;">
                    <span class="badge badge-warning" style="min-width: 60px;">Warning</span> <span>&lt; ${NEIGHBOURHOOD_WATCH_WARNING_KM} km</span>
                </div>
                <div style="display: flex; align-items: center; gap: 6px;">
                    <span class="badge badge-info" style="min-width: 60px;">Routine</span> <span>&lt; ${NEIGHBOURHOOD_WATCH_THRESHOLD_KM} km</span>
                </div>
            </div>
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

function runWatch(ctx) {
    const select = document.getElementById("neighbourhoodWatchSelect");
    const thresholdSelect = document.getElementById("neighbourhoodThresholdSelect");
    
    const satelliteId = select ? select.value : ""; // Empty string means ALL
    const thresholdKm = Number(thresholdSelect?.value || 500);

    // Display a professional orbital calculation loader spinner
    renderAnalysisLoader("Neighbourhood Watch", "Screening Indian assets against catalog items for close-approaches...");
    
    fetchBackendNeighbourhoodWatch({
        satelliteId,
        thresholdKm,
        time: Cesium.JulianDate.toDate(ctx.shared.viewer.clock.currentTime).toISOString()
    }, appState.catalogApiBaseUrl).then(async (response) => {
        currentResult = response.result;
        
        // Draw Globe markers matching initial set
        drawProximityAlerts(currentResult.alerts || []);

        // Call right-hand panel renderer
        if (typeof ctx.shared.renderNeighbourhoodWatchAnalysis === "function") {
            ctx.shared.renderNeighbourhoodWatchAnalysis(currentResult);
        }

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

        currentResult = null; // Clear old sessions

        const scope = new ListenerScope();
        scope.add(document.getElementById("neighbourhoodWatchRunButton"), "click", () => runWatch(ctx));
        scope.addCleanup(eventBus.on(events.catalogReady, () => populateSatelliteOptions()));


        setStatus("Neighbourhood Watch module active. Configure scope and threshold.");
        return {
            unmount() {
                clearProximityAlerts();
                currentResult = null;
                scope.dispose();
            }
        };
    }
};
