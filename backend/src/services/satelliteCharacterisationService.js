/**
 * Satellite Characterisation Service (Phase-1 Upgrade)
 *
 * Extends basic orbit/ownership classification with:
 *   - Drag-based proxy classification (from BSTAR term in TLE Line 1)
 *   - Threat tier assessment (derived from orbit/mission/ownership risk factors)
 *   - Spectral orbital pattern recognition (sun-synchronous, polar, GEO, MEO, LEO EO)
 *   - Pattern-of-life assessment from TLE revision history
 *
 * Note: BSTAR is a drag-related ballistic coefficient proxy — it does not
 * directly translate to physical size or mass. Results are labelled accordingly.
 */

'use strict';

const { parseTleLine2OrbitalMetrics } = require('./orbitalPropagationService');
const { estimateOrbitalAltitudes } = require('./tleRevisionHistoryService');
const { isIndianSatelliteName } = require('./satelliteOwnershipService');

const EARTH_RADIUS_KM = 6371.0;

// Spectral pattern types
const SPECTRAL_TYPES = {
    SUN_SYNCHRONOUS: 'SUN_SYNCHRONOUS',
    POLAR_ISR: 'POLAR_ISR',
    GEO_COMMS: 'GEO_COMMS',
    MEO_NAVIGATION: 'MEO_NAVIGATION',
    LEO_EARTH_OBSERVATION: 'LEO_EARTH_OBSERVATION',
    HEO_SPECIAL: 'HEO_SPECIAL',
    UNKNOWN: 'UNKNOWN'
};

// Drag-based proxy (BSTAR)

/**
 * Parse the BSTAR drag term from TLE Line 1.
 * TLE Line 1 characters 54–61 encode BSTAR in the form ±NNNNN±N
 * (signed 5-digit mantissa with implicit decimal, and 1-digit exponent).
 *
 * @param {string} line1
 * @returns {number|null}  BSTAR in units of 1/Earth_radii (or null if unparseable)
 */
function parseBstar(line1) {
    try {
        if (!line1 || line1.length < 61) return null;
        const raw = line1.substring(53, 61).trim();
        // Format: ±NNNNN±N  e.g. " 00000-0" or "-11606-4"
        const match = raw.match(/^([+-]?\d{5})([+-]\d)$/);
        if (!match) return null;
        const mantissa = parseFloat(match[1]) * 1e-5;
        const exponent = parseInt(match[2], 10);
        return mantissa * Math.pow(10, exponent);
    } catch {
        return null;
    }
}

/**
 * Classify the drag profile from the BSTAR value.
 * Lower BSTAR → larger area-to-mass ratio → higher drag.
 * Note: this is an atmospheric drag proxy, not a physical size estimate.
 *
 * @param {number|null} bstar
 * @returns {{ dragClass: string, dragConfidence: number, bstarCoeff: number|null }}
 */
function classifyDragProxy(bstar) {
    if (bstar === null || !Number.isFinite(bstar)) {
        return { dragClass: 'UNKNOWN_DRAG', dragConfidence: 0, bstarCoeff: null };
    }

    const absBstar = Math.abs(bstar);

    // Thresholds are approximate — debris and rocket bodies tend to have higher BSTAR
    if (absBstar < 1e-5) {
        return { dragClass: 'LOW_DRAG', dragConfidence: 0.75, bstarCoeff: bstar };
    } else if (absBstar < 1e-3) {
        return { dragClass: 'MEDIUM_DRAG', dragConfidence: 0.70, bstarCoeff: bstar };
    } else {
        return { dragClass: 'HIGH_DRAG', dragConfidence: 0.65, bstarCoeff: bstar };
    }
}

// Threat tier assessment

/**
 * Adversary name pattern pool — used to flag elevated ownership risk.
 * These are observable public designations for objects from nations
 * operating in contested orbital domains. This is not a geopolitical judgement;
 * it reflects the publicly-listed catalog designations in NORAD/CelesTrak data.
 */
const ADVERSARY_PATTERNS = [
    'YAOGAN', 'GAOFEN', 'SHIYAN', 'SJ-', 'SHIJIAN',
    'COSMOS', 'KOBALT', 'PERSONA', 'BARS-M',
    'TOPOL', 'NUDOL', 'ROKOT', 'STRELA'
];

