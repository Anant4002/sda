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
    // =========================================================
    // EXISTING SCENARIOS — enhanced with new metadata fields
    // =========================================================
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
        tags: ["conjunction", "indian-asset", "debris", "triage", "executive-reporting"],
        learningObjectives: [
            "Understand conjunction event lifecycle from detection to closure",
            "Practice TCA validation and miss distance interpretation",
            "Develop executive briefing discipline under time pressure"
        ],
        debriefNotes: "Focus on the timing between initial watch status and escalation to critical. Operators should note the 12-minute window between events 1 and 2 — the decision point is event 1, not event 2.",
        successCriteria: [
            "Primary threat pair identified within 15 minutes of T+10",
            "TCA and miss distance validated before T+35",
            "Response recommendation documented before T+60"
        ],
        failureCriteria: [
            "Alert not acknowledged within target response time",
            "Wrong satellite pair identified as primary threat",
            "No documented response by end of exercise"
        ],
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
        tags: ["manoeuvre", "adversary", "uct", "escalation", "rpo"],
        learningObjectives: [
            "Recognise deliberate orbital drift versus station-keeping",
            "Discriminate UCT appearances from track splits",
            "Document operator response timeline under ambiguity"
        ],
        debriefNotes: "The UCT at T+20 is the key discriminator — operators must decide whether it is a separated sub-payload or an independent hostile asset. Both answers are defensible; the quality of the reasoning is what is scored.",
        successCriteria: [
            "Manoeuvre signature detected within 10 minutes of T+5",
            "UCT identified and tracked separately by T+30",
            "Response timeline recorded and closed before exercise end"
        ],
        failureCriteria: [
            "UCT treated as noise and dismissed without investigation",
            "Manoeuvre classified as routine station-keeping without justification"
        ],
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
        tags: ["debris", "breakup", "conjunction", "multi-object", "fragmentation"],
        learningObjectives: [
            "Identify fragmentation event signatures from conjunction screening",
            "Prioritise the highest-risk fragment from a debris cloud",
            "Track the spatial extent of a debris cloud over time"
        ],
        debriefNotes: "The sensor blackout at T+31 deliberately widens the uncertainty envelope. Operators should document the decision made during occlusion and reassess immediately on reacquisition.",
        successCriteria: [
            "Breakup pattern recognised within 15 minutes of T+8",
            "Most dangerous fragment prioritised by T+25",
            "Debris cloud extent assessed and recorded before T+55"
        ],
        failureCriteria: [
            "Fragments treated as a single object",
            "Sensor blackout exploited without any documented interim estimate"
        ],
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
        tags: ["reentry", "decay", "impact-corridor", "strategic-sites", "upper-stage"],
        learningObjectives: [
            "Interpret altitude decay curves and re-entry window estimates",
            "Track corridor shift as orbital decay progresses",
            "Assess strategic installation risk overlap from impact corridor data"
        ],
        debriefNotes: "The corridor shifts significantly between T+16 and T+40. Operators should document the risk assessment at both timepoints. At T+68 the corridor approaches Indian territory — the quality of the strategic risk assessment is the primary evaluation point.",
        successCriteria: [
            "Decay trend confirmed and documented by T+30",
            "Corridor shift tracked and updated by T+55",
            "Strategic risk assessment completed by T+80"
        ],
        failureCriteria: [
            "Re-entry window estimate not revised after corridor shift",
            "Strategic installation risk not assessed before exercise end"
        ],
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
        tags: ["blind-spot", "coverage-gap", "adversary", "sensor-management", "isr"],
        learningObjectives: [
            "Recognise coverage gap emergence from sensor geometry changes",
            "Coordinate alternative sensor tasking to protect critical corridors",
            "Track adversary pass through degraded coverage"
        ],
        debriefNotes: "The adversary pass at T+18 exploits the gap opened at T+9. Operators who tasked an alternative sensor at T+9 may have achieved partial coverage. Document whether any coverage was maintained during the adversary pass window.",
        successCriteria: [
            "Blind spot recognised and reported within 5 minutes of T+9",
            "Alternative sensor tasked before T+18",
            "Adversary pass tracked despite coverage degradation"
        ],
        failureCriteria: [
            "Adversary pass at T+18 goes undetected",
            "No alternative sensor tasked during blind spot window"
        ],
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
        tags: ["uct", "correlation", "escalation", "manoeuvre", "watchkeeping"],
        learningObjectives: [
            "Identify uncorrelated track characteristics",
            "Assess manoeuvre likelihood from velocity change data",
            "Document operator decision rationale under uncertainty"
        ],
        debriefNotes: "The UCT manoeuvre at T+19 is deliberate. Operators who treated the initial UCT as benign and did not maintain active watch are now behind the decision curve. The quality of the decision at T+29 is the primary evaluation point.",
        successCriteria: [
            "New track spotted and flagged within 10 minutes of T+7",
            "Manoeuvre assessment completed by T+25",
            "Operator response documented by T+35"
        ],
        failureCriteria: [
            "UCT dismissed as catalog clutter without investigation",
            "Manoeuvre at T+19 not actioned"
        ],
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
        tags: ["adversary", "surveillance", "comms-loss", "reporting", "escalation"],
        learningObjectives: [
            "Recognise adversary platform pass geometry and timing",
            "Manage comms degradation during a critical pass window",
            "Produce a structured exercise closure summary"
        ],
        debriefNotes: "The comms loss at T+13 is deliberate — it tests whether operators can maintain situational awareness without continuous data feed. The summary at T+26 should be produced regardless of data quality.",
        successCriteria: [
            "Surveillance pass recognised within 8 minutes of T+6",
            "Comms degradation noted and documented",
            "Exercise closure summary completed"
        ],
        failureCriteria: [
            "Pass not actioned before it exits the watch volume",
            "No closure summary produced"
        ],
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
        tags: ["multi-event", "manoeuvre", "conjunction", "blind-spot", "uct", "reentry", "expert"],
        learningObjectives: [
            "Manage multiple simultaneous SDA stressors with limited resources",
            "Prioritise threat responses when everything is urgent",
            "Maintain situational awareness across all active threat threads"
        ],
        debriefNotes: "The key learning point is prioritisation under load. The conjunction at T+24 is the highest immediate risk but the UCT at T+52 may be the longest-term threat. Operators who fixed on the conjunction without handing off monitoring to a second operator will typically miss the UCT.",
        successCriteria: [
            "All four threat types acknowledged within their target response windows",
            "Conjunction threat managed before TCA window closes",
            "UCT assigned to a tracking workstation before T+60",
            "Re-entry corridor reviewed before exercise end"
        ],
        failureCriteria: [
            "Two or more critical events unacknowledged at exercise end",
            "Conjunction threat not escalated before T+35"
        ],
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
    },

    // =========================================================
    // NEW SCENARIOS — Phase-1 Additions
    // =========================================================

    {
        id: "synthetic-asat-threat",
        title: "ASAT Intercept Warning",
        category: "ASAT threat",
        type: "synthetic",
        difficulty: "Expert",
        durationMinutes: 55,
        startTime: "2026-06-10T22:00:00Z",
        description: "A synthetic ASAT launch is detected and operators must classify the threat, identify the targeted Indian asset, and coordinate a response within the intercept window.",
        participatingAssets: ["GSAT-7A", "INTERCEPTOR-ALPHA", "TRACK-ASAT-01", "SENSOR-NORTH-02"],
        tags: ["asat", "intercept", "indian-asset", "rapid-processing", "escalation", "expert"],
        learningObjectives: [
            "Classify an ASAT trajectory using rapid processing indicators",
            "Identify the most likely Indian asset being targeted",
            "Coordinate national-level escalation within the intercept timeline"
        ],
        debriefNotes: "The ASAT scenario has no safe 'wait and see' option — the intercept window is finite. Operators who do not escalate at T+8 will find that the decision timeline has closed by T+20. The quality of the initial classification and the speed of escalation are the primary evaluation criteria.",
        successCriteria: [
            "ASAT launch detected and classified within 8 minutes of T+5",
            "Targeted Indian asset identified by T+15",
            "National-level escalation triggered before T+25",
            "All-clear or confirmation documented before exercise end"
        ],
        failureCriteria: [
            "ASAT threat classified as routine orbital object",
            "Escalation not triggered before T+30",
            "Targeted asset not identified before intercept window closes"
        ],
        objectives: [
            makeObjective("obj-1", "Detect and classify the ASAT launch"),
            makeObjective("obj-2", "Identify the targeted Indian asset"),
            makeObjective("obj-3", "Trigger national-level escalation"),
            makeObjective("obj-4", "Document the incident timeline")
        ],
        timeline: [
            checkpoint(0, "Exercise start", "All sensors are nominal. A clean operational picture is established."),
            event(5, {
                type: "rapid_threat",
                title: "Rapid Track Detected",
                summary: "A high-velocity track is detected by the northern sensor fence. Initial classification: unknown.",
                severity: "warning",
                primaryId: "TRACK-ASAT-01",
                assetIds: ["TRACK-ASAT-01"],
                visual: {
                    kind: "track",
                    from: { lat: 35.0, lon: 78.0, altKm: 80 },
                    to: { lat: 30.5, lon: 79.0, altKm: 220 },
                    label: "Rapid track"
                },
                objectiveIds: ["obj-1"]
            }),
            event(10, {
                type: "rapid_threat",
                title: "ASAT Classification Confirmed",
                summary: "Track velocity and altitude profile match ASAT intercept trajectory. Primary target is in LEO, inclination consistent with GSAT-7A.",
                severity: "critical",
                primaryId: "INTERCEPTOR-ALPHA",
                secondaryId: "GSAT-7A",
                assetIds: ["INTERCEPTOR-ALPHA", "GSAT-7A"],
                visual: {
                    kind: "track",
                    from: { lat: 30.5, lon: 79.0, altKm: 220 },
                    to: { lat: 24.0, lon: 80.2, altKm: 650 },
                    label: "Intercept arc"
                },
                objectiveIds: ["obj-1", "obj-2"]
            }),
            checkpoint(18, "Decision gate", "Window available for protective manoeuvre or escalation. Decide and act."),
            event(22, {
                type: "conjunction",
                title: "Predicted Intercept Window",
                summary: "The computed intercept geometry places the interceptor within 5 km of GSAT-7A in approximately 8 minutes.",
                severity: "critical",
                primaryId: "INTERCEPTOR-ALPHA",
                secondaryId: "GSAT-7A",
                closestDistanceKm: 4.8,
                assetIds: ["INTERCEPTOR-ALPHA", "GSAT-7A"],
                visual: {
                    kind: "conjunction",
                    primaryPosition: { lat: 22.1, lon: 81.0, altKm: 648 },
                    secondaryPosition: { lat: 22.3, lon: 81.3, altKm: 651 }
                },
                objectiveIds: ["obj-2", "obj-3"]
            }),
            event(38, {
                type: "uct",
                title: "Post-Intercept Debris Cloud",
                summary: "If intercept occurred, a debris field is now visible in the engagement orbit. Track all fragments.",
                severity: "critical",
                primaryId: "DEBRIS-CLOUD-01",
                assetIds: ["DEBRIS-CLOUD-01"],
                visual: {
                    kind: "spread",
                    center: { lat: 22.2, lon: 81.2, altKm: 650 },
                    radiusKm: 800
                },
                objectiveIds: ["obj-4"]
            }),
            checkpoint(50, "Incident closure", "Document the full incident timeline and any unresolved follow-up tracking requirements.")
        ]
    },

    {
        id: "hist-gsat19-proximity",
        title: "GSAT-19 Proximity Watch",
        category: "proximity ops",
        type: "historical",
        difficulty: "Advanced",
        durationMinutes: 65,
        startTime: "2025-09-18T06:30:00Z",
        description: "A historical-style proximity operations scenario where an unknown object closes on GSAT-19 over several orbital periods. Operators assess RPO risk and coordinate protective awareness.",
        participatingAssets: ["GSAT-19", "UCT-GAMMA-04", "TRACK-RPO-01"],
        tags: ["proximity-ops", "rpo", "gsat", "uct", "indian-asset", "watchkeeping"],
        learningObjectives: [
            "Monitor progressive close approach over multiple orbital periods",
            "Assess Rendezvous and Proximity Operations (RPO) risk indicators",
            "Coordinate sustained watch-keeping for an Indian GEO asset"
        ],
        debriefNotes: "The UCT's closing rate is deliberately slow — this tests sustained attention over a long exercise. The RPO assessment at T+40 is the primary evaluation point. Operators must distinguish station-keeping drift from deliberate approach.",
        successCriteria: [
            "UCT flagged and assigned to watch within 15 minutes of T+8",
            "RPO risk assessment completed by T+45",
            "Watch-keeping sustained through all four orbit periods"
        ],
        failureCriteria: [
            "UCT dismissed after first appearance without sustained watch",
            "RPO risk not formally assessed before T+55"
        ],
        objectives: [
            makeObjective("obj-1", "Detect the unknown object closing on GSAT-19"),
            makeObjective("obj-2", "Assess RPO risk indicators"),
            makeObjective("obj-3", "Sustain the proximity watch through the exercise"),
            makeObjective("obj-4", "Recommend a protective posture")
        ],
        timeline: [
            checkpoint(0, "Watch start", "GSAT-19 is in nominal GEO station. All sensors healthy."),
            event(8, {
                type: "uct",
                title: "Unknown Object Detected Near GSAT-19",
                summary: "A new uncorrelated object is detected at approximately 120 km from GSAT-19. Closing rate estimated at 0.4 km per orbit.",
                severity: "warning",
                primaryId: "UCT-GAMMA-04",
                secondaryId: "GSAT-19",
                closestDistanceKm: 120,
                assetIds: ["UCT-GAMMA-04", "GSAT-19"],
                visual: {
                    kind: "conjunction",
                    primaryPosition: { lat: 12.5, lon: 74.0, altKm: 35786 },
                    secondaryPosition: { lat: 12.5, lon: 73.8, altKm: 35784 }
                },
                objectiveIds: ["obj-1"]
            }),
            event(22, {
                type: "neighbourhood_watch",
                title: "Proximity Update — Orbit 2",
                summary: "After two orbital periods, the UCT has closed to 48 km. Closing rate appears consistent and deliberate.",
                severity: "warning",
                primaryId: "UCT-GAMMA-04",
                secondaryId: "GSAT-19",
                closestDistanceKm: 48,
                assetIds: ["UCT-GAMMA-04", "GSAT-19"],
                visual: {
                    kind: "conjunction",
                    primaryPosition: { lat: 12.5, lon: 74.0, altKm: 35786 },
                    secondaryPosition: { lat: 12.5, lon: 73.95, altKm: 35785 }
                },
                objectiveIds: ["obj-2"]
            }),
            checkpoint(35, "RPO assessment gate", "Formally assess whether the closing profile is consistent with deliberate RPO activity."),
            event(40, {
                type: "manoeuvre",
                title: "UCT Station Change Detected",
                summary: "The UCT performs a small delta-v that adjusts its closing rate — consistent with active proximity navigation.",
                severity: "critical",
                primaryId: "UCT-GAMMA-04",
                assetIds: ["UCT-GAMMA-04"],
                visual: {
                    kind: "track",
                    from: { lat: 12.5, lon: 73.96, altKm: 35785 },
                    to: { lat: 12.5, lon: 73.98, altKm: 35786 },
                    label: "UCT delta-v"
                },
                objectiveIds: ["obj-2", "obj-3"]
            }),
            event(55, {
                type: "neighbourhood_watch",
                title: "Critical Proximity Threshold",
                summary: "UCT is now within 15 km of GSAT-19. Conjunction probability is increasing. Recommend posture decision.",
                severity: "critical",
                primaryId: "UCT-GAMMA-04",
                secondaryId: "GSAT-19",
                closestDistanceKm: 14.8,
                assetIds: ["UCT-GAMMA-04", "GSAT-19"],
                visual: {
                    kind: "conjunction",
                    primaryPosition: { lat: 12.5, lon: 74.0, altKm: 35786 },
                    secondaryPosition: { lat: 12.5, lon: 73.99, altKm: 35786 }
                },
                objectiveIds: ["obj-3", "obj-4"]
            }),
            checkpoint(62, "Protective posture decision", "Record the recommended protective posture and justification.")
        ]
    },

    {
        id: "synthetic-rpo-drill",
        title: "Rendezvous & Proximity Operations Drill",
        category: "RPO threat",
        type: "synthetic",
        difficulty: "Expert",
        durationMinutes: 80,
        startTime: "2026-07-01T03:15:00Z",
        description: "An intensive RPO drill where an adversary spacecraft executes a multi-phase approach on an Indian MEO navigation asset. Operators must detect, classify, and respond to each phase.",
        participatingAssets: ["IRNSS-1H", "ADVERSARY-CHASER", "UCT-RPO-01", "SENSOR-SOUTH-3"],
        tags: ["rpo", "adversary", "meo", "navigation", "multi-phase", "expert", "irnss"],
        learningObjectives: [
            "Identify multi-phase RPO approach from sequential TLE changes",
            "Distinguish co-orbital trailing from active approach",
            "Coordinate protective manoeuvre recommendations for a MEO navigation asset"
        ],
        debriefNotes: "This scenario has three distinct phases. Operators who identify Phase 1 as station-keeping are technically correct but will fall behind when Phase 2 begins. The critical decision point is T+35 — by T+45 the response options have narrowed significantly.",
        successCriteria: [
            "Phase 1 drift detected and flagged by T+15",
            "Phase 2 active approach confirmed by T+38",
            "Protective posture recommendation issued by T+50",
            "Phase 3 intercept geometry assessed before T+70"
        ],
        failureCriteria: [
            "Phase 2 not distinguished from Phase 1 before T+45",
            "No protective recommendation before T+55"
        ],
        objectives: [
            makeObjective("obj-1", "Detect Phase 1 drift approach"),
            makeObjective("obj-2", "Confirm Phase 2 active approach"),
            makeObjective("obj-3", "Issue protective posture recommendation"),
            makeObjective("obj-4", "Assess Phase 3 intercept geometry")
        ],
        timeline: [
            checkpoint(0, "RPO watch start", "IRNSS-1H is in nominal MEO orbit. Adversary object is at 800 km range."),
            event(12, {
                type: "manoeuvre",
                title: "Phase 1 — Drift Approach",
                summary: "The adversary object begins a slow Hohmann transfer toward the IRNSS orbit plane. Appears consistent with passive drift.",
                severity: "warning",
                primaryId: "ADVERSARY-CHASER",
                secondaryId: "IRNSS-1H",
                assetIds: ["ADVERSARY-CHASER", "IRNSS-1H"],
                visual: {
                    kind: "track",
                    from: { lat: 18.0, lon: 72.0, altKm: 19000 },
                    to: { lat: 18.5, lon: 72.8, altKm: 19800 },
                    label: "Phase 1 drift"
                },
                objectiveIds: ["obj-1"]
            }),
            event(28, {
                type: "neighbourhood_watch",
                title: "Closing Rate Increasing",
                summary: "The adversary object has doubled its closing rate. Range to IRNSS-1H is now 280 km.",
                severity: "warning",
                primaryId: "ADVERSARY-CHASER",
                secondaryId: "IRNSS-1H",
                closestDistanceKm: 280,
                assetIds: ["ADVERSARY-CHASER", "IRNSS-1H"],
                visual: {
                    kind: "conjunction",
                    primaryPosition: { lat: 18.8, lon: 73.5, altKm: 20000 },
                    secondaryPosition: { lat: 19.0, lon: 74.2, altKm: 20200 }
                },
                objectiveIds: ["obj-1"]
            }),
            checkpoint(35, "Phase assessment gate", "Is this passive drift or active approach? Commit to an assessment."),
            event(40, {
                type: "manoeuvre",
                title: "Phase 2 — Active Approach Confirmed",
                summary: "Multiple delta-v burns detected. The adversary object is executing an active co-elliptic approach. Range 85 km.",
                severity: "critical",
                primaryId: "ADVERSARY-CHASER",
                secondaryId: "IRNSS-1H",
                closestDistanceKm: 85,
                assetIds: ["ADVERSARY-CHASER", "IRNSS-1H"],
                visual: {
                    kind: "track",
                    from: { lat: 19.4, lon: 75.0, altKm: 20180 },
                    to: { lat: 19.6, lon: 75.9, altKm: 20190 },
                    label: "Phase 2 approach burns"
                },
                objectiveIds: ["obj-2"]
            }),
            event(52, {
                type: "neighbourhood_watch",
                title: "Critical Range Threshold",
                summary: "Adversary is now within 20 km. Phase 3 intercept geometry is achievable. Response window is narrowing.",
                severity: "critical",
                primaryId: "ADVERSARY-CHASER",
                secondaryId: "IRNSS-1H",
                closestDistanceKm: 19.5,
                assetIds: ["ADVERSARY-CHASER", "IRNSS-1H"],
                visual: {
                    kind: "conjunction",
                    primaryPosition: { lat: 19.8, lon: 76.5, altKm: 20195 },
                    secondaryPosition: { lat: 19.9, lon: 76.6, altKm: 20200 }
                },
                objectiveIds: ["obj-3"]
            }),
            checkpoint(62, "Posture recommendation checkpoint", "Issue the formal protective posture recommendation."),
            event(68, {
                type: "manoeuvre",
                title: "Phase 3 — Proximity Station",
                summary: "The adversary object holds at 8 km with stationkeeping burns. Sustained proximity threat confirmed.",
                severity: "critical",
                primaryId: "ADVERSARY-CHASER",
                secondaryId: "IRNSS-1H",
                closestDistanceKm: 8.2,
                assetIds: ["ADVERSARY-CHASER", "IRNSS-1H"],
                visual: {
                    kind: "conjunction",
                    primaryPosition: { lat: 20.0, lon: 77.0, altKm: 20200 },
                    secondaryPosition: { lat: 20.0, lon: 77.05, altKm: 20200 }
                },
                objectiveIds: ["obj-4"]
            }),
            checkpoint(76, "Incident record closure", "Document the full three-phase sequence and recommended follow-up actions.")
        ]
    },

    {
        id: "synthetic-cyber-jamming",
        title: "GPS Jamming & Signal Denial",
        category: "electronic warfare",
        type: "synthetic",
        difficulty: "Advanced",
        durationMinutes: 45,
        startTime: "2026-05-28T08:00:00Z",
        description: "A synthetic electronic warfare scenario where GPS jamming disrupts navigation for Indian assets and operators must identify the source region, assess affected assets, and coordinate alternative navigation support.",
        participatingAssets: ["NAVIC-1F", "IRNSS-1G", "JAM-SOURCE-01", "SENSOR-EW-02"],
        tags: ["jamming", "gps", "navic", "electronic-warfare", "signal-denial", "navigation"],
        learningObjectives: [
            "Identify the onset of GPS jamming from orbital asset anomalies",
            "Assess which navigation assets are affected by the jamming source",
            "Coordinate alternative navigation support and source-identification tasking"
        ],
        debriefNotes: "GPS jamming at orbital altitudes is typically characterised by ground-reported navigation anomalies, not direct sensor detections. Operators should use the ground-reported signatures to narrow the jamming source region, then task appropriate sensors for RF analysis.",
        successCriteria: [
            "Jamming onset recognised and reported within 10 minutes of T+5",
            "Affected asset list compiled by T+20",
            "Source region narrowed to within 500 km by T+35",
            "Alternative navigation support coordinated before exercise end"
        ],
        failureCriteria: [
            "Jamming not distinguished from sensor malfunction",
            "No source-region assessment before T+40"
        ],
        objectives: [
            makeObjective("obj-1", "Detect and report GPS jamming onset"),
            makeObjective("obj-2", "Identify affected navigation assets"),
            makeObjective("obj-3", "Narrow the jamming source region"),
            makeObjective("obj-4", "Coordinate alternative navigation support")
        ],
        timeline: [
            checkpoint(0, "Navigation baseline", "NavIC and GPS operating nominally. All assets reporting clean fix."),
            event(5, {
                type: "blind_spot",
                title: "Navigation Anomaly Reported",
                summary: "Multiple ground stations report degraded GPS fix quality over the northern corridor. NavIC assets show elevated noise floor.",
                severity: "warning",
                primaryId: "JAM-SOURCE-01",
                assetIds: ["NAVIC-1F", "IRNSS-1G", "JAM-SOURCE-01"],
                visual: {
                    kind: "blackout",
                    position: { lat: 30.0, lon: 76.0, altKm: 0 },
                    radiusKm: 600
                },
                objectiveIds: ["obj-1"]
            }),
            event(14, {
                type: "blind_spot",
                title: "Jamming Extent Mapped",
                summary: "Signal analysis places the jamming source in the northern sector. NAVIC-1F and IRNSS-1G signal quality is degraded by 40%.",
                severity: "warning",
                primaryId: "JAM-SOURCE-01",
                assetIds: ["NAVIC-1F", "IRNSS-1G"],
                visual: {
                    kind: "blackout",
                    position: { lat: 31.5, lon: 75.5, altKm: 0 },
                    radiusKm: 450
                },
                objectiveIds: ["obj-2"]
            }),
            checkpoint(22, "Source assessment gate", "Narrow the jamming source region using available RF sensors."),
            event(28, {
                type: "surveillance_pass",
                title: "RF Analysis Pass",
                summary: "An RF-capable asset overflies the suspected source region. Jamming power profile suggests a ground-based platform at approximately 31°N 75°E.",
                severity: "warning",
                primaryId: "SENSOR-EW-02",
                assetIds: ["SENSOR-EW-02", "JAM-SOURCE-01"],
                visual: {
                    kind: "track",
                    from: { lat: 34.0, lon: 74.0, altKm: 480 },
                    to: { lat: 29.0, lon: 76.5, altKm: 481 },
                    label: "EW analysis pass"
                },
                objectiveIds: ["obj-3"]
            }),
            event(38, {
                type: "blind_spot",
                title: "Jamming Cessation",
                summary: "The jamming signal drops abruptly. Source may have relocated. Navigation quality is recovering.",
                severity: "info",
                primaryId: "JAM-SOURCE-01",
                requiresAck: false,
                assetIds: ["NAVIC-1F", "IRNSS-1G"],
                visual: {
                    kind: "marker",
                    position: { lat: 30.8, lon: 75.8, altKm: 0 },
                    label: "Jamming ceased"
                },
                objectiveIds: ["obj-4"]
            }),
            checkpoint(42, "Exercise closure", "Document the jamming event, source assessment, and alternative navigation coordination.")
        ]
    },

    {
        id: "hist-debris-reentry-mass",
        title: "Mass Debris Re-entry Event",
        category: "mass re-entry",
        type: "historical",
        difficulty: "Intermediate",
        durationMinutes: 75,
        startTime: "2025-12-04T14:00:00Z",
        description: "A cluster of debris objects from a historical fragmentation event re-enters over a multi-hour window. Operators track multiple re-entry corridors, prioritise the highest-risk fragments, and issue strategic site warnings.",
        participatingAssets: ["DEBRIS-CLUSTER-7", "FRAG-A", "FRAG-B", "FRAG-C", "REENTRY-TRACK-7"],
        tags: ["reentry", "debris", "multi-object", "strategic-sites", "fragmentation", "mass-event"],
        learningObjectives: [
            "Manage simultaneous re-entry predictions for multiple objects",
            "Prioritise the highest-risk fragment from a debris cluster",
            "Issue strategic site warnings in the correct priority sequence"
        ],
        debriefNotes: "Fragment B is the highest-risk object (largest estimated size, most proximate corridor to a strategic site) but Fragment A reaches re-entry first. Operators who fix on Fragment A and delay Fragment B assessment will miss the strategic site warning window.",
        successCriteria: [
            "Debris cluster identified and all fragments tracked by T+15",
            "Fragment B identified as highest-risk by T+30",
            "Strategic site warnings issued in priority sequence before T+55",
            "All-clear or confirmed re-entry documented for all fragments"
        ],
        failureCriteria: [
            "Fragment B not identified as priority threat before T+45",
            "Strategic site warnings issued in incorrect priority sequence"
        ],
        objectives: [
            makeObjective("obj-1", "Track all debris cluster fragments"),
            makeObjective("obj-2", "Identify the highest-risk fragment"),
            makeObjective("obj-3", "Issue strategic site warnings in priority sequence"),
            makeObjective("obj-4", "Document confirmed re-entry for all objects")
        ],
        timeline: [
            checkpoint(0, "Cluster tracking start", "Three debris fragments from the historical fragmentation are now in monitored re-entry profiles."),
            event(10, {
                type: "reentry",
                title: "Fragment A — Decay Trend",
                summary: "Fragment A shows clear re-entry trend. Predicted corridor is over the Indian Ocean. Low strategic risk.",
                severity: "warning",
                primaryId: "FRAG-A",
                assetIds: ["FRAG-A"],
                visual: {
                    kind: "reentry",
                    corridor: [
                        { lat: 10.0, lon: 68.0 },
                        { lat: 8.5, lon: 70.5 },
                        { lat: 7.0, lon: 73.0 },
                        { lat: 5.5, lon: 75.5 }
                    ]
                },
                objectiveIds: ["obj-1"]
            }),
            event(18, {
                type: "reentry",
                title: "Fragment B — High-Risk Corridor",
                summary: "Fragment B corridor crosses the Andaman Islands and approaches the Sriharikota region. Strategic review required immediately.",
                severity: "critical",
                primaryId: "FRAG-B",
                assetIds: ["FRAG-B"],
                visual: {
                    kind: "reentry",
                    corridor: [
                        { lat: 16.0, lon: 84.0 },
                        { lat: 14.5, lon: 82.5 },
                        { lat: 13.5, lon: 80.5 },
                        { lat: 12.8, lon: 79.0 }
                    ]
                },
                objectiveIds: ["obj-2"]
            }),
            event(25, {
                type: "reentry",
                title: "Fragment C — Decaying Profile",
                summary: "Fragment C enters re-entry profile. Corridor passes over open ocean south of Sri Lanka. Low strategic risk.",
                severity: "info",
                primaryId: "FRAG-C",
                requiresAck: false,
                assetIds: ["FRAG-C"],
                visual: {
                    kind: "reentry",
                    corridor: [
                        { lat: 8.0, lon: 82.0 },
                        { lat: 7.0, lon: 81.0 },
                        { lat: 6.0, lon: 80.0 },
                        { lat: 4.8, lon: 79.0 }
                    ]
                },
                objectiveIds: ["obj-1"]
            }),
            checkpoint(32, "Priority assessment", "Rank all three fragments by strategic risk. Issue warnings in priority order."),
            event(42, {
                type: "reentry",
                title: "Fragment A Re-entry Confirmed",
                summary: "Fragment A has re-entered over the Indian Ocean. No ground impact risk. Remove from active tracking.",
                severity: "info",
                primaryId: "FRAG-A",
                requiresAck: false,
                assetIds: ["FRAG-A"],
                visual: {
                    kind: "marker",
                    position: { lat: 5.0, lon: 76.0, altKm: 0 },
                    label: "Fragment A — re-entered"
                },
                objectiveIds: ["obj-4"]
            }),
            event(58, {
                type: "reentry",
                title: "Fragment B — Strategic Warning Active",
                summary: "Fragment B is now inside the 2-hour re-entry window. Sriharikota site is within the 3-sigma corridor. Warning is active.",
                severity: "critical",
                primaryId: "FRAG-B",
                assetIds: ["FRAG-B"],
                visual: {
                    kind: "reentry",
                    corridor: [
                        { lat: 14.2, lon: 81.0 },
                        { lat: 13.7, lon: 80.0 },
                        { lat: 13.3, lon: 79.5 },
                        { lat: 13.0, lon: 79.2 }
                    ]
                },
                objectiveIds: ["obj-3"]
            }),
            event(70, {
                type: "reentry",
                title: "Fragment B Re-entry — Corridor Clear",
                summary: "Fragment B has re-entered. Final corridor places impact in the Bay of Bengal, approximately 60 km east of the peninsula. All clear.",
                severity: "info",
                primaryId: "FRAG-B",
                requiresAck: false,
                assetIds: ["FRAG-B"],
                visual: {
                    kind: "marker",
                    position: { lat: 13.0, lon: 82.0, altKm: 0 },
                    label: "Fragment B — re-entered"
                },
                objectiveIds: ["obj-4"]
            }),
            checkpoint(72, "Mass event closure", "Close all fragment tracks and document the strategic warning sequence.")
        ]
    },

    {
        id: "synthetic-multi-sensor-blackout",
        title: "Multi-Sensor Blackout Recovery",
        category: "sensor recovery",
        type: "synthetic",
        difficulty: "Expert",
        durationMinutes: 60,
        startTime: "2026-08-12T20:30:00Z",
        description: "Multiple sensors fail simultaneously during a high-tempo watch period, creating critical coverage gaps over Indian territory. Operators must identify which assets are now unmonitored, task remaining sensors, and manage the degraded picture until recovery.",
        participatingAssets: ["SENSOR-WEST-1", "SENSOR-SOUTH-2", "GSAT-7R", "IRNSS-1F", "CARTOSAT-3"],
        tags: ["sensor-failure", "coverage-gap", "degraded-operations", "resilience", "multi-sensor", "expert"],
        learningObjectives: [
            "Rapidly identify coverage gaps after sensor failure",
            "Prioritise remaining sensor capacity for highest-risk assets",
            "Manage the operational picture through a degraded sensor period"
        ],
        debriefNotes: "The simultaneous failure of two sensors is the key stress event. Operators who have pre-assigned alternate sensors to critical assets will recover faster. The primary evaluation criterion is whether GSAT-7R (the highest-priority Indian asset) remains monitored throughout.",
        successCriteria: [
            "Coverage gaps identified within 8 minutes of T+5",
            "GSAT-7R maintained under monitoring throughout degraded period",
            "Remaining sensors tasked to fill highest-priority gaps by T+20",
            "Full sensor coverage recovered by T+50"
        ],
        failureCriteria: [
            "GSAT-7R loses monitoring for more than 15 continuous minutes",
            "Coverage gap identification takes more than 15 minutes",
            "No alternate tasking assigned before T+25"
        ],
        objectives: [
            makeObjective("obj-1", "Identify all coverage gaps from sensor failures"),
            makeObjective("obj-2", "Maintain GSAT-7R under monitoring"),
            makeObjective("obj-3", "Task remaining sensors to fill critical gaps"),
            makeObjective("obj-4", "Document the recovery sequence")
        ],
        timeline: [
            checkpoint(0, "Full coverage baseline", "All 10 sensors are nominal. Full coverage of Indian operational region."),
            event(5, {
                type: "sensor_blackout",
                title: "Dual Sensor Failure",
                summary: "SENSOR-WEST-1 and SENSOR-SOUTH-2 go offline simultaneously. Critical coverage gap opens over the Deccan plateau and western approach corridor.",
                severity: "critical",
                primaryId: "SENSOR-WEST-1",
                assetIds: ["SENSOR-WEST-1", "SENSOR-SOUTH-2"],
                requiresAck: false,
                visual: {
                    kind: "blackout",
                    position: { lat: 18.0, lon: 76.0, altKm: 0 },
                    radiusKm: 1400
                },
                objectiveIds: ["obj-1"]
            }),
            event(8, {
                type: "blind_spot",
                title: "Coverage Gap Assessment",
                summary: "Three monitored assets are now in gap periods. GSAT-7R is approaching a coverage gap. Alternate sensor tasking required immediately.",
                severity: "critical",
                primaryId: "GSAT-7R",
                assetIds: ["GSAT-7R", "IRNSS-1F", "CARTOSAT-3"],
                visual: {
                    kind: "blackout",
                    position: { lat: 16.0, lon: 74.5, altKm: 0 },
                    radiusKm: 900
                },
                objectiveIds: ["obj-1", "obj-2"]
            }),
            checkpoint(15, "Alternate tasking gate", "Task available sensors to fill highest-priority gaps. GSAT-7R takes priority."),
            event(20, {
                type: "surveillance_pass",
                title: "Alternate Sensor Coverage Confirmed",
                summary: "Hyderabad DRDO Multi-Mode station has acquired GSAT-7R. Coverage gap for primary asset closed.",
                severity: "info",
                primaryId: "GSAT-7R",
                requiresAck: false,
                assetIds: ["GSAT-7R"],
                visual: {
                    kind: "track",
                    from: { lat: 17.0, lon: 76.5, altKm: 35786 },
                    to: { lat: 17.0, lon: 76.5, altKm: 35786 },
                    label: "GSAT-7R reacquired"
                },
                objectiveIds: ["obj-2", "obj-3"]
            }),
            event(35, {
                type: "sensor_blackout",
                title: "Partial Recovery — SENSOR-SOUTH-2 Back Online",
                summary: "SENSOR-SOUTH-2 has recovered and is resuming normal tasking. SENSOR-WEST-1 remains offline.",
                severity: "warning",
                primaryId: "SENSOR-SOUTH-2",
                requiresAck: false,
                assetIds: ["SENSOR-SOUTH-2"],
                visual: {
                    kind: "marker",
                    position: { lat: 13.0, lon: 77.6, altKm: 0 },
                    label: "South sensor recovered"
                },
                objectiveIds: ["obj-3"]
            }),
            event(48, {
                type: "sensor_blackout",
                title: "Full Recovery — SENSOR-WEST-1 Restored",
                summary: "All sensors are now operational. Coverage is restored to full nominal state. Operational tempo can return to normal.",
                severity: "info",
                primaryId: "SENSOR-WEST-1",
                requiresAck: false,
                assetIds: ["SENSOR-WEST-1"],
                visual: {
                    kind: "marker",
                    position: { lat: 19.0, lon: 72.8, altKm: 0 },
                    label: "West sensor recovered"
                },
                objectiveIds: ["obj-4"]
            }),
            checkpoint(55, "Recovery review", "Document the full recovery sequence and identify any process improvements.")
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
