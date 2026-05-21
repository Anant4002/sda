const test = require("node:test");
const assert = require("node:assert/strict");
const { sequelize } = require("../backend/src/db");
const { OperationalAlert } = require("../backend/src/models/operationalAlert");
const {
    listOperationalAlerts,
    recordConjunctionAnalysis,
    recordNeighbourhoodWatchAnalysis
} = require("../backend/src/services/operationalAlertService");

const sampleAnalysis = {
    area: {
        centroid: {
            lat: 28.6139,
            lon: 77.209
        }
    },
    horizonMinutes: 180,
    conjunctionThresholdKm: 25,
    conjunctionSampleSeconds: 45,
    conjunctions: [
        {
            primaryId: "SAT-A",
            secondaryId: "SAT-B",
            closestDistanceKm: 7.5,
            time: "2026-01-01T00:00:00.000Z"
        },
        {
            primaryId: "SAT-C",
            secondaryId: "SAT-D",
            closestDistanceKm: 21.25,
            time: "2026-01-01T00:10:00.000Z"
        }
    ]
};

test("recordConjunctionAnalysis persists deterministic operational alerts", async () => {
    await sequelize.sync();
    await OperationalAlert.destroy({ where: {} });

    try {
        const firstResult = await recordConjunctionAnalysis(sampleAnalysis, {
            sourceName: "Frontend Region Analysis",
            sourceType: "frontend_analysis",
            analysisTime: "2026-01-01T00:15:00.000Z"
        });

        assert.equal(firstResult.persistedCount, 2);

        const alerts = await listOperationalAlerts({ limit: 5, alertType: "conjunction" });
        assert.equal(alerts.length, 2);
        assert.equal(alerts[0].primaryId, "SAT-C");
        assert.equal(alerts[0].secondaryId, "SAT-D");
        assert.equal(alerts[0].severity, "warning");
        assert.equal(alerts[1].severity, "critical");

        const secondResult = await recordConjunctionAnalysis(sampleAnalysis, {
            sourceName: "Frontend Region Analysis",
            sourceType: "frontend_analysis",
            analysisTime: "2026-01-01T00:15:00.000Z"
        });

        assert.equal(secondResult.persistedCount, 2);
        const alertsAfterSecondWrite = await listOperationalAlerts({ limit: 5, alertType: "conjunction" });
        assert.equal(alertsAfterSecondWrite.length, 2);
    } finally {
        await OperationalAlert.destroy({ where: {} });
    }
});

test("recordNeighbourhoodWatchAnalysis persists nearby satellite alerts with relative velocity", async () => {
    await sequelize.sync();
    await OperationalAlert.destroy({ where: {} });

    const watchResult = {
        primaryId: "GSAT-30",
        thresholdKm: 1000,
        sampleSeconds: 0,
        time: "2026-01-01T00:00:00.000Z",
        alerts: [
            {
                primaryId: "GSAT-30",
                secondaryId: "SAT-B",
                closestDistanceKm: 180.75,
                relativeVelocityKmS: 12.345,
                time: "2026-01-01T00:00:00.000Z",
                severity: "warning"
            }
        ]
    };

    try {
        const outcome = await recordNeighbourhoodWatchAnalysis(watchResult, {
            sourceName: "Frontend Neighborhood Watch",
            sourceType: "frontend_neighbourhood_watch",
            analysisTime: "2026-01-01T00:15:00.000Z"
        });

        assert.equal(outcome.persistedCount, 1);

        const alerts = await listOperationalAlerts({ limit: 5, alertType: "neighbourhood_watch" });
        assert.equal(alerts.length, 1);
        assert.equal(alerts[0].primaryId, "GSAT-30");
        assert.equal(alerts[0].secondaryId, "SAT-B");
        assert.equal(alerts[0].alertType, "neighbourhood_watch");
        assert.equal(alerts[0].details.relativeVelocityKmS, 12.345);
    } finally {
        await OperationalAlert.destroy({ where: {} });
    }
});
