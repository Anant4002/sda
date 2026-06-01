import { fetchBackendConjunctionAnalysis } from "../../analysisService.js";
import { appState } from "../../state.js";
import {
    renderAreaAnalysis,
    renderAnalysisLoader,
    setStatus,
    updateAreaReadout,
    updateCollisionAlert
} from "../../ui.js";
import { drawConjunctionEvent, clearConjunctionVisuals, updateSelectedAreaVisual } from "../../viewer.js";
import {
    field,
    selectControl,
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
    { value: "4320", label: "Next 3 days" },
    { value: "10080", label: "Next 7 days" }
];

const CONJUNCTION_THRESHOLD_OPTIONS = [
    { value: "1", label: "1 km" },
    { value: "5", label: "5 km", selected: true },
    { value: "25", label: "25 km" },
    { value: "50", label: "50 km" },
    { value: "100", label: "100 km" }
];

const FILTER_OPTIONS = [
    { value: "all", label: "All Conjunctions", selected: true },
    { value: "indian", label: "Indian Assets Only" },
    { value: "adversary", label: "Adversary Assets Only" },
    { value: "indian_vs_foreign", label: "Indian vs Foreign" }
];

const ALTITUDE_OPTIONS = [
    { value: "all", label: "All Altitudes", selected: true },
    { value: "leo", label: "LEO (200-2000 km)" },
    { value: "meo", label: "MEO (2000-30000 km)" },
    { value: "geo", label: "GEO (>30000 km)" },
    { value: "heo", label: "HEO (Highly Elliptical / High Altitude)" }
];

function buildSidebar() {
    return `
        <div class="section">
            <div class="section-title">Operational Screening</div>
            ${field("Look-ahead Window", selectControl("horizonSelect", HORIZON_OPTIONS), { id: "horizonSelect" })}
            ${field("Miss Distance Threshold", selectControl("collisionThresholdSelect", CONJUNCTION_THRESHOLD_OPTIONS), { id: "collisionThresholdSelect" })}
            ${field("Asset Filter", selectControl("assetFilterSelect", FILTER_OPTIONS), { id: "assetFilterSelect" })}
            ${field("Altitude Band", selectControl("altitudeSelect", ALTITUDE_OPTIONS), { id: "altitudeSelect" })}
            <div class="micro-card" style="margin-top: 10px; font-size: 0.85em; color: var(--text-dim);">
                Ranked by TCA, miss distance, relative velocity, and Pc. Results are intended for operational review.
            </div>
        </div>

        <div class="section">
            <div class="section-title">Geographic Target Selection</div>
            <div class="field">
                <label for="caPresetRegionTypeSelect">Selection Mode</label>
                <select id="caPresetRegionTypeSelect">
                    <option value="manual" selected>Manual Tracing (Draw on Globe)</option>
                    <option value="search">Search Location (OSM Geocoder)</option>
                </select>
            </div>
            
            <div class="field" id="caGeocoderSearchContainer" style="display: none; position: relative;">
                <label for="caLocationSearchInput">Search City, State or Country</label>
                <div style="display: flex; gap: 4px; position: relative;">
                    <input type="text" id="caLocationSearchInput" placeholder="Type to search globally..." autocomplete="off" style="width: 100%; background: rgba(14, 25, 41, 0.9); color: var(--text-main); border: 1px solid rgba(111, 226, 255, 0.35); border-radius: 10px; padding: 10px 12px; font-size: 14px;">
                    <div id="caSearchSpinner" class="is-hidden" style="position: absolute; right: 12px; top: 12px; border: 2px solid rgba(111, 226, 255, 0.1); border-left-color: var(--accent); border-radius: 50%; width: 16px; height: 16px; animation: spin 1s linear infinite;"></div>
                </div>
                <div id="caSearchSuggestions" style="position: absolute; width: 100%; top: 100%; left: 0; background: rgba(6, 15, 28, 0.96); border: 1px solid var(--panel-border); border-radius: 8px; margin-top: 4px; box-shadow: 0 10px 25px rgba(0,0,0,0.5); z-index: 100; max-height: 200px; overflow-y: auto; display: none;"></div>
            </div>
        </div>

        <div id="caManualTracingControlsContainer">
            ${buildRegionTracingMarkup()}
        </div>
    `;
}

