const assert = require("node:assert/strict");
const test = require("node:test");
const {
    analyzeRegionScanFromRecords
} = require("../backend/src/services/operationalAnalysisService");
const { createPropagationRecords } = require("../backend/src/services/orbitalPropagationService");
const {
    recordRegionScanAnalysis
} = require("../backend/src/services/operationalAlertService");

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

const region = {
    points: [
        { lat: -60, lon: -60 },
        { lat: -60, lon: 60 },
        { lat: 60, lon: 60 },
        { lat: 60, lon: -60 }
    ]
};

const analysisTime = "2026-01-01T00:00:00.000Z";

test("backend volumetric region scan returns deterministic alerts", () => {
    const records = createPropagationRecords(sampleTles);
    const result = analyzeRegionScanFromRecords(records, region, analysisTime, 180, 0, 42000, 25);

    assert.equal(result.analysisType, "volumetric_scan");
    assert.ok(result.regionHash);
    assert.equal(result.passes.length, 4);
    assert.equal(result.alerts.length, 4);
    assert.deepEqual(result.topPaths.map((pathItem) => pathItem.id), [
        "EOS-01",
        "ISS (ZARYA)",
        "EOS-01"
    ]);
    assert.equal(result.alerts[0].severity, "warning");
});

test("backend volumetric region scan persistence returns the number of stored findings", async () => {
    const records = createPropagationRecords(sampleTles);
    const result = analyzeRegionScanFromRecords(records, region, analysisTime, 180, 0, 42000, 25);

    const outcome = await recordRegionScanAnalysis(result, {
        sourceName: "Backend Volumetric Scan",
        sourceType: "backend_volumetric_scan",
        analysisTime
    });

    assert.equal(outcome.persistedCount, 4);
    assert.equal(outcome.alerts.length, 4);
    assert.ok(outcome.alerts[0].eventKey);
    assert.equal(outcome.alerts[0].alertType, "volumetric_scan");
});
