const satelliteService = require("./orbitalPropagationService");

/**
 * Deterministic sensor tasking recommendations (POC)
 * - Choose nearest sensor(s) by surface distance to predicted subsatellite point
 * - Find next visible pass within the next 6 orbital periods by propagating the satrec
 * - Return recommendedTime, estimatedPassDuration, predictedPassCentroid, confidence (0..1), and priority
 */
function getSensorTaskingRecommendations(satellite) {
    if (!satellite || !satellite.line1 || !satellite.line2) return [];

    // Simple simulated sensors (can be replaced by real inventory later)
    const sensors = [
        { id: "S1", name: "Mount Abu Electro-Optical", type: "Optical", lat: 24.5, lon: 72.7 },
        { id: "S2", name: "Bengaluru Radar", type: "Radar", lat: 13.0, lon: 77.6 },
        { id: "S3", name: "Guwahati Tracking Station", type: "RF", lat: 26.1, lon: 91.7 }
    ];

    try {
        const record = satelliteService.createPropagationRecord(satellite);
        if (!record) return [];

        const now = new Date();
        const orbitMinutes = satelliteService.getOrbitMinutes(record);
        const searchWindowMinutes = Math.max(orbitMinutes * 6, 120); // up to 6 orbits, at least 2 hours
        const windowEnd = new Date(now.getTime() + searchWindowMinutes * 60 * 1000);

        const recommendations = [];

        for (const sensor of sensors) {
            // Propagate and look for next time elevation > VISIBILITY_ELEVATION_DEG for this observer
            const observer = {
                longitude: satelliteService.toRadians(sensor.lon),
                latitude: satelliteService.toRadians(sensor.lat),
                height: 0
            };

            let passStart = null;
            let passEnd = null;
            let maxElevation = -Infinity;

            // sample every 30 seconds for coarse pass detection
            const stepMs = 30 * 1000;
            for (let t = now.getTime(); t <= windowEnd.getTime(); t += stepMs) {
                const time = new Date(t);
                const state = satelliteService.propagateState(record, time, observer);
                if (!state) continue;

                if (state.elevationDeg > satelliteService.VISIBILITY_ELEVATION_DEG) {
                    if (!passStart) passStart = time;
                    passEnd = time;
                    if (state.elevationDeg > maxElevation) maxElevation = state.elevationDeg;
                } else {
                    // closed a pass block
                    if (passStart && passEnd) break; // we only want the next pass
                }
            }

            if (passStart && passEnd) {
                const durationSec = Math.round((passEnd.getTime() - passStart.getTime()) / 1000) || 10;

                // centroid of pass: midpoint time
                const midpoint = new Date((passStart.getTime() + passEnd.getTime()) / 2);
                const midpointState = satelliteService.propagateState(record, midpoint, null);

                const predictedPassCentroid = midpointState ? { lat: midpointState.lat, lon: midpointState.lon } : null;

                // confidence heuristic: based on maxElevation (higher -> better) and pass duration
                const elevScore = Math.max(0, Math.min(1, (maxElevation - 10) / 50)); // 10..60deg -> 0..1
                const durScore = Math.max(0, Math.min(1, durationSec / 180)); // up to 3min
                const confidence = Math.max(0.2, Math.min(0.99, (0.6 * elevScore + 0.4 * durScore)));

                recommendations.push({
                    sensorId: sensor.id,
                    sensorName: sensor.name,
                    sensorType: sensor.type,
                    recommendedTime: midpoint.toISOString(),
                    passStart: passStart.toISOString(),
                    passEnd: passEnd.toISOString(),
                    estimatedPassDurationSec: durationSec,
                    predictedPassCentroid,
                    maxElevationDeg: Math.round(maxElevation * 10) / 10,
                    confidence,
                    priority: confidence > 0.7 ? "High" : (confidence > 0.4 ? "Medium" : "Low")
                });
            }
        }

        // sort by priority: High -> earliest recommendedTime
        recommendations.sort((a, b) => {
            const pri = { High: 3, Medium: 2, Low: 1 };
            if (pri[b.priority] !== pri[a.priority]) return pri[b.priority] - pri[a.priority];
            return new Date(a.recommendedTime) - new Date(b.recommendedTime);
        });

        return recommendations.slice(0, 3);
    } catch (e) {
        console.warn("Sensor tasking failed:", e);
        return [];
    }
}

module.exports = {
    getSensorTaskingRecommendations
};
