import { setStatus } from "../../ui.js";
import { escapeHtml, formatNumber, formatDateTime } from "../../utils.js";
import { ListenerScope } from "../../ui/panelSystem.js";
import { updateIntData } from "../../catalogService.js";
import { appState } from "../../state.js";
import { fetchJsonWithFallback, postJsonWithFallback } from "../../apiService.js";
import { drawUctMarkers, clearUctMarkers } from "../../viewer.js";

function buildSidebar() {
    return `
        <div class="section-group">
            <div class="section">
                <div class="section-title">
                    <i class="fas fa-radar"></i> TRACK INGESTION
                </div>
                <div class="input-group" style="margin-top:8px;">
                    <input type="text" id="ingestName" placeholder="Temporary ID (optional)" style="font-size:11px; width:100%; margin-bottom:4px;">
                    <div style="display:flex; gap:4px; margin-top:4px;">
                        <input type="text" id="ingestLine1" placeholder="TLE Line 1" style="flex:1; font-size:10px;">
                        <input type="text" id="ingestLine2" placeholder="TLE Line 2" style="flex:1; font-size:10px;">
                    </div>
                    <button id="ingestTrackBtn" class="primary" style="width:100%; margin-top:8px;">Analyze & Correlate</button>
                </div>
                <div id="correlationFeedback" style="margin-top:8px; display:none;"></div>
            </div>

            <div class="section">
                <div class="section-title" style="display:flex; justify-content:space-between; align-items:center;">
                    <span>UNCORRELATED TARGETS (UCTs)</span>
                    <span id="uctCountBadge" class="badge badge-danger" style="display:none; font-size:9px;">0</span>
                </div>
                <div id="uctList" class="list" style="margin-top:8px; max-height:160px; overflow-y:auto;">
                    <div class="hint">Scanning for UCTs...</div>
                </div>
            </div>
        </div>

        <div class="section" style="border-top: 1px solid var(--border-color); padding-top:16px;">
            <div class="section-title">INDIGENOUS CATALOGUE</div>
            <div class="search-box" style="margin-top:8px;">
                <input type="text" id="catalogSearchInput" placeholder="Search by name, NORAD..." style="width:100%; font-size:11px;">
            </div>
            <div id="catalogSearchResults" class="list" style="margin-top:8px; max-height:250px; overflow-y:auto;"></div>
        </div>

        <div id="charDetailContainer" class="section detail-panel" style="display:none; margin-top:16px; background: rgba(255,255,255,0.03); border-radius: 4px; padding: 12px; border: 1px solid var(--border-color);">
            <div style="display:flex; justify-content:space-between; align-items:start;">
                <div class="section-title" id="detailTitle" style="margin-bottom:0; font-size:0.9em;">OBJECT INTELLIGENCE</div>
                <button id="closeDetailBtn" style="background:none; border:none; color:var(--text-dim); cursor:pointer; font-size:16px; padding:0;">&times;</button>
            </div>
            
            <div id="charReadout" style="margin-top:12px;"></div>

            <div id="uctWorkflowContainer" style="display:none; margin-top:16px; padding-top:16px; border-top: 1px dashed var(--border-color);">
                <div class="section-title" style="font-size:0.75em; color:var(--severity-warning);">SENSING STRATEGY</div>
                <div id="uctMetrics" style="margin-top:8px; font-size:10px;"></div>
                <div id="sensorRecommendations" class="list" style="margin-top:8px;"></div>
            </div>

            <div style="margin-top:16px;">
                <div class="section-title" style="font-size:0.75em;">INTELLIGENCE NOTES</div>
                <textarea id="intDataInput" placeholder="Attach manual intelligence notes..." style="width:100%; height:60px; margin-top:4px; font-size:11px;"></textarea>
                <div style="display:flex; gap:6px; margin-top:8px;">
                    <button id="saveIntDataBtn" class="primary" style="flex:1; font-size:10px;">Update INT</button>
                    <button id="tagSuspiciousBtn" class="danger" style="flex:1; font-size:10px;">Tag Suspicious</button>
                </div>
            </div>
        </div>
    `;
}

