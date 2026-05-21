const { SatelliteTleRevision } = require("../models/satelliteTleRevision");
const { parseTleLine2OrbitalMetrics } = require("./orbitalPropagationService");
const { isIndianSatelliteName } = require("./satelliteOwnershipService");
const crypto = require("node:crypto");
const { Op } = require("sequelize");

/**
 * Compute TLE checksum for deduplication
 */
function tleChecksum(line1, line2) {
    const hash = crypto.createHash("sha256");
    hash.update(`${line1}|${line2}`);
    return hash.digest("hex");
}

/**
 * Extract epoch from TLE line 1
 */
function extractTleEpoch(line1) {
    if (!line1 || line1.length < 32) return null;
    try {
        const yearStr = line1.substring(18, 20);
        const dayStr = line1.substring(20, 32);
        const year = Number.parseInt(yearStr, 10);
        const dayOfYear = Number.parseFloat(dayStr);
        if (!Number.isFinite(year) || !Number.isFinite(dayOfYear)) return null;
        const fullYear = year < 57 ? 2000 + year : 1900 + year;
        const date = new Date(Date.UTC(fullYear, 0, 1));
        date.setUTCDate(date.getUTCDate() + Math.floor(dayOfYear) - 1);
        return date;
    } catch (error) {
        return null;
    }
}

/**
 * Compute basic orbital metrics
 */
function estimateOrbitalAltitudes(meanMotionRevPerDay, eccentricity) {
    if (!Number.isFinite(meanMotionRevPerDay) || !Number.isFinite(eccentricity)) {
        return { semiMajorAxisKm: null, apogeeKm: null, perigeeKm: null };
    }
    try {
        const meanMotionRadPerSec = (meanMotionRevPerDay * 2 * Math.PI) / (24 * 3600);
        const GM = 398600.4418;
        const semiMajorAxisKm = Math.cbrt(GM / (meanMotionRadPerSec * meanMotionRadPerSec));
        const earthRadiusKm = 6371;
        const perigeeKm = semiMajorAxisKm * (1 - eccentricity) - earthRadiusKm;
        const apogeeKm = semiMajorAxisKm * (1 + eccentricity) - earthRadiusKm;
        return {
            semiMajorAxisKm: Number.isFinite(semiMajorAxisKm) ? semiMajorAxisKm : null,
            apogeeKm: Number.isFinite(apogeeKm) ? apogeeKm : null,
            perigeeKm: Number.isFinite(perigeeKm) ? perigeeKm : null
        };
    } catch (error) {
        return { semiMajorAxisKm: null, apogeeKm: null, perigeeKm: null };
    }
}

function parseOrbitalMetricsFromTle(line1, line2) {
    const metrics = parseTleLine2OrbitalMetrics(line2);
    if (!metrics) return null;
    const altitudes = estimateOrbitalAltitudes(metrics.meanMotionRevPerDay, metrics.eccentricity);
    return {
        ...metrics,
        ...altitudes
    };
}

/**
 * Persist TLE revisions from a satellite batch (OPTIMIZED BULK VERSION)
 */
