const { Op } = require("sequelize");
const { SatelliteTleRevision } = require("../models/satelliteTleRevision");
const {
    computeCentroid,
    pointInPolygon,
    createPropagationRecord,
    parseTleLine2OrbitalMetrics,
    propagateState,
    toRadians
} = require("./orbitalPropagationService");
const {
    isEffectivelyCovered,
    resolveSensorProfile
} = require("../../../shared/blindSpotCoverageUtils");

const DEFAULT_WINDOW_DAYS = 30;
const DEFAULT_BASELINE_SPLIT = 0.5;
const DEFAULT_SAMPLE_MINUTES = 30;
const DEFAULT_VISIBILITY_THRESHOLD_DEG = 10;
const DEFAULT_MAX_FINDINGS = 15;
const DEFAULT_MAX_SATELLITES = 150;
const DEFAULT_LOOKBACK_BUFFER_DAYS = 30;
const MIN_SAMPLE_MINUTES = 10;
const MAX_SAMPLE_MINUTES = 120;
const MIN_PERSISTENT_VISIBILITY_MINUTES = 30;

function clamp01(value) {
    if (!Number.isFinite(value)) {
        return 0;
    }
    return Math.max(0, Math.min(1, value));
}

function normalizeDays(value, fallback = DEFAULT_WINDOW_DAYS) {
    const parsed = Number(value);
    if (!Number.isFinite(parsed) || parsed <= 0) {
        return fallback;
    }
    return Math.min(180, Math.max(7, Math.round(parsed)));
}

function normalizeSampleMinutes(value, fallback = DEFAULT_SAMPLE_MINUTES) {
    const parsed = Number(value);
    if (!Number.isFinite(parsed) || parsed <= 0) {
        return fallback;
    }
    return Math.min(MAX_SAMPLE_MINUTES, Math.max(MIN_SAMPLE_MINUTES, Math.round(parsed)));
}

function normalizeLimit(value, fallback = DEFAULT_MAX_FINDINGS) {
    const parsed = Number(value);
    if (!Number.isFinite(parsed) || parsed <= 0) {
        return fallback;
    }
    return Math.min(100, Math.max(1, Math.round(parsed)));
}

function normalizeRegion(area = {}) {
    const points = Array.isArray(area.points) ? area.points.filter((point) => Number.isFinite(point?.lat) && Number.isFinite(point?.lon)) : [];
    const centroid = area.centroid || (points.length >= 3 ? computeCentroid(points) : points[0] || null);

    if (!centroid) {
        return null;
    }

    let bounds = area.bounds || null;
    if (!bounds && points.length) {
        let minLat = 90;
        let maxLat = -90;
        let minLon = 180;
        let maxLon = -180;
        for (const point of points) {
            minLat = Math.min(minLat, point.lat);
            maxLat = Math.max(maxLat, point.lat);
            minLon = Math.min(minLon, point.lon);
            maxLon = Math.max(maxLon, point.lon);
        }
        bounds = { minLat, maxLat, minLon, maxLon };
    }

    return {
        name: area.name || "Regional Area",
        centroid,
        points: points.length ? points : [centroid],
        bounds
    };
}

function generateRegionSamples(region) {
    const samples = [];
    const centroid = region.centroid;

    samples.push({ lat: centroid.lat, lon: centroid.lon, weight: 0.45 });

    if (Array.isArray(region.points) && region.points.length >= 3 && region.bounds) {
        const grid = [];
        const latStep = (region.bounds.maxLat - region.bounds.minLat) / 3;
        const lonStep = (region.bounds.maxLon - region.bounds.minLon) / 3;

        for (let lat = region.bounds.minLat + latStep / 2; lat < region.bounds.maxLat; lat += latStep) {
            for (let lon = region.bounds.minLon + lonStep / 2; lon < region.bounds.maxLon; lon += lonStep) {
                const candidate = { lat, lon };
                if (pointInPolygon(candidate, region.points)) {
                    grid.push(candidate);
                }
            }
        }

        if (!grid.length) {
            grid.push(...region.points.slice(0, 4));
        }

        const nonCentroid = grid
            .filter((point) => Math.abs(point.lat - centroid.lat) > 1e-6 || Math.abs(point.lon - centroid.lon) > 1e-6)
            .slice(0, 8);

        const remainingWeight = 0.55;
        const weight = nonCentroid.length ? remainingWeight / nonCentroid.length : 0;
        for (const point of nonCentroid) {
            samples.push({ ...point, weight });
        }
    }

    const totalWeight = samples.reduce((sum, sample) => sum + sample.weight, 0) || 1;
    return samples.map((sample) => ({
        ...sample,
        weight: sample.weight / totalWeight
    }));
}

