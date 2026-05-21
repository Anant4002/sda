const test = require("node:test");
const assert = require("node:assert/strict");
const {
    evaluateCatalogManoeuvres,
    analyzeSatelliteManoeuvreHistory,
    DEFAULT_THRESHOLDS
} = require("../backend/src/services/manoeuvreDetectionService");
const tleRevisionHistoryService = require("../backend/src/services/tleRevisionHistoryService");

test("analyzeSatelliteManoeuvreHistory identifies manoeuvres in series", async () => {
    const originalGetHistory = tleRevisionHistoryService.getRevisionHistory;

    // Mock history: 3 TLEs, with a significant change between 2 and 3
    const mockHistory = [
        {
            satelliteName: "TEST-SAT",
            noradId: 12345,
            line1: "1 12345U 24001A   24001.00000000  .00000000  00000+0  00000+0 0  9991",
            line2: "2 12345  51.0000  0.0000 0000001   0.0000   0.0000 15.00000000    12",
            tleEpoch: new Date("2024-01-01T00:00:00Z"),
            tleChecksum: "hash1"
        },
        {
            satelliteName: "TEST-SAT",
            noradId: 12345,
            line1: "1 12345U 24001A   24002.00000000  .00000000  00000+0  00000+0 0  9991",
            line2: "2 12345  51.0000  0.0000 0000001   0.0000   0.0000 15.00000000    23",
            tleEpoch: new Date("2024-01-02T00:00:00Z"),
            tleChecksum: "hash2"
        },
        {
            satelliteName: "TEST-SAT",
            noradId: 12345,
            line1: "1 12345U 24001A   24003.00000000  .00000000  00000+0  00000+0 0  9991",
            line2: "2 12345  52.0000  0.0000 0000001   0.0000   0.0000 15.00000000    34", // 1 degree inclination change
            tleEpoch: new Date("2024-01-03T00:00:00Z"),
            tleChecksum: "hash3"
        }
    ];

    tleRevisionHistoryService.getRevisionHistory = async () => mockHistory;

    try {
        const analysis = await analyzeSatelliteManoeuvreHistory(12345, "TEST-SAT");
        
        assert.equal(analysis.evaluatedRevisions, 3);
        // Should find 1 manoeuvre (between 2 and 3)
        // Note: 1 and 2 are identical orbital elements, just different epochs. 
        // evaluatePair returns null if lines are same, but here checksums are different (epoch changed).
        // However, orbital elements are same, so it might be a "routine" or nothing if below thresholds.
        
        assert.ok(analysis.manoeuvres.length >= 1);
        const manoeuvre = analysis.manoeuvres.find(m => m.orbitalElementDelta.inclinationDeg > 0.5);
        assert.ok(manoeuvre);
        assert.equal(manoeuvre.classification, "significant_manoeuvre");
    } finally {
        tleRevisionHistoryService.getRevisionHistory = originalGetHistory;
    }
});

test("evaluateCatalogManoeuvres correctly identifies changes between batches", async () => {
    const previous = [
        {
            name: "SAT-1",
            noradId: 11111,
            line1: "1 11111U 24001A   24001.00000000  .00000000  00000+0  00000+0 0  9991",
            line2: "2 11111  51.0000  0.0000 0000001   0.0000   0.0000 15.00000000    12"
        }
    ];
    const incoming = [
        {
            name: "SAT-1",
            noradId: 11111,
            line1: "1 11111U 24001A   24002.00000000  .00000000  00000+0  00000+0 0  9991",
            line2: "2 11111  52.0000  0.0000 0000001   0.0000   0.0000 15.00000000    12"
        }
    ];

    const result = await evaluateCatalogManoeuvres({
        previousSatellites: previous,
        incomingSatellites: incoming,
        referenceDate: new Date("2024-01-02T00:00:00Z")
    });

    assert.equal(result.evaluatedPairs, 1);
    assert.equal(result.findings.length, 1);
    assert.equal(result.findings[0].classification, "significant_manoeuvre");
});
