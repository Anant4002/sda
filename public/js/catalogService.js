import {
    API_BASE_URL_CANDIDATES,
    SATELLITE_CACHE_KEY,
    SATELLITE_CACHE_TTL_MS
} from "./config.js";
import { fetchJsonWithFallback, postJsonWithFallback } from "./apiService.js";
import { isValidSatelliteRecord } from "./utils.js";

export function readCachedCatalog() {
    try {
        const rawValue = window.localStorage.getItem(SATELLITE_CACHE_KEY);
        if (!rawValue) {
            return null;
        }

        const cachedValue = JSON.parse(rawValue);
        const isFresh = cachedValue && Array.isArray(cachedValue.satellites) && Date.now() - cachedValue.cachedAt < SATELLITE_CACHE_TTL_MS;
        return isFresh ? cachedValue : null;
    } catch (error) {
        console.warn("Unable to read cached satellite catalog.", error);
        return null;
    }
}

export function writeCachedCatalog(satellites, apiBaseUrl) {
    try {
        const compressed = satellites.map(s => ({
            name: s.name,
            line1: s.line1,
            line2: s.line2,
            noradId: s.noradId,
            isIndian: s.isIndian,
            firstAddedAt: s.firstAddedAt,
            characterisation: s.characterisation ? {
                orbitClass: s.characterisation.orbitClass,
                objectType: s.characterisation.objectType,
                operationalStatus: s.characterisation.operationalStatus,
                ownership: s.characterisation.ownership
            } : undefined
        }));

        window.localStorage.setItem(SATELLITE_CACHE_KEY, JSON.stringify({
            apiBaseUrl,
            cachedAt: Date.now(),
            satellites: compressed
        }));
    } catch (error) {
        if (error.name === "QuotaExceededError") {
            console.warn("Satellite catalog is too large for browser cache. Persistence disabled for this session.");
        } else {
            console.warn("Unable to cache satellite catalog.", error);
        }
    }
}

export async function fetchSatelliteCatalog(preferredApiBaseUrl = null) {
    let lastError = null;
    const baseUrls = preferredApiBaseUrl
        ? [preferredApiBaseUrl, ...API_BASE_URL_CANDIDATES.filter((candidate) => candidate !== preferredApiBaseUrl)]
        : API_BASE_URL_CANDIDATES;

    for (const apiBaseUrl of baseUrls) {
        try {
            const response = await fetch(`${apiBaseUrl}/api/satellites`);
            if (!response.ok) {
                throw new Error(`HTTP Error: ${response.status}`);
            }

            const satellites = await response.json();
            if (!Array.isArray(satellites)) {
                throw new Error("Satellite payload is not an array.");
            }

            return {
                apiBaseUrl,
                satellites: satellites.filter(isValidSatelliteRecord),
                fetchedAt: Date.now()
            };
        } catch (error) {
            lastError = error;
        }
    }

    throw lastError || new Error("No API base URL responded.");
}

export async function fetchCatalogStatus(apiBaseUrl = null) {
    const { apiBaseUrl: resolvedApiBaseUrl, payload } = await fetchJsonWithFallback("/api/catalog/status", apiBaseUrl);
    return {
        apiBaseUrl: resolvedApiBaseUrl,
        status: payload
    };
}

export async function fetchCatalogHistory(apiBaseUrl = null, limit = 5) {
    const query = Number.isFinite(limit) ? `?limit=${Math.max(1, Math.min(10, Math.floor(limit)))}` : "";
    const { apiBaseUrl: resolvedApiBaseUrl, payload } = await fetchJsonWithFallback(`/api/catalog/history${query}`, apiBaseUrl);
    return {
        apiBaseUrl: resolvedApiBaseUrl,
        history: Array.isArray(payload) ? payload : []
    };
}

export async function fetchTleHistory(satelliteId, apiBaseUrl = null, limit = 100) {
    const query = Number.isFinite(limit) ? `?limit=${limit}` : "";
    const { apiBaseUrl: resolvedApiBaseUrl, payload } = await fetchJsonWithFallback(`/api/satellites/${encodeURIComponent(satelliteId)}/tle-history${query}`, apiBaseUrl);
    return {
        apiBaseUrl: resolvedApiBaseUrl,
        history: Array.isArray(payload) ? payload : []
    };
}

export async function fetchManoeuvreHistory(satelliteId, apiBaseUrl = null, limit = 500) {
    const query = Number.isFinite(limit) ? `?limit=${limit}` : "";
    const { apiBaseUrl: resolvedApiBaseUrl, payload } = await fetchJsonWithFallback(`/api/satellites/${encodeURIComponent(satelliteId)}/manoeuvre-history${query}`, apiBaseUrl);
    return {
        apiBaseUrl: resolvedApiBaseUrl,
        analysis: payload
    };
}

export async function fetchDriftHistory(satelliteId, days = 5, startTime = null, apiBaseUrl = null) {
    const timeParam = startTime ? `&startTime=${encodeURIComponent(startTime)}` : "";
    const { apiBaseUrl: resolvedApiBaseUrl, payload } = await fetchJsonWithFallback(`/api/satellites/${encodeURIComponent(satelliteId)}/drift-history?days=${days}${timeParam}`, apiBaseUrl);
    return {
        apiBaseUrl: resolvedApiBaseUrl,
        drift: payload
    };
}

export async function runBatchCharacterisation(apiBaseUrl = null) {
    const { payload } = await postJsonWithFallback("/api/satellites/recharacterise", {}, apiBaseUrl);
    return payload;
}

export async function updateIntData(satelliteId, intData, apiBaseUrl = null) {
    const { payload } = await postJsonWithFallback(`/api/satellites/${encodeURIComponent(satelliteId)}/int-data`, { intData }, apiBaseUrl);
    return { payload };
}
