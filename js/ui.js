import { SATELLITE_FILTER_RESULT_LIMIT } from "./config.js";
import { elements } from "./dom.js";
import { appState } from "./state.js";
import {
    buildSatelliteGroups,
    computeBounds,
    escapeHtml,
    isCommercialSatelliteName,
    safeHtml,
    formatDateTime,
    formatLatitude,
    formatLongitude,
    formatNumber,
    markSafe,
    normalizeSearchValue
} from "./utils.js";

function getCollisionAlertState(conjunctions, thresholdKm) {
    if (!Array.isArray(conjunctions) || !conjunctions.length) {
        return {
            level: "clear",
            label: "Clear"
        };
    }

    const top = conjunctions[0];
    const nearestDistanceKm = top.closestDistanceKm;
    const pc = top.collisionProbability;

    // Industry standard: Pc > 1e-4 is CRITICAL. Distance < 35% of threshold is also CRITICAL.
    if ((Number.isFinite(pc) && pc > 1e-4) || nearestDistanceKm <= Math.max(5, thresholdKm * 0.35)) {
        return {
            level: "active",
            label: "Critical"
        };
    }

    return {
        level: "monitor",
        label: "Monitor"
    };
}

function getAreaAlerts(result) {
    if (!result) {
        return [];
    }

    if (Array.isArray(result.alerts)) {
        return result.alerts;
    }

    if (Array.isArray(result.conjunctions)) {
        return result.conjunctions;
    }

    return [];
}

function buildList(items, emptyMessage, className = "") {
    if (!items.length) {
        return markSafe(`<div class="hint">${escapeHtml(emptyMessage)}</div>`);
    }

    return markSafe(`<div class="list">${items.map((item) => `<div class="list-item ${className}">${item}</div>`).join("")}</div>`);
}

export function setStatus(message) {
    if (!elements.statusLine) {
        return;
    }
    elements.statusLine.textContent = message;
}

export function renderDefaultAnalysis(title = "Selection Required", body = "Trace a region on the globe to analyze it, or click a satellite to toggle its one-orbit future path.") {
    if (!elements.analysisPanel) {
        return;
    }
    elements.analysisPanel.innerHTML = safeHtml`
        <div class="eyebrow">Analysis</div>
        <h2>${escapeHtml(title)}</h2>
        <p class="hint">${escapeHtml(body)}</p>
    `;
}

function formatDataAge(ageSeconds) {
    if (!Number.isFinite(ageSeconds) || ageSeconds < 0) {
        return "Unknown";
    }

    if (ageSeconds < 60) {
        return `${Math.max(1, Math.round(ageSeconds))}s`;
    }

    const minutes = Math.floor(ageSeconds / 60);
    if (minutes < 60) {
        return `${minutes}m`;
    }

    const hours = Math.floor(minutes / 60);
    const remainingMinutes = minutes % 60;
    return remainingMinutes ? `${hours}h ${remainingMinutes}m` : `${hours}h`;
}

export function renderCatalogStatus(status = null, history = []) {
    if (!elements.catalogStatusSummary || !elements.catalogHistoryList) {
        return;
    }
    if (!status) {
        elements.catalogStatusSummary.textContent = "Catalog status unavailable.";
    } else {
        const latestVersion = status.latestVersion || {};
        const syncTime = latestVersion.syncedAt ? formatDateTime(latestVersion.syncedAt) : "Unknown";
        const freshness = formatDataAge(status.dataAgeSeconds);
        const sourceName = latestVersion.sourceName || "Unknown source";

        let schedulerHtml = "";
        if (status.scheduler) {
            const nextSync = status.scheduler.nextScheduledSync ? formatDateTime(status.scheduler.nextScheduledSync) : "Unknown";
            const schedulerState = status.scheduler.status || "Unknown";
            
            // Map state to CSS severity classes
            const stateSeverityMap = {
                HEALTHY: "success",
                SYNCING: "info",
                STALE: "warning",
                DEGRADED: "warning",
                RECOVERING: "warning",
                FAILED: "danger"
            };
            const severityClass = stateSeverityMap[schedulerState] || "info";

            schedulerHtml = `
            <div style="margin-top: 8px; padding-top: 8px; border-top: 1px solid var(--border-color);">
                <strong>Scheduler</strong>: <span class="badge badge-${severityClass}">${escapeHtml(schedulerState)}</span><br>
                <strong>Next Sync</strong>: ${escapeHtml(nextSync)}
            </div>`;

            if (status.scheduler.consecutiveFailures > 0) {
                schedulerHtml += `
                <div style="margin-top: 4px; font-size: 0.85em; color: var(--severity-danger);">
                    ⚠️ ${status.scheduler.consecutiveFailures} consecutive failure(s).<br>
                    <span style="opacity: 0.8;">Reason: ${escapeHtml(status.scheduler.lastFailureReason || "Unknown Error")}</span>
                </div>`;
            }
        }

        elements.catalogStatusSummary.innerHTML = safeHtml`
            <strong>Freshness</strong>: ${escapeHtml(freshness)} old<br>
            <strong>Records</strong>: ${formatNumber(status.currentCount || 0, 0)}<br>
            <strong>Last Sync</strong>: ${escapeHtml(syncTime)}<br>
            <strong>Source</strong>: ${escapeHtml(sourceName)}
        ` + schedulerHtml;
    }

    if (!history.length) {
        elements.catalogHistoryList.innerHTML = status
            ? `<div class="hint">No recent sync history found.</div>`
            : `<div class="hint">No sync history available.</div>`;
        return;
    }

    // Only show the single most recent sync entry in the sidebar.
    // Ensure we pick the freshest entry by `syncedAt` in case `history` is not ordered.
    let entriesToShow = [];
    if (history.length) {
        try {
            const latest = history.reduce((a, b) => {
                const ta = a && a.syncedAt ? new Date(a.syncedAt).getTime() : 0;
                const tb = b && b.syncedAt ? new Date(b.syncedAt).getTime() : 0;
                return tb > ta ? b : a;
            }, history[0]);
            entriesToShow = [latest];
        } catch (e) {
            // Fallback to first entry if anything goes wrong parsing dates
            entriesToShow = [history[0]];
        }
    }

    elements.catalogHistoryList.innerHTML = entriesToShow.map((entry) => {
        const syncedAt = entry.syncedAt ? formatDateTime(entry.syncedAt) : "Unknown time";
        const recordCount = Number.isFinite(entry.recordCount) ? formatNumber(entry.recordCount, 0) : "0";
        const stateLabel = entry.status ? String(entry.status).toUpperCase() : "UNKNOWN";
        const itemClass = entry.status === "success" ? "success" : "danger";

        return `
            <div class="list-item ${itemClass}">
                <strong>${escapeHtml(syncedAt)}</strong>
                ${escapeHtml(stateLabel)} | ${recordCount} records<br>
                ${escapeHtml(entry.sourceName || "Unknown source")}
            </div>
        `;
    }).join("");
}

