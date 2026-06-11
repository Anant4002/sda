import { appState } from "../../state.js";
import { renderCatalogStatus, renderSatelliteDirectory, setStatus } from "../../ui.js";
import { ListenerScope } from "../../ui/panelSystem.js";
import { eventBus, events } from "../eventBus.js";
import { formatNumber, isThreatSatellite } from "../../utils.js";
import { fetchJsonWithFallback, postJsonWithFallback } from "../../apiService.js";

function buildSidebar() {
    return `
        <!-- 1. Operational Summary -->
        <div class="section" id="opSummarySection">
            <div class="section-title">Operational Summary</div>
            <div class="card-grid" style="display: grid; grid-template-columns: 1fr 1fr; gap: 8px; margin-bottom: 8px;">
                <div class="micro-card" style="display: flex; flex-direction: column; padding: 10px; border-left: 3px solid var(--accent); background: rgba(111, 226, 255, 0.02);">
                    <span style="color: var(--text-dim); font-size: 10px; text-transform: uppercase; letter-spacing: 0.05em;">Catalog Status</span>
                    <div style="font-size: 1.25em; font-weight: bold; margin-top: 4px; color: var(--text-main); display: flex; align-items: center; gap: 6px;">
                        <span id="opStatusDot">🟢</span> <span id="opStatusText">Healthy</span>
                    </div>
                </div>
                <div class="micro-card" style="display: flex; flex-direction: column; padding: 10px; border-left: 3px solid var(--accent); background: rgba(111, 226, 255, 0.02);">
                    <span style="color: var(--text-dim); font-size: 10px; text-transform: uppercase; letter-spacing: 0.05em;">Last Update</span>
                    <div style="font-size: 1.2em; font-weight: bold; margin-top: 4px; color: var(--text-main);" id="opLastUpdateText">5 sec ago</div>
                </div>
                <div class="micro-card" style="display: flex; flex-direction: column; padding: 10px; border-left: 3px solid var(--accent); background: rgba(111, 226, 255, 0.02);">
                    <span style="color: var(--text-dim); font-size: 10px; text-transform: uppercase; letter-spacing: 0.05em;">Active Objects</span>
                    <div style="font-size: 1.4em; font-weight: bold; margin-top: 4px; color: var(--text-main);" id="opActiveObjectsText">--</div>
                </div>
                <div class="micro-card" style="display: flex; flex-direction: column; padding: 10px; border-left: 3px solid var(--indian); background: rgba(255, 153, 51, 0.02);">
                    <span style="color: var(--text-dim); font-size: 10px; text-transform: uppercase; letter-spacing: 0.05em;">Indian Assets</span>
                    <div style="font-size: 1.4em; font-weight: bold; margin-top: 4px; color: var(--text-main);" id="opIndianAssetsText">--</div>
                </div>
            </div>
            <div class="micro-card" id="opThreatObjectsCard" style="display: flex; flex-direction: column; padding: 12px; border-left: 3px solid var(--severity-danger); background: rgba(255, 123, 123, 0.03); margin-top: 8px;">
                <span style="color: var(--text-dim); font-size: 10px; text-transform: uppercase; letter-spacing: 0.05em;">Threat Objects</span>
                <div style="font-size: 1.6em; font-weight: bold; margin-top: 4px; color: var(--severity-danger);" id="opThreatObjectsText">--</div>
            </div>
            <div class="micro-card" id="opNewSatellitesCard" style="display: flex; flex-direction: column; padding: 12px; border-left: 3px solid var(--success); background: rgba(124, 242, 154, 0.03); margin-top: 8px; display: none;">
                <span style="color: var(--text-dim); font-size: 10px; text-transform: uppercase; letter-spacing: 0.05em;">New Satellites Found</span>
                <div style="font-size: 1.6em; font-weight: bold; margin-top: 4px; color: var(--success);" id="opNewSatellitesText">--</div>
                <button id="viewNewSatellitesBtn" class="primary" style="width: 100%; margin-top: 8px; font-size: 11px; padding: 6px; text-transform: uppercase; font-weight: bold; letter-spacing: 0.05em;">View New Satellites</button>
            </div>
        </div>

        <!-- 2. Search -->
        <div class="section" id="opSearchSection">
            <div class="section-title">Search</div>
            <div class="field">
                <label for="satelliteSearchInput" style="font-size: 11px; text-transform: uppercase; color: var(--text-dim); margin-bottom: 4px; display: block;">Search Name or NORAD ID</label>
                <input id="satelliteSearchInput" class="search-input" type="search" placeholder="Enter satellite name or NORAD ID" style="width: 100%; padding: 6px 10px; background: rgba(0,0,0,0.3); border: 1px solid var(--panel-border); color: white; border-radius: 4px;">
            </div>
        </div>

        <!-- 3. Reworked Operational Filters -->
        <div class="section" id="opFiltersSection">
            <div class="section-title">Operational Filters</div>
            <div style="display:flex; flex-direction:column; gap:8px; margin-bottom:12px;">
                <label style="display:flex; align-items:center; gap:8px; cursor:pointer; color:var(--text-main); font-weight:normal; text-transform:none; font-size:13px;">
                    <input id="showOnlyIndianToggle" type="checkbox">
                    Show Only Indian Satellites
                </label>
                <label style="display:flex; align-items:center; gap:8px; cursor:pointer; color:var(--text-main); font-weight:normal; text-transform:none; font-size:13px;">
                    <input id="showOnlyThreatsToggle" type="checkbox">
                    Show Only Threat Objects
                </label>
                <label style="display:flex; align-items:center; gap:8px; cursor:pointer; color:var(--text-main); font-weight:normal; text-transform:none; font-size:13px;">
                    <input id="newSatellitesDetectedToggle" type="checkbox">
                    Show Newly Detected Objects
                </label>
                <label style="display:flex; align-items:center; gap:8px; cursor:pointer; color:var(--text-main); font-weight:normal; text-transform:none; font-size:13px;">
                    <input id="hideCommercialToggle" type="checkbox">
                    Hide Commercial Satellites
                </label>
                
                <div style="margin: 4px 0; border-top: 1px dashed rgba(255,255,255,0.15);"></div>
                
                <label style="display:flex; align-items:center; gap:8px; cursor:pointer; color:var(--text-main); font-weight:normal; text-transform:none; font-size:13px;">
                    <input id="showPayloadsToggle" type="checkbox">
                    Show Payloads
                </label>
                <label style="display:flex; align-items:center; gap:8px; cursor:pointer; color:var(--text-main); font-weight:normal; text-transform:none; font-size:13px;">
                    <input id="showDebrisToggle" type="checkbox">
                    Show Space Debris
                </label>
                <label style="display:flex; align-items:center; gap:8px; cursor:pointer; color:var(--text-main); font-weight:normal; text-transform:none; font-size:13px;">
                    <input id="showRocketBodiesToggle" type="checkbox">
                    Show Rocket Bodies
                </label>
            </div>

            <div style="margin-top: 10px;">
                <label style="font-size:11px; text-transform:uppercase; color:var(--text-dim); margin-bottom: 6px; display: block;">Orbit Classes</label>
                <div style="display: flex; gap: 8px; flex-wrap: wrap;">
                    <label style="display:flex; align-items:center; gap:4px; font-size:12px; font-weight:normal; text-transform:none; color: var(--text-main); cursor: pointer;"><input id="orbitLEOCheckbox" type="checkbox" checked> LEO</label>
                    <label style="display:flex; align-items:center; gap:4px; font-size:12px; font-weight:normal; text-transform:none; color: var(--text-main); cursor: pointer;"><input id="orbitMEOCheckbox" type="checkbox" checked> MEO</label>
                    <label style="display:flex; align-items:center; gap:4px; font-size:12px; font-weight:normal; text-transform:none; color: var(--text-main); cursor: pointer;"><input id="orbitGEOCheckbox" type="checkbox" checked> GEO</label>
                    <label style="display:flex; align-items:center; gap:4px; font-size:12px; font-weight:normal; text-transform:none; color: var(--text-main); cursor: pointer;"><input id="orbitHEOCheckbox" type="checkbox" checked> HEO</label>
                </div>
            </div>
        </div>

        <!-- 4. Legend -->
        <div class="section" id="opLegendSection">
            <div class="section-title">Satellite Legend</div>
            <div class="legend" style="padding: 10px; background: rgba(0,0,0,0.25); border-radius: 8px; border: 1px solid var(--panel-border); display: flex; flex-direction: column; gap: 8px;">
                <div class="legend-row" style="display: flex; align-items: center; gap: 8px; font-size: 12px; color: var(--text-main);">
                    <span class="legend-dot" style="display: inline-block; width: 8px; height: 8px; border-radius: 50%; background:#7cf29a; box-shadow: 0 0 6px #7cf29a;"></span>
                    Active Satellites (Green)
                </div>
                <div class="legend-row" style="display: flex; align-items: center; gap: 8px; font-size: 12px; color: var(--text-main);">
                    <span class="legend-dot" style="display: inline-block; width: 8px; height: 8px; border-radius: 50%; background:#ff9933; box-shadow: 0 0 6px #ff9933;"></span>
                    Indian Satellites (Orange)
                </div>
                <div class="legend-row" style="display: flex; align-items: center; gap: 8px; font-size: 12px; color: var(--text-main);">
                    <span class="legend-dot" style="display: inline-block; width: 8px; height: 8px; border-radius: 50%; background:#ff4d4d; box-shadow: 0 0 6px #ff4d4d;"></span>
                    Space Debris (Red)
                </div>
                <div class="legend-row" style="display: flex; align-items: center; gap: 8px; font-size: 12px; color: var(--text-main);">
                    <span class="legend-dot" style="display: inline-block; width: 8px; height: 8px; border-radius: 50%; background:#d880ff; box-shadow: 0 0 6px #d880ff;"></span>
                    Rocket Bodies (Vibrant Purple)
                </div>
            </div>
        </div>

        <!-- 5. Priority Groups -->
        <div class="section" id="opPriorityGroupsSection">
            <div class="section-title">Priority Groups</div>
            <div style="display: flex; flex-direction: column; gap: 6px; margin-bottom: 8px;">
                <div class="micro-card priority-group-card" data-group="indian" style="display: flex; justify-content: space-between; align-items: center; padding: 10px; cursor: pointer; border-left: 3px solid var(--indian); background: rgba(255, 153, 51, 0.02); transition: all 0.2s ease;">
                    <span style="font-weight: bold; font-size: 13px;">🇮🇳 Indian Assets</span>
                    <span class="badge badge-outline" id="priorityCountIndian">--</span>
                </div>
                <div class="micro-card priority-group-card" data-group="chinese_isr" style="display: flex; justify-content: space-between; align-items: center; padding: 10px; cursor: pointer; border-left: 3px solid var(--severity-danger); background: rgba(255, 123, 123, 0.02); transition: all 0.2s ease;">
                    <span style="font-weight: bold; font-size: 13px;">⚠ Chinese ISR Assets</span>
                    <span class="badge badge-outline" id="priorityCountChineseIsr">--</span>
                </div>
                <div class="micro-card priority-group-card" data-group="adversary_mil" style="display: flex; justify-content: space-between; align-items: center; padding: 10px; cursor: pointer; border-left: 3px solid var(--severity-warning); background: rgba(255, 209, 102, 0.02); transition: all 0.2s ease;">
                    <span style="font-weight: bold; font-size: 13px;">⚠ Adversary Military Assets</span>
                    <span class="badge badge-outline" id="priorityCountAdversaryMil">--</span>
                </div>
                <div class="micro-card priority-group-card" data-group="nav" style="display: flex; justify-content: space-between; align-items: center; padding: 10px; cursor: pointer; border-left: 3px solid var(--accent); background: rgba(111, 226, 255, 0.02); transition: all 0.2s ease;">
                    <span style="font-weight: bold; font-size: 13px;">🛰 Navigation Constellations</span>
                    <span class="badge badge-outline" id="priorityCountNav">--</span>
                </div>
                <div class="micro-card priority-group-card" data-group="commercial" style="display: flex; justify-content: space-between; align-items: center; padding: 10px; cursor: pointer; border-left: 3px solid var(--text-dim); background: rgba(255, 255, 255, 0.02); transition: all 0.2s ease;">
                    <span style="font-weight: bold; font-size: 13px;">🌍 Commercial Mega Constellations</span>
                    <span class="badge badge-outline" id="priorityCountCommercial">--</span>
                </div>
            </div>

        </div>

        <!-- 5. Full Catalog Browser -->
        <div class="section" id="opCatalogBrowserSection">
            <div class="section-title">Full Catalog Browser</div>
            <div id="indianSummary" class="micro-card" style="font-size: 11px; color: var(--text-dim); margin-bottom: 6px;">Loading catalog...</div>
            <div id="indianSatList" class="sat-list" style="display: flex; flex-direction: column; gap: 6px;"></div>
            <div class="pagination catalog-pagination" style="display: flex; justify-content: space-between; align-items: center; margin-top: 12px; padding: 4px 0;">
                <button id="prevCatalogPageBtn" class="btn-sm secondary badge-outline" style="font-size: 11px; padding: 3px 8px; background: none; border: 1px solid rgba(111,226,255,0.3); color: var(--text-main); cursor: pointer; border-radius: 4px;">&lt;</button>
                <span id="catalogPageInfo" style="font-size: 11px; color: var(--text-dim);">Page 1 of 1</span>
                <button id="nextCatalogPageBtn" class="btn-sm secondary badge-outline" style="font-size: 11px; padding: 3px 8px; background: none; border: 1px solid rgba(111,226,255,0.3); color: var(--text-main); cursor: pointer; border-radius: 4px;">&gt;</button>
            </div>
            <!-- Hidden Satellites Controls -->
            <div id="hiddenGroupsContainer" style="margin-top: 12px; padding: 8px; background: rgba(255, 255, 255, 0.02); border: 1px solid var(--panel-border); border-radius: 4px;">
                <div id="hiddenGroupsSummary" style="font-size: 11px; color: var(--text-dim); margin-bottom: 8px; line-height: 1.4; word-wrap: break-word;">No satellite name groups are hidden.</div>
                <button id="resetHiddenGroupsButton" class="secondary" style="width: 100%; font-size: 11px; padding: 6px; text-transform: uppercase; font-weight: bold; letter-spacing: 0.05em;" disabled>Show All Hidden Satellites</button>
            </div>
        </div>

        <!-- 6. Collapsible System Diagnostics -->
        <details class="section diagnostics-details" style="border-top: 1px solid rgba(255,255,255,0.08); margin-top: 12px; padding-top: 12px; cursor: pointer;">
            <summary style="font-weight: bold; font-size: 12px; text-transform: uppercase; color: var(--text-dim); display: flex; justify-content: space-between; align-items: center; user-select: none;">
                <span>System Diagnostics</span>
                <span class="diagnostic-arrow" style="font-size: 10px;">▼</span>
            </summary>
            <div style="cursor: default; margin-top: 8px; display: flex; flex-direction: column; gap: 8px;">
                <div id="catalogSchedulerInfo" class="micro-card" style="font-size: 0.85em; line-height: 1.45;">Loading scheduler...</div>
                <div id="catalogStatusSummary" class="micro-card" style="font-size: 0.85em; line-height: 1.45; display: none;"></div>

                <div style="font-size: 11px; text-transform: uppercase; color: var(--text-dim); margin-top: 6px;">Sync Controls</div>
                <button id="refreshCatalogStatusBtn" class="primary" style="width:100%; font-size:11px; padding: 6px;">Refresh Status</button>
                <button id="triggerSyncBtn" class="secondary" style="width:100%; margin-top: 4px; font-size: 11px; padding: 6px;">Trigger Manual Sync</button>

                <div style="font-size: 11px; text-transform: uppercase; color: var(--text-dim); margin-top: 6px;">Sync History</div>
                <div id="catalogHistoryList" class="list" style="max-height: 120px; overflow-y: auto;"></div>
            </div>
        </details>
    `;
}

