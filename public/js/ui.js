/**
 * ui.js — Barrel Export (Phase-1 Refactor)
 *
 * This file previously contained all UI rendering logic (~2,226 lines).
 * It has been refactored into focused sub-modules under public/js/ui/.
 *
 * All existing imports of the form:
 *   import { X } from '../../ui.js'  (or './ui.js')
 * continue to work unchanged — this barrel re-exports every public symbol
 * from the sub-modules, preserving the exact same API surface.
 *
 * Sub-module responsibilities:
 *   ui/headerBar.js       — setStatus, renderDefaultAnalysis, updateAreaReadout, renderAnalysisLoader
 *   ui/catalogStatus.js   — renderCatalogStatus, formatDataAge, formatOpLastUpdate
 *   ui/alertRenderer.js   — renderOperationalAlerts, resolveAlertType, buildAlertCard
 *   ui/areaAnalysis.js    — renderAreaAnalysis and all analysis type sub-renderers
 *   ui/satellitePanel.js  — renderSatellitePath, updateCollisionAlert, renderSatelliteListItem
 *
 * Functions that live only in ui.js (large panel renderers not extracted):
 *   renderCharacterisationSummary, renderReentryIntelligence, renderDriftAnalytics,
 *   renderDriftAnalysis, renderManoeuvreAnalysis, renderNeighbourhoodWatchAnalysis,
 *   renderRegionalAccessAnalysis, renderUnifiedThreatInsights, renderSatelliteDirectory
 *   These remain in-line below as a transitional step; they will be extracted
 *   in a subsequent refactor pass.
 *
 * Developer note: do NOT add new top-level functions to this file.
 * Add them to the appropriate sub-module and add an export line here.
 */

// ---------------------------------------------------------------------------
// EXTERNAL IMPORTS (retained for inline functions below)
// ---------------------------------------------------------------------------
import { SATELLITE_FILTER_RESULT_LIMIT } from "./config.js";
import { elements } from "./dom.js";
import { appState } from "./state.js";
import { drawProximityAlerts } from "./viewer.js";
import {
    buildSatelliteGroups,
    computeBounds,
    escapeHtml,
    isCommercialSatelliteName,
    isThreatSatellite,
    safeHtml,
    formatDateTime,
    formatLatitude,
    formatLongitude,
    formatNumber,
    markSafe,
    normalizeSearchValue
} from "./utils.js";

// ---------------------------------------------------------------------------
// SUB-MODULE RE-EXPORTS
// ---------------------------------------------------------------------------
export { setStatus, renderDefaultAnalysis, updateAreaReadout, renderAnalysisLoader } from "./ui/headerBar.js";
export { renderCatalogStatus, formatDataAge, formatOpLastUpdate } from "./ui/catalogStatus.js";
export { renderOperationalAlerts, resolveAlertType, buildAlertCard } from "./ui/alertRenderer.js";
export {
    renderAreaAnalysis,
    renderBlindSpotAnalysis,
    renderVolumetricScanAnalysis,
    renderConjunctionAnalysis,
    renderCollisionDetectionAnalysis
} from "./ui/areaAnalysis.js";
export {
    updateCollisionAlert,
    renderCollisionAlert,
    renderSatellitePath,
    renderSatelliteDetailPanel,
    renderSatelliteListItem
} from "./ui/satellitePanel.js";

// ---------------------------------------------------------------------------
// INLINE FUNCTIONS (transitional — to be extracted in next refactor pass)
// ---------------------------------------------------------------------------

