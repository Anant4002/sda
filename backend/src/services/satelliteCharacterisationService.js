const { parseTleLine2OrbitalMetrics } = require("./orbitalPropagationService");
const { estimateOrbitalAltitudes } = require("./tleRevisionHistoryService");
const { isIndianSatelliteName } = require("./satelliteOwnershipService");

const EARTH_RADIUS_KM = 6371.0;

/**
 * Extract comparable orbital state from TLE Line 2
 */
function getOrbitalState(line2) {
    const metrics = parseTleLine2OrbitalMetrics(line2);
    if (!metrics) return null;

    const { perigeeKm, apogeeKm } = estimateOrbitalAltitudes(metrics.meanMotionRevPerDay, metrics.eccentricity);
    
    return {
        inclination: metrics.inclinationDeg,
        meanMotion: metrics.meanMotionRevPerDay,
        eccentricity: metrics.eccentricity,
        perigee: perigeeKm,
        apogee: apogeeKm,
        period: (24 * 60) / metrics.meanMotionRevPerDay // minutes
    };
}

/**
 * Compare two orbital states for correlation.
 * Returns true if they are within thresholds.
 */
function compareOrbits(state1, state2) {
    if (!state1 || !state2) return false;

    // Thresholds for correlation (POC level)
    const THRESHOLDS = {
        inclination: 0.5,      // degrees
        meanMotion: 0.1,       // revs/day
        perigee: 50,           // km
        apogee: 50             // km
    };

    const diffInclination = Math.abs(state1.inclination - state2.inclination);
    const diffMeanMotion = Math.abs(state1.meanMotion - state2.meanMotion);
    const diffPerigee = Math.abs(state1.perigee - state2.perigee);
    const diffApogee = Math.abs(state1.apogee - state2.apogee);

    return (
        diffInclination <= THRESHOLDS.inclination &&
        diffMeanMotion <= THRESHOLDS.meanMotion &&
        diffPerigee <= THRESHOLDS.perigee &&
        diffApogee <= THRESHOLDS.apogee
    );
}

/**
 * Deterministically classify a satellite based on its TLE and name.
 */
function characteriseSatellite(name, line1, line2) {
    const metrics = parseTleLine2OrbitalMetrics(line2);
    
    // Ownership
    const ownership = isIndianSatelliteName(name) ? "Indian" : "Non-Indian";

    // Object Type
    let objectType = "Payload";
    const safeName = (name || "").toUpperCase();
    if (/\[DEB\]| DEB| DEBRIS/i.test(safeName)) {
        objectType = "Debris";
    } else if (/ R\/B| ROCKET BODY/i.test(safeName)) {
        objectType = "Rocket Body";
    }

    if (!metrics) {
        return {
            orbitClass: "Unknown",
            objectType,
            operationalStatus: "Unknown",
            ownership,
            calculatedAt: new Date().toISOString()
        };
    }

    const { perigeeKm, apogeeKm } = estimateOrbitalAltitudes(metrics.meanMotionRevPerDay, metrics.eccentricity);
    const meanAlt = (perigeeKm + apogeeKm) / 2;

    // Orbit Class
    let orbitClass = "MEO";
    if (!Number.isFinite(meanAlt)) {
        orbitClass = "Unknown";
    } else if (metrics.eccentricity > 0.25) {
        orbitClass = "HEO";
    } else if (meanAlt < 2000) {
        orbitClass = "LEO";
    } else if (metrics.meanMotionRevPerDay >= 0.9 && metrics.meanMotionRevPerDay <= 1.1 && metrics.inclinationDeg < 15 && metrics.eccentricity < 0.01) {
        orbitClass = "GEO";
    }

    // Operational Status
    let operationalStatus = "Active";
    if (Number.isFinite(perigeeKm) && perigeeKm < 150) {
        operationalStatus = "Decaying";
    } else {
        // Check TLE age (Stale if older than 14 days)
        try {
            const epochYear = line1.substring(18, 20);
            const epochDays = line1.substring(20, 32);
            const year = parseInt(epochYear, 10);
            const fullYear = year < 57 ? 2000 + year : 1900 + year;
            const epochDate = new Date(Date.UTC(fullYear, 0, 1));
            epochDate.setUTCDate(epochDate.getUTCDate() + parseFloat(epochDays) - 1);
            
            const now = new Date();
            const diffDays = (now - epochDate) / (1000 * 60 * 60 * 24);
            if (diffDays > 14) {
                operationalStatus = "Stale";
            }
        } catch (e) {
            // Ignore date parsing errors
        }
    }

    return {
        orbitClass,
        objectType,
        operationalStatus,
        ownership,
        perigeeKm: Number.isFinite(perigeeKm) ? Math.round(perigeeKm) : null,
        apogeeKm: Number.isFinite(apogeeKm) ? Math.round(apogeeKm) : null,
        inclinationDeg: metrics.inclinationDeg,
        calculatedAt: new Date().toISOString()
    };
}

module.exports = {
    characteriseSatellite,
    getOrbitalState,
    compareOrbits
};
