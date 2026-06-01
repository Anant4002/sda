const crypto = require("node:crypto");
const { Op } = require("sequelize");
const { Satellite } = require("../models/satellite");
const { SatelliteCatalogVersion } = require("../models/satelliteCatalogVersion");
const { CatalogEvent } = require("../models/catalogEvent");
const { catalogSource, serverConfig } = require("../config");
const { sequelize } = require("../db");
const { serializeSatellite } = require("./satelliteMetadataService");
const { persistTleRevisions } = require("./tleRevisionHistoryService");
const { clearPropagationCache } = require("./propagationCoordinator");
const { getOrbitalState, compareOrbits, characteriseSatellite } = require("./satelliteCharacterisationService");
const { getSensorTaskingRecommendations } = require("./sensorTaskingService");

const satelliteCatalogCache = new Map();
const DEFAULT_HISTORY_LIMIT = 20;
const MAX_HISTORY_LIMIT = 100;
const LEGACY_SAFE_SATELLITE_ATTRIBUTES = [
    "id",
    "name",
    "line1",
    "line2",
    "noradId",
    "characterisation",
    "catalogStatus",
    "dataSource",
    "intData",
    "isIndigenous",
    "lastObservedAt",
    "firstAddedAt"
];

function buildCacheKey(options) {
    return JSON.stringify(options);
}

function getCachedCatalog(cacheKey) {
    const cachedEntry = satelliteCatalogCache.get(cacheKey);
    if (!cachedEntry) {
        return null;
    }

    if (Date.now() - cachedEntry.createdAt > serverConfig.satelliteCacheTtlMs) {
        satelliteCatalogCache.delete(cacheKey);
        return null;
    }

    return cachedEntry.value;
}

function setCachedCatalog(cacheKey, value) {
    satelliteCatalogCache.set(cacheKey, {
        createdAt: Date.now(),
        value
    });
}

function clearSatelliteCatalogCache() {
    satelliteCatalogCache.clear();
    clearPropagationCache();
}

function computeCatalogChecksum(satellites) {
    const hash = crypto.createHash("sha256");
    for (const satellite of satellites) {
        hash.update(`${satellite.name}|${satellite.line1}|${satellite.line2}\n`);
    }
    return hash.digest("hex");
}

function normalizeLimit(limit, fallback = DEFAULT_HISTORY_LIMIT) {
    if (limit === undefined || limit === null || limit === "") {
        return fallback;
    }

    const parsedLimit = Number.parseInt(limit, 10);
    if (!Number.isInteger(parsedLimit) || parsedLimit < 1) {
        return fallback;
    }

    return Math.min(parsedLimit, MAX_HISTORY_LIMIT);
}

async function listSatellites(options = {}) {
    const normalizedOptions = {
        indianOnly: Boolean(options.indianOnly),
        isIndigenous: options.isIndigenous !== undefined ? Boolean(options.isIndigenous) : null,
        catalogStatus: options.catalogStatus || null,
        limit: Number.isInteger(options.limit) ? options.limit : null,
        offset: Number.isInteger(options.offset) ? options.offset : 0,
        search: options.search ? options.search.trim() : ""
    };

    const cacheKey = buildCacheKey(normalizedOptions);
    const cachedValue = getCachedCatalog(cacheKey);
    if (cachedValue) {
        return cachedValue;
    }

    const where = {};
    if (normalizedOptions.search) {
        where.name = {
            [Op.iLike]: `%${normalizedOptions.search}%`
        };
    }
    if (normalizedOptions.catalogStatus) {
        where.catalogStatus = normalizedOptions.catalogStatus;
    }
    if (normalizedOptions.isIndigenous !== null) {
        where.isIndigenous = normalizedOptions.isIndigenous;
    }

    const satellites = await Satellite.findAll({
        attributes: LEGACY_SAFE_SATELLITE_ATTRIBUTES,
        where,
        order: [["name", "ASC"]],
        ...(normalizedOptions.limit ? { limit: normalizedOptions.limit } : {}),
        ...(normalizedOptions.offset ? { offset: normalizedOptions.offset } : {})
    });

    const serializedSatellites = satellites
        .map(serializeSatellite)
        .filter((satellite) => !normalizedOptions.indianOnly || satellite.isIndian);

    setCachedCatalog(cacheKey, serializedSatellites);
    return serializedSatellites;
}

