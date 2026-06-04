import { fetchUnifiedThreatInsights } from "../../correlationService.js";
import { appState } from "../../state.js";
import { elements } from "../../dom.js";
import { renderAnalysisLoader, renderUnifiedThreatInsights, setStatus } from "../../ui.js";
import { button, ListenerScope } from "../../ui/panelSystem.js";
import { eventBus, events } from "../eventBus.js";

const state = {
    classification: "all",
    priority: "all",
    page: 1,
    pageSize: 5,
    viewMode: "top10"
};

let currentSnapshot = null;
let sidebarRoot = null;
let analysisClickHandler = null;

const PRIORITY_FILTERS = [
    { value: "all", label: "All" },
    { value: "CRITICAL", label: "Critical" },
    { value: "HIGH", label: "High" },
    { value: "MEDIUM", label: "Medium" },
    { value: "LOW", label: "Low" }
];

const CLASSIFICATION_FILTERS = [
    { value: "all", label: "All" },
    { value: "INDIAN", label: "Indian" },
    { value: "FRIENDLY", label: "Friendly" },
    { value: "ADVERSARY", label: "Adversary" }
];

function getSnapshotPagination() {
    return currentSnapshot?.pagination || {
        page: state.page,
        pageSize: state.pageSize,
        totalCount: 0,
        totalPages: 1,
        startIndex: 0,
        endIndex: 0,
        viewMode: state.viewMode
    };
}

function renderButtonRow(filterGroup, options, activeValue) {
    return `
        <div style="display:flex; flex-wrap:wrap; gap:6px;">
            ${options.map((option) => button(option.label, {
                variant: option.value === activeValue ? "primary" : "secondary",
                dataset: {
                    "uti-action": "set-filter",
                    "filter-group": filterGroup,
                    "filter-value": option.value
                }
            })).join("")}
        </div>
    `;
}

function renderSidebar() {
    if (!sidebarRoot) {
        return;
    }

    const pagination = getSnapshotPagination();
    const summaryText = pagination.totalCount
        ? `Showing ${pagination.startIndex}-${pagination.endIndex} of ${pagination.totalCount} incidents`
        : "No incidents available for the current queue filters.";
    const viewToggleLabel = state.viewMode === "all" ? "Show Top 10 Incidents" : "View All Incidents";

    sidebarRoot.innerHTML = `
        <div class="section">
            <div class="section-title">Threat Queue Filters</div>
            <div class="micro-card" style="margin-bottom:12px; color: var(--text-muted);">
                Sorts the queue by severity, then miss distance, then TCA.
            </div>
            <div class="field">
                <label>Severity</label>
                ${renderButtonRow("priority", PRIORITY_FILTERS, state.priority)}
            </div>
            <div class="field" style="margin-top: 10px;">
                <label>Classification</label>
                ${renderButtonRow("classification", CLASSIFICATION_FILTERS, state.classification)}
            </div>
            <div style="display:flex; gap:8px; flex-wrap:wrap; margin-top: 12px;">
                ${button(viewToggleLabel, {
                    dataset: {
                        "uti-action": "toggle-view-mode"
                    }
                })}
                ${button("Refresh Queue", {
                    variant: "secondary",
                    dataset: {
                        "uti-action": "refresh-queue"
                    }
                })}
            </div>
            <div id="utiSummary" class="micro-card" style="margin-top:12px;">${summaryText}</div>
        </div>
        <div class="section">
            <div class="section-title">Operator Cue</div>
            <div class="micro-card">
                Use the queue to answer three questions fast: what happened, how serious it is, and what should be done next.
            </div>
        </div>
    `;
}

