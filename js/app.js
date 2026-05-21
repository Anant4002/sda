import {
    COLORS,
    NEIGHBOURHOOD_WATCH_THRESHOLD_KM,
    POSITION_UPDATE_INTERVAL_MS,
    SATELLITE_POINT_BATCH_SIZE
} from "./config.js";
import { fetchBackendNeighbourhoodWatch } from "./analysisService.js";
import {
    fetchSatelliteCatalog,
    fetchCatalogHistory,
    fetchCatalogStatus,
    fetchTleHistory,
    fetchDriftHistory,
    fetchManoeuvreHistory,
    runBatchCharacterisation,
    readCachedCatalog,
    writeCachedCatalog
} from "./catalogService.js";
import { fetchJsonWithFallback, postJsonWithFallback } from "./apiService.js";
import { fetchOperationalAlerts } from "./alertService.js";
import {
    fetchLatestRapidExecution,
    runRapidProcessingPipeline
} from "./rapidService.js";
import { elements } from "./dom.js";
import { appState } from "./state.js";
import { deriveSatelliteGroupLabel, escapeHtml } from "./utils.js";
import {
    viewer,
    satellitePoints,
    loadIndiaBoundaryOverlay,
    clearPathEntities,
    drawPredictedPaths,
    updateTraceDraftVisual,
    enterFocusedAnalysisMode,
    exitFocusedAnalysisMode,
    drawDriftTracks,
    clearDriftTracks
} from "./viewer.js";
import {
    renderCatalogStatus,
    renderDefaultAnalysis,
    renderDriftAnalytics,
    renderOperationalAlerts,
    renderSatelliteDirectory,
    renderSatellitePath,
    setStatus,
    updateAreaReadout,
    updateCollisionAlert
} from "./ui.js";
import { eventBus, events } from "./modules/eventBus.js";
import { moduleHost } from "./modules/moduleHost.js";
import { moduleDock } from "./modules/moduleDock.js";
import { registerAllModules } from "./modules/registerAllModules.js";
import {
    appendTracePoint,
    clearSelection,
    finalizeTraceSelection,
    getWorldPoint,
    isTracing
} from "./modules/regionTrace.js";

const trackingWorker = new Worker("js/worker.js");
const analysisWorker = new Worker("js/worker.js");

let catalogStatusSnapshot = null;
let catalogHistorySnapshot = [];
let alertsSnapshot = null;

// ============================================================================
// CORE SHARED ACTIONS
// ============================================================================

async function toggleSatellitePath(satelliteId) {
    if (appState.activeSatellitePathId === satelliteId) {
        appState.activeSatellitePathId = null;
        clearPathEntities();
        renderDefaultAnalysis();
        eventBus.emit(events.satelliteCleared);
        return;
    }

    const meta = appState.satelliteMetaMap.get(satelliteId);
    appState.activeSatellitePathId = satelliteId;
    setStatus(`Propagating orbit for ${satelliteId}...`);

    // Why: the path must start from the same propagation instant as the rendered satellite point or the orbit appears disconnected.
    const time = appState.simulationMode && appState.simulationClock
        ? appState.simulationClock.getTime()
        : Cesium.JulianDate.toDate(viewer.clock.currentTime).getTime();

    trackingWorker.postMessage({
        type: "satellitePath",
        id: satelliteId,
        noradId: meta?.noradId || null,
        time
    });

    eventBus.emit(events.satelliteSelected, satelliteId);
}

function hideSatelliteGroup(label) {
    if (appState.hiddenGroupLabels.has(label)) {
        appState.hiddenGroupLabels.delete(label);
    } else {
        appState.hiddenGroupLabels.add(label);
    }

    const satellites = appState.satellites;
    for (const satellite of satellites) {
        if (deriveSatelliteGroupLabel(satellite.name) === label) {
            const point = appState.pointMap.get(satellite.name);
            if (point) {
                point.show = !appState.hiddenGroupLabels.has(label);
            }
        }
    }

    renderSatelliteDirectory(toggleSatellitePath, hideSatelliteGroup, clearHiddenGroups);
}