export default {
    id: "characterisation-cataloguing",
    label: "Characterisation and Cataloguing",
    eyebrow: "SDA Intelligence",
    description: "Indigenous catalogue management and UCT correlation.",
    dockEyebrow: "Intelligence",
    dockLabel: "Characterisation",
    status: "ready",
    mount(ctx) {
        const root = ctx.containers.sidebarRoot;
        root.innerHTML = buildSidebar();

        const ingestName = document.getElementById("ingestName");
        const ingestLine1 = document.getElementById("ingestLine1");
        const ingestLine2 = document.getElementById("ingestLine2");
        const ingestTrackBtn = document.getElementById("ingestTrackBtn");
        const correlationFeedback = document.getElementById("correlationFeedback");

        const searchInput = document.getElementById("catalogSearchInput");
        const searchResults = document.getElementById("catalogSearchResults");

        const uctList = document.getElementById("uctList");
        const uctCountBadge = document.getElementById("uctCountBadge");
        const detailContainer = document.getElementById("charDetailContainer");
        const closeDetailBtn = document.getElementById("closeDetailBtn");
        const detailTitle = document.getElementById("detailTitle");
        const readout = document.getElementById("charReadout");
        const uctWorkflowContainer = document.getElementById("uctWorkflowContainer");
        const uctMetrics = document.getElementById("uctMetrics");
        const sensorRecommendations = document.getElementById("sensorRecommendations");
        const intDataInput = document.getElementById("intDataInput");
        const saveIntDataBtn = document.getElementById("saveIntDataBtn");
        const tagSuspiciousBtn = document.getElementById("tagSuspiciousBtn");

        const scope = new ListenerScope();
        let selectedSatellite = null;

        const renderUcts = async () => {
            try {
                const { payload } = await fetchJsonWithFallback("/api/satellites?catalogStatus=UNCORRELATED", appState.catalogApiBaseUrl);
                appState.ucts = payload;

                const visibleUcts = payload.filter(u => !(u.name && /^TEST\b/i.test(u.name)));

                if (uctCountBadge) {
                    uctCountBadge.textContent = visibleUcts.length;
                    uctCountBadge.style.display = visibleUcts.length > 0 ? "inline-block" : "none";
                }

                if (visibleUcts.length === 0) {
                    uctList.innerHTML = '<div class="hint">No active UCT alerts.</div>';
                } else {
                    uctList.innerHTML = visibleUcts.map(uct => `
                        <div class="list-item warning uct-item" data-id="${escapeHtml(uct.name)}" style="cursor:pointer; padding: 6px 8px; margin-bottom: 4px;">
                            <div style="display:flex; justify-content:space-between; align-items:center;">
                                <span style="font-weight:600; font-size:0.9em;">${escapeHtml(uct.name)}</span>
                                <span class="badge badge-danger" style="font-size:8px;">UCT</span>
                            </div>
                            <div style="font-size:9px; color:var(--text-dim); margin-top:2px;">
                                ${uct.lastObservedAt ? 'Observed ' + formatDateTime(uct.lastObservedAt) : 'Unidentified'}
                            </div>
                        </div>
                    `).join("");

                    scope.addMany(".uct-item", "click", (e) => {
                        const id = e.currentTarget.getAttribute("data-id");
                        selectSatellite(id);
                    });
                }

                drawUctMarkers(visibleUcts);
            } catch (error) {
                console.error("UCT Load Error:", error);
                uctList.innerHTML = `<div class="list-item danger">Error loading UCTs.</div>`;
            }
        };

        const loadCatalogue = async (query = "") => {
            searchResults.innerHTML = '<div class="hint">Loading...</div>';
            try {
                const url = query
                    ? `/api/satellites?search=${encodeURIComponent(query)}&limit=15`
                    : `/api/satellites?limit=15`;

                const { payload } = await fetchJsonWithFallback(url, appState.catalogApiBaseUrl);
                const visible = payload.filter(s => !(s.name && /^TEST\b/i.test(s.name)));

                if (visible.length === 0) {
                    searchResults.innerHTML = '<div class="hint">No assets found.</div>';
                } else {
                    searchResults.innerHTML = visible.map(s => `
                        <div class="list-item search-result-item" data-id="${escapeHtml(s.name)}" style="cursor:pointer; padding: 6px 8px; margin-bottom: 4px;">
                            <div style="display:flex; justify-content:space-between; align-items:center;">
                                <span style="font-weight:600; font-size:0.9em;">${escapeHtml(s.name)}</span>
                                <span class="badge ${s.catalogStatus === 'UNCORRELATED' ? 'badge-warning' : 'badge-success'}" style="font-size:8px; opacity:0.8;">${s.catalogStatus}</span>
                            </div>
                            <div style="font-size:9px; color:var(--text-dim); margin-top:2px;">
                                ${s.noradId ? 'NORAD: ' + s.noradId : 'Indigenous'} | ${s.characterisation?.orbitClass || 'N/A'}
                            </div>
                        </div>
                    `).join("");

                    scope.addMany(".search-result-item", "click", (e) => {
                        const id = e.currentTarget.getAttribute("data-id");
                        selectSatellite(id);
                    });
                }
            } catch (error) {
                searchResults.innerHTML = `<div class="list-item danger">Failed to load catalogue.</div>`;
            }
        };

        const selectSatellite = async (name) => {
            let sat = appState.satellites.find(s => s.name === name) || appState.ucts.find(u => u.name === name);

            if (!sat) {
                setStatus(`Fetching details for ${name}...`);
                try {
                    const { payload } = await fetchJsonWithFallback(`/api/satellites?search=${encodeURIComponent(name)}`, appState.catalogApiBaseUrl);
                    sat = payload.find(s => s.name === name);
                } catch (e) {}
            }

            if (!sat) {
                setStatus(`Could not find satellite ${name}`);
                return;
            }

            selectedSatellite = sat;
            detailContainer.style.display = "block";
            detailContainer.scrollIntoView({ behavior: 'smooth', block: 'end' });

            const isUct = sat.catalogStatus === "UNCORRELATED";
            const char = sat.characterisation || {};

            detailTitle.textContent = isUct ? "UNKNOWN TARGET" : "CORRELATED ASSET";
            detailTitle.style.color = isUct ? "var(--severity-warning)" : "var(--severity-success)";

            readout.innerHTML = `
                <div style="margin-bottom:12px;">
                    <div style="font-size: 1.1em; font-weight: bold; color: var(--text-bright);">${escapeHtml(sat.name)}</div>
                    <div style="display:flex; gap:4px; margin-top:4px;">
                        <span class="badge ${isUct ? 'badge-danger' : 'badge-success'}">${escapeHtml(sat.catalogStatus)}</span>
                        ${sat.isIndigenous ? '<span class="badge badge-outline" style="font-size:8px;">INDIGENOUS</span>' : ''}
                    </div>
                </div>

                <div class="metrics-grid" style="display:grid; grid-template-columns: 1fr 1fr; gap: 8px; font-size: 10px; background: rgba(255,255,255,0.03); padding: 8px; border-radius: 4px;">
                    <div><span style="color:var(--text-dim);">NORAD ID:</span><br> ${sat.noradId || "N/A"}</div>
                    <div><span style="color:var(--text-dim);">Orbit:</span><br> ${char.orbitClass || "Unknown"}</div>
                    <div><span style="color:var(--text-dim);">Type:</span><br> ${char.objectType || "Unknown"}</div>
                    <div><span style="color:var(--text-dim);">Source:</span><br> ${sat.dataSource || "Indigenous"}</div>
                </div>

                <div style="margin-top:12px; font-size:10px; color:var(--text-dim);">
                    Last Observed: ${sat.lastObservedAt ? formatDateTime(sat.lastObservedAt) : 'Never'}
                </div>
                
                <div style="margin-top:12px; padding: 8px; background: rgba(0,0,0,0.1); border-radius: 4px; border: 1px solid var(--border-color);">
                    <div style="color:var(--text-dim); font-size:9px; font-weight:bold; margin-bottom:4px;">CURRENT INTELLIGENCE:</div>
                    <div id="intDataDisplay" style="font-style: italic; font-size:11px; line-height: 1.4;">
                        ${sat.intData ? escapeHtml(sat.intData) : "No manual intelligence records."}
                    </div>
                </div>
            `;

            intDataInput.value = sat.intData || "";

            if (window.clearTrackingRegions) window.clearTrackingRegions();

            if (isUct) {
                uctWorkflowContainer.style.display = "block";

                const orb = char.predictedOrbit || {};
                uctMetrics.innerHTML = `
                    <div style="display:grid; grid-template-columns: 1fr 1fr; gap: 6px; font-size:9px;">
                        <div class="metric"><span style="color:var(--text-dim);">Inc:</span> ${orb.inclination ? orb.inclination.toFixed(2) + '°' : '---'}</div>
                        <div class="metric"><span style="color:var(--text-dim);">Mean Mot:</span> ${orb.meanMotion ? orb.meanMotion.toFixed(2) : '---'}</div>
                        <div class="metric"><span style="color:var(--text-dim);">Perigee:</span> ${orb.perigee ? formatNumber(orb.perigee) + 'km' : '---'}</div>
                        <div class="metric"><span style="color:var(--text-dim);">Apogee:</span> ${orb.apogee ? formatNumber(orb.apogee) + 'km' : '---'}</div>
                    </div>
                    <div style="margin-top:8px; font-size:9px;">
                        <span style="color:var(--severity-warning);">CONFIDENCE:</span> ${char.uctUncertainty || 'Low'}<br>
                    </div>
                `;

                if (char.sensorRecommendations) {
                    sensorRecommendations.innerHTML = char.sensorRecommendations.map(rec => `
                        <div class="list-item monitor" style="font-size:10px; margin-bottom:4px; border-left-color: ${rec.priority === 'High' ? 'var(--severity-danger)' : 'var(--severity-warning)'};">
                            <div style="display:flex; justify-content:space-between; align-items:center;">
                                <strong>${escapeHtml(rec.sensorName)}</strong>
                                <span style="font-size:8px; color: ${rec.priority === 'High' ? 'var(--severity-danger)' : 'var(--severity-warning)'}">${rec.priority} PRIORITY</span>
                            </div>
                            <div style="margin-top:2px; color:var(--text-dim);">
                                Task Window: ${formatDateTime(rec.recommendedTime)}
                            </div>
                        </div>
                    `).join("");

                    if (window.drawTrackingRegion && sat.line1 && sat.line2) {
                        const topRec = char.sensorRecommendations[0];
                        window.drawTrackingRegion(sat, topRec);
                    }
                } else {
                    sensorRecommendations.innerHTML = '<div class="hint">Analysis pending sensor tasking...</div>';
                }
            } else {
                uctWorkflowContainer.style.display = "none";
            }

            setStatus(`Inspecting ${sat.name} [${sat.catalogStatus}]`);
        };

        scope.add(closeDetailBtn, "click", () => {
            detailContainer.style.display = "none";
            selectedSatellite = null;
            if (window.clearTrackingRegions) window.clearTrackingRegions();
        });

        scope.add(ingestTrackBtn, "click", async () => {
            const name = ingestName.value.trim();
            const l1 = ingestLine1.value.trim();
            const l2 = ingestLine2.value.trim();

            if (!l1 || !l2) {
                setStatus("Error: TLE Line 1 and Line 2 are required.");
                return;
            }

            ingestTrackBtn.disabled = true;
            correlationFeedback.style.display = "block";
            correlationFeedback.innerHTML = '<div class="hint">Running indigenous catalogue correlation...</div>';
            setStatus("Ingesting manual track observation...");

            try {
                const payload = await postJsonWithFallback("/api/satellites", {
                    name: name || null,
                    line1: l1,
                    line2: l2
                }, appState.catalogApiBaseUrl);

                if (payload.correlationResult === "MATCHED") {
                    correlationFeedback.innerHTML = `
                        <div class="list-item success" style="font-size:11px;">
                            <strong>CORRELATION SUCCESS</strong><br>
                            Matched with existing entry: <strong>${escapeHtml(payload.matchedWith)}</strong>
                        </div>
                    `;
                } else {
                    correlationFeedback.innerHTML = `
                        <div class="list-item warning" style="font-size:11px;">
                            <strong>NEW UCT DETECTED</strong><br>
                            No matching catalogue entry found. Created <strong>${escapeHtml(payload.name)}</strong>.
                        </div>
                    `;
                }

                ingestName.value = "";
                ingestLine1.value = "";
                ingestLine2.value = "";

                await renderUcts();
                await loadCatalogue();
                selectSatellite(payload.name);
            } catch (error) {
                console.error("Ingestion failed:", error);
                correlationFeedback.innerHTML = `<div class="list-item danger">Correlation failed: ${escapeHtml(error.message)}</div>`;
                setStatus("Manual ingestion failed.");
            } finally {
                ingestTrackBtn.disabled = false;
            }
        });

        scope.add(searchInput, "input", (e) => {
            const query = e.target.value.trim();
            if (query.length > 2 || query.length === 0) {
                loadCatalogue(query);
            }
        });

        scope.add(saveIntDataBtn, "click", async () => {
            if (!selectedSatellite) return;

            const newIntData = intDataInput.value.trim();
            saveIntDataBtn.disabled = true;
            setStatus(`Saving intelligence data for ${selectedSatellite.name}...`);

            try {
                await updateIntData(selectedSatellite.id, newIntData);
                selectedSatellite.intData = newIntData;
                const displayEl = document.getElementById("intDataDisplay");
                if (displayEl) displayEl.textContent = newIntData || "No manual intelligence records.";
                setStatus("Intelligence information updated successfully.");
            } catch (error) {
                setStatus("Failed to update INT data.");
            } finally {
                saveIntDataBtn.disabled = false;
            }
        });

        scope.add(tagSuspiciousBtn, "click", async () => {
            if (!selectedSatellite) return;
            const currentVal = intDataInput.value;
            intDataInput.value = `[SUSPICIOUS ACTIVITY TAGGED] ${currentVal}`;
            saveIntDataBtn.click();
        });

        renderUcts();
        loadCatalogue();
        setStatus("SDA Intelligence Module: Characterisation & Cataloguing ready.");

        return {
            unmount() {
                scope.dispose();
                clearUctMarkers();
            }
        };
    }
};
