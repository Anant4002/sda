import { appState } from "../../state.js";
import { setStatus, renderReentryIntelligence, renderAnalysisLoader } from "../../ui.js";
import { escapeHtml, formatNumber, formatDateTime } from "../../utils.js";
import { ListenerScope } from "../../ui/panelSystem.js";
import { eventBus, events } from "../eventBus.js";
import { drawReentrySimulation, clearReentrySimulation } from "../../viewer.js";
import { elements } from "../../dom.js";

function buildSidebar() {
    return `
        <div class="section">
            <div class="section-title">Re-entry Analysis</div>
            <div class="micro-card">
                Monitors orbital decay and simulates atmospheric re-entry using drag-based models to predict impact corridors near strategic installations.
            </div>
        </div>
        <div class="section">
            <div class="section-title">Target Selection</div>
            <div class="micro-card">
                Select a decaying object (< 300km perigee) to run a high-fidelity re-entry simulation.
            </div>
            <div id="reentrySelectionStatus" class="readout" style="margin-top:8px;">
                No satellite selected.
            </div>
            <button id="reentryRunButton" class="primary" style="margin-top:12px;" disabled type="button">Run Re-entry Predictor</button>
        </div>
    `;
}

export default {
    id: "reentry-analysis",
    label: "Re-entry Analysis",
    eyebrow: "Atmospheric Prediction",
    description: "Analyse space objects whose orbits are decaying and which may re-enter near strategic installations.",
    dockEyebrow: "Predictions",
    dockLabel: "Re-entry",
    status: "ready",
    mount(ctx) {
        const root = ctx.containers.sidebarRoot;
        root.innerHTML = buildSidebar();

        const selectionStatus = document.getElementById("reentrySelectionStatus");
        const runButton = document.getElementById("reentryRunButton");

        const scope = new ListenerScope();

        const updateSelection = () => {
            if (appState.activeSatellitePathId) {
                selectionStatus.innerHTML = `Target: <strong>${escapeHtml(appState.activeSatellitePathId)}</strong>`;
                runButton.disabled = false;
            } else {
                selectionStatus.textContent = "No satellite selected.";
                runButton.disabled = true;
                clearReentrySimulation();
            }
        };

        updateSelection();

        const offSelected = eventBus.on(events.satelliteSelected, updateSelection);
        const offCleared = eventBus.on(events.satelliteCleared, updateSelection);

        scope.add(runButton, "click", async () => {
            if (appState.analysisInFlight) {
                setStatus("Error: An analysis is already in progress.");
                return;
            }
            const satelliteId = appState.activeSatellitePathId;
            if (!satelliteId) return;

            appState.analysisInFlight = true;
            runButton.disabled = true;
            runButton.textContent = "Simulating Re-entry...";
            setStatus(`Running high-fidelity re-entry simulation for ${satelliteId}...`);
            renderAnalysisLoader("Re-entry Drag Forecast", "Running high-fidelity drag-based decay simulation and checking tactical installations...");

            try {
                const { payload } = await ctx.shared.postJsonWithFallback("/api/analysis/reentry-prediction", {
                    satelliteName: satelliteId,
                    limit: 100
                });

                // Render on 3D Globe
                drawReentrySimulation(payload);

                // Render detailed report in Right Command & Control Panel
                renderReentryIntelligence(payload);
                
                setStatus(`Re-entry simulation complete for ${satelliteId}.`);
                await ctx.shared.refreshOperationalAlerts();
            } catch (error) {
                if (elements.analysisPanel) {
                    elements.analysisPanel.innerHTML = `<div class="list-item danger"><strong>Error:</strong> ${escapeHtml(error.message)}</div>`;
                }
                setStatus("Re-entry simulation failed.");
            } finally {
                appState.analysisInFlight = false;
                runButton.disabled = false;
                runButton.textContent = "Run Re-entry Predictor";
            }
        });

        return {
            unmount() {
                offSelected();
                offCleared();
                scope.dispose();
                clearReentrySimulation();
            }
        };
    }
};

