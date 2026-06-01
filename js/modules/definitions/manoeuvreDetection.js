import { appState } from "../../state.js";
import { setStatus, renderAnalysisLoader } from "../../ui.js";
import { escapeHtml } from "../../utils.js";
import { 
    fetchBackendManoeuvreDetection, 
    fetchBackendRegionalPresence
} from "../../analysisService.js";
import { ListenerScope } from "../../ui/panelSystem.js";
import { eventBus, events } from "../eventBus.js";
import { elements } from "../../dom.js";
import { updateSelectedAreaVisual } from "../../viewer.js";

function generateCirclePoints(centroid, radiusKm) {
    const points = [];
    const earthRadius = 6371;
    const latRad = centroid.lat * Math.PI / 180;
    const lonRad = centroid.lon * Math.PI / 180;
    const dR = radiusKm / earthRadius;

    for (let i = 0; i < 360; i += 11.25) {
        const angle = i * Math.PI / 180;
        const outLatRad = Math.asin(Math.sin(latRad) * Math.cos(dR) + Math.cos(latRad) * Math.sin(dR) * Math.cos(angle));
        const outLonRad = lonRad + Math.atan2(Math.sin(angle) * Math.sin(dR) * Math.cos(latRad), Math.cos(dR) - Math.sin(latRad) * Math.sin(outLatRad));
        points.push({
            lat: outLatRad * 180 / Math.PI,
            lon: outLonRad * 180 / Math.PI
        });
    }
    return points;
}



function humanizeTrend(trend) {
    if (trend === "new_access") {
        return "New access";
    }
    if (trend === "rising") {
        return "Rising";
    }
    if (trend === "declining") {
        return "Declining";
    }
    if (trend === "stable") {
        return "Stable";
    }
    return "None";
}

function formatTimestamp(value) {
    if (!value) {
        return "Unknown";
    }

    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? "Unknown" : date.toLocaleString();
}