async function getCatalogStatus() {
    const latestVersion = await SatelliteCatalogVersion.findOne({
        order: [["syncedAt", "DESC"]]
    });

    const currentCount = await Satellite.count();
    const latestVersionPlain = latestVersion ? latestVersion.get({ plain: true }) : null;
    const dataAgeSeconds = latestVersionPlain ? Math.max(0, Math.round((Date.now() - new Date(latestVersionPlain.syncedAt).getTime()) / 1000)) : null;

    return {
        currentCount,
        dataAgeSeconds,
        latestVersion: latestVersionPlain
    };
}

async function listCatalogHistory(limit = 20) {
    return SatelliteCatalogVersion.findAll({
        order: [["syncedAt", "DESC"]],
        limit: normalizeLimit(limit)
    }).then((versions) => versions.map((version) => version.get({ plain: true })));
}

async function listCatalogEvents(limit = 20) {
    return CatalogEvent.findAll({
        order: [["createdAt", "DESC"]],
        limit: normalizeLimit(limit)
    }).then((events) => events.map((event) => event.get({ plain: true })));
}

async function seedCatalogHistoryIfMissing() {
    const { SatelliteTleRevision } = require("../models/satelliteTleRevision");
    
    const latestVersion = await SatelliteCatalogVersion.findOne({
        order: [["syncedAt", "DESC"]]
    });

    const actualRevCount = await SatelliteTleRevision.count();

    if (latestVersion && actualRevCount > 0) {
        return false;
    }

    const satellites = await Satellite.findAll({
        order: [["name", "ASC"]]
    });

    if (!satellites.length) {
        return false;
    }

    const syncedAt = new Date();
    const checksum = computeCatalogChecksum(satellites);

    await sequelize.transaction(async (transaction) => {
        const version = await SatelliteCatalogVersion.create({
            sourceName: catalogSource.name,
            sourceUrl: catalogSource.url,
            fetchedAt: syncedAt,
            syncedAt,
            recordCount: satellites.length,
            checksum,
            status: "baseline",
            errorMessage: null
        }, { transaction });

        await CatalogEvent.create({
            eventType: "catalog_history_seeded",
            severity: "info",
            message: `Seeded catalog history from ${satellites.length} existing live satellite records.`,
            details: {
                recordCount: satellites.length,
                checksum,
                status: "baseline"
            },
            sourceName: catalogSource.name,
            sourceUrl: catalogSource.url,
            versionId: version.id
        }, { transaction });

        // Seed initial TLE revisions from live data
        await persistTleRevisions(
            satellites.map(s => ({
                name: s.name,
                line1: s.line1,
                line2: s.line2,
                noradId: s.noradId
            })),
            version.id,
            {
                source: { name: catalogSource.name, url: catalogSource.url },
                transaction
            }
        );
    });

    clearSatelliteCatalogCache();
    return true;
}

async function getPreviousCatalogVersionInfo(versionId = null) {
    if (versionId) {
        return SatelliteCatalogVersion.findByPk(versionId).then((v) => v ? v.get({ plain: true }) : null);
    }

    return SatelliteCatalogVersion.findOne({
        order: [["syncedAt", "DESC"]],
        offset: 1
    }).then((v) => v ? v.get({ plain: true }) : null);
}

async function batchCharacteriseSatellites() {
    const satellites = await Satellite.findAll();
    let updated = 0;

    const summary = {
        totalProcessed: satellites.length,
        orbitBreakdown: { LEO: 0, MEO: 0, GEO: 0, HEO: 0, Unknown: 0 },
        objectTypeBreakdown: { Payload: 0, Debris: 0, "Rocket Body": 0, Unknown: 0 },
        operationalStatusBreakdown: { Active: 0, Inactive: 0, Decaying: 0, Stale: 0, Unknown: 0 },
        indianAssetsIdentified: 0
    };

    // Use a small chunk size and setImmediate to allow the event loop to breathe
    const CHUNK_SIZE = 100;
    for (let i = 0; i < satellites.length; i += CHUNK_SIZE) {
        const chunk = satellites.slice(i, i + CHUNK_SIZE);
        
        await Promise.all(chunk.map(async (s) => {
            const characterisation = characteriseSatellite(s.name, s.line1, s.line2);
            await s.update({ characterisation });
            
            // Aggregate metrics
            summary.orbitBreakdown[characterisation.orbitClass] = (summary.orbitBreakdown[characterisation.orbitClass] || 0) + 1;
            summary.objectTypeBreakdown[characterisation.objectType] = (summary.objectTypeBreakdown[characterisation.objectType] || 0) + 1;
            summary.operationalStatusBreakdown[characterisation.operationalStatus] = (summary.operationalStatusBreakdown[characterisation.operationalStatus] || 0) + 1;
            if (characterisation.ownership === "Indian") {
                summary.indianAssetsIdentified += 1;
            }
            updated++;
        }));

        // Yield control
        await new Promise(resolve => setImmediate(resolve));
    }

    clearSatelliteCatalogCache();
    return {
        updatedCount: updated,
        summary
    };
}

