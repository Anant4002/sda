import { elements } from "../dom.js";
import { getModule } from "./moduleRegistry.js";
import { eventBus, events } from "./eventBus.js";

let activeModuleId = null;
let activeInstance = null;
let activeDefinition = null;
let context = null;

function ensureContext() {
    if (!context) {
        throw new Error("ModuleHost.init(ctx) must be called before activating modules.");
    }
}

export const moduleHost = {
    init(ctx) {
        if (!ctx || !ctx.containers || !ctx.containers.sidebarRoot) {
            throw new Error("moduleHost.init requires a context with containers.sidebarRoot.");
        }
        context = ctx;
    },

    getActiveModuleId() {
        return activeModuleId;
    },

    getActiveModuleDefinition() {
        return activeDefinition;
    },

    async activate(moduleId) {
        ensureContext();
        const definition = getModule(moduleId);
        if (!definition) {
            console.warn(`Module ${moduleId} is not registered.`);
            return false;
        }
        if (definition.status === "placeholder") {
            this.renderPlaceholder(definition);
            return true;
        }
        if (activeModuleId === moduleId && activeInstance) {
            return true;
        }
        this.deactivate();
        try {
            this.updateHeader(definition);
            this.clearSidebar();
            const instance = await definition.mount(context) || {};
            activeInstance = instance;
            activeModuleId = moduleId;
            activeDefinition = definition;
            eventBus.emit(events.moduleActivated, { id: moduleId, definition });
            return true;
        } catch (error) {
            console.error(`Failed to mount module ${moduleId}.`, error);
            this.clearSidebar();
            return false;
        }
    },

    deactivate() {
        if (activeInstance && typeof activeInstance.unmount === "function") {
            try {
                activeInstance.unmount();
            } catch (error) {
                console.warn(`Module ${activeModuleId} failed to unmount cleanly.`, error);
            }
        }
        
        // Ensure visual state returns to default when switching modules
        this._resetVisuals();

        if (activeModuleId) {
            eventBus.emit(events.moduleDeactivated, { id: activeModuleId });
        }
        activeInstance = null;
        activeModuleId = null;
        activeDefinition = null;
        this.clearSidebar();
        this.clearAnalysisPanel();
    },

    _resetVisuals() {
        if (!context || !context.shared) return;
        
        const shared = context.shared;
        
        // 1. Exit focus mode and restore catalog visibility
        if (typeof shared.exitFocusedAnalysisMode === "function") {
            shared.exitFocusedAnalysisMode();
        }

        if (typeof shared.exitAreaFocusMode === "function") {
            shared.exitAreaFocusMode();
        }
        
        // 2. Clear any predicted paths or manoeuvre lines
        if (typeof shared.clearPathEntities === "function") {
            shared.clearPathEntities();
        }

        // 3. Reset real-time clock and multiplier
        if (typeof shared.resetRealTimeClock === "function") {
            shared.resetRealTimeClock();
        }

        // 4. Reset Cesium clock to current time if simulation mode was active
        if (shared.viewer && shared.viewer.clock) {
            shared.viewer.clock.multiplier = 1.0;
            shared.viewer.clock.shouldAnimate = true;
        }
        
        // 4. Clear any persistent module state in appState via shared accessors if needed
        // (Handled primarily by exitFocusedAnalysisMode)
    },

    renderPlaceholder(definition) {
        this.deactivate();
        this.updateHeader(definition);
        if (elements.moduleSidebarRoot) {
            elements.moduleSidebarRoot.innerHTML = `
                <div class="section">
                    <div class="section-title">${definition.label}</div>
                    <div class="micro-card">${definition.description || "This module is reserved by the architecture."}</div>
                </div>
                <div class="section">
                    <div class="section-title">Status</div>
                    <div class="list">
                        <div class="list-item warning">
                            <strong>Coming Soon</strong>
                            This operational capability is part of the platform roadmap and will be activated in a future release.
                        </div>
                    </div>
                </div>
            `;
        }
        activeModuleId = definition.id;
        activeInstance = null;
        activeDefinition = definition;
        eventBus.emit(events.moduleActivated, { id: definition.id, definition });
    },

    updateHeader(definition) {
        if (elements.moduleEyebrow) {
            elements.moduleEyebrow.textContent = definition.eyebrow || "Operations Console";
        }
        if (elements.moduleTitle) {
            elements.moduleTitle.textContent = definition.label || "Operations Module";
        }
        if (elements.moduleSubtitle) {
            elements.moduleSubtitle.textContent = definition.description || "";
        }
    },

    clearSidebar() {
        if (elements.moduleSidebarRoot) {
            elements.moduleSidebarRoot.innerHTML = "";
        }
    },

    clearAnalysisPanel() {
        if (elements.analysisPanel) {
            elements.analysisPanel.innerHTML = "";
        }
    }
};
