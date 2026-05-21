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

        const searchInput = document.getElementById("satelliteSearchInput");
        scope.add(searchInput, "input", refreshDirectory);

        scope.addCleanup(eventBus.on(events.catalogStatusUpdated, ({ status, history }) => {
            renderCatalogStatus(status, history);
        }));

        scope.addCleanup(eventBus.on(events.catalogReady, () => refreshDirectory()));

        if (ctx.shared.catalogStatusSnapshot) {
            renderCatalogStatus(ctx.shared.catalogStatusSnapshot.status, ctx.shared.catalogStatusSnapshot.history);
        } else {
            ctx.shared.refreshCatalogSidebar();
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
