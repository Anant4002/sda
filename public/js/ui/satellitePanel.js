/**
 * ui/satellitePanel.js
 *
 * Satellite-specific panel renderers: detail panel, list items, collision alert.
 * Extracted from the monolithic ui.js — exported via ui.js barrel.
 */

import { elements } from "../dom.js";
import { appState } from "../state.js";
import { escapeHtml, safeHtml, markSafe, formatDateTime, formatNumber } from "../utils.js";

// Collision alert state

function getCollisionAlertState(conjunctions, thresholdKm) {
    if (!Array.isArray(conjunctions) || !conjunctions.length) {
        return { level: "clear", label: "Clear" };
    }

    const top = conjunctions[0];
    const nearestDistanceKm = top.closestDistanceKm;
    const pc = top.collisionProbability;

    if ((Number.isFinite(pc) && pc > 1e-4) || nearestDistanceKm <= Math.max(5, thresholdKm * 0.35)) {
        return { level: "active", label: "Critical" };
    }

    return { level: "monitor", label: "Monitor" };
}

// Collision alert card

export function updateCollisionAlert(result = null) {
    if (!elements.collisionAlertCard || !elements.collisionAlertBadge || !elements.collisionAlertSummary) {
        return;
    }
    elements.collisionAlertCard.classList.remove("alert-active", "alert-monitor", "alert-critical", "alert-high", "alert-medium");
    elements.collisionAlertBadge.classList.remove("alert-active", "alert-monitor", "alert-critical", "alert-high", "alert-medium");

    if (!result || !result.conjunctions || result.conjunctions.length === 0) {
        elements.collisionAlertBadge.textContent = "Clear";
        elements.collisionAlertSummary.textContent = "Run collision screening to evaluate orbital close-approach risks.";
        return;
    }

    const top = result.conjunctions[0];
    const severity = top.severity || "informational";

    elements.collisionAlertBadge.textContent = severity.toUpperCase();

    if (severity !== "informational") {
        const classMap = { critical: "active", high: "active", medium: "monitor" };
        elements.collisionAlertCard.classList.add(`alert-${classMap[severity] || "monitor"}`);
        elements.collisionAlertBadge.classList.add(`alert-${classMap[severity] || "monitor"}`);
    }

    const pcFormatted = Number.isFinite(top.collisionProbability)
        ? (top.collisionProbability < 1e-7 ? " < 1e-7" : top.collisionProbability.toExponential(2))
        : "N/A";

    elements.collisionAlertSummary.innerHTML = safeHtml`
        ${result.conjunctions.length} collision threats detected.<br>
        Top Threat: <strong>${escapeHtml(top.primaryId)} / ${escapeHtml(top.secondaryId)}</strong><br>
        Severity: <span style="color: currentColor">${severity.toUpperCase()}</span> | Miss: ${formatNumber(top.closestDistanceKm, 2)} km | Pc: ${pcFormatted}
    `;
}

// Backward-compat alias
export const renderCollisionAlert = updateCollisionAlert;

// Satellite detail panel

