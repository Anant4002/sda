import { SATELLITE_FILTER_RESULT_LIMIT } from "./config.js";
import { elements } from "./dom.js";
import { appState } from "./state.js";
import { drawProximityAlerts } from "./viewer.js";
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
    if (!document.getElementById("operationalAlertSummary") || !elements.analysisPanel) {
        return;
    }
    const summaryElement = document.getElementById("operationalAlertSummary");
    if (!Array.isArray(alerts) || !alerts.length) {
        summaryElement.textContent = "No operational alerts recorded yet.";
        elements.analysisPanel.innerHTML = safeHtml`
            <div class="eyebrow">Tactical Alerts & Event Log</div>
            <h2>Space Domain Operational Alerts Feed</h2>
            <p>Real-time conjunction detections, uncooperative manoeuvres, blind spot entries, and regional scan events recorded by backend analytical processors.</p>
            <div class="hint" style="margin-top: 16px;">Conjunction results will appear here after the backend records them.</div>
        `;
        return;
    }

    // Update summary text
    summaryElement.textContent = `${alerts.length} operational alert${alerts.length === 1 ? "" : "s"} loaded from the backend feed.`;

    // Calculate severity statistics
    const criticalCount = alerts.filter(a => a.severity === "critical").length;
    const warningCount = alerts.filter(a => a.severity === "warning").length;
    const infoCount = alerts.filter(a => a.severity !== "critical" && a.severity !== "warning").length;

    // Header HTML containing statistics badges
    const statsHeader = `
        <div style="display: flex; gap: 6px; margin-bottom: 12px; font-size: 10px; flex-wrap: wrap;">
            <span style="background: rgba(255, 123, 123, 0.12); color: var(--danger); border: 1px solid rgba(255, 123, 123, 0.3); padding: 3px 8px; border-radius: 4px; font-weight: bold; text-transform: uppercase; letter-spacing: 0.05em;">CRITICAL: ${criticalCount}</span>
            <span style="background: rgba(255, 209, 102, 0.12); color: var(--warning); border: 1px solid rgba(255, 209, 102, 0.3); padding: 3px 8px; border-radius: 4px; font-weight: bold; text-transform: uppercase; letter-spacing: 0.05em;">WARNING: ${warningCount}</span>
            <span style="background: rgba(111, 226, 255, 0.12); color: var(--accent); border: 1px solid rgba(111, 226, 255, 0.3); padding: 3px 8px; border-radius: 4px; font-weight: bold; text-transform: uppercase; letter-spacing: 0.05em;">INFO: ${infoCount}</span>
        </div>
    `;

    // Type styling maps
    const typeConfigs = {
        conjunction: {
            label: "Conjunction",
            icon: "⚡",
            borderColor: "var(--danger)",
            bg: "rgba(255, 123, 123, 0.08)",
            titleColor: "var(--danger)"
        },
        blind_spot: {
            label: "Blind Spot",
            icon: "👁",
            borderColor: "var(--warning)",
            bg: "rgba(255, 209, 102, 0.08)",
            titleColor: "var(--warning)"
        },
        neighbourhood_watch: {
            label: "Proximity Watch",
            icon: "🛰",
            borderColor: "var(--accent)",
            bg: "rgba(111, 226, 255, 0.08)",
            titleColor: "var(--accent)"
        },
        manoeuvre: {
            label: "Manoeuvre",
            icon: "🔀",
            borderColor: "var(--success)",
            bg: "rgba(124, 242, 154, 0.08)",
            titleColor: "var(--success)"
        },
        volumetric_scan: {
            label: "Region Entry",
            icon: "🛡",
            borderColor: "var(--accent)",
            bg: "rgba(111, 226, 255, 0.05)",
            titleColor: "var(--accent)"
        },
        general: {
            label: "System Alert",
            icon: "🔔",
            borderColor: "rgba(255, 255, 255, 0.2)",
            bg: "rgba(255, 255, 255, 0.03)",
            titleColor: "var(--text-main)"
        }
    };

    function resolveType(alert) {
        const typeStr = (alert.alertType || alert.type || "").toLowerCase();
        if (typeStr.includes("conjunction")) return "conjunction";
        if (typeStr.includes("blind_spot") || typeStr.includes("blind")) return "blind_spot";
        if (typeStr.includes("neighbourhood") || typeStr.includes("proximity")) return "neighbourhood_watch";
        if (typeStr.includes("manoeuvre") || typeStr.includes("maneuver")) return "manoeuvre";
        if (typeStr.includes("volumetric") || typeStr.includes("scan") || typeStr.includes("region")) return "volumetric_scan";

        const titleStr = (alert.title || "").toLowerCase();
        if (titleStr.includes("conjunction")) return "conjunction";
        if (titleStr.includes("blind spot")) return "blind_spot";
        if (titleStr.includes("neighbourhood") || titleStr.includes("proximity") || titleStr.includes("nearby")) return "neighbourhood_watch";
        if (titleStr.includes("manoeuvre") || titleStr.includes("maneuver")) return "manoeuvre";
        if (titleStr.includes("region scan") || titleStr.includes("volumetric") || titleStr.includes("scan")) return "volumetric_scan";

        return "general";
    }

    const cardsHtml = alerts.slice(0, 5).map((alert) => {
        const alertType = resolveType(alert);
        const config = typeConfigs[alertType] || typeConfigs.general;

        let badgeClass = "badge-outline";
        if (alert.severity === "critical") badgeClass = "badge-danger";
        else if (alert.severity === "warning") badgeClass = "badge-warning";
        else if (alert.severity === "info") badgeClass = "badge-info";

        let idLine = "";
        const primary = alert.primaryId && alert.primaryId !== "N/A" ? alert.primaryId : null;
        const secondary = alert.secondaryId && alert.secondaryId !== "N/A" ? alert.secondaryId : null;
        if (primary && secondary) {
            idLine = `
                <div style="display: flex; align-items: center; gap: 4px; margin: 6px 0; flex-wrap: wrap;">
                    <span style="font-family: Consolas, monospace; background: rgba(111, 226, 255, 0.12); border: 1px solid rgba(111, 226, 255, 0.3); color: var(--accent); padding: 1px 5px; border-radius: 4px; font-size: 10.5px;">${escapeHtml(primary)}</span>
                    <span style="color: var(--text-dim); font-size: 10px;">&harr;</span>
                    <span style="font-family: Consolas, monospace; background: rgba(255, 153, 51, 0.12); border: 1px solid rgba(255, 153, 51, 0.3); color: var(--indian); padding: 1px 5px; border-radius: 4px; font-size: 10.5px;">${escapeHtml(secondary)}</span>
                </div>
            `;
        } else if (primary) {
            idLine = `
                <div style="margin: 6px 0;">
                    <span style="font-family: Consolas, monospace; background: rgba(111, 226, 255, 0.12); border: 1px solid rgba(111, 226, 255, 0.3); color: var(--accent); padding: 1px 5px; border-radius: 4px; font-size: 10.5px;">${escapeHtml(primary)}</span>
                </div>
            `;
        } else if (secondary) {
            idLine = `
                <div style="margin: 6px 0;">
                    <span style="font-family: Consolas, monospace; background: rgba(255, 153, 51, 0.12); border: 1px solid rgba(255, 153, 51, 0.3); color: var(--indian); padding: 1px 5px; border-radius: 4px; font-size: 10.5px;">${escapeHtml(secondary)}</span>
                </div>
            `;
        }

        const metrics = [];

        let distanceVal = alert.closestDistanceKm;
        if (!Number.isFinite(distanceVal)) {
            const risks = alert.details?.rawAlert?.details?.strategicRisks || alert.details?.strategicRisks;
            if (Array.isArray(risks) && risks.length > 0) {
                const dists = risks.map(r => r.distanceKm).filter(Number.isFinite);
                if (dists.length > 0) {
                    distanceVal = Math.min(...dists);
                }
            }
        }
        if (Number.isFinite(distanceVal)) {
            metrics.push({ label: "Distance", value: `${formatNumber(distanceVal, 2)} km` });
        }

        let altitudeVal = alert.details?.altitudeKm;
        if (altitudeVal === undefined || altitudeVal === null) {
            altitudeVal = alert.details?.currentAltitudeKm;
        }
        if (altitudeVal === undefined || altitudeVal === null) {
            altitudeVal = alert.details?.rawAlert?.details?.currentAltitudeKm;
        }
        if (altitudeVal === undefined || altitudeVal === null) {
            altitudeVal = alert.details?.rawAlert?.details?.altitudeKm;
        }
        if (Number.isFinite(altitudeVal)) {
            metrics.push({ label: "Altitude", value: `${formatNumber(altitudeVal, 0)} km` });
        }

        let relativeVelocityVal = alert.details?.relativeVelocityKmS;
        if (relativeVelocityVal === undefined || relativeVelocityVal === null) {
            relativeVelocityVal = alert.details?.rawAlert?.details?.relativeVelocityKmS;
        }
        if (Number.isFinite(relativeVelocityVal)) {
            metrics.push({ label: "Rel. Vel", value: `${formatNumber(relativeVelocityVal, 3)} km/s` });
        }

        let durationVal = alert.durationMinutes || alert.details?.durationMinutes || alert.details?.rawAlert?.details?.durationMinutes;
        if (Number.isFinite(durationVal)) {
            metrics.push({ label: "Duration", value: `${formatNumber(durationVal, 1)} min` });
        }

        let timeString = "";
        if (alert.occurredAt) {
            timeString = `
                <div style="display: flex; align-items: center; gap: 5px; margin-top: 8px; font-size: 10.5px; color: var(--text-dim);">
                    <svg viewBox="0 0 24 24" style="width: 12px; height: 12px; fill: currentColor; opacity: 0.7;">
                        <path d="M12,20A8,8 0 1,1 20,12A8,8 0 0,1 12,20M12,2A10,10 0 1,0 22,12A10,10 0 0,0 12,2M12.5,7V12.25L17,14.92L16.25,16.15L11,13V7H12.5Z" />
                    </svg>
                    <span>${escapeHtml(formatDateTime(alert.occurredAt))}</span>
                </div>
            `;
        }

        return `
            <div class="list-item" style="border-left: 4px solid ${config.borderColor}; background: ${config.bg}; padding: 12px; border-radius: 8px; position: relative; margin-bottom: 8px; border-top: 1px solid rgba(255,255,255,0.03); border-right: 1px solid rgba(255,255,255,0.03); border-bottom: 1px solid rgba(255,255,255,0.03); display: flex; flex-direction: column;">
                <div style="display: flex; align-items: flex-start; justify-content: space-between; gap: 8px; margin-bottom: 6px;">
                    <div style="display: flex; align-items: center; gap: 6px; min-width: 0;">
                        <span style="font-size: 14px; line-height: 1; flex-shrink: 0;">${config.icon}</span>
                        <strong style="font-size: 13px; color: var(--text-main); margin-bottom: 0; white-space: nowrap; overflow: hidden; text-overflow: ellipsis;">${escapeHtml(alert.title || config.label)}</strong>
                    </div>
                    <span class="badge ${badgeClass}" style="margin: 0; padding: 2px 6px; font-size: 9px; border-radius: 3px; flex-shrink: 0; display: inline-flex; align-items: center; justify-content: center; height: fit-content;">${escapeHtml(alert.severity || "info")}</span>
                </div>

                <div style="font-size: 12px; color: var(--text-dim); line-height: 1.4; margin-bottom: 4px; word-wrap: break-word;">
                    ${escapeHtml(alert.message || "No message available.")}
                </div>

                ${idLine}

                ${metrics.length > 0 ? `
                    <div style="display: flex; flex-wrap: wrap; gap: 4px; margin-top: 6px;">
                        ${metrics.map(m => `
                            <span style="background: rgba(255, 255, 255, 0.04); border: 1px solid rgba(255, 255, 255, 0.08); border-radius: 4px; padding: 2px 5px; font-size: 10px; display: inline-flex; align-items: center; gap: 3px;">
                                <span style="color: var(--text-dim);">${escapeHtml(m.label)}:</span>
                                <strong style="color: var(--text-main); font-family: Consolas, monospace;">${escapeHtml(m.value)}</strong>
                            </span>
                        `).join("")}
                    </div>
                ` : ""}

                ${timeString}
            </div>
        `;
    }).join("");

    elements.analysisPanel.innerHTML = safeHtml`
        <div class="eyebrow">Tactical Alerts & Event Log</div>
        <h2>Space Domain Operational Alerts Feed</h2>
        <p>Real-time conjunction detections, uncooperative manoeuvres, blind spot entries, and regional scan events recorded by backend analytical processors.</p>

        ${markSafe(statsHeader)}

        <div class="section">
            <div class="section-title">Active Alert Cards</div>
            <div class="list">
                ${markSafe(cardsHtml)}
            </div>
        </div>
    `;
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
        const windows = Array.isArray(result.blindWindows) ? result.blindWindows : [];
        const windowRows = windows.map((win) => {
            const startStr = formatDateTime(win.startTime);
            const endStr = formatDateTime(win.endTime);
            const durationText = win.durationMinutes >= 60
                ? `${Math.floor(win.durationMinutes / 60)}h ${win.durationMinutes % 60}m`
                : `${win.durationMinutes} min`;

            return `
                <tr style="border-bottom: 1px solid rgba(255, 255, 255, 0.08);">
                    <td style="padding: 10px 4px; font-family: monospace; color: var(--text-main); font-weight: 500;">${startStr}</td>
                    <td style="padding: 10px 4px; font-family: monospace; color: var(--text-main); font-weight: 500;">${endStr}</td>
                    <td style="padding: 10px 4px; text-align: right; color: var(--danger); font-weight: bold;">${durationText}</td>
                </tr>
            `;
        }).join("");

        const tableContent = windowRows || `
            <tr style="border-bottom: none;">
                <td colspan="3" style="padding: 20px 4px; text-align: center; color: var(--success); font-style: italic;">
                    No blind spots detected in the current window. Coverage is continuous!
                </td>
            </tr>
        `;

        const tableHtml = `
            <table style="width: 100%; border-collapse: collapse; margin-top: 10px; font-size: 13px;">
                <thead>
                    <tr style="border-bottom: 2px solid rgba(111, 226, 255, 0.2); text-align: left; color: var(--text-dim);">
                        <th style="padding: 8px 4px; font-weight: 600;">Start Time (IST)</th>
                        <th style="padding: 8px 4px; font-weight: 600;">End Time (IST)</th>
                        <th style="padding: 8px 4px; text-align: right; font-weight: 600;">Duration</th>
                    </tr>
                </thead>
                <tbody>
                    ${tableContent}
                </tbody>
            </table>
        `;

        elements.analysisPanel.innerHTML = safeHtml`
            <div class="eyebrow">${escapeHtml(analysisLabel)}</div>
            <h2>${formatLatitude((result.region || result.area).centroid.lat)} , ${formatLongitude((result.region || result.area).centroid.lon)}</h2>
            <p>Simplified blind spot coverage report for the selected region. Showing periods where no satellite observation coverage exists.</p>

            <div class="metric-grid">
                <div class="metric-card">
                    <div class="label">Total Blind Gaps</div>
                    <div class="value">${windows.length}</div>
                </div>
                <div class="metric-card">
                    <div class="label">Overall Status</div>
                    <div class="value" style="color: ${result.hasCoverage ? 'var(--severity-success)' : 'var(--severity-danger)'};">
                        ${result.hasCoverage ? "COVERED" : "BLIND"}
                    </div>
                </div>
                <div class="metric-card">
                    <div class="label">Coverage</div>
                    <div class="value">${formatNumber(result.coveragePercentage || 0, 1)}%</div>
                </div>
                <div class="metric-card">
                    <div class="label">Forecast Window</div>
                    <div class="value">${result.forecastWindowMinutes}m</div>
                </div>
            </div>

            <div class="section">
                <div class="section-title">Simplified Blind Spot Schedule</div>
                <div class="list">
                    ${markSafe(tableHtml)}
                </div>
            </div>
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
        elements.analysisPanel.innerHTML = safeHtml`
            <div class="eyebrow">${escapeHtml(analysisLabel)}</div>
            <h2>${formatLatitude((result.region || result.area).centroid.lat)} , ${formatLongitude((result.region || result.area).centroid.lon)}</h2>
            <p>Volumetric scan identified <span class="volumetric-total-passes-val">${passes.length}</span> satellites passing through the defined 3D volume (traced region + altitude window) within the forecast period.</p>

            <div class="metric-grid">
                <div class="metric-card">
                    <div class="label">Total Passes</div>
                    <div class="value volumetric-total-passes-val">${passes.length}</div>
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

            <div class="section" style="background: rgba(255, 255, 255, 0.02); padding: 12px; border-radius: 8px; margin-top: 12px; margin-bottom: 12px;">
                <div class="section-title">Filter Results</div>
                <div class="field" style="margin-bottom: 8px;">
                    <input id="volumetricSearchInput" class="search-input" type="search" placeholder="Search satellite name or ID..." style="width: 100%;">
                </div>
                <div style="display: flex; gap: 6px; flex-wrap: wrap;">
                    <button class="badge badge-success volumetric-filter-btn active" data-filter="all" style="cursor: pointer; border: none;">All</button>
                    <button class="badge badge-outline volumetric-filter-btn" data-filter="indian" style="cursor: pointer; border: 1px solid rgba(111,226,255,0.3); background: none;">India</button>
                    <button class="badge badge-outline volumetric-filter-btn" data-filter="friendly" style="cursor: pointer; border: 1px solid rgba(111,226,255,0.3); background: none;">Friendly</button>
                    <button class="badge badge-outline volumetric-filter-btn" data-filter="adversary" style="cursor: pointer; border: 1px solid rgba(111,226,255,0.3); background: none;">Adversary</button>
                </div>
            </div>

            <div class="section">
                <div class="section-title">Object Pass Timeline</div>
                <div class="list volumetric-pass-list">
                    <!-- Will be populated dynamically by refreshVolumetricList -->
                </div>
            </div>
        `;

        const refreshVolumetricList = () => {
            const searchInput = document.getElementById("volumetricSearchInput");
            const activeBtn = elements.analysisPanel.querySelector(".volumetric-filter-btn.active");
            const filter = activeBtn ? activeBtn.dataset.filter : "all";
            const query = (searchInput?.value || "").toUpperCase().trim();

            let filtered = passes;

            // Apply search filter
            if (query) {
                filtered = filtered.filter(p =>
                    p.id.toUpperCase().includes(query) ||
                    (p.noradId && String(p.noradId).includes(query))
                );
            }

            // Apply country filter
            if (filter !== "all") {
                filtered = filtered.filter(p => {
                    const name = p.id.toUpperCase();
                    if (filter === "indian") {
                        return p.isIndian;
                    } else if (filter === "friendly") {
                        const friendlyList = appState.friendlySatellites || ["GPS", "NOAA", "USA", "GOES", "LANDSAT"];
                        return friendlyList.some(pat => name.includes(pat.toUpperCase().trim()));
                    } else if (filter === "adversary") {
                        const adversaryList = ["YAOGAN", "FENGYUN", "SJ-", "SHIYAN", "BEIDOU"];
                        return adversaryList.some(pat => name.includes(pat.toUpperCase().trim()));
                    }
                    return true;
                });
            }

            // Update the listed rows
            const listContainer = elements.analysisPanel.querySelector(".volumetric-pass-list");
            if (listContainer) {
                if (filtered.length === 0) {
                    listContainer.innerHTML = `<div class="hint">No matching passes found.</div>`;
                } else {
                    listContainer.innerHTML = filtered.slice(0, 30).map((pass) => `
                        <div class="list-item ${pass.isIndian ? "indian" : ""}">
                            <strong>${escapeHtml(pass.id)} (NORAD: ${pass.noradId || "N/A"})</strong>
                            <div style="font-size: 0.9em; margin-top: 5px; color: var(--text-dim);">
                                Entry: ${formatDateTime(pass.startTime)}<br>
                                Exit: ${formatDateTime(pass.endTime)}<br>
                                Peak Alt: ${formatNumber(pass.peakAltitudeKm ?? 0, 1)} km
                            </div>
                        </div>
                    `).join("");
                }
            }

            // Update visible count in UI
            const countValues = elements.analysisPanel.querySelectorAll(".volumetric-total-passes-val");
            countValues.forEach(el => {
                el.textContent = filtered.length;
            });
        };

        // Initialize and bind
        refreshVolumetricList();

        setTimeout(() => {
            const searchInput = document.getElementById("volumetricSearchInput");
            if (searchInput) {
                searchInput.addEventListener("input", refreshVolumetricList);
            }
            const btns = elements.analysisPanel.querySelectorAll(".volumetric-filter-btn");
            btns.forEach(btn => {
                btn.addEventListener("click", () => {
                    btns.forEach(b => {
                        b.classList.remove("active", "badge-success");
                        b.classList.add("badge-outline");
                        b.style.background = "none";
                        b.style.border = "1px solid rgba(111,226,255,0.3)";
                    });
                    btn.classList.add("active", "badge-success");
                    btn.classList.remove("badge-outline");
                    btn.style.background = "";
                    btn.style.border = "none";
                    refreshVolumetricList();
                });
            });
        }, 0);
        return;
    }

    if (result.analysisType === "collision_detection") {
        const conjunctions = (Array.isArray(result.conjunctions) ? result.conjunctions : [])
            .filter(c => c.primaryIsIndian || c.secondaryIsIndian);

        const conjunctionItems = conjunctions.slice(0, 15).map((conj, idx) => {
            const pcFormatted = conj.collisionProbability < 1e-7 ? " < 1e-7" : conj.collisionProbability.toExponential(2);
            const severity = conj.collisionProbability > 1e-4 ? "critical" : "warning";

            // Analyze relative velocity
            const relVel = conj.relativeVelocityKmS || 0;
            let velAnalysis = "";
            let velColor = "var(--severity-success)";
            if (relVel < 2.0) {
                velAnalysis = "Co-orbital / station-keeping trailing trajectory approach. Lower collision energy.";
            } else if (relVel <= 8.0) {
                velColor = "var(--severity-warning)";
                velAnalysis = "Crossing orbits trajectory intercept. High potential impact energy.";
            } else {
                velColor = "var(--severity-danger)";
                velAnalysis = "Hypervelocity head-on intercept trajectory intercept. Severe fragmentation hazard.";
            }

            return `
                <div class="list-item ${severity === "critical" ? "danger" : "warning"} indian"
                     style="cursor: pointer;"
                     data-conj-index="${idx}">
                    <strong>${escapeHtml(conj.primaryId)} ↔ ${escapeHtml(conj.secondaryId)}</strong>
                    <div style="font-size: 0.9em; margin-top: 5px; color: var(--text-dim); line-height: 1.4;">
                        Probability (Pc): <strong style="color: currentColor;">${pcFormatted}</strong><br>
                        Miss Distance: ${formatNumber(conj.closestDistanceKm, 2)} km<br>
                        Rel. Velocity: <strong style="color: ${velColor};">${formatNumber(relVel, 3)} km/s</strong><br>
                        <span style="font-size: 0.85em; display: block; margin-top: 4px; border-top: 1px solid rgba(255,255,255,0.05); padding-top: 4px; color: var(--text-dim);">
                            <strong>Analysis:</strong> ${velAnalysis}
                        </span>
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

            // Compute orbital region from ECI coordinates or use backend orbitClass if available
            let regionName = conj.orbitClass;
            if (!regionName) {
                const x = conj.primaryPos?.x || 0;
                const y = conj.primaryPos?.y || 0;
                const z = conj.primaryPos?.z || 0;
                const distFromCenter = Math.sqrt(x*x + y*y + z*z);
                const alt = distFromCenter - 6371; // Earth radius subtraction
                if (alt < 2000) regionName = "LEO";
                else if (alt > 36786) regionName = "HEO";
                else if (Math.abs(alt - 35786) < 1000) regionName = "GEO";
                else regionName = "MEO";
            }

            return `
                <div class="list-item ${severityClass} ${conj.primaryIsIndian || conj.secondaryIsIndian ? "indian" : ""}"
                     style="cursor: pointer;"
                     data-conj-index="${idx}">
                    <div style="display: flex; justify-content: space-between; align-items: flex-start;">
                        <strong>${escapeHtml(conj.primaryId)} ↔ ${escapeHtml(conj.secondaryId)}</strong>
                        <div>
                            <span class="badge badge-outline" style="border-color: rgba(111,226,255,0.3); color: var(--accent);">${regionName}</span>
                            <span class="badge badge-${severityClass}">${conj.severity.toUpperCase()}</span>
                        </div>
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
            <p>Operational conjunction screening identifying close-approach events. Conjunction calculations remain active across the catalog.</p>

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
                <div class="section-title">Operational Context & Benefits</div>
                <div class="micro-card" style="font-size: 0.85em; line-height: 1.45; color: var(--text-dim);">
                    <strong>Why Conjunctions are Tracked:</strong> Close passes must be detected proactively to prevent high-velocity orbital impacts that can instantly destroy multi-million dollar national assets.
                    <br><br>
                    <strong>Operational Benefit:</strong> Allows operators to execute timely <em>Collision Avoidance Maneuvers (COLA)</em>, conserving satellite fuel and preserving active space payloads.
                </div>
            </div>

            <div class="section">
                <div class="section-title">Space Catalog Statistical Insights</div>
                <div class="micro-card" style="font-size: 0.85em; line-height: 1.45; color: var(--text-dim);">
                    • <strong>Historical Collision Events:</strong> 4 major catastrophic satellite collisions have occurred historically (e.g. the 2009 co-orbital impact of Iridium 33 & Kosmos 2251).
                    <br>
                    • <strong>Tracked Satellites & Debris:</strong> Over 47,000 active orbital objects are currently catalogued and tracked daily, with millions of smaller lethal untracked debris particles posing risk.
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
        history = [],
        timeToImpact,
        indiaSpecificRisk
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

    const riskColor = indiaSpecificRisk && (indiaSpecificRisk.includes("Threat") || indiaSpecificRisk.includes("at risk")) ? "var(--danger)" : "var(--text-bright)";

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

        <div class="forecast-callout-card" style="margin-top: 16px; margin-bottom: 16px; padding: 16px; background: linear-gradient(135deg, rgba(14, 42, 71, 0.6) 0%, rgba(6, 17, 33, 0.8) 100%); border: 1px solid rgba(111, 226, 255, 0.25); border-radius: 12px; box-shadow: 0 4px 20px rgba(0, 0, 0, 0.35); position: relative; overflow: hidden; display: flex; flex-direction: column; gap: 10px;">
            <div style="position: absolute; right: -15px; top: -15px; width: 80px; height: 80px; background: radial-gradient(circle, rgba(111, 226, 255, 0.08) 0%, transparent 70%); pointer-events: none;"></div>

            <div style="display: flex; align-items: center; gap: 8px;">
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="color: var(--accent);">
                    <circle cx="12" cy="12" r="10"/>
                    <line x1="12" y1="8" x2="12" y2="12"/>
                    <line x1="12" y1="16" x2="12.01" y2="16"/>
                </svg>
                <span style="text-transform: uppercase; letter-spacing: 0.08em; font-size: 0.78em; font-weight: 700; color: var(--text-bright);">Decay & Impact Forecast Summary</span>
            </div>

            <div style="display: grid; grid-template-columns: 1fr 1.2fr; gap: 16px;">
                <div style="border-right: 1px solid rgba(255, 255, 255, 0.08); padding-right: 12px;">
                    <div style="font-size: 0.75em; color: var(--text-dim); text-transform: uppercase; margin-bottom: 2px;">Est. Time Remaining</div>
                    <div style="font-family: var(--font-mono); font-size: 1.15em; font-weight: bold; color: var(--text-warning);">${timeToImpact || "Unknown"}</div>
                </div>
                <div>
                    <div style="font-size: 0.75em; color: var(--text-dim); text-transform: uppercase; margin-bottom: 2px;">India-Specific Risk Assessment</div>
                    <div style="font-size: 0.85em; font-weight: 500; color: ${riskColor}; line-height: 1.3;">
                        ${indiaSpecificRisk || "No immediate tactical threat identified."}
                    </div>
                </div>
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

    // Apply all active filters to the directory list to keep sidebar and globe in sync
    let satellites = appState.satellites;

    if (appState.hideCommercialSatellites) {
        satellites = satellites.filter((satellite) => !isCommercialSatelliteName(satellite.name));
    }

    if (appState.addedLast30Days) {
        const thirtyDaysAgo = Date.now() - 30 * 24 * 60 * 60 * 1000;
        satellites = satellites.filter((s) => s.firstAddedAt && new Date(s.firstAddedAt).getTime() >= thirtyDaysAgo);
    }

    if (appState.showOnlyIndian) {
        satellites = satellites.filter((s) => s.isIndian);
    }

    if (appState.orbitClassFilter) {
        satellites = satellites.filter((s) => {
            const orbitClass = s.characterisation?.orbitClass || "Unknown";
            return appState.orbitClassFilter[orbitClass] !== false;
        });
    }

    if (appState.orbitCountryFilter && appState.orbitCountryFilter !== "all") {
        satellites = satellites.filter((s) => {
            const satName = s.name.toUpperCase();
            if (appState.orbitCountryFilter === "indian") {
                return s.isIndian;
            } else if (appState.orbitCountryFilter === "friendly") {
                const friendlyList = appState.friendlySatellites || [];
                return friendlyList.some(p => satName.includes(p.toUpperCase().trim()));
            } else if (appState.orbitCountryFilter === "adversary") {
                const adversaryList = appState.adversarySatellites || [];
                return adversaryList.some(p => satName.includes(p.toUpperCase().trim()));
            }
            return true;
        });
    }

    if (appState.volumetricScanActive && appState.volumetricRelevantSats) {
        satellites = satellites.filter((s) => appState.volumetricRelevantSats.has(s.name));
    }

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

export function renderNeighbourhoodWatchAnalysis(result) {
    if (!elements.analysisPanel) {
        return;
    }

    if (!result || !Array.isArray(result.alerts)) {
        elements.analysisPanel.innerHTML = safeHtml`
            <div class="eyebrow">Neighbourhood Watch</div>
            <h2>Screening Results</h2>
            <p class="hint">No proximity events detected within the selected parameters.</p>
        `;
        return;
    }

    const scopeText = result.isGlobal ? "All Indian Assets" : result.primaryId;
    const passes = result.alerts || [];

    const renderFilteredList = () => {
        const severitySelect = document.getElementById("watchSeverityFilter");
        const distInput = document.getElementById("watchDistanceInput");
        const searchInput = document.getElementById("watchSearchInput");

        const severity = severitySelect?.value || "all";
        const maxDistVal = distInput?.value;
        const maxDist = maxDistVal ? Number(maxDistVal) : Infinity;
        const nameSearch = (searchInput?.value || "").toLowerCase().trim();

        let filtered = passes;

        if (severity === "critical") {
            filtered = filtered.filter(a => a.severity === "critical");
        } else if (severity === "warning") {
            filtered = filtered.filter(a => a.severity === "critical" || a.severity === "warning");
        } else if (severity === "routine") {
            filtered = filtered.filter(a => a.severity !== "critical" && a.severity !== "warning");
        }

        if (Number.isFinite(maxDist) && maxDist > 0) {
            filtered = filtered.filter(a => a.closestDistanceKm <= maxDist);
        }

        if (nameSearch) {
            filtered = filtered.filter(a =>
                (a.primaryId && a.primaryId.toLowerCase().includes(nameSearch)) ||
                (a.secondaryId && a.secondaryId.toLowerCase().includes(nameSearch))
            );
        }

        // Draw Globe markers matching current filtered set
        drawProximityAlerts(filtered);

        // Update counts in metric grid
        const critVal = elements.analysisPanel.querySelector(".watch-crit-val");
        const warnVal = elements.analysisPanel.querySelector(".watch-warn-val");
        const routVal = elements.analysisPanel.querySelector(".watch-rout-val");
        const totalVal = elements.analysisPanel.querySelector(".watch-total-val");

        if (critVal) critVal.textContent = filtered.filter(a => a.severity === "critical").length;
        if (warnVal) warnVal.textContent = filtered.filter(a => a.severity === "warning").length;
        if (routVal) routVal.textContent = filtered.filter(a => a.severity !== "critical" && a.severity !== "warning").length;
        if (totalVal) totalVal.textContent = filtered.length;

        // Render the list
        const listContainer = elements.analysisPanel.querySelector(".neighbourhood-watch-list");
        if (listContainer) {
            if (filtered.length === 0) {
                listContainer.innerHTML = `<div class="hint">No matching proximity events found.</div>`;
            } else {
                listContainer.innerHTML = filtered.map((alert) => {
                    let severityClass = "info";
                    let badgeClass = "badge-info";
                    let label = "ROUTINE";

                    if (alert.severity === "critical") {
                        severityClass = "danger";
                        badgeClass = "badge-danger";
                        label = "CRITICAL";
                    } else if (alert.severity === "warning") {
                        severityClass = "warning";
                        badgeClass = "badge-warning";
                        label = "WARNING";
                    }

                    return `
                        <div class="list-item ${severityClass}">
                            <div style="display: flex; justify-content: space-between; align-items: flex-start;">
                                <strong>${escapeHtml(alert.primaryId)} ↔ ${escapeHtml(alert.secondaryId)}</strong>
                                <span class="badge ${badgeClass}">${label}</span>
                            </div>
                            <div style="font-size: 0.9em; margin-top: 5px; color: var(--text-dim);">
                                Distance: <strong>${formatNumber(alert.closestDistanceKm, 2)} km</strong><br>
                                Rel. Velocity: ${Number.isFinite(alert.relativeVelocityKmS) ? `${formatNumber(alert.relativeVelocityKmS, 3)} km/s` : "N/A"}<br>
                                Time (UTC): ${formatDateTime(alert.time)}
                            </div>
                        </div>
                    `;
                }).join("");
            }
        }
    };

    // Calculate initial severity statistics
    const initialCritical = passes.filter(a => a.severity === "critical").length;
    const initialWarning = passes.filter(a => a.severity === "warning").length;
    const initialRoutine = passes.filter(a => a.severity !== "critical" && a.warning !== "warning").length;

    elements.analysisPanel.innerHTML = safeHtml`
        <div class="eyebrow">Neighbourhood Watch</div>
        <h2>${escapeHtml(scopeText)}</h2>
        <p>Proximity screening detected <span class="watch-total-val">${passes.length}</span> events within ${formatNumber(result.thresholdKm, 0)} km.</p>

        <div class="metric-grid">
            <div class="metric-card">
                <div class="label">Critical</div>
                <div class="value watch-crit-val" style="color: var(--severity-danger)">${initialCritical}</div>
            </div>
            <div class="metric-card">
                <div class="label">Warning</div>
                <div class="value watch-warn-val" style="color: var(--severity-warning)">${initialWarning}</div>
            </div>
            <div class="metric-card">
                <div class="label">Routine</div>
                <div class="value watch-rout-val" style="color: var(--severity-info)">${initialRoutine}</div>
            </div>
            <div class="metric-card">
                <div class="label">Threshold</div>
                <div class="value">${formatNumber(result.thresholdKm, 0)} km</div>
            </div>
        </div>

        <div class="section" style="background: rgba(255, 255, 255, 0.02); padding: 12px; border-radius: 8px; margin-bottom: 12px; margin-top: 12px;">
            <div class="section-title">Advanced Result Filters</div>
            <div style="display: flex; gap: 8px; flex-wrap: wrap;">
                <div class="field" style="flex: 1; min-width: 120px;">
                    <label for="watchSeverityFilter" style="font-size: 11px;">Severity</label>
                    <select id="watchSeverityFilter" style="padding: 6px 10px; font-size: 12px; width: 100%;">
                        <option value="all">All Severities</option>
                        <option value="critical">Critical Only</option>
                        <option value="warning">Warning & Critical</option>
                        <option value="routine">Routine Only</option>
                    </select>
                </div>
                <div class="field" style="flex: 1; min-width: 120px;">
                    <label for="watchDistanceInput" style="font-size: 11px;">Max Distance (km)</label>
                    <input id="watchDistanceInput" type="number" placeholder="Distance..." style="padding: 6px 10px; font-size: 12px; width: 100%;">
                </div>
                <div class="field" style="flex: 2; min-width: 180px;">
                    <label for="watchSearchInput" style="font-size: 11px;">Name Search</label>
                    <input id="watchSearchInput" type="search" placeholder="Search satellite..." class="search-input" style="padding: 6px 10px; font-size: 12px; width: 100%;">
                </div>
            </div>
        </div>

        <div class="section">
            <div class="section-title">Detected Proximity Events</div>
            <div class="list neighbourhood-watch-list">
                <!-- Will be populated by renderFilteredList -->
            </div>
        </div>
    `;

    // Render list initially
    renderFilteredList();

    // Bind event listeners with a slight delay
    setTimeout(() => {
        const severitySelect = document.getElementById("watchSeverityFilter");
        const distInput = document.getElementById("watchDistanceInput");
        const searchInput = document.getElementById("watchSearchInput");

        if (severitySelect) severitySelect.addEventListener("change", renderFilteredList);
        if (distInput) distInput.addEventListener("input", renderFilteredList);
        if (searchInput) searchInput.addEventListener("input", renderFilteredList);
    }, 0);
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

export function renderDriftAnalysis(drift) {
    if (!elements.analysisPanel || !drift || !drift.analysis) return;
    const a = drift.analysis;
    const tracks = drift.tracks || [];
    let longDrift = 0;
    let groundTrackDisp = 0;

    if (tracks.length >= 2) {
        const oldestTrack = [...tracks].sort((a,b) => a.dayOffset - b.dayOffset)[0];
        const latestTrack = [...tracks].sort((a,b) => b.dayOffset - a.dayOffset)[0];

        const oldest = oldestTrack.samples[0];
        const latest = latestTrack.samples[0];

        if (oldest && latest) {
            longDrift = latest.lon - oldest.lon;
            const p1 = new Cesium.Cartesian3(oldest.x, oldest.y, oldest.z);
            const p2 = new Cesium.Cartesian3(latest.x, latest.y, latest.z);
            groundTrackDisp = Cesium.Cartesian3.distance(p1, p2) / 1000;
        }
    }

    let narrative = "";
    const lonAbs = Math.abs(longDrift);
    const driftDir = longDrift > 0 ? "eastward" : "westward";

    if (lonAbs > 0.05) {
        narrative += `Satellite is <strong>drifting ${driftDir}</strong> (${lonAbs.toFixed(2)}° over ${a.daysAnalyzed} days). `;
    } else {
        narrative += `Satellite maintaining <strong>stable longitudinal station</strong>. `;
    }

    if (Math.abs(a.smaShiftKm) > 1) {
        narrative += `Orbital altitude has <strong>${a.smaShiftKm > 0 ? "increased" : "decreased"}</strong> by ${Math.abs(a.smaShiftKm).toFixed(1)} km, suggesting ${Math.abs(a.smaShiftKm) > 5 ? "a major manoeuvre" : "station-keeping activity"}. `;
    }

    const indiaLon = [68, 97];
    const currentLon = tracks.find(t => t.dayOffset === 0)?.samples[0]?.lon;
    if (currentLon >= indiaLon[0] && currentLon <= indiaLon[1]) {
        narrative += `Object currently has <strong>active coverage over Indian airspace</strong>. `;
    } else if (longDrift > 0 && currentLon < indiaLon[0]) {
        narrative += `Object is <strong>approaching Indian regional coverage</strong> from the west. `;
    } else if (longDrift < 0 && currentLon > indiaLon[1]) {
        narrative += `Object is <strong>approaching Indian regional coverage</strong> from the east. `;
    }

    // Generate Legend HTML
    const sortedTracks = [...tracks].sort((a, b) => a.dayOffset - b.dayOffset);
    const legendHtml = sortedTracks.map((t) => `
        <div style="display: flex; flex-direction: column; align-items: center; min-width: 55px; gap: 4px; position: relative;">
            <div style="width: 100%; height: 4px; background-color: ${t.color}; border-radius: 2px;"></div>
            <span style="font-size: 0.8em; font-family: monospace; color: ${t.isCurrent ? "var(--text-main)" : "var(--text-dim)"};">${t.dayOffset === 0 ? "Now" : `${t.dayOffset}d ago`}</span>
        </div>
    `).join('<div style="color: var(--text-dim); font-size: 0.8em; margin: 0 4px; align-self: center;">&rarr;</div>');

    elements.analysisPanel.innerHTML = safeHtml`
        <div class="eyebrow">Orbital Drift Overlay & Temporal Intelligence</div>
        <h2>Drift Evolution: ${escapeHtml(drift.satelliteId || "Active Satellite")}</h2>
        <p>Layered historical trajectories analyze how the satellite's orbital plane and altitude evolve over a multi-epoch timeline.</p>

        <div class="metric-grid">
            <div class="metric-card">
                <div class="label">Inclination Shift</div>
                <div class="value">${a.inclinationShiftDeg >= 0 ? "+" : ""}${a.inclinationShiftDeg.toFixed(4)}°</div>
            </div>
            <div class="metric-card">
                <div class="label">Altitude Delta</div>
                <div class="value">${a.smaShiftKm >= 0 ? "+" : ""}${a.smaShiftKm.toFixed(2)} km</div>
            </div>
            <div class="metric-card">
                <div class="label">Long. Drift</div>
                <div class="value">${longDrift >= 0 ? "+" : ""}${longDrift.toFixed(3)}°</div>
            </div>
            <div class="metric-card">
                <div class="label">Ground Displacement</div>
                <div class="value">${groundTrackDisp.toFixed(1)} km</div>
            </div>
        </div>

        <div class="section">
            <div class="section-title">Drift Intelligence Narrative</div>
            <div class="micro-card" style="border-left: 3px solid var(--text-success); background: rgba(124, 242, 154, 0.05); line-height: 1.5; font-size: 13.5px;">
                ${markSafe(narrative)}
            </div>
        </div>

        <div class="section">
            <div class="section-title">Temporal Legend & Color Coding</div>
            <div class="micro-card" style="display: flex; align-items: center; justify-content: center; gap: 8px; flex-wrap: wrap; padding: 16px;">
                ${markSafe(legendHtml)}
            </div>
        </div>

        <div class="section">
            <div class="section-title">Operational Context & Drift Importance</div>
            <div class="micro-card" style="font-size: 0.85em; line-height: 1.45; color: var(--text-dim);">
                <strong>Drift Tracking:</strong> Orbital drift occurs due to atmospheric drag, solar radiation pressure, and Earth's gravitational anomalies (J2 perturbation).
                <br><br>
                <strong>Threat Recognition:</strong> A sudden deviation in longitudinal drift rate without atmospheric cause is a prime signature of uncooperative thruster firings (manoeuvres) designed to reposition reconnaissance assets.
            </div>
        </div>
    `;
}

export function renderManoeuvreAnalysis(result) {
    if (!elements.analysisPanel || !result) return;
    const severity = result.severity || "info";
    const deltas = result.deltas || {};
    const severityClass = severity === "critical" ? "danger" :
                          severity === "high" ? "warning" :
                          severity === "medium" ? "monitor" : "success";

    elements.analysisPanel.innerHTML = safeHtml`
        <div class="eyebrow">Manoeuvre Signature & Threat Assessment</div>
        <h2>Manoeuvre Detected: ${escapeHtml(result.satelliteId || "Active Satellite")}</h2>
        <p>Comparison of predicted trajectory (from older TLE epoch) against actual observed trajectory (from recent TLE epoch) to isolate uncooperative station-keeping or intercept firings.</p>

        <div class="badge-row" style="margin-bottom: 16px;">
            <span class="badge badge-${severityClass}">${escapeHtml(result.classification.toUpperCase().replace('_', ' '))}</span>
            <span class="badge badge-outline">Threat Score: ${result.threatScore}</span>
        </div>

        <div class="metric-grid">
            <div class="metric-card">
                <div class="label">SMA Shift</div>
                <div class="value" style="color: white;">${deltas.semiMajorAxisKm.toFixed(2)} km</div>
            </div>
            <div class="metric-card">
                <div class="label">Inclination Shift</div>
                <div class="value" style="color: white;">${deltas.inclinationDeg.toFixed(4)}°</div>
            </div>
            <div class="metric-card">
                <div class="label">Eccentricity Delta</div>
                <div class="value" style="font-size: 13.5px; color: white;">${deltas.eccentricity.toFixed(6)}</div>
            </div>
            <div class="metric-card">
                <div class="label">Position Residual</div>
                <div class="value" style="color: white;">${result.epochResidualKm.toFixed(1)} km</div>
            </div>
        </div>

        <div class="section">
            <div class="section-title">Assessment Narrative</div>
            <div class="micro-card" style="border-left: 3px solid var(--severity-${severityClass}); font-style: italic; font-size: 13.5px; line-height: 1.5; background: rgba(255,255,255,0.02);">
                "${escapeHtml(result.assessment)}"
            </div>
        </div>

        ${result.proximity?.nearestIndianId ? markSafe(`
            <div class="section">
                <div class="section-title" style="color: var(--severity-danger);">Tactical Asset Proximity Warning</div>
                <div class="list-item danger" style="padding: 12px; border-radius: 8px;">
                    <strong>Threatening National Asset: ${escapeHtml(result.proximity.nearestIndianId)}</strong><br>
                    <div style="font-size: 0.9em; margin-top: 4px; color: var(--text-dim);">
                        Calculated Minimum Distance: <strong style="color: white;">${result.proximity.minDistanceAfterKm.toFixed(2)} km</strong><br>
                        Maneuver has placed the uncooperative object into a high-risk co-orbital screening envelope with our primary national resource.
                    </div>
                </div>
            </div>
        `) : ""}

        <div class="section">
            <div class="section-title">Visual Orbit Explanations</div>
            <div class="micro-card" style="font-size: 12px; display: flex; flex-direction: column; gap: 8px;">
                <div style="display: flex; align-items: center; gap: 8px;">
                    <div style="width: 16px; height: 0px; border-top: 2px dashed #99b7c8;"></div>
                    <span>Dotted Path: Predicted Reference Orbit (Pre-Maneuver Epoch)</span>
                </div>
                <div style="display: flex; align-items: center; gap: 8px;">
                    <div style="width: 16px; height: 2px; background: ${result.visualization?.newOrbit?.color || "#ff8c00"};"></div>
                    <span>Solid Path: Observed Trajectory (Post-Maneuver Fired Orbit)</span>
                </div>
            </div>
        </div>

        <div style="margin-top: 16px; font-size: 11px; color: var(--text-dim); text-align: right; font-family: monospace;">
            Processed Epoch: ${new Date(result.occurredAt).toLocaleString()}
        </div>
    `;
}

export function renderRegionalAccessAnalysis(result) {
    if (!elements.analysisPanel || !result) return;
    const findings = Array.isArray(result.findings) ? result.findings : [];
    const summary = result.summary || {};
    const debugMetrics = result.debugMetrics || {};

    const findingsHtml = findings.length > 0 ? findings.map(finding => {
        const severity = finding.operationalSeverity || "low";
        const confidence = Number.isFinite(finding.confidenceScore) ? `${Math.round(finding.confidenceScore * 100)}%` : "Unknown";
        const revisitChange = Number.isFinite(finding.revisitChangePercent) ? `${finding.revisitChangePercent >= 0 ? "+" : ""}${finding.revisitChangePercent.toFixed(0)}%` : "Unknown";

        return `\n            <div class="list-item" style="border-left: 4px solid var(--severity-${severity}); background: rgba(255,255,255,0.02); padding: 12px; border-radius: 8px; margin-bottom: 10px;">\n                <div style="display: flex; justify-content: space-between; align-items: flex-start; gap: 8px; margin-bottom: 8px;">\n                    <div>\n                        <strong style="font-size: 13px; color: white;">${escapeHtml(finding.satelliteName || "Unknown satellite")}</strong>\n                        <div style="font-size: 11px; color: var(--text-dim); margin-top: 2px;">NORAD: ${finding.noradId ?? "Unknown"}</div>\n                    </div>\n                    <div style="text-align: right; flex-shrink: 0;">\n                        <span class="badge badge-${severity}" style="padding: 2px 6px; font-size: 9px;">${escapeHtml(severity.toUpperCase())}</span><br>\n                        <span style="font-size: 10px; font-family: monospace; color: var(--text-warning); display: block; margin-top: 4px;">Conf: ${confidence}</span>\n                    </div>\n                </div>\n                <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 6px; font-family: monospace; font-size: 11.5px; color: var(--text-dim); margin-top: 6px;">\n                    <div>Trend: <span style="color: white;">${escapeHtml(finding.visibilityTrend?.toUpperCase() || "NONE")}</span></div>\n                    <div>Revisit Δ: <span style="color: white;">${revisitChange}</span></div>\n                    <div>Prev Passes: <span style="color: white;">${finding.previousPassCount ?? 0}</span></div>\n                    <div>Recent Passes: <span style="color: white;">${finding.recentPassCount ?? 0}</span></div>\n                    <div style="grid-column: span 2;">Avg Vis: <span style="color: white;">${Number.isFinite(finding.averageVisibilityDuration) ? finding.averageVisibilityDuration.toFixed(1) : "0.0"} min</span></div>\n                    <div style="grid-column: span 2;">First Access: <span style="color: white;">${finding.firstDetectedAccess ? new Date(finding.firstDetectedAccess).toLocaleString() : "Unknown"}</span></div>\n                </div>\n            </div>\n        `;
    }).join("") : '<div class="hint">No uncooperative satellites showed emerging regional visibility profiles in this timeframe.</div>';

    elements.analysisPanel.innerHTML = safeHtml`
        <div class="eyebrow">Emerging Regional Access & Visibility Shifts</div>
        <h2>Regional Presence: ${escapeHtml(result.region?.name || "Delhi Area")}</h2>
        <p>Identifies satellites whose orbital evolution newly places them inside a strategic reconnaissance swath over our target zone.</p>

        <div class="metric-grid">
            <div class="metric-card">
                <div class="label">Findings</div>
                <div class="value">${summary.findingCount ?? 0}</div>
            </div>
            <div class="metric-card">
                <div class="label">Unexpected Access</div>
                <div class="value" style="color: ${summary.unexpectedRegionalPresenceCount > 0 ? 'var(--severity-warning)' : 'inherit'};">${summary.unexpectedRegionalPresenceCount ?? 0}</div>
            </div>
            <div class="metric-card">
                <div class="label">Avg Confidence</div>
                <div class="value">${Number.isFinite(summary.averageConfidenceScore) ? `${Math.round(summary.averageConfidenceScore * 100)}%` : "0%"}</div>
            </div>
            <div class="metric-card">
                <div class="label">Pass Rate</div>
                <div class="value">${Number.isFinite(debugMetrics.coveragePassRate) ? `${Math.round(debugMetrics.coveragePassRate * 100)}%` : "0%"}</div>
            </div>
        </div>

        <div class="section">
            <div class="section-title">Emerging Access Intelligence Log</div>
            <div class="list">
                ${markSafe(findingsHtml)}
            </div>
        </div>

        <div class="section">
            <div class="section-title">Strategic Coverage Definition</div>
            <div class="micro-card" style="font-size: 0.85em; line-height: 1.45; color: var(--text-dim);">
                <strong>Revisit Delta (Revisit Δ):</strong> Shows the percentage increase or decrease in observation frequency. A negative percentage (e.g. -40%) indicates a shorter revisit time (higher risk).
                <br><br>
                <strong>Confidence:</strong> The probabilistic threshold that this visibility profile represents a sustained orbital realignment, rather than a transient propagation cross-over.
            </div>
        </div>
    `;
}