/**
 * Assess the threat tier for a satellite.
 * TIER_1 = highest protection priority (Indian assets)
 * TIER_5 = highest monitoring priority (known adversary patterns)
 *
 * @param {{ ownership: string, objectType: string, orbitClass: string,
 *           inclinationDeg: number, perigeeKm: number, apogeeKm: number }} params
 * @param {string} name
 * @returns {{ threatTier: string, tierRationale: string }}
 */
function assessThreatTier({ ownership, objectType, orbitClass, inclinationDeg, perigeeKm, apogeeKm }, name) {
    const safeName = (name || '').toUpperCase();

    // TIER_1: Indian-owned assets — highest protection
    if (ownership === 'Indian') {
        return { threatTier: 'TIER_1', tierRationale: 'Indigenous Indian asset — protected under national space policy.' };
    }

    // TIER_5: Observable adversary pattern in catalog name
    const isAdversaryPattern = ADVERSARY_PATTERNS.some(p => safeName.includes(p));
    if (isAdversaryPattern) {
        return { threatTier: 'TIER_5', tierRationale: 'Catalog name matches known adversary satellite designations — elevated monitoring priority.' };
    }

    // TIER_2: Friendly/allied — well-known partner constellations
    const FRIENDLY_PATTERNS = ['GPS', 'NAVSTAR', 'SENTINEL', 'NOAA', 'GOES', 'LANDSAT', 'TERRA', 'AQUA', 'AURA'];
    const isFriendlyPattern = FRIENDLY_PATTERNS.some(p => safeName.includes(p));
    if (isFriendlyPattern) {
        return { threatTier: 'TIER_2', tierRationale: 'Catalog name consistent with known friendly partner constellation.' };
    }

    // TIER_4: Untracked / uncorrelated / debris
    if (objectType === 'Debris' || objectType === 'Rocket Body') {
        return { threatTier: 'TIER_4', tierRationale: 'Uncontrolled debris or spent rocket body — passive collision risk.' };
    }

    // TIER_3: Commercial neutral — default for unclassified payloads
    return { threatTier: 'TIER_3', tierRationale: 'Commercial or unclassified payload — routine monitoring.' };
}

// Spectral orbital pattern recognition

/**
 * Recognise the orbital behavioural pattern from orbital mechanics.
 *
 * @param {{ inclinationDeg: number, meanMotionRevPerDay: number, eccentricity: number,
 *           perigeeKm: number, apogeeKm: number, meanAlt: number }} metrics
 * @returns {{ spectralType: string, spectralRationale: string }}
 */
function recogniseSpectralType({ inclinationDeg, meanMotionRevPerDay, eccentricity, perigeeKm, apogeeKm, meanAlt }) {
    const inc = inclinationDeg;
    const mm = meanMotionRevPerDay;
    const ecc = eccentricity;

    // GEO: near-geostationary
    if (mm >= 0.9 && mm <= 1.1 && inc < 15 && ecc < 0.01) {
        return { spectralType: SPECTRAL_TYPES.GEO_COMMS, spectralRationale: 'Near-geostationary orbit — consistent with communications/broadcast payload.' };
    }

    // MEO Navigation: medium altitude, ~2 rev/day, moderate inclination
    if (meanAlt >= 19000 && meanAlt <= 24000 && mm >= 1.8 && mm <= 2.2) {
        return { spectralType: SPECTRAL_TYPES.MEO_NAVIGATION, spectralRationale: 'Medium Earth orbit, ~12h period — consistent with navigation constellation (GPS/GLONASS/NavIC).' };
    }

    // HEO special
    if (ecc > 0.25) {
        return { spectralType: SPECTRAL_TYPES.HEO_SPECIAL, spectralRationale: 'High eccentricity orbit — consistent with Molniya/Tundra type or highly elliptical mission.' };
    }

    // Sun-synchronous: retrograde LEO with inclination ~97–99° for 400–900 km
    if (meanAlt >= 400 && meanAlt <= 900 && inc >= 96 && inc <= 100) {
        return { spectralType: SPECTRAL_TYPES.SUN_SYNCHRONOUS, spectralRationale: 'Sun-synchronous LEO — consistent with Earth observation, remote sensing, or reconnaissance.' };
    }

    // Polar ISR: high inclination LEO
    if (meanAlt < 2000 && inc >= 85 && inc <= 110 && !(inc >= 96 && inc <= 100)) {
        return { spectralType: SPECTRAL_TYPES.POLAR_ISR, spectralRationale: 'Polar LEO — consistent with ISR, SIGINT, or broad-area Earth surveillance.' };
    }

    // General LEO Earth observation
    if (meanAlt < 2000) {
        return { spectralType: SPECTRAL_TYPES.LEO_EARTH_OBSERVATION, spectralRationale: 'Low Earth orbit — consistent with Earth observation, science, or commercial payload.' };
    }

    return { spectralType: SPECTRAL_TYPES.UNKNOWN, spectralRationale: 'Orbital pattern not matched to a known type.' };
}

