import { appState } from "../../state.js";
import { setStatus, renderReentryIntelligence } from "../../ui.js";
import { escapeHtml, formatNumber, formatDateTime } from "../../utils.js";
import { ListenerScope } from "../../ui/panelSystem.js";
import { eventBus, events } from "../eventBus.js";
import { drawReentrySimulation, clearReentrySimulation } from "../../viewer.js";

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
        <div id="reentryResultContainer" class="section" style="display:none;">
            <div class="section-title">Prediction Output</div>
            <div id="reentryReadout" class="readout"></div>
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
        const resultContainer = document.getElementById("reentryResultContainer");
        const readout = document.getElementById("reentryReadout");

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
            const satelliteId = appState.activeSatellitePathId;
            if (!satelliteId) return;

            resultContainer.style.display = "none";
            runButton.disabled = true;
            runButton.textContent = "Simulating Re-entry...";
            setStatus(`Running high-fidelity re-entry simulation for ${satelliteId}...`);

            try {
                const { payload } = await ctx.shared.postJsonWithFallback("/api/analysis/reentry-prediction", {
                    satelliteName: satelliteId,
                    limit: 100
                });

                resultContainer.style.display = "block";
                
                const getRiskClass = (level) => {
                    const l = (level || "LOW").toUpperCase();
                    if (l === "HIGH") return "danger";
                    if (l === "ELEVATED") return "warning";
                    if (l === "MONITOR") return "monitor";
                    return "success";
                };

                const riskClass = getRiskClass(payload.riskLevel);
                const hasStrategicRisk = payload.strategicRisks && payload.strategicRisks.length > 0;
                
                readout.innerHTML = `
                    <div class="list-item ${riskClass}" style="line-height: 1.5;">
                        <div style="margin-bottom: 8px;">
                            <span style="color: var(--text-dim);">Impact Window:</span><br>
                            <strong>${payload.status === "stable" ? "Stable (No Risk)" : (payload.estimatedReentryDate ? formatDateTime(payload.estimatedReentryDate).split(',')[0] : "N/A")}</strong>
                        </div>

                        <div style="margin-bottom: 8px;">
                            <span style="color: var(--text-dim);">Estimated Time Remaining:</span><br>
                            <strong style="color: var(--severity-danger); font-size: 1.2em;">${payload.timeToImpact || "N/A"}</strong>
                        </div>

                        <div style="margin-bottom: 8px;">
                            <span style="color: var(--text-dim);">India-Specific Assessment:</span><br>
                            <strong style="color: ${payload.strategicRisks?.length > 0 ? 'var(--severity-danger)' : 'inherit'};">
                                ${payload.indiaSpecificRisk || "Scanning corridor..."}
                            </strong>
                        </div>
                        
                        <div style="margin-bottom: 8px;">
                            <span style="color: var(--text-dim);">Perigee:</span><br>
                            <strong>${payload.currentPerigeeKm ? formatNumber(payload.currentPerigeeKm, 1) + " km" : "N/A"}</strong>
                        </div>

                        <div style="margin-bottom: 8px;">
                            <span style="color: var(--text-dim);">Risk Level:</span><br>
                            <span class="badge badge-${riskClass}">${escapeHtml(payload.riskLevel || "LOW")}</span>
                        </div>

                        <div style="margin-bottom: 8px;">
                            <span style="color: var(--text-dim);">Simulation Info:</span><br>
                            <small>${escapeHtml(payload.message)}</small>
                        </div>
                    </div>
                `;

                // Render on 3D Globe
                drawReentrySimulation(payload);

                // Render detailed report
                renderReentryIntelligence(payload);
                
                setStatus(`Re-entry simulation complete for ${satelliteId}.`);
                await ctx.shared.refreshOperationalAlerts();
            } catch (error) {
                readout.innerHTML = `<div class="list-item danger"><strong>Error:</strong> ${escapeHtml(error.message)}</div>`;
                resultContainer.style.display = "block";
                setStatus("Re-entry simulation failed.");
            } finally {
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

