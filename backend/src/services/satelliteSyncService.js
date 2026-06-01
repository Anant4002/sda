const axios = require("axios");
const { Satellite } = require("../models/satellite");
const { sequelize } = require("../db");
const { catalogSource, tleSourceUrl } = require("../config");
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
        console.log("Fetching TLE data from CelesTrak...");
        let satelliteBatch;
        try {
            const startFetch = Date.now();
            satelliteBatch = await fetchSatelliteCatalog();
            console.log(`Fetched ${satelliteBatch.length} satellites in ${Date.now() - startFetch}ms`);
        } catch (error) {
            if (error.response && error.response.status === 403) {
                console.log("CelesTrak catalog not yet updated or access limited (403). Recording check-in time.");
                // Record a "baseline" version so the UI shows we checked
                await sequelize.transaction(async (transaction) => {
                    const existingSats = await Satellite.findAll({ transaction });
                    await recordCatalogVersion(existingSats, transaction, { 
                        status: "baseline",
                        errorMessage: "Source returned 403 (Rate limited or No Update)" 
                    });

                    // Record a sync run with 0 new satellites to update the verification timestamp
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

        if (!satelliteBatch.length) throw new Error("No satellites were parsed from the TLE source.");

        const syncedAt = new Date();
        let versionId = null;

        // Step 1: Main Update Transaction (Fast)
        console.log("Starting database update transaction and manoeuvre evaluation...");
        await sequelize.transaction(async (transaction) => {
            const existingRows = await Satellite.findAll({ transaction });
            console.log(`Comparing with ${existingRows.length} existing satellites...`);
            
            const previousSatellites = existingRows.map((row) => serializeSatellite(row));
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

            // Compare incoming NORAD IDs against satellites already stored in the database
            const existingNoradIds = new Set(
                existingRows.map(row => row.noradId).filter(id => id !== null && id !== undefined)
            );
            const newSatellites = satelliteBatch.filter(s => s.noradId && !existingNoradIds.has(s.noradId));
            
            console.log(`Found ${newSatellites.length} new satellites to insert out of ${satelliteBatch.length} fetched TLEs.`);

            // Prepare batch for insertion
            const toInsert = newSatellites.map(s => {
                return {
                    ...s,
                    dataSource: "CELESTRAK",
                    catalogStatus: "CORRELATED",
                    isIndigenous: false,
                    firstAddedAt: startedAt
                };
            });

            if (toInsert.length > 0) {
                await Satellite.bulkCreate(toInsert, { transaction });
            }
            console.log("Satellite records updated. Recording version...");
            const version = await recordCatalogVersion(satelliteBatch, transaction, { syncedAt });
            versionId = version.id;

            // Create a sync run record
            const syncRun = await CatalogSyncRun.create({
                startedAt,
                completedAt: new Date(),
                totalBefore: existingRows.length,
                totalAfter: existingRows.length + newSatellites.length,
                newSatellitesFound: newSatellites.length
            }, { transaction });

            // Store every newly detected NORAD ID
            if (newSatellites.length > 0) {
                await CatalogSyncNewSatellite.bulkCreate(
                    newSatellites.map(s => ({
                        syncRunId: syncRun.id,
                        noradId: s.noradId,
                        detectedAt: startedAt
                    })),
                    { transaction }
                );
            }
        });

        // Step 2: Historical Persistence (Separate, optimized bulk)
        // This no longer blocks the main Satellite table for several minutes.
        console.log("Persisting TLE history (bulk)...");
        await persistTleRevisions(satelliteBatch, versionId, {
            source: { name: catalogSource.name, url: catalogSource.url }
        }).catch(err => {
            console.error("TLE History background persistence failed:", err);
        });

        // Step 3: Automated Re-entry Monitoring (Proposal Requirement 5)
        console.log("Evaluating re-entry risks for decaying objects...");
        const { evaluateReentryRisks } = require("./reentryPredictionService");
        await evaluateReentryRisks().catch(err => {
            console.error("Automated re-entry evaluation failed:", err);
        });

        clearSatelliteCatalogCache();
        console.log(`Successfully synced ${satelliteBatch.length} satellites.`);
        return satelliteBatch.length;
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
    parseTleCatalog,
    syncSatellites
};