// Pattern-of-life assessment

/**
 * Assess orbital stability from TLE revision history.
 * High variance in key orbital elements indicates manoeuvring.
 *
 * @param {object[]} tleRevisions  - Array of TLE revision records from satellite_tle_revisions
 * @returns {{ stabilityScore: number, maneuverLikelihood: number, label: string }}
 */
function assessPatternOfLife(tleRevisions) {
    if (!Array.isArray(tleRevisions) || tleRevisions.length < 2) {
        return { stabilityScore: 0.5, maneuverLikelihood: 0.5, label: 'INSUFFICIENT_DATA' };
    }

    // Compute variance in mean motion, inclination, and eccentricity
    function variance(arr) {
        if (!arr.length) return 0;
        const mean = arr.reduce((a, b) => a + b, 0) / arr.length;
        return arr.reduce((a, b) => a + (b - mean) ** 2, 0) / arr.length;
    }

    const meanMotions = tleRevisions.map(r => r.mean_motion_rev_per_day).filter(Number.isFinite);
    const inclinations = tleRevisions.map(r => r.inclination_deg).filter(Number.isFinite);
    const eccentricities = tleRevisions.map(r => r.eccentricity).filter(Number.isFinite);
    const smAs = tleRevisions.map(r => r.semi_major_axis_km).filter(Number.isFinite);

    const mmVar = variance(meanMotions);
    const incVar = variance(inclinations);
    const smAVar = variance(smAs);

    // Normalised deviation scores
    const mmScore = Math.min(1, mmVar / 0.001);       // threshold ~0.001 rev/day² variance
    const incScore = Math.min(1, incVar / 0.01);      // threshold ~0.01 deg² variance
    const smAScore = Math.min(1, smAVar / 100);       // threshold ~10 km² SMA variance

    const maneuverLikelihood = (mmScore * 0.4 + incScore * 0.3 + smAScore * 0.3);
    const stabilityScore = 1 - maneuverLikelihood;

    let label;
    if (maneuverLikelihood < 0.2) {
        label = 'STABLE';
    } else if (maneuverLikelihood < 0.6) {
        label = 'ACTIVE';
    } else {
        label = 'HIGHLY_MANEUVERING';
    }

    return {
        stabilityScore: Math.round(stabilityScore * 100) / 100,
        maneuverLikelihood: Math.round(maneuverLikelihood * 100) / 100,
        label,
        revisionsAnalysed: tleRevisions.length
    };
}

// Existing functions (preserved, backward-compatible)

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
        period: (24 * 60) / metrics.meanMotionRevPerDay
    };
}

function compareOrbits(state1, state2) {
    if (!state1 || !state2) return false;

    const THRESHOLDS = {
        inclination: 0.5,
        meanMotion: 0.1,
        perigee: 50,
        apogee: 50
    };

    return (
        Math.abs(state1.inclination - state2.inclination) <= THRESHOLDS.inclination &&
        Math.abs(state1.meanMotion - state2.meanMotion) <= THRESHOLDS.meanMotion &&
        Math.abs(state1.perigee - state2.perigee) <= THRESHOLDS.perigee &&
        Math.abs(state1.apogee - state2.apogee) <= THRESHOLDS.apogee
    );
}

/**
 * Full characterisation — original contract preserved, new fields added.
 *
 * @param {string} name
 * @param {string} line1
 * @param {string} line2
 * @param {object[]} [tleRevisions]  - Optional: for pattern-of-life
 * @returns {object}
 */