function runConjunction(ctx) {
    if (!appState.catalogLoaded) {
        setStatus("Satellite catalog is still loading.");
        return;
    }

    const horizonSelect = document.getElementById("horizonSelect");
    const thresholdSelect = document.getElementById("collisionThresholdSelect");
    const assetFilterSelect = document.getElementById("assetFilterSelect");

    appState.analysisInFlight = true;
    appState.analysisWorkerBusy = true;
    appState.activeSatellitePathId = null;

    // Trigger professional premium loader spinner
    renderAnalysisLoader("Conjunction Analysis", "Screening entire satellite catalog for high-probability conjunction events...");

    const altBand = document.getElementById("altitudeSelect")?.value || "all";

    const filters = {
        assetFilter: assetFilterSelect?.value || "all",
        indianOnly: assetFilterSelect?.value === "indian",
        orbitClass: altBand === "heo" ? "HEO" : undefined
    };

    // Altitude band
    let minAltitudeKm, maxAltitudeKm;

    if (altBand === "leo") {
        minAltitudeKm = 200;
        maxAltitudeKm = 2000;
    } else if (altBand === "meo") {
        minAltitudeKm = 2000;
        maxAltitudeKm = 30000;
    } else if (altBand === "geo") {
        minAltitudeKm = 30000;
        maxAltitudeKm = 45000;
    } else if (altBand === "heo") {
        minAltitudeKm = 0;
        maxAltitudeKm = 100000;
    }

    fetchBackendConjunctionAnalysis({
        area: appState.selectedArea,
        horizonMinutes: Number(horizonSelect?.value || 1440),
        conjunctionThresholdKm: Number(thresholdSelect?.value || 5),
        filters,
        minAltitudeKm,
        maxAltitudeKm,
        time: Cesium.JulianDate.toDate(ctx.shared.viewer.clock.currentTime).toISOString()
    }, appState.catalogApiBaseUrl).then(async (response) => {
        appState.analysisInFlight = false;
        appState.analysisWorkerBusy = false;

        renderAreaAnalysis(response.result);
        updateCollisionAlert(response.result);
        setStatus(`Screening complete. ${response.result.conjunctions?.length || 0} threats identified.`);
        await ctx.shared.refreshOperationalAlerts(response.apiBaseUrl);
    }).catch((error) => {
        appState.analysisInFlight = false;
        appState.analysisWorkerBusy = false;

        let msg = error?.message || "Unknown backend conjunction error.";
        if (msg.includes("504") || msg.includes("Timeout")) {
            msg = "Analysis Gateway Timeout. The calculation is taking very long. Try a shorter window or asset filtering.";
        }

        ctx.shared.handleAnalysisFailure("Conjunction analysis", msg);
    });
}

