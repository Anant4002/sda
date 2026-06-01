import { fetchBackendRegionScan } from "../../analysisService.js";
import { appState } from "../../state.js";
import { escapeHtml } from "../../utils.js";
import {
    renderAreaAnalysis,
    renderAnalysisLoader,
    setStatus,
    updateAreaReadout,
    updateCollisionAlert
} from "../../ui.js";
import { drawPredictedPaths, updateSelectedAreaVisual } from "../../viewer.js";
import {
    alertCard,
    field,
    selectControl,
    splitFields,
    ListenerScope
} from "../../ui/panelSystem.js";
import { eventBus, events } from "../eventBus.js";
import { hasSelectedArea } from "../regionTrace.js";
import { clearSelection, isTracing, stopTraceMode } from "../regionTrace.js";
import {
    attachRegionTracingControls,
    buildRegionTracingMarkup
} from "./regionPanelTemplate.js";

const HORIZON_OPTIONS = [
    { value: "60", label: "Next 1 hour" },
    { value: "360", label: "Next 6 hours" },
    { value: "1440", label: "Next 24 hours", selected: true },
    { value: "4320", label: "Next 3 days" }
];

const MIN_ALTITUDE_OPTIONS = [
    { value: "0", label: "0 km", selected: true },
    { value: "100", label: "100 km" },
    { value: "250", label: "250 km" },
    { value: "500", label: "500 km" },
    { value: "1000", label: "1000 km" },
    { value: "2000", label: "2000 km" }
];

const MAX_ALTITUDE_OPTIONS = [
    { value: "2000", label: "2000 km" },
    { value: "5000", label: "5000 km" },
    { value: "10000", label: "10000 km" },
    { value: "42000", label: "42000 km", selected: true }
];

function buildSidebar() {
    const altitudeRange = field(
        "Altitude Range",
        splitFields([
            selectControl("minAltitudeSelect", MIN_ALTITUDE_OPTIONS, { ariaLabel: "Minimum altitude" }),
            selectControl("maxAltitudeSelect", MAX_ALTITUDE_OPTIONS, { ariaLabel: "Maximum altitude" })
        ])
    );

    return `
        ${field("Forecast Window", selectControl("horizonSelect", HORIZON_OPTIONS), { id: "horizonSelect" })}
        ${altitudeRange}
        
        <div class="section">
            <div class="section-title">Scan Proximity Radius</div>
            <div class="field">
                <select id="proximitySelect">
                    <option value="500">500 km</option>
                    <option value="1500" selected>1500 km</option>
                    <option value="custom">Custom radius...</option>
                </select>
            </div>
            <div class="field" id="customProximityContainer" style="display: none;">
                <label for="customProximityInput">Custom Radius (km)</label>
                <input id="customProximityInput" type="number" value="1000" min="1" max="10000" style="width: 100%; background: rgba(14, 25, 41, 0.9); color: var(--text-main); border: 1px solid rgba(111, 226, 255, 0.35); border-radius: 10px; padding: 10px 12px;">
            </div>
        </div>

        <div class="section">
            <div class="section-title">Geographic Target Selection</div>
            <div class="field">
                <label for="presetRegionTypeSelect">Selection Mode</label>
                <select id="presetRegionTypeSelect">
                    <option value="manual" selected>Manual Tracing (Draw on Globe)</option>
                    <option value="search">Search Location (OSM Geocoder)</option>
                </select>
            </div>
            
            <div class="field" id="geocoderSearchContainer" style="display: none; position: relative;">
                <label for="vsLocationSearchInput">Search City, State or Country</label>
                <div style="display: flex; gap: 4px; position: relative;">
                    <input type="text" id="vsLocationSearchInput" placeholder="Type to search globally..." autocomplete="off" style="width: 100%; background: rgba(14, 25, 41, 0.9); color: var(--text-main); border: 1px solid rgba(111, 226, 255, 0.35); border-radius: 10px; padding: 10px 12px; font-size: 14px;">
                    <div id="vsSearchSpinner" class="is-hidden" style="position: absolute; right: 12px; top: 12px; border: 2px solid rgba(111, 226, 255, 0.1); border-left-color: var(--accent); border-radius: 50%; width: 16px; height: 16px; animation: spin 1s linear infinite;"></div>
                </div>
                <div id="vsSearchSuggestions" style="position: absolute; width: 100%; top: 100%; left: 0; background: rgba(6, 15, 28, 0.96); border: 1px solid var(--panel-border); border-radius: 8px; margin-top: 4px; box-shadow: 0 10px 25px rgba(0,0,0,0.5); z-index: 100; max-height: 200px; overflow-y: auto; display: none;"></div>
            </div>
        </div>

        <div id="manualTracingControlsContainer">
            ${buildRegionTracingMarkup()}
        </div>
    `;
}