function renderRegionalPresenceFinding(finding) {
    const severity = finding.operationalSeverity || "low";
    const trend = humanizeTrend(finding.visibilityTrend);
    const confidence = Number.isFinite(finding.confidenceScore) ? `${Math.round(finding.confidenceScore * 100)}%` : "Unknown";
    const revisitChange = Number.isFinite(finding.revisitChangePercent) ? `${finding.revisitChangePercent >= 0 ? "+" : ""}${finding.revisitChangePercent.toFixed(0)}%` : "Unknown";

    return `
        <div class="micro-card" style="border-left: 4px solid var(--severity-${severity}); margin-bottom: 12px; padding: 12px; background: rgba(255,255,255,0.03);">
            <div style="display: flex; justify-content: space-between; align-items: flex-start; gap: 8px; margin-bottom: 8px;">
                <div>
                    <div style="font-size: 0.95em; font-weight: bold; color: var(--text-bright);">${escapeHtml(finding.satelliteName || "Unknown satellite")}</div>
                    <div style="font-size: 0.78em; color: var(--text-dim);">${escapeHtml(finding.regionName || "Regional area")}</div>
                </div>
                <div style="text-align: right;">
                    <span class="badge badge-${severity}">${escapeHtml(severity.toUpperCase())}</span><br>
                    <span style="font-family: var(--font-mono); color: var(--text-warning);">Conf. ${confidence}</span>
                </div>
            </div>

            <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 8px; font-size: 0.84em; font-family: var(--font-mono);">
                <div style="color: var(--text-dim);">NORAD: <span style="color: var(--text-main);">${finding.noradId ?? "Unknown"}</span></div>
                <div style="color: var(--text-dim);">Trend: <span style="color: var(--text-main);">${escapeHtml(trend)}</span></div>
                <div style="color: var(--text-dim);">Prev Passes: <span style="color: var(--text-main);">${finding.previousPassCount ?? 0}</span></div>
                <div style="color: var(--text-dim);">Recent Passes: <span style="color: var(--text-main);">${finding.recentPassCount ?? 0}</span></div>
                <div style="color: var(--text-dim);">Revisit Δ: <span style="color: var(--text-main);">${revisitChange}</span></div>
                <div style="color: var(--text-dim);">Avg Vis. Min: <span style="color: var(--text-main);">${Number.isFinite(finding.averageVisibilityDuration) ? finding.averageVisibilityDuration.toFixed(1) : "0.0"}</span></div>
                <div style="color: var(--text-dim);">First Access: <span style="color: var(--text-main);">${formatTimestamp(finding.firstDetectedAccess)}</span></div>
            </div>

        </div>
    `;
}

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
                    Layered historical trajectories visualize how the orbit changes over time.
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
                    <div style="font-size: 0.75em; color: var(--text-dim); margin-top: -8px;">Visually separates historical rings so drift stays readable.</div>
                </div>

                <button id="driftExitFocusButton" class="secondary" type="button" style="width: 100%; margin-bottom: 12px; display: none;">Exit Focus Mode</button>
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
        </div>

        <div class="section">
            <div class="section-title">Emerging Regional Access</div>
            <div id="regionalPresenceNotice" class="micro-card warning" style="margin-bottom: 12px;">
                Search a strategic region and select a window to scan for emerging accesses.
            </div>

            <div id="regionalPresenceControls" style="display: flex; flex-direction: column; gap: 12px;">
                <div class="field" style="position: relative;">
                    <label for="manoeuvreLocationSearchInput">Search Strategic Location (OSM Geocoder)</label>
                    <div style="display: flex; gap: 4px; position: relative;">
                        <input type="text" id="manoeuvreLocationSearchInput" placeholder="Search city, state or country..." autocomplete="off" style="width: 100%; background: rgba(14, 25, 41, 0.9); color: var(--text-main); border: 1px solid rgba(111, 226, 255, 0.35); border-radius: 10px; padding: 10px 12px; font-size: 14px;">
                        <div id="manoeuvreSearchSpinner" class="is-hidden" style="position: absolute; right: 12px; top: 12px; border: 2px solid rgba(111, 226, 255, 0.1); border-left-color: var(--accent); border-radius: 50%; width: 16px; height: 16px; animation: spin 1s linear infinite;"></div>
                    </div>
                    <div id="manoeuvreSearchSuggestions" style="position: absolute; width: 100%; top: 100%; left: 0; background: rgba(6, 15, 28, 0.96); border: 1px solid var(--panel-border); border-radius: 8px; margin-top: 4px; box-shadow: 0 10px 25px rgba(0,0,0,0.5); z-index: 100; max-height: 200px; overflow-y: auto; display: none;"></div>
                </div>

                <div class="field">
                    <label for="regionalPresenceWindowSelect">Screening Timeframe</label>
                    <select id="regionalPresenceWindowSelect" style="width: 100%;">
                        <option value="15">15 Days</option>
                        <option value="30" selected>30 Days</option>
                        <option value="60">60 Days</option>
                    </select>
                </div>

                <button id="regionalPresenceRunButton" class="primary" type="button" style="width: 100%;">Analyze Regional Access</button>
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
        const driftMagToggle = document.getElementById("driftMagnificationToggle");

        const manoeuvreTargetNotice = document.getElementById("manoeuvreTargetNotice");
        const manoeuvreTargetControls = document.getElementById("manoeuvreTargetControls");
        const manoeuvreAnalyzeButton = document.getElementById("manoeuvreAnalyzeButton");

        const regionalPresenceNotice = document.getElementById("regionalPresenceNotice");
        const regionalPresenceRegionSelect = document.getElementById("regionalPresenceRegionSelect");
        const regionalPresenceWindowSelect = document.getElementById("regionalPresenceWindowSelect");
        const regionalPresenceRunButton = document.getElementById("regionalPresenceRunButton");
        let regionalPresenceSelectionTouched = false;

        const scope = new ListenerScope();

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
                        ctx.shared.renderDriftAnalysis(appState.driftHistory);
                    }
                } else {
                    driftExitBtn.style.display = "none";
                    if (elements.analysisPanel && elements.analysisPanel.innerHTML.includes("Drift Evolution")) {
                        elements.analysisPanel.innerHTML = "";
                    }
                }
            } else {
                driftControls.style.display = "none";
                driftNotice.style.display = "block";
                
                manoeuvreTargetControls.style.display = "none";
                manoeuvreTargetNotice.style.display = "block";
            }

            if (regionalPresenceNotice) {
                if (appState.selectedArea) {
                    regionalPresenceNotice.textContent = `Using the strategic location "${appState.selectedArea.name || "Selected Region"}" for emerging access analysis.`;
                } else {
                    regionalPresenceNotice.textContent = "Search a strategic region and select a window to scan for emerging accesses.";
                }
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

        scope.add(regionalPresenceRunButton, "click", async () => {
            const selectedArea = appState.selectedArea;
            const timeframeDays = Number.parseInt(regionalPresenceWindowSelect?.value || "30", 10) || 30;

            if (!selectedArea) {
                setStatus("Search and select a strategic location before running regional presence analysis.");
                return;
            }

            setStatus(`Analyzing emerging regional access for ${selectedArea.name || "selected region"} over ${timeframeDays} days...`);
            renderAnalysisLoader("Emerging Regional Access", "Screening historical pass windows and visibility scores...");

            try {
                const currentTime = appState.simulationMode && appState.simulationClock
                    ? appState.simulationClock
                    : Cesium.JulianDate.toDate(ctx.shared.viewer.clock.currentTime);

                const { result } = await fetchBackendRegionalPresence({
                    area: selectedArea,
                    timeframeDays,
                    sampleMinutes: 30,
                    visibilityThresholdDeg: 10,
                    maxFindings: 10,
                    time: currentTime.toISOString()
                }, appState.catalogApiBaseUrl);

                ctx.shared.renderRegionalAccessAnalysis(result);
                setStatus(`Regional presence analysis complete for ${selectedArea.name || "selected region"}.`);
            } catch (error) {
                console.error("Regional presence analysis failed:", error);
                setStatus(`Regional presence analysis failed for ${selectedArea.name || "selected region"}.`);
                if (elements.analysisPanel) {
                    elements.analysisPanel.innerHTML = `<div class="list-item danger"><strong>Error:</strong> Regional presence analysis failed for ${escapeHtml(selectedArea.name || "selected region")}.</div>`;
                }
            }
        });

        // Listen for selection changes
        scope.addCleanup(eventBus.on(events.satelliteSelected, () => {
            syncUI();
        }));

        scope.addCleanup(eventBus.on(events.satelliteCleared, () => {
            syncUI();
        }));

        scope.addCleanup(eventBus.on(events.areaSelected, () => {
            syncUI();
        }));

        scope.addCleanup(eventBus.on(events.areaCleared, () => {
            syncUI();
        }));

        scope.add(document.getElementById("driftRunButton"), "click", async () => {
            const satelliteId = appState.activeSatellitePathId;
            if (!satelliteId) return;

            const days = document.getElementById("driftDurationSelect").value;
            setStatus(`Computing ${days}-day orbital drift evolution for ${satelliteId}...`);
            renderAnalysisLoader("Orbital Drift Analysis", "Simulating historical trajectories and overlaying drift rings...");
            
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
                    ctx.shared.setInertialView(true);
                }
                
                // Clear the "original" orbit path
                ctx.shared.clearPathEntities();

                ctx.shared.drawDriftTracks(drift);
                ctx.shared.renderDriftAnalysis(drift);
                syncUI();
                setStatus(`Orbital drift evolution rendered for ${satelliteId}.`);
            } catch (error) {
                console.error("Drift analysis failed:", error);
                setStatus(`Drift analysis failed for ${satelliteId}.`);
                if (elements.analysisPanel) {
                    elements.analysisPanel.innerHTML = `<div class="list-item danger"><strong>Error:</strong> Drift analysis failed for ${escapeHtml(satelliteId)}.</div>`;
                }
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
            renderAnalysisLoader("Manoeuvre Signature Analysis", "Comparing predicted trajectory with telemetry revisions...");

            try {
                const { payload } = await ctx.shared.postJsonWithFallback("/api/analysis/target-manoeuvre-detection", {
                    satelliteName: satelliteId
                });
                const result = payload.result;

                if (result && result.status === "success") {
                    ctx.shared.renderManoeuvreAnalysis(result);

                    previousInertialViewEnabled = appState.isInertialViewEnabled;
                    if (typeof ctx.shared.setInertialView === "function") {
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
                    if (elements.analysisPanel) {
                        elements.analysisPanel.innerHTML = `<div class="list-item warning"><strong>Inconclusive:</strong> ${escapeHtml(result.message || "Analysis inconclusive.")}</div>`;
                    }
                }
            } catch (error) {
                console.error("Manoeuvre analysis failed:", error);
                setStatus(`Manoeuvre analysis failed for ${satelliteId}.`);
                if (elements.analysisPanel) {
                    elements.analysisPanel.innerHTML = `<div class="list-item danger"><strong>Error:</strong> Manoeuvre analysis failed for ${escapeHtml(satelliteId)}.</div>`;
                }
            }
        });

        const searchInput = document.getElementById("manoeuvreLocationSearchInput");
        const suggestionsBox = document.getElementById("manoeuvreSearchSuggestions");
        const spinner = document.getElementById("manoeuvreSearchSpinner");

        let searchTimeout = null;

        const selectPlace = (item) => {
            suggestionsBox.style.display = "none";
            searchInput.value = item.display_name;

            const bbox = item.boundingbox;
            if (!bbox || bbox.length < 4) {
                setStatus("Selected place does not contain boundary values.");
                return;
            }

            const minLat = parseFloat(bbox[0]);
            const maxLat = parseFloat(bbox[1]);
            const minLon = parseFloat(bbox[2]);
            const maxLon = parseFloat(bbox[3]);

            const centroid = { lat: parseFloat(item.lat), lon: parseFloat(item.lon) };
            const points = [
                { lat: maxLat, lon: minLon },
                { lat: maxLat, lon: maxLon },
                { lat: minLat, lon: maxLon },
                { lat: minLat, lon: minLon }
            ];

            appState.selectedArea = {
                name: item.display_name,
                centroid,
                points
            };

            // Draw boundary outline on Cesium map
            updateSelectedAreaVisual(appState.selectedArea);

            // Camera flyTo bounding box
            ctx.shared.viewer.camera.flyTo({
                destination: Cesium.Rectangle.fromDegrees(minLon, minLat, maxLon, maxLat),
                duration: 1.5
            });

            setStatus(`Scoped emerging access scan on: ${item.display_name}.`);
            syncUI();
        };

        scope.add(searchInput, "input", (e) => {
            const query = e.target.value.trim();
            clearTimeout(searchTimeout);
            if (query.length < 3) {
                suggestionsBox.innerHTML = "";
                suggestionsBox.style.display = "none";
                return;
            }

            spinner.classList.remove("is-hidden");

            searchTimeout = setTimeout(async () => {
                try {
                    const res = await fetch(`https://nominatim.openstreetmap.org/search?format=json&q=${encodeURIComponent(query)}&limit=5`, {
                        headers: {
                            "User-Agent": "SDA-Console-Agent (acer.gemini.antigravity@example.com)"
                        }
                    });
                    const data = await res.json();
                    spinner.classList.add("is-hidden");

                    if (!Array.isArray(data) || data.length === 0) {
                        suggestionsBox.innerHTML = `<div style="padding: 10px; color: var(--text-dim); font-size: 13px;">No results found.</div>`;
                        suggestionsBox.style.display = "block";
                        return;
                    }

                    suggestionsBox.innerHTML = data.map((item, i) => `
                        <div class="suggestion-item" data-index="${i}" style="padding: 8px 12px; cursor: pointer; border-bottom: 1px solid rgba(255,255,255,0.05); font-size: 13px; color: var(--text-main); line-height: 1.3; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;">
                            ${escapeHtml(item.display_name)}
                        </div>
                    `).join("");

                    const items = suggestionsBox.querySelectorAll(".suggestion-item");
                    items.forEach(el => {
                        el.addEventListener("mouseenter", () => el.style.background = "rgba(111, 226, 255, 0.15)");
                        el.addEventListener("mouseleave", () => el.style.background = "none");
                        el.addEventListener("click", () => {
                            const idx = parseInt(el.dataset.index);
                            selectPlace(data[idx]);
                        });
                    });

                    suggestionsBox.style.display = "block";
                } catch (err) {
                    console.error(err);
                    spinner.classList.add("is-hidden");
                    suggestionsBox.innerHTML = `<div style="padding: 10px; color: var(--danger); font-size: 13px;">Error fetching locations.</div>`;
                    suggestionsBox.style.display = "block";
                }
            }, 400);
        });

        // Hide suggestions when clicking outside
        scope.add(document, "click", (e) => {
            if (e.target !== searchInput && e.target !== suggestionsBox) {
                suggestionsBox.style.display = "none";
            }
        });

        setStatus("Orbital Intelligence module active.");

        return {
            unmount() {
                updateSelectedAreaVisual(null);
                scope.dispose();
            }
        };
    }
};