function clearHiddenGroups() {
    appState.hiddenGroupLabels.clear();
    for (const point of appState.pointMap.values()) {
        point.show = true;
    }
    renderSatelliteDirectory(toggleSatellitePath, hideSatelliteGroup, clearHiddenGroups);
}

async function refreshCatalogSidebar() {
    try {
        const [statusRes, historyRes] = await Promise.all([
            fetchCatalogStatus(appState.catalogApiBaseUrl),
            fetchCatalogHistory(appState.catalogApiBaseUrl)
        ]);
        catalogStatusSnapshot = statusRes.status;
        catalogHistorySnapshot = historyRes.history;
        renderCatalogStatus(catalogStatusSnapshot, catalogHistorySnapshot);
        eventBus.emit(events.catalogStatusUpdated, { status: catalogStatusSnapshot, history: catalogHistorySnapshot });
    } catch (error) {
        console.warn("Failed to refresh catalog sidebar:", error);
    }
}

async function refreshOperationalAlerts(apiBaseUrl = null) {
    try {
        const alertsResponse = await fetchOperationalAlerts(apiBaseUrl || appState.catalogApiBaseUrl);
        alertsSnapshot = alertsResponse.alerts;
        renderOperationalAlerts(alertsSnapshot);
    } catch (error) {
        console.warn("Failed to refresh alerts:", error);
    }
}

function handleAnalysisFailure(task, message) {
    console.error(`[Analysis] ${task} failed: ${message}`);
    setStatus(`${task} failed. Check console for details.`);
    renderDefaultAnalysis("Analysis Error", message);
}

