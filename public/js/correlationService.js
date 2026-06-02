import { fetchJsonWithFallback } from "./apiService.js";

export async function fetchUnifiedThreatInsights(payload = {}, apiBaseUrl = null) {
    const queryParts = [];
    if (payload.classification && payload.classification !== "all") {
        queryParts.push(`classification=${encodeURIComponent(payload.classification)}`);
    }
    if (payload.priority && payload.priority !== "all") {
        queryParts.push(`priority=${encodeURIComponent(payload.priority)}`);
    }
    if (Number.isFinite(payload.page)) {
        queryParts.push(`page=${Math.max(1, Math.floor(payload.page))}`);
    }
    if (Number.isFinite(payload.pageSize)) {
        queryParts.push(`pageSize=${Math.max(1, Math.min(5, Math.floor(payload.pageSize)))}`);
    } else if (Number.isFinite(payload.limit)) {
        queryParts.push(`pageSize=${Math.max(1, Math.min(5, Math.floor(payload.limit)))}`);
    }
    if (payload.viewMode && payload.viewMode !== "top10") {
        queryParts.push(`viewMode=${encodeURIComponent(payload.viewMode)}`);
    }
    if (payload.trainingSessionId !== undefined && payload.trainingSessionId !== null && payload.trainingSessionId !== "") {
        queryParts.push(`trainingSessionId=${encodeURIComponent(payload.trainingSessionId)}`);
    }

    const query = queryParts.length ? `?${queryParts.join("&")}` : "";
    const { apiBaseUrl: resolvedApiBaseUrl, payload: responsePayload } = await fetchJsonWithFallback(`/api/threat-insights/incidents${query}`, apiBaseUrl);

    return {
        apiBaseUrl: resolvedApiBaseUrl,
        incidents: Array.isArray(responsePayload?.incidents) ? responsePayload.incidents : [],
        pagination: responsePayload?.pagination || {
            page: 1,
            pageSize: 5,
            totalCount: Array.isArray(responsePayload?.incidents) ? responsePayload.incidents.length : 0,
            totalPages: 1,
            startIndex: 0,
            endIndex: Array.isArray(responsePayload?.incidents) ? responsePayload.incidents.length : 0,
            viewMode: payload.viewMode && payload.viewMode !== "top10" ? payload.viewMode : "top10"
        }
    };
}
