/**
 * ui/alertRenderer.js
 *
 * Renders operational alert cards in the analysis panel.
 * Extracted from the monolithic ui.js — exported via ui.js barrel.
 */

import { elements } from "../dom.js";
import { escapeHtml, safeHtml, markSafe, formatDateTime, formatNumber } from "../utils.js";

// Type configuration map
const TYPE_CONFIGS = {
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

export function resolveAlertType(alert) {
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

export function buildAlertCard(alert) {
    const alertType = resolveAlertType(alert);
    const config = TYPE_CONFIGS[alertType] || TYPE_CONFIGS.general;

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
        idLine = `<div style="margin: 6px 0;"><span style="font-family: Consolas, monospace; background: rgba(111, 226, 255, 0.12); border: 1px solid rgba(111, 226, 255, 0.3); color: var(--accent); padding: 1px 5px; border-radius: 4px; font-size: 10.5px;">${escapeHtml(primary)}</span></div>`;
    } else if (secondary) {
        idLine = `<div style="margin: 6px 0;"><span style="font-family: Consolas, monospace; background: rgba(255, 153, 51, 0.12); border: 1px solid rgba(255, 153, 51, 0.3); color: var(--indian); padding: 1px 5px; border-radius: 4px; font-size: 10.5px;">${escapeHtml(secondary)}</span></div>`;
    }

    const metrics = [];
    let distanceVal = alert.closestDistanceKm;
    if (!Number.isFinite(distanceVal)) {
        const risks = alert.details?.rawAlert?.details?.strategicRisks || alert.details?.strategicRisks;
        if (Array.isArray(risks) && risks.length > 0) {
            const dists = risks.map(r => r.distanceKm).filter(Number.isFinite);
            if (dists.length > 0) distanceVal = Math.min(...dists);
        }
    }
    if (Number.isFinite(distanceVal)) metrics.push({ label: "Distance", value: `${formatNumber(distanceVal, 2)} km` });

    let altitudeVal = alert.details?.altitudeKm ?? alert.details?.currentAltitudeKm
        ?? alert.details?.rawAlert?.details?.currentAltitudeKm
        ?? alert.details?.rawAlert?.details?.altitudeKm;
    if (Number.isFinite(altitudeVal)) metrics.push({ label: "Altitude", value: `${formatNumber(altitudeVal, 0)} km` });

    let relativeVelocityVal = alert.details?.relativeVelocityKmS ?? alert.details?.rawAlert?.details?.relativeVelocityKmS;
    if (Number.isFinite(relativeVelocityVal)) metrics.push({ label: "Rel. Vel", value: `${formatNumber(relativeVelocityVal, 3)} km/s` });

    let durationVal = alert.durationMinutes || alert.details?.durationMinutes || alert.details?.rawAlert?.details?.durationMinutes;
    if (Number.isFinite(durationVal)) metrics.push({ label: "Duration", value: `${formatNumber(durationVal, 1)} min` });

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
}

export function renderOperationalAlerts(alerts = []) {
    if (!document.getElementById("operationalAlertSummary") || !elements.analysisPanel) {
        return;
    }
    const summaryElement = document.getElementById("operationalAlertSummary");
    if (!Array.isArray(alerts) || !alerts.length) {
        summaryElement.textContent = "No operational alerts recorded yet.";
        elements.analysisPanel.innerHTML = safeHtml`
            <div class="eyebrow">Tactical Alerts &amp; Event Log</div>
            <h2>Space Domain Operational Alerts Feed</h2>
            <p>Real-time conjunction detections, uncooperative manoeuvres, blind spot entries, and regional scan events recorded by backend analytical processors.</p>
            <div class="hint" style="margin-top: 16px;">Conjunction results will appear here after the backend records them.</div>
        `;
        return;
    }

    summaryElement.textContent = `${alerts.length} operational alert${alerts.length === 1 ? "" : "s"} loaded from the backend feed.`;

    const criticalCount = alerts.filter(a => a.severity === "critical").length;
    const warningCount = alerts.filter(a => a.severity === "warning").length;
    const infoCount = alerts.filter(a => a.severity !== "critical" && a.severity !== "warning").length;

    const statsHeader = `
        <div style="display: flex; gap: 6px; margin-bottom: 12px; font-size: 10px; flex-wrap: wrap;">
            <span style="background: rgba(255, 123, 123, 0.12); color: var(--danger); border: 1px solid rgba(255, 123, 123, 0.3); padding: 3px 8px; border-radius: 4px; font-weight: bold; text-transform: uppercase; letter-spacing: 0.05em;">CRITICAL: ${criticalCount}</span>
            <span style="background: rgba(255, 209, 102, 0.12); color: var(--warning); border: 1px solid rgba(255, 209, 102, 0.3); padding: 3px 8px; border-radius: 4px; font-weight: bold; text-transform: uppercase; letter-spacing: 0.05em;">WARNING: ${warningCount}</span>
            <span style="background: rgba(111, 226, 255, 0.12); color: var(--accent); border: 1px solid rgba(111, 226, 255, 0.3); padding: 3px 8px; border-radius: 4px; font-weight: bold; text-transform: uppercase; letter-spacing: 0.05em;">INFO: ${infoCount}</span>
        </div>
    `;

    const cardsHtml = alerts.slice(0, 5).map(buildAlertCard).join("");

    elements.analysisPanel.innerHTML = safeHtml`
        <div class="eyebrow">Tactical Alerts &amp; Event Log</div>
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
