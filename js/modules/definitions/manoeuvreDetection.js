import { appState } from "../../state.js";
import { setStatus } from "../../ui.js";
import { escapeHtml } from "../../utils.js";
import { fetchBackendManoeuvreDetection } from "../../analysisService.js";
import { ListenerScope } from "../../ui/panelSystem.js";
import { eventBus, events } from "../eventBus.js";

function buildSidebar() {
    return `
        <div class="section">
            <div class="section-title">Orbital Drift Timeline</div>
            <div id="driftContextNotice" class="micro-card warning" style="margin-bottom: 12px;">
                Select a satellite from the catalog to enable focused drift analysis.
            </div>
            
            <div id="driftControls" style="display: none;">
                <div class="micro-card" style="margin-bottom: 12px;">
                    Target: <strong id="driftTargetLabel" style="color: var(--text-bright);">None</strong><br>
                    Layered historical trajectories visualize orbital evolution over time.
                </div>

                <div style="display: flex; flex-direction: column; gap: 12px; margin-bottom: 16px;">
                    <div style="display: flex; gap: 8px;">
                        <select id="driftDurationSelect" style="flex: 1;">
                            <option value="3">3 Days</option>
                            <option value="5" selected>5 Days</option>
                            <option value="7">7 Days</option>
                        </select>
                        <button id="driftRunButton" class="primary" type="button" style="flex: 2;">Show Drift Evolution</button>
                    </div>

                    <div class="field-row" style="display: flex; align-items: center; justify-content: space-between; background: rgba(255,255,255,0.05); padding: 8px; border-radius: 4px;">
                        <label for="driftMagnificationToggle" style="font-size: 0.85em; cursor: pointer;">Drift Magnification Mode</label>
                        <input type="checkbox" id="driftMagnificationToggle" style="cursor: pointer;">
                    </div>
                    <div style="font-size: 0.75em; color: var(--text-dim); margin-top: -8px;">Visually amplifies separation between historical rings for easier analysis.</div>
                </div>

                <button id="driftExitFocusButton" class="secondary" type="button" style="width: 100%; margin-bottom: 12px; display: none;">Exit Focus Mode</button>

        <div id="driftIntelligence" class="micro-card" style="display: none; margin-bottom: 12px; border-left: 2px solid var(--text-success); background: rgba(124, 242, 154, 0.05);">
                    <div style="font-size: 0.85em; font-weight: bold; margin-bottom: 6px; color: var(--text-success);">Drift Intelligence Analysis</div>
                    <div id="driftIntelligenceContent" style="font-size: 0.9em; line-height: 1.4; color: var(--text-main);"></div>
                </div>

                <div id="driftMetrics" class="micro-card" style="display: none; margin-bottom: 12px; border-left: 2px solid var(--text-accent);">
                    <div style="font-size: 0.85em; font-weight: bold; margin-bottom: 6px;">Operational Metrics</div>
                    <div id="driftMetricsContent" style="display: flex; flex-direction: column; gap: 6px; font-family: var(--font-mono); font-size: 0.85em;"></div>
                </div>

                <div id="driftLegend" class="micro-card" style="display: none; margin-bottom: 12px;">
                    <div style="font-size: 0.85em; font-weight: bold; margin-bottom: 6px;">Evolution Timeline</div>
                    <div id="driftLegendItems" style="display: flex; align-items: center; gap: 4px; overflow-x: auto; padding-bottom: 4px;"></div>
                </div>
            </div>
        </div>

        <div class="section">
            <div class="section-title">Target Manoeuvre Detection</div>
            <div id="manoeuvreTargetNotice" class="micro-card warning" style="margin-bottom: 12px;">
                Select a satellite to analyze its latest manoeuvre signature and threat level.
            </div>
            
            <div id="manoeuvreTargetControls" style="display: none;">
                <div class="micro-card" style="margin-bottom: 12px;">
                    Compare predicted trajectory (from old TLE) vs. actual observed trajectory (from new TLE).
                </div>
                <button id="manoeuvreAnalyzeButton" class="primary" type="button" style="width: 100%; margin-bottom: 12px;">Analyze Target Manoeuvre</button>
            </div>
            
            <div id="manoeuvreEventLog" style="display: none;">
                <div class="section-title">Manoeuvre Event Log</div>
                <div id="manoeuvreLogContent" class="list"></div>
            </div>
        </div>
    `;
}

