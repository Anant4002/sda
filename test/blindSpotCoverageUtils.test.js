const assert = require("node:assert/strict");
const test = require("node:test");

const {
    SENSOR_PROFILES,
    computeOffNadirDeg,
    computeOperationalRadiusKm,
    isEffectivelyCovered,
    resolveSensorProfile
} = require("../shared/blindSpotCoverageUtils");

test("blind spot utils distinguish low-horizon visibility from effective coverage", () => {
    const optical = SENSOR_PROFILES.opticalRecon;

    const lowAngle = isEffectivelyCovered({
        elevationDeg: 8,
        rangeKm: 900,
        profile: optical
    });

    const usableAngle = isEffectivelyCovered({
        elevationDeg: 65,
        rangeKm: 900,
        profile: optical
    });

    assert.equal(computeOffNadirDeg(65), 25);
    assert.equal(lowAngle.isEffectivelyCovered, false);
    assert.equal(usableAngle.isEffectivelyCovered, true);
    assert.ok(usableAngle.coverageStrength > lowAngle.coverageStrength);
});

test("blind spot utils map satellite families to different sensor profiles", () => {
    const geo = resolveSensorProfile("GSAT-30");
    const sar = resolveSensorProfile("RISAT-1");
    const optical = resolveSensorProfile("WORLDVIEW-3");
    const explicit = resolveSensorProfile({ sensorType: "sar" });

    assert.equal(geo.key, "geoComm");
    assert.equal(sar.key, "sarRecon");
    assert.equal(optical.key, "opticalRecon");
    assert.equal(explicit.key, "sarRecon");
    assert.ok(computeOperationalRadiusKm({ geometricRadiusKm: 300, profile: geo }) > computeOperationalRadiusKm({ geometricRadiusKm: 300, profile: optical }));
});

test("geoComm profiles produce near-zero ISR coverage strength due to isrFactor degradation", () => {
    const geo = resolveSensorProfile("GSAT-30");
    const assessment = isEffectivelyCovered({
        elevationDeg: 55,
        rangeKm: 36000,
        altKm: 35786,
        profile: geo
    });
    assert.equal(assessment.isEffectivelyCovered, false);
    assert.ok(assessment.coverageStrength < 0.05);
    assert.equal(assessment.isrCapable, false);
    assert.equal(assessment.isrFactor, 0.05);
});