async function refreshInsights(ctx, patch = {}) {
    Object.assign(state, patch);
    if (patch.classification || patch.priority || patch.viewMode) {
        state.page = 1;
    }
    if (Number.isFinite(patch.page)) {
        state.page = Math.max(1, Math.floor(patch.page));
    }
    if (!Number.isFinite(state.pageSize) || state.pageSize < 1) {
        state.pageSize = 5;
    }

    const summary = document.getElementById("utiSummary");

    try {
        if (summary) {
            summary.textContent = "Refreshing threat queue...";
        }
        renderAnalysisLoader("Unified Threat Insights", "Building the operational threat queue...");
        const response = await fetchUnifiedThreatInsights({
            classification: state.classification,
            priority: state.priority,
            page: state.page,
            pageSize: state.pageSize,
            viewMode: state.viewMode
        }, appState.catalogApiBaseUrl);

        currentSnapshot = response;
        state.page = response.pagination?.page || state.page;
        state.pageSize = response.pagination?.pageSize || state.pageSize;
        renderSidebar();
        renderUnifiedThreatInsights(response);
        setStatus("Unified threat queue refreshed.");
        if (summary) {
            const pagination = getSnapshotPagination();
            summary.textContent = pagination.totalCount
                ? `Showing ${pagination.startIndex}-${pagination.endIndex} of ${pagination.totalCount} incidents`
                : "No incidents available for the current queue filters.";
        }
        return response;
    } catch (error) {
        console.warn("Failed to refresh unified threat insights:", error);
        if (summary) {
            summary.textContent = "Failed to refresh the threat queue.";
        }
        currentSnapshot = { incidents: [], pagination: getSnapshotPagination() };
        renderSidebar();
        renderUnifiedThreatInsights(currentSnapshot);
        return currentSnapshot;
    }
}

function bindDelegatedHandlers(ctx, scope) {
    if (sidebarRoot) {
        scope.add(sidebarRoot, "click", async (event) => {
            const target = event.target.closest("[data-uti-action]");
            if (!target) {
                return;
            }

            const action = target.dataset.utiAction;
            if (action === "set-filter") {
                const group = target.dataset.filterGroup;
                const value = target.dataset.filterValue;
                if (group === "priority") {
                    state.priority = value;
                } else if (group === "classification") {
                    state.classification = value;
                }
                state.page = 1;
                await refreshInsights(ctx);
                return;
            }

            if (action === "toggle-view-mode") {
                state.viewMode = state.viewMode === "all" ? "top10" : "all";
                state.page = 1;
                await refreshInsights(ctx);
                return;
            }

            if (action === "refresh-queue") {
                await refreshInsights(ctx);
            }
        });
    }

    if (elements.analysisPanel) {
        analysisClickHandler = async (event) => {
            const target = event.target.closest("[data-uti-action]");
            if (!target) {
                return;
            }

            const action = target.dataset.utiAction;
            if (action === "prev-page") {
                if (state.page > 1) {
                    state.page -= 1;
                    await refreshInsights(ctx);
                }
                return;
            }

            if (action === "next-page") {
                const pagination = getSnapshotPagination();
                if (state.page < pagination.totalPages) {
                    state.page += 1;
                    await refreshInsights(ctx);
                }
            }
        };
        scope.add(elements.analysisPanel, "click", analysisClickHandler);
    }
}

export default {
    id: "unified-threat-insights",
    label: "Unified Threat Insights",
    eyebrow: "Correlation Intelligence",
    description: "Central threat queue that merges module outputs into operational incidents.",
    dockEyebrow: "Threat",
    dockLabel: "Queue",
    status: "ready",
    mount(ctx) {
        sidebarRoot = ctx.containers.sidebarRoot;
        renderSidebar();

        const scope = new ListenerScope();
        bindDelegatedHandlers(ctx, scope);

        if (ctx.shared.threatInsightsSnapshot && Array.isArray(ctx.shared.threatInsightsSnapshot.incidents)) {
            currentSnapshot = ctx.shared.threatInsightsSnapshot;
            state.page = currentSnapshot.pagination?.page || state.page;
            state.pageSize = currentSnapshot.pagination?.pageSize || state.pageSize;
            renderSidebar();
            renderUnifiedThreatInsights(currentSnapshot);
        } else {
            refreshInsights(ctx).catch((error) => console.warn("Unified threat insights initial load failed:", error));
        }

        const unbindInsights = eventBus.on(events.threatInsightsUpdated, (snapshot) => {
            if (!snapshot || !Array.isArray(snapshot.incidents)) {
                return;
            }
            currentSnapshot = snapshot;
            state.page = snapshot.pagination?.page || state.page;
            state.pageSize = snapshot.pagination?.pageSize || state.pageSize;
            renderSidebar();
        });
        scope.addCleanup(unbindInsights);

        setStatus("Unified threat insights module active.");

        return {
            unmount() {
                scope.dispose();
                sidebarRoot = null;
                currentSnapshot = null;
                analysisClickHandler = null;
            }
        };
    }
};
