import { fetchBackendRegionScan } from "../../analysisService.js";
import { appState } from "../../state.js";
import {
    renderAreaAnalysis,
    setStatus,
    updateAreaReadout,
    updateCollisionAlert
} from "../../ui.js";
import { drawPredictedPaths } from "../../viewer.js";
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

const COLLISION_THRESHOLD_OPTIONS = [
    { value: "5", label: "5 km" },
    { value: "10", label: "10 km" },
    { value: "25", label: "25 km", selected: true },
    { value: "50", label: "50 km" },
    { value: "100", label: "100 km" }
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
        ${buildRegionTracingMarkup()}
    `;
}

export function runVolumetricScan(ctx) {
    if (!appState.catalogLoaded) {
        setStatus("Satellite catalog is still loading.");
        return;
    }

    if (!hasSelectedArea()) {
        setStatus("Trace a region on the globe first.");
        return;
    }

    const horizonSelect = document.getElementById("horizonSelect");
    const minAltitudeSelect = document.getElementById("minAltitudeSelect");
    const maxAltitudeSelect = document.getElementById("maxAltitudeSelect");

    appState.analysisInFlight = true;
    appState.analysisWorkerBusy = true;
    appState.activeSatellitePathId = null;

    setStatus("Running backend volumetric scan for the traced region...");
    fetchBackendRegionScan({
        area: appState.selectedArea,
        horizonMinutes: Number(horizonSelect?.value || 180),
        minAltitudeKm: Number(minAltitudeSelect?.value || 0),
        maxAltitudeKm: Number(maxAltitudeSelect?.value || 42000),
        proximityThresholdKm: 0, // Not used for volumetric pass detection logic
        time: Cesium.JulianDate.toDate(ctx.shared.viewer.clock.currentTime).toISOString()
    }, appState.catalogApiBaseUrl).then(async (response) => {
        appState.analysisInFlight = false;
        appState.analysisWorkerBusy = false;
        renderAreaAnalysis(response.result);
        drawPredictedPaths(response.result.topPaths);
        setStatus(`Volumetric scan complete for the traced region within ${response.result.minAltitudeKm}-${response.result.maxAltitudeKm} km altitude.`);
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

        scope.add(document.getElementById("horizonSelect"), "change", reanalyzeOnChange);
        scope.add(document.getElementById("minAltitudeSelect"), "change", reanalyzeOnChange);
        scope.add(document.getElementById("maxAltitudeSelect"), "change", reanalyzeOnChange);

        const unsubscribeArea = eventBus.on(events.areaSelected, () => runVolumetricScan(ctx));
        scope.addCleanup(unsubscribeArea);

        updateAreaReadout();

        return {
            unmount() {
                if (isTracing()) {
                    stopTraceMode(true);
                }
                clearSelection();
                scope.dispose();
            }
        };
    }
};
