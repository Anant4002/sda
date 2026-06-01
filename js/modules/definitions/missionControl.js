import { appState } from "../../state.js";
import { renderCatalogStatus, renderSatelliteDirectory, setStatus } from "../../ui.js";
import { ListenerScope } from "../../ui/panelSystem.js";
import { eventBus, events } from "../eventBus.js";

function buildSidebar() {
    return `
        <div class="section">
            <div class="section-title">Catalog Freshness</div>
            <div id="catalogStatusSummary" class="micro-card">Loading catalog status...</div>
            <div class="section-title" style="margin-top: 10px;">Recent Syncs</div>
            <div id="catalogHistoryList" class="list"></div>
        </div>

        <div class="section">
            <div class="section-title">Operations</div>
            <button id="refreshCatalogStatusBtn" class="primary" style="width:100%;">Refresh Status</button>
            <button id="triggerSyncBtn" class="secondary" style="width:100%; margin-top: 8px;">Trigger Manual Sync</button>
            <div class="micro-card" style="margin-top: 8px; font-size: 0.85em; color: var(--text-dim); line-height: 1.4;">
                Manual sync forces an immediate fetch from the configured upstream source. This may take several seconds.
            </div>
        </div>

        <div class="section">
            <div class="section-title">Operational Filters</div>
            <label style="display:flex; align-items:center; gap:8px; cursor:pointer; color:var(--text-main); font-weight:normal; text-transform:none; font-size:13px; margin: 4px 0 8px;">
                <input id="addedLast30DaysToggle" type="checkbox">
                Added in Last 30 Days
            </label>
            <label style="display:flex; align-items:center; gap:8px; cursor:pointer; color:var(--text-main); font-weight:normal; text-transform:none; font-size:13px; margin: 4px 0 8px;">
                <input id="showOnlyIndianToggle" type="checkbox">
                Only Indian Satellites
            </label>

            <div style="margin-top: 10px;">
                <label style="font-size:11px; text-transform:uppercase; color:var(--text-dim); margin-bottom: 4px; display: block;">Orbit Classes</label>
                <div style="display: flex; gap: 8px; flex-wrap: wrap;">
                    <label style="display:flex; align-items:center; gap:4px; font-size:12px; font-weight:normal; text-transform:none; color: var(--text-main); cursor: pointer;"><input id="orbitLEOCheckbox" type="checkbox" checked> LEO</label>
                    <label style="display:flex; align-items:center; gap:4px; font-size:12px; font-weight:normal; text-transform:none; color: var(--text-main); cursor: pointer;"><input id="orbitMEOCheckbox" type="checkbox" checked> MEO</label>
                    <label style="display:flex; align-items:center; gap:4px; font-size:12px; font-weight:normal; text-transform:none; color: var(--text-main); cursor: pointer;"><input id="orbitGEOCheckbox" type="checkbox" checked> GEO</label>
                    <label style="display:flex; align-items:center; gap:4px; font-size:12px; font-weight:normal; text-transform:none; color: var(--text-main); cursor: pointer;"><input id="orbitHEOCheckbox" type="checkbox" checked> HEO</label>
                </div>
            </div>
        </div>

        <div class="section">
            <div class="section-title">Legend</div>
            <div class="legend">
                <div class="legend-row">
                    <span class="legend-dot" style="background:#7cf29a;"></span>
                    Other active satellites
                </div>
                <div class="legend-row">
                    <span class="legend-dot" style="background:#ff9933;"></span>
                    Indian satellites
                </div>
            </div>
        </div>

        <div class="section">
            <div class="section-title">Satellite Name Filter</div>
            <div id="indianSummary" class="micro-card">Loading satellite name groups...</div>
            <div class="field">
                <label for="satelliteSearchInput">Search Satellite Name</label>
                <input id="satelliteSearchInput" class="search-input" type="search" placeholder="Type name of satellite">
            </div>
            <label style="display:flex; align-items:center; gap:8px; cursor:pointer; color:var(--text-main); font-weight:normal; text-transform:none; font-size:13px; margin: 4px 0 8px;">
                <input id="hideCommercialToggle" type="checkbox">
                Hide commercial satellites
            </label>
            <div class="micro-card" style="font-size: 0.82em; margin-bottom: 8px;">
                Filters commercial TLE entries such as Starlink, OneWeb, Kuiper and Digui from the catalog view and globe.
            </div>
            <button id="resetHiddenGroupsButton" class="secondary" type="button" disabled>Show All Hidden Groups</button>
            <div id="hiddenGroupsSummary" class="micro-card">No satellite name groups are hidden.</div>
            <div id="indianSatList" class="sat-list"></div>
        </div>
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

        const refreshDirectory = () => {
            renderSatelliteDirectory(
                ctx.shared.toggleSatellitePath,
                ctx.shared.hideSatelliteGroup,
                ctx.shared.clearHiddenGroups
            );
        };

        const refreshStatus = async () => {
            const btn = document.getElementById("refreshCatalogStatusBtn");
            if (btn) btn.disabled = true;
            setStatus("Refreshing catalog status...");
            try {
                await ctx.shared.refreshCatalogSidebar();
                setStatus("Catalog status updated.");
            } catch (error) {
                setStatus("Failed to refresh catalog status.");
            } finally {
                if (btn) btn.disabled = false;
                if (btn) btn.disabled = false;
            }
        };

        const searchInput = document.getElementById("satelliteSearchInput");
        const hideCommercialToggle = document.getElementById("hideCommercialToggle");
        const addedLast30DaysToggle = document.getElementById("addedLast30DaysToggle");
        const showOnlyIndianToggle = document.getElementById("showOnlyIndianToggle");
        const orbitLEOCheckbox = document.getElementById("orbitLEOCheckbox");
        const orbitMEOCheckbox = document.getElementById("orbitMEOCheckbox");
        const orbitGEOCheckbox = document.getElementById("orbitGEOCheckbox");
        const orbitHEOCheckbox = document.getElementById("orbitHEOCheckbox");

        // Initialize state defaults if not present
        if (appState.showOnlyIndian === undefined) appState.showOnlyIndian = false;
        if (appState.addedLast30Days === undefined) appState.addedLast30Days = false;
        if (appState.orbitClassFilter === undefined) {
            appState.orbitClassFilter = { LEO: true, MEO: true, GEO: true, HEO: true, Unknown: true };
        }

        // Set checkboxes from state
        if (addedLast30DaysToggle) addedLast30DaysToggle.checked = appState.addedLast30Days;
        if (showOnlyIndianToggle) showOnlyIndianToggle.checked = appState.showOnlyIndian;
        if (orbitLEOCheckbox) orbitLEOCheckbox.checked = appState.orbitClassFilter.LEO;
        if (orbitMEOCheckbox) orbitMEOCheckbox.checked = appState.orbitClassFilter.MEO;
        if (orbitGEOCheckbox) orbitGEOCheckbox.checked = appState.orbitClassFilter.GEO;
        if (orbitHEOCheckbox) orbitHEOCheckbox.checked = appState.orbitClassFilter.HEO;

        const triggerVisibilityUpdate = () => {
            if (typeof ctx.shared.refreshSatelliteVisibility === "function") {
                ctx.shared.refreshSatelliteVisibility();
            }
            refreshDirectory();
        };

        scope.add(searchInput, "input", refreshDirectory);
        scope.add(hideCommercialToggle, "change", () => {
            appState.hideCommercialSatellites = Boolean(hideCommercialToggle.checked);
            triggerVisibilityUpdate();
            setStatus(appState.hideCommercialSatellites ? "Commercial satellites hidden from Mission Control." : "Commercial satellites restored in Mission Control.");
        });

        scope.add(addedLast30DaysToggle, "change", () => {
            appState.addedLast30Days = Boolean(addedLast30DaysToggle.checked);
            triggerVisibilityUpdate();
            setStatus(appState.addedLast30Days ? "Filtering: Added in last 30 days." : "Restored all registration ages.");
        });

        scope.add(showOnlyIndianToggle, "change", () => {
            appState.showOnlyIndian = Boolean(showOnlyIndianToggle.checked);
            triggerVisibilityUpdate();
            setStatus(appState.showOnlyIndian ? "Filtering: Indian national assets only." : "Restored international assets.");
        });

        const updateOrbitClassFilters = () => {
            appState.orbitClassFilter.LEO = Boolean(orbitLEOCheckbox.checked);
            appState.orbitClassFilter.MEO = Boolean(orbitMEOCheckbox.checked);
            appState.orbitClassFilter.GEO = Boolean(orbitGEOCheckbox.checked);
            appState.orbitClassFilter.HEO = Boolean(orbitHEOCheckbox.checked);
            appState.orbitClassFilter.Unknown = true;
            triggerVisibilityUpdate();
        };

        scope.add(orbitLEOCheckbox, "change", updateOrbitClassFilters);
        scope.add(orbitMEOCheckbox, "change", updateOrbitClassFilters);
        scope.add(orbitGEOCheckbox, "change", updateOrbitClassFilters);
        scope.add(orbitHEOCheckbox, "change", updateOrbitClassFilters);

        scope.add(document.getElementById("refreshCatalogStatusBtn"), "click", refreshStatus);

        scope.add(document.getElementById("triggerSyncBtn"), "click", async (e) => {
            const btn = e.currentTarget;
            try {
                btn.disabled = true;
                btn.textContent = "Syncing...";
                setStatus("Triggering manual catalog sync...");
                const { payload } = await ctx.shared.postJsonWithFallback("/api/sync", {}, appState.catalogApiBaseUrl);
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
        }));

        scope.addCleanup(eventBus.on(events.catalogReady, () => refreshDirectory()));

        if (ctx.shared.catalogStatusSnapshot) {
            renderCatalogStatus(ctx.shared.catalogStatusSnapshot.status, ctx.shared.catalogStatusSnapshot.history);
        } else {
            ctx.shared.refreshCatalogSidebar();
        }

        if (hideCommercialToggle) {
            hideCommercialToggle.checked = appState.hideCommercialSatellites;
        }
        refreshDirectory();
        setStatus("Mission Control active. Manage catalog freshness and satellite name filters.");

        return {
            unmount() {
                scope.dispose();
            }
        };
    }
};
