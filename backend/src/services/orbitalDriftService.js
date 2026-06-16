const { getRevisionHistory } = require("./tleRevisionHistoryService");
const { createPropagationRecord, propagateState, getOrbitMinutes, getOrbitSampleSeconds, parseTleLine2OrbitalMetrics } = require("./orbitalPropagationService");
const satellite = require("satellite.js");

/**
 * Generate historical orbit tracks for drift visualization
 */
async function generateDriftHistory(noradId, satelliteName, days = 5, startTime = null) {
    let referenceTime;
    if (startTime) {
        const parsedTime = Number.parseInt(startTime, 10);
        referenceTime = Number.isFinite(parsedTime) ? new Date(parsedTime) : new Date(startTime);
    } else {
        referenceTime = new Date();
    }

    if (isNaN(referenceTime.getTime())) {
        referenceTime = new Date();
    }

    // 1. Fetch TLE history
    const history = await getRevisionHistory(noradId, satelliteName, { limit: 200 });
    if (!history || history.length === 0) {
        return null;
    }

    // 2. Group by day and pick representative revisions
    const dailyRevisions = selectDailyRevisions(history, days, referenceTime);

    // 3. Generate trajectories for each revision
    const tracks = [];
    for (let i = 0; i < dailyRevisions.length; i++) {
        const rev = dailyRevisions[i];
        const dayOffset = rev.dayOffset;

        // Use true SGP4 propagation without fixed GMST to show "actual paths"
        const track = generateTrackForRevision(rev, 1.0, null, referenceTime);

        const progress = i / (dailyRevisions.length - 1 || 1);
        const visualProps = getTemporalVisuals(progress, i === dailyRevisions.length - 1, Math.abs(dayOffset));

        tracks.push({
            dayOffset,
            epoch: rev.tleEpoch,
            samples: track,
            ...visualProps
        });
    }

    // 4. Calculate Operational Deltas for interpretation
    const deltas = calculateOperationalDeltas(dailyRevisions);

    return {
        satelliteName: satelliteName || (history[0] ? history[0].satelliteName : "Unknown"),
        noradId: noradId || (history[0] ? history[0].noradId : null),
        tracks,
        analysis: deltas
    };
}

function selectDailyRevisions(history, days, referenceTime) {
    const dayMap = new Map();
    // Sort history by epoch descending (latest first)
    const sorted = [...history].sort((a, b) => new Date(b.tleEpoch) - new Date(a.tleEpoch));

    if (sorted.length === 0) {
        return [];
    }

    // Anchor: The latest known state is always Day 0
    const latest = sorted[0];
    const baseEpoch = new Date(latest.tleEpoch);
    dayMap.set(0, { ...latest, dayOffset: 0 });

    for (const rev of sorted) {
        if (rev.tleChecksum === latest.tleChecksum && dayMap.size > 0) {
            // Skip the anchor itself in the loop to avoid double-processing
            if (dayMap.has(0) && rev.id === latest.id) continue;
        }

        const epoch = new Date(rev.tleEpoch);
        // Calculate drift days relative to the latest TLE, not the absolute wall clock.
        // This ensures a stable 1d, 2d, 3d sequence even if the latest TLE is old or simulation time is ahead.
        const diffMs = baseEpoch - epoch;
        const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24));

        if (diffDays >= 0 && diffDays <= days) {
            if (!dayMap.has(diffDays)) {
                dayMap.set(diffDays, { ...rev, dayOffset: -diffDays });
            }
        }
    }

    // If still sparse, pick the next available revisions regardless of exact day alignment
    if (dayMap.size < days + 1 && sorted.length > dayMap.size) {
        let lastAddedEpoch = baseEpoch;
        let virtualDay = 1;

        for (let i = 1; i < sorted.length && dayMap.size <= days; i++) {
            const rev = sorted[i];
            const epoch = new Date(rev.tleEpoch);
            const ageDiffMs = lastAddedEpoch - epoch;

            // Ensure at least 18h separation between evolution points
            if (ageDiffMs > 18 * 60 * 60 * 1000) {
                // Find first available "virtual day" slot
                while (dayMap.has(virtualDay) && virtualDay <= days) {
                    virtualDay++;
                }
                
                if (virtualDay <= days) {
                    dayMap.set(virtualDay, { ...rev, dayOffset: -virtualDay });
                    lastAddedEpoch = epoch;
                }
            }
        }
    }

    return Array.from(dayMap.values()).sort((a, b) => a.dayOffset - b.dayOffset);
}

function generateTrackForRevision(revision, orbits = 1.0, fixedGmst = null, referenceTime = null) {
    const record = createPropagationRecord(revision);
    if (!record) return [];

    const orbitMinutes = getOrbitMinutes(record);
    const totalMinutes = orbitMinutes * orbits;
    // Drift rings need the same sampling density as the main preview.
    const stepSeconds = getOrbitSampleSeconds(record);
    const totalSteps = Math.floor((totalMinutes * 60) / stepSeconds);

    const samples = [];
    // Start all tracks at the same reference time to allow direct comparison
    const startTime = referenceTime ? new Date(referenceTime) : new Date(revision.tleEpoch);

    for (let i = 0; i <= totalSteps; i++) {
        const time = new Date(startTime.getTime() + i * stepSeconds * 1000);
        const state = propagateState(record, time, null, fixedGmst);
        if (state) {
            samples.push({
                x: state.eci.x * 1000,
                y: state.eci.y * 1000,
                z: state.eci.z * 1000,
                lat: state.lat,
                lon: state.lon,
                altKm: state.altKm,
                time: time.toISOString()
            });
        }
    }

    return samples;
}

function calculateOperationalDeltas(dailyRevisions) {
    if (dailyRevisions.length < 2) return null;

    const latest = dailyRevisions[dailyRevisions.length - 1];
    const oldest = dailyRevisions[0];

    const latestMetrics = parseTleLine2OrbitalMetrics(latest.line2);
    const oldestMetrics = parseTleLine2OrbitalMetrics(oldest.line2);

    if (!latestMetrics || !oldestMetrics) return null;

    return {
        inclinationShiftDeg: latestMetrics.inclinationDeg - oldestMetrics.inclinationDeg,
        smaShiftKm: latestMetrics.semiMajorAxisKm - oldestMetrics.semiMajorAxisKm,
        periodShiftMinutes: (1440 / latestMetrics.meanMotionRevPerDay) - (1440 / oldestMetrics.meanMotionRevPerDay),
        daysAnalyzed: Math.abs(latest.dayOffset - oldest.dayOffset)
    };
}

function getTemporalVisuals(progress, isLatest, dayIndex) {
    // Conceptual Color Progression:
    // Purple (Day -5) -> Blue -> Cyan -> Yellow -> Orange -> Red (Current)
    const colors = [
        "#9c42f5",
        "#4287f5",
        "#42f5e3",
        "#f5f542",
        "#f5a142",
        "#f54242"
    ];

    if (isLatest) {
        return {
            color: colors[5],
            opacity: 1.0,
            width: 5.5,
            isCurrent: true
        };
    }

    // Map dayIndex (0 to 5) to color index (5 to 0)
    const colorIdx = Math.max(0, 5 - dayIndex);
    const color = colors[colorIdx];

    const opacity = 0.4 + (progress * 0.4);
    const width = 2.5 + (progress * 1.5);

    return { color, opacity, width, isCurrent: false };
}

module.exports = {
    generateDriftHistory
};