export function renderOperationalAlerts(alerts = []) {
    if (!elements.operationalAlertSummary || !elements.operationalAlertList) {
        return;
    }
    if (!Array.isArray(alerts) || !alerts.length) {
        elements.operationalAlertSummary.textContent = "No operational alerts recorded yet.";
        elements.operationalAlertList.innerHTML = safeHtml`<div class="hint">Conjunction results will appear here after the backend records them.</div>`;
        return;
    }

    elements.operationalAlertSummary.textContent = `${alerts.length} operational alert${alerts.length === 1 ? "" : "s"} loaded from the backend feed.`;
    elements.operationalAlertList.innerHTML = alerts.slice(0, 5).map((alert) => {
        let severityClass = "info";
        if (alert.severity === "critical") severityClass = "danger";
        else if (alert.severity === "warning") severityClass = "warning";

        const distance = Number.isFinite(alert.closestDistanceKm) ? formatNumber(alert.closestDistanceKm, 2) : "unknown";
        const relativeVelocity = Number.isFinite(alert.details?.relativeVelocityKmS)
            ? `${formatNumber(alert.details.relativeVelocityKmS, 3)} km/s`
            : "unknown";
        const altitude = Number.isFinite(alert.details?.altitudeKm)
            ? `${formatNumber(alert.details.altitudeKm, 0)} km`
            : "unknown";
        const occurredAt = alert.occurredAt ? formatDateTime(alert.occurredAt) : "Unknown time";

        return `
            <div class="list-item ${severityClass}">
                <strong>${escapeHtml(alert.title || "Operational Alert")}</strong>
                ${escapeHtml(alert.message || "No message available.")}<br>
                ${escapeHtml(alert.primaryId || "N/A")} / ${escapeHtml(alert.secondaryId || "N/A")}<br>
                Distance: ${escapeHtml(distance)} km | Altitude: ${escapeHtml(altitude)} | Relative velocity: ${escapeHtml(relativeVelocity)} | Time: ${escapeHtml(occurredAt)}
            </div>
        `;
    }).join("");
}

export function updateAreaReadout() {
    if (!elements.areaReadout) {
        return;
    }

    if (appState.isTracingArea) {
        elements.areaReadout.textContent = `Tracing region: ${appState.tracePoints.length} points.`;
        return;
    }

    if (!appState.selectedArea) {
        elements.areaReadout.textContent = "";
        return;
    }

    const bounds = computeBounds(appState.selectedArea.points);
    elements.areaReadout.textContent = `Selected region with ${appState.selectedArea.points.length} points. Bounds: ${formatLatitude(bounds.minLat)} to ${formatLatitude(bounds.maxLat)}, ${formatLongitude(bounds.minLon)} to ${formatLongitude(bounds.maxLon)}.`;
}

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

    const pcFormatted = Number.isFinite(top.collisionProbability) ? (top.collisionProbability < 1e-7 ? " < 1e-7" : top.collisionProbability.toExponential(2)) : "N/A";

    elements.collisionAlertSummary.innerHTML = safeHtml`
        ${result.conjunctions.length} collision threats detected.<br>
        Top Threat: <strong>${escapeHtml(top.primaryId)} / ${escapeHtml(top.secondaryId)}</strong><br>
        Severity: <span style="color: currentColor">${severity.toUpperCase()}</span> | Miss: ${formatNumber(top.closestDistanceKm, 2)} km | Pc: ${pcFormatted}
    `;
}

