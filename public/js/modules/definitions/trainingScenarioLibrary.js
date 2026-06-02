function makeObjective(id, label) {
    return { id, label };
}

function event(minute, config) {
    return {
        minute,
        requiresAck: true,
        targetResponseMinutes: 12,
        ...config
    };
}

function checkpoint(minute, title, summary) {
    return {
        minute,
        kind: "checkpoint",
        type: "checkpoint",
        title,
        summary,
        severity: "info",
        requiresAck: false
    };
}

const trainingScenarios = [
    {
        id: "hist-gsat7r-conjunction",
        title: "Historical Indian Conjunction Replay",
        category: "conjunction event",
        type: "historical",
        difficulty: "Intermediate",
        durationMinutes: 70,
        startTime: "2025-08-14T02:10:00Z",
        description: "Replay a real-world style Indian asset conjunction while operators manage alert triage, conjunction windows, and executive reporting.",
        participatingAssets: ["GSAT-7R", "CARTOSAT-2F", "DEB-43870"],
        objectives: [
            makeObjective("obj-1", "Identify the primary threat pair"),
            makeObjective("obj-2", "Validate TCA and miss distance"),
            makeObjective("obj-3", "Issue a response recommendation")
        ],
        timeline: [
            checkpoint(0, "Exercise load", "Historical alert history is frozen into the sandbox."),
            event(10, {
                type: "conjunction",
                title: "Conjunction Watch",
                summary: "Screening detects a closing miss-distance window between GSAT-7R and a catalogued debris fragment.",
                severity: "warning",
                primaryId: "GSAT-7R",
                secondaryId: "DEB-43870",
                closestDistanceKm: 6.3,
                assetIds: ["GSAT-7R", "DEB-43870"],
                visual: {
                    kind: "conjunction",
                    primaryPosition: { lat: 21.4, lon: 72.8, altKm: 615 },
                    secondaryPosition: { lat: 21.9, lon: 73.4, altKm: 614.6 }
                },
                objectiveIds: ["obj-1"]
            }),
            event(22, {
                type: "conjunction",
                title: "High Priority Conjunction",
                summary: "Miss distance tightens further and the exercise expects a formal commander update.",
                severity: "critical",
                primaryId: "GSAT-7R",
                secondaryId: "DEB-43870",
                closestDistanceKm: 2.1,
                assetIds: ["GSAT-7R", "DEB-43870"],
                visual: {
                    kind: "conjunction",
                    primaryPosition: { lat: 21.7, lon: 73.2, altKm: 614.8 },
                    secondaryPosition: { lat: 22.0, lon: 73.5, altKm: 614.4 }
                },
                objectiveIds: ["obj-2"]
            }),
            checkpoint(35, "Decision checkpoint", "Pause and decide whether to continue monitoring or recommend operational escalation."),
            event(48, {
                type: "conjunction",
                title: "Conjunction Clears",
                summary: "The threat window passes with no manoeuvre required. Document the closure and lessons learned.",
                severity: "info",
                primaryId: "GSAT-7R",
                secondaryId: "DEB-43870",
                closestDistanceKm: 8.9,
                requiresAck: false,
                assetIds: ["GSAT-7R", "DEB-43870"],
                visual: {
                    kind: "marker",
                    position: { lat: 22.1, lon: 74.0, altKm: 614.2 },
                    label: "Threat window clears"
                },
                objectiveIds: ["obj-3"]
            })
        ]
    },
    {
        id: "synthetic-hostile-manoeuvre",
        title: "Hostile Manoeuvre Drill",
        category: "hostile manoeuvre",
        type: "synthetic",
        difficulty: "Advanced",
        durationMinutes: 45,
        startTime: "2026-03-11T09:40:00Z",
        description: "Synthetic adversary drift and evasive manoeuvre drill designed to train manoeuvre detection, UCT discrimination, and alert escalation.",
        participatingAssets: ["GSAT-11", "UCT-ALPHA-12", "TRACK-01"],
        objectives: [
            makeObjective("obj-1", "Detect the manoeuvre signature"),
            makeObjective("obj-2", "Separate the UCT from the known target"),
            makeObjective("obj-3", "Record an operator response timeline")
        ],
        timeline: [
            checkpoint(0, "Exercise brief", "Synthetic timeline with deterministic orbital events."),
            event(5, {
                type: "manoeuvre",
                title: "Drift Signature Detected",
                summary: "Small but persistent orbital drift is visible on the primary asset.",
                severity: "warning",
                primaryId: "GSAT-11",
                assetIds: ["GSAT-11"],
                visual: {
                    kind: "track",
                    from: { lat: 12.4, lon: 83.0, altKm: 786 },
                    to: { lat: 12.9, lon: 83.8, altKm: 790 },
                    label: "Nominal drift"
                },
                objectiveIds: ["obj-1"]
            }),
            event(14, {
                type: "manoeuvre",
                title: "Hostile Manoeuvre",
                summary: "The exercise target performs an aggressive delta-v burn and changes plane.",
                severity: "critical",
                primaryId: "GSAT-11",
                assetIds: ["GSAT-11"],
                visual: {
                    kind: "track",
                    from: { lat: 12.9, lon: 83.8, altKm: 790 },
                    to: { lat: 14.3, lon: 86.2, altKm: 810 },
                    label: "Burn arc"
                },
                objectiveIds: ["obj-1"]
            }),
            event(20, {
                type: "uct",
                title: "Unknown Object Appears",
                summary: "A second uncorrelated object appears in the vicinity of the manoeuvring asset.",
                severity: "warning",
                primaryId: "UCT-ALPHA-12",
                assetIds: ["UCT-ALPHA-12", "GSAT-11"],
                visual: {
                    kind: "marker",
                    position: { lat: 14.8, lon: 86.9, altKm: 805 },
                    label: "UCT-ALPHA-12"
                },
                objectiveIds: ["obj-2"]
            }),
            checkpoint(32, "Operator review", "Confirm whether the unknown object is a track split, debris, or an adversary support asset."),
            event(38, {
                type: "communication_loss",
                title: "Tracking Gap",
                summary: "The simulated sensor net loses reliable custody for one minute while the object pair diverges.",
                severity: "warning",
                primaryId: "GSAT-11",
                assetIds: ["GSAT-11"],
                requiresAck: false,
                visual: {
                    kind: "blackout",
                    position: { lat: 15.0, lon: 87.8, altKm: 804 },
                    radiusKm: 900
                },
                objectiveIds: ["obj-3"]
            })
        ]
    },
    {
        id: "synthetic-breakup-cloud",
        title: "Debris Cloud Breakup Event",
        category: "satellite breakup",
        type: "synthetic",
        difficulty: "Advanced",
        durationMinutes: 60,
        startTime: "2026-01-23T18:15:00Z",
        description: "Practice debris cloud assessment, secondary threat spreading, and multi-object conjunction management after a breakup.",
        participatingAssets: ["FRAG-PARENT", "FRAG-001", "FRAG-002", "FRAG-003"],
        objectives: [
            makeObjective("obj-1", "Recognise the breakup pattern"),
            makeObjective("obj-2", "Prioritise the most dangerous fragment"),
            makeObjective("obj-3", "Capture the debris cloud extent")
        ],
        timeline: [
            checkpoint(0, "Initial state", "A high-energy breakup is seeded into the training sandbox."),
            event(8, {
                type: "breakup",
                title: "Fragmentation Event",
                summary: "The parent object breaks into a small debris cloud with several fast-moving fragments.",
                severity: "critical",
                primaryId: "FRAG-PARENT",
                assetIds: ["FRAG-PARENT", "FRAG-001", "FRAG-002", "FRAG-003"],
                visual: {
                    kind: "spread",
                    center: { lat: 8.4, lon: 92.0, altKm: 980 },
                    radiusKm: 1400
                },
                objectiveIds: ["obj-1"]
            }),
            event(18, {
                type: "conjunction",
                title: "Fragment Conjunction",
                summary: "A fragment begins crossing a protected orbit corridor.",
                severity: "warning",
                primaryId: "FRAG-001",
                secondaryId: "GSAT-7R",
                closestDistanceKm: 4.6,
                assetIds: ["FRAG-001", "GSAT-7R"],
                visual: {
                    kind: "conjunction",
                    primaryPosition: { lat: 9.1, lon: 93.2, altKm: 978 },
                    secondaryPosition: { lat: 8.9, lon: 93.8, altKm: 616 }
                },
                objectiveIds: ["obj-2"]
            }),
            event(31, {
                type: "sensor_blackout",
                title: "Sensor Blackout",
                summary: "One sensor node drops off the exercise net, widening the uncertainty envelope.",
                severity: "warning",
                primaryId: "SENSOR-NET",
                assetIds: ["SENSOR-NET"],
                requiresAck: false,
                visual: {
                    kind: "blackout",
                    position: { lat: 9.7, lon: 94.0, altKm: 960 },
                    radiusKm: 1100
                },
                objectiveIds: ["obj-3"]
            }),
            checkpoint(45, "Fragment review", "Reassess the debris cloud and confirm which fragment is still the most credible hazard.")
        ]
    },
    {
        id: "hist-reentry-window",
        title: "Historical Re-entry Window",
        category: "re-entry event",
        type: "historical",
        difficulty: "Intermediate",
        durationMinutes: 90,
        startTime: "2025-11-02T04:30:00Z",
        description: "Replay a decaying upper-stage scenario and practice corridor tracking, impact messaging, and strategic site awareness.",
        participatingAssets: ["UPPER-STAGE-47", "TRACK-02", "REENTRY-NODE-9"],
        objectives: [
            makeObjective("obj-1", "Confirm the decay trend"),
            makeObjective("obj-2", "Track the corridor shift"),
            makeObjective("obj-3", "Assess strategic risk overlap")
        ],
        timeline: [
            checkpoint(0, "Replay start", "Historical drag profile is frozen inside the sandbox."),
            event(16, {
                type: "reentry",
                title: "Decay Trend Confirmed",
                summary: "The target transitions from watch status to a clear re-entry trend.",
                severity: "warning",
                primaryId: "UPPER-STAGE-47",
                assetIds: ["UPPER-STAGE-47"],
                visual: {
                    kind: "reentry",
                    corridor: [
                        { lat: 25.2, lon: 70.1 },
                        { lat: 23.8, lon: 72.6 },
                        { lat: 22.4, lon: 75.5 },
                        { lat: 20.8, lon: 78.4 }
                    ]
                },
                objectiveIds: ["obj-1"]
            }),
            event(40, {
                type: "reentry",
                title: "Impact Corridor Update",
                summary: "The projected corridor shifts south-east and needs renewed strategic review.",
                severity: "critical",
                primaryId: "UPPER-STAGE-47",
                assetIds: ["UPPER-STAGE-47"],
                visual: {
                    kind: "reentry",
                    corridor: [
                        { lat: 22.8, lon: 73.4 },
                        { lat: 21.5, lon: 76.0 },
                        { lat: 19.9, lon: 78.9 },
                        { lat: 18.6, lon: 81.8 }
                    ]
                },
                objectiveIds: ["obj-2", "obj-3"]
            }),
            checkpoint(68, "Strategic review", "Assess whether the corridor intersects any protected assets or populated regions."),
            event(74, {
                type: "reentry",
                title: "Re-entry Closure",
                summary: "The object enters the dense atmosphere and the review can be closed out.",
                severity: "info",
                primaryId: "UPPER-STAGE-47",
                requiresAck: false,
                assetIds: ["UPPER-STAGE-47"],
                visual: {
                    kind: "marker",
                    position: { lat: 17.2, lon: 84.1, altKm: 0 },
                    label: "Atmospheric entry"
                }
            })
        ]
    },
    {
        id: "synthetic-blind-spot-window",
        title: "ISR Blind Spot Emergence",
        category: "blind spot emergence",
        type: "synthetic",
        difficulty: "Advanced",
        durationMinutes: 50,
        startTime: "2026-04-05T11:05:00Z",
        description: "A synthetic surveillance-window drill where a blind spot opens at the worst possible time and operators must protect coverage continuity.",
        participatingAssets: ["ISR-ALPHA", "SENSOR-FENCE", "ADVERSARY-PASS-21"],
        objectives: [
            makeObjective("obj-1", "Recognise the blind spot window"),
            makeObjective("obj-2", "Protect the target area"),
            makeObjective("obj-3", "Track the adversary pass")
        ],
        timeline: [
            checkpoint(0, "Coverage baseline", "The sensor fence starts in a healthy state."),
            event(9, {
                type: "blind_spot",
                title: "Blind Spot Emergence",
                summary: "Coverage gaps appear over the target corridor as one sensor arc degrades.",
                severity: "warning",
                primaryId: "SENSOR-FENCE",
                assetIds: ["ISR-ALPHA", "SENSOR-FENCE"],
                visual: {
                    kind: "blackout",
                    position: { lat: 18.6, lon: 79.2, altKm: 0 },
                    radiusKm: 850
                },
                objectiveIds: ["obj-1"]
            }),
            event(18, {
                type: "surveillance_pass",
                title: "Adversary Surveillance Pass",
                summary: "A hostile platform passes through the blind spot during the coverage gap.",
                severity: "critical",
                primaryId: "ADVERSARY-PASS-21",
                assetIds: ["ADVERSARY-PASS-21", "ISR-ALPHA"],
                visual: {
                    kind: "track",
                    from: { lat: 19.0, lon: 78.6, altKm: 530 },
                    to: { lat: 18.2, lon: 80.3, altKm: 531 },
                    label: "Adversary pass"
                },
                objectiveIds: ["obj-2", "obj-3"]
            }),
            event(32, {
                type: "blind_spot",
                title: "Coverage Recovery",
                summary: "Sensor geometry stabilises and the blind spot closes.",
                severity: "info",
                primaryId: "SENSOR-FENCE",
                requiresAck: false,
                assetIds: ["SENSOR-FENCE"],
                visual: {
                    kind: "marker",
                    position: { lat: 18.8, lon: 79.8, altKm: 0 },
                    label: "Coverage restored"
                }
            })
        ]
    },
    {
        id: "synthetic-uct-appearance",
        title: "UCT Appearance Drill",
        category: "UCT appearance",
        type: "synthetic",
        difficulty: "Intermediate",
        durationMinutes: 40,
        startTime: "2026-02-12T08:25:00Z",
        description: "Operators identify a new uncorrelated track, evaluate whether it is manoeuvring, and decide whether to escalate or wait.",
        participatingAssets: ["UCT-BETA-07", "GSAT-19", "TRACK-NODE-03"],
        objectives: [
            makeObjective("obj-1", "Spot the new track"),
            makeObjective("obj-2", "Assess whether it manoeuvres"),
            makeObjective("obj-3", "Document the training response")
        ],
        timeline: [
            checkpoint(0, "Tracker reset", "No unknown tracks are present at T0."),
            event(7, {
                type: "uct",
                title: "UCT Appears",
                summary: "An uncorrelated object appears with no catalog match in the sandbox.",
                severity: "warning",
                primaryId: "UCT-BETA-07",
                assetIds: ["UCT-BETA-07"],
                visual: {
                    kind: "marker",
                    position: { lat: 16.9, lon: 88.1, altKm: 720 },
                    label: "UCT-BETA-07"
                },
                objectiveIds: ["obj-1"]
            }),
            event(19, {
                type: "manoeuvre",
                title: "UCT Manoeuvre Signature",
                summary: "The unknown track changes velocity and becomes operationally interesting.",
                severity: "critical",
                primaryId: "UCT-BETA-07",
                assetIds: ["UCT-BETA-07"],
                visual: {
                    kind: "track",
                    from: { lat: 16.9, lon: 88.1, altKm: 720 },
                    to: { lat: 17.8, lon: 89.5, altKm: 726 },
                    label: "UCT manoeuvre"
                },
                objectiveIds: ["obj-2"]
            }),
            checkpoint(29, "Reporting checkpoint", "Assess the track confidence and record the operator response."),
            event(35, {
                type: "uct",
                title: "Track Stabilises",
                summary: "The object settles into a predictable drift and can be handed back to watchkeeping.",
                severity: "info",
                primaryId: "UCT-BETA-07",
                requiresAck: false,
                assetIds: ["UCT-BETA-07"],
                visual: {
                    kind: "marker",
                    position: { lat: 18.1, lon: 90.0, altKm: 726 },
                    label: "Track stabilised"
                },
                objectiveIds: ["obj-3"]
            })
        ]
    },
    {
        id: "synthetic-adversary-pass",
        title: "Adversary Surveillance Pass",
        category: "adversary surveillance pass",
        type: "synthetic",
        difficulty: "Intermediate",
        durationMinutes: 35,
        startTime: "2026-04-29T14:55:00Z",
        description: "A focused drill on adversary orbital pass recognition, comms degradation, and event reporting discipline.",
        participatingAssets: ["ADVERSARY-02", "GSAT-13", "COMM-NODE-4"],
        objectives: [
            makeObjective("obj-1", "Recognise the surveillance pass"),
            makeObjective("obj-2", "Note the comms degradation"),
            makeObjective("obj-3", "Close the exercise with a summary")
        ],
        timeline: [
            checkpoint(0, "Pass setup", "The exercise begins with a clean operational picture."),
            event(6, {
                type: "surveillance_pass",
                title: "Surveillance Pass Begins",
                summary: "A synthetic adversary platform enters the watch geometry.",
                severity: "warning",
                primaryId: "ADVERSARY-02",
                assetIds: ["ADVERSARY-02"],
                visual: {
                    kind: "track",
                    from: { lat: 17.2, lon: 80.5, altKm: 600 },
                    to: { lat: 17.8, lon: 82.4, altKm: 601 },
                    label: "Adversary pass"
                },
                objectiveIds: ["obj-1"]
            }),
            event(13, {
                type: "communication_loss",
                title: "Comms Loss",
                summary: "The training feed drops a node and operator connectivity becomes intermittent.",
                severity: "warning",
                primaryId: "COMM-NODE-4",
                requiresAck: false,
                assetIds: ["COMM-NODE-4"],
                visual: {
                    kind: "blackout",
                    position: { lat: 17.6, lon: 81.7, altKm: 0 },
                    radiusKm: 700
                },
                objectiveIds: ["obj-2"]
            }),
            event(26, {
                type: "surveillance_pass",
                title: "Pass Clears",
                summary: "The adversary object exits the watch volume and the mission can close out.",
                severity: "info",
                primaryId: "ADVERSARY-02",
                requiresAck: false,
                assetIds: ["ADVERSARY-02"],
                visual: {
                    kind: "marker",
                    position: { lat: 18.3, lon: 83.1, altKm: 600 },
                    label: "Pass complete"
                },
                objectiveIds: ["obj-3"]
            })
        ]
    },
    {
        id: "synthetic-multi-event-crisis",
        title: "Multi-Event Crisis Simulation",
        category: "multi-event crisis simulation",
        type: "synthetic",
        difficulty: "Expert",
        durationMinutes: 100,
        startTime: "2026-05-14T01:10:00Z",
        description: "The full rehearsal package: manoeuvre, conjunction, blind spot, UCT appearance, and a re-entry cue in one timed mission.",
        participatingAssets: ["GSAT-22", "UCT-OMEGA-5", "UPPER-STAGE-19", "SENSOR-NET-7"],
        objectives: [
            makeObjective("obj-1", "Stabilise the first manoeuvre alert"),
            makeObjective("obj-2", "Manage the conjunction window"),
            makeObjective("obj-3", "Restore coverage after the blackout"),
            makeObjective("obj-4", "Capture the UCT and re-entry decisions")
        ],
        timeline: [
            checkpoint(0, "Mission start", "This scenario chains several realistic SDA stressors into one rehearsal."),
            event(10, {
                type: "manoeuvre",
                title: "Unexpected Manoeuvre",
                summary: "A primary asset performs a small but deliberate orbit change.",
                severity: "warning",
                primaryId: "GSAT-22",
                assetIds: ["GSAT-22"],
                visual: {
                    kind: "track",
                    from: { lat: 13.4, lon: 71.3, altKm: 802 },
                    to: { lat: 13.9, lon: 72.1, altKm: 805 },
                    label: "Orbit shift"
                },
                objectiveIds: ["obj-1"]
            }),
            event(24, {
                type: "conjunction",
                title: "Conjunction Window",
                summary: "The manoeuvre nudges the asset into a close-approach window with a debris object.",
                severity: "critical",
                primaryId: "GSAT-22",
                secondaryId: "DEB-90211",
                closestDistanceKm: 2.8,
                assetIds: ["GSAT-22", "DEB-90211"],
                visual: {
                    kind: "conjunction",
                    primaryPosition: { lat: 14.1, lon: 72.8, altKm: 804 },
                    secondaryPosition: { lat: 14.4, lon: 73.2, altKm: 803.7 }
                },
                objectiveIds: ["obj-2"]
            }),
            event(39, {
                type: "sensor_blackout",
                title: "Sensor Blackout",
                summary: "A coverage gap appears while the conjunction is still being monitored.",
                severity: "warning",
                primaryId: "SENSOR-NET-7",
                requiresAck: false,
                assetIds: ["SENSOR-NET-7"],
                visual: {
                    kind: "blackout",
                    position: { lat: 14.9, lon: 73.8, altKm: 0 },
                    radiusKm: 950
                },
                objectiveIds: ["obj-3"]
            }),
            event(52, {
                type: "uct",
                title: "UCT Emerges",
                summary: "An unknown object appears during the same watch cycle and must be tracked separately.",
                severity: "warning",
                primaryId: "UCT-OMEGA-5",
                assetIds: ["UCT-OMEGA-5"],
                visual: {
                    kind: "marker",
                    position: { lat: 15.7, lon: 75.1, altKm: 805 },
                    label: "UCT-OMEGA-5"
                },
                objectiveIds: ["obj-4"]
            }),
            event(69, {
                type: "reentry",
                title: "Re-entry Cue",
                summary: "An upper stage comes into re-entry monitoring as the mission is still in progress.",
                severity: "critical",
                primaryId: "UPPER-STAGE-19",
                assetIds: ["UPPER-STAGE-19"],
                visual: {
                    kind: "reentry",
                    corridor: [
                        { lat: 23.9, lon: 68.8 },
                        { lat: 22.3, lon: 71.5 },
                        { lat: 20.6, lon: 74.4 },
                        { lat: 19.1, lon: 77.6 }
                    ]
                },
                objectiveIds: ["obj-4"]
            }),
            checkpoint(86, "Final decision point", "Close the mission with a recovery summary and any unresolved follow-up tasks.")
        ]
    }
];

function getTrainingScenarioById(id) {
    return trainingScenarios.find((scenario) => scenario.id === id) || null;
}

export {
    getTrainingScenarioById,
    trainingScenarios
};
