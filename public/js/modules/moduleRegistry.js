const registry = new Map();
const order = [];

export function registerModule(definition) {
    if (!definition || typeof definition.id !== "string" || !definition.id) {
        throw new Error("Module definition requires a non-empty string id.");
    }
    if (typeof definition.mount !== "function") {
        throw new Error(`Module ${definition.id} must implement a mount(ctx) function.`);
    }
    if (registry.has(definition.id)) {
        throw new Error(`Module ${definition.id} is already registered.`);
    }
    const safe = {
        status: "ready",
        ...definition
    };
    registry.set(safe.id, safe);
    order.push(safe.id);
}

export function getModule(id) {
    return registry.get(id) || null;
}

export function listModules() {
    return order.map((id) => registry.get(id)).filter(Boolean);
}
