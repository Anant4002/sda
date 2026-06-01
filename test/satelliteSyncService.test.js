const test = require("node:test");
const assert = require("node:assert/strict");
const satelliteSyncService = require("../backend/src/services/satelliteSyncService");
const { parseTleCatalog, syncSatellites } = satelliteSyncService;
const axios = require("axios");
const { sequelize } = require("../backend/src/db");
const { Satellite } = require("../backend/src/models/satellite");
const { SatelliteCatalogVersion } = require("../backend/src/models/satelliteCatalogVersion");
const { CatalogEvent } = require("../backend/src/models/catalogEvent");
const { CatalogSyncRun } = require("../backend/src/models/catalogSyncRun");
const { CatalogSyncNewSatellite } = require("../backend/src/models/catalogSyncNewSatellite");

const sampleCatalog = [ 
    "ISS (ZARYA)",
    "1 25544U 98067A   24190.51005787  .00016717  00000+0  30209-3 0  9991",
    "2 25544  51.6415  69.8797 0004104  55.9686  57.8839 15.50049121461236",
    "BROKEN ENTRY",
    "this is not a tle line",
    "still not a tle line",
    "GSAT-30",
    "1 45026U 20001A   24189.97152813 -.00000289  00000+0  00000+0 0  9995",
    "2 45026   0.0157 131.0697 0002224 120.0868 275.7848  1.00271314 16060"
].join("\n");

test("parseTleCatalog keeps valid TLE triplets and skips malformed ones", () => {
    const satellites = parseTleCatalog(sampleCatalog);

    assert.equal(satellites.length, 2);
    assert.deepEqual(
        satellites.map((satellite) => satellite.name),
        ["ISS (ZARYA)", "GSAT-30"]
    );
    assert.equal(satellites[0].noradId, 25544);
    assert.equal(satellites[1].noradId, 45026);
});

test("parseTleCatalog returns an empty array for empty input", () => {
    assert.deepEqual(parseTleCatalog(""), []);
    assert.deepEqual(parseTleCatalog(null), []);
});

test("syncSatellites records a catalog version and audit event", async () => {
    const originalAxiosGet = axios.get;
    const originalTransaction = sequelize.transaction;
    const originalFindAll = Satellite.findAll;
    const originalDestroy = Satellite.destroy;
    const originalBulkCreate = Satellite.bulkCreate;
    const originalVersionCreate = SatelliteCatalogVersion.create;
    const originalEventCreate = CatalogEvent.create;
    const originalSyncRunCreate = CatalogSyncRun.create;
    const originalNewSatelliteBulkCreate = CatalogSyncNewSatellite.bulkCreate;

    const sampleBatch = parseTleCatalog(sampleCatalog);
    const createCalls = [];
    const eventCalls = [];

    axios.get = async () => ({ data: sampleCatalog });
    sequelize.transaction = async (callback) => callback({ id: "mock-tx-id" });
    Satellite.findAll = async () => [];
    Satellite.destroy = async () => undefined;
    Satellite.bulkCreate = async () => undefined;
    SatelliteCatalogVersion.create = async (payload) => {
        createCalls.push(payload);
        return { id: 1, ...payload };
    };
    CatalogEvent.create = async (payload) => {
        eventCalls.push(payload);
        return payload;
    };
    CatalogSyncRun.create = async (payload) => {
        return { id: 1, ...payload };
    };
    CatalogSyncNewSatellite.bulkCreate = async () => undefined;

    try {
        const syncedCount = await syncSatellites();

        assert.equal(syncedCount, sampleBatch.length);
        assert.equal(createCalls.length, 1);
        assert.equal(eventCalls.length, 1);
        assert.equal(createCalls[0].recordCount, sampleBatch.length);
        assert.equal(createCalls[0].status, "success");
        assert.match(eventCalls[0].message, /Synced 2 satellites/i);
    } finally {
        axios.get = originalAxiosGet;
        sequelize.transaction = originalTransaction;
        Satellite.findAll = originalFindAll;
        Satellite.destroy = originalDestroy;
        Satellite.bulkCreate = originalBulkCreate;
        SatelliteCatalogVersion.create = originalVersionCreate;
        CatalogEvent.create = originalEventCreate;
        CatalogSyncRun.create = originalSyncRunCreate;
        CatalogSyncNewSatellite.bulkCreate = originalNewSatelliteBulkCreate;
    }
});
