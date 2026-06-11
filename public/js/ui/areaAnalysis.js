/**
 * ui/areaAnalysis.js
 *
 * Area analysis panel renderers for all region analysis types.
 * Extracted from the monolithic ui.js — exported via ui.js barrel.
 */

import { elements } from "../dom.js";
import { appState } from "../state.js";
import {
    escapeHtml, safeHtml, markSafe,
    formatDateTime, formatNumber, formatLatitude, formatLongitude
} from "../utils.js";

function getAreaAlerts(result) {
    if (!result) return [];
    if (Array.isArray(result.alerts)) return result.alerts;
    if (Array.isArray(result.conjunctions)) return result.conjunctions;
    return [];
}

function buildList(items, emptyMessage, className = "") {
    if (!items.length) {
        return markSafe(`<div class="hint">${escapeHtml(emptyMessage)}</div>`);
    }
    return markSafe(`<div class="list">${items.map(item => `<div class="list-item ${className}">${item}</div>`).join("")}</div>`);
}

// ---------------------------------------------------------------------------
// BLIND SPOT
// ---------------------------------------------------------------------------
export function renderBlindSpotAnalysis(result) {
    if (!elements.analysisPanel) return;
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
            <tbody>${tableContent}</tbody>
        </table>
    `;

    const centroid = (result.region || result.area).centroid;
    elements.analysisPanel.innerHTML = safeHtml`
        <div class="eyebrow">Blind Spot Detection</div>
        <h2>${formatLatitude(centroid.lat)} , ${formatLongitude(centroid.lon)}</h2>
        <p>Simplified blind spot coverage report for the selected region.</p>

        <div class="metric-grid">
            <div class="metric-card"><div class="label">Total Blind Gaps</div><div class="value">${windows.length}</div></div>
            <div class="metric-card">
                <div class="label">Overall Status</div>
                <div class="value" style="color: ${result.hasCoverage ? "var(--severity-success)" : "var(--severity-danger)"};">
                    ${result.hasCoverage ? "COVERED" : "BLIND"}
                </div>
            </div>
            <div class="metric-card"><div class="label">Coverage</div><div class="value">${formatNumber(result.coveragePercentage || 0, 1)}%</div></div>
            <div class="metric-card"><div class="label">Forecast Window</div><div class="value">${result.forecastWindowMinutes}m</div></div>
        </div>

        <div class="section">
            <div class="section-title">Simplified Blind Spot Schedule</div>
            <div class="list">${markSafe(tableHtml)}</div>
        </div>
    `;
}

// ---------------------------------------------------------------------------
// VOLUMETRIC SCAN
// ---------------------------------------------------------------------------
export function renderVolumetricScanAnalysis(result, passes) {
    if (!elements.analysisPanel) return;
    const minAltitude = result.minAltitudeKm ?? 0;
    const maxAltitude = result.maxAltitudeKm ?? 42000;
    const forecastMinutes = result.horizonMinutes || result.forecastWindowMinutes || 0;
    const centroid = (result.region || result.area).centroid;

    elements.analysisPanel.innerHTML = safeHtml`
        <div class="eyebrow">Volumetric Scan</div>
        <h2>${formatLatitude(centroid.lat)} , ${formatLongitude(centroid.lon)}</h2>
        <p>Volumetric scan identified <span class="volumetric-total-passes-val">${passes.length}</span> satellites passing through the defined 3D volume within the forecast period.</p>

        <div class="metric-grid">
            <div class="metric-card"><div class="label">Total Passes</div><div class="value volumetric-total-passes-val">${passes.length}</div></div>
            <div class="metric-card"><div class="label">Forecast</div><div class="value">${forecastMinutes}m</div></div>
            <div class="metric-card"><div class="label">Altitude Range</div><div class="value">${formatNumber(minAltitude, 0)}-${formatNumber(maxAltitude, 0)} km</div></div>
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
            <div class="list volumetric-pass-list"><!-- populated by refreshVolumetricList --></div>
        </div>
    `;

    const refreshVolumetricList = () => {
        const searchInput = document.getElementById("volumetricSearchInput");
        const activeBtn = elements.analysisPanel.querySelector(".volumetric-filter-btn.active");
        const filter = activeBtn ? activeBtn.dataset.filter : "all";
        const query = (searchInput?.value || "").toUpperCase().trim();

        let filtered = passes.filter(p => {
            const meta = appState.satelliteMetaMap.get(p.id);
            const type = meta?.objectType || "Payload";
            return type !== "Debris" && type !== "Rocket Body";
        });
        if (query) {
            filtered = filtered.filter(p =>
                p.id.toUpperCase().includes(query) ||
                (p.noradId && String(p.noradId).includes(query))
            );
        }
        if (filter !== "all") {
            filtered = filtered.filter(p => {
                const name = p.id.toUpperCase();
                if (filter === "indian") return p.isIndian;
                if (filter === "friendly") return (appState.friendlySatellites || ["GPS", "NOAA", "USA", "GOES", "LANDSAT"]).some(pat => name.includes(pat.toUpperCase().trim()));
                if (filter === "adversary") return ["YAOGAN", "FENGYUN", "SJ-", "SHIYAN", "BEIDOU"].some(pat => name.includes(pat.toUpperCase().trim()));
                return true;
            });
        }

        const listContainer = elements.analysisPanel.querySelector(".volumetric-pass-list");
        if (listContainer) {
            listContainer.innerHTML = filtered.length === 0
                ? `<div class="hint">No matching passes found.</div>`
                : filtered.slice(0, 30).map(pass => `
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

        elements.analysisPanel.querySelectorAll(".volumetric-total-passes-val").forEach(el => {
            el.textContent = filtered.length;
        });
    };

    refreshVolumetricList();

    setTimeout(() => {
        const searchInput = document.getElementById("volumetricSearchInput");
        if (searchInput) searchInput.addEventListener("input", refreshVolumetricList);
        elements.analysisPanel.querySelectorAll(".volumetric-filter-btn").forEach(btn => {
            btn.addEventListener("click", () => {
                elements.analysisPanel.querySelectorAll(".volumetric-filter-btn").forEach(b => {
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
}

// ---------------------------------------------------------------------------
// COLLISION DETECTION
// ---------------------------------------------------------------------------
export function renderCollisionDetectionAnalysis(result) {
    if (!elements.analysisPanel) return;
    const thresholdLabel = result.proximityThresholdKm || result.conjunctionThresholdKm || 25;
    let conjunctions = (Array.isArray(result.conjunctions) ? result.conjunctions : [])
        .filter(c => c.primaryIsIndian || c.secondaryIsIndian)
        .filter(c => {
            const pMeta = appState.satelliteMetaMap.get(c.primaryId);
            const sMeta = appState.satelliteMetaMap.get(c.secondaryId);
            const pType = pMeta?.objectType || "Payload";
            const sType = sMeta?.objectType || "Payload";
            return pType !== "Debris" && pType !== "Rocket Body" && sType !== "Debris" && sType !== "Rocket Body";
        });

    const conjunctionItems = conjunctions.slice(0, 15).map((conj, idx) => {
        const pcFormatted = conj.collisionProbability < 1e-7 ? " < 1e-7" : conj.collisionProbability.toExponential(2);
        const severity = conj.collisionProbability > 1e-4 ? "critical" : "warning";
        const relVel = conj.relativeVelocityKmS || 0;
        let velAnalysis = "Co-orbital / station-keeping trailing trajectory approach.";
        let velColor = "var(--severity-success)";
        if (relVel > 8.0) { velColor = "var(--severity-danger)"; velAnalysis = "Hypervelocity head-on intercept trajectory."; }
        else if (relVel > 2.0) { velColor = "var(--severity-warning)"; velAnalysis = "Crossing orbits trajectory intercept."; }

        return `
            <div class="list-item ${severity === "critical" ? "danger" : "warning"} indian"
                 style="cursor: pointer;" data-conj-index="${idx}">
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
        <div class="eyebrow">Collision Detection</div>
        <h2>High-Risk Collision Detection</h2>
        <p>Operational collision detection layer focused on national assets.</p>

        <div class="metric-grid">
            <div class="metric-card"><div class="label">Critical Risks</div><div class="value">${conjunctions.filter(c => c.collisionProbability > 1e-4).length}</div></div>
            <div class="metric-card"><div class="label">Total Events</div><div class="value">${conjunctions.length}</div></div>
            <div class="metric-card"><div class="label">Threshold</div><div class="value">${thresholdLabel} km</div></div>
        </div>

        <div class="section">
            <div class="section-title">Collision Risk Table</div>
            <div class="list">
                ${markSafe(conjunctionItems || '<div class="hint">No high-risk collisions detected for Indian assets within the selected window.</div>')}
            </div>
        </div>
    `;
    appState.lastCollisionResult = result;
}

// ---------------------------------------------------------------------------
// CONJUNCTION ANALYSIS
// ---------------------------------------------------------------------------
export function renderConjunctionAnalysis(result) {
    if (!elements.analysisPanel) return;
    let conjunctions = (Array.isArray(result.conjunctions) ? result.conjunctions : [])
        .filter(c => {
            const pMeta = appState.satelliteMetaMap.get(c.primaryId);
            const sMeta = appState.satelliteMetaMap.get(c.secondaryId);
            const pType = pMeta?.objectType || "Payload";
            const sType = sMeta?.objectType || "Payload";
            return pType !== "Debris" && pType !== "Rocket Body" && sType !== "Debris" && sType !== "Rocket Body";
        });
    const summary = {
        critical: conjunctions.filter(c => c.severity === "critical").length,
        high: conjunctions.filter(c => c.severity === "high").length,
        medium: conjunctions.filter(c => c.severity === "medium").length,
        total: conjunctions.length
    };
    const forecastMinutes = result.horizonMinutes || result.forecastWindowMinutes || 0;
    const thresholdLabel = result.proximityThresholdKm || result.conjunctionThresholdKm || 25;

    const conjunctionItems = conjunctions.map((conj, idx) => {
        const severityClass = conj.severity === "critical" ? "danger" :
                              conj.severity === "high" ? "warning" :
                              conj.severity === "medium" ? "monitor" : "success";
        const pcFormatted = (conj.collisionProbability || 0).toExponential(1);
        let regionName = conj.orbitClass;
        if (!regionName) {
            const x = conj.primaryPos?.x || 0;
            const y = conj.primaryPos?.y || 0;
            const z = conj.primaryPos?.z || 0;
            const alt = Math.sqrt(x * x + y * y + z * z) - 6371;
            if (alt < 2000) regionName = "LEO";
            else if (alt > 36786) regionName = "HEO";
            else if (Math.abs(alt - 35786) < 1000) regionName = "GEO";
            else regionName = "MEO";
        }

        return `
            <div class="list-item ${severityClass} ${conj.primaryIsIndian || conj.secondaryIsIndian ? "indian" : ""}"
                 style="cursor: pointer;" data-conj-index="${idx}">
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
        <div class="eyebrow">Conjunction Analysis</div>
        <h2>Operational Conjunction Report</h2>
        <p>Operational conjunction screening identifying close-approach events.</p>

        <div class="metric-grid">
            <div class="metric-card"><div class="label">Critical</div><div class="value" style="color: var(--severity-danger)">${summary.critical}</div></div>
            <div class="metric-card"><div class="label">High Risk</div><div class="value" style="color: var(--severity-warning)">${summary.high}</div></div>
            <div class="metric-card"><div class="label">Total Events</div><div class="value">${summary.total}</div></div>
            <div class="metric-card"><div class="label">Window</div><div class="value">${forecastMinutes >= 1440 ? (forecastMinutes / 1440).toFixed(0) + "d" : (forecastMinutes / 60).toFixed(0) + "h"}</div></div>
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
}

// ---------------------------------------------------------------------------
// GENERAL AREA ANALYSIS DISPATCHER
// ---------------------------------------------------------------------------
export function renderAreaAnalysis(result) {
    if (!elements.analysisPanel) return;

    if (result.analysisType === "blind_spot") {
        return renderBlindSpotAnalysis(result);
    }

    const passes = Array.isArray(result.passes) ? result.passes : [];

    if (result.analysisType === "volumetric_scan") {
        return renderVolumetricScanAnalysis(result, passes);
    }

    if (result.analysisType === "collision_detection") {
        return renderCollisionDetectionAnalysis(result);
    }

    if (result.analysisType === "conjunction_analysis") {
        return renderConjunctionAnalysis(result);
    }

    // Fallback: generic proximity analysis
    let alerts = getAreaAlerts(result).filter(c => {
        const pMeta = appState.satelliteMetaMap.get(c.primaryId);
        const sMeta = c.secondaryId ? appState.satelliteMetaMap.get(c.secondaryId) : null;
        const pType = pMeta?.objectType || "Payload";
        const sType = sMeta?.objectType || "Payload";
        return pType !== "Debris" && pType !== "Rocket Body" && sType !== "Debris" && sType !== "Rocket Body";
    });
    const thresholdLabel = result.proximityThresholdKm || result.conjunctionThresholdKm || result.visibilityThresholdDeg || 25;
    const forecastMinutes = result.horizonMinutes || result.forecastWindowMinutes || 0;
    const minAltitude = result.minAltitudeKm ?? 0;
    const maxAltitude = result.maxAltitudeKm ?? 42000;
    const criticalAlerts = alerts.filter(a => a.severity === "critical");
    const centroid = (result.region || result.area).centroid;

    const filteredPasses = passes.filter(p => {
        const meta = appState.satelliteMetaMap.get(p.id);
        const type = meta?.objectType || "Payload";
        return type !== "Debris" && type !== "Rocket Body";
    });

    const passItems = filteredPasses.slice(0, 6).map(pass => `
        <strong>${escapeHtml(pass.id)}${pass.isIndian ? " [IND]" : ""}</strong> Starts ${formatDateTime(pass.startTime)}<br>
        Closest approach: ${formatNumber(pass.closestApproachKm, 0)} km<br>
        Peak altitude: ${formatNumber(pass.peakAltitudeKm ?? pass.maxAltitudeKm ?? 0, 0)} km
    `);
    const alertItems = criticalAlerts.slice(0, 6).map(alert => `
        <strong>${escapeHtml(alert.primaryId)}${alert.secondaryId ? ` / ${escapeHtml(alert.secondaryId)}` : ""}</strong> Closest sampled distance: ${formatNumber(alert.closestDistanceKm, 2)} km<br>
        Altitude: ${formatNumber(alert.altitudeKm, 0)} km<br>
        Time: ${formatDateTime(alert.time || alert.startTime)}
    `);

    elements.analysisPanel.innerHTML = safeHtml`
        <div class="eyebrow">Analysis</div>
        <h2>${formatLatitude(centroid.lat)} , ${formatLongitude(centroid.lon)}</h2>
        <p>Forecast generated for a traced region with ${result.region?.points?.length || result.area.points.length} points. Satellites are filtered between ${formatNumber(minAltitude, 0)} km and ${formatNumber(maxAltitude, 0)} km across a ${forecastMinutes} minute forecast window.</p>

        <div class="metric-grid">
            <div class="metric-card"><div class="label">Trace Points</div><div class="value">${result.region?.points?.length || result.area.points.length}</div></div>
            <div class="metric-card"><div class="label">Proximity</div><div class="value">${thresholdLabel} km</div></div>
            <div class="metric-card"><div class="label">Forecast</div><div class="value">${forecastMinutes}m</div></div>
            <div class="metric-card"><div class="label">Findings</div><div class="value">${criticalAlerts.length}</div></div>
            <div class="metric-card"><div class="label">Region Passes</div><div class="value">${filteredPasses.length}</div></div>
            <div class="metric-card"><div class="label">Altitude Window</div><div class="value">${formatNumber(minAltitude, 0)}-${formatNumber(maxAltitude, 0)} km</div></div>
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
            <div class="micro-card">${filteredPasses.filter(pass => pass.isIndian).length} Indian-satellite passes are predicted in this forecast window</div>
        </div>
    `;
}