async function updateSatelliteIntData(id, intData) {
    let satellite = null;

    // 1. Try finding by Primary Key if the ID is numeric
    if (/^\d+$/.test(id)) {
        satellite = await Satellite.findByPk(id);
    }

    // 2. Fallback to finding by name or NORAD ID if not found by PK
    if (!satellite) {
        satellite = await Satellite.findOne({
            where: {
                [Op.or]: [
                    { name: id },
                    { noradId: /^\d+$/.test(id) ? parseInt(id, 10) : null }
                ].filter(c => c.name || c.noradId !== null)
            }
        });
    }

    if (!satellite) {
        throw new Error(`Satellite not found with identifier: ${id}`);
    }

    await satellite.update({ intData });
    clearSatelliteCatalogCache();
    return serializeSatellite(satellite);
}

/**
 * Ingest a new track observation and attempt correlation.
 */
async function ingestTrackObservation(data) {
    const { name, line1, line2, intData } = data;
    
    // 1. Extract orbital state and NORAD ID of incoming track
    const incomingState = getOrbitalState(line2);
    if (!incomingState) {
        throw new Error("Invalid TLE Line 2: Could not extract orbital state.");
    }

    const noradIdMatch = line1.match(/^1\s+(\d{5})[U|C]/);
    const incomingNoradId = noradIdMatch ? parseInt(noradIdMatch[1], 10) : null;

    let matchedSatellite = null;

    // 2. High-speed Priority Match: Match by NORAD ID first (if available)
    if (incomingNoradId) {
        matchedSatellite = await Satellite.findOne({
            where: { 
                noradId: incomingNoradId,
                catalogStatus: "CORRELATED"
            }
        });
    }

    // 3. Fallback: Full orbital correlation scan
    if (!matchedSatellite) {
        const catalogue = await Satellite.findAll({
            where: { catalogStatus: "CORRELATED" },
            attributes: ["id", "name", "line2", "noradId"] // Minimal attributes for speed
        });

        for (const sat of catalogue) {
            const satState = getOrbitalState(sat.line2);
            if (compareOrbits(incomingState, satState)) {
                matchedSatellite = sat;
                break;
            }
        }
    }

    let finalSatellite;
    if (matchedSatellite) {
        // MATCH FOUND: Link to existing catalogue entry
        await matchedSatellite.update({
            lastObservedAt: new Date(),
            intData: intData || matchedSatellite.intData,
            line1, // Update TLE to latest observation
            line2
        });
        finalSatellite = matchedSatellite;
    } else {
        // NO MATCH FOUND: Create new UCT entry
        const characterisation = characteriseSatellite(name, line1, line2);
        
        // Add UCT metadata
        characterisation.uctUncertainty = "High";
        characterisation.firstObservedAt = new Date().toISOString();
        characterisation.predictedOrbit = incomingState;

        finalSatellite = await Satellite.create({
            name: name || `UCT-${Date.now().toString().slice(-6)}`,
            line1,
            line2,
            noradId: incomingNoradId,
            catalogStatus: "UNCORRELATED",
            isIndigenous: true,
            dataSource: "MANUAL_TRACK",
            intData,
            characterisation,
            lastObservedAt: new Date()
        });

        // Generate sensor tasking for UCT
        const recommendations = getSensorTaskingRecommendations(finalSatellite);
        await finalSatellite.update({
            characterisation: {
                ...finalSatellite.characterisation,
                sensorRecommendations: recommendations
            }
        });
    }

    clearSatelliteCatalogCache();
    
    const result = serializeSatellite(finalSatellite);
    result.correlationResult = matchedSatellite ? "MATCHED" : "NEW_UCT";
    if (matchedSatellite) {
        result.matchedWith = matchedSatellite.name;
    }

    return result;
}

module.exports = {
    batchCharacteriseSatellites,
    clearSatelliteCatalogCache,
    getCatalogStatus,
    getPreviousCatalogVersionInfo,
    listCatalogEvents,
    listCatalogHistory,
    listSatellites,
    seedCatalogHistoryIfMissing,
    updateSatelliteIntData,
    ingestTrackObservation
};
