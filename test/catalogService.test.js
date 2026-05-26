const test = require("node:test");
const assert = require("node:assert/strict");
const { sequelize } = require("../backend/src/db");
const { Satellite } = require("../backend/src/models/satellite");
const { SatelliteCatalogVersion } = require("../backend/src/models/satelliteCatalogVersion");
const { CatalogEvent } = require("../backend/src/models/catalogEvent");
const {
    getCatalogStatus,
    listCatalogEvents,
    listCatalogHistory,
    seedCatalogHistoryIfMissing,
    updateSatelliteIntData
} = require("../backend/src/services/satelliteCatalogService");

test("catalog status and history helpers return plain JSON records", async () => {
    await sequelize.sync();

    await CatalogEvent.destroy({ where: {} });
    await SatelliteCatalogVersion.destroy({ where: {} });

    const version = await SatelliteCatalogVersion.create({
        sourceName: "Test Source",
        sourceUrl: "https://example.com/tle",
        fetchedAt: new Date("2026-01-01T00:00:00Z"),
        syncedAt: new Date("2026-01-01T00:00:05Z"),
        recordCount: 42,
        checksum: "abc123",
        status: "success"
    });

    await CatalogEvent.create({
        eventType: "catalog_sync",
        severity: "info",
        message: "Synced 42 satellites from Test Source.",
        details: {
            recordCount: 42
        },
        sourceName: "Test Source",
        sourceUrl: "https://example.com/tle",
        versionId: version.id
    });

    try {
        const status = await getCatalogStatus();
        const history = await listCatalogHistory(5);
        const events = await listCatalogEvents(5);

        assert.equal(status.currentCount > 0, true);
        assert.equal(status.latestVersion.sourceName, "Test Source");
        assert.equal(typeof status.dataAgeSeconds, "number");
        assert.equal(Array.isArray(history), true);
        assert.equal(history[0].sourceName, "Test Source");
        assert.equal(Array.isArray(events), true);
        assert.equal(events[0].message, "Synced 42 satellites from Test Source.");
    } finally {
        await CatalogEvent.destroy({ where: {} });
        await SatelliteCatalogVersion.destroy({ where: {} });
    }
});

test("seedCatalogHistoryIfMissing creates a baseline snapshot when history is empty", async () => {
    await sequelize.sync();
    await CatalogEvent.destroy({ where: {} });
    await SatelliteCatalogVersion.destroy({ where: {} });

    try {
        const seeded = await seedCatalogHistoryIfMissing();
        assert.equal(seeded, true);

        const status = await getCatalogStatus();
        assert.equal(status.latestVersion.sourceName, "CelesTrak Active Catalog");
        assert.equal(status.latestVersion.status, "baseline");
        assert.equal(typeof status.dataAgeSeconds, "number");
    } finally {
        await CatalogEvent.destroy({ where: {} });
        await SatelliteCatalogVersion.destroy({ where: {} });
    }
});

test("updateSatelliteIntData finds satellite by name", async () => {
    await sequelize.sync();
    
    const satName = "TEST-SAT-123 (POC)";
    const sat = await Satellite.create({
        name: satName,
        line1: "1 12345U 26001A   26145.12345678  .00000000  00000-0  00000-0 0  9999",
        line2: "2 12345  98.7654 123.4567 0001234  45.6789 314.5678 14.32109876    16",
        noradId: 12345
    });

    try {
        const intData = "Some intelligence data";
        const updated = await updateSatelliteIntData(satName, intData);
        
        assert.equal(updated.name, satName);
        assert.equal(updated.intData, intData);
        
        const reloaded = await Satellite.findByPk(sat.id);
        assert.equal(reloaded.intData, intData);
    } finally {
        await sat.destroy();
    }
});

test("updateSatelliteIntData finds satellite by numeric ID", async () => {
    await sequelize.sync();
    
    const sat = await Satellite.create({
        name: "TEST-SAT-456",
        line1: "1 45678U 26001B   26145.12345678  .00000000  00000-0  00000-0 0  9999",
        line2: "2 45678  98.7654 123.4567 0001234  45.6789 314.5678 14.32109876    16",
        noradId: 45678
    });

    try {
        const intData = "ID-based update";
        const updated = await updateSatelliteIntData(sat.id.toString(), intData);
        
        assert.equal(updated.id, sat.id);
        assert.equal(updated.intData, intData);
    } finally {
        await sat.destroy();
    }
});