function buildObserver(point) {
    return {
        latitude: toRadians(point.lat),
        longitude: toRadians(point.lon),
        height: 0
    };
}

function computePointAccess(record, date, point, visibilityThresholdDeg, dependencies) {
    const propagated = dependencies.propagateState(record, date, buildObserver(point));
    if (!propagated) {
        return {
            coverageStrength: 0,
            isAccess: false
        };
    }

    const profile = dependencies.resolveSensorProfile(record?.satelliteName || record?.name || record?.id || record);
    const coverage = dependencies.isEffectivelyCovered({
        elevationDeg: propagated.elevationDeg,
        rangeKm: propagated.rangeKm,
        profile,
        date,
        name: record?.satelliteName || record?.name || record?.id || record,
        minElevationDeg: Math.max(profile.minElevationDeg, visibilityThresholdDeg)
    });

    return {
        coverageStrength: coverage.coverageStrength || 0,
        isAccess: Boolean(coverage.isEffectivelyCovered),
        profileKey: profile.key,
        rejectionReasons: coverage.rejectionReasons || []
    };
}

function compareVisibilityWindows(baselineStats, recentStats) {
    const previousPassCount = baselineStats.passCount || 0;
    const recentPassCount = recentStats.passCount || 0;
    const previousVisibilityMinutes = baselineStats.visibilityMinutes || 0;
    const recentVisibilityMinutes = recentStats.visibilityMinutes || 0;
    const previousAverageVisibilityDuration = previousPassCount > 0 ? previousVisibilityMinutes / previousPassCount : 0;
    const recentAverageVisibilityDuration = recentPassCount > 0 ? recentVisibilityMinutes / recentPassCount : 0;
    const revisitChangePercent = previousPassCount > 0
        ? ((recentPassCount - previousPassCount) / previousPassCount) * 100
        : (recentPassCount > 0 ? 100 : 0);
    const durationChangePercent = previousAverageVisibilityDuration > 0
        ? ((recentAverageVisibilityDuration - previousAverageVisibilityDuration) / previousAverageVisibilityDuration) * 100
        : (recentAverageVisibilityDuration > 0 ? 100 : 0);

    return {
        previousPassCount,
        recentPassCount,
        previousVisibilityMinutes,
        recentVisibilityMinutes,
        previousCoveragePercent: baselineStats.coveragePercent || 0,
        recentCoveragePercent: recentStats.coveragePercent || 0,
        previousAverageVisibilityDuration,
        recentAverageVisibilityDuration,
        previousAverageRevisitIntervalMinutes: baselineStats.averageRevisitIntervalMinutes || 0,
        recentAverageRevisitIntervalMinutes: recentStats.averageRevisitIntervalMinutes || 0,
        revisitChangePercent,
        durationChangePercent,
        averageCoverageStrengthDelta: (recentStats.averageCoverageStrength || 0) - (baselineStats.averageCoverageStrength || 0),
        maxCoverageStrengthDelta: (recentStats.maxCoverageStrength || 0) - (baselineStats.maxCoverageStrength || 0)
    };
}

function computePresenceChangeScore(comparison, drift = {}) {
    const trendScore = comparison.previousPassCount === 0 && comparison.recentPassCount > 0
        ? 1
        : comparison.recentPassCount > comparison.previousPassCount
            ? 0.7
            : comparison.recentPassCount === comparison.previousPassCount && comparison.recentPassCount > 0
                ? 0.45
                : 0.1;
    const passScore = clamp01(comparison.recentPassCount / 6);
    const durationScore = clamp01(comparison.recentAverageVisibilityDuration / 90);
    const revisitScore = clamp01((comparison.previousPassCount === 0 ? comparison.recentPassCount : comparison.revisitChangePercent / 100) / 3);
    const strengthScore = clamp01((comparison.recentVisibilityMinutes > 0 ? comparison.averageCoverageStrengthDelta + 0.5 : 0));
    const driftScore = clamp01((drift.driftMagnitudeKm || 0) / 25);
    const deltaScore = clamp01((comparison.revisitChangePercent + 100) / 200);
    const persistenceScore = clamp01(comparison.recentCoveragePercent / 20);

    return clamp01(
        (trendScore * 0.30) +
        (passScore * 0.20) +
        (durationScore * 0.15) +
        (revisitScore * 0.10) +
        (strengthScore * 0.15) +
        (driftScore * 0.10) +
        (deltaScore * 0.05) +
        (persistenceScore * 0.05)
    );
}

function classifyOperationalSeverity(confidenceScore, comparison) {
    if (comparison.previousPassCount === 0 && comparison.recentPassCount > 0 && confidenceScore >= 0.8) {
        return "high";
    }

    if (confidenceScore >= 0.7) {
        return "high";
    }

    if (confidenceScore >= 0.45) {
        return "medium";
    }

    return "low";
}