export function runVolumetricScan(ctx) {
    if (!appState.catalogLoaded) {
        setStatus("Satellite catalog is still loading.");
        return;
    }

    if (!hasSelectedArea()) {
        setStatus("Select or trace a region on the globe first.");
        return;
    }

    const horizonSelect = document.getElementById("horizonSelect");
    const minAltitudeSelect = document.getElementById("minAltitudeSelect");
    const maxAltitudeSelect = document.getElementById("maxAltitudeSelect");
    const proximitySelect = document.getElementById("proximitySelect");
    const customProximityInput = document.getElementById("customProximityInput");

    let proximityVal = 1500;
    if (proximitySelect) {
        if (proximitySelect.value === "custom") {
            const parsed = Number(customProximityInput?.value);
            proximityVal = (Number.isFinite(parsed) && parsed > 0) ? parsed : 1000;
        } else {
            proximityVal = Number(proximitySelect.value);
        }
    }

    appState.analysisInFlight = true;
    appState.analysisWorkerBusy = true;
    appState.activeSatellitePathId = null;

    // Display a professional orbital calculation loader spinner
    renderAnalysisLoader("Volumetric Scan", "Scanning 3D volumetric region for satellite passes...");

    fetchBackendRegionScan({
        area: appState.selectedArea,
        horizonMinutes: Number(horizonSelect?.value || 180),
        minAltitudeKm: Number(minAltitudeSelect?.value || 0),
        maxAltitudeKm: Number(maxAltitudeSelect?.value || 42000),
        proximityThresholdKm: proximityVal,
        time: Cesium.JulianDate.toDate(ctx.shared.viewer.clock.currentTime).toISOString()
    }, appState.catalogApiBaseUrl).then(async (response) => {
        appState.analysisInFlight = false;
        appState.analysisWorkerBusy = false;
        
        // NOISE REDUCTION: Hide all satellites except those relevant to the scanned region
        const relevantSats = new Set(response.result.passes.map(p => p.id));
        appState.volumetricScanActive = true;
        appState.volumetricRelevantSats = relevantSats;
        
        if (typeof ctx.shared.refreshSatelliteVisibility === "function") {
            ctx.shared.refreshSatelliteVisibility();
        }

        renderAreaAnalysis(response.result);
        drawPredictedPaths(response.result.topPaths);
        setStatus(`Volumetric scan complete. ${response.result.passes?.length || 0} passes identified within ${response.result.minAltitudeKm}-${response.result.maxAltitudeKm} km.`);
        await ctx.shared.refreshOperationalAlerts(response.apiBaseUrl);
    }).catch((error) => {
        appState.analysisInFlight = false;
        appState.analysisWorkerBusy = false;
        ctx.shared.handleAnalysisFailure("Backend volumetric scan", error?.message || "Unknown backend analysis error.");
    });
}