function buildList(items, emptyMessage, className = "") {
    if (!items.length) {
        return markSafe(`<div class="hint">${escapeHtml(emptyMessage)}</div>`);
    }
    return markSafe(`<div class="list">${items.map((item) => `<div class="list-item ${className}">${item}</div>`).join("")}</div>`);
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
            <div class="section-title">Object Classification Breakdown</div>
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
        <div class="eyebrow">Orbital Decay Intelligence &amp; Re-entry Prediction</div>
        <h2>${escapeHtml(satelliteName)}</h2>

        <div class="badge-row" style="margin-bottom: 12px;">
            <span class="badge ${riskSeverity}">Risk: ${escapeHtml(riskLevel)}</span>
            <span class="badge badge-outline">${escapeHtml(status === "decaying" ? "Orbital Decay Detected" : "Stable Orbit")}</span>
        </div>

        <div class="metric-grid">
            <div class="metric-card"><div class="label">Current Altitude</div><div class="value">~${currentAltitudeKm ? formatNumber(currentAltitudeKm, 0) : "N/A"} km</div></div>
            <div class="metric-card"><div class="label">Perigee Altitude</div><div class="value">${currentPerigeeKm ? formatNumber(currentPerigeeKm, 0) : "N/A"} km</div></div>
            <div class="metric-card"><div class="label">Re-entry Time</div><div class="value">${status === "stable" ? "Stable" : (estimatedReentryDate ? formatDateTime(estimatedReentryDate).split(",")[0] : "N/A")}</div></div>
            <div class="metric-card"><div class="label">Uncertainty</div><div class="value">${status === "stable" ? "None" : escapeHtml(reentryWindow || "N/A")}</div></div>
        </div>

        <div class="forecast-callout-card" style="margin-top: 16px; margin-bottom: 16px; padding: 16px; background: linear-gradient(135deg, rgba(14, 42, 71, 0.6) 0%, rgba(6, 17, 33, 0.8) 100%); border: 1px solid rgba(111, 226, 255, 0.25); border-radius: 12px; display: flex; flex-direction: column; gap: 10px;">
            <div style="display: grid; grid-template-columns: 1fr 1.2fr; gap: 16px;">
                <div style="border-right: 1px solid rgba(255, 255, 255, 0.08); padding-right: 12px;">
                    <div style="font-size: 0.75em; color: var(--text-dim); text-transform: uppercase; margin-bottom: 2px;">Est. Time Remaining</div>
                    <div style="font-family: var(--font-mono); font-size: 1.15em; font-weight: bold; color: var(--text-warning);">${timeToImpact || "Unknown"}</div>
                </div>
                <div>
                    <div style="font-size: 0.75em; color: var(--text-dim); text-transform: uppercase; margin-bottom: 2px;">India-Specific Risk Assessment</div>
                    <div style="font-size: 0.85em; font-weight: 500; color: ${riskColor}; line-height: 1.3;">${indiaSpecificRisk || "No immediate tactical threat identified."}</div>
                </div>
            </div>
        </div>

        <div class="section">
            <div class="section-title">Strategic Risk Assessment</div>
            <div class="list">${markSafe(riskAlerts)}</div>
        </div>

        <div class="section">
            <div class="section-title">Re-entry Simulation</div>
            <div class="list">
                <div class="list-item ${stabilitySeverity}">
                    <strong>Drag-based Decay Forecast</strong><br>
                    ${escapeHtml(message)}
                </div>
            </div>
        </div>

        <div class="section">
            <div class="section-title">Historical Altitude Trend</div>
            <div class="list">${markSafe(historyItems)}</div>
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
        <div class="eyebrow">Forensics &amp; Drift</div>
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

    let satellites = appState.satellites;

    if (appState.hideCommercialSatellites) {
        satellites = satellites.filter((satellite) => !isCommercialSatelliteName(satellite.name));
    }
    if (appState.addedLast30Days) {
        const thirtyDaysAgo = Date.now() - 30 * 24 * 60 * 60 * 1000;
        satellites = satellites.filter((s) => s.firstAddedAt && new Date(s.firstAddedAt).getTime() >= thirtyDaysAgo);
    }
    if (appState.showOnlyNewSyncSatellites) {
        satellites = satellites.filter((s) => appState.latestNewSatelliteNames && appState.latestNewSatelliteNames.has(s.name));
    }
    if (appState.showOnlyIndian) satellites = satellites.filter((s) => s.isIndian);
    if (appState.showOnlyThreats) satellites = satellites.filter((s) => isThreatSatellite(s));

    if (appState.activePriorityGroup) {
        const group = appState.activePriorityGroup;
        if (group === "indian") satellites = satellites.filter((s) => s.isIndian);
        else if (group === "chinese_isr") satellites = satellites.filter((s) => /YAOGAN|GAOFEN|ZHUHAI/i.test(s.name));
        else if (group === "adversary_mil") satellites = satellites.filter((s) => /SHIYAN|SHIJIAN|TIANHUI|COSMOS/i.test(s.name));
        else if (group === "nav") satellites = satellites.filter((s) => /BEIDOU|GPS|GLONASS|GALILEO|IRNSS/i.test(s.name));
        else if (group === "commercial") satellites = satellites.filter((s) => /STARLINK|ONEWEB|KUIPER|DIGUI|FLOCK|PLANET|MAXAR/i.test(s.name));
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
            if (appState.orbitCountryFilter === "indian") return s.isIndian;
            if (appState.orbitCountryFilter === "friendly") return (appState.friendlySatellites || []).some(p => satName.includes(p.toUpperCase().trim()));
            if (appState.orbitCountryFilter === "adversary") return (appState.adversarySatellites || []).some(p => satName.includes(p.toUpperCase().trim()));
            return true;
        });
    }
    if (appState.volumetricScanActive && appState.volumetricRelevantSats) {
        satellites = satellites.filter((s) => appState.volumetricRelevantSats.has(s.name));
    }

    const groups = buildSatelliteGroups(satellites);
    const query = normalizeSearchValue(elements.satelliteSearchInput.value);

    const filteredGroups = groups.filter((group) => {
        if (appState.hiddenGroupLabels.has(group.label)) return false;
        if (!query) return true;
        if (group.label.includes(query)) return true;
        return group.satellites.some(s => String(s.noradId || "").toUpperCase().includes(query));
    });

    const PAGE_SIZE = 5;
    if (appState.catalogPage === undefined) appState.catalogPage = 1;
    const totalMatches = filteredGroups.length;
    const totalPages = Math.max(1, Math.ceil(totalMatches / PAGE_SIZE));
    if (appState.catalogPage > totalPages) appState.catalogPage = totalPages;
    const startIndex = (appState.catalogPage - 1) * PAGE_SIZE;
    const visibleGroups = filteredGroups.slice(startIndex, startIndex + PAGE_SIZE);

    elements.indianSummary.textContent = appState.isAreaFocusMode ? "Region Focus Working Set" : "SDA Operational Directory";

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
                            ${char.objectType && char.objectType.toUpperCase() !== "PAYLOAD" ? `<span class="badge badge-outline">${escapeHtml(char.objectType)}</span>` : ""}
                            ${char.operationalStatus ? `<span class="badge ${char.operationalStatus === "Active" ? "badge-success" : "badge-warning"}">${escapeHtml(char.operationalStatus)}</span>` : ""}
                            ${char.threatTier ? `<span class="badge badge-outline">${escapeHtml(char.threatTier)}</span>` : ""}
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

    const prevBtn = document.getElementById("prevCatalogPageBtn");
    const nextBtn = document.getElementById("nextCatalogPageBtn");
    const pageInfo = document.getElementById("catalogPageInfo");

    if (pageInfo) {
        const endShow = Math.min(startIndex + PAGE_SIZE, totalMatches);
        pageInfo.textContent = totalMatches === 0 ? "Showing 0 of 0" : `Showing ${startIndex + 1}–${endShow} of ${totalMatches}`;
    }
    if (prevBtn) {
        prevBtn.disabled = appState.catalogPage === 1;
        prevBtn.style.opacity = appState.catalogPage === 1 ? "0.4" : "1";
        prevBtn.style.pointerEvents = appState.catalogPage === 1 ? "none" : "auto";
    }
    if (nextBtn) {
        nextBtn.disabled = appState.catalogPage === totalPages;
        nextBtn.style.opacity = appState.catalogPage === totalPages ? "0.4" : "1";
        nextBtn.style.pointerEvents = appState.catalogPage === totalPages ? "none" : "auto";
    }

    const hiddenGroups = Array.from(appState.hiddenGroupLabels).sort();
    if (elements.hiddenGroupsSummary) {
        elements.hiddenGroupsSummary.textContent = hiddenGroups.length ? `Hidden groups: ${hiddenGroups.join(", ")}` : "No satellite name groups are hidden.";
    }
    if (elements.resetHiddenGroupsButton) elements.resetHiddenGroupsButton.disabled = hiddenGroups.length === 0;
    if (elements.finishTraceButton) {
        elements.finishTraceButton.disabled = !(appState.isTraceModeEnabled && appState.tracePoints.length >= 3);
    }

    if (!elements.indianSatList) return;

    elements.indianSatList.onclick = (event) => {
        const orbitButton = event.target.closest("[data-satellite-id]");
        if (orbitButton) { toggleSatellitePath(orbitButton.dataset.satelliteId); return; }
        const hideButton = event.target.closest("[data-toggle-group]");
        if (hideButton) hideGroup(hideButton.dataset.toggleGroup);
    };

    if (elements.resetHiddenGroupsButton) elements.resetHiddenGroupsButton.onclick = clearHiddenGroups;
}

