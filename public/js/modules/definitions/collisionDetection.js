import { fetchBackendConjunctionAnalysis } from "../../analysisService.js";
import { appState } from "../../state.js";
import {
    renderAreaAnalysis,
    renderAnalysisLoader,
    setStatus,
    updateAreaReadout,
    updateCollisionAlert
} from "../../ui.js";
import { drawPredictedPaths, enterAreaFocusMode, exitAreaFocusMode, updateSelectedAreaVisual } from "../../viewer.js";
import {
    field,
    selectControl,
    splitFields,
    ListenerScope
} from "../../ui/panelSystem.js";
import { eventBus, events } from "../eventBus.js";
import { hasSelectedArea } from "../regionTrace.js";
import {
    attachRegionTracingControls,
    buildRegionTracingMarkup
} from "./regionPanelTemplate.js";
import { escapeHtml } from "../../utils.js";

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

const HORIZON_OPTIONS = [
    { value: "60", label: "Next 1 hour" },
    { value: "360", label: "Next 6 hours" },
    { value: "1440", label: "Next 24 hours", selected: true },
    { value: "4320", label: "Next 3 days" }
];

const COLLISION_THRESHOLD_OPTIONS = [
    { value: "1", label: "1 km" },
    { value: "5", label: "5 km", selected: true },
    { value: "10", label: "10 km" },
    { value: "25", label: "25 km" }
];

const MIN_ALTITUDE_OPTIONS = [
    { value: "0", label: "0 km", selected: true },
    { value: "100", label: "100 km" },
    { value: "250", label: "250 km" },
    { value: "500", label: "500 km" }
];

const MAX_ALTITUDE_OPTIONS = [
    { value: "2000", label: "2000 km", selected: true },
    { value: "5000", label: "5000 km" },
    { value: "10000", label: "10000 km" },
    { value: "42000", label: "42000 km" }
];

function buildSidebar() {
    return `
        ${field("Forecast Window", selectControl("horizonSelect", HORIZON_OPTIONS), { id: "horizonSelect" })}
        ${field("Collision Distance", selectControl("collisionThresholdSelect", COLLISION_THRESHOLD_OPTIONS), { id: "collisionThresholdSelect" })}
        ${field("Altitude Window", splitFields([
            selectControl("minAltitudeSelect", MIN_ALTITUDE_OPTIONS, { ariaLabel: "Minimum altitude" }),
            selectControl("maxAltitudeSelect", MAX_ALTITUDE_OPTIONS, { ariaLabel: "Maximum altitude" })
        ]))}
        <div class="micro-card" style="margin-top:8px; font-size:0.85em; color: var(--text-dim); margin-bottom: 12px;">
            High-risk collision detection layer for Indian assets. Focuses on Pc, miss distance, relative velocity, and TCA.
        </div>

        <div class="section">
            <div class="section-title">Geographic Target Selection</div>
            <div class="field">
                <label for="cdPresetRegionTypeSelect">Selection Mode</label>
                <select id="cdPresetRegionTypeSelect">
                    <option value="manual" selected>Manual Tracing (Draw on Globe)</option>
                    <option value="search">Search Location (OSM Geocoder)</option>
                </select>
            </div>
            
            <div class="field" id="cdGeocoderSearchContainer" style="display: none; position: relative;">
                <label for="cdLocationSearchInput">Search City, State or Country</label>
                <div style="display: flex; gap: 4px; position: relative;">
                    <input type="text" id="cdLocationSearchInput" placeholder="Type to search globally..." autocomplete="off" style="width: 100%; background: rgba(14, 25, 41, 0.9); color: var(--text-main); border: 1px solid rgba(111, 226, 255, 0.35); border-radius: 10px; padding: 10px 12px; font-size: 14px;">
                    <div id="cdSearchSpinner" class="is-hidden" style="position: absolute; right: 12px; top: 12px; border: 2px solid rgba(111, 226, 255, 0.1); border-left-color: var(--accent); border-radius: 50%; width: 16px; height: 16px; animation: spin 1s linear infinite;"></div>
                </div>
                <div id="cdSearchSuggestions" style="position: absolute; width: 100%; top: 100%; left: 0; background: rgba(6, 15, 28, 0.96); border: 1px solid var(--panel-border); border-radius: 8px; margin-top: 4px; box-shadow: 0 10px 25px rgba(0,0,0,0.5); z-index: 100; max-height: 200px; overflow-y: auto; display: none;"></div>
            </div>
        </div>

        <div id="cdManualTracingControlsContainer">
            ${buildRegionTracingMarkup()}
        </div>
    `;
}

