import { postJsonWithFallback } from "./apiService.js";

export async function fetchBackendConjunctionAnalysis(payload, apiBaseUrl = null) {
    const { apiBaseUrl: resolvedApiBaseUrl, payload: responsePayload } = await postJsonWithFallback("/api/analysis/conjunction", payload, apiBaseUrl);
    return {
        apiBaseUrl: resolvedApiBaseUrl,
        result: responsePayload.result,
        persistedCount: responsePayload.persistedCount || 0
    };
}

export async function fetchBackendNeighbourhoodWatch(payload, apiBaseUrl = null) {
    const { apiBaseUrl: resolvedApiBaseUrl, payload: responsePayload } = await postJsonWithFallback("/api/analysis/neighbourhood-watch", payload, apiBaseUrl);
    return {
        apiBaseUrl: resolvedApiBaseUrl,
        result: responsePayload.result,
        persistedCount: responsePayload.persistedCount || 0
    };
}

export async function fetchBackendRegionScan(payload, apiBaseUrl = null) {
    const { apiBaseUrl: resolvedApiBaseUrl, payload: responsePayload } = await postJsonWithFallback("/api/analysis/region-scan", payload, apiBaseUrl);
    return {
        apiBaseUrl: resolvedApiBaseUrl,
        result: responsePayload.result,
        persistedCount: responsePayload.persistedCount || 0
    };
}

export async function fetchBackendBlindSpot(payload, apiBaseUrl = null) {
    const { apiBaseUrl: resolvedApiBaseUrl, payload: responsePayload } = await postJsonWithFallback("/api/analysis/blind-spot", payload, apiBaseUrl);
    return {
        apiBaseUrl: resolvedApiBaseUrl,
        result: responsePayload.result,
        persistedCount: responsePayload.persistedCount || 0
    };
}

export async function fetchBackendManoeuvreDetection(payload = {}, apiBaseUrl = null) {
    try {
        const { apiBaseUrl: resolvedApiBaseUrl, payload: responsePayload } = await postJsonWithFallback("/api/analysis/manoeuvre-detection", payload, apiBaseUrl);
        return {
            apiBaseUrl: resolvedApiBaseUrl,
            result: responsePayload.result,
            persistedCount: responsePayload.persistedCount || 0
        };
    } catch (error) {
        const message = error?.message || "Manoeuvre detection failed";
        const err = new Error(message);
        err.originalError = error;
        throw err;
    }
}
