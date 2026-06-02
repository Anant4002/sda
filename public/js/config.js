export const COLORS = {
    otherSatellite: "#7cf29a",
    indianSatellite: "#ff9933",
    areaFill: "#6fe2ff",
    areaOutline: "#6fe2ff",
    indiaBoundary: "#420000"
};

export const INDIA_BOUNDARY_GEOJSON_URL = "data/india-boundary.geojson";
export const SATELLITE_CACHE_KEY = "satellite-catalog-cache-v1";
export const SATELLITE_CACHE_TTL_MS = 5 * 60 * 1000;
export const SATELLITE_POINT_BATCH_SIZE = 250;
export const POSITION_UPDATE_INTERVAL_MS = 50;
export const NEIGHBOURHOOD_WATCH_THRESHOLD_KM = 500;
export const NEIGHBOURHOOD_WATCH_WARNING_KM = 250;
export const NEIGHBOURHOOD_WATCH_CRITICAL_KM = 100;

const currentOrigin = window.location.origin;
const currentPort = window.location.port;

export const API_BASE_URL_CANDIDATES = window.location.protocol === "file:"
    ? ["http://127.0.0.1:3000", "http://localhost:3000"]
    : currentPort === "3000"
        ? [currentOrigin, "http://127.0.0.1:3000"]
        : ["http://127.0.0.1:3000", "http://localhost:3000"];

export const SATELLITE_FILTER_RESULT_LIMIT = 30;
