export const appState = {
    selectedArea: null,
    activeSatellitePathId: null,
    pathEntities: [],
    lastPositionUpdate: 0,
    catalogLoaded: false,
    analysisInFlight: false,
    trackingWorkerReady: false,
    analysisWorkerReady: false,
    workerUpdateInFlight: false,
    analysisWorkerBusy: false,
    areaEntity: null,
    traceDraftEntity: null,
    satellites: [],
    satelliteMetaMap: new Map(),
    pointMap: new Map(),
    hiddenGroupLabels: new Set(),
    hideCommercialSatellites: false,
    isTraceModeEnabled: false,
    isTracingArea: false,
    tracePoints: [],
    tracePreviewPoint: null,
    lastCatalogSyncAt: null,
    catalogApiBaseUrl: null,

    // Simulation & Training
    simulationMode: false,
    activeTrainingSession: null,
    simulationClock: null, // The "Simulated Now"
    simulationSpeed: 1.0,
    simulationPaused: true,
    trainingScenarioLibrary: [],
    trainingSelectedScenarioId: null,
    trainingLibraryFilter: "all",
    trainingEntities: [],
    trainingLastTickAt: null,
    trainingSummary: null,

    // Focused Drift Analysis
    isFocusMode: false,
    focusedSatelliteId: null,
    driftHistory: null,
    driftEntities: [],
    driftMagnification: 1.0,
    savedVisibilityState: new Map(),

    // Visualisation Modes
    isInertialViewEnabled: true,

    // Re-entry Analysis
    reentryEntities: [],

    // UCT & Characterisation
    uctEntities: [],
    ucts: [],

    // Emerging Regional Access
    regionalAccessEntities: [],
    regionalAccessDetails: null
};
