import { elements } from "../dom.js";
import { listModules } from "./moduleRegistry.js";
import { eventBus, events } from "./eventBus.js";
import { moduleHost } from "./moduleHost.js";
import { escapeHtml } from "../utils.js";

let unsubscribeActivated = null;

function renderDock() {
    if (!elements.moduleDock) {
        return;
    }
    const activeId = moduleHost.getActiveModuleId();
    const modules = listModules();
    elements.moduleDock.innerHTML = modules.map((definition) => {
        const isActive = definition.id === activeId;
        const isPlaceholder = definition.status === "placeholder";
        const className = ["dock-item"];
        if (isActive) {
            className.push("is-active");
        }
        if (isPlaceholder) {
            className.push("is-placeholder");
        }
        return `
            <button class="${className.join(" ")}" type="button" data-module-id="${escapeHtml(definition.id)}" title="${escapeHtml(definition.description || definition.label)}">
                <span class="dock-eyebrow">${escapeHtml(definition.dockEyebrow || (isPlaceholder ? "Roadmap" : "Module"))}</span>
                <span class="dock-label">${escapeHtml(definition.dockLabel || definition.label)}</span>
            </button>
        `;
    }).join("");
}

async function handleDockClick(event) {
    const target = event.target.closest("[data-module-id]");
    if (!target) {
        return;
    }
    const moduleId = target.dataset.moduleId;
    if (!moduleId) {
        return;
    }
    await moduleHost.activate(moduleId);
    renderDock();
}

export const moduleDock = {
    async init(defaultModuleId = null) {
        if (!elements.moduleDock) {
            console.warn("Module dock container is missing from the DOM.");
            return;
        }
        elements.moduleDock.addEventListener("click", handleDockClick);
        renderDock();

        if (unsubscribeActivated) {
            unsubscribeActivated();
        }
        unsubscribeActivated = eventBus.on(events.moduleActivated, () => renderDock());

        if (defaultModuleId) {
            await moduleHost.activate(defaultModuleId);
            renderDock();
        }
    },

    refresh() {
        renderDock();
    }
};