function renderLegend(tracks) {
    if (!tracks) return "";
    const sorted = [...tracks].sort((a, b) => a.dayOffset - b.dayOffset);
    return sorted.map((t, i) => `
        <div style="display: flex; flex-direction: column; align-items: center; min-width: 45px; gap: 4px;">
            <div style="width: 100%; height: 4px; background-color: ${t.color}; border-radius: 2px;"></div>
            <span style="font-size: 0.7em; color: ${t.isCurrent ? "var(--text-bright)" : "var(--text-dim)"};">${t.dayOffset === 0 ? "Now" : `${t.dayOffset}d`}</span>
            ${i < sorted.length - 1 ? `<div style="position: absolute; right: -4px; top: 10px; color: var(--text-dim);">→</div>` : ""}
        </div>
    `).join('<div style="color: var(--text-dim); font-size: 0.8em; margin: 0 2px;">→</div>');
}

function renderManoeuvreEvent(result) {
    const severity = result.severity || "info";
    const deltas = result.deltas || {};
    
    return `
        <div class="micro-card" style="border-left: 4px solid var(--severity-${severity}); margin-bottom: 12px; padding: 12px; background: rgba(255,255,255,0.03);">
            <div style="display: flex; justify-content: space-between; align-items: flex-start; margin-bottom: 8px;">
                <span class="badge badge-${severity}">${result.classification.toUpperCase().replace('_', ' ')}</span>
                <strong style="color: var(--text-warning); font-family: var(--font-mono);">Score: ${result.threatScore}</strong>
            </div>
            
            <div style="font-style: italic; font-size: 0.9em; color: var(--text-main); margin-bottom: 10px;">
                ${escapeHtml(result.assessment)}
            </div>
            
            <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 8px; font-size: 0.85em; font-family: var(--font-mono);">
                <div style="color: var(--text-dim);">SMA Delta: <span style="color: var(--text-main);">${deltas.semiMajorAxisKm.toFixed(2)} km</span></div>
                <div style="color: var(--text-dim);">Inc. Shift: <span style="color: var(--text-main);">${deltas.inclinationDeg.toFixed(4)}°</span></div>
                <div style="color: var(--text-dim);">Ecc. Delta: <span style="color: var(--text-main);">${deltas.eccentricity.toFixed(6)}</span></div>
                <div style="color: var(--text-dim);">Residual: <span style="color: var(--text-main);">${result.epochResidualKm.toFixed(1)} km</span></div>
            </div>

            ${result.proximity?.nearestIndianId ? `
                <div class="micro-card danger" style="margin-top: 10px; padding: 8px; font-size: 0.85em;">
                    <strong>Threat Asset: ${escapeHtml(result.proximity.nearestIndianId)}</strong><br>
                    Min Distance: ${result.proximity.minDistanceAfterKm.toFixed(1)} km
                </div>
            ` : ""}

            <div style="margin-top: 10px; font-size: 0.75em; color: var(--text-dim); text-align: right;">
                Detected At: ${new Date(result.occurredAt).toLocaleString()}
            </div>
        </div>
        <div class="micro-card" style="font-size: 0.8em; margin-bottom: 12px;">
            <div style="display: flex; align-items: center; gap: 8px; margin-bottom: 4px;">
                <div style="width: 12px; height: 2px; border: 1px dashed #99b7c8; background: transparent;"></div>
                <span>Dotted: Predicted (Old Orbit)</span>
            </div>
            <div style="display: flex; align-items: center; gap: 8px;">
                <div style="width: 12px; height: 2px; background: ${result.visualization.newOrbit.color};"></div>
                <span>Solid: Actual (New Orbit)</span>
            </div>
        </div>
    `;
}