function handleConjunctionClick(idx, ctx) {
    const result = appState.lastConjunctionResult;
    if (!result || !result.conjunctions) return;

    const conj = result.conjunctions[idx];
    if (!conj) return;

    setStatus(`Analyzing engagement geometry: ${conj.primaryId} ↔ ${conj.secondaryId}`);
    drawConjunctionEvent(conj);

    // Jump clock to TCA - 1 minute to show animation
    const tca = Cesium.JulianDate.fromIso8601(conj.time);
    const animStart = Cesium.JulianDate.addSeconds(tca, -60, new Cesium.JulianDate());

    appState.simulationMode = true;
    appState.simulationClock = Cesium.JulianDate.toDate(animStart);
    appState.simulationPaused = false;
    appState.simulationSpeed = 5;

    ctx.shared.viewer.clock.currentTime = animStart;
    ctx.shared.viewer.clock.shouldAnimate = true;
    ctx.shared.viewer.clock.multiplier = 1.0; // We drive speed via appState now

    // Focus camera on the conjunction point
    const pPos = new Cesium.Cartesian3(conj.primaryPos.x * 1000, conj.primaryPos.y * 1000, conj.primaryPos.z * 1000);
    const sPos = new Cesium.Cartesian3(conj.secondaryPos.x * 1000, conj.secondaryPos.y * 1000, conj.secondaryPos.z * 1000);
    const midpoint = Cesium.Cartesian3.lerp(pPos, sPos, 0.5, new Cesium.Cartesian3());

    // Calculate a good offset for viewing the geometry
    const offset = Cesium.Cartesian3.normalize(midpoint, new Cesium.Cartesian3());
    Cesium.Cartesian3.multiplyByScalar(offset, 150000, offset); // 150km out
    const cameraPos = Cesium.Cartesian3.add(midpoint, offset, new Cesium.Cartesian3());

    ctx.shared.viewer.camera.flyTo({
        destination: cameraPos,
        orientation: {
            direction: Cesium.Cartesian3.subtract(midpoint, cameraPos, new Cesium.Cartesian3()),
            up: Cesium.Cartesian3.UNIT_Z
        },
        duration: 2.0
    });
}

export default {
    id: "conjunction-analysis",
    label: "Conjunction Analysis",
    eyebrow: "Threat Operations",
    description: "Predictive orbital collision risk assessment and ranked threat assessment.",
    dockEyebrow: "Threat",
    dockLabel: "Conjunctions",
    status: "ready",
    mount(ctx) {
        const root = ctx.containers.sidebarRoot;
        root.innerHTML = buildSidebar();

        const scope = new ListenerScope();
        attachRegionTracingControls(scope, {
            onAnalyze: () => runConjunction(ctx)
        });

        const caPresetRegionTypeSelect = document.getElementById("caPresetRegionTypeSelect");
        const caGeocoderSearchContainer = document.getElementById("caGeocoderSearchContainer");
        const caManualTracingControlsContainer = document.getElementById("caManualTracingControlsContainer");
        const searchInput = document.getElementById("caLocationSearchInput");
        const suggestionsBox = document.getElementById("caSearchSuggestions");
        const spinner = document.getElementById("caSearchSpinner");

        const updateSelectionMode = () => {
            const mode = caPresetRegionTypeSelect.value;
            if (mode === "manual") {
                caGeocoderSearchContainer.style.display = "none";
                caManualTracingControlsContainer.style.display = "block";
            } else {
                caGeocoderSearchContainer.style.display = "block";
                caManualTracingControlsContainer.style.display = "none";
                if (typeof ctx.shared.isTracing === "function" && ctx.shared.isTracing()) {
                    ctx.shared.stopTraceMode(true);
                }
            }
        };
        scope.add(caPresetRegionTypeSelect, "change", updateSelectionMode);

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
            updateAreaReadout();

            // Camera flyTo bounding box
            ctx.shared.viewer.camera.flyTo({
                destination: Cesium.Rectangle.fromDegrees(minLon, minLat, maxLon, maxLat),
                duration: 1.5
            });

            setStatus(`Scoped geographic scan on: ${item.display_name}.`);
            if (hasSelectedArea()) {
                runConjunction(ctx);
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

        // Analysis Panel listeners (delegated)
        const analysisPanel = document.getElementById("analysisPanel");
        scope.add(analysisPanel, "click", (e) => {
            const item = e.target.closest(".list-item[data-conj-index]");
            if (item) {
                const idx = parseInt(item.dataset.conjIndex);
                handleConjunctionClick(idx, ctx);
            }
        });

        updateAreaReadout();
        updateCollisionAlert(null);

        return {
            unmount() {
                scope.dispose();
                clearConjunctionVisuals();
                appState.simulationMode = false;
                appState.simulationClock = null;
                appState.simulationPaused = true;
            }
        };
    }
};
