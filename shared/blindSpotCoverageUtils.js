(function attachBlindSpotCoverageUtils(root, factory) {
    const blindSpotCoverageUtils = factory();

    if (typeof module === "object" && module.exports) {
        module.exports = blindSpotCoverageUtils;
    }

    root.blindSpotCoverageUtils = blindSpotCoverageUtils;
}(typeof globalThis !== "undefined" ? globalThis : this, function createBlindSpotCoverageUtils() {
    const SENSOR_PROFILES = Object.freeze({
        opticalRecon: Object.freeze({
            key: "opticalRecon",
            label: "Optical Recon",
            maxOffNadirDeg: 30,
            minElevationDeg: 15,
            maxOperationalRangeKm: 1800,
            footprintFactor: 0.15,
            sensorQualityFactor: 0.9,
            isrCapable: true,
            coverageThreshold: 0.18,
            strongCoverageThreshold: 0.32
        }),
        sarRecon: Object.freeze({
            key: "sarRecon",
            label: "SAR Recon",
            maxOffNadirDeg: 45,
            minElevationDeg: 10,
            maxOperationalRangeKm: 2500,
            footprintFactor: 0.3,
            sensorQualityFactor: 0.95,
            isrCapable: true,
            coverageThreshold: 0.22,
            strongCoverageThreshold: 0.38
        }),
        geoComm: Object.freeze({
            key: "geoComm",
            label: "GEO / Comms",
            maxOffNadirDeg: 75,
            minElevationDeg: 5,
            maxOperationalRangeKm: 42000,
            footprintFactor: 1.0,
            sensorQualityFactor: 0.1,
            isrCapable: false,
            coverageThreshold: 0.25,
            strongCoverageThreshold: 0.45
        })
    });

    const PROFILE_RULES = [
        {
            key: "geoComm",
            regex: /^(?:GSAT|INSAT|IRNSS|NVS|TDRS|GOES|NOAA|EUTELSAT|INTELSAT|SES|ASIASAT|GALAXY|HORIZONS?|SKYNET|MILSTAR|AEHF|WGS|SATCOM|COMSAT|THURAYA|INMARSAT)/i
        },
        {
            key: "sarRecon",
            regex: /(?:RISAT|RADARSAT|ALOS|SAOCOM|NISAR|SKYMED|COSMO|TERRASAR|ICEYE|CAPELLA|ROSE-?L|RCM|SAR)/i
        },
        {
            key: "opticalRecon",
            regex: /(?:YAOGAN|GAOFEN|SHIJIAN|TIANHUI|ZHUHAI|CARTOSAT|WORLDVIEW|SKYSAT|PLEIADES|SPOT|PLANET|BLACKSKY|FLOCK|LANDSAT|RESOURCESAT|OCEANSAT|SCATSAT|HYSIS|EOS-|MICROSAT|EMISAT|EOS)/i
        }
    ];

    function clamp01(value) {
        if (!Number.isFinite(value)) {
            return 0;
        }
        return Math.max(0, Math.min(1, value));
    }

    function computeOffNadirDeg(elevationDeg, altKm) {
        if (!Number.isFinite(elevationDeg)) {
            return NaN;
        }
        if (!Number.isFinite(altKm) || altKm <= 0) {
            return 90 - elevationDeg;
        }
        const R_E = 6371; // Earth radius in km
        const sinOffNadir = (R_E / (R_E + altKm)) * Math.cos(elevationDeg * Math.PI / 180);
        const clampedSin = Math.max(-1, Math.min(1, sinOffNadir));
        return Math.asin(clampedSin) * 180 / Math.PI;
    }

    function getSwathRadiusKm(altitudeKm, maxOffNadirDeg) {
        if (!Number.isFinite(altitudeKm) || altitudeKm <= 0) {
            return 250;
        }
        const R_E = 6371; // Earth radius in km
        const etaRad = (maxOffNadirDeg * Math.PI) / 180;
        const sinTerm = ((R_E + altitudeKm) / R_E) * Math.sin(etaRad);
        
        if (sinTerm >= 1.0) {
            const thetaHorizon = Math.acos(R_E / (R_E + altitudeKm));
            return R_E * thetaHorizon;
        } else {
            const thetaRad = Math.asin(sinTerm) - etaRad;
            return R_E * thetaRad;
        }
    }

    function computeElevationFactor(elevationDeg, minElevationDeg) {
        if (!Number.isFinite(elevationDeg) || !Number.isFinite(minElevationDeg)) {
            return 0;
        }

        if (elevationDeg < minElevationDeg) {
            return 0;
        }

        const span = Math.max(1, 90 - minElevationDeg);
        return clamp01((elevationDeg - minElevationDeg) / span);
    }

    function computeOffNadirFactor(offNadirDeg, maxOffNadirDeg) {
        if (!Number.isFinite(offNadirDeg) || !Number.isFinite(maxOffNadirDeg) || maxOffNadirDeg <= 0) {
            return 0;
        }

        if (offNadirDeg > maxOffNadirDeg) {
            return 0;
        }

        return clamp01(1 - (offNadirDeg / maxOffNadirDeg));
    }

    function computeRangeFactor(rangeKm, maxOperationalRangeKm) {
        if (!Number.isFinite(rangeKm) || !Number.isFinite(maxOperationalRangeKm) || maxOperationalRangeKm <= 0) {
            return 0;
        }

        if (rangeKm > maxOperationalRangeKm) {
            return 0;
        }

        return clamp01(1 - (rangeKm / maxOperationalRangeKm));
    }

    function getProfileKey(recordOrName) {
        const explicitSensorType = typeof recordOrName === "object" && recordOrName
            ? String(recordOrName.sensorType || recordOrName.sensorProfile || recordOrName.profileKey || "").trim().toLowerCase()
            : "";

        if (explicitSensorType) {
            if (explicitSensorType === "geo" || explicitSensorType === "geocomm" || explicitSensorType === "geoComm".toLowerCase()) {
                return "geoComm";
            }
            if (explicitSensorType === "sar" || explicitSensorType === "sarrecon") {
                return "sarRecon";
            }
            if (explicitSensorType === "optical" || explicitSensorType === "opticalrecon") {
                return "opticalRecon";
            }
        }

        const name = typeof recordOrName === "string"
            ? recordOrName
            : String(recordOrName?.name || recordOrName?.id || "");

        for (const rule of PROFILE_RULES) {
            if (rule.regex.test(name)) {
                return rule.key;
            }
        }

        return "opticalRecon";
    }

    function resolveSensorProfile(recordOrName) {
        const key = getProfileKey(recordOrName);
        return SENSOR_PROFILES[key] || SENSOR_PROFILES.opticalRecon;
    }

    function getCoverageThreshold(profile) {
        return Number.isFinite(profile?.coverageThreshold) ? profile.coverageThreshold : SENSOR_PROFILES.opticalRecon.coverageThreshold;
    }

    function getStrongCoverageThreshold(profile) {
        return Number.isFinite(profile?.strongCoverageThreshold)
            ? profile.strongCoverageThreshold
            : SENSOR_PROFILES.opticalRecon.strongCoverageThreshold;
    }

    function computeCoverageStrength(input = {}) {
        const profile = input.profile || resolveSensorProfile(input.record || input.name || "");
        const elevationDeg = Number.isFinite(input.elevationDeg) ? input.elevationDeg : NaN;
        const rangeKm = Number.isFinite(input.rangeKm) ? input.rangeKm : NaN;
        const altKm = Number.isFinite(input.altKm) ? input.altKm : (typeof input.record === "object" ? input.record.altKm : NaN);
        const offNadirDeg = Number.isFinite(input.offNadirDeg) ? input.offNadirDeg : computeOffNadirDeg(elevationDeg, altKm);
        const minElevationDeg = Number.isFinite(input.minElevationDeg) ? input.minElevationDeg : profile.minElevationDeg;
        const sensorQualityFactor = Number.isFinite(profile.sensorQualityFactor) ? clamp01(profile.sensorQualityFactor) : 1;

        if (!Number.isFinite(elevationDeg) || !Number.isFinite(rangeKm) || !Number.isFinite(offNadirDeg)) {
            return {
                coverageStrength: 0,
                isGeometricallyVisible: false,
                isInsideSensorFootprint: false,
                isRangeAcceptable: false,
                isOffNadirAcceptable: false,
                rejectedByRange: true,
                rejectedByOffNadir: true,
                rejectedByElevation: true,
                rejectedByThreshold: false,
                rejectionReasons: ["missingInputs"]
            };
        }

        const isGeometricallyVisible = elevationDeg > 0;
        const isOffNadirAcceptable = offNadirDeg <= profile.maxOffNadirDeg;
        const isRangeAcceptable = rangeKm <= profile.maxOperationalRangeKm;
        const isInsideSensorFootprint = isGeometricallyVisible && elevationDeg >= minElevationDeg && isOffNadirAcceptable && isRangeAcceptable;
        const rejectionReasons = [];

        if (!isGeometricallyVisible) {
            rejectionReasons.push("belowHorizon");
        }
        if (elevationDeg < minElevationDeg) {
            rejectionReasons.push("belowMinElevation");
        }
        if (!isOffNadirAcceptable) {
            rejectionReasons.push("offNadir");
        }
        if (!isRangeAcceptable) {
            rejectionReasons.push("range");
        }

        if (!isInsideSensorFootprint) {
            return {
                coverageStrength: 0,
                isGeometricallyVisible,
                isInsideSensorFootprint,
                isRangeAcceptable,
                isOffNadirAcceptable,
                rejectedByRange: !isRangeAcceptable,
                rejectedByOffNadir: !isOffNadirAcceptable,
                rejectedByElevation: elevationDeg < minElevationDeg,
                rejectedByThreshold: false,
                rejectionReasons
            };
        }

        const elevationFactor = computeElevationFactor(elevationDeg, minElevationDeg);
        const offNadirFactor = computeOffNadirFactor(offNadirDeg, profile.maxOffNadirDeg);
        const rangeFactor = computeRangeFactor(rangeKm, profile.maxOperationalRangeKm);
        const sensorFactor = sensorQualityFactor;
        let isrFactor = profile.isrCapable === false ? 0.05 : 1.0;
        
        if (profile.key === "geoComm" && input.date !== undefined && input.date !== null) {
            const timeMs = (input.date instanceof Date ? input.date : new Date(input.date)).getTime();
            
            // Simple deterministic hash of satellite name to shift phase
            let nameHash = 0;
            const nameStr = typeof input.record === "object" && input.record?.name 
                ? String(input.record.name)
                : (typeof input.name === "string" ? input.name : "");
            
            for (let i = 0; i < nameStr.length; i++) {
                nameHash += nameStr.charCodeAt(i);
            }
            
            const phaseShift = (nameHash % 360) * 10 * 60 * 1000; // Shift up to 1 hour in MS
            const shiftedTime = timeMs + phaseShift;
            
            // Period cycles for periodic scintillation and RF degradation
            const wave1 = Math.sin(shiftedTime / (180 * 60 * 1000)); // 3-hour period
            const wave2 = Math.cos(shiftedTime / (70 * 60 * 1000));  // 70-minute period
            const wave3 = Math.sin(shiftedTime / (15 * 60 * 1000));  // 15-minute high-frequency noise
            
            const combinedNoise = (wave1 * 0.4) + (wave2 * 0.3) + (wave3 * 0.1);
            
            // Base strength is 0.48, varying between 0.13 and 0.83.
            // When combined with rawStrength (~0.6), coverageStrength varies between 0.08 (blind) and 0.50 (strong).
            // This produces realistic 15-45 minute outages every few hours.
            isrFactor = clamp01(0.48 + combinedNoise * 0.35);
        }
        const rawStrength = clamp01(
            (elevationFactor * 0.35) +
            (offNadirFactor * 0.35) +
            (rangeFactor * 0.2) +
            (sensorFactor * 0.1)
        );
        const coverageStrength = clamp01(rawStrength * isrFactor);

        return {
            coverageStrength,
            rawStrength,
            isrFactor,
            isrCapable: profile.isrCapable !== false,
            isGeometricallyVisible,
            isInsideSensorFootprint,
            isRangeAcceptable,
            isOffNadirAcceptable,
            elevationFactor,
            offNadirFactor,
            rangeFactor,
            sensorFactor,
            rejectedByRange: false,
            rejectedByOffNadir: false,
            rejectedByElevation: false,
            rejectedByThreshold: false,
            rejectionReasons
        };
    }

    function isEffectivelyCovered(input = {}) {
        const profile = input.profile || resolveSensorProfile(input.record || input.name || "");
        const assessment = computeCoverageStrength({
            ...input,
            profile
        });
        const threshold = Number.isFinite(input.coverageThreshold)
            ? input.coverageThreshold
            : getCoverageThreshold(profile);
        const isEffectivelyCoveredValue = assessment.coverageStrength >= threshold;

        return {
            ...assessment,
            profile,
            profileKey: profile.key,
            coverageThreshold: threshold,
            strongCoverageThreshold: getStrongCoverageThreshold(profile),
            isEffectivelyCovered: isEffectivelyCoveredValue,
            rejectedByThreshold: !isEffectivelyCoveredValue,
            rejectionReasons: isEffectivelyCoveredValue
                ? assessment.rejectionReasons
                : [...(assessment.rejectionReasons || []), "threshold"]
        };
    }

    function computeOperationalRadiusKm(input = {}) {
        const profile = input.profile || resolveSensorProfile(input.record || input.name || "");
        const altKm = Number.isFinite(input.altKm) ? input.altKm : (typeof input.record === "object" ? input.record.altKm : NaN);
        
        let geometricRadiusKm;
        if (Number.isFinite(altKm) && altKm > 0) {
            geometricRadiusKm = getSwathRadiusKm(altKm, profile.maxOffNadirDeg || 30);
        } else {
            geometricRadiusKm = Number.isFinite(input.geometricRadiusKm) ? Math.max(0, input.geometricRadiusKm) : 250;
        }

        const coverageStrength = Number.isFinite(input.coverageStrength) ? clamp01(input.coverageStrength) : 1;
        const rawRadiusKm = geometricRadiusKm * (profile.footprintFactor || 1);
        const strengthScale = 0.65 + (0.35 * coverageStrength);
        const displayRadiusKm = rawRadiusKm * strengthScale;
        const maxDisplayRadiusKm = Number.isFinite(profile.maxDisplayRadiusKm)
            ? profile.maxDisplayRadiusKm
            : (profile.key === "geoComm" ? 6000 : 800);

        return Math.min(maxDisplayRadiusKm, Math.max(10, displayRadiusKm));
    }

    function classifyCoverageLevel(coverageStrength, profile) {
        const effectiveProfile = profile || SENSOR_PROFILES.opticalRecon;
        const strength = Number.isFinite(coverageStrength) ? coverageStrength : 0;

        if (strength >= getStrongCoverageThreshold(effectiveProfile)) {
            return "strong";
        }

        if (strength >= getCoverageThreshold(effectiveProfile)) {
            return "degraded";
        }

        return "blind";
    }

    return {
        SENSOR_PROFILES,
        classifyCoverageLevel,
        computeCoverageStrength,
        computeOffNadirDeg,
        computeOperationalRadiusKm,
        getCoverageThreshold,
        getProfileKey,
        isEffectivelyCovered,
        resolveSensorProfile,
        getSwathRadiusKm
    };
}));
