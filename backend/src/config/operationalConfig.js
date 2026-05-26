/**
 * Centralized Operational Configuration Layer
 */

const operationalConfig = {
    // Analysis Constraints
    analysisStepSeconds: Number(process.env.ANALYSIS_STEP_SECONDS || 1800),
    pathSampleSeconds: Number(process.env.PATH_SAMPLE_SECONDS || 180),
    conjunctionSampleSeconds: Number(process.env.CONJUNCTION_SAMPLE_SECONDS || 45),
    analysisTimeoutMs: Number(process.env.ANALYSIS_TIMEOUT_MS || 120000),
    
    // Limits
    maxConjunctionCandidates: Number(process.env.MAX_CONJUNCTION_CANDIDATES || 100),
    maxNeighbourhoodResults: Number(process.env.MAX_NEIGHBOURHOOD_RESULTS || 50),
    
    // Default Thresholds
    defaultConjunctionDistanceKm: Number(process.env.DEFAULT_CONJUNCTION_DISTANCE_KM || 25),
    neighbourhoodWatchThresholdKm: Number(process.env.NEIGHBOURHOOD_WATCH_THRESHOLD_KM || 500),
    neighbourhoodWatchWarningKm: Number(process.env.NEIGHBOURHOOD_WATCH_WARNING_KM || 250),
    neighbourhoodWatchCriticalKm: Number(process.env.NEIGHBOURHOOD_WATCH_CRITICAL_KM || 100),
    visibilityElevationDeg: Number(process.env.VISIBILITY_ELEVATION_DEG || 10),
    
    // Regional Default Window
    defaultRegionMinAltitudeKm: Number(process.env.DEFAULT_REGION_MIN_ALTITUDE_KM || 0),
    defaultRegionMaxAltitudeKm: Number(process.env.DEFAULT_REGION_MAX_ALTITUDE_KM || 42000),
    defaultRegionProximityThresholdKm: Number(process.env.DEFAULT_REGION_PROXIMITY_THRESHOLD_KM || 25),

    // Colours (for payloads that include visualization cues)
    otherSatellitePathColor: "#b08d36", // Darker Muted Yellow/Gold
    indianSatellitePathColor: "#c03d7a" // Darker Pink/Magenta
};

module.exports = { operationalConfig };
