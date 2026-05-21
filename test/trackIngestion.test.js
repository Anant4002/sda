const test = require("node:test");
const assert = require("node:assert/strict");
const { sequelize } = require("../backend/src/db");
const { Satellite } = require("../backend/src/models/satellite");
const { ingestTrackObservation } = require("../backend/src/services/satelliteCatalogService");

test("ingestTrackObservation correlates against existing catalog", async () => {
    await sequelize.sync();

    // 1. Create a "Known" satellite
    const knownSat = await Satellite.create({
        name: "TEST-SAT-CORRELATED",
        line1: "1 88888U 26001A   26135.52857639  .00000000  00000-0  00000-0 0  9990",
        line2: "2 88888  12.3456 123.4567 0001234 045.6789 314.3210 00.50000000000012",
        catalogStatus: "CORRELATED",
        isIndigenous: true
    });

    try {
        // 2. Ingest a track that is VERY SIMILAR (Correlation should match)
        const resultMatched = await ingestTrackObservation({
            name: "OBSERVATION-MATCH",
            line1: "1 88888U 26001A   26135.52857639  .00000000  00000-0  00000-0 0  9990",
            line2: "2 88888  12.3457 123.4568 0001235 045.6790 314.3211 00.50000001000013", // Tiny delta
            intData: "Matched track notes"
        });

        assert.equal(resultMatched.correlationResult, "MATCHED");
        assert.equal(resultMatched.matchedWith, "TEST-SAT-CORRELATED");

        // 3. Ingest a track that is COMPLETELY DIFFERENT (Correlation should fail -> NEW UCT)
        const resultNewUct = await ingestTrackObservation({
            name: "OBSERVATION-UNKNOWN",
            line1: "1 99999U 26001A   26135.52857639  .00000000  00000-0  00000-0 0  9990",
            line2: "2 99999 123.4567 123.4567 0001234 045.6789 314.3210 05.43210000000012",
            intData: "Unknown track notes"
        });

        assert.equal(resultNewUct.correlationResult, "NEW_UCT");
        assert.equal(resultNewUct.catalogStatus, "UNCORRELATED");
        assert.ok(resultNewUct.characterisation.sensorRecommendations);
        assert.equal(resultNewUct.characterisation.sensorRecommendations.length > 0, true);

    } finally {
        await Satellite.destroy({ where: { name: ["TEST-SAT-CORRELATED", "OBSERVATION-MATCH", "OBSERVATION-UNKNOWN"] } });
    }
});