function runCollisionDetection(ctx) {
    if (!appState.catalogLoaded) {
        setStatus("Satellite catalog is still loading.");
        return;
    }

    const horizonSelect = document.getElementById("horizonSelect");
    const thresholdSelect = document.getElementById("collisionThresholdSelect");
    const minAltitudeSelect = document.getElementById("minAltitudeSelect");
    const maxAltitudeSelect = document.getElementById("maxAltitudeSelect");

    const horizon = Number(horizonSelect?.value || 1440);
    const threshold = Number(thresholdSelect?.value || 5);
    const minAlt = Number(minAltitudeSelect?.value || 0);
    const maxAlt = Number(maxAltitudeSelect?.value || 2000);

    appState.analysisInFlight = true;
    appState.analysisWorkerBusy = true;
    appState.activeSatellitePathId = null;

    // Display professional premium loader spinner
    renderAnalysisLoader("Collision Detection", "Performing high-precision close-approach risk screening for national assets...");
    
    // Mission Requirement: Focus on Indian satellites vs the full catalog
    fetchBackendConjunctionAnalysis({
        area: appState.selectedArea,
        horizonMinutes: horizon,
        conjunctionThresholdKm: threshold,
        minAltitudeKm: minAlt,
        maxAltitudeKm: maxAlt,
        filters: { assetFilter: 'indian' },
        time: Cesium.JulianDate.toDate(ctx.shared.viewer.clock.currentTime).toISOString()
    }, appState.catalogApiBaseUrl).then(async (response) => {
        appState.analysisInFlight = false;
        appState.analysisWorkerBusy = false;
        
        response.result.analysisType = "collision_detection";
        appState.lastCollisionResult = response.result;

        renderAreaAnalysis(response.result);
        updateCollisionAlert(response.result);

        // Operational Visualization: Auto-draw red alert markers for high-risk events
        clearCollisionMarkers(ctx.shared.viewer);
        let criticalAlerts = (response.result.conjunctions || [])
            .filter(c => c.severity === "critical" || c.collisionProbability > 1e-4)
            .filter(c => {
                const pMeta = appState.satelliteMetaMap.get(c.primaryId);
                const sMeta = appState.satelliteMetaMap.get(c.secondaryId);
                const pType = pMeta?.objectType || "Payload";
                const sType = sMeta?.objectType || "Payload";
                return pType !== "Debris" && pType !== "Rocket Body" && sType !== "Debris" && sType !== "Rocket Body";
            });
        
        if (criticalAlerts.length > 0) {
            drawCollisionRiskMarkers(ctx.shared.viewer, criticalAlerts);
            setStatus(`CRITICAL: ${criticalAlerts.length} high-probability collision risks detected!`);
        } else {
            setStatus(`Collision detection complete. ${response.result.conjunctions?.length || 0} events reviewed.`);
        }

        await ctx.shared.refreshOperationalAlerts(response.apiBaseUrl);
    }).catch((error) => {
        appState.analysisInFlight = false;
        appState.analysisWorkerBusy = false;
        ctx.shared.handleAnalysisFailure("Collision detection", error?.message || "Unknown backend analysis error.");
    });
}

let collisionMarkers = [];

function clearCollisionMarkers(viewer) {
    collisionMarkers.forEach(m => viewer.entities.remove(m));
    collisionMarkers = [];
}

function drawCollisionRiskMarkers(viewer, conjunctions) {
    conjunctions.forEach(conj => {
        const pPos = new Cesium.Cartesian3(conj.primaryPos.x * 1000, conj.primaryPos.y * 1000, conj.primaryPos.z * 1000);
        const sPos = new Cesium.Cartesian3(conj.secondaryPos.x * 1000, conj.secondaryPos.y * 1000, conj.secondaryPos.z * 1000);
        const midpoint = Cesium.Cartesian3.lerp(pPos, sPos, 0.5, new Cesium.Cartesian3());

        const marker = viewer.entities.add({
            position: midpoint,
            point: {
                pixelSize: 18,
                color: Cesium.Color.RED,
                outlineColor: Cesium.Color.WHITE,
                outlineWidth: 3,
                disableDepthTestDistance: Number.POSITIVE_INFINITY
            },
            label: {
                text: `CRITICAL RISK\n${conj.primaryId} ↔ ${conj.secondaryId}\nPc: ${(conj.collisionProbability || 0).toExponential(2)}`,
                font: "bold 14px monospace",
                fillColor: Cesium.Color.RED,
                outlineColor: Cesium.Color.BLACK,
                outlineWidth: 2,
                style: Cesium.LabelStyle.FILL_AND_OUTLINE,
                verticalOrigin: Cesium.VerticalOrigin.BOTTOM,
                pixelOffset: new Cesium.Cartesian2(0, -20),
                disableDepthTestDistance: Number.POSITIVE_INFINITY
            }
        });
        collisionMarkers.push(marker);
    });
}