export default {
    id: "manoeuvre-detection",
    label: "Manoeuvre Detection",
    eyebrow: "Orbital Intelligence",
    description: "Backend-owned TLE delta and proximity screening with operational alert persistence.",
    dockEyebrow: "Orbital",
    dockLabel: "Manoeuvres",
    status: "ready",
    mount(ctx) {
        const root = ctx.containers.sidebarRoot;
        root.innerHTML = buildSidebar();
        let previousInertialViewEnabled = appState.isInertialViewEnabled;

        const driftControls = document.getElementById("driftControls");
        const driftNotice = document.getElementById("driftContextNotice");
        const driftTargetLabel = document.getElementById("driftTargetLabel");
        const driftExitBtn = document.getElementById("driftExitFocusButton");
        const driftLegend = document.getElementById("driftLegend");
        const driftLegendItems = document.getElementById("driftLegendItems");
        const driftMetrics = document.getElementById("driftMetrics");
        const driftMetricsContent = document.getElementById("driftMetricsContent");
        const driftIntelligence = document.getElementById("driftIntelligence");
        const driftIntelligenceContent = document.getElementById("driftIntelligenceContent");
        const driftMagToggle = document.getElementById("driftMagnificationToggle");

        const manoeuvreTargetNotice = document.getElementById("manoeuvreTargetNotice");
        const manoeuvreTargetControls = document.getElementById("manoeuvreTargetControls");
        const manoeuvreAnalyzeButton = document.getElementById("manoeuvreAnalyzeButton");
        const manoeuvreEventLog = document.getElementById("manoeuvreEventLog");
        const manoeuvreLogContent = document.getElementById("manoeuvreLogContent");

        const scope = new ListenerScope();

        const renderDriftMetrics = (drift) => {
            if (!drift || !drift.analysis) return;
            const a = drift.analysis;
            
            const tracks = drift.tracks || [];
            let longDrift = 0;
            let groundTrackDisp = 0;
            
            if (tracks.length >= 2) {
                const oldestTrack = [...tracks].sort((a,b) => a.dayOffset - b.dayOffset)[0];
                const latestTrack = [...tracks].sort((a,b) => b.dayOffset - a.dayOffset)[0];
                
                const oldest = oldestTrack.samples[0];
                const latest = latestTrack.samples[0];
                
                if (oldest && latest) {
                    longDrift = latest.lon - oldest.lon;
                    const p1 = new Cesium.Cartesian3(oldest.x, oldest.y, oldest.z);
                    const p2 = new Cesium.Cartesian3(latest.x, latest.y, latest.z);
                    groundTrackDisp = Cesium.Cartesian3.distance(p1, p2) / 1000;
                }
            }

            // Generate Intelligence Narrative
            let narrative = "";
            const lonAbs = Math.abs(longDrift);
            const driftDir = longDrift > 0 ? "eastward" : "westward";
            
            if (lonAbs > 0.05) {
                narrative += `Satellite is <strong>drifting ${driftDir}</strong> (${lonAbs.toFixed(2)}° over ${a.daysAnalyzed} days). `;
            } else {
                narrative += `Satellite maintaining <strong>stable longitudinal station</strong>. `;
            }

            if (Math.abs(a.smaShiftKm) > 1) {
                narrative += `Orbital altitude has <strong>${a.smaShiftKm > 0 ? "increased" : "decreased"}</strong> by ${Math.abs(a.smaShiftKm).toFixed(1)} km, suggesting ${Math.abs(a.smaShiftKm) > 5 ? "a major manoeuvre" : "station-keeping activity"}. `;
            }

            const indiaLon = [68, 97];
            const currentLon = tracks.find(t => t.dayOffset === 0)?.samples[0]?.lon;
            if (currentLon >= indiaLon[0] && currentLon <= indiaLon[1]) {
                narrative += `Object currently has <strong>active coverage over Indian airspace</strong>. `;
            } else if (longDrift > 0 && currentLon < indiaLon[0]) {
                narrative += `Object is <strong>approaching Indian regional coverage</strong> from the west. `;
            } else if (longDrift < 0 && currentLon > indiaLon[1]) {
                narrative += `Object is <strong>approaching Indian regional coverage</strong> from the east. `;
            }

            driftIntelligenceContent.innerHTML = narrative;
            driftIntelligence.style.display = "block";

            driftMetricsContent.innerHTML = `
                <div style="display: flex; justify-content: space-between;">
                    <span>Inc. Shift:</span>
                    <span style="color: var(--text-bright);">${a.inclinationShiftDeg >= 0 ? "+" : ""}${a.inclinationShiftDeg.toFixed(4)}°</span>
                </div>
                <div style="display: flex; justify-content: space-between;">
                    <span>Alt. Delta:</span>
                    <span style="color: var(--text-bright);">${a.smaShiftKm >= 0 ? "+" : ""}${a.smaShiftKm.toFixed(2)} km</span>
                </div>
                <div style="display: flex; justify-content: space-between;">
                    <span>Long. Drift:</span>
                    <span style="color: var(--text-bright);">${longDrift >= 0 ? "+" : ""}${longDrift.toFixed(3)}°</span>
                </div>
                <div style="display: flex; justify-content: space-between;">
                    <span>Ground Disp:</span>
                    <span style="color: var(--text-bright);">${groundTrackDisp.toFixed(1)} km</span>
                </div>
            `;
            driftMetrics.style.display = "block";
        };

        const syncUI = () => {
            const satelliteId = appState.activeSatellitePathId;
            if (satelliteId) {
                driftControls.style.display = "block";
                driftNotice.style.display = "none";
                driftTargetLabel.textContent = satelliteId;
                
                manoeuvreTargetControls.style.display = "block";
                manoeuvreTargetNotice.style.display = "none";

                if (appState.isFocusMode && appState.focusedSatelliteId === satelliteId) {
                    driftExitBtn.style.display = "block";
                    if (appState.driftHistory) {
                        driftLegend.style.display = "block";
                        driftLegendItems.innerHTML = renderLegend(appState.driftHistory.tracks);
                        renderDriftMetrics(appState.driftHistory);
                    }
                } else {
                    driftExitBtn.style.display = "none";
                    driftLegend.style.display = "none";
                    driftMetrics.style.display = "none";
                    driftIntelligence.style.display = "none";
                }
            } else {
                driftControls.style.display = "none";
                driftNotice.style.display = "block";
                
                manoeuvreTargetControls.style.display = "none";
                manoeuvreTargetNotice.style.display = "block";
                manoeuvreEventLog.style.display = "none";
            }
            
            if (driftMagToggle) {
                driftMagToggle.checked = appState.driftMagnification > 1.0;
            }
        };

        // Initial sync
        syncUI();

        scope.add(driftMagToggle, "change", () => {
            appState.driftMagnification = driftMagToggle.checked ? 3.0 : 1.0;
            if (appState.driftHistory && appState.isFocusMode) {
                ctx.shared.drawDriftTracks(appState.driftHistory);
            }
        });

        // Listen for selection changes
        scope.addCleanup(eventBus.on(events.satelliteSelected, () => {
            syncUI();
        }));

        scope.addCleanup(eventBus.on(events.satelliteCleared, () => {
            syncUI();
        }));

        scope.add(document.getElementById("driftRunButton"), "click", async () => {
            const satelliteId = appState.activeSatellitePathId;
            if (!satelliteId) return;

            const days = document.getElementById("driftDurationSelect").value;
            setStatus(`Computing ${days}-day orbital drift evolution for ${satelliteId}...`);
            
            try {
                const currentTime = appState.simulationMode && appState.simulationClock 
                    ? appState.simulationClock 
                    : Cesium.JulianDate.toDate(ctx.shared.viewer.clock.currentTime);

                const { drift } = await ctx.shared.fetchDriftHistory(satelliteId, days, currentTime.getTime(), appState.catalogApiBaseUrl);
                appState.driftHistory = drift;
                
                if (!appState.isFocusMode) {
                    ctx.shared.enterFocusedAnalysisMode(satelliteId);
                }

                previousInertialViewEnabled = appState.isInertialViewEnabled;
                if (typeof ctx.shared.setInertialView === "function") {
                    // Why: historical drift rings are easier to compare when the orbit stays circular in inertial view.
                    ctx.shared.setInertialView(true);
                }
                
                // Clear the "original" orbit path
                ctx.shared.clearPathEntities();

                ctx.shared.drawDriftTracks(drift);
                syncUI();
                setStatus(`Orbital drift evolution rendered for ${satelliteId}.`);
            } catch (error) {
                console.error("Drift analysis failed:", error);
                setStatus(`Drift analysis failed for ${satelliteId}.`);
            }
        });

        scope.add(driftExitBtn, "click", () => {
            ctx.shared.exitFocusedAnalysisMode();
            if (typeof ctx.shared.setInertialView === "function") {
                ctx.shared.setInertialView(previousInertialViewEnabled);
            }
            syncUI();
        });

        scope.add(manoeuvreAnalyzeButton, "click", async () => {
            const satelliteId = appState.activeSatellitePathId;
            if (!satelliteId) return;

            setStatus(`Analyzing manoeuvre signature for ${satelliteId}...`);
            manoeuvreEventLog.style.display = "none";

            try {
                const { payload } = await ctx.shared.postJsonWithFallback("/api/analysis/target-manoeuvre-detection", {
                    satelliteName: satelliteId
                });
                const result = payload.result;

                if (result && result.status === "success") {
                    manoeuvreLogContent.innerHTML = renderManoeuvreEvent(result);
                    manoeuvreEventLog.style.display = "block";

                    previousInertialViewEnabled = appState.isInertialViewEnabled;
                    if (typeof ctx.shared.setInertialView === "function") {
                        // Why: old-vs-new manoeuvre orbit comparisons are easier to read as circular inertial rings.
                        ctx.shared.setInertialView(true);
                    }

                    // Visualize orbits: Old (dotted), New (solid)
                    ctx.shared.drawPredictedPaths([
                        result.visualization.oldOrbit,
                        result.visualization.newOrbit
                    ]);

                    setStatus(`Manoeuvre detection complete for ${satelliteId}.`);
                } else {
                    setStatus(result.message || "Analysis inconclusive.");
                }
            } catch (error) {
                console.error("Manoeuvre analysis failed:", error);
                setStatus(`Manoeuvre analysis failed for ${satelliteId}.`);
            }
        });

        setStatus("Orbital Intelligence module active.");

        return {
            unmount() {
                scope.dispose();
            }
        };
    }
};
