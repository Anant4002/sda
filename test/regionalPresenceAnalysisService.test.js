const assert = require("node:assert/strict");
const test = require("node:test");

const {
    compareVisibilityWindows,
    computePresenceChangeScore,
    detectUnexpectedRegionalAccess
} = require("../backend/src/services/regionalPresenceAnalysisService");

const sampleHistory = [
    {
        noradId: 45026,
        satelliteName: "RISAT-30",
        line2: "2 45026   0.0157 131.0697 0002224 120.0868 275.7848  1.00271314 16060",
        tleEpoch: new Date("2025-12-10T00:00:00.000Z"),
        ingestedAt: new Date("2025-12-10T00:00:00.000Z")
    },
    {
        noradId: 45026,
        satelliteName: "RISAT-30",
        line2: "2 45026   0.0157 131.0697 0002224 120.0868 275.7848  1.00271314 16060",
        tleEpoch: new Date("2026-01-20T00:00:00.000Z"),
        ingestedAt: new Date("2026-01-20T00:00:00.000Z")
    }
];

const delhiArea = {
    name: "Delhi",
    points: [
        { lat: 28.20, lon: 76.85 },
        { lat: 28.20, lon: 77.45 },
        { lat: 28.95, lon: 77.45 },
        { lat: 28.95, lon: 76.85 }
    ]
};

test("compareVisibilityWindows and scoring respond to rising access", () => {
    const comparison = compareVisibilityWindows(
        {
            passCount: 0,
            visibilityMinutes: 0,
            coveragePercent: 0,
            averageCoverageStrength: 0
        },
        {
            passCount: 5,
            visibilityMinutes: 300,
            coveragePercent: 41.6,
            averageCoverageStrength: 0.66
        }
    );

    const score = computePresenceChangeScore(comparison, { driftMagnitudeKm: 12 });

    assert.equal(comparison.previousPassCount, 0);
    assert.equal(comparison.recentPassCount, 5);
    assert.ok(comparison.revisitChangePercent > 0);
    assert.ok(score > 0.5);
});

test("detectUnexpectedRegionalAccess flags sustained new access and emits debug metrics", () => {
    const recentStart = Date.parse("2026-01-18T00:00:00.000Z");
    const result = detectUnexpectedRegionalAccess({
        history: sampleHistory,
        area: delhiArea,
        time: "2026-02-01T00:00:00.000Z",
        timeframeDays: 30,
        sampleMinutes: 30,
        visibilityThresholdDeg: 10,
        maxFindings: 5,
        dependencies: {
            propagateState: (_record, date) => {
                const isRecent = date.getTime() >= recentStart;
                const isVisible = isRecent && new Date(date).getUTCDate() % 2 === 0;
                return {
                    eci: { x: 0, y: 0, z: 0 },
                    elevationDeg: isVisible ? 55 : -10,
                    rangeKm: isVisible ? 1200 : 1200
                };
            }
        }
    });

    assert.equal(result.analysisType, "regional_presence");
    assert.equal(result.region.name, "Delhi");
    assert.equal(result.findings.length, 1);
    assert.equal(result.findings[0].unexpectedRegionalPresence, true);
    assert.equal(result.findings[0].previousPassCount, 0);
    assert.ok(result.findings[0].recentPassCount >= 2);
    assert.ok(result.findings[0].confidenceScore > 0.5);
    assert.ok(result.debugMetrics.coveragePassRate > 0);
    assert.equal(result.debugMetrics.persistenceSuppressedCount, 0);
    assert.equal(typeof result.findings[0].recentAverageRevisitIntervalMinutes, "number");
});

test("detectUnexpectedRegionalAccess suppresses one-off transient visibility", () => {
    const splitEpoch = Date.parse("2026-01-16T00:00:00.000Z");
    const result = detectUnexpectedRegionalAccess({
        history: sampleHistory,
        area: delhiArea,
        time: "2026-02-01T00:00:00.000Z",
        timeframeDays: 30,
        sampleMinutes: 30,
        visibilityThresholdDeg: 10,
        maxFindings: 5,
        dependencies: {
            propagateState: (_record, date) => {
                const isSinglePass = date.getTime() >= splitEpoch && date.getUTCDate() === 26 && date.getUTCHours() === 6 && date.getUTCMinutes() === 0;
                return {
                    eci: { x: 0, y: 0, z: 0 },
                    elevationDeg: isSinglePass ? 55 : -10,
                    rangeKm: 1200
                };
            }
        }
    });

    assert.equal(result.findings.length, 0);
    assert.equal(result.debugMetrics.persistenceSuppressedCount, 1);
});
