const assert = require("node:assert/strict");
const test = require("node:test");
const {
    analyzeConjunctionsFromRecords,
    analyzeNeighbourhoodWatchFromRecords
} = require("../backend/src/services/operationalAnalysisService");
const { createPropagationRecords } = require("../backend/src/services/orbitalPropagationService");

const sampleTles = [
    {
        name: "ISS (ZARYA)",
        line1: "1 25544U 98067A   24190.51005787  .00016717  00000+0  30209-3 0  9991",
        line2: "2 25544  51.6415  69.8797 0004104  55.9686  57.8839 15.50049121461236",
        noradId: 25544
    },
    {
        name: "GSAT-30",
        line1: "1 45026U 20001A   24189.97152813 -.00000289  00000+0  00000+0 0  9995",
        line2: "2 45026   0.0157 131.0697 0002224 120.0868 275.7848  1.00271314 16060",
        noradId: 45026,
        isIndian: true
    },
    {
        name: "EOS-01",
        line1: "1 46274U 20061A   24190.53638889  .00000120  00000+0  00000+0 0  9991",
        line2: "2 46274  97.4315 259.1784 0011207  90.1823 269.9878 15.22576520 20619",
        noradId: 46274,
        isIndian: true
    }
];

const area = {
    points: [
        { lat: -60, lon: -60 },
        { lat: -60, lon: 60 },
        { lat: 60, lon: 60 },
        { lat: 60, lon: -60 }
    ]
};

const analysisTime = "2026-01-01T00:00:00.000Z";

test("backend conjunction analysis stays deterministic for the sample catalog", () => {
    const records = createPropagationRecords(sampleTles);
    const result = analyzeConjunctionsFromRecords(records, area, analysisTime, 180, 25);

    assert.equal(result.currentOverheadCount, 1);
    assert.equal(result.currentVisibleCount, 0);
    assert.equal(result.currentIndianOverheadCount, 1);
    assert.equal(result.totalFuturePasses, 4);
    assert.equal(result.futureIndianPasses, 2);
    assert.equal(result.conjunctions.length, 0);
    assert.deepEqual(result.topPaths.map((pathItem) => pathItem.id), [
        "EOS-01",
        "ISS (ZARYA)",
        "EOS-01"
    ]);
});

test("backend neighbourhood watch stays deterministic for the sample catalog", () => {
    const records = createPropagationRecords(sampleTles);
    const result = analyzeNeighbourhoodWatchFromRecords(records, "GSAT-30", analysisTime, 1000);

    assert.equal(result.primaryId, "GSAT-30");
    assert.equal(result.primaryIsIndian, true);
    assert.equal(result.thresholdKm, 1000);
    assert.equal(result.alerts.length, 0);
});
