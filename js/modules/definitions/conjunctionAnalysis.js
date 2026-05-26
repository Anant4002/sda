import { fetchBackendConjunctionAnalysis } from "../../analysisService.js";
import { appState } from "../../state.js";
import {
    renderAreaAnalysis,
    setStatus,
    updateAreaReadout,
    updateCollisionAlert
} from "../../ui.js";
import { drawConjunctionEvent, clearConjunctionVisuals } from "../../viewer.js";
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
    { value: "geo", label: "GEO (>30000 km)" }
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
            <div class="section-title">Geographic Filter (Optional)</div>
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

    setStatus("Running global operational conjunction screening...");

    const filters = {
        assetFilter: assetFilterSelect?.value || "all",
        indianOnly: assetFilterSelect?.value === "indian"
    };

    // Altitude band
    const altBand = document.getElementById("altitudeSelect")?.value || "all";
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
