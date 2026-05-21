import { appState } from "../state.js";
import { computeBounds } from "../utils.js";
import {
    clearPathEntities,
    clearTraceDraftVisual,
    updateSelectedAreaVisual,
    updateTraceDraftVisual
} from "../viewer.js";
import { setStatus, updateAreaReadout, updateCollisionAlert } from "../ui.js";
import { eventBus, events } from "./eventBus.js";

function buildSelectionFromTrace(points) {
    const centroid = points.reduce((accumulator, point) => ({
        lat: accumulator.lat + point.lat / points.length,
        lon: accumulator.lon + point.lon / points.length
    }), { lat: 0, lon: 0 });

    return {
        type: "polygon",
        points: [...points],
        centroid,
        bounds: computeBounds(points)
    };
}

export function getWorldPoint(viewer, screenPosition) {
    const cartesian = viewer.camera.pickEllipsoid(screenPosition, viewer.scene.globe.ellipsoid);
    if (!cartesian) {
        return null;
    }

    const cartographic = Cesium.Cartographic.fromCartesian(cartesian);
    return {
        lat: Cesium.Math.toDegrees(cartographic.latitude),
        lon: Cesium.Math.toDegrees(cartographic.longitude)
    };
}

export function appendTracePoint(point) {
    const previousPoint = appState.tracePoints[appState.tracePoints.length - 1];
    if (previousPoint) {
        const latDelta = Math.abs(previousPoint.lat - point.lat);
        const lonDelta = Math.abs(previousPoint.lon - point.lon);
        if (latDelta < 0.25 && lonDelta < 0.25) {
            return;
        }
    }

    appState.tracePoints.push(point);
    appState.tracePreviewPoint = null;
    updateTraceDraftVisual(appState.tracePoints);
    updateAreaReadout();
    eventBus.emit(events.traceModeChanged, { isTracing: true, pointCount: appState.tracePoints.length });
}

export function startTraceMode() {
    appState.isTraceModeEnabled = true;
    appState.isTracingArea = true;
    appState.tracePoints = [];
    appState.tracePreviewPoint = null;
    appState.selectedArea = null;
    clearPathEntities();
    updateSelectedAreaVisual(null);
    clearTraceDraftVisual();
    updateCollisionAlert();
    updateAreaReadout();
    setStatus("Trace mode enabled. Click points on the globe to outline a region, then press Finish Trace.");
    eventBus.emit(events.traceModeChanged, { isTracing: true, pointCount: 0 });
}

export function stopTraceMode(resetDraft = false) {
    appState.isTraceModeEnabled = false;
    appState.isTracingArea = false;
    appState.tracePreviewPoint = null;

    if (resetDraft) {
        appState.tracePoints = [];
        appState.selectedArea = null;
        updateSelectedAreaVisual(null);
        clearTraceDraftVisual();
    }

    updateAreaReadout();
    eventBus.emit(events.traceModeChanged, { isTracing: false, pointCount: appState.tracePoints.length });
}

export function finalizeTraceSelection() {
    if (appState.tracePoints.length < 3) {
        setStatus("Add at least three points before finishing the traced region.");
        return false;
    }

    appState.selectedArea = buildSelectionFromTrace(appState.tracePoints);
    appState.isTracingArea = false;
    appState.tracePreviewPoint = null;
    clearTraceDraftVisual();
    updateSelectedAreaVisual(appState.selectedArea);
    stopTraceMode(false);
    eventBus.emit(events.areaSelected, appState.selectedArea);
    return true;
}

export function clearSelection() {
    appState.selectedArea = null;
    appState.activeSatellitePathId = null;
    appState.tracePoints = [];
    appState.isTracingArea = false;
    appState.tracePreviewPoint = null;
    clearPathEntities();
    clearTraceDraftVisual();
    updateSelectedAreaVisual(appState.selectedArea);
    updateCollisionAlert();
    stopTraceMode(false);
    updateAreaReadout();
    setStatus("Selection cleared.");
    eventBus.emit(events.areaCleared);
}

export function isTracing() {
    return Boolean(appState.isTraceModeEnabled);
}

export function hasSelectedArea() {
    return Boolean(appState.selectedArea);
}

export function getSelectedArea() {
    return appState.selectedArea;
}