function handleCollisionClick(idx, ctx) {
    const result = appState.lastCollisionResult;
    if (!result || !result.conjunctions) return;
    
    // The list in UI is already filtered for Indian assets
    const conjunctions = result.conjunctions.filter(c => c.primaryIsIndian || c.secondaryIsIndian);
    const conj = conjunctions[idx];
    if (!conj) return;

    setStatus(`Collision risk review: ${conj.primaryId} (Pc: ${conj.collisionProbability.toExponential(2)})`);

    drawConjunctionEvent(conj);

    const tca = Cesium.JulianDate.fromIso8601(conj.time);
    const animStart = Cesium.JulianDate.addSeconds(tca, -60, new Cesium.JulianDate());

    appState.simulationMode = true;
    appState.simulationClock = Cesium.JulianDate.toDate(animStart);
    appState.simulationPaused = false;
    appState.simulationSpeed = 5;

    ctx.shared.viewer.clock.currentTime = animStart;
    ctx.shared.viewer.clock.shouldAnimate = true;
    ctx.shared.viewer.clock.multiplier = 1.0; // We drive speed via appState now

    const pPos = new Cesium.Cartesian3(conj.primaryPos.x * 1000, conj.primaryPos.y * 1000, conj.primaryPos.z * 1000);
    const sPos = new Cesium.Cartesian3(conj.secondaryPos.x * 1000, conj.secondaryPos.y * 1000, conj.secondaryPos.z * 1000);
    const midpoint = Cesium.Cartesian3.lerp(pPos, sPos, 0.5, new Cesium.Cartesian3());

    ctx.shared.viewer.camera.flyTo({
        destination: Cesium.Cartesian3.add(midpoint, Cesium.Cartesian3.multiplyByScalar(Cesium.Cartesian3.normalize(midpoint, new Cesium.Cartesian3()), 100000, new Cesium.Cartesian3()), new Cesium.Cartesian3()),
        orientation: {
            direction: Cesium.Cartesian3.subtract(midpoint, ctx.shared.viewer.camera.position, new Cesium.Cartesian3()),
            up: Cesium.Cartesian3.UNIT_Z
        },
        duration: 2.0
    });
}

export default {
    id: "collision-detection",
    label: "Collision Detection",
    eyebrow: "Threat Operations",
    description: "High-risk collision detection for Indian assets and small-miss events.",
    dockEyebrow: "Threat",
    dockLabel: "Collisions",
    status: "ready",
    mount(ctx) {
        const root = ctx.containers.sidebarRoot;
        root.innerHTML = buildSidebar();

        const scope = new ListenerScope();
        attachRegionTracingControls(scope, {
            onAnalyze: () => runCollisionDetection(ctx)
        });

        const cdPresetRegionTypeSelect = document.getElementById("cdPresetRegionTypeSelect");
        const cdGeocoderSearchContainer = document.getElementById("cdGeocoderSearchContainer");
        const cdManualTracingControlsContainer = document.getElementById("cdManualTracingControlsContainer");
        const searchInput = document.getElementById("cdLocationSearchInput");
        const suggestionsBox = document.getElementById("cdSearchSuggestions");
        const spinner = document.getElementById("cdSearchSpinner");

        const updateSelectionMode = () => {
            const mode = cdPresetRegionTypeSelect.value;
            if (mode === "manual") {
                cdGeocoderSearchContainer.style.display = "none";
                cdManualTracingControlsContainer.style.display = "block";
            } else {
                cdGeocoderSearchContainer.style.display = "block";
                cdManualTracingControlsContainer.style.display = "none";
                if (typeof ctx.shared.isTracing === "function" && ctx.shared.isTracing()) {
                    ctx.shared.stopTraceMode(true);
                }
            }
        };
        scope.add(cdPresetRegionTypeSelect, "change", updateSelectionMode);

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
            enterAreaFocusMode([]);
            updateAreaReadout();

            // Camera flyTo bounding box
            ctx.shared.viewer.camera.flyTo({
                destination: Cesium.Rectangle.fromDegrees(minLon, minLat, maxLon, maxLat),
                duration: 1.5
            });

            setStatus(`Scoped geographic scan on: ${item.display_name}.`);
            if (hasSelectedArea()) {
                runCollisionDetection(ctx);
            }
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

        const rerun = () => {
            if (hasSelectedArea() && !appState.activeSatellitePathId) {
                runCollisionDetection(ctx);
            }
        };

        scope.add(document.getElementById("horizonSelect"), "change", rerun);
        scope.add(document.getElementById("collisionThresholdSelect"), "change", rerun);
        scope.add(document.getElementById("minAltitudeSelect"), "change", rerun);
        scope.add(document.getElementById("maxAltitudeSelect"), "change", rerun);

        // Click handler for risk table
        const analysisPanel = document.getElementById("analysisPanel");
        scope.add(analysisPanel, "click", (e) => {
            const item = e.target.closest(".list-item[data-conj-index]");
            if (item) {
                const idx = parseInt(item.dataset.conjIndex);
                handleCollisionClick(idx, ctx);
            }
        });

        // scope.addCleanup(eventBus.on(events.areaSelected, () => runCollisionDetection(ctx)));

        updateAreaReadout();
        updateCollisionAlert(null);

        return {
            unmount() {
                clearCollisionMarkers(ctx.shared.viewer);
                appState.simulationMode = false;
                appState.simulationClock = null;
                appState.simulationPaused = true;
                exitAreaFocusMode();
                scope.dispose();
            }
        };
    }
};
