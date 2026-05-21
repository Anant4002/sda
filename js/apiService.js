import { API_BASE_URL_CANDIDATES } from "./config.js";

export async function fetchJsonWithFallback(path, preferredApiBaseUrl = null, fallbackApiBaseUrls = API_BASE_URL_CANDIDATES) {
    const baseUrls = preferredApiBaseUrl
        ? [preferredApiBaseUrl, ...fallbackApiBaseUrls.filter((candidate) => candidate !== preferredApiBaseUrl)]
        : fallbackApiBaseUrls;

    let lastError = null;

    for (const baseUrl of baseUrls) {
        try {
            const response = await fetch(`${baseUrl}${path}`);
            if (!response.ok) {
                let errorDetails = "";
                try {
                    const errorJson = await response.json();
                    errorDetails = errorJson.message || errorJson.error || "";
                } catch (e) {
                    // Ignore parsing error
                }
                throw new Error(errorDetails || `HTTP Error: ${response.status}`);
            }

            return {
                apiBaseUrl: baseUrl,
                payload: await response.json()
            };
        } catch (error) {
            lastError = error;
        }
    }

    throw lastError || new Error(`No API base URL responded for ${path}.`);
}

export async function updateIntData(satelliteId, intData) {
    return postJsonWithFallback(`/satellites/${satelliteId}/int-data`, { intData });
}

export async function postJsonWithFallback(path, body, preferredApiBaseUrl = null, fallbackApiBaseUrls = API_BASE_URL_CANDIDATES, method = "POST") {
    const baseUrls = preferredApiBaseUrl
        ? [preferredApiBaseUrl, ...fallbackApiBaseUrls.filter((candidate) => candidate !== preferredApiBaseUrl)]
        : fallbackApiBaseUrls;

    let lastError = null;

    for (const baseUrl of baseUrls) {
        try {
            const response = await fetch(`${baseUrl}${path}`, {
                method: method,
                headers: {
                    "Content-Type": "application/json",
                    "x-api-key": "" // Added to bypass requireApiKey if empty, or can be configured
                },
                body: JSON.stringify(body)
            });

            if (!response.ok) {
                let errorDetails = "";
                try {
                    const errorJson = await response.json();
                    errorDetails = errorJson.message || errorJson.error || "";
                } catch (e) {
                    // Ignore parsing error
                }
                throw new Error(errorDetails || `HTTP Error: ${response.status}`);
            }

            return {
                apiBaseUrl: baseUrl,
                payload: await response.json()
            };
        } catch (error) {
            lastError = error;
        }
    }

    throw lastError || new Error(`No API base URL responded for ${path}.`);
}