export function renderNeighbourhoodWatchAnalysis(result) {
    if (!elements.analysisPanel) return;

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
        if (severity === "critical") filtered = filtered.filter(a => a.severity === "critical");
        else if (severity === "warning") filtered = filtered.filter(a => a.severity === "critical" || a.severity === "warning");
        else if (severity === "routine") filtered = filtered.filter(a => a.severity !== "critical" && a.severity !== "warning");
        if (Number.isFinite(maxDist) && maxDist > 0) filtered = filtered.filter(a => a.closestDistanceKm <= maxDist);
        if (nameSearch) filtered = filtered.filter(a =>
            (a.primaryId && a.primaryId.toLowerCase().includes(nameSearch)) ||
            (a.secondaryId && a.secondaryId.toLowerCase().includes(nameSearch))
        );

        drawProximityAlerts(filtered);

        const critVal = elements.analysisPanel.querySelector(".watch-crit-val");
        const warnVal = elements.analysisPanel.querySelector(".watch-warn-val");
        const routVal = elements.analysisPanel.querySelector(".watch-rout-val");
        const totalVal = elements.analysisPanel.querySelector(".watch-total-val");
        if (critVal) critVal.textContent = filtered.filter(a => a.severity === "critical").length;
        if (warnVal) warnVal.textContent = filtered.filter(a => a.severity === "warning").length;
        if (routVal) routVal.textContent = filtered.filter(a => a.severity !== "critical" && a.severity !== "warning").length;
        if (totalVal) totalVal.textContent = filtered.length;

        const listContainer = elements.analysisPanel.querySelector(".neighbourhood-watch-list");
        if (listContainer) {
            listContainer.innerHTML = filtered.length === 0
                ? `<div class="hint">No matching proximity events found.</div>`
                : filtered.map((alert) => {
                    let severityClass = "info", badgeClass = "badge-info", label = "ROUTINE";
                    if (alert.severity === "critical") { severityClass = "danger"; badgeClass = "badge-danger"; label = "CRITICAL"; }
                    else if (alert.severity === "warning") { severityClass = "warning"; badgeClass = "badge-warning"; label = "WARNING"; }
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
    };

    const initialCritical = passes.filter(a => a.severity === "critical").length;
    const initialWarning = passes.filter(a => a.severity === "warning").length;
    const initialRoutine = passes.filter(a => a.severity !== "critical" && a.warning !== "warning").length;

    elements.analysisPanel.innerHTML = safeHtml`
        <div class="eyebrow">Neighbourhood Watch</div>
        <h2>${escapeHtml(scopeText)}</h2>
        <p>Proximity screening detected <span class="watch-total-val">${passes.length}</span> events within ${formatNumber(result.thresholdKm, 0)} km.</p>

        <div class="metric-grid">
            <div class="metric-card"><div class="label">Critical</div><div class="value watch-crit-val" style="color: var(--severity-danger)">${initialCritical}</div></div>
            <div class="metric-card"><div class="label">Warning</div><div class="value watch-warn-val" style="color: var(--severity-warning)">${initialWarning}</div></div>
            <div class="metric-card"><div class="label">Routine</div><div class="value watch-rout-val" style="color: var(--severity-info)">${initialRoutine}</div></div>
            <div class="metric-card"><div class="label">Threshold</div><div class="value">${formatNumber(result.thresholdKm, 0)} km</div></div>
        </div>

        <div class="section" style="background: rgba(255, 255, 255, 0.02); padding: 12px; border-radius: 8px; margin-bottom: 12px; margin-top: 12px;">
            <div class="section-title">Advanced Result Filters</div>
            <div style="display: flex; gap: 8px; flex-wrap: wrap;">
                <div class="field" style="flex: 1; min-width: 120px;">
                    <label for="watchSeverityFilter" style="font-size: 11px;">Severity</label>
                    <select id="watchSeverityFilter" style="padding: 6px 10px; font-size: 12px; width: 100%;">
                        <option value="all">All Severities</option>
                        <option value="critical">Critical Only</option>
                        <option value="warning">Warning &amp; Critical</option>
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
            <div class="list neighbourhood-watch-list"></div>
        </div>
    `;

    renderFilteredList();
    setTimeout(() => {
        const s = document.getElementById("watchSeverityFilter");
        const d = document.getElementById("watchDistanceInput");
        const i = document.getElementById("watchSearchInput");
        if (s) s.addEventListener("change", renderFilteredList);
        if (d) d.addEventListener("input", renderFilteredList);
        if (i) i.addEventListener("input", renderFilteredList);
    }, 0);
}

export function renderDriftAnalysis(drift) {
    if (!elements.analysisPanel || !drift || !drift.analysis) return;
    const a = drift.analysis;
    const tracks = drift.tracks || [];
    let longDrift = 0, groundTrackDisp = 0;

    if (tracks.length >= 2) {
        const oldest = [...tracks].sort((a, b) => a.dayOffset - b.dayOffset)[0];
        const latest = [...tracks].sort((a, b) => b.dayOffset - a.dayOffset)[0];
        if (oldest?.samples[0] && latest?.samples[0]) {
            longDrift = latest.samples[0].lon - oldest.samples[0].lon;
            const p1 = new Cesium.Cartesian3(oldest.samples[0].x, oldest.samples[0].y, oldest.samples[0].z);
            const p2 = new Cesium.Cartesian3(latest.samples[0].x, latest.samples[0].y, latest.samples[0].z);
            groundTrackDisp = Cesium.Cartesian3.distance(p1, p2) / 1000;
        }
    }

    const lonAbs = Math.abs(longDrift);
    const driftDir = longDrift > 0 ? "eastward" : "westward";
    let narrative = lonAbs > 0.05
        ? `Satellite is <strong>drifting ${driftDir}</strong> (${lonAbs.toFixed(2)}° over ${a.daysAnalyzed} days). `
        : `Satellite maintaining <strong>stable longitudinal station</strong>. `;

    if (Math.abs(a.smaShiftKm) > 1) {
        narrative += `Orbital altitude has <strong>${a.smaShiftKm > 0 ? "increased" : "decreased"}</strong> by ${Math.abs(a.smaShiftKm).toFixed(1)} km, suggesting ${Math.abs(a.smaShiftKm) > 5 ? "a major manoeuvre" : "station-keeping activity"}. `;
    }

    const sortedTracks = [...tracks].sort((a, b) => a.dayOffset - b.dayOffset);
    const legendHtml = sortedTracks.map((t) => `
        <div style="display: flex; flex-direction: column; align-items: center; min-width: 55px; gap: 4px;">
            <div style="width: 100%; height: 4px; background-color: ${t.color}; border-radius: 2px;"></div>
            <span style="font-size: 0.8em; font-family: monospace; color: ${t.isCurrent ? "var(--text-main)" : "var(--text-dim)"};">${t.dayOffset === 0 ? "Now" : `${t.dayOffset}d ago`}</span>
        </div>
    `).join('<div style="color: var(--text-dim); font-size: 0.8em; margin: 0 4px; align-self: center;">&rarr;</div>');

    elements.analysisPanel.innerHTML = safeHtml`
        <div class="eyebrow">Orbital Drift Overlay &amp; Temporal Intelligence</div>
        <h2>Drift Evolution: ${escapeHtml(drift.satelliteId || "Active Satellite")}</h2>
        <p>Layered historical trajectories analyze how the satellite's orbital plane and altitude evolve over a multi-epoch timeline.</p>

        <div class="metric-grid">
            <div class="metric-card"><div class="label">Inclination Shift</div><div class="value">${a.inclinationShiftDeg >= 0 ? "+" : ""}${a.inclinationShiftDeg.toFixed(4)}°</div></div>
            <div class="metric-card"><div class="label">Altitude Delta</div><div class="value">${a.smaShiftKm >= 0 ? "+" : ""}${a.smaShiftKm.toFixed(2)} km</div></div>
            <div class="metric-card"><div class="label">Long. Drift</div><div class="value">${longDrift >= 0 ? "+" : ""}${longDrift.toFixed(3)}°</div></div>
            <div class="metric-card"><div class="label">Ground Displacement</div><div class="value">${groundTrackDisp.toFixed(1)} km</div></div>
        </div>

        <div class="section">
            <div class="section-title">Drift Intelligence Narrative</div>
            <div class="micro-card" style="border-left: 3px solid var(--text-success); background: rgba(124, 242, 154, 0.05); line-height: 1.5; font-size: 13.5px;">
                ${markSafe(narrative)}
            </div>
        </div>

        <div class="section">
            <div class="section-title">Temporal Legend &amp; Color Coding</div>
            <div class="micro-card" style="display: flex; align-items: center; justify-content: center; gap: 8px; flex-wrap: wrap; padding: 16px;">
                ${markSafe(legendHtml)}
            </div>
        </div>
    `;
}

export function renderManoeuvreAnalysis(result) {
    if (!elements.analysisPanel || !result) return;
    const severity = result.severity || "info";
    const deltas = result.deltas || {};
    const severityClass = severity === "critical" ? "danger" : severity === "high" ? "warning" : severity === "medium" ? "monitor" : "success";

    elements.analysisPanel.innerHTML = safeHtml`
        <div class="eyebrow">Manoeuvre Signature &amp; Threat Assessment</div>
        <h2>Manoeuvre Detected: ${escapeHtml(result.satelliteId || "Active Satellite")}</h2>
        <p>Comparison of predicted trajectory against actual observed trajectory to isolate uncooperative station-keeping or intercept firings.</p>

        <div class="badge-row" style="margin-bottom: 16px;">
            <span class="badge badge-${severityClass}">${escapeHtml(result.classification.toUpperCase().replace("_", " "))}</span>
            <span class="badge badge-outline">Threat Score: ${result.threatScore}</span>
        </div>

        <div class="metric-grid">
            <div class="metric-card"><div class="label">SMA Shift</div><div class="value" style="color: white;">${deltas.semiMajorAxisKm.toFixed(2)} km</div></div>
            <div class="metric-card"><div class="label">Inclination Shift</div><div class="value" style="color: white;">${deltas.inclinationDeg.toFixed(4)}°</div></div>
            <div class="metric-card"><div class="label">Eccentricity Delta</div><div class="value" style="font-size: 13.5px; color: white;">${deltas.eccentricity.toFixed(6)}</div></div>
            <div class="metric-card"><div class="label">Position Residual</div><div class="value" style="color: white;">${result.epochResidualKm.toFixed(1)} km</div></div>
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
                        Calculated Minimum Distance: <strong style="color: white;">${result.proximity.minDistanceAfterKm.toFixed(2)} km</strong>
                    </div>
                </div>
            </div>
        `) : ""}
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
        const revisitChange = Number.isFinite(finding.revisitChangePercent)
            ? `${finding.revisitChangePercent >= 0 ? "+" : ""}${finding.revisitChangePercent.toFixed(0)}%` : "Unknown";

        return `
            <div class="list-item" style="border-left: 4px solid var(--severity-${severity}); background: rgba(255,255,255,0.02); padding: 12px; border-radius: 8px; margin-bottom: 10px;">
                <div style="display: flex; justify-content: space-between; align-items: flex-start; gap: 8px; margin-bottom: 8px;">
                    <div>
                        <strong style="font-size: 13px; color: white;">${escapeHtml(finding.satelliteName || "Unknown satellite")}</strong>
                        <div style="font-size: 11px; color: var(--text-dim); margin-top: 2px;">NORAD: ${finding.noradId ?? "Unknown"}</div>
                    </div>
                    <div style="text-align: right; flex-shrink: 0;">
                        <span class="badge badge-${severity}" style="padding: 2px 6px; font-size: 9px;">${escapeHtml(severity.toUpperCase())}</span><br>
                        <span style="font-size: 10px; font-family: monospace; color: var(--text-warning); display: block; margin-top: 4px;">Conf: ${confidence}</span>
                    </div>
                </div>
                <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 6px; font-family: monospace; font-size: 11.5px; color: var(--text-dim); margin-top: 6px;">
                    <div>Trend: <span style="color: white;">${escapeHtml(finding.visibilityTrend?.toUpperCase() || "NONE")}</span></div>
                    <div>Revisit Δ: <span style="color: white;">${revisitChange}</span></div>
                    <div>Prev Passes: <span style="color: white;">${finding.previousPassCount ?? 0}</span></div>
                    <div>Recent Passes: <span style="color: white;">${finding.recentPassCount ?? 0}</span></div>
                    <div style="grid-column: span 2;">Avg Vis: <span style="color: white;">${Number.isFinite(finding.averageVisibilityDuration) ? finding.averageVisibilityDuration.toFixed(1) : "0.0"} min</span></div>
                </div>
            </div>
        `;
    }).join("") : '<div class="hint">No uncooperative satellites showed emerging regional visibility profiles in this timeframe.</div>';

    elements.analysisPanel.innerHTML = safeHtml`
        <div class="eyebrow">Emerging Regional Access &amp; Visibility Shifts</div>
        <h2>Regional Presence: ${escapeHtml(result.region?.name || "Delhi Area")}</h2>
        <p>Identifies satellites whose orbital evolution newly places them inside a strategic reconnaissance swath over our target zone.</p>

        <div class="metric-grid">
            <div class="metric-card"><div class="label">Findings</div><div class="value">${summary.findingCount ?? 0}</div></div>
            <div class="metric-card"><div class="label">Unexpected Access</div><div class="value" style="color: ${summary.unexpectedRegionalPresenceCount > 0 ? "var(--severity-warning)" : "inherit"};">${summary.unexpectedRegionalPresenceCount ?? 0}</div></div>
            <div class="metric-card"><div class="label">Avg Confidence</div><div class="value">${Number.isFinite(summary.averageConfidenceScore) ? `${Math.round(summary.averageConfidenceScore * 100)}%` : "0%"}</div></div>
            <div class="metric-card"><div class="label">Pass Rate</div><div class="value">${Number.isFinite(debugMetrics.coveragePassRate) ? `${Math.round(debugMetrics.coveragePassRate * 100)}%` : "0%"}</div></div>
        </div>

        <div class="section">
            <div class="section-title">Emerging Access Intelligence Log</div>
            <div class="list">${markSafe(findingsHtml)}</div>
        </div>
    `;
}

