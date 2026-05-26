const listeners = new Map();

export const eventBus = {
    on(eventName, handler) {
        if (typeof handler !== "function") {
            return () => {};
        }
        if (!listeners.has(eventName)) {
            listeners.set(eventName, new Set());
        }
        listeners.get(eventName).add(handler);
        return () => {
            const handlers = listeners.get(eventName);
            if (!handlers) {
                return;
            }
            handlers.delete(handler);
            if (!handlers.size) {
                listeners.delete(eventName);
            }
        };
    },

    emit(eventName, payload) {
        const handlers = listeners.get(eventName);
        if (!handlers) {
            return;
        }
        for (const handler of [...handlers]) {
            try {
                handler(payload);
            } catch (error) {
                console.error(`Event handler for "${eventName}" failed.`, error);
            }
        }
    }
};

export const events = {
    catalogReady: "catalog:ready",
    catalogStatusUpdated: "catalog:statusUpdated",
    alertsUpdated: "alerts:updated",
    areaSelected: "area:selected",
    areaCleared: "area:cleared",
    traceModeChanged: "trace:modeChanged",
    satelliteSelected: "satellite:selected",
    satelliteCleared: "satellite:cleared",
    moduleActivated: "module:activated",
    moduleDeactivated: "module:deactivated",
    SIMULATION_STARTED: "simulation:started",
    SIMULATION_UPDATED: "simulation:updated",
    SIMULATION_TICK: "simulation:tick",
    SIMULATION_STOPPED: "simulation:stopped",
    CLOCK_UPDATED: "clock:updated"
};
