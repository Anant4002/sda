const test = require("node:test");
const assert = require("node:assert/strict");
const {
    tleChecksum,
    extractTleEpoch,
    estimateOrbitalAltitudes,
    parseOrbitalMetricsFromTle,
    persistTleRevisions,
    getLatestRevisionForSatellite,
    getRevisionHistory
} = require("../backend/src/services/tleRevisionHistoryService");
const { SatelliteTleRevision } = require("../backend/src/models/satelliteTleRevision");

test("tleChecksum generates consistent SHA256 hashes", () => {
    const line1 = "1 25544U 98067A   24190.51005787  .00016717  00000+0  30209-3 0  9991";
    const line2 = "2 25544  51.6415  69.8797 0004104  55.9686  57.8839 15.50049121461236";
    const hash = tleChecksum(line1, line2);
    assert.equal(typeof hash, "string");
    assert.equal(hash.length, 64);
    assert.equal(hash, tleChecksum(line1, line2));
});

test("extractTleEpoch parses epoch correctly from line 1", () => {
    const line1 = "1 25544U 98067A   24190.51005787  .00016717  00000+0  30209-3 0  9991";
    const epoch = extractTleEpoch(line1);
    assert.ok(epoch instanceof Date);
    assert.equal(epoch.getUTCFullYear(), 2024);
    // 190th day of 2024 is July 8
    assert.equal(epoch.getUTCMonth(), 6); // July is 6
    assert.equal(epoch.getUTCDate(), 8);
});

test("estimateOrbitalAltitudes computes reasonable values", () => {
    // ISS approximate values: 15.5 rev/day, 0.0004 eccentricity
    const metrics = estimateOrbitalAltitudes(15.5, 0.0004);
    assert.ok(metrics.semiMajorAxisKm > 6700 && metrics.semiMajorAxisKm < 6800);
    assert.ok(metrics.perigeeKm > 400 && metrics.perigeeKm < 430);
    assert.ok(metrics.apogeeKm > 400 && metrics.apogeeKm < 430);
});

test("persistTleRevisions handles deduplication and persistence", async () => {
    const originalFindAll = SatelliteTleRevision.findAll;
    const originalBulkCreate = SatelliteTleRevision.bulkCreate;

    const satellites = [
        {
            name: "ISS (ZARYA)",
            line1: "1 25544U 98067A   24190.51005787  .00016717  00000+0  30209-3 0  9991",
            line2: "2 25544  51.6415  69.8797 0004104  55.9686  57.8839 15.50049121461236",
            noradId: 25544
        }
    ];

    let bulkCreateCalled = 0;

    // First run: new entry
    SatelliteTleRevision.findAll = async () => [];
    SatelliteTleRevision.bulkCreate = async () => { bulkCreateCalled++; return []; };

    const result1 = await persistTleRevisions(satellites, 1);
    assert.equal(result1.persisted, 1);
    assert.equal(result1.skipped, 0);
    assert.equal(bulkCreateCalled, 1);

    // Second run: duplicate entry
    const csum = tleChecksum(satellites[0].line1, satellites[0].line2);
    SatelliteTleRevision.findAll = async () => [{ satelliteName: satellites[0].name, tleChecksum: csum }];
    bulkCreateCalled = 0;
    const result2 = await persistTleRevisions(satellites, 1);
    assert.equal(result2.persisted, 0);
    assert.equal(result2.skipped, 1);
    assert.equal(bulkCreateCalled, 0);

    SatelliteTleRevision.findAll = originalFindAll;
    SatelliteTleRevision.bulkCreate = originalBulkCreate;
});

test("Retrieval helpers call model methods correctly", async () => {
    const originalFindOne = SatelliteTleRevision.findOne;
    const originalFindAll = SatelliteTleRevision.findAll;

    SatelliteTleRevision.findOne = async () => ({ get: () => ({ id: 1 }) });
    SatelliteTleRevision.findAll = async () => [{ get: () => ({ id: 1 }) }];

    const latest = await getLatestRevisionForSatellite(25544, "ISS");
    assert.equal(latest.id, 1);

    const history = await getRevisionHistory(25544, "ISS");
    assert.equal(history.length, 1);
    assert.equal(history[0].id, 1);

    SatelliteTleRevision.findOne = originalFindOne;
    SatelliteTleRevision.findAll = originalFindAll;
});