function characteriseSatellite(name, line1, line2, tleRevisions = []) {
    const metrics = parseTleLine2OrbitalMetrics(line2);

    // --- Ownership ---
    const ownership = isIndianSatelliteName(name) ? 'Indian' : 'Non-Indian';

    // --- Object Type ---
    let objectType = 'Payload';
    const safeName = (name || '').toUpperCase();
    if (/\[DEB\]| DEB| DEBRIS/i.test(safeName)) {
        objectType = 'Debris';
    } else if (/ R\/B| ROCKET BODY/i.test(safeName)) {
        objectType = 'Rocket Body';
    }

    // --- BSTAR / Drag proxy ---
    const bstar = parseBstar(line1);
    const { dragClass, dragConfidence, bstarCoeff } = classifyDragProxy(bstar);

    if (!metrics) {
        return {
            // Original fields
            orbitClass: 'Unknown',
            objectType,
            operationalStatus: 'Unknown',
            ownership,
            // New fields
            estimatedDragClass: dragClass,
            dragConfidence,
            bstarCoeff,
            threatTier: assessThreatTier({ ownership, objectType, orbitClass: 'Unknown', inclinationDeg: null, perigeeKm: null, apogeeKm: null }, name).threatTier,
            tierRationale: assessThreatTier({ ownership, objectType, orbitClass: 'Unknown' }, name).tierRationale,
            spectralType: SPECTRAL_TYPES.UNKNOWN,
            spectralRationale: 'Orbital elements unavailable.',
            patternOfLifeScore: null,
            patternOfLifeLabel: 'INSUFFICIENT_DATA',
            calculatedAt: new Date().toISOString()
        };
    }

    const { perigeeKm, apogeeKm } = estimateOrbitalAltitudes(metrics.meanMotionRevPerDay, metrics.eccentricity);
    const meanAlt = (perigeeKm + apogeeKm) / 2;

    // --- Orbit Class ---
    let orbitClass = 'MEO';
    if (!Number.isFinite(meanAlt)) {
        orbitClass = 'Unknown';
    } else if (metrics.eccentricity > 0.25) {
        orbitClass = 'HEO';
    } else if (meanAlt < 2000) {
        orbitClass = 'LEO';
    } else if (
        metrics.meanMotionRevPerDay >= 0.9 &&
        metrics.meanMotionRevPerDay <= 1.1 &&
        metrics.inclinationDeg < 15 &&
        metrics.eccentricity < 0.01
    ) {
        orbitClass = 'GEO';
    }

    // --- Operational Status ---
    let operationalStatus = 'Active';
    if (Number.isFinite(perigeeKm) && perigeeKm < 150) {
        operationalStatus = 'Decaying';
    } else {
        try {
            const epochYear = line1.substring(18, 20);
            const epochDays = line1.substring(20, 32);
            const year = parseInt(epochYear, 10);
            const fullYear = year < 57 ? 2000 + year : 1900 + year;
            const epochDate = new Date(Date.UTC(fullYear, 0, 1));
            epochDate.setUTCDate(epochDate.getUTCDate() + parseFloat(epochDays) - 1);
            const diffDays = (Date.now() - epochDate.getTime()) / (1000 * 60 * 60 * 24);
            if (diffDays > 14) operationalStatus = 'Stale';
        } catch {
            // ignore
        }
    }

    // --- Threat Tier ---
    const { threatTier, tierRationale } = assessThreatTier(
        { ownership, objectType, orbitClass, inclinationDeg: metrics.inclinationDeg, perigeeKm, apogeeKm },
        name
    );

    // --- Spectral Type ---
    const { spectralType, spectralRationale } = recogniseSpectralType({
        inclinationDeg: metrics.inclinationDeg,
        meanMotionRevPerDay: metrics.meanMotionRevPerDay,
        eccentricity: metrics.eccentricity,
        perigeeKm,
        apogeeKm,
        meanAlt
    });

    // --- Pattern of Life ---
    const { stabilityScore, maneuverLikelihood, label: patternOfLifeLabel, revisionsAnalysed } = assessPatternOfLife(tleRevisions);

    return {
        // Original fields (unchanged)
        orbitClass,
        objectType,
        operationalStatus,
        ownership,
        perigeeKm: Number.isFinite(perigeeKm) ? Math.round(perigeeKm) : null,
        apogeeKm: Number.isFinite(apogeeKm) ? Math.round(apogeeKm) : null,
        inclinationDeg: metrics.inclinationDeg,
        // New Phase-1 fields
        estimatedDragClass: dragClass,
        dragConfidence,
        bstarCoeff,
        threatTier,
        tierRationale,
        spectralType,
        spectralRationale,
        patternOfLifeScore: stabilityScore,
        patternOfLifeLabel,
        maneuverLikelihood,
        revisionsAnalysed,
        calculatedAt: new Date().toISOString()
    };
}

module.exports = {
    characteriseSatellite,
    getOrbitalState,
    compareOrbits,
    // Exported individually for testing / external use
    parseBstar,
    classifyDragProxy,
    assessThreatTier,
    recogniseSpectralType,
    assessPatternOfLife,
    SPECTRAL_TYPES
};
