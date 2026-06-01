import { renderOperationalAlerts, setStatus, renderAnalysisLoader } from "../../ui.js";
import { ListenerScope } from "../../ui/panelSystem.js";
import { eventBus, events } from "../eventBus.js";

function buildSidebar() {
    return `
        <div class="section">
            <div class="section-title">Operational Alerts</div>
            <div id="operationalAlertSummary" class="micro-card">Loading backend alert feed...</div>
        </div>
        <div class="section">
            <div class="section-title">Refresh</div>
            <button id="alertsRefreshButton" type="button">Refresh Alert Feed</button>
            <div class="micro-card">Backend persists alerts from each analysis. The most recent ${`<strong>5</strong>`} are shown.</div>
        </div>
    `;
}

export default {
    id: "operational-alerts",
    label: "Operational Alerts and Event Log",
    eyebrow: "Event Operations",
    description: "Backend-recorded operational alerts and event log.",
    dockEyebrow: "Events",
    dockLabel: "Alerts",
    status: "ready",
    mount(ctx) {
        const root = ctx.containers.sidebarRoot;
        root.innerHTML = buildSidebar();

        const scope = new ListenerScope();

        // Wire the refresh button to the shared refresh action and provide
        // immediate UI feedback. Use async handler so we can show errors.
        scope.add(document.getElementById("alertsRefreshButton"), "click", async (e) => {
            const btn = e.currentTarget;
            try {
                btn.disabled = true;
                btn.textContent = "Refreshing...";
                setStatus("Refreshing operational alert feed...");
                renderAnalysisLoader("Operational Alert Feed", "Querying persisted analytical observations and conjunction alerts from the backend feed...");
                await ctx.shared.refreshOperationalAlerts();
                setStatus("Operational alert feed refreshed.");
            } catch (err) {
                console.warn("Failed to refresh operational alerts:", err);
                setStatus("Failed to refresh operational alerts. See console for details.");
            } finally {
                btn.disabled = false;
                btn.textContent = "Refresh Alert Feed";
            }
        });

        // Subscribe to alert update events. The event emitter may send a
        // payload ({ alerts }) or simply notify without payload (legacy).
        // Handle both cases gracefully: if payload provided, render directly,
        // otherwise trigger a fresh fetch via shared action.
        const unbindAlerts = eventBus.on(events.alertsUpdated, (payload) => {
            if (payload && Array.isArray(payload.alerts)) {
                renderOperationalAlerts(payload.alerts);
            } else {
                // Fire-and-forget; refreshOperationalAlerts will render when done
                ctx.shared.refreshOperationalAlerts().catch((e) => console.warn("alerts refresh (event) failed:", e));
            }
        });
        scope.addCleanup(unbindAlerts);

        if (ctx.shared.alertsSnapshot) {
            renderOperationalAlerts(ctx.shared.alertsSnapshot);
        } else {
            renderAnalysisLoader("Operational Alert Feed", "Querying persisted analytical observations and conjunction alerts from the backend feed...");
            ctx.shared.refreshOperationalAlerts();
        }

        setStatus("Alerts module active. Review backend operational findings.");

        return {
            unmount() {
                scope.dispose();
            }
        };
    }
};
