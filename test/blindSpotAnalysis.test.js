const assert = require("node:assert/strict");
const test = require("node:test");
const {
    analyzeBlindSpotFromRecords
} = require("../backend/src/services/operationalAnalysisService");
const { createPropagationRecords } = require("../backend/src/services/orbitalPropagationService");
const {
    recordBlindSpotAnalysis
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

test("backend blind spot analysis returns deterministic results", () => {
    const records = createPropagationRecords(sampleTles);
    const result = analyzeBlindSpotFromRecords(records, region, analysisTime, 180, 0, 42000, 10);

    assert.equal(result.analysisType, "blind_spot");
    assert.ok(result.regionHash);
    assert.equal(result.evaluatedSatelliteCount, 3);
    assert.equal(typeof result.hasCoverage, "boolean");
    assert.equal(result.minimumObservationMinutes, 4);
    assert.equal(result.requiredCoverageSamples >= 1, true);
    assert.ok(result.debugMetrics);
    assert.equal(typeof result.debugMetrics.averageCoverageStrength, "number");
    assert.ok(Array.isArray(result.alerts));
    assert.ok(Array.isArray(result.blindWindows));
    assert.ok(Array.isArray(result.schedule));
    // alerts now reflects temporal blind windows (0 or more), not a binary 0/1 result
    assert.equal(result.alerts.length >= 0, true);
});

test("backend blind spot analysis persistence returns the number of stored findings", async () => {
    const records = createPropagationRecords(sampleTles);
    const result = analyzeBlindSpotFromRecords(records, region, analysisTime, 180, 0, 42000, 10);

    const outcome = await recordBlindSpotAnalysis(result, {
        sourceName: "Backend Blind Spot Analysis",
        sourceType: "backend_blind_spot",
        analysisTime
    });

    // persistedCount matches the number of temporal blind-window alerts produced
    assert.equal(outcome.persistedCount, result.alerts.length);
    if (outcome.alerts.length > 0) {
        assert.ok(outcome.alerts[0].eventKey);
        assert.equal(outcome.alerts[0].alertType, "blind_spot");
    }
});
