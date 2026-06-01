const { IncidentGroup } = require("./incidentGroup");
const { AlertCorrelation } = require("./alertCorrelation");
const { IncidentEventLink } = require("./incidentEventLink");
const { ThreatScore } = require("./threatScore");
const { OperationalAlert } = require("./operationalAlert");
const { Satellite } = require("./satellite");

let associationsRegistered = false;

function registerCorrelationAssociations() {
    if (associationsRegistered) {
        return;
    }

    IncidentGroup.hasMany(AlertCorrelation, {
        foreignKey: "incidentGroupId",
        as: "correlations"
    });

    IncidentGroup.hasMany(IncidentEventLink, {
        foreignKey: "incidentGroupId",
        as: "eventLinks"
    });

    IncidentGroup.hasMany(ThreatScore, {
        foreignKey: "incidentGroupId",
        as: "scores"
    });

    IncidentGroup.belongsTo(Satellite, {
        foreignKey: "primarySatelliteId",
        as: "primarySatellite"
    });

    IncidentGroup.belongsTo(Satellite, {
        foreignKey: "secondarySatelliteId",
        as: "secondarySatellite"
    });

    AlertCorrelation.belongsTo(IncidentGroup, {
        foreignKey: "incidentGroupId",
        as: "incidentGroup"
    });

    AlertCorrelation.belongsTo(OperationalAlert, {
        foreignKey: "alertId",
        as: "alert"
    });

    IncidentEventLink.belongsTo(IncidentGroup, {
        foreignKey: "incidentGroupId",
        as: "incidentGroup"
    });

    IncidentEventLink.belongsTo(OperationalAlert, {
        foreignKey: "alertId",
        as: "alert"
    });

    IncidentEventLink.belongsTo(AlertCorrelation, {
        foreignKey: "alertCorrelationId",
        as: "correlation"
    });

    ThreatScore.belongsTo(IncidentGroup, {
        foreignKey: "incidentGroupId",
        as: "incidentGroup"
    });

    associationsRegistered = true;
}

registerCorrelationAssociations();

module.exports = {
    registerCorrelationAssociations
};
