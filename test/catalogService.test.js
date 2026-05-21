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
    seedCatalogHistoryIfMissing
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