function detectUnexpectedRegionalAccess({ history = [], area, time = new Date(), timeframeDays = DEFAULT_WINDOW_DAYS, baselineSplitDays = null, sampleMinutes = DEFAULT_SAMPLE_MINUTES, visibilityThresholdDeg = DEFAULT_VISIBILITY_THRESHOLD_DEG, maxFindings = DEFAULT_MAX_FINDINGS, satelliteName = null, noradId = null, dependencies = {} } = {}) {
    const region = normalizeRegion(area);
    if (!region) {
        return {
            analysisType: "regional_presence",
            region: null,
            findings: [],
            summary: {
                satellitesAnalyzed: 0,
                historyRows: 0,
                windowDays: normalizeDays(timeframeDays),
                baselineDays: 0,
                recentDays: 0
            },
            debugMetrics: {}
        };
    }

    const deps = {
        propagateState,
        resolveSensorProfile,
        isEffectivelyCovered,
        parseTleLine2OrbitalMetrics,
        ...dependencies
    };

    const endDate = new Date(time);
    const windowDays = normalizeDays(timeframeDays);
    const lookbackStart = new Date(endDate.getTime() - (windowDays + DEFAULT_LOOKBACK_BUFFER_DAYS) * 24 * 60 * 60 * 1000);
    const windowStart = new Date(endDate.getTime() - windowDays * 24 * 60 * 60 * 1000);
    const splitDays = Number.isFinite(baselineSplitDays) && baselineSplitDays > 0
        ? Math.min(windowDays - 1, Math.max(1, Math.round(baselineSplitDays)))
        : Math.max(1, Math.floor(windowDays * DEFAULT_BASELINE_SPLIT));
    const splitDate = new Date(windowStart.getTime() + splitDays * 24 * 60 * 60 * 1000);
    const sampleStepMinutes = normalizeSampleMinutes(sampleMinutes);
    const filters = [];

    if (satelliteName) {
        filters.push({ satelliteName });
    }
    if (Number.isFinite(noradId)) {
        filters.push({ noradId });
    }

    const filteredHistory = history.filter((row) => {
        if (!filters.length) {
            return true;
        }
        return filters.some((filter) => {
            if (filter.satelliteName && row.satelliteName !== filter.satelliteName) {
                return false;
            }
            if (Number.isFinite(filter.noradId) && row.noradId !== filter.noradId) {
                return false;
            }
            return true;
        });
    });

    const grouped = new Map();
    for (const row of filteredHistory) {
        const key = row.noradId ? `id:${row.noradId}` : `name:${String(row.satelliteName || "").toUpperCase()}`;
        if (!grouped.has(key)) {
            grouped.set(key, []);
        }
        grouped.get(key).push(row);
    }

    const regionSamples = generateRegionSamples(region);
    const findings = [];
    const debugMetrics = {
        satellitesAnalyzed: 0,
        historyRows: filteredHistory.length,
        profileUsageCounts: {},
        totalSamples: 0,
        passSamples: 0,
        coverageStrengthSum: 0,
        persistenceSuppressedCount: 0,
        rejectionCounts: {
            range: 0,
            offNadir: 0,
            elevation: 0,
            threshold: 0,
            persistence: 0
        }
    };

    for (const rows of grouped.values()) {
        rows.sort((a, b) => new Date(a.tleEpoch || a.ingestedAt) - new Date(b.tleEpoch || b.ingestedAt));
        if (rows.length < 2) {
            continue;
        }

        debugMetrics.satellitesAnalyzed += 1;

        const samples = [];
        for (let i = 0; i < rows.length; i++) {
            const current = rows[i];
            const start = new Date(Math.max(new Date(current.tleEpoch || current.ingestedAt).getTime(), lookbackStart.getTime()));
            const next = rows[i + 1];
            const naturalEnd = next ? new Date(next.tleEpoch || next.ingestedAt) : endDate;
            const stop = new Date(Math.min(naturalEnd.getTime(), endDate.getTime()));
            if (stop <= start) {
                continue;
            }
            samples.push({
                revision: current,
                start,
                stop
            });
        }

        if (!samples.length) {
            continue;
        }

        const baselineStats = runVisibilityWindow(samples, regionSamples, {
            windowStart,
            windowEnd: splitDate,
            sampleStepMinutes,
            visibilityThresholdDeg,
            deps,
            debugMetrics
        });
        const recentStats = runVisibilityWindow(samples, regionSamples, {
            windowStart: splitDate,
            windowEnd: endDate,
            sampleStepMinutes,
            visibilityThresholdDeg,
            deps,
            debugMetrics
        });

        const comparison = compareVisibilityWindows(baselineStats, recentStats);
        const earliestRevision = samples[0]?.revision || rows[0];
        const latestRevision = samples[samples.length - 1]?.revision || rows[rows.length - 1];
        const drift = computeDriftMagnitude(earliestRevision, latestRevision, deps);
        const presenceChangeScore = computePresenceChangeScore(comparison, drift);
        const trend = deriveVisibilityTrend(comparison);
        const meetsPersistence = recentStats.visibilityMinutes >= Math.max(MIN_PERSISTENT_VISIBILITY_MINUTES, sampleStepMinutes * 2);
        const unexpectedRegionalPresence = comparison.previousPassCount === 0 && comparison.recentPassCount > 0 && meetsPersistence;
        const confidenceScore = clamp01(
            (presenceChangeScore * 0.6) +
            (comparison.recentPassCount > 0 ? 0.2 : 0) +
            (comparison.recentAverageVisibilityDuration > 0 ? 0.1 : 0) +
            (drift.driftMagnitudeKm > 0 ? 0.1 : 0)
        );
        const severity = classifyOperationalSeverity(confidenceScore, comparison);

        if (comparison.previousPassCount === 0 && comparison.recentPassCount > 0 && !meetsPersistence) {
            debugMetrics.persistenceSuppressedCount += 1;
            debugMetrics.rejectionCounts.persistence += 1;
            continue;
        }

        if (!unexpectedRegionalPresence && confidenceScore < 0.55) {
            continue;
        }

        const firstDetectedAccess = recentStats.firstObservedAccess || baselineStats.firstObservedAccess || null;

        findings.push({
            satelliteName: latestRevision.satelliteName || earliestRevision.satelliteName,
            noradId: latestRevision.noradId || earliestRevision.noradId || null,
            regionName: region.name,
            firstDetectedAccess,
            previousPassCount: comparison.previousPassCount,
            recentPassCount: comparison.recentPassCount,
            revisitChangePercent: comparison.revisitChangePercent,
            averageVisibilityDuration: recentStats.averageVisibilityDuration,
            averageRevisitIntervalMinutes: recentStats.averageRevisitIntervalMinutes,
            recentAverageRevisitIntervalMinutes: recentStats.averageRevisitIntervalMinutes,
            baselineAverageRevisitIntervalMinutes: baselineStats.averageRevisitIntervalMinutes,
            previousAverageVisibilityDuration: comparison.previousAverageVisibilityDuration,
            recentAverageVisibilityDuration: comparison.recentAverageVisibilityDuration,
            visibilityMinutesBaseline: comparison.previousVisibilityMinutes,
            visibilityMinutesRecent: comparison.recentVisibilityMinutes,
            baselineCoveragePercent: comparison.previousCoveragePercent,
            recentCoveragePercent: comparison.recentCoveragePercent,
            recentMaxDarkDurationMinutes: recentStats.maxDarkDurationMinutes,
            recentAverageDarkDurationMinutes: recentStats.averageDarkDurationMinutes,
            driftMagnitudeKm: drift.driftMagnitudeKm,
            driftMagnitudeScore: drift.driftMagnitudeScore,
            confidenceScore,
            operationalSeverity: severity,
            visibilityTrend: trend,
            unexpectedRegionalPresence,
            presenceChangeScore,
            baselineWindow: {
                start: windowStart.toISOString(),
                end: splitDate.toISOString()
            },
            recentWindow: {
                start: splitDate.toISOString(),
                end: endDate.toISOString()
            },
            analysisKey: `${latestRevision.satelliteName || ""}|${region.name}|${windowStart.toISOString()}|${endDate.toISOString()}`
        });
    }

    findings.sort((a, b) => {
        if (b.confidenceScore !== a.confidenceScore) {
            return b.confidenceScore - a.confidenceScore;
        }
        return (b.recentPassCount - a.recentPassCount) || String(a.satelliteName).localeCompare(String(b.satelliteName));
    });

    const topFindings = findings.slice(0, normalizeLimit(maxFindings));
    return {
        analysisType: "regional_presence",
        region: {
            name: region.name,
            centroid: region.centroid,
            points: region.points,
            bounds: region.bounds
        },
        windowDays,
        baselineWindowDays: splitDays,
        recentWindowDays: windowDays - splitDays,
        sampleMinutes: sampleStepMinutes,
        visibilityThresholdDeg,
        satellitesAnalyzed: debugMetrics.satellitesAnalyzed,
        findings: topFindings,
        summary: {
            satellitesAnalyzed: debugMetrics.satellitesAnalyzed,
            historyRows: debugMetrics.historyRows,
            findingCount: topFindings.length,
            unexpectedRegionalPresenceCount: topFindings.filter((finding) => finding.unexpectedRegionalPresence).length,
            averageConfidenceScore: topFindings.length ? topFindings.reduce((sum, finding) => sum + finding.confidenceScore, 0) / topFindings.length : 0,
            averageRecentPassCount: topFindings.length ? topFindings.reduce((sum, finding) => sum + finding.recentPassCount, 0) / topFindings.length : 0,
            averagePreviousPassCount: topFindings.length ? topFindings.reduce((sum, finding) => sum + finding.previousPassCount, 0) / topFindings.length : 0,
            averageRecentVisibilityMinutes: topFindings.length ? topFindings.reduce((sum, finding) => sum + finding.visibilityMinutesRecent, 0) / topFindings.length : 0,
            regionName: region.name
        },
        debugMetrics: {
            ...debugMetrics,
            totalSamplePoints: regionSamples.length,
            averageCoverageStrength: debugMetrics.totalSamples > 0 ? debugMetrics.coverageStrengthSum / debugMetrics.totalSamples : 0,
            coveragePassRate: debugMetrics.totalSamples > 0 ? debugMetrics.passSamples / debugMetrics.totalSamples : 0,
            rejectionRates: debugMetrics.totalSamples > 0 ? {
                range: debugMetrics.rejectionCounts.range / debugMetrics.totalSamples,
                offNadir: debugMetrics.rejectionCounts.offNadir / debugMetrics.totalSamples,
                elevation: debugMetrics.rejectionCounts.elevation / debugMetrics.totalSamples,
                threshold: debugMetrics.rejectionCounts.threshold / debugMetrics.totalSamples,
                persistence: debugMetrics.rejectionCounts.persistence / debugMetrics.totalSamples
            } : {
                range: 0,
                offNadir: 0,
                elevation: 0,
                threshold: 0,
                persistence: 0
            }
        }
    };
}

