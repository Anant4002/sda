const { characteriseSatellite } = require("./satelliteCharacterisationService");
const { isIndianSatelliteName } = require("./satelliteOwnershipService");

const { getSensorTaskingRecommendations } = require("./sensorTaskingService");

function serializeSatellite(satellite) {
    const data = satellite.toJSON ? satellite.toJSON() : satellite;
    const characterisation = data.characterisation || characteriseSatellite(data.name, data.line1, data.line2);
    
    const serialized = {
        ...data,
        isIndian: characterisation.ownership === "Indian",
        characterisation,
        catalogStatus: data.catalogStatus || "CORRELATED",
        dataSource: data.dataSource || "CELESTRAK",
        intData: data.intData || null,
        isIndigenous: data.isIndigenous || false,
        lastObservedAt: data.lastObservedAt || null,
        firstAddedAt: data.firstAddedAt || null
    };

    if (serialized.catalogStatus === "UNCORRELATED") {
        serialized.sensorRecommendations = getSensorTaskingRecommendations(data);
    }

    return serialized;
}

module.exports = {
    isIndianSatelliteName,
    serializeSatellite
};