export function renderAreaAnalysis(result) {
    if (!elements.analysisPanel) {
        return;
    }
    const alerts = getAreaAlerts(result);
    const analysisLabel = result.analysisType === "volumetric_scan" ? "Volumetric Scan" :
                          result.analysisType === "blind_spot" ? "Blind Spot Detection" :
                          result.analysisType === "conjunction_analysis" ? "Conjunction Analysis" :
                          result.analysisType === "collision_detection" ? "Collision Detection" : "Analysis";

    // Prioritize backend-returned values to ensure sync
    const thresholdLabel = result.proximityThresholdKm || result.conjunctionThresholdKm || result.visibilityThresholdDeg || 25;
    const forecastMinutes = result.horizonMinutes || result.forecastWindowMinutes || 0;
    const minAltitude = result.minAltitudeKm ?? 0;
    const maxAltitude = result.maxAltitudeKm ?? 42000;
    const passes = Array.isArray(result.passes) ? result.passes : [];

    if (result.analysisType === "blind_spot") {
        const alertItems = alerts.slice(0, 6).map((alert) => `
        <strong>${escapeHtml(alert.primaryId)}${alert.secondaryId ? ` / ${escapeHtml(alert.secondaryId)}` : ""}</strong>
        Closest sampled distance: ${formatNumber(alert.closestDistanceKm, 2)} km<br>
        ${Number.isFinite(alert.altitudeKm) ? `Altitude: ${formatNumber(alert.altitudeKm, 0)} km<br>` : ""}
        Time: ${formatDateTime(alert.time || alert.startTime)}
    `);

        elements.analysisPanel.innerHTML = safeHtml`
            <div class="eyebrow">${escapeHtml(analysisLabel)}</div>
            <h2>${formatLatitude((result.region || result.area).centroid.lat)} , ${formatLongitude((result.region || result.area).centroid.lon)}</h2>
            <p>Computed blind spot assessment for the selected region. Results remain stable until the next operator recalculation.</p>

            <div class="metric-grid">
                <div class="metric-card">
                    <div class="label">Trace Points</div>
                    <div class="value">${result.region?.points?.length || result.area.points.length}</div>
                </div>
                <div class="metric-card">
                    <div class="label">Visibility</div>
                    <div class="value">${thresholdLabel}°</div>
                </div>
                <div class="metric-card">
                    <div class="label">Forecast</div>
                    <div class="value">${forecastMinutes}m</div>
                </div>
                <div class="metric-card">
                    <div class="label">Assessment</div>
                    <div class="value">${result.hasCoverage ? "COVERED" : "BLIND"}</div>
                </div>
                <div class="metric-card">
                    <div class="label">Satellites</div>
                    <div class="value">${result.evaluatedSatelliteCount}</div>
                </div>
                <div class="metric-card">
                    <div class="label">Altitude Window</div>
                    <div class="value">${formatNumber(minAltitude, 0)}-${formatNumber(maxAltitude, 0)} km</div>
                </div>
            </div>

            <div class="section">
                <div class="section-title">Detection Result</div>
                <div class="list">
                    <div class="list-item ${result.hasCoverage ? "success" : "danger"}">
                        <strong>${result.hasCoverage ? "Coverage Stable" : "Blind Window Confirmed"}</strong>
                        ${result.hasCoverage ? "At least one satellite provides visibility coverage in this region for the computed window." : "No satellite provides adequate visibility coverage in this region for the computed window."}
                    </div>
                </div>
            </div>

            ${alerts.length ? `
            <div class="section">
                <div class="section-title">Blind Spot Alerts</div>
                ${buildList(alertItems, "No blind spot alerts generated.", "warning")}
            </div>
            ` : ""}
        `;
        return;
    }

    const passItems = passes.slice(0, 6).map((pass) => `
        <strong>${escapeHtml(pass.id)}${pass.isIndian ? " [IND]" : ""}</strong> Starts ${formatDateTime(pass.startTime)}<br>
        Closest approach: ${formatNumber(pass.closestApproachKm, 0)} km<br>
        Peak altitude: ${formatNumber(pass.peakAltitudeKm ?? pass.maxAltitudeKm ?? 0, 0)} km<br>
        Min altitude: ${formatNumber(pass.minAltitudeKm ?? 0, 0)} km
    `);

    if (result.analysisType === "volumetric_scan") {
        const tableRows = passes.slice(0, 15).map((pass) => `
            <div class="list-item ${pass.isIndian ? "indian" : ""}">
                <strong>${escapeHtml(pass.id)} (NORAD: ${pass.noradId || "N/A"})</strong>
                <div style="font-size: 0.9em; margin-top: 5px; color: var(--text-dim);">
                    Entry: ${formatDateTime(pass.startTime)}<br>
                    Exit: ${formatDateTime(pass.endTime)}<br>
                    Peak Alt: ${formatNumber(pass.peakAltitudeKm ?? 0, 1)} km
                </div>
            </div>
        `).join("");

        elements.analysisPanel.innerHTML = safeHtml`
            <div class="eyebrow">${escapeHtml(analysisLabel)}</div>
            <h2>${formatLatitude((result.region || result.area).centroid.lat)} , ${formatLongitude((result.region || result.area).centroid.lon)}</h2>
            <p>Volumetric scan identified ${passes.length} satellites passing through the defined 3D volume (traced region + altitude window) within the forecast period.</p>

            <div class="metric-grid">
                <div class="metric-card">
                    <div class="label">Total Passes</div>
                    <div class="value">${passes.length}</div>
                </div>
                <div class="metric-card">
                    <div class="label">Forecast</div>
                    <div class="value">${forecastMinutes}m</div>
                </div>
                <div class="metric-card">
                    <div class="label">Altitude Range</div>
                    <div class="value">${formatNumber(minAltitude, 0)}-${formatNumber(maxAltitude, 0)} km</div>
                </div>
            </div>

            <div class="section">
                <div class="section-title">Object Pass Timeline</div>
                <div class="list">
                    ${markSafe(tableRows || '<div class="hint">No objects detected passing through the selected volume.</div>')}
                </div>
            </div>
        `;
        return;
    }

    if (result.analysisType === "collision_detection") {
        const conjunctions = (Array.isArray(result.conjunctions) ? result.conjunctions : [])
            .filter(c => c.primaryIsIndian || c.secondaryIsIndian);

        const conjunctionItems = conjunctions.slice(0, 15).map((conj, idx) => {
            const pcFormatted = conj.collisionProbability < 1e-7 ? " < 1e-7" : conj.collisionProbability.toExponential(2);
            const severity = conj.collisionProbability > 1e-4 ? "critical" : "warning";

            return `
                <div class="list-item ${severity === "critical" ? "danger" : "warning"} indian"
                     style="cursor: pointer;"
                     data-conj-index="${idx}">
                    <strong>${escapeHtml(conj.primaryId)} ↔ ${escapeHtml(conj.secondaryId)}</strong>
                    <div style="font-size: 0.9em; margin-top: 5px; color: var(--text-dim);">
                        Probability (Pc): <strong style="color: currentColor;">${pcFormatted}</strong><br>
                        Miss Distance: ${formatNumber(conj.closestDistanceKm, 2)} km<br>
                        Rel. Velocity: ${formatNumber(conj.relativeVelocityKmS || 0, 3)} km/s<br>
                        TCA (UTC): ${formatDateTime(conj.time)}
                    </div>
                </div>
            `;
        }).join("");

        elements.analysisPanel.innerHTML = safeHtml`
            <div class="eyebrow">${escapeHtml(analysisLabel)}</div>
            <h2>High-Risk Collision Detection</h2>
            <p>Operational collision detection layer focused on national assets. Results highlight the risks most likely to require command attention.</p>

            <div class="metric-grid">
                <div class="metric-card">
                    <div class="label">Critical Risks</div>
                    <div class="value">${conjunctions.filter(c => c.collisionProbability > 1e-4).length}</div>
                </div>
                <div class="metric-card">
                    <div class="label">Total Events</div>
                    <div class="value">${conjunctions.length}</div>
                </div>
                <div class="metric-card">
                    <div class="label">Threshold</div>
                    <div class="value">${thresholdLabel} km</div>
                </div>
            </div>

            <div class="section">
                <div class="section-title">Collision Risk Table</div>
                <div class="list">
                    ${markSafe(conjunctionItems || '<div class="hint">No high-risk collisions detected for Indian assets within the selected window.</div>')}
                </div>
            </div>
        `;

        // Store result for visualization
        appState.lastCollisionResult = result;
        return;
    }

    if (result.analysisType === "conjunction_analysis") {
        const conjunctions = Array.isArray(result.conjunctions) ? result.conjunctions : [];
        const summary = result.summary || { critical: 0, high: 0, medium: 0, total: 0 };

        const conjunctionItems = conjunctions.map((conj, idx) => {
            const severityClass = conj.severity === "critical" ? "danger" :
                                conj.severity === "high" ? "warning" :
                                conj.severity === "medium" ? "monitor" : "success";

            const pcFormatted = (conj.collisionProbability || 0).toExponential(1);

            return `
                <div class="list-item ${severityClass} ${conj.primaryIsIndian || conj.secondaryIsIndian ? "indian" : ""}"
                     style="cursor: pointer;"
                     data-conj-index="${idx}">
                    <div style="display: flex; justify-content: space-between; align-items: flex-start;">
                        <strong>${escapeHtml(conj.primaryId)} ↔ ${escapeHtml(conj.secondaryId)}</strong>
                        <span class="badge badge-${severityClass}">${conj.severity.toUpperCase()}</span>
                    </div>
                    <div style="font-size: 0.85em; margin-top: 6px; color: var(--text-dim); display: grid; grid-template-columns: 1fr 1fr; gap: 4px;">
                        <span>Miss: <strong style="color:white">${formatNumber(conj.closestDistanceKm, 2)} km</strong></span>
                        <span>Rel. Vel: <strong style="color:white">${formatNumber(conj.relativeVelocityKmS, 2)} km/s</strong></span>
                        <span>Pc: <strong style="color:white">${pcFormatted}</strong></span>
                        <span>TCA: <strong style="color:white">${formatDateTime(conj.time).split(",")[1]}</strong></span>
                    </div>
                </div>
            `;
        }).join("");

        elements.analysisPanel.innerHTML = safeHtml`
            <div class="eyebrow">${escapeHtml(analysisLabel)}</div>
            <h2>Operational Conjunction Report</h2>
            <p>Operational conjunction screening identifying high-risk close approaches. Results are ranked by minimum separation distance and collision probability (Pc).</p>

            <div class="metric-grid">
                <div class="metric-card">
                    <div class="label">Critical</div>
                    <div class="value" style="color: var(--severity-danger)">${summary.critical}</div>
                </div>
                <div class="metric-card">
                    <div class="label">High Risk</div>
                    <div class="value" style="color: var(--severity-warning)">${summary.high}</div>
                </div>
                <div class="metric-card">
                    <div class="label">Total Events</div>
                    <div class="value">${summary.total}</div>
                </div>
                <div class="metric-card">
                    <div class="label">Window</div>
                    <div class="value">${forecastMinutes >= 1440 ? (forecastMinutes / 1440).toFixed(0) + "d" : (forecastMinutes / 60).toFixed(0) + "h"}</div>
                </div>
            </div>

            <div class="section">
                <div class="section-title">Ranked Threat Assessment</div>
                <div class="list">
                    ${markSafe(conjunctionItems || '<div class="hint">No conjunction events detected within the specified parameters.</div>')}
                </div>
            </div>

            <div class="section">
                <div class="section-title">Analysis Parameters</div>
                <div class="micro-card">
                    Screening Threshold: ${thresholdLabel} km<br>
                    Epoch: ${formatDateTime(result.startTime || new Date())}
                </div>
            </div>
        `;

        appState.lastConjunctionResult = result;
        return;
    }

    const criticalAlerts = alerts.filter(a => a.severity === "critical");
    const alertItems = criticalAlerts.slice(0, 6).map((alert) => `
        <strong>${escapeHtml(alert.primaryId)}${alert.secondaryId ? ` / ${escapeHtml(alert.secondaryId)}` : ""}</strong> Closest sampled distance: ${formatNumber(alert.closestDistanceKm, 2)} km<br>
        Altitude: ${formatNumber(alert.altitudeKm, 0)} km<br>
        Time: ${formatDateTime(alert.time || alert.startTime)}
    `);

    elements.analysisPanel.innerHTML = safeHtml`
        <div class="eyebrow">${escapeHtml(analysisLabel)}</div>
        <h2>${formatLatitude((result.region || result.area).centroid.lat)} , ${formatLongitude((result.region || result.area).centroid.lon)}</h2>
        <p>Forecast generated for a traced region with ${result.region?.points?.length || result.area.points.length} points. Satellites are filtered between ${formatNumber(minAltitude, 0)} km and ${formatNumber(maxAltitude, 0)} km across a ${forecastMinutes} minute forecast window.</p>

        <div class="metric-grid">
            <div class="metric-card">
                <div class="label">Trace Points</div>
                <div class="value">${result.region?.points?.length || result.area.points.length}</div>
            </div>
            <div class="metric-card">
                <div class="label">Proximity</div>
                <div class="value">${thresholdLabel} km</div>
            </div>
            <div class="metric-card">
                <div class="label">Forecast</div>
                <div class="value">${forecastMinutes}m</div>
            </div>
            <div class="metric-card">
                <div class="label">Findings</div>
                <div class="value">${criticalAlerts.length}</div>
            </div>
            <div class="metric-card">
                <div class="label">Region Passes</div>
                <div class="value">${passes.length}</div>
            </div>
            <div class="metric-card">
                <div class="label">Altitude Window</div>
                <div class="value">${formatNumber(minAltitude, 0)}-${formatNumber(maxAltitude, 0)} km</div>
            </div>
        </div>

        <div class="section">
            <div class="section-title">Upcoming Passes</div>
            ${buildList(passItems, "No satellites are predicted to cross this traced region during the current forecast window.", "warning")}
        </div>

        <div class="section">
            <div class="section-title">Region Findings</div>
            ${buildList(alertItems, `No close approaches were found below the current ${thresholdLabel} km threshold in this region.`, "danger")}
        </div>

        <div class="section">
            <div class="section-title">Indian Satellite Activity</div>
            <div class="micro-card">${passes.filter((pass) => pass.isIndian).length} Indian-satellite passes are predicted in this forecast window</div>
        </div>
    `;
}