function computeDriftMagnitude(previousRevision, latestRevision, dependencies) {
    if (!previousRevision || !latestRevision) {
        return {
            driftMagnitudeKm: 0,
            driftMagnitudeScore: 0
        };
    }

    const previousMetrics = dependencies.parseTleLine2OrbitalMetrics(previousRevision.line2);
    const latestMetrics = dependencies.parseTleLine2OrbitalMetrics(latestRevision.line2);
    if (!previousMetrics || !latestMetrics) {
        return {
            driftMagnitudeKm: 0,
            driftMagnitudeScore: 0
        };
    }

    const deltaSmaKm = Math.abs((latestMetrics.semiMajorAxisKm || 0) - (previousMetrics.semiMajorAxisKm || 0));
    const deltaIncDeg = Math.abs((latestMetrics.inclinationDeg || 0) - (previousMetrics.inclinationDeg || 0));
    const deltaMm = Math.abs((latestMetrics.meanMotionRevPerDay || 0) - (previousMetrics.meanMotionRevPerDay || 0));
    const driftMagnitudeKm = deltaSmaKm + (deltaIncDeg * 10) + (deltaMm * 100);
    return {
        driftMagnitudeKm,
        driftMagnitudeScore: clamp01(driftMagnitudeKm / 30)
    };
}

