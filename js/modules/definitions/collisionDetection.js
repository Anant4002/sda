import { fetchBackendConjunctionAnalysis } from "../../analysisService.js";
import { appState } from "../../state.js";
import {
    renderAreaAnalysis,
    setStatus,
    updateAreaReadout,
    updateCollisionAlert
} from "../../ui.js";
import { drawPredictedPaths } from "../../viewer.js";
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
        <div class="micro-card" style="margin-top:8px; font-size:0.85em; color: var(--text-dim);">
            High-risk conjunction escalation layer for Indian assets. Focuses on Pc, miss distance, relative velocity, and TCA.
        </div>
        ${buildRegionTracingMarkup()}
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

    setStatus("Running high-risk conjunction escalation...");
    
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
        const criticalAlerts = (response.result.conjunctions || [])
            .filter(c => c.severity === "critical" || c.collisionProbability > 1e-4);
        
        if (criticalAlerts.length > 0) {
            drawCollisionRiskMarkers(ctx.shared.viewer, criticalAlerts);
            setStatus(`CRITICAL: ${criticalAlerts.length} high-probability collision risks detected!`);
        } else {
            setStatus(`Escalation complete. ${response.result.conjunctions?.length || 0} conjunctions reviewed.`);
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

    setStatus(`Escalation review: ${conj.primaryId} (Pc: ${conj.collisionProbability.toExponential(2)})`);

    drawConjunctionEvent(conj);

    const tca = Cesium.JulianDate.fromIso8601(conj.time);
    ctx.shared.viewer.clock.currentTime = Cesium.JulianDate.addSeconds(tca, -60, new Cesium.JulianDate());
    ctx.shared.viewer.clock.shouldAnimate = true;
    ctx.shared.viewer.clock.multiplier = 5;

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
    description: "High-risk conjunction escalation for Indian assets and small-miss events.",
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

        scope.addCleanup(eventBus.on(events.areaSelected, () => runCollisionDetection(ctx)));

        updateAreaReadout();
        updateCollisionAlert(null);

        return {
            unmount() {
                clearCollisionMarkers(ctx.shared.viewer);
                scope.dispose();
            }
        };
    }
};