// ============================================================================
// APPLICATION INITIALIZATION
// ============================================================================
async function initializeApplication() {
    try {
        // Initialize module host with context
        moduleHost.init({
            containers: {
                sidebarRoot: elements.moduleSidebarRoot
            },
            shared: {
                // Utilities & API
                fetchDriftHistory,
                runBatchCharacterisation,
                postJsonWithFallback,
                refreshOperationalAlerts,
                handleAnalysisFailure,

                // Orchestration Actions
                toggleSatellitePath,
                hideSatelliteGroup,
                clearHiddenGroups,
                refreshCatalogSidebar,

                resetRealTimeClock: () => {
                    appState.realTimeMultiplier = 1;
                    appState.realTimeClock = new Date();
                    setStatus("Synchronized with real-time clock.");
                },

                // Visualization Actions
                viewer,
                enterFocusedAnalysisMode,
                exitFocusedAnalysisMode,
                clearPathEntities,
                drawDriftTracks,
                drawPredictedPaths,
                focusOnSatellite: async (id) => {
                    // Try to find in existing catalog first
                    let meta = appState.satelliteMetaMap.get(id);
                    if (!meta) {
                        // Refresh catalog if not found
                        const catalogResponse = await fetchSatelliteCatalog();
                        appState.satellites = catalogResponse.satellites || [];
                        await populateSatelliteScene(appState.satellites);
                        await updateWorkerCatalog(appState.satellites);
                        meta = appState.satelliteMetaMap.get(id);
                    }

                    if (meta) {
                        // Zoom to the point if it exists
                        const point = appState.pointMap.get(id);
                        if (point) {
                            viewer.zoomTo(point);
                        }
                        toggleSatellitePath(id);
                    }
                },

                // State Accessors
                get catalogStatusSnapshot() {
                    return catalogStatusSnapshot ? { status: catalogStatusSnapshot, history: catalogHistorySnapshot } : null;
                }
            }
        });

        // Register all operational modules
        registerAllModules();

        // Load satellite catalog
        setStatus("Loading satellite catalog...");
        let cached = readCachedCatalog();
        let satellites = cached?.satellites || [];
        let apiBaseUrl = cached?.apiBaseUrl;

        if (satellites.length === 0) {
            try {
                const catalogResponse = await fetchSatelliteCatalog();
                satellites = catalogResponse.satellites || [];
                apiBaseUrl = catalogResponse.apiBaseUrl;
                writeCachedCatalog(satellites, apiBaseUrl);
            } catch (error) {
                console.error("Failed to load satellite catalog:", error);
                setStatus("Failed to load satellite catalog. Check console for details.");
                return;
            }
        }

        appState.satellites = satellites;
        appState.catalogApiBaseUrl = apiBaseUrl;
        appState.catalogLoaded = true;
        eventBus.emit(events.catalogReady);

        setStatus(`Loaded ${satellites.length} satellites`);

        // Populate satellite scene
        await populateSatelliteScene(satellites);

        // Load India boundary overlay
        try {
            await loadIndiaBoundaryOverlay(setStatus);
        } catch (error) {
            console.warn("Failed to load India boundary overlay:", error);
        }

        // Initialize workers with satellite catalog
        const initializeWorker = (worker, tles) => {
            return new Promise((resolve) => {
                const readyHandler = (event) => {
                    if (event.data.type === "ready") {
                        worker.removeEventListener("message", readyHandler);
                        resolve();
                    }
                };
                worker.addEventListener("message", readyHandler);
                worker.postMessage({ type: "init", tles });
            });
        };

        try {
            await Promise.all([
                initializeWorker(trackingWorker, satellites),
                initializeWorker(analysisWorker, satellites)
            ]);
            appState.trackingWorkerReady = true;
            appState.analysisWorkerReady = true;
        } catch (error) {
            console.warn("Worker initialization failed:", error);
        }

        // Set up worker message handlers
        trackingWorker.onmessage = (event) => {
            if (event.data.type === "positions" && Array.isArray(event.data.positions)) {
                for (const pos of event.data.positions) {
                    const point = appState.pointMap.get(pos.id);
                    if (point) {
                        point.position = Cesium.Cartesian3.fromDegrees(pos.lon, pos.lat, pos.alt);
                    }
                }
                viewer.scene.requestRender();
                appState.workerUpdateInFlight = false;
            } else if (event.data.type === "satellitePath") {
                const paths = Array.isArray(event.data.result) ? event.data.result : [event.data.result];
                drawPredictedPaths(paths);
                renderSatellitePath(paths[0]); // Use first segment for metadata summary
                setStatus(`Orbit rendered for ${paths[0].id}`);
            }
        };

        analysisWorker.onmessage = (event) => {
            if (event.data.type === "error") {
                console.warn(`Analysis worker error:`, event.data.error);
            }
        };

        // Start position update loop
        let lastRealTime = Date.now();
        const updatePositions = () => {

            const now = Date.now();
            const elapsedRealMs = now - lastRealTime;
            lastRealTime = now;

            // Advance the clock regardless of worker state to keep UI/Timeline fluid
            if (!appState.simulationMode) {
                if (!appState.realTimeClock) appState.realTimeClock = new Date();
                const multiplier = appState.realTimeMultiplier !== undefined ? appState.realTimeMultiplier : 1;
                appState.realTimeClock = new Date(appState.realTimeClock.getTime() + elapsedRealMs * multiplier);
            }

            const simTime = appState.simulationMode && appState.simulationClock
                ? appState.simulationClock
                : appState.realTimeClock;

            const time = simTime.getTime();

            // Sync Cesium clock with propagation time
            const julian = Cesium.JulianDate.fromDate(simTime);
            viewer.clock.currentTime = julian;
            viewer.scene.requestRender();

            // Only post to worker if it's ready and not currently processing
            if (appState.trackingWorkerReady && !appState.workerUpdateInFlight) {
                appState.workerUpdateInFlight = true;
                // Debug: log current time-driving state to help diagnose lingering simulation-rate updates
                try {
                    console.debug("[PositionUpdate] Posting to worker", {
                        simulationMode: appState.simulationMode,
                        simulationPaused: appState.simulationPaused,
                        simulationSpeed: appState.simulationSpeed,
                        realTimeMultiplier: appState.realTimeMultiplier,
                        simTime: new Date(time).toISOString()
                    });
                } catch (e) {}

                trackingWorker.postMessage({
                    type: "update",
                    time
                });
            }
        };

        setInterval(updatePositions, POSITION_UPDATE_INTERVAL_MS);

        // Trigger initial position update to show satellites immediately
        updatePositions();

        // Ensure an immediate resync when a simulation is stopped so we don't
        // accidentally continue posting simulation-time updates to the worker.
        eventBus.on(events.SIMULATION_STOPPED, () => {
            try {
                // Ensure appState and viewer are decisively returned to live playback
                appState.simulationMode = false;
                appState.simulationPaused = true;
                appState.simulationClock = null;
                appState.simulationSpeed = 1.0;

                appState.realTimeMultiplier = 1;
                appState.realTimeClock = new Date();

                if (viewer && viewer.clock) {
                    try {
                        viewer.clock.multiplier = 1.0;
                        viewer.clock.currentTime = Cesium.JulianDate.fromDate(appState.realTimeClock);
                        viewer.clock.shouldAnimate = true;
                    } catch (e) {
                        // ignore
                    }
                }

                lastRealTime = Date.now();
                // Force an immediate positions update to sync the worker with real-time now
                updatePositions();
            } catch (e) {
                console.warn("Failed to resync positions after simulation stop:", e);
            }
        });

        // Load initial data
        refreshCatalogSidebar();
        refreshOperationalAlerts();

        // Auto-refresh catalog and alerts every 10 minutes
        setInterval(() => {
            refreshCatalogSidebar();
            refreshOperationalAlerts();
        }, 10 * 60 * 1000);

        // Set up event listeners
        if (elements.controlsToggle) {
            elements.controlsToggle.addEventListener("click", () => {
                elements.controlsPanel.classList.toggle("collapsed");
                elements.controlsToggle.textContent = elements.controlsPanel.classList.contains("collapsed") ? "Expand" : "Minimize";
                elements.controlsToggle.setAttribute("aria-expanded", !elements.controlsPanel.classList.contains("collapsed"));
            });
        }

        if (elements.moduleDockToggle) {
            elements.moduleDockToggle.addEventListener("click", () => {
                elements.moduleDockContainer.classList.toggle("collapsed");
                elements.moduleDockToggle.textContent = elements.moduleDockContainer.classList.contains("collapsed") ? "Show Dock" : "Hide Dock";
            });
        }

        // Cesium ScreenSpaceEventHandler for interaction
        const handler = new Cesium.ScreenSpaceEventHandler(viewer.scene.canvas);

        handler.setInputAction((click) => {
            if (isTracing()) {
                const point = getWorldPoint(viewer, click.position);
                if (point) {
                    appendTracePoint(point);
                }
                return;
            }

            const pickedObject = viewer.scene.pick(click.position);
            if (Cesium.defined(pickedObject) && pickedObject.primitive instanceof Cesium.PointPrimitive) {
                const satelliteId = pickedObject.id;
                toggleSatellitePath(satelliteId);
            } else {
                // Clicked on empty space, clear selection if not tracing
                if (appState.activeSatellitePathId || appState.selectedArea) {
                    clearSelection();
                    renderDefaultAnalysis();
                    eventBus.emit(events.satelliteCleared);
                }
            }
        }, Cesium.ScreenSpaceEventType.LEFT_CLICK);

        handler.setInputAction((movement) => {
            if (isTracing() && appState.tracePoints.length > 0) {
                const point = getWorldPoint(viewer, movement.endPosition);
                if (point) {
                    updateTraceDraftVisual(appState.tracePoints, point);
                }
            }

            // Satellite Hover Tooltip
            const pickedObject = viewer.scene.pick(movement.endPosition);
            if (Cesium.defined(pickedObject) && pickedObject.primitive instanceof Cesium.PointPrimitive) {
                const id = pickedObject.id;
                // Only show tooltip if it's actually a satellite (ID is a string in our point map)
                if (typeof id === "string" && appState.pointMap.has(id)) {
                    const satelliteId = id;
                    const meta = appState.satelliteMetaMap.get(satelliteId);

                    if (elements.hoverPanel) {
                        const statusLabel = meta?.isIndian ? '<span style="color: #ff5ea8;">[INDIAN ASSET]</span>' : "Active Satellite";

                        elements.hoverPanel.innerHTML = `
                            <div style="font-weight: bold; font-size: 1.1em; color: var(--text-bright); margin-bottom: 4px;">${escapeHtml(satelliteId)}</div>
                            <div style="font-size: 0.85em; color: var(--text-dim);">
                                ${statusLabel}<br>
                                Source: ${escapeHtml(meta?.dataSource || "N/A")}<br>
                                NORAD: ${meta?.noradId || "N/A"}<br>
                                ${meta?.intData ? `<div style="margin-top:4px; border-top: 1px solid rgba(255,255,255,0.1); padding-top:4px; font-style: italic;">INT: ${escapeHtml(meta.intData)}</div>` : ""}
                            </div>
                        `;
                        elements.hoverPanel.style.display = "block";
                        elements.hoverPanel.style.left = `${movement.endPosition.x + 15}px`;
                        elements.hoverPanel.style.top = `${movement.endPosition.y + 15}px`;
                    }
                }
            } else {
                if (elements.hoverPanel) {
                    elements.hoverPanel.style.display = "none";
                }
            }
        }, Cesium.ScreenSpaceEventType.MOUSE_MOVE);

        handler.setInputAction(() => {
            if (isTracing() && appState.tracePoints.length >= 3) {
                finalizeTraceSelection();
            }
        }, Cesium.ScreenSpaceEventType.LEFT_DOUBLE_CLICK);

        // Global Event Bus Listeners
        eventBus.on(events.alertsUpdated, () => refreshOperationalAlerts());
        eventBus.on(events.moduleDeactivated, () => {
            clearSelection();
            renderDefaultAnalysis();
        });

        // Initialize module dock
        await moduleDock.init("mission-control");

        setStatus(`Ready. ${satellites.length} satellites loaded.`);
    } catch (error) {
        console.error("Application initialization failed:", error);
        setStatus("Application initialization failed. Check console for details.");
    }
}