function deriveVisibilityTrend(comparison) {
    if (comparison.previousPassCount === 0 && comparison.recentPassCount > 0) {
        return "new_access";
    }

    if (comparison.recentPassCount > comparison.previousPassCount) {
        return "rising";
    }

    if (comparison.recentPassCount < comparison.previousPassCount) {
        return "declining";
    }

    if (comparison.recentPassCount > 0) {
        return "stable";
    }

    return "none";
}

function runVisibilityWindow(samples, regionSamples, { windowStart, windowEnd, sampleStepMinutes, visibilityThresholdDeg, deps, debugMetrics }) {
    const startMs = windowStart.getTime();
    const endMs = windowEnd.getTime();
    const sampleMs = sampleStepMinutes * 60 * 1000;
    const windows = [];
    let currentWindow = null;
    let previousAccessEnd = null;
    let totalVisibilityMinutes = 0;
    let visibilityStrengthSum = 0;
    let maxCoverageStrength = 0;
    let firstObservedAccess = null;
    let sampleCount = 0;

    for (let timeMs = startMs; timeMs <= endMs; timeMs += sampleMs) {
        const sampleDate = new Date(timeMs);
        const record = selectRevisionForSample(samples, sampleDate);
        if (!record) {
            continue;
        }

        let weightedStrength = 0;
        let accessWeight = 0;
        let rejectionCounts = {
            range: 0,
            offNadir: 0,
            elevation: 0,
            threshold: 0
        };

        for (const regionPoint of regionSamples) {
            const evaluation = computePointAccess(record, sampleDate, regionPoint, visibilityThresholdDeg, deps);
            weightedStrength += evaluation.coverageStrength * regionPoint.weight;
            if (evaluation.isAccess) {
                accessWeight += regionPoint.weight;
            } else {
                if ((evaluation.rejectionReasons || []).includes("range")) {
                    rejectionCounts.range += 1;
                }
                if ((evaluation.rejectionReasons || []).includes("offNadir")) {
                    rejectionCounts.offNadir += 1;
                }
                if ((evaluation.rejectionReasons || []).includes("belowHorizon") || (evaluation.rejectionReasons || []).includes("belowMinElevation")) {
                    rejectionCounts.elevation += 1;
                }
                if ((evaluation.rejectionReasons || []).includes("threshold")) {
                    rejectionCounts.threshold += 1;
                }
            }
            debugMetrics.totalSamples += 1;
            debugMetrics.passSamples += evaluation.isAccess ? 1 : 0;
            debugMetrics.coverageStrengthSum += evaluation.coverageStrength || 0;
            debugMetrics.profileUsageCounts[evaluation.profileKey] = (debugMetrics.profileUsageCounts[evaluation.profileKey] || 0) + 1;
        }

        debugMetrics.rejectionCounts.range += rejectionCounts.range;
        debugMetrics.rejectionCounts.offNadir += rejectionCounts.offNadir;
        debugMetrics.rejectionCounts.elevation += rejectionCounts.elevation;
        debugMetrics.rejectionCounts.threshold += rejectionCounts.threshold;

        sampleCount += 1;
        const isAccess = weightedStrength >= 0.22 && accessWeight >= (regionSamples.length >= 3 ? 0.45 : 1);
        visibilityStrengthSum += weightedStrength;
        maxCoverageStrength = Math.max(maxCoverageStrength, weightedStrength);

        if (isAccess) {
            totalVisibilityMinutes += sampleStepMinutes;
            if (!firstObservedAccess) {
                firstObservedAccess = sampleDate.toISOString();
            }

            if (!currentWindow) {
                currentWindow = {
                    start: sampleDate.toISOString(),
                    end: sampleDate.toISOString(),
                    durationMinutes: sampleStepMinutes,
                    peakCoverageStrength: weightedStrength,
                    averageCoverageStrength: weightedStrength
                };
            } else {
                currentWindow.end = sampleDate.toISOString();
                currentWindow.durationMinutes += sampleStepMinutes;
                currentWindow.peakCoverageStrength = Math.max(currentWindow.peakCoverageStrength, weightedStrength);
                currentWindow.averageCoverageStrength = (currentWindow.averageCoverageStrength + weightedStrength) / 2;
            }
        } else if (currentWindow) {
            windows.push(currentWindow);
            if (previousAccessEnd) {
                currentWindow.revisitIntervalMinutes = Math.round((sampleDate.getTime() - new Date(previousAccessEnd).getTime()) / 60000);
            }
            previousAccessEnd = currentWindow.end;
            currentWindow = null;
        }
    }

    if (currentWindow) {
        windows.push(currentWindow);
    }

    const revisitIntervals = [];
    for (let i = 1; i < windows.length; i++) {
        const previousEnd = new Date(windows[i - 1].end).getTime();
        const currentStart = new Date(windows[i].start).getTime();
        revisitIntervals.push(Math.max(0, Math.round((currentStart - previousEnd) / 60000)));
    }

    const passCount = windows.length;
    const averageVisibilityDuration = passCount > 0 ? totalVisibilityMinutes / passCount : 0;
    const totalWindowMinutes = Math.max(1, Math.round((endMs - startMs) / 60000));

    return {
        passCount,
        visibilityMinutes: totalVisibilityMinutes,
        averageVisibilityDuration,
        coveragePercent: (totalVisibilityMinutes / totalWindowMinutes) * 100,
        averageCoverageStrength: sampleCount > 0 ? visibilityStrengthSum / sampleCount : 0,
        averageRevisitIntervalMinutes: revisitIntervals.length ? revisitIntervals.reduce((sum, value) => sum + value, 0) / revisitIntervals.length : 0,
        maxCoverageStrength,
        firstObservedAccess,
        revisitIntervals,
        maxDarkDurationMinutes: revisitIntervals.length ? Math.max(...revisitIntervals) : 0,
        averageDarkDurationMinutes: revisitIntervals.length ? revisitIntervals.reduce((sum, value) => sum + value, 0) / revisitIntervals.length : 0,
        sampleCount,
        windows
    };
}

