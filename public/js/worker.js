importScripts("https://cdnjs.cloudflare.com/ajax/libs/satellite.js/4.0.0/satellite.min.js");
importScripts("../shared/orbitUtils.js");
const OTHER_SATELLITE_PATH_COLOR = "#ffd166";
const INDIAN_SATELLITE_PATH_COLOR = "#ff5ea8";

let satRecords = [];

function toDegrees(radians) {
    return (radians * 180) / Math.PI;
}

function parseMeanMotion(line2) {
    if (!line2 || line2.length < 63) {
        return 15;
    }

    const rawValue = line2.substring(52, 63).trim();
    const parsedValue = Number.parseFloat(rawValue);
    return Number.isFinite(parsedValue) && parsedValue > 0 ? parsedValue : 15;
}

function getOrbitMinutes(record) {
    return 1450 / record.meanMotionRevPerDay;
}

function getOrbitSampleSeconds(record) {
    // Why: worker-generated path previews must match the shared satrec-based sampling density used elsewhere.
    return orbitUtils.getSampleIntervalSeconds(record?.satrec);
}

function propagateState(record, date, observer, fixedGmst = null) {
    const pva = satellite.propagate(record.satrec, date);
    if (!pva.position) {
        return null;
    }

    const gmst = fixedGmst !== null ? fixedGmst : satellite.gstime(date);
    const geodetic = satellite.eciToGeodetic(pva.position, gmst);
    const ecf = satellite.eciToEcf(pva.position, gmst);
    const lookAngles = observer ? satellite.ecfToLookAngles(observer, ecf) : null;

    return {
        eci: pva.position,
        ecf: ecf,
        velocityEci: pva.velocity || null,
        lat: satellite.degreesLat(geodetic.latitude),
        lon: satellite.degreesLong(geodetic.longitude),
        altKm: geodetic.height,
        elevationDeg: lookAngles ? toDegrees(lookAngles.elevation) : -90
    };
}

function buildSatellitePath(satelliteId, startTime, noradId = null) {
    const record = satRecords.find((sat) => (noradId && sat.noradId === noradId) || sat.id === satelliteId);
    if (!record) {
        return null;
    }

    const startDate = new Date(startTime);
    const orbitMinutes = getOrbitMinutes(record);
    const sampleSeconds = getOrbitSampleSeconds(record);

    const endOffset = orbitMinutes * 60 ;
    const samples = [];
    for (let offsetSeconds = 0; offsetSeconds <= endOffset; offsetSeconds += sampleSeconds) {
        const sampleDate = new Date(startDate.getTime() + offsetSeconds * 1000);
        const state = propagateState(record, sampleDate, null);
        if (!state) continue;

        samples.push({
            x: state.eci.x * 1000,
            y: state.eci.y * 1000,
            z: state.eci.z * 1000,
            lat: state.lat,
            lon: state.lon,
            altKm: state.altKm,
            time: sampleDate.toISOString()
        });
    }

    if (samples.length < 2) {
        return null;
    }

    return [{
        id: record.id,
        isIndian: record.isIndian,
        renderFrame: "inertial",
        orbitMinutes,
        startTime: startDate.toISOString(),
        endTime: new Date(startDate.getTime() + endOffset * 1000).toISOString(),
        startAltKm: samples[0].altKm,
        endAltKm: samples[samples.length - 1].altKm,
        color: record.isIndian ? "#c03d7a" : "#b08d36",
        width: 3,
        style: "solid",
        samples
    }];
}

function initializeCatalog(tles) {
    if (!Array.isArray(tles)) {
        throw new Error("Worker initialization requires a TLE array.");
    }

    satRecords = tles
        .filter((tle) => tle && typeof tle.name === "string" && typeof tle.line1 === "string" && typeof tle.line2 === "string")
        .map((tle) => ({
            id: tle.name,
            noradId: tle.noradId,
            isIndian: Boolean(tle.isIndian),
            meanMotionRevPerDay: parseMeanMotion(tle.line2),
            satrec: satellite.twoline2satrec(tle.line1, tle.line2)
        }))
        .filter((record) => !Number.isNaN(record.satrec?.satnum));
}

self.onmessage = function(event) {
    const { type } = event.data;

    try {
        if (type === "init") {
            initializeCatalog(event.data.tles);
            self.postMessage({ type: "ready" });
            return;
        }

        if (type === "update") {
            const jsDate = new Date(event.data.time);
            const positions = satRecords.map((satelliteRecord) => {
                const state = propagateState(satelliteRecord, jsDate, null);
                if (!state) {
                    return null;
                }

                return {
                    id: satelliteRecord.id,
                    lon: state.lon,
                    lat: state.lat,
                    alt: state.altKm * 1000
                };
            }).filter(Boolean);

            self.postMessage({
                type: "positions",
                positions
            });
            return;
        }

        if (type === "satellitePath") {
            if (!event.data.id && !event.data.noradId) {
                throw new Error("Satellite path requests require an id or noradId.");
            }

            const result = buildSatellitePath(event.data.id, event.data.time, event.data.noradId);
            if (result) {
                self.postMessage({
                    type: "satellitePath",
                    result
                });
            }
            return;
        }

        throw new Error(`Unknown worker message type: ${type}`);
    } catch (error) {
        self.postMessage({
            type: "error",
            requestType: type,
            error: error.message || "Unknown worker error."
        });
    }
};
