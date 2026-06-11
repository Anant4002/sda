const axios = require("axios");
const { Satellite } = require("../models/satellite");
const { Debris } = require("../models/debris");
const { RocketBody } = require("../models/rocketBody");
const { sequelize } = require("../db");
const { catalogSource, tleSourceUrl, spacetrackConfig } = require("../config");
const { SatelliteCatalogVersion } = require("../models/satelliteCatalogVersion");
const { CatalogEvent } = require("../models/catalogEvent");
const { CatalogSyncRun } = require("../models/catalogSyncRun");
const { CatalogSyncNewSatellite } = require("../models/catalogSyncNewSatellite");
const { clearSatelliteCatalogCache } = require("./satelliteCatalogService");
const { serializeSatellite, isIndianSatelliteName } = require("./satelliteMetadataService");
const { evaluateCatalogManoeuvres } = require("./manoeuvreDetectionService");
const { recordManoeuvreDetections } = require("./operationalAlertService");
const { persistTleRevisions } = require("./tleRevisionHistoryService");
const crypto = require("node:crypto");

function parseTleCatalog(rawCatalog) {
    if (typeof rawCatalog !== "string" || !rawCatalog.trim()) {
        return [];
    }
    const lines = rawCatalog.split("\n").map((line) => line.trim()).filter(Boolean);
    const satellites = [];
    for (let index = 0; index < lines.length - 2; index += 3) {
        const [name, line1, line2] = lines.slice(index, index + 3);
        if (!name || !line1 || !line2) continue;
        if (!line1.startsWith("1 ") || !line2.startsWith("2 ")) continue;
        const noradId = Number.parseInt(line1.substring(2, 7), 10);
        satellites.push({
            name,
            line1,
            line2,
            noradId: Number.isFinite(noradId) ? noradId : null
        });
    }
    return satellites;
}

async function fetchSatelliteCatalog() {
    const response = await axios.get(tleSourceUrl, {
        headers: { 
            "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36" 
        },
        timeout: 30000
    });
    return parseTleCatalog(response.data);
}

async function fetchSpaceTrackCatalog(url) {
    if (!spacetrackConfig.username || !spacetrackConfig.password) {
        console.warn("Space-Track credentials not configured. Skipping sync for: " + url);
        return [];
    }
    console.log(`Authenticating with Space-Track...`);
    const loginParams = new URLSearchParams();
    loginParams.append("identity", spacetrackConfig.username);
    loginParams.append("password", spacetrackConfig.password);

    const loginResponse = await axios.post("https://www.space-track.org/ajaxauth/login", loginParams.toString(), {
        headers: {
            "Content-Type": "application/x-www-form-urlencoded",
            "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36"
        },
        timeout: 30000
    });

    const cookies = loginResponse.headers["set-cookie"];
    if (!cookies || cookies.length === 0) {
        throw new Error("Failed to authenticate with Space-Track: No session cookies returned.");
    }

    const cookieHeader = cookies.map(c => c.split(";")[0]).join("; ");

    console.log(`Fetching TLE data from Space-Track for URL: ${url}`);
    const response = await axios.get(url, {
        headers: {
            "Cookie": cookieHeader,
            "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36"
        },
        timeout: 60000
    });
    return parseTleCatalog(response.data);
}

function computeBatchChecksum(satellites) {
    const hash = crypto.createHash("sha256");
    for (const satellite of satellites) {
        hash.update(`${satellite.name}|${satellite.line1}|${satellite.line2}\n`);
    }
    return hash.digest("hex");
}

async function recordCatalogEvent(transaction, options = {}) {
    return CatalogEvent.create({
        eventType: options.eventType || "catalog_sync",
        severity: options.severity || "info",
        message: options.message || "Catalog event recorded.",
        details: options.details || null,
        sourceName: options.sourceName || catalogSource.name,
        sourceUrl: options.sourceUrl || catalogSource.url,
        versionId: options.versionId || null
    }, { transaction });
}

async function recordCatalogVersion(satellites, transaction, options = {}) {
    const syncedAt = options.syncedAt || new Date();
    const version = await SatelliteCatalogVersion.create({
        sourceName: options.sourceName || catalogSource.name,
        sourceUrl: options.sourceUrl || catalogSource.url,
        fetchedAt: options.fetchedAt || syncedAt,
        syncedAt,
        recordCount: satellites.length,
        checksum: options.checksum || computeBatchChecksum(satellites),
        status: options.status || "success",
        errorMessage: options.errorMessage || null
    }, { transaction });

    await recordCatalogEvent(transaction, {
        eventType: "catalog_sync",
        severity: "info",
        message: `Synced ${satellites.length} satellites from ${version.sourceName}.`,
        details: { recordCount: satellites.length, checksum: version.checksum, status: version.status },
        sourceName: version.sourceName,
        sourceUrl: version.sourceUrl,
        versionId: version.id
    });
    return version;
}