function selectRevisionForSample(samples, sampleDate) {
    let selected = null;
    const sampleTime = sampleDate.getTime();

    for (const sample of samples) {
        if (sample.start.getTime() <= sampleTime && sample.stop.getTime() >= sampleTime) {
            selected = sample.revision;
        }
    }

    return selected;
}

async function loadRegionalPresenceHistory({ satelliteName = null, noradId = null, windowDays = DEFAULT_WINDOW_DAYS, time = new Date(), maxSatellites = DEFAULT_MAX_SATELLITES } = {}) {
    const endDate = new Date(time);
    const lookbackStart = new Date(endDate.getTime() - (normalizeDays(windowDays) + DEFAULT_LOOKBACK_BUFFER_DAYS) * 24 * 60 * 60 * 1000);
    const where = {
        tleEpoch: {
            [Op.gte]: lookbackStart,
            [Op.lte]: endDate
        }
    };

    const filters = [];
    if (satelliteName) {
        filters.push({ satelliteName });
    }
    if (Number.isFinite(noradId)) {
        filters.push({ noradId });
    }
    if (filters.length === 1) {
        Object.assign(where, filters[0]);
    } else if (filters.length > 1) {
        where[Op.or] = filters;
    }

    const revisions = await SatelliteTleRevision.findAll({
        where,
        order: [["satelliteName", "ASC"], ["tleEpoch", "ASC"], ["ingestedAt", "ASC"]],
        attributes: ["noradId", "satelliteName", "line1", "line2", "tleEpoch", "ingestedAt", "isIndian"],
        raw: true
    });

    const grouped = new Map();
    for (const revision of revisions) {
        const propagationRecord = createPropagationRecord({
            name: revision.satelliteName,
            line1: revision.line1,
            line2: revision.line2,
            noradId: revision.noradId,
            isIndian: revision.isIndian
        });
        if (!propagationRecord) {
            continue;
        }

        const plain = {
            ...revision,
            ...propagationRecord
        };
        const key = plain.noradId ? `id:${plain.noradId}` : `name:${String(plain.satelliteName || "").toUpperCase()}`;
        if (!grouped.has(key)) {
            grouped.set(key, []);
        }
        grouped.get(key).push(plain);
    }

    const candidateKeys = Array.from(grouped.keys()).slice(0, maxSatellites);
    const satellites = [];
    for (const key of candidateKeys) {
        satellites.push(grouped.get(key));
    }

    return satellites.flat();
}

