import { escapeHtml } from "../utils.js";

export function field(label, controlHtml, { id = null, hint = null } = {}) {
    return `
        <div class="field">
            <label${id ? ` for="${escapeHtml(id)}"` : ""}>${escapeHtml(label)}</label>
            ${controlHtml}
            ${hint ? `<div class="readout">${escapeHtml(hint)}</div>` : ""}
        </div>
    `;
}

export function selectControl(id, options, { ariaLabel = null } = {}) {
    const renderedOptions = options.map((option) => `
        <option value="${escapeHtml(option.value)}"${option.selected ? " selected" : ""}>${escapeHtml(option.label)}</option>
    `).join("");
    return `<select id="${escapeHtml(id)}"${ariaLabel ? ` aria-label="${escapeHtml(ariaLabel)}"` : ""}>${renderedOptions}</select>`;
}

export function splitFields(controls) {
    return `<div class="split">${controls.join("")}</div>`;
}

export function button(label, { id = null, variant = "primary", type = "button", disabled = false, dataset = {} } = {}) {
    const datasetAttrs = Object.entries(dataset)
        .map(([key, value]) => `data-${escapeHtml(key)}="${escapeHtml(value)}"`)
        .join(" ");
    const className = variant === "secondary" ? "secondary" : "";
    return `
        <button${id ? ` id="${escapeHtml(id)}"` : ""}${className ? ` class="${className}"` : ""} type="${escapeHtml(type)}"${disabled ? " disabled" : ""}${datasetAttrs ? ` ${datasetAttrs}` : ""}>${escapeHtml(label)}</button>
    `;
}

export function section(title, bodyHtml) {
    return `
        <div class="section">
            <div class="section-title">${escapeHtml(title)}</div>
            ${bodyHtml}
        </div>
    `;
}

export function microCard(content, { id = null } = {}) {
    return `<div class="micro-card"${id ? ` id="${escapeHtml(id)}"` : ""}>${content}</div>`;
}

export function alertCard({ id = "collisionAlertCard", title = "Collision Alert", badgeId = "collisionAlertBadge", summaryId = "collisionAlertSummary", initialBadge = "Clear", initialSummary = "Trace a region to evaluate close-approach risk in the current forecast window." } = {}) {
    return `
        <div id="${escapeHtml(id)}" class="alert-card">
            <div class="alert-title-row">
                <strong>${escapeHtml(title)}</strong>
                <span id="${escapeHtml(badgeId)}" class="alert-pill">${escapeHtml(initialBadge)}</span>
            </div>
            <div id="${escapeHtml(summaryId)}" class="alert-meta">${escapeHtml(initialSummary)}</div>
        </div>
    `;
}

export function placeholderPanel(title, message) {
    return `
        <div class="section">
            <div class="section-title">${escapeHtml(title)}</div>
            <div class="micro-card">${escapeHtml(message)}</div>
        </div>
        <div class="section">
            <div class="section-title">Status</div>
            <div class="list">
                <div class="list-item warning">
                    <strong>Coming Soon</strong>
                    This operational module is reserved by the architecture and will be activated in a future release.
                </div>
            </div>
        </div>
    `;
}

export function traceChip() {
    return `<div class="trace-chip">1. <strong>Trace Region</strong> 2. Click points on the globe 3. <strong>Finish Trace</strong></div>`;
}

export function readout(id, defaultText = "") {
    return `<div id="${escapeHtml(id)}" class="readout">${escapeHtml(defaultText)}</div>`;
}

export class ListenerScope {
    constructor() {
        this.cleanups = [];
    }

    add(target, type, handler, options = false) {
        if (!target) {
            return;
        }
        target.addEventListener(type, handler, options);
        this.cleanups.push(() => target.removeEventListener(type, handler, options));
    }

    addMany(selector, type, handler, options = false) {
        const elements = document.querySelectorAll(selector);
        elements.forEach((el) => this.add(el, type, handler, options));
    }

    addCleanup(fn) {
        if (typeof fn === "function") {
            this.cleanups.push(fn);
        }
    }

    dispose() {
        for (const cleanup of this.cleanups.splice(0)) {
            try {
                cleanup();
            } catch (error) {
                console.warn("Listener cleanup failed.", error);
            }
        }
    }
}