async function syncSatellites() {
    const startedAt = new Date();
    try {
        let satelliteBatch = [];
        try {
            console.log("Fetching TLE data from CelesTrak...");
            const startFetch = Date.now();
            satelliteBatch = await fetchSatelliteCatalog();
            console.log(`Fetched ${satelliteBatch.length} active satellites from CelesTrak in ${Date.now() - startFetch}ms`);
        } catch (error) {
            console.error("Failed to fetch CelesTrak catalog:", error.message);
            if (!spacetrackConfig.username || !spacetrackConfig.password) {
                if (error.response && error.response.status === 403) {
                    console.log("CelesTrak catalog not yet updated or access limited (403). Recording check-in time.");
                    await sequelize.transaction(async (transaction) => {
                        const existingSats = await Satellite.findAll({ transaction });
                        await recordCatalogVersion(existingSats, transaction, { 
                            status: "baseline",
                            errorMessage: "Source returned 403 (Rate limited or No Update)" 
                        });

                        await CatalogSyncRun.create({
                            startedAt,
                            completedAt: new Date(),
                            totalBefore: existingSats.length,
                            totalAfter: existingSats.length,
                            newSatellitesFound: 0
                        }, { transaction });
                    });
                    const count = await Satellite.count();
                    return count;
                }
                throw error;
            }
        }

        let debrisBatch = [];
        let rocketBodyBatch = [];
        if (spacetrackConfig.username && spacetrackConfig.password) {
            if (spacetrackConfig.debrisUrl) {
                try {
                    const startFetch = Date.now();
                    debrisBatch = await fetchSpaceTrackCatalog(spacetrackConfig.debrisUrl);
                    console.log(`Fetched ${debrisBatch.length} debris objects from Space-Track in ${Date.now() - startFetch}ms`);
                } catch (err) {
                    console.error("Failed to fetch debris from Space-Track:", err.message);
                }
            }
            if (spacetrackConfig.rocketBodiesUrl) {
                try {
                    const startFetch = Date.now();
                    rocketBodyBatch = await fetchSpaceTrackCatalog(spacetrackConfig.rocketBodiesUrl);
                    console.log(`Fetched ${rocketBodyBatch.length} rocket bodies from Space-Track in ${Date.now() - startFetch}ms`);
                } catch (err) {
                    console.error("Failed to fetch rocket bodies from Space-Track:", err.message);
                }
            }
        }

        const totalFetchedCount = satelliteBatch.length + debrisBatch.length + rocketBodyBatch.length;
        if (totalFetchedCount === 0) {
            throw new Error("No satellites, debris, or rocket bodies were parsed from any TLE source.");
        }

        const syncedAt = new Date();
        let versionId = null;

        console.log("Starting database update transaction and manoeuvre evaluation...");
        await sequelize.transaction(async (transaction) => {
            const existingSats = await Satellite.findAll({ transaction });
            const existingDebris = await Debris.findAll({ transaction });
            const existingRocketBodies = await RocketBody.findAll({ transaction });

            const totalBefore = existingSats.length + existingDebris.length + existingRocketBodies.length;

            console.log(`Comparing with existing records (${existingSats.length} satellites, ${existingDebris.length} debris, ${existingRocketBodies.length} rocket bodies)...`);

            if (satelliteBatch.length > 0) {
                const previousSatellites = existingSats.map((row) => serializeSatellite(row));
                const incomingSatellites = satelliteBatch.map((row) => ({
                    ...row,
                    isIndian: isIndianSatelliteName(row.name)
                }));

                const startEval = Date.now();
                const manoeuvreEvaluation = await evaluateCatalogManoeuvres({
                    previousSatellites,
                    incomingSatellites,
                    referenceDate: syncedAt
                });
                console.log(`Manoeuvre evaluation complete in ${Date.now() - startEval}ms. Found ${manoeuvreEvaluation.findings.length} significant events.`);

                await recordManoeuvreDetections(manoeuvreEvaluation.findings, {
                    sourceName: "Catalog Sync Manoeuvre Detection",
                    sourceType: "backend_manoeuvre_detection_catalog_sync",
                    analysisTime: syncedAt.toISOString(),
                    sequelizeOptions: { transaction }
                });
            }

            const existingSatNoradIds = new Set(existingSats.map(row => row.noradId).filter(id => id !== null));
            const newSatellites = satelliteBatch.filter(s => s.noradId && !existingSatNoradIds.has(s.noradId));

            const existingDebrisNoradIds = new Set(existingDebris.map(row => row.noradId).filter(id => id !== null));
            const newDebris = debrisBatch.filter(s => s.noradId && !existingDebrisNoradIds.has(s.noradId));

            const existingRocketBodyNoradIds = new Set(existingRocketBodies.map(row => row.noradId).filter(id => id !== null));
            const newRocketBodies = rocketBodyBatch.filter(s => s.noradId && !existingRocketBodyNoradIds.has(s.noradId));

            const totalNewFound = newSatellites.length + newDebris.length + newRocketBodies.length;
            console.log(`Found new items to insert: ${newSatellites.length} satellites, ${newDebris.length} debris, ${newRocketBodies.length} rocket bodies.`);

            const toInsertSats = newSatellites.map(s => ({
                ...s,
                dataSource: "CELESTRAK",
                catalogStatus: "CORRELATED",
                isIndigenous: false,
                firstAddedAt: startedAt
            }));

            const toInsertDebris = newDebris.map(s => ({
                ...s,
                dataSource: "SPACETRACK",
                catalogStatus: "CORRELATED",
                isIndigenous: false,
                firstAddedAt: startedAt
            }));

            const toInsertRocketBodies = newRocketBodies.map(s => ({
                ...s,
                dataSource: "SPACETRACK",
                catalogStatus: "CORRELATED",
                isIndigenous: false,
                firstAddedAt: startedAt
            }));

            if (toInsertSats.length > 0) {
                await Satellite.bulkCreate(toInsertSats, { transaction });
            }
            if (toInsertDebris.length > 0) {
                await Debris.bulkCreate(toInsertDebris, { transaction });
            }
            if (toInsertRocketBodies.length > 0) {
                await RocketBody.bulkCreate(toInsertRocketBodies, { transaction });
            }

            console.log("Database records updated. Recording version...");
            const combinedBatch = [...satelliteBatch, ...debrisBatch, ...rocketBodyBatch];
            const version = await recordCatalogVersion(combinedBatch, transaction, { 
                syncedAt,
                sourceName: "Combined Space Catalog",
                sourceUrl: tleSourceUrl
            });
            versionId = version.id;

            const syncRun = await CatalogSyncRun.create({
                startedAt,
                completedAt: new Date(),
                totalBefore,
                totalAfter: totalBefore + totalNewFound,
                newSatellitesFound: totalNewFound
            }, { transaction });

            const allNewObjects = [...newSatellites, ...newDebris, ...newRocketBodies];
            if (allNewObjects.length > 0) {
                await CatalogSyncNewSatellite.bulkCreate(
                    allNewObjects.map(s => ({
                        syncRunId: syncRun.id,
                        noradId: s.noradId,
                        detectedAt: startedAt
                    })),
                    { transaction }
                );
            }
        });

        console.log("Persisting TLE history (bulk)...");
        const combinedBatch = [...satelliteBatch, ...debrisBatch, ...rocketBodyBatch];
        await persistTleRevisions(combinedBatch, versionId, {
            source: { name: "Combined Space Catalog", url: tleSourceUrl }
        }).catch(err => {
            console.error("TLE History background persistence failed:", err);
        });

        console.log("Evaluating re-entry risks for decaying objects...");
        const { evaluateReentryRisks } = require("./reentryPredictionService");
        await evaluateReentryRisks().catch(err => {
            console.error("Automated re-entry evaluation failed:", err);
        });

        clearSatelliteCatalogCache();
        console.log(`Successfully synced ${totalFetchedCount} objects.`);
        return totalFetchedCount;
    } catch (error) {
        console.error("Sync failed:", error);
        await recordCatalogEvent(null, {
            eventType: "catalog_sync_failed",
            severity: "error",
            message: `Catalog sync failed: ${error.message}`,
            details: { error: error.message }
        }).catch(() => {});
        throw error;
    }
}

module.exports = {
    fetchSatelliteCatalog,
    fetchSpaceTrackCatalog,
    parseTleCatalog,
    syncSatellites
};