export default {
    id: "volumetric-scan",
    label: "Volumetric Scan",
    eyebrow: "Region Operations",
    description: "Trace a region and scan satellite passes within a defined altitude window.",
    dockEyebrow: "Region",
    dockLabel: "Volumetric Scan",
    status: "ready",
    mount(ctx) {
        const root = ctx.containers.sidebarRoot;
        root.innerHTML = buildSidebar();

        const scope = new ListenerScope();
        attachRegionTracingControls(scope, {
            onAnalyze: () => runVolumetricScan(ctx)
        });

        const reanalyzeOnChange = () => {
            if (hasSelectedArea() && !appState.activeSatellitePathId) {
                runVolumetricScan(ctx);
            }
        };

        const presetRegionTypeSelect = document.getElementById("presetRegionTypeSelect");
        const geocoderSearchContainer = document.getElementById("geocoderSearchContainer");
        const manualTracingControlsContainer = document.getElementById("manualTracingControlsContainer");
        const proximitySelect = document.getElementById("proximitySelect");
        const customProximityContainer = document.getElementById("customProximityContainer");
        const customProximityInput = document.getElementById("customProximityInput");

        const searchInput = document.getElementById("vsLocationSearchInput");
        const suggestionsBox = document.getElementById("vsSearchSuggestions");
        const spinner = document.getElementById("vsSearchSpinner");

        const generateCirclePoints = (centroid, radiusKm) => {
            const points = [];
            const earthRadius = 6371; // km
            const latRad = centroid.lat * Math.PI / 180;
            const lonRad = centroid.lon * Math.PI / 180;
            const dR = radiusKm / earthRadius;

            for (let i = 0; i < 360; i += 11.25) { // 32 points
                const angle = i * Math.PI / 180;
                const outLatRad = Math.asin(Math.sin(latRad) * Math.cos(dR) + Math.cos(latRad) * Math.sin(dR) * Math.cos(angle));
                const outLonRad = lonRad + Math.atan2(Math.sin(angle) * Math.sin(dR) * Math.cos(latRad), Math.cos(dR) - Math.sin(latRad) * Math.sin(outLatRad));
                points.push({
                    lat: outLatRad * 180 / Math.PI,
                    lon: outLonRad * 180 / Math.PI
                });
            }
            return points;
        };

        const updateProximityVisual = () => {
            if (!appState.selectedArea || !appState.selectedArea.centroid) return;
            
            let proximityVal = 1500;
            if (proximitySelect.value === "custom") {
                const parsed = Number(customProximityInput.value);
                proximityVal = (Number.isFinite(parsed) && parsed > 0) ? parsed : 1000;
            } else {
                proximityVal = Number(proximitySelect.value);
            }
            
            appState.selectedArea.points = generateCirclePoints(appState.selectedArea.centroid, proximityVal);
            updateSelectedAreaVisual(appState.selectedArea);
            updateAreaReadout();
        };

        // Event listener for proximity
        scope.add(proximitySelect, "change", () => {
            if (proximitySelect.value === "custom") {
                customProximityContainer.style.display = "block";
            } else {
                customProximityContainer.style.display = "none";
            }
            updateProximityVisual();
            reanalyzeOnChange();
        });
        let customProximityTimeout = null;
        scope.add(customProximityInput, "input", () => {
            clearTimeout(customProximityTimeout);
            customProximityTimeout = setTimeout(() => {
                updateProximityVisual();
                reanalyzeOnChange();
            }, 400);
        });
        scope.add(customProximityInput, "change", () => {
            clearTimeout(customProximityTimeout);
            updateProximityVisual();
            reanalyzeOnChange();
        });

        const updateSelectionMode = () => {
            const mode = presetRegionTypeSelect.value;
            if (mode === "manual") {
                geocoderSearchContainer.style.display = "none";
                manualTracingControlsContainer.style.display = "block";
            } else {
                geocoderSearchContainer.style.display = "block";
                manualTracingControlsContainer.style.display = "none";
                if (isTracing()) {
                    stopTraceMode(true);
                }
            }
        };
        scope.add(presetRegionTypeSelect, "change", updateSelectionMode);

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

            let proximityVal = 1500;
            if (proximitySelect.value === "custom") {
                const parsed = Number(customProximityInput.value);
                proximityVal = (Number.isFinite(parsed) && parsed > 0) ? parsed : 1000;
            } else {
                proximityVal = Number(proximitySelect.value);
            }

            const centroid = { lat: parseFloat(item.lat), lon: parseFloat(item.lon) };
            const points = generateCirclePoints(centroid, proximityVal);

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
            reanalyzeOnChange();
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

        scope.add(document.getElementById("horizonSelect"), "change", reanalyzeOnChange);
        scope.add(document.getElementById("minAltitudeSelect"), "change", reanalyzeOnChange);
        scope.add(document.getElementById("maxAltitudeSelect"), "change", reanalyzeOnChange);

        const unsubscribeArea = eventBus.on(events.areaSelected, () => {
            // Only auto-run if manual is selected to avoid resetting loops
            if (presetRegionTypeSelect.value === "manual") {
                runVolumetricScan(ctx);
            }
        });
        scope.addCleanup(unsubscribeArea);

        updateAreaReadout();

        return {
            unmount() {
                if (isTracing()) {
                    stopTraceMode(true);
                }
                clearSelection();
                
                // RESTORE NOISE REDUCTION
                appState.volumetricScanActive = false;
                appState.volumetricRelevantSats = null;
                if (typeof ctx.shared.refreshSatelliteVisibility === "function") {
                    ctx.shared.refreshSatelliteVisibility();
                }

                scope.dispose();
            }
        };
    }
};