export function renderCharacterisationSummary(data) {
    if (!elements.analysisPanel) {
        return;
    }

    const { updatedCount, summary } = data;
    const { orbitBreakdown, objectTypeBreakdown, operationalStatusBreakdown, indianAssetsIdentified } = summary;

    elements.analysisPanel.innerHTML = safeHtml`
        <div class="eyebrow">SDA Intelligence</div>
        <h2>Catalogue Enrichment Summary</h2>
        <p>Deterministic classification rules were executed across the catalog. Characterisation metadata has been re-evaluated and persisted in the backend.</p>

        <div class="metric-grid">
            <div class="metric-card">
                <div class="label">Satellites Processed</div>
                <div class="value">${formatNumber(updatedCount, 0)}</div>
            </div>
            <div class="metric-card">
                <div class="label">Indian Assets</div>
                <div class="value">${indianAssetsIdentified}</div>
            </div>
            <div class="metric-card">
                <div class="label">Orbit Classes</div>
                <div class="value">4</div>
            </div>
            <div class="metric-card">
                <div class="label">Object Types</div>
                <div class="value">3</div>
            </div>
        </div>

        <div class="section">
            <div class="section-title">Orbit Classification Breakdown</div>
            <div class="list">
                <div class="list-item"><strong>LEO</strong>: ${orbitBreakdown.LEO || 0}</div>
                <div class="list-item"><strong>MEO</strong>: ${orbitBreakdown.MEO || 0}</div>
                <div class="list-item"><strong>GEO</strong>: ${orbitBreakdown.GEO || 0}</div>
                <div class="list-item"><strong>HEO</strong>: ${orbitBreakdown.HEO || 0}</div>
                ${orbitBreakdown.Unknown ? `<div class="list-item warning"><strong>Unknown</strong>: ${orbitBreakdown.Unknown}</div>` : ""}
            </div>
        </div>

        <div class="section">
            <div class="section-title">Object Classification breakdown</div>
            <div class="list">
                <div class="list-item"><strong>Payloads</strong>: ${objectTypeBreakdown.Payload || 0}</div>
                <div class="list-item"><strong>Debris</strong>: ${objectTypeBreakdown.Debris || 0}</div>
                <div class="list-item"><strong>Rocket Bodies</strong>: ${objectTypeBreakdown["Rocket Body"] || 0}</div>
            </div>
        </div>

        <div class="section">
            <div class="section-title">Operational Status Breakdown</div>
            <div class="list">
                <div class="list-item success"><strong>Active</strong>: ${operationalStatusBreakdown.Active || 0}</div>
                <div class="list-item warning"><strong>Stale</strong>: ${operationalStatusBreakdown.Stale || 0}</div>
                <div class="list-item danger"><strong>Decaying</strong>: ${operationalStatusBreakdown.Decaying || 0}</div>
            </div>
        </div>
    `;
}