async function runRegionalPresenceAnalysis({ area, timeframeDays, baselineSplitDays, sampleMinutes, visibilityThresholdDeg, maxFindings, satelliteName, noradId, time, maxSatellites } = {}) {
    const history = await loadRegionalPresenceHistory({
        satelliteName,
        noradId,
        windowDays: timeframeDays,
        time,
        maxSatellites
    });

    return detectUnexpectedRegionalAccess({
        history,
        area,
        time,
        timeframeDays,
        baselineSplitDays,
        sampleMinutes,
        visibilityThresholdDeg,
        maxFindings,
        satelliteName,
        noradId
    });
}

async function getRegionalAccessDetails({ area, timeframeDays, baselineSplitDays, visibilityThresholdDeg, satelliteName, noradId, time } = {}) {
    const region = normalizeRegion(area);
    if (!region) {
        throw new Error("Invalid region provided for detailed analysis.");
    }

    const history = await loadRegionalPresenceHistory({
        satelliteName,
        noradId,
        windowDays: timeframeDays,
        time,
        maxSatellites: 1
    });

    if (!history.length) {
        throw new Error("No TLE history found for the specified satellite.");
    }

    const endDate = new Date(time);
    const windowDays = normalizeDays(timeframeDays);
    const windowStart = new Date(endDate.getTime() - windowDays * 24 * 60 * 60 * 1000);
    const splitDays = Number.isFinite(baselineSplitDays) && baselineSplitDays > 0
        ? Math.min(windowDays - 1, Math.max(1, Math.round(baselineSplitDays)))
        : Math.max(1, Math.floor(windowDays * DEFAULT_BASELINE_SPLIT));
    const splitDate = new Date(windowStart.getTime() + splitDays * 24 * 60 * 60 * 1000);

    const deps = {
        propagateState,
        resolveSensorProfile,
        isEffectivelyCovered,
        parseTleLine2OrbitalMetrics,
        createPropagationRecord
    };

    // Sort history to find representative TLEs
    history.sort((a, b) => new Date(a.tleEpoch || a.ingestedAt) - new Date(b.tleEpoch || b.ingestedAt));
    
    // Representative "Old" TLE from baseline period
    const baselineTles = history.filter(h => new Date(h.tleEpoch || h.ingestedAt) < splitDate);
    const recentTles = history.filter(h => new Date(h.tleEpoch || h.ingestedAt) >= splitDate);
    
    const oldRevision = baselineTles.length > 0 ? baselineTles[Math.floor(baselineTles.length / 2)] : history[0];
    const newRevision = recentTles.length > 0 ? recentTles[recentTles.length - 1] : history[history.length - 1];

    const sensorProfile = resolveSensorProfile(newRevision.satelliteName);

    // Run a high-res pass analysis for both periods
    const regionSamples = generateRegionSamples(region);
    
    // We reuse runVisibilityWindow but with a smaller step for the detail view
    const detailSampleMinutes = 5; 

    const samples = [];
    for (let i = 0; i < history.length; i++) {
        const current = history[i];
        const start = new Date(current.tleEpoch || current.ingestedAt);
        const next = history[i + 1];
        const naturalEnd = next ? new Date(next.tleEpoch || next.ingestedAt) : endDate;
        const stop = new Date(Math.min(naturalEnd.getTime(), endDate.getTime()));
        if (stop <= start) continue;
        samples.push({ revision: current, start, stop });
    }

    const baselineStats = runVisibilityWindow(samples, regionSamples, {
        windowStart,
        windowEnd: splitDate,
        sampleStepMinutes: detailSampleMinutes,
        visibilityThresholdDeg,
        deps,
        debugMetrics: { rejectionCounts: {}, profileUsageCounts: {} }
    });

    const recentStats = runVisibilityWindow(samples, regionSamples, {
        windowStart: splitDate,
        windowEnd: endDate,
        sampleStepMinutes: detailSampleMinutes,
        visibilityThresholdDeg,
        deps,
        debugMetrics: { rejectionCounts: {}, profileUsageCounts: {} }
    });

    // Generate high-res track samples for the most recent pass
    const latestPass = recentStats.windows.length > 0 ? recentStats.windows[recentStats.windows.length - 1] : null;
    const latestPassTrack = [];
    if (latestPass) {
        const passStart = new Date(latestPass.start);
        const passEnd = new Date(latestPass.end);
        const stepMs = 60 * 1000; // 1 min resolution for pass arc
        for (let t = passStart.getTime(); t <= passEnd.getTime(); t += stepMs) {
            const d = new Date(t);
            const rev = selectRevisionForSample(samples, d);
            if (rev) {
                const state = propagateState(rev, d);
                if (state) {
                    latestPassTrack.push({
                        time: d.toISOString(),
                        lat: state.lat,
                        lon: state.lon,
                        altKm: state.altKm,
                        x: state.x,
                        y: state.y,
                        z: state.z
                    });
                }
            }
        }
    }

    // Generate full orbit samples for Old vs New comparison
    const generateOrbitSamples = (revision, referenceDate) => {
        const orbitSamples = [];
        const periodMin = 100; // Approx 100 min for LEO
        const step = 2; // 2 min steps
        for (let m = -periodMin / 2; m <= periodMin / 2; m += step) {
            const d = new Date(referenceDate.getTime() + m * 60 * 1000);
            const state = propagateState(revision, d);
            if (state) {
                orbitSamples.push({
                    time: d.toISOString(),
                    lat: state.lat,
                    lon: state.lon,
                    altKm: state.altKm,
                    x: state.x,
                    y: state.y,
                    z: state.z
                });
            }
        }
        return orbitSamples;
    };

    const oldOrbit = {
        samples: generateOrbitSamples(oldRevision, splitDate),
        color: "#99b7c8",
        style: "dotted",
        name: "Historical Baseline Orbit"
    };

    const newOrbit = {
        samples: generateOrbitSamples(newRevision, endDate),
        color: "#ffcf5a",
        style: "solid",
        name: "Recent Operational Orbit"
    };

    return {
        satelliteName: newRevision.satelliteName,
        noradId: newRevision.noradId,
        region,
        sensorProfile,
        baselineWindow: { start: windowStart.toISOString(), end: splitDate.toISOString(), passCount: baselineStats.passCount, windows: baselineStats.windows },
        recentWindow: { start: splitDate.toISOString(), end: endDate.toISOString(), passCount: recentStats.passCount, windows: recentStats.windows },
        oldOrbit,
        newOrbit,
        latestPassTrack,
        firstDetectedAccess: recentStats.firstObservedAccess || baselineStats.firstObservedAccess
    };
}

module.exports = {
    compareVisibilityWindows,
    computePresenceChangeScore,
    detectUnexpectedRegionalAccess,
    loadRegionalPresenceHistory,
    runRegionalPresenceAnalysis,
    getRegionalAccessDetails
};
