import { registerModule } from "./moduleRegistry.js";
import missionControlModule from "./definitions/missionControl.js";
import orbitPropagationModule from "./definitions/orbitPropagation.js";
import volumetricScanModule from "./definitions/volumetricScan.js";
import neighbourhoodWatchModule from "./definitions/neighbourhoodWatch.js";
import conjunctionAnalysisModule from "./definitions/conjunctionAnalysis.js";
import collisionDetectionModule from "./definitions/collisionDetection.js";
import blindSpotDetectionModule from "./definitions/blindSpotDetection.js";
import operationalAlertsModule from "./definitions/operationalAlerts.js";
import unifiedThreatInsightsModule from "./definitions/unifiedThreatInsights.js";
import manoeuvreDetectionModule from "./definitions/manoeuvreDetection.js";
import reentryAnalysisModule from "./definitions/reentryAnalysis.js";
import characterisationModule from "./definitions/characterisation.js";
import rapidProcessingModule from "./definitions/rapidProcessing.js";
import trainingSimulationModule from "./definitions/trainingSimulation.js";

const orderedModules = [
    missionControlModule,
    orbitPropagationModule,
    volumetricScanModule,
    neighbourhoodWatchModule,
    conjunctionAnalysisModule,
    collisionDetectionModule,
    blindSpotDetectionModule,
    manoeuvreDetectionModule,
    reentryAnalysisModule,
    characterisationModule,
    rapidProcessingModule,
    operationalAlertsModule,
    unifiedThreatInsightsModule,
    trainingSimulationModule
];

let registered = false;

export function registerAllModules() {
    if (registered) {
        return;
    }
    for (const module of orderedModules) {
        registerModule(module);
    }
    registered = true;
}