async function persistTleRevisions(satellites, catalogVersionId, options = {}) {
    if (!Array.isArray(satellites) || satellites.length === 0) {
        return { persisted: 0, skipped: 0, errors: [] };
    }

    const { source = {}, transaction = null } = options;
    const errors = [];
    
    try {
        // 1. Pre-process incoming batch (calculate checksums and parse metrics)
        const incomingMap = new Map();
        for (const s of satellites) {
            if (!s.line1 || !s.line2 || !s.name) continue;
            const checksum = tleChecksum(s.line1, s.line2);
            incomingMap.set(`${s.name}|${checksum}`, {
                ...s,
                checksum,
                metrics: parseOrbitalMetricsFromTle(s.line1, s.line2),
                epoch: extractTleEpoch(s.line1)
            });
        }

        const keys = Array.from(incomingMap.keys());
        const checksums = Array.from(incomingMap.values()).map(v => v.checksum);

        // 2. Optimized Bulk Check: Find existing revisions for these checksums
        // We use checksums primarily as they are unique enough for deduplication in a sync window
        const existingRecords = await SatelliteTleRevision.findAll({
            attributes: ['satelliteName', 'tleChecksum'],
            where: {
                tleChecksum: { [Op.in]: checksums }
            },
            transaction
        });

        const existingKeys = new Set(existingRecords.map(r => `${r.satelliteName}|${r.tleChecksum}`));

        // 3. Filter for truly new revisions
        const recordsToCreate = [];
        for (const [key, data] of incomingMap.entries()) {
            if (existingKeys.has(key)) continue;

            recordsToCreate.push({
                noradId: data.noradId || null,
                satelliteName: data.name,
                line1: data.line1,
                line2: data.line2,
                inclinationDeg: data.metrics?.inclinationDeg || null,
                eccentricity: data.metrics?.eccentricity || null,
                meanMotionRevPerDay: data.metrics?.meanMotionRevPerDay || null,
                raanDeg: data.metrics?.raanDeg || null,
                argPerigeeDeg: data.metrics?.argPerigeeDeg || null,
                meanAnomalyDeg: data.metrics?.meanAnomalyDeg || null,
                semiMajorAxisKm: data.metrics?.semiMajorAxisKm || null,
                apogeeKm: data.metrics?.apogeeKm || null,
                perigeeKm: data.metrics?.perigeeKm || null,
                tleEpoch: data.epoch,
                sourceName: source.name || null,
                sourceUrl: source.url || null,
                catalogVersionId: catalogVersionId || null,
                tleChecksum: data.checksum,
                isIndian: isIndianSatelliteName(data.name),
                ingestedAt: new Date()
            });
        }

        // 4. Bulk Insert
        if (recordsToCreate.length > 0) {
            // Split into smaller chunks (e.g. 1000) for Postgres safety
            const CHUNK_SIZE = 1000;
            for (let i = 0; i < recordsToCreate.length; i += CHUNK_SIZE) {
                const chunk = recordsToCreate.slice(i, i + CHUNK_SIZE);
                await SatelliteTleRevision.bulkCreate(chunk, { transaction });
            }
        }

        return { 
            persisted: recordsToCreate.length, 
            skipped: satellites.length - recordsToCreate.length, 
            errors 
        };
    } catch (error) {
        console.error("Bulk TLE persistence failed:", error);
        throw error;
    }
}

async function getLatestRevisionForSatellite(noradId, satelliteName) {
    const where = {};
    if (noradId) where.noradId = noradId;
    if (satelliteName) where.satelliteName = satelliteName;
    
    if (Object.keys(where).length === 0) {
        throw new Error("Either noradId or satelliteName is required");
    }

    return SatelliteTleRevision.findOne({
        where,
        order: [["ingestedAt", "DESC"]],
        limit: 1
    }).then(r => r ? r.get({ plain: true }) : null);
}

async function getRevisionHistory(noradId, satelliteName, options = {}) {
    const where = {};
    let hasFilter = false;
    
    if (noradId && satelliteName) {
        where[Op.or] = [
            { noradId: noradId },
            { satelliteName: { [Op.iLike]: satelliteName } }
        ];
        hasFilter = true;
    } else if (noradId) {
        where.noradId = noradId;
        hasFilter = true;
    } else if (satelliteName) {
        where.satelliteName = { [Op.iLike]: satelliteName };
        hasFilter = true;
    }

    if (!hasFilter) {
        throw new Error("Either noradId or satelliteName is required");
    }

    const { limit = 100, offset = 0 } = options;
    const revisions = await SatelliteTleRevision.findAll({
        where,
        order: [["tleEpoch", "DESC"]],
        limit,
        offset
    });
    return revisions.map((r) => r.get({ plain: true }));
}

module.exports = {
    persistTleRevisions,
    getLatestRevisionForSatellite,
    getRevisionHistory,
    tleChecksum,
    extractTleEpoch,
    parseOrbitalMetricsFromTle,
    estimateOrbitalAltitudes
};
