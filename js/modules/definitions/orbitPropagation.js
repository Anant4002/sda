import { appState } from "../../state.js";
import { renderDefaultAnalysis, setStatus } from "../../ui.js";
import { ListenerScope } from "../../ui/panelSystem.js";
import { eventBus, events } from "../eventBus.js";

function buildSidebar() {
    return `
        <div class="section">
            <div class="section-title">Live Tracking</div>
            <div class="micro-card">All catalog satellites propagate continuously on the globe at low-cost SGP4 sampling intervals.</div>
        </div>

        <div class="section">
            <div class="section-title">Orbit Path Preview</div>
            <div class="list">
                <div class="list-item">
                    <strong>Click any satellite</strong><br>
                    Click a satellite point on the globe to render one full orbital revolution. Click the same satellite again to remove the trace.
                </div>
            </div>
        </div>
        
        <div class="section">
            <div class="section-title">Active Selection</div>
            <div id="orbitActiveSelection" class="micro-card">No orbit currently rendered.</div>
            <button id="orbitClearButton" class="secondary" type="button" style="margin-top: 10px; width: 100%;">Clear Orbit Preview</button>
        </div>
    `;
}

function renderActiveSelection() {
    const target = document.getElementById("orbitActiveSelection");
    if (!target) {
        return;
    }
    target.textContent = appState.activeSatellitePathId
        ? `Active orbit: ${appState.activeSatellitePathId}`
        : "No orbit currently rendered.";
}

export default {
    id: "orbit-propagation",
    label: "Orbit Propagation and Tracking",
    eyebrow: "Tracking Operations",
    description: "Continuous SGP4 propagation of the catalog and one-orbit preview tooling.",
    dockEyebrow: "Tracking",
    dockLabel: "Orbit Propagation",
    status: "ready",
    mount(ctx) {
        const root = ctx.containers.sidebarRoot;
        root.innerHTML = buildSidebar();

        const scope = new ListenerScope();

        scope.add(document.getElementById("orbitClearButton"), "click", () => {
            if (appState.activeSatellitePathId) {
                ctx.shared.toggleSatellitePath(appState.activeSatellitePathId);
                renderActiveSelection();
            } else {
                renderDefaultAnalysis("Orbit Path Cleared", "Click a satellite on the globe to render one full orbital revolution.");
            }
        });

        renderActiveSelection();
        
        scope.addCleanup(eventBus.on(events.satelliteSelected, () => renderActiveSelection()));
        scope.addCleanup(eventBus.on(events.satelliteCleared, () => renderActiveSelection()));

        if (typeof ctx.shared.setInertialView === "function") {
            ctx.shared.setInertialView(true);
        }
        setStatus("Orbit Propagation module active. Click any satellite on the globe for an orbit preview.");

        return {
            unmount() {
                if (appState.activeSatellitePathId) {
                    ctx.shared.toggleSatellitePath(appState.activeSatellitePathId);
                }
                scope.dispose();
            }
        };
    }
};
