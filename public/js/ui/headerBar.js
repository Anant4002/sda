/**
 * ui/headerBar.js
 *
 * Thin status and default-analysis rendering helpers.
 * Extracted from the monolithic ui.js — exported via ui.js barrel.
 */

import { elements } from "../dom.js";
import { escapeHtml, safeHtml, computeBounds, formatLatitude, formatLongitude } from "../utils.js";
import { appState } from "../state.js";

export function setStatus(message) {
    if (!elements.statusLine) {
        return;
    }
    elements.statusLine.textContent = message;
}

export function renderDefaultAnalysis(
    title = "Selection Required",
    body = "Trace a region on the globe to analyze it, or click a satellite to toggle its one-orbit future path."
) {
    if (!elements.analysisPanel) {
        return;
    }
    elements.analysisPanel.innerHTML = safeHtml`
        <div class="eyebrow">Analysis</div>
        <h2>${escapeHtml(title)}</h2>
        <p class="hint">${escapeHtml(body)}</p>
    `;
}

export function updateAreaReadout() {
    if (!elements.areaReadout) {
        return;
    }

    if (appState.isTracingArea) {
        elements.areaReadout.textContent = `Tracing region: ${appState.tracePoints?.length ?? 0} points.`;
        return;
    }

    if (!appState.selectedArea) {
        elements.areaReadout.textContent = "";
        return;
    }

    if (computeBounds && formatLatitude && formatLongitude) {
        const bounds = computeBounds(appState.selectedArea.points);
        elements.areaReadout.textContent = `Selected region with ${appState.selectedArea.points.length} points. Bounds: ${formatLatitude(bounds.minLat)} to ${formatLatitude(bounds.maxLat)}, ${formatLongitude(bounds.minLon)} to ${formatLongitude(bounds.maxLon)}.`;
    }
}

export function renderAnalysisLoader(moduleName, description = "Running advanced orbital computations...") {
    if (!elements.analysisPanel) {
        return;
    }

    elements.analysisPanel.innerHTML = safeHtml`
        <div class="eyebrow">${escapeHtml(moduleName)}</div>
        <div class="loader-container">
            <div class="loader-spinner"></div>
            <div class="loader-text">Executing Analysis</div>
            <div class="loader-subtext">${escapeHtml(description)}</div>
        </div>
    `;
}
