const test = require("node:test");
const assert = require("node:assert/strict");
const { predictSatelliteReentry, checkStrategicRisks } = require("../backend/src/services/reentryPredictionService");
const tleRevisionHistoryService = require("../backend/src/services/tleRevisionHistoryService");
const operationalAlertService = require("../backend/src/services/operationalAlertService");

test("predictSatelliteReentry calculates decay and simulation correctly", async () => {
    const originalGetHistory = tleRevisionHistoryService.getRevisionHistory;
    const originalRecordAlert = operationalAlertService.recordOperationalAlert;

    // Create a mock history showing decay
    const dayMs = 24 * 60 * 60 * 1000;
    const now = Date.now();
    
    // TLEs for a decaying satellite (e.g. Tiangong-1 like decay)
    const mockHistory = [
        { 
            line1: "1 37820U 11053A   18086.54705572  .01185012  13682-4  18408-4 0  9990",
            line2: "2 37820  42.7533 194.5029 0013233 302.2619 160.7831 16.20846051373549",
            semiMajorAxisKm: 6540, perigeeKm: 160, tleEpoch: new Date(now - 2 * dayMs) 
        },
        { 
            line1: "1 37820U 11053A   18089.54705572  .01285012  13682-4  18408-4 0  9990",
            line2: "2 37820  42.7533 194.5029 0013233 302.2619 160.7831 16.24846051373549",
            semiMajorAxisKm: 6530, perigeeKm: 150, tleEpoch: new Date(now - 1 * dayMs) 
        },
        { 
            line1: "1 37820U 11053A   18091.54705572  .01485012  13682-4  18408-4 0  9990",
            line2: "2 37820  42.7533 194.5029 0013233 302.2619 160.7831 16.29846051373549",
            semiMajorAxisKm: 6520, perigeeKm: 140, tleEpoch: new Date(now) 
        }
    ];

    tleRevisionHistoryService.getRevisionHistory = async () => mockHistory;
    operationalAlertService.recordOperationalAlert = async () => ({ id: 1 });

    try {
        const prediction = await predictSatelliteReentry(37820, "TIANGONG-1");

        assert.equal(prediction.status, "decaying");
        assert.equal(prediction.riskLevel, "HIGH"); // Altitude < 200
        assert.ok(prediction.estimatedReentryDate);
        assert.ok(Array.isArray(prediction.impactCorridor));
        assert.ok(prediction.impactCorridor.length > 0);
    } finally {
        tleRevisionHistoryService.getRevisionHistory = originalGetHistory;
        operationalAlertService.recordOperationalAlert = originalRecordAlert;
    }
});

test("predictSatelliteReentry detects stable orbits above 400km and includes perigee", async () => {
    const originalGetHistory = tleRevisionHistoryService.getRevisionHistory;
    
    const now = Date.now();
    const mockHistory = [
        { 
            line1: "1 25544U 98067A   21123.54705572  .00001012  00000-0  18408-4 0  9990",
            line2: "2 25544  51.6433 194.5029 0003233 302.2619 160.7831 15.48846051373549",
            semiMajorAxisKm: 6790, perigeeKm: 410, tleEpoch: new Date(now) 
        }
    ];

    tleRevisionHistoryService.getRevisionHistory = async () => mockHistory;

    try {
        const prediction = await predictSatelliteReentry(25544, "ISS");
        assert.equal(prediction.status, "stable");
        assert.equal(prediction.riskLevel, "LOW");
        assert.equal(prediction.currentPerigeeKm, 410);
        assert.equal(prediction.currentAltitudeKm, 419); // 6790 - 6371
    } finally {
        tleRevisionHistoryService.getRevisionHistory = originalGetHistory;
    }
});

test("checkStrategicRisks identifies nearby installations", () => {
    // Sriharikota is at 13.720, 80.230
    const corridor = [
        { lat: 13.7, lon: 80.2, alt: 100 },
        { lat: 13.8, lon: 80.3, alt: 90 }
    ];
    
    const risks = checkStrategicRisks(corridor);
    assert.ok(risks.length > 0);
    assert.ok(risks.some(r => r.name === "Sriharikota"));
});
