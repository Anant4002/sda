import { appState } from "../../state.js";
import { setStatus } from "../../ui.js";
import {
    clearSelection,
    finalizeTraceSelection,
    isTracing,
    startTraceMode,
    stopTraceMode
} from "../regionTrace.js";
import { eventBus, events } from "../eventBus.js";

export function buildRegionTracingMarkup() {
    return `
        <div class="split">
            <button id="traceAreaButton" class="secondary" type="button">Trace Region</button>
            <button id="analyzeButton" type="button">Analyze Region</button>
        </div>
        <div class="field">
            <label>Region Tracing</label>
            <div class="trace-chip">1. Click <strong>Trace Region</strong> 2. Click points on the globe 3. Press <strong>Finish Trace</strong></div>
            <div id="areaReadout" class="readout">Click Trace Region, then click point by point on the globe to outline any custom shape you want to analyze.</div>
        </div>
        <div class="split">
            <button id="clearButton" class="secondary" type="button">Clear Selection</button>
            <button id="finishTraceButton" class="secondary" type="button" disabled>Finish Trace</button>
        </div>
    `;
}

export function attachRegionTracingControls(scope, { onAnalyze }) {
    const traceButton = document.getElementById("traceAreaButton");
    const finishButton = document.getElementById("finishTraceButton");
    const clearButton = document.getElementById("clearButton");
    const analyzeButton = document.getElementById("analyzeButton");

    function syncButtons() {
        if (traceButton) {
            const tracingNow = isTracing();
            traceButton.textContent = tracingNow ? "Tracing Enabled" : "Trace Region";
            traceButton.classList.toggle("secondary", !tracingNow);
        }
        if (finishButton) {
            finishButton.disabled = !(appState.isTraceModeEnabled && appState.tracePoints.length >= 3);
        }
    }

    scope.add(traceButton, "click", () => {
        if (isTracing()) {
            stopTraceMode(true);
            setStatus("Trace mode disabled.");
        } else {
            startTraceMode();
        }
        syncButtons();
    });

    scope.add(finishButton, "click", () => {
        finalizeTraceSelection();
        syncButtons();
    });

    scope.add(clearButton, "click", () => {
        clearSelection();
        syncButtons();
    });

    scope.add(analyzeButton, "click", () => {
        if (appState.isTraceModeEnabled && appState.tracePoints.length >= 3) {
            finalizeTraceSelection();
            // Fall through to run analysis immediately after finalizing
        }
        if (typeof onAnalyze === "function") {
            onAnalyze();
        }
    });

    const unsubscribeTrace = eventBus.on(events.traceModeChanged, syncButtons);
    const unsubscribeArea = eventBus.on(events.areaSelected, syncButtons);
    const unsubscribeCleared = eventBus.on(events.areaCleared, syncButtons);
    scope.addCleanup(unsubscribeTrace);
    scope.addCleanup(unsubscribeArea);
    scope.addCleanup(unsubscribeCleared);

    syncButtons();
}
