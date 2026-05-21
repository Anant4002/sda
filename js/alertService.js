import { appState } from "./state.js";
import { fetchJsonWithFallback } from "./apiService.js";

export async function fetchOperationalAlerts(apiBaseUrl = null, limit = 5, alertType = null) {
    const queryParts = [];
    if (Number.isFinite(limit)) {
        queryParts.push(`limit=${Math.max(1, Math.min(20, Math.floor(limit)))}`);
    }
    if (alertType) {
        queryParts.push(`type=${encodeURIComponent(alertType)}`);
    }
    const query = queryParts.length ? `?${queryParts.join("&")}` : "";
    
    let path = `/api/alerts${query}`;
    if (appState.simulationMode && appState.activeTrainingSession) {
        path = `/api/training/sessions/${appState.activeTrainingSession.id}/alerts${query}`;
    }

    const { apiBaseUrl: resolvedApiBaseUrl, payload } = await fetchJsonWithFallback(path, apiBaseUrl);
    return {
        apiBaseUrl: resolvedApiBaseUrl,
        alerts: Array.isArray(payload) ? payload : []
    };
}