export function renderSatellitePath(result) {
    if (!elements.analysisPanel) return;

    const meta = appState.satellites.find(s => s.name === result.id) || {};
    const char = meta.characterisation || {};
    const orbitBadge = char.orbitClass ? markSafe(`<span class="badge badge-outline">${escapeHtml(char.orbitClass)}</span>`) : "";
    const typeBadge = char.objectType ? markSafe(`<span class="badge badge-outline">${escapeHtml(char.objectType)}</span>`) : "";
    const statusBadge = char.operationalStatus ? markSafe(`<span class="badge ${char.operationalStatus === "Active" ? "badge-success" : "badge-warning"}">${escapeHtml(char.operationalStatus)}</span>`) : "";

    // New characterisation badges (Phase-1 additions)
    const tierBadge = char.threatTier ? markSafe(`<span class="badge badge-outline">${escapeHtml(char.threatTier)}</span>`) : "";
    const spectralBadge = char.spectralType && char.spectralType !== "UNKNOWN"
        ? markSafe(`<span class="badge badge-outline">${escapeHtml(char.spectralType.replace(/_/g, " "))}</span>`)
        : "";
    const dragBadge = char.estimatedDragClass && char.estimatedDragClass !== "UNKNOWN_DRAG"
        ? markSafe(`<span class="badge badge-outline">${escapeHtml(char.estimatedDragClass.replace(/_/g, " "))}</span>`)
        : "";
    const polBadge = char.patternOfLifeLabel && char.patternOfLifeLabel !== "INSUFFICIENT_DATA"
        ? markSafe(`<span class="badge badge-outline">${escapeHtml(char.patternOfLifeLabel)}</span>`)
        : "";

    elements.analysisPanel.innerHTML = safeHtml`
        <div class="eyebrow">Satellite Track</div>
        <h2>${escapeHtml(result.id)}${result.isIndian ? " [IND]" : ""}</h2>

        <div class="badge-row" style="margin-bottom: 12px;">
            ${orbitBadge}
            ${typeBadge}
            ${statusBadge}
            ${tierBadge}
            ${spectralBadge}
            ${dragBadge}
            ${polBadge}
        </div>

        <p>Click the same satellite again to remove the highlighted track.</p>

        <div class="metric-grid">
            <div class="metric-card">
                <div class="label">Orbit Window</div>
                <div class="value">${formatNumber(result.orbitMinutes, 1)}m</div>
            </div>
            <div class="metric-card">
                <div class="label">Track Points</div>
                <div class="value">${result.samples.length}</div>
            </div>
            <div class="metric-card">
                <div class="label">Start Altitude</div>
                <div class="value">${formatNumber(result.startAltKm, 0)} km</div>
            </div>
            <div class="metric-card">
                <div class="label">End Altitude</div>
                <div class="value">${formatNumber(result.endAltKm, 0)} km</div>
            </div>
        </div>


        ${char.threatTier ? markSafe(`
<div class="section">
    <div class="section-title">Object Characterisation (Phase-1)</div>
    <div class="micro-card" style="font-size: 12.5px; line-height: 1.5;">
        <strong>Threat Tier:</strong> ${escapeHtml(char.threatTier)} — ${escapeHtml(char.tierRationale || "")}<br>
        <strong>Spectral Type:</strong> ${escapeHtml(char.spectralType || "Unknown")} — ${escapeHtml(char.spectralRationale || "")}<br>
        <strong>Drag Profile:</strong> ${escapeHtml(char.estimatedDragClass || "Unknown")}<br>
        <strong>Pattern-of-Life:</strong> ${escapeHtml(char.patternOfLifeLabel || "N/A")}
    </div>
</div>
`) : ""}



        <div class="section">
            <div class="section-title">Track Summary</div>
            <div class="list">
                <div class="list-item">
                    <strong>Propagation Timing</strong><br>
                    Start: ${formatDateTime(result.startTime)}<br>
                    End: ${formatDateTime(result.endTime)}
                </div>
                <div class="list-item ${result.isIndian ? "indian" : ""}">
                    <strong>Asset Information</strong><br>
                    ${result.isIndian ? "Identified as an Indian National Asset." : "Registered as an active foreign payload/object."}
                </div>
            </div>
        </div>

        <div class="section">
            <div class="section-title">Interaction</div>
            <div class="micro-card">
                Click the same satellite again to remove the orbit line, or trace a region on the globe to return to region analysis.
            </div>
        </div>
    `;
}

export function renderSatelliteDetailPanel(satellite, conjunctions = []) {
    // Delegate to renderSatellitePath — kept for API compat
    renderSatellitePath(satellite);
}

export function renderSatelliteListItem(sat) {
    const char = sat.characterisation || {};
    return `
        <div class="filter-item">
            <button class="sat-item filter-item-main" data-satellite-id="${escapeHtml(sat.name || "")}">
                ${escapeHtml(sat.name || "Unknown")}
                <div class="badge-row" style="margin-top: 4px;">
                    ${char.orbitClass ? `<span class="badge badge-outline">${escapeHtml(char.orbitClass)}</span>` : ""}
                    ${char.objectType && char.objectType.toUpperCase() !== "PAYLOAD" ? `<span class="badge badge-outline">${escapeHtml(char.objectType)}</span>` : ""}
                    ${char.operationalStatus ? `<span class="badge ${char.operationalStatus === "Active" ? "badge-success" : "badge-warning"}">${escapeHtml(char.operationalStatus)}</span>` : ""}
                    ${char.threatTier ? `<span class="badge badge-outline">${escapeHtml(char.threatTier)}</span>` : ""}
                </div>
            </button>
        </div>
    `;
}
