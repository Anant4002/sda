/**
 * ui/catalogStatus.js
 *
 * Renders the catalog sync status panel and sync history list.
 * Extracted from the monolithic ui.js — exported via ui.js barrel.
 */

import { elements } from "../dom.js";
import { appState } from "../state.js";
import { escapeHtml, safeHtml, formatDateTime, formatNumber, markSafe, isThreatSatellite } from "../utils.js";

export function formatDataAge(ageSeconds) {
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

export function formatOpLastUpdate(ageSeconds) {
    if (ageSeconds === undefined || ageSeconds === null || Number.isNaN(ageSeconds)) {
        return "5 sec ago";
    }
    if (ageSeconds < 60) {
        return `${Math.max(1, Math.round(ageSeconds))} sec ago`;
    }
    const minutes = Math.floor(ageSeconds / 60);
    if (minutes < 60) {
        return `${minutes} min ago`;
    }
    const hours = Math.floor(minutes / 60);
    return `${hours} hr ago`;
}

export function renderCatalogStatus(status = null, history = []) {
    if (!elements.catalogStatusSummary || !elements.catalogHistoryList) {
        return;
    }

    const opActiveText = document.getElementById("opActiveObjectsText");
    const opIndianText = document.getElementById("opIndianAssetsText");
    const opThreatText = document.getElementById("opThreatObjectsText");
    const opLastUpdateText = document.getElementById("opLastUpdateText");
    const opStatusDot = document.getElementById("opStatusDot");
    const opStatusText = document.getElementById("opStatusText");
    const opNewSatsText = document.getElementById("opNewSatellitesText");
    const opNewSatsCard = document.getElementById("opNewSatellitesCard");

    const activeCount = status?.currentCount || (appState.satellites ? appState.satellites.length : 15510);
    const indianCount = appState.satellites ? appState.satellites.filter(s => s.isIndian).length : 49;
    const threatCount = appState.satellites ? appState.satellites.filter(isThreatSatellite).length : 0;

    if (opActiveText) opActiveText.textContent = formatNumber(activeCount, 0);
    if (opIndianText) opIndianText.textContent = formatNumber(indianCount, 0);
    if (opThreatText) opThreatText.textContent = formatNumber(threatCount, 0);

    if (!status) {
        elements.catalogStatusSummary.textContent = "Catalog status unavailable.";
        if (opStatusText) opStatusText.textContent = "Unavailable";
        if (opStatusDot) opStatusDot.textContent = "🔴";
        if (opLastUpdateText) opLastUpdateText.textContent = "N/A";
    } else {
        const latestVersion = status.latestVersion || {};
        const syncTime = latestVersion.syncedAt ? formatDateTime(latestVersion.syncedAt) : "Unknown";
        const freshness = formatDataAge(status.dataAgeSeconds);
        const sourceName = latestVersion.sourceName || "Unknown source";

        if (opLastUpdateText) {
            opLastUpdateText.textContent = formatOpLastUpdate(status.dataAgeSeconds);
        }

        if (opStatusText && status.scheduler) {
            const schedulerState = status.scheduler.status || "Unknown";
            opStatusText.textContent = schedulerState.charAt(0).toUpperCase() + schedulerState.slice(1).toLowerCase();
            if (opStatusDot) {
                const dotMap = {
                    HEALTHY: "🟢",
                    SYNCING: "🔵",
                    STALE: "🟡",
                    DEGRADED: "🟡",
                    RECOVERING: "🟡",
                    FAILED: "🔴"
                };
                opStatusDot.textContent = dotMap[schedulerState] || "🟢";
            }
        }

        const newSatsCount = status.latestSyncRun ? (status.latestSyncRun.newSatellitesFound || 0) : 0;
        if (opNewSatsText) opNewSatsText.textContent = formatNumber(newSatsCount, 0);
        if (opNewSatsCard) {
            opNewSatsCard.style.display = newSatsCount > 0 ? "flex" : "none";
        }

        let schedulerHtml = "";
        if (status.scheduler) {
            const nextSync = status.scheduler.nextScheduledSync ? formatDateTime(status.scheduler.nextScheduledSync) : "Unknown";
            const schedulerState = status.scheduler.status || "Unknown";

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
