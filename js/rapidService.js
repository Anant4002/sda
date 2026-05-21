import { fetchJsonWithFallback, postJsonWithFallback } from "./apiService.js";

export async function fetchLatestRapidExecution(apiBaseUrl = null) {
    const { payload } = await fetchJsonWithFallback("/api/rapid-processing/latest", apiBaseUrl);
    return payload;
}

export async function runRapidProcessingPipeline(apiBaseUrl = null) {
    const { payload } = await postJsonWithFallback("/api/rapid-processing/run", {}, apiBaseUrl);
    return payload;
}

export async function ingestRapidTrack(trackData, apiBaseUrl = null) {
    const { payload } = await postJsonWithFallback("/api/rapid-processing/ingest", trackData, apiBaseUrl);
    return payload;
}

export async function fetchRapidTracks(apiBaseUrl = null) {
    const { payload } = await fetchJsonWithFallback("/api/rapid-processing/tracks", apiBaseUrl);
    return payload;
}