export function renderSatellitePath(result) {
    if (!elements.analysisPanel) {
        return;
    }
    const meta = appState.satellites.find(s => s.name === result.id) || {};
    const char = meta.characterisation || {};
    const orbitBadge = char.orbitClass ? markSafe(`<span class="badge badge-outline">${escapeHtml(char.orbitClass)}</span>`) : "";
    const typeBadge = char.objectType ? markSafe(`<span class="badge badge-outline">${escapeHtml(char.objectType)}</span>`) : "";
    const statusBadge = char.operationalStatus ? markSafe(`<span class="badge ${char.operationalStatus === "Active" ? "badge-success" : "badge-warning"}">${escapeHtml(char.operationalStatus)}</span>`) : "";

    elements.analysisPanel.innerHTML = safeHtml`
        <div class="eyebrow">Satellite Track</div>
        <h2>${escapeHtml(result.id)}${result.isIndian ? " [IND]" : ""}</h2>

        <div class="badge-row" style="margin-bottom: 12px;">
            ${orbitBadge}
            ${typeBadge}
            ${statusBadge}
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

export function renderReentryIntelligence(data) {
    if (!elements.analysisPanel) {
        return;
    }

    const {
        satelliteName,
        currentAltitudeKm,
        currentPerigeeKm,
        estimatedReentryDate,
        reentryWindow,
        impactCorridor = [],
        strategicRisks = [],
        riskLevel,
        status,
        message,
        history = []
    } = data;

    const riskSeverity = riskLevel === "HIGH" ? "badge-danger" : (riskLevel === "ELEVATED" ? "badge-warning" : (riskLevel === "MONITOR" ? "badge-monitor" : "badge-success"));
    const stabilitySeverity = status === "decaying" ? "danger" : (status === "stable" ? "success" : "warning");

    const historyItems = history.length > 0 ? history.slice(0, 10).map(point => `
        <div class="list-item">
            <strong>${formatDateTime(point.date)}</strong><br>
            Altitude: ${formatNumber(point.altitude, 1)} km
        </div>
    `).join("") : '<div class="hint">No historical trend data available.</div>';

    const riskAlerts = strategicRisks.length > 0 ? strategicRisks.map(risk => `
        <div class="list-item danger">
            <strong>PRIORITY ALERT: ${escapeHtml(risk.name)}</strong><br>
            Strategic installation at risk. Projected impact corridor passes within ${formatNumber(risk.distanceKm, 0)} km.
        </div>
    `).join("") : '<div class="list-item success">No strategic installation risks detected in current impact corridor.</div>';

    elements.analysisPanel.innerHTML = safeHtml`
        <div class="eyebrow">Orbital Decay Intelligence & Re-entry Prediction</div>
        <h2>${escapeHtml(satelliteName)}</h2>

        <div class="badge-row" style="margin-bottom: 12px;">
            <span class="badge ${riskSeverity}">Risk: ${escapeHtml(riskLevel)}</span>
            <span class="badge badge-outline">${escapeHtml(status === "decaying" ? "Orbital Decay Detected" : "Stable Orbit")}</span>
        </div>

        <div class="metric-grid">
            <div class="metric-card">
                <div class="label">Current Altitude</div>
                <div class="value">~${currentAltitudeKm ? formatNumber(currentAltitudeKm, 0) : "N/A"} km</div>
            </div>
            <div class="metric-card">
                <div class="label">Perigee Altitude</div>
                <div class="value">${currentPerigeeKm ? formatNumber(currentPerigeeKm, 0) : "N/A"} km</div>
            </div>
            <div class="metric-card">
                <div class="label">Re-entry Time</div>
                <div class="value">${status === "stable" ? "Stable" : (estimatedReentryDate ? formatDateTime(estimatedReentryDate).split(',')[0] : "N/A")}</div>
            </div>
            <div class="metric-card">
                <div class="label">Uncertainty</div>
                <div class="value">${status === "stable" ? "None" : escapeHtml(reentryWindow || "N/A")}</div>
            </div>
        </div>

        <div class="section">
            <div class="section-title">Strategic Risk Assessment</div>
            <div class="list">
                ${markSafe(riskAlerts)}
            </div>
        </div>

        <div class="section">
            <div class="section-title">Re-entry Simulation</div>
            <div class="list">
                <div class="list-item ${stabilitySeverity}">
                    <strong>Drag-based Decay Forecast</strong><br>
                    ${escapeHtml(message)}
                    <div style="margin-top:8px; font-size:11px; opacity:0.8;">
                        Simulation uses TLE history + Atmospheric Density Model (NRLMSISE-00 approximation) to project impact swath.
                    </div>
                </div>
            </div>
        </div>

        <div class="section">
            <div class="section-title">Historical Altitude Trend</div>
            <div class="list">
                ${markSafe(historyItems)}
            </div>
        </div>

        <div class="section">
            <div class="section-title">Re-entry Monitoring Protocols</div>
            <div class="micro-card">
                System flags objects for decay analysis if:<br>
                &bull; Perigee altitude &lt; 300 km<br>
                &bull; Rapidly declining semi-major axis in TLE history<br>
                &bull; Predicted impact corridor passes over IAF strategic sites
            </div>
        </div>
    `;
}



export function renderDriftAnalytics(satelliteId, tleHistory, manoeuvreHistory, driftData = null) {
    if (!elements.analysisPanel) {
        return;
    }

    const manoeuvres = manoeuvreHistory?.manoeuvres || [];
    const isIndian = manoeuvreHistory?.isIndian || false;
    const isFocusMode = appState.isFocusMode && appState.focusedSatelliteId === satelliteId;

    const historyItems = tleHistory.slice(0, 10).map((rev) => `
        <strong>${formatDateTime(rev.tleEpoch || rev.ingestedAt)}</strong>
        Alt: ${formatNumber(rev.perigeeKm, 0)}-${formatNumber(rev.apogeeKm, 0)} km | Inc: ${formatNumber(rev.inclinationDeg, 3)}°<br>
        Source: ${escapeHtml(rev.sourceName || "Unknown")}
    `);

    // Operational Interpretation Overlay
    let analysisOverlay = "";
    if (driftData && driftData.analysis) {
        const a = driftData.analysis;
        const incDirection = a.inclinationShiftDeg >= 0 ? "increased" : "decreased";
        const smaDirection = a.smaShiftKm >= 0 ? "expanded" : "decayed";
        const driftSeverity = (Math.abs(a.inclinationShiftDeg) > 0.05 || Math.abs(a.smaShiftKm) > 2) ? "danger" : "warning";

        analysisOverlay = `
            <div class="section">
                <div class="section-title">Operational Intelligence Summary</div>
                <div class="list">
                    <div class="list-item ${driftSeverity}">
                        <strong>Drift Assessment (${a.daysAnalyzed} days)</strong><br>
                        <p style="margin-top: 5px; font-size: 0.95em;">
                            Satellite orbit has <strong>${smaDirection}</strong> by ${formatNumber(Math.abs(a.smaShiftKm), 2)} km.<br>
                            Inclination has <strong>${incDirection}</strong> by ${formatNumber(Math.abs(a.inclinationShiftDeg), 4)}°.<br>
                            Orbital period shifted by ${formatNumber(Math.abs(a.periodShiftMinutes * 60), 1)}s.
                        </p>
                        <div style="margin-top: 8px; font-weight: bold;">
                            ${Math.abs(a.smaShiftKm) > 1 ? "⚠️ POTENTIAL MANOEUVRE DETECTED" : "STATION-KEEPING ACTIVITY OBSERVED"}
                        </div>
                    </div>
                </div>
            </div>
        `;
    }

    const manoeuvreItems = manoeuvres.map((m) => {
        const deltas = m.orbitalElementDelta || {};
        const title = m.classification === "proximity_threat" ? "Proximity Threat Detected" : "Manoeuvre Signature Detected";

        return `
            <div class="list-item ${m.severity === "critical" ? "danger" : "warning"}">
                <strong>${escapeHtml(title)}</strong><br>
                <small>${formatDateTime(m.occurredAt)}</small>
                <div style="margin-top: 8px; font-family: monospace; font-size: 0.9em; line-height: 1.4;">
                    • Inclination Shift: ${formatNumber(deltas.inclinationDeg || 0, 4)}°<br>
                    • Mean Motion Drift: ${formatNumber(deltas.meanMotionRevPerDay || 0, 4)}<br>
                    • SMA Delta: ${formatNumber(deltas.semiMajorAxisKm || 0, 2)} km<br>
                    • Epoch Residual: ${formatNumber(m.epochResidualKm || 0, 1)} km
                </div>
                ${m.nearestIndianId ? `<div class="micro-card danger" style="margin-top:8px;">Nearest Indian Asset: ${escapeHtml(m.nearestIndianId)}</div>` : ""}
            </div>
        `;
    }).join("");

    const legendHtml = driftData ? `
        <div class="section">
            <div class="section-title">Temporal Drift Legend</div>
            <div class="micro-card">
                <div style="display: flex; flex-direction: column; gap: 4px;">
                    ${driftData.tracks.map(t => `
                        <div style="display: flex; align-items: center; gap: 8px;">
                            <div style="width: 24px; height: 4px; background-color: ${t.color}; opacity: ${t.opacity};"></div>
                            <span style="font-size: 0.85em;">${t.dayOffset === 0 ? "Current Orbit" : `Day ${t.dayOffset}`}</span>
                        </div>
                    `).join("")}
                </div>
            </div>
        </div>
    ` : "";

    elements.analysisPanel.innerHTML = safeHtml`
        <div class="eyebrow">Forensics & Drift</div>
        <h2>${escapeHtml(satelliteId)}${isIndian ? " [IND]" : ""}</h2>

        <div class="section">
            <div class="section-title">Orbital Drift Evolution</div>
            <div class="micro-card" style="margin-bottom: 12px;">
                Layered historical trajectory overlays to visualize orbital shift over time.
            </div>

            <div style="display: flex; gap: 8px; margin-bottom: 12px;">
                <select id="driftDurationSelect" style="flex: 1;">
                    <option value="3">Last 3 Days</option>
                    <option value="5" selected>Last 5 Days</option>
                    <option value="7">Last 7 Days</option>
                </select>
                <button class="primary" id="runDriftAnalysisButton" type="button" style="flex: 2;">
                    ${isFocusMode ? "Update Drift Visual" : "Show Orbital Drift Evolution"}
                </button>
            </div>

            ${isFocusMode ? `
                <button class="secondary" id="exitFocusModeButton" type="button" style="width: 100%; margin-bottom: 12px;">Exit Focused Analysis Mode</button>
            ` : ""}
        </div>

        ${markSafe(analysisOverlay)}
        ${legendHtml}

        <div class="section">
            <div class="section-title">Detected Manoeuvre Events</div>
            ${buildList(manoeuvreItems, "No significant manoeuvre events detected in the available history.", "warning")}
        </div>

        <div class="section">
            <div class="section-title">Recent TLE Revisions</div>
            ${buildList(historyItems, "No TLE history found for this satellite.", "list-item")}
        </div>

        <div class="section">
            <button class="secondary" id="backToTrackButton" data-satellite-id="${escapeHtml(satelliteId)}" type="button" style="width: 100%;">Back to Live Track</button>
        </div>
    `;
}

export function renderSatelliteDirectory(toggleSatellitePath, hideGroup, clearHiddenGroups) {
    if (!elements.indianSummary || !elements.indianSatList || !elements.satelliteSearchInput) {
        return;
    }
    const satellites = appState.hideCommercialSatellites
        ? appState.satellites.filter((satellite) => !isCommercialSatelliteName(satellite.name))
        : appState.satellites;
    const groups = buildSatelliteGroups(satellites);
    const query = normalizeSearchValue(elements.satelliteSearchInput.value);
    const filteredGroups = groups.filter((group) => !query || group.label.includes(query));
    const visibleGroups = filteredGroups.slice(0, SATELLITE_FILTER_RESULT_LIMIT);

    elements.indianSummary.textContent = appState.hideCommercialSatellites
        ? `${groups.length} satellite groups loaded. Commercial satellites are hidden.`
        : `${groups.length} satellite groups loaded.`;

    if (!filteredGroups.length) {
        elements.indianSatList.innerHTML = safeHtml`<div class="hint">No satellite names matched the current search.</div>`;
    } else {
        elements.indianSatList.innerHTML = visibleGroups.map((group) => {
            const isHidden = appState.hiddenGroupLabels.has(group.label);
            const sample = group.satellites[0] || {};
            const char = sample.characterisation || {};

            return `
                <div class="filter-item ${isHidden ? "is-hidden" : ""}">
                    <button class="sat-item filter-item-main" data-satellite-id="${escapeHtml(sample.name || "")}">
                        ${escapeHtml(group.label)}
                        <div class="badge-row" style="margin-top: 4px;">
                            ${char.orbitClass ? `<span class="badge badge-outline">${escapeHtml(char.orbitClass)}</span>` : ""}
                            ${char.objectType ? `<span class="badge badge-outline">${escapeHtml(char.objectType)}</span>` : ""}
                            ${char.operationalStatus ? `<span class="badge ${char.operationalStatus === "Active" ? "badge-success" : "badge-warning"}">${escapeHtml(char.operationalStatus)}</span>` : ""}
                        </div>
                        <small style="display: block; margin-top: 2px;">${group.count} satellite${group.count === 1 ? "" : "s"}${group.indianCount ? ` | ${group.indianCount} Indian` : ""} | click for orbit preview</small>
                    </button>
                    <button class="filter-action ${isHidden ? "secondary" : ""}" type="button" data-toggle-group="${escapeHtml(group.label)}">
                        ${isHidden ? "Show" : "Hide"}
                    </button>
                </div>
            `;
        }).join("");
    }

    if (filteredGroups.length > visibleGroups.length) {
        elements.indianSatList.innerHTML += `<div class="hint">Showing first ${visibleGroups.length} matching satellite groups. Narrow the search to see more.</div>`;
    }

    const hiddenGroups = Array.from(appState.hiddenGroupLabels).sort();
    if (elements.hiddenGroupsSummary) {
        elements.hiddenGroupsSummary.textContent = hiddenGroups.length
            ? `Hidden groups: ${hiddenGroups.join(", ")}`
            : "No satellite name groups are hidden.";
    }
    if (elements.resetHiddenGroupsButton) {
        elements.resetHiddenGroupsButton.disabled = hiddenGroups.length === 0;
    }
    if (elements.finishTraceButton) {
        elements.finishTraceButton.disabled = !(appState.isTraceModeEnabled && appState.tracePoints.length >= 3);
    }

    if (!elements.indianSatList) {
        return;
    }

    elements.indianSatList.onclick = (event) => {
        const orbitButton = event.target.closest("[data-satellite-id]");
        if (orbitButton) {
            toggleSatellitePath(orbitButton.dataset.satelliteId);
            return;
        }

        const hideButton = event.target.closest("[data-toggle-group]");
        if (hideButton) {
            hideGroup(hideButton.dataset.toggleGroup);
        }
    };

    if (elements.resetHiddenGroupsButton) {
        elements.resetHiddenGroupsButton.onclick = clearHiddenGroups;
    }
}