export default {
    id: "mission-control",
    label: "Mission Control",
    eyebrow: "Catalog Operations",
    description: "Catalog freshness, sync history, and satellite catalog filters.",
    dockEyebrow: "Catalog",
    dockLabel: "Mission Control",
    status: "ready",
    mount(ctx) {
        const root = ctx.containers.sidebarRoot;
        root.innerHTML = buildSidebar();

        const scope = new ListenerScope();

        // Initialize state defaults if not present
        if (appState.showOnlyIndian === undefined) appState.showOnlyIndian = false;
        if (appState.showOnlyThreats === undefined) appState.showOnlyThreats = false;
        if (appState.showOnlyNewSyncSatellites === undefined) appState.showOnlyNewSyncSatellites = false;
        if (appState.activePriorityGroup === undefined) appState.activePriorityGroup = null;
        if (appState.catalogPage === undefined) appState.catalogPage = 1;
        if (appState.orbitClassFilter === undefined) {
            appState.orbitClassFilter = { LEO: true, MEO: true, GEO: true, HEO: true, Unknown: true };
        }

        const refreshDirectory = () => {
            renderSatelliteDirectory(
                ctx.shared.toggleSatellitePath,
                ctx.shared.hideSatelliteGroup,
                ctx.shared.clearHiddenGroups
            );
        };

        const triggerVisibilityUpdate = () => {
            if (typeof ctx.shared.refreshSatelliteVisibility === "function") {
                ctx.shared.refreshSatelliteVisibility();
            }
            refreshDirectory();
        };

        const refreshStatus = async () => {
            const btn = document.getElementById("refreshCatalogStatusBtn");
            if (btn) btn.disabled = true;
            setStatus("Refreshing catalog status...");
            try {
                await ctx.shared.refreshCatalogSidebar();
                setStatus("Catalog status updated.");
                updatePriorityCounts();
            } catch (error) {
                setStatus("Failed to refresh catalog status.");
            } finally {
                if (btn) btn.disabled = false;
            }
        };

        const updatePriorityCounts = () => {
            const sats = appState.satellites || [];

            const countIndian = sats.filter(s => s.isIndian).length;
            const countChineseIsr = sats.filter(s => /YAOGAN|GAOFEN|ZHUHAI/i.test(s.name)).length;
            const countAdversaryMil = sats.filter(s => /SHIYAN|SHIJIAN|TIANHUI|COSMOS/i.test(s.name)).length;
            const countNav = sats.filter(s => /BEIDOU|GPS|GLONASS|GALILEO|IRNSS/i.test(s.name)).length;
            const countCommercial = sats.filter(s => /STARLINK|ONEWEB|KUIPER|DIGUI|FLOCK|PLANET|MAXAR/i.test(s.name)).length;

            const elIndian = document.getElementById("priorityCountIndian");
            const elChineseIsr = document.getElementById("priorityCountChineseIsr");
            const elAdversaryMil = document.getElementById("priorityCountAdversaryMil");
            const elNav = document.getElementById("priorityCountNav");
            const elCommercial = document.getElementById("priorityCountCommercial");

            if (elIndian) elIndian.textContent = formatNumber(countIndian, 0);
            if (elChineseIsr) elChineseIsr.textContent = formatNumber(countChineseIsr, 0);
            if (elAdversaryMil) elAdversaryMil.textContent = formatNumber(countAdversaryMil, 0);
            if (elNav) elNav.textContent = formatNumber(countNav, 0);
            if (elCommercial) elCommercial.textContent = formatNumber(countCommercial, 0);
        };

        const searchInput = document.getElementById("satelliteSearchInput");
        const newSatellitesDetectedToggle = document.getElementById("newSatellitesDetectedToggle");
        const showOnlyIndianToggle = document.getElementById("showOnlyIndianToggle");
        const showOnlyThreatsToggle = document.getElementById("showOnlyThreatsToggle");
        const hideCommercialToggle = document.getElementById("hideCommercialToggle");
        const orbitLEOCheckbox = document.getElementById("orbitLEOCheckbox");
        const orbitMEOCheckbox = document.getElementById("orbitMEOCheckbox");
        const orbitGEOCheckbox = document.getElementById("orbitGEOCheckbox");
        const orbitHEOCheckbox = document.getElementById("orbitHEOCheckbox");
        const prevCatalogPageBtn = document.getElementById("prevCatalogPageBtn");
        const nextCatalogPageBtn = document.getElementById("nextCatalogPageBtn");
        const showPayloadsToggle = document.getElementById("showPayloadsToggle");
        const showDebrisToggle = document.getElementById("showDebrisToggle");
        const showRocketBodiesToggle = document.getElementById("showRocketBodiesToggle");

        // Set checkboxes and toggles from state
        if (newSatellitesDetectedToggle) newSatellitesDetectedToggle.checked = appState.showOnlyNewSyncSatellites;
        if (showOnlyIndianToggle) showOnlyIndianToggle.checked = appState.showOnlyIndian;
        if (showOnlyThreatsToggle) showOnlyThreatsToggle.checked = appState.showOnlyThreats;
        if (hideCommercialToggle) hideCommercialToggle.checked = appState.hideCommercialSatellites;
        if (showPayloadsToggle) showPayloadsToggle.checked = appState.showPayloads;
        if (showDebrisToggle) showDebrisToggle.checked = appState.showDebris;
        if (showRocketBodiesToggle) showRocketBodiesToggle.checked = appState.showRocketBodies;
        if (orbitLEOCheckbox) orbitLEOCheckbox.checked = appState.orbitClassFilter.LEO;
        if (orbitMEOCheckbox) orbitMEOCheckbox.checked = appState.orbitClassFilter.MEO;
        if (orbitGEOCheckbox) orbitGEOCheckbox.checked = appState.orbitClassFilter.GEO;
        if (orbitHEOCheckbox) orbitHEOCheckbox.checked = appState.orbitClassFilter.HEO;

        scope.add(searchInput, "input", () => {
            appState.catalogPage = 1;
            refreshDirectory();
        });

        scope.add(newSatellitesDetectedToggle, "change", async () => {
            const checked = Boolean(newSatellitesDetectedToggle.checked);
            appState.showOnlyNewSyncSatellites = checked;
            appState.catalogPage = 1;

            if (checked && (!appState.latestNewSatelliteNames || appState.latestNewSatelliteNames.size === 0)) {
                setStatus("Retrieving newly discovered satellites...");
                try {
                    const { payload } = await fetchJsonWithFallback("/api/catalog/latest-new-satellites", appState.catalogApiBaseUrl);
                    const sats = payload.satellites || [];
                    appState.latestNewSatelliteNames = new Set(sats.map(s => s.name));

                    // Inject any new satellites that are not yet in the scene
                    if (typeof ctx.shared.addNewSatellitesToScene === "function" && sats.length > 0) {
                        const added = await ctx.shared.addNewSatellitesToScene(sats);
                        if (added > 0) {
                            setStatus(`Loaded ${sats.length} new satellites (${added} added to globe).`);
                        } else {
                            setStatus(`Loaded ${sats.length} new satellites from the latest sync.`);
                        }
                    } else {
                        setStatus(`Loaded ${sats.length} new satellites from the latest sync.`);
                    }
                } catch (error) {
                    console.error("Failed to fetch new satellites:", error);
                    setStatus("Failed to load new satellites.");
                    newSatellitesDetectedToggle.checked = false;
                    appState.showOnlyNewSyncSatellites = false;
                    return;
                }
            }
            triggerVisibilityUpdate();
            setStatus(appState.showOnlyNewSyncSatellites ? "Filtering: Newly detected satellites." : "Restored all satellites.");
        });

        const viewNewBtn = document.getElementById("viewNewSatellitesBtn");
        if (viewNewBtn) {
            scope.add(viewNewBtn, "click", async () => {
                appState.showOnlyNewSyncSatellites = true;
                appState.catalogPage = 1;
                if (newSatellitesDetectedToggle) {
                    newSatellitesDetectedToggle.checked = true;
                }

                setStatus("Retrieving newly discovered satellites...");
                try {
                    const { payload } = await fetchJsonWithFallback("/api/catalog/latest-new-satellites", appState.catalogApiBaseUrl);
                    const sats = payload.satellites || [];
                    appState.latestNewSatelliteNames = new Set(sats.map(s => s.name));

                    // Inject any new satellites that are not yet in the Cesium scene
                    if (typeof ctx.shared.addNewSatellitesToScene === "function" && sats.length > 0) {
                        const added = await ctx.shared.addNewSatellitesToScene(sats);
                        if (added > 0) {
                            setStatus(`Viewing ${sats.length} new satellites (${added} added to globe).`);
                        } else {
                            setStatus(`Viewing ${sats.length} new satellites from the latest sync.`);
                        }
                    } else {
                        setStatus(`Viewing ${sats.length} new satellites from the latest sync.`);
                    }
                } catch (error) {
                    console.error("Failed to fetch new satellites:", error);
                    setStatus("Failed to load new satellites.");
                    if (newSatellitesDetectedToggle) {
                        newSatellitesDetectedToggle.checked = false;
                    }
                    appState.showOnlyNewSyncSatellites = false;
                    return;
                }
                triggerVisibilityUpdate();
            });
        }

        scope.add(showOnlyIndianToggle, "change", () => {
            appState.showOnlyIndian = Boolean(showOnlyIndianToggle.checked);
            appState.catalogPage = 1;
            triggerVisibilityUpdate();
            setStatus(appState.showOnlyIndian ? "Filtering: Indian national assets only." : "Restored international assets.");
        });

        scope.add(showOnlyThreatsToggle, "change", () => {
            appState.showOnlyThreats = Boolean(showOnlyThreatsToggle.checked);
            appState.catalogPage = 1;
            triggerVisibilityUpdate();
            setStatus(appState.showOnlyThreats ? "Filtering: Threat objects only." : "Restored international objects.");
        });

        scope.add(hideCommercialToggle, "change", () => {
            appState.hideCommercialSatellites = Boolean(hideCommercialToggle.checked);
            appState.catalogPage = 1;
            triggerVisibilityUpdate();
            setStatus(appState.hideCommercialSatellites ? "Filtering: Hiding commercial satellites." : "Restored commercial satellites.");
        });

        if (showPayloadsToggle) {
            scope.add(showPayloadsToggle, "change", () => {
                appState.showPayloads = Boolean(showPayloadsToggle.checked);
                triggerVisibilityUpdate();
                setStatus(appState.showPayloads ? "Payloads shown." : "Payloads hidden.");
            });
        }

        if (showDebrisToggle) {
            scope.add(showDebrisToggle, "change", () => {
                appState.showDebris = Boolean(showDebrisToggle.checked);
                triggerVisibilityUpdate();
                setStatus(appState.showDebris ? "Space debris shown." : "Space debris hidden.");
            });
        }

        if (showRocketBodiesToggle) {
            scope.add(showRocketBodiesToggle, "change", () => {
                appState.showRocketBodies = Boolean(showRocketBodiesToggle.checked);
                triggerVisibilityUpdate();
                setStatus(appState.showRocketBodies ? "Rocket bodies shown." : "Rocket bodies hidden.");
            });
        }

        const updateOrbitClassFilters = () => {
            appState.orbitClassFilter.LEO = Boolean(orbitLEOCheckbox.checked);
            appState.orbitClassFilter.MEO = Boolean(orbitMEOCheckbox.checked);
            appState.orbitClassFilter.GEO = Boolean(orbitGEOCheckbox.checked);
            appState.orbitClassFilter.HEO = Boolean(orbitHEOCheckbox.checked);
            appState.orbitClassFilter.Unknown = true;
            appState.catalogPage = 1;
            triggerVisibilityUpdate();
        };

        scope.add(orbitLEOCheckbox, "change", updateOrbitClassFilters);
        scope.add(orbitMEOCheckbox, "change", updateOrbitClassFilters);
        scope.add(orbitGEOCheckbox, "change", updateOrbitClassFilters);
        scope.add(orbitHEOCheckbox, "change", updateOrbitClassFilters);

        // Catalog Browser Pagination
        scope.add(prevCatalogPageBtn, "click", () => {
            if (appState.catalogPage > 1) {
                appState.catalogPage--;
                refreshDirectory();
            }
        });

        scope.add(nextCatalogPageBtn, "click", () => {
            appState.catalogPage++;
            refreshDirectory();
        });

        // Priority Group Cards Filtering
        const priorityCards = document.querySelectorAll(".priority-group-card");
        priorityCards.forEach(card => {
            const groupKey = card.dataset.group;

            // Highlight initially active card
            if (appState.activePriorityGroup === groupKey) {
                card.style.border = "1px solid var(--accent)";
                card.style.background = "rgba(111, 226, 255, 0.08)";
            }

            scope.add(card, "click", () => {
                priorityCards.forEach(c => {
                    c.style.border = "";
                    c.style.background = "";
                });

                if (appState.activePriorityGroup === groupKey) {
                    appState.activePriorityGroup = null;
                } else {
                    appState.activePriorityGroup = groupKey;
                    card.style.border = "1px solid var(--accent)";
                    card.style.background = "rgba(111, 226, 255, 0.08)";
                }

                appState.catalogPage = 1;
                triggerVisibilityUpdate();
            });
        });



        scope.add(document.getElementById("refreshCatalogStatusBtn"), "click", refreshStatus);

        scope.add(document.getElementById("triggerSyncBtn"), "click", async (e) => {
            const btn = e.currentTarget;
            try {
                btn.disabled = true;
                btn.textContent = "Syncing...";
                setStatus("Triggering manual catalog sync...");
                const { payload } = await postJsonWithFallback("/api/sync", {}, appState.catalogApiBaseUrl);
                setStatus(`Sync complete: ${payload.syncedCount} records.`);
                await refreshStatus();
            } catch (error) {
                console.error("Manual sync failed:", error);
                setStatus("Manual sync failed. See console for details.");
            } finally {
                btn.disabled = false;
                btn.textContent = "Trigger Manual Sync";
            }
        });

        scope.addCleanup(eventBus.on(events.catalogStatusUpdated, ({ status, history }) => {
            renderCatalogStatus(status, history);
            updatePriorityCounts();
        }));

        scope.addCleanup(eventBus.on(events.catalogReady, () => {
            refreshDirectory();
            updatePriorityCounts();
        }));

        if (ctx.shared.catalogStatusSnapshot) {
            renderCatalogStatus(ctx.shared.catalogStatusSnapshot.status, ctx.shared.catalogStatusSnapshot.history);
        } else {
            ctx.shared.refreshCatalogSidebar();
        }

        updatePriorityCounts();
        refreshDirectory();
        setStatus("Mission Control active. SDA operational console ready.");

        return {
            unmount() {
                scope.dispose();
            }
        };
    }
};