async function populateSatelliteScene(satellites) {
    satellitePoints.removeAll();
    appState.pointMap.clear();
    appState.satelliteMetaMap.clear();

    for (let index = 0; index < satellites.length; index += SATELLITE_POINT_BATCH_SIZE) {
        const batch = satellites.slice(index, index + SATELLITE_POINT_BATCH_SIZE);
        for (const satellite of batch) {
            appState.satelliteMetaMap.set(satellite.name, satellite);
            const groupLabel = deriveSatelliteGroupLabel(satellite.name);
            const isHidden = appState.hiddenGroupLabels.has(groupLabel);

            const point = satellitePoints.add({
                pixelSize: satellite.isIndian ? 6.5 : 5,
                color: Cesium.Color.fromCssColorString(
                    satellite.isIndian ? COLORS.indianSatellite : COLORS.otherSatellite
                ),
                id: satellite.name,
                show: !isHidden
            });

            appState.pointMap.set(satellite.name, point);
        }
    }
}

async function updateWorkerCatalog(satellites) {
    if (appState.trackingWorkerReady) {
        trackingWorker.postMessage({ type: "init", tles: satellites });
    }
    if (appState.analysisWorkerReady) {
        analysisWorker.postMessage({ type: "init", tles: satellites });
    }
}

// Start the application when the DOM is ready
if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", initializeApplication);
} else {
    initializeApplication();
}