export function renderUnifiedThreatInsights(data) {
    if (!elements.analysisPanel) return;
    if (!data) {
        elements.analysisPanel.innerHTML = safeHtml`<div class="hint">No threat data available.</div>`;
        return;
    }

    const incidents = Array.isArray(data.incidents) ? data.incidents : [];
    const pagination = data.pagination || { page: 1, pageSize: 5, totalCount: 0, totalPages: 1 };

    const incidentsHtml = incidents.map(incident => {
        const severityClass = incident.priority === "CRITICAL" ? "badge-danger" :
                             (incident.priority === "HIGH" ? "badge-warning" :
                             (incident.priority === "MEDIUM" ? "badge-monitor" : "badge-success"));
        const priorityColor = incident.priority === "CRITICAL" ? "var(--severity-high)" :
                              (incident.priority === "HIGH" ? "var(--severity-warning)" :
                              (incident.priority === "MEDIUM" ? "var(--severity-medium)" : "var(--severity-low))"));
        const scoreColor = incident.threatScore >= 80 ? "var(--danger)" :
                           (incident.threatScore >= 50 ? "var(--warning)" : "var(--success)");

        const whyMatters = Array.isArray(incident.whyThisMatters) ? incident.whyThisMatters : (incident.threatRationale?.bullets || []);
        const whyMattersHtml = whyMatters.length > 0
            ? whyMatters.map(bullet => `<li style="margin-bottom: 4px;">${escapeHtml(bullet)}</li>`).join("")
            : `<li style="color: var(--text-dim);">No operational why-bullets defined.</li>`;

        const secondaryObjStr = incident.displaySecondaryName
            ? ` <span style="color: var(--text-dim); margin: 0 4px;">&harr;</span> <span style="color: var(--text-bright); font-weight: 500;">${escapeHtml(incident.displaySecondaryName)}</span>`
            : "";

        return `
            <div class="list-item" style="border-left: 4px solid ${priorityColor}; background: rgba(255,255,255,0.02); padding: 16px; border-radius: 8px; margin-bottom: 16px; display: flex; flex-direction: column; gap: 10px;">
                <div style="display: flex; justify-content: space-between; align-items: flex-start; gap: 12px;">
                    <div>
                        <div style="display: flex; align-items: center; gap: 8px;">
                            <span class="status-dot status-active" style="background-color: ${priorityColor}; display: inline-block;"></span>
                            <span style="font-family: monospace; font-size: 11px; color: var(--text-muted); font-weight: 600;">${escapeHtml(incident.incidentUid)}</span>
                        </div>
                        <h3 style="margin: 4px 0 2px 0; color: white; font-size: 16px; font-weight: 600;">${escapeHtml(incident.title)}</h3>
                        <div style="font-size: 12px; margin-top: 2px;">
                            <span style="color: var(--text-dim);">Target:</span>
                            <span style="color: var(--text-bright); font-weight: 500;">${escapeHtml(incident.displayPrimaryName)}</span>
                            ${secondaryObjStr}
                        </div>
                    </div>
                    <div style="display: flex; flex-direction: column; align-items: flex-end; gap: 4px; flex-shrink: 0;">
                        <span class="badge ${severityClass}" style="padding: 3px 8px; font-size: 10px; font-weight: 700; border-radius: 4px;">${escapeHtml(incident.priority)}</span>
                        <span class="badge badge-outline" style="font-size: 9px; padding: 2px 6px;">${escapeHtml(incident.assetClassification)}</span>
                    </div>
                </div>

                <div style="background: rgba(255,255,255,0.03); border: 1px solid rgba(255,255,255,0.05); padding: 8px 12px; border-radius: 6px;">
                    <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 4px; font-size: 11px; font-family: monospace;">
                        <span style="color: var(--text-muted); font-weight: 600;">THREAT LEVEL ASSESSMENT:</span>
                        <strong style="color: ${scoreColor}; font-size: 12px;">${incident.threatScore}/100</strong>
                    </div>
                    <div style="width: 100%; height: 6px; background: rgba(255,255,255,0.05); border-radius: 3px; overflow: hidden;">
                        <div style="width: ${incident.threatScore}%; height: 100%; background: ${scoreColor}; border-radius: 3px;"></div>
                    </div>
                </div>

                <div style="font-size: 13px; line-height: 1.45; color: var(--text-bright); background: rgba(0,0,0,0.15); padding: 10px 12px; border-radius: 6px; border-left: 3px solid rgba(255,255,255,0.1);">
                    ${escapeHtml(incident.summary)}
                </div>

                <div>
                    <h4 style="margin: 0 0 6px 0; font-size: 12px; font-weight: 600; color: var(--text-warning); text-transform: uppercase; letter-spacing: 0.05em;">Situational Assessment</h4>
                    <ul style="margin: 0; padding-left: 20px; font-size: 12.5px; line-height: 1.45; color: var(--text-muted);">${whyMattersHtml}</ul>
                </div>

                <div class="micro-card" style="border: 1px solid rgba(0, 180, 216, 0.2); background: rgba(0, 180, 216, 0.03); padding: 12px; border-radius: 6px; margin-top: 4px;">
                    <div style="display: flex; gap: 8px; align-items: flex-start;">
                        <span style="font-size: 16px; line-height: 1; flex-shrink: 0; color: var(--info);">⚡</span>
                        <div>
                            <strong style="font-size: 11px; color: var(--info); font-family: monospace; display: block; margin-bottom: 2px; text-transform: uppercase; letter-spacing: 0.05em;">Operator Action Directive</strong>
                            <span style="font-size: 12.5px; line-height: 1.4; color: var(--text-bright); display: block;">${escapeHtml(incident.recommendation)}</span>
                        </div>
                    </div>
                </div>
            </div>
        `;
    }).join("");

    elements.analysisPanel.innerHTML = safeHtml`
        <div class="eyebrow">Unified Threat Intelligence</div>
        <h2>Correlated Space Threat Feed</h2>
        <p>Cross-module threat correlation engine. Incidents are grouped from multiple SDA analytical modules.</p>

        <div class="metric-grid">
            <div class="metric-card"><div class="label">Total Incidents</div><div class="value">${pagination.totalCount}</div></div>
            <div class="metric-card"><div class="label">Showing</div><div class="value">${pagination.startIndex ?? 1}–${pagination.endIndex ?? incidents.length}</div></div>
        </div>

        <div class="section">
            <div class="section-title">Active Threat Incidents</div>
            <div class="list">
                ${markSafe(incidentsHtml || '<div class="hint">No correlated threat incidents found.</div>')}
            </div>
        </div>
    `;
}
