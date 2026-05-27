import { appState } from "../../state.js";
import { setStatus } from "../../ui.js";
import { ListenerScope } from "../../ui/panelSystem.js";
import { escapeHtml } from "../../utils.js";
import { hasSelectedArea } from "../regionTrace.js";
import {
    attachRegionTracingControls,
    buildRegionTracingMarkup
} from "./regionPanelTemplate.js";
import { eventBus, events } from "../eventBus.js";
import "../../../shared/blindSpotCoverageUtils.js";

const {
    classifyCoverageLevel,
    computeCoverageStrength,
    computeOffNadirDeg,
    computeOperationalRadiusKm,
    isEffectivelyCovered,
    resolveSensorProfile
} = globalThis.blindSpotCoverageUtils;

const STRATEGIC_SITES = [
    { name: "Pokhran Test Range", lat: 27.095, lon: 71.753 },
    { name: "INS Vikramaditya (Naval)", lat: 18.960, lon: 72.820 },
    { name: "Siachen Glacier (LAC)", lat: 35.421, lon: 77.582 },
    { name: "Arunachal Pradesh (LAC)", lat: 28.213, lon: 92.700 },
    { name: "Pangong Tso (LAC)", lat: 33.787, lon: 78.950 },
    { name: "Indian Ocean (Central)", lat: -5.0, lon: 80.0 },

    // Space & Scientific Installations
    { name: "Sriharikota ISRO", lat: 13.720, lon: 80.230 },
    { name: "Bangalore Electronics City", lat: 12.949, lon: 77.648 },
    { name: "Hassan Deep Space", lat: 13.312, lon: 75.786 },

    // Strategic Ports & Naval Bases
    { name: "Visakhapatnam Naval Base", lat: 17.690, lon: 83.295 },
    { name: "Cochin Naval Base", lat: 9.936, lon: 76.263 },
    { name: "Mumbai Naval Base", lat: 18.958, lon: 72.821 },
    { name: "Port Blair (Andaman)", lat: 11.740, lon: 92.658 },

    // Delhi & Strategic Regions
    { name: "New Delhi", lat: 28.613, lon: 77.209 },
    { name: "Chandigarh", lat: 30.733, lon: 76.779 },

    // Adversary Interest
    { name: "Karachi", lat: 24.860, lon: 67.001 },
    { name: "Sri Lanka", lat: 7.873, lon: 80.771 }
];

const WORLD_BOUNDARIES_URL = "https://d2ad6b4ur7yvpq.cloudfront.net/naturalearth-3.3.0/ne_110m_admin_0_countries.geojson";
let worldData = null;
let currentBaseDate = new Date(); // Controls the date we are analyzing

const SATELLITE_GROUPS = [
    { id: "grp_chinese", label: "Adversary (Recon/LEO)", regex: /YAOGAN|GAOFEN|SHIJIAN|TIANHUI|ZHUHAI/i, selected: true },
    { id: "grp_indian", label: "Indian Assets", regex: /^(?:GSAT|INSAT|IRNSS|NVS|CARTOSAT|RISAT|RESOURCESAT|OCEANSAT|SCATSAT|EMISAT|HYSIS|EOS-|MICROSAT|SARAL|MEGHA|KALPANA|TECHSAT|YOUTHSAT|INSPIRE|IMS-)/i, selected: false },
    { id: "grp_us", label: "US Assets", regex: /USA-|NOAA|GOES|LANDSAT|TDRS/i, selected: false },
    { id: "grp_commercial", label: "Commercial", regex: /PLANET|MAXAR|BLACKSKY|WORLDVIEW|SKYSAT|FLOCK/i, selected: false },
    { id: "grp_military", label: "Other Military", regex: /COSMOS|DEFENSE|MILSTAR/i, selected: false }
];

function buildSidebar() {
    const sitesHtml = STRATEGIC_SITES.map((site, i) => `
        <button class="secondary site-btn" data-index="${i}" style="width:100%; margin-bottom: 4px; text-align: left;">
            ${escapeHtml(site.name)}
        </button>
    `).join("");

    const groupsHtml = SATELLITE_GROUPS.map((grp, i) => `
        <label style="display:flex; align-items:center; gap:8px; cursor:pointer; color:var(--text-main); font-weight:normal; text-transform:none; font-size:13px;">
            <input type="checkbox" class="sat-group-cb" data-index="${i}" ${grp.selected ? "checked" : ""}>
            ${escapeHtml(grp.label)}
        </label>
    `).join("");

    return `
        <div class="section">
            <div class="section-title">Strategic Region Search</div>
            <div style="display: flex; gap: 4px; margin-bottom: 8px;">
                <input type="text" id="bsSearchInput" placeholder="Search region or country..." style="flex: 1; padding: 6px 10px; background: rgba(0,0,0,0.3); border: 1px solid var(--panel-border); color: white; border-radius: 4px;">
                <button id="bsSearchBtn" class="primary" style="padding: 6px 12px;">Go</button>
            </div>
            <div id="bsSiteList" style="max-height: 150px; overflow-y: auto; margin-bottom: 12px;">
                ${sitesHtml}
            </div>
            <div class="section-title">Manual Region Selection</div>
            ${buildRegionTracingMarkup()}
        </div>

        <div class="section">
            <div class="section-title">Coverage Filters</div>
            <div class="micro-card" style="margin-bottom: 8px; font-size: 11px; color: var(--text-dim);">
                Indian assets include LEO, MEO, and GEO missions. Coverage now uses effective observation strength, not horizon visibility alone.
            </div>
            <div style="display:flex; flex-direction:column; gap:6px; margin-bottom:12px;">
                ${groupsHtml}
            </div>
            <button id="bsRecalculateBtn" class="primary" style="width:100%">Update Analysis</button>
        </div>

        <div class="section">
            <div class="section-title">Blind Spot Schedule (IST)</div>
            <div id="bsScheduleContainer" class="list" style="max-height: 250px; overflow-y: auto;">
                <div class="empty-state">Select a region to compute schedule.</div>
            </div>
            <div style="margin-top:8px;">
                <button id="bsExportCsvBtn" class="secondary" style="width:100%; font-size:11px;">Export CSV</button>
            </div>
        </div>
    `;
}

function formatIST(date) {
    const istOffset = 5.5 * 60 * 60 * 1000;
    const istDate = new Date(date.getTime() + istOffset);
    return istDate.toISOString().substr(11, 8);
}

function formatDateHeader(date) {
    const options = { weekday: 'short', month: 'short', day: 'numeric', timeZone: 'UTC' };
    return date.toLocaleDateString('en-US', options).toUpperCase();
}

function buildTimeline() {
    return `
        <div id="bsTimelineOverlay" style="position: absolute; bottom: 100px; left: 50%; transform: translateX(-50%); width: 650px; max-width: calc(100vw - 40px); background: rgba(6, 15, 28, 0.95); border: 1px solid var(--panel-border); border-radius: 14px; padding: 12px; z-index: 20; color: white; display: flex; flex-direction: column; gap: 8px; box-shadow: 0 18px 45px rgba(0, 0, 0, 0.45); backdrop-filter: blur(14px); transition: all 0.3s ease;">
            <div style="display: flex; justify-content: space-between; align-items: center; border-bottom: 1px solid rgba(255,255,255,0.1); padding-bottom: 8px; margin-bottom: 4px;">
                <div style="display: flex; align-items: center; gap: 12px;">
                    <div style="font-size: 10px; text-transform: uppercase; color: var(--accent); letter-spacing: 0.1em;">Coverage Timeline (IST)</div>
                    <div style="display: flex; background: rgba(255,255,255,0.05); border-radius: 4px; padding: 2px;">
                        <button id="bsPrevDayBtn" class="secondary" style="padding: 2px 8px; font-size: 10px; min-width: unset;">&lt;</button>
                        <span id="bsCurrentDateDisplay" style="padding: 2px 8px; font-size: 10px; font-weight: bold; border-left: 1px solid rgba(255,255,255,0.1); border-right: 1px solid rgba(255,255,255,0.1);">TODAY</span>
                        <button id="bsNextDayBtn" class="secondary" style="padding: 2px 8px; font-size: 10px; min-width: unset;">&gt;</button>
                    </div>
                </div>
                <button id="bsMinimizeBtn" style="background:none; border:none; color:var(--text-dim); cursor:pointer; font-size:16px; padding:0 4px;">\u2212</button>
            </div>
            <div id="bsTimelineContent" style="display: flex; flex-direction: column; gap: 8px;">
                <div style="display: flex; justify-content: space-between; align-items: center;">
                    <div style="display: flex; gap: 4px;">
                        <button id="bsPlayPauseBtn" class="primary" style="min-width: 50px; padding: 4px 8px; font-size: 12px;">Pause</button>
                        <button id="bsFastBtn" class="secondary" style="min-width: 50px; padding: 4px 8px; font-size: 12px;">Fast</button>
                        <button id="bsLiveBtn" class="secondary" style="min-width: 50px; padding: 4px 8px; font-size: 12px;">Live</button>
                    </div>
                    <div style="text-align: center;">
                        <span id="bsTimeDisplay" style="font-family: monospace; font-size: 1.2em; font-weight: bold;">00:00:00</span>
                        <span style="font-size: 10px; color: var(--text-dim); margin-left: 4px;">IST</span>
                    </div>
                    <div id="bsCoverageStatus" style="font-weight: bold; font-size: 0.85em; padding: 2px 8px; border-radius: 4px; background: rgba(255,255,255,0.05); border: 1px solid rgba(255,255,255,0.1); min-width: 140px; text-align: center;">SELECT REGION</div>
                </div>
                <input type="range" id="bsTimeScrubber" min="0" max="86400" value="0" style="width: 100%; cursor: pointer; height: 4px;">
            </div>
        </div>
    `;
}

function getFilteredSatrecs() {
    const selectedRegexes = SATELLITE_GROUPS.filter(g => g.selected).map(g => g.regex);
    const filtered = [];
    if (!appState.satellites) return filtered;

    for (const sat of appState.satellites) {
        let match = false;
        for (const regex of selectedRegexes) {
            if (regex.test(sat.name)) {
                match = true;
                break;
            }
        }
        if (match) {
            try {
                const satrec = window.satellite.twoline2satrec(sat.line1, sat.line2);
                if (!Number.isNaN(satrec?.satnum)) {
                    filtered.push({ name: sat.name, satrec });
                }
            } catch (e) {}
        }
    }
    return filtered;
}

function ensureCoverageDebugMetrics(metrics = null) {
    if (!metrics) {
        return null;
    }

    if (!metrics.profileUsageCounts) {
        metrics.profileUsageCounts = {};
    }
    if (!Number.isFinite(metrics.evaluations)) metrics.evaluations = 0;
    if (!Number.isFinite(metrics.visibleCount)) metrics.visibleCount = 0;
    if (!Number.isFinite(metrics.effectiveCoverageCount)) metrics.effectiveCoverageCount = 0;
    if (!Number.isFinite(metrics.rejectedByRange)) metrics.rejectedByRange = 0;
    if (!Number.isFinite(metrics.rejectedByOffNadir)) metrics.rejectedByOffNadir = 0;
    if (!Number.isFinite(metrics.rejectedByElevation)) metrics.rejectedByElevation = 0;
    if (!Number.isFinite(metrics.rejectedByThreshold)) metrics.rejectedByThreshold = 0;
    if (!Number.isFinite(metrics.coverageStrengthSum)) metrics.coverageStrengthSum = 0;
    if (!Number.isFinite(metrics.coverageStrengthMin)) metrics.coverageStrengthMin = Number.POSITIVE_INFINITY;
    if (!Number.isFinite(metrics.coverageStrengthMax)) metrics.coverageStrengthMax = 0;
    return metrics;
}

function evaluateCoverageAtPoint(lat, lon, date, satrecs, elevationThresholdDeg = 10, debugMetrics = null) {
    if (!satrecs || satrecs.length === 0) {
        return {
            hasSatellites: false,
            coverageStatus: "blind",
            coverageStrength: 0,
            isEffectivelyCovered: false,
            bestSatelliteName: null
        };
    }

    const observer = {
        latitude: Cesium.Math.toRadians(lat),
        longitude: Cesium.Math.toRadians(lon),
        height: 0
    };

    const gmst = window.satellite.gstime(date);
    const metrics = ensureCoverageDebugMetrics(debugMetrics);
    let bestAssessment = null;
    let bestEffectiveAssessment = null;
    for(const sat of satrecs) {
        const pva = window.satellite.propagate(sat.satrec, date);
        if(!pva.position) continue;

        const positionEcf = window.satellite.eciToEcf(pva.position, gmst);
        const geodetic = window.satellite.eciToGeodetic(pva.position, gmst);
        const altKm = geodetic.height;
        const lookAngles = window.satellite.ecfToLookAngles(observer, positionEcf);
        const elevationDeg = Cesium.Math.toDegrees(lookAngles.elevation);
        const rangeKm = lookAngles.rangeSat;
        const profile = resolveSensorProfile(sat);
        const assessment = isEffectivelyCovered({
            elevationDeg,
            rangeKm,
            altKm,
            profile,
            date,
            name: sat.name,
            minElevationDeg: Math.max(profile.minElevationDeg, elevationThresholdDeg)
        });

        if (metrics) {
            metrics.evaluations += 1;
            metrics.profileUsageCounts[profile.key] = (metrics.profileUsageCounts[profile.key] || 0) + 1;
            metrics.coverageStrengthSum += assessment.coverageStrength || 0;
            metrics.coverageStrengthMin = Math.min(metrics.coverageStrengthMin, assessment.coverageStrength || 0);
            metrics.coverageStrengthMax = Math.max(metrics.coverageStrengthMax, assessment.coverageStrength || 0);
            if (assessment.isGeometricallyVisible) {
                metrics.visibleCount += 1;
            }
            if (assessment.isEffectivelyCovered) {
                metrics.effectiveCoverageCount += 1;
            }
            if (assessment.rejectedByRange) {
                metrics.rejectedByRange += 1;
            }
            if (assessment.rejectedByOffNadir) {
                metrics.rejectedByOffNadir += 1;
            }
            if (assessment.rejectedByElevation) {
                metrics.rejectedByElevation += 1;
            }
            if (assessment.rejectedByThreshold) {
                metrics.rejectedByThreshold += 1;
            }
        }

        const candidate = {
            bestSatelliteName: sat.name,
            profile,
            profileKey: profile.key,
            isrCapable: profile.isrCapable !== false,
            elevationDeg,
            offNadirDeg: computeOffNadirDeg(elevationDeg, altKm),
            rangeKm,
            coverageStrength: assessment.coverageStrength,
            isGeometricallyVisible: assessment.isGeometricallyVisible,
            isInsideSensorFootprint: assessment.isInsideSensorFootprint,
            isRangeAcceptable: assessment.isRangeAcceptable,
            isOffNadirAcceptable: assessment.isOffNadirAcceptable,
            isEffectivelyCovered: assessment.isEffectivelyCovered,
            coverageThreshold: assessment.coverageThreshold,
            strongCoverageThreshold: assessment.strongCoverageThreshold,
            coverageStatus: classifyCoverageLevel(assessment.coverageStrength, profile)
        };

        if (!bestAssessment || candidate.coverageStrength > bestAssessment.coverageStrength) {
            bestAssessment = candidate;
        }

        if (candidate.isEffectivelyCovered) {
            if (!bestEffectiveAssessment || candidate.coverageStrength > bestEffectiveAssessment.coverageStrength) {
                bestEffectiveAssessment = candidate;
            }
        }
    }

    const selectedAssessment = bestEffectiveAssessment || bestAssessment;

    if (!selectedAssessment) {
        return {
            hasSatellites: true,
            coverageStatus: "blind",
            coverageStrength: 0,
            isEffectivelyCovered: false,
            bestSatelliteName: null
        };
    }

    return {
        hasSatellites: true,
        ...selectedAssessment
    };
}

function getCoverageColor(assessment) {
    if (!assessment?.hasSatellites) {
        return Cesium.Color.DARKGRAY;
    }
    if (assessment.coverageStatus === "strong") {
        return Cesium.Color.GREEN;
    }
    if (assessment.coverageStatus === "degraded") {
        return Cesium.Color.YELLOW;
    }
    return Cesium.Color.RED;
}

const siteEntities = new Map();
let tracedAreaEntity = null;
const gridEntities = [];

function clearGridVisuals(viewer) {
    gridEntities.forEach(e => viewer.entities.remove(e));
    gridEntities.length = 0;
}

const activeSightAxisEntities = [];
const activeContributorPolylines = [];
const temporarySwathEntities = [];
const debugLookVectors = [];
let activeVisMode = "tactical"; // "tactical", "geometry", "debug"

let lastStrongestObserverId = null;
let lastStrongestObserverTime = null;
const OBSERVER_HOLD_MS = 5000;

function clearAllOperationalVisuals(viewer) {
    activeSightAxisEntities.forEach(e => viewer.entities.remove(e));
    activeSightAxisEntities.length = 0;
    activeContributorPolylines.forEach(e => viewer.entities.remove(e));
    activeContributorPolylines.length = 0;
    temporarySwathEntities.forEach(e => viewer.entities.remove(e));
    temporarySwathEntities.length = 0;
    debugLookVectors.forEach(e => viewer.entities.remove(e));
    debugLookVectors.length = 0;
}

function clearDynamicVisuals(viewer) {
    clearAllOperationalVisuals(viewer);
}

function haversineKm(lat1, lon1, lat2, lon2) {
    const R = 6371;
    const dLat = (lat2 - lat1) * Math.PI / 180;
    const dLon = (lon2 - lon1) * Math.PI / 180;
    const a = Math.sin(dLat/2) * Math.sin(dLat/2) +
              Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *
              Math.sin(dLon/2) * Math.sin(dLon/2);
    return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

function getRegionIntersectionFactor(lookLat, lookLon, radiusKm, focusedSite) {
    if (focusedSite) {
        const d = haversineKm(lookLat, lookLon, focusedSite.lat, focusedSite.lon);
        if (d <= radiusKm) return 1.0;
        return Math.max(0.0, Math.min(1.0, 1.0 - (d - radiusKm) / (radiusKm * 1.5)));
    }

    if (appState.selectedArea && Array.isArray(appState.selectedArea.points)) {
        const isInside = pointInPolygon({ lat: lookLat, lon: lookLon }, appState.selectedArea.points);
        if (isInside) return 1.0;

        let minD = Number.MAX_VALUE;
        appState.selectedArea.points.forEach(p => {
            const dist = haversineKm(lookLat, lookLon, p.lat, p.lon);
            if (dist < minD) minD = dist;
        });

        if (minD <= radiusKm) {
            return 0.7; // Partially overlapping the region boundary
        }

        const decay = Math.exp(-0.02 * (minD - radiusKm));
        return Math.max(0.01, Math.min(0.2, decay * 0.2));
    }

    return 1.0;
}

// Temporal decay tracking maps
const siteObservationState = new Map(); // siteIndex -> { lastObservedTime, strongestObserver, baseStrength }
const gridObservationState = new Map(); // gridPointIndex -> { lastObservedTime, strongestObserver, baseStrength }

const getSwathRadiusKm = globalThis.blindSpotCoverageUtils.getSwathRadiusKm;

function updateSiteVisuals(clock, satrecs, viewer, focusedSite, sensorConeAngleDeg, hasBlindSpots = false) {
    clearDynamicVisuals(viewer);

    STRATEGIC_SITES.forEach((site, i) => {
        let entity = siteEntities.get(i);
        const isFocused = focusedSite && focusedSite.name === site.name;

        if (!isFocused) {
            if (entity) entity.show = false;
            return;
        }

        // Compute all active and rejected candidates visible to the strategic site
        const activeCandidates = [];
        if (satrecs && satrecs.length > 0) {
            const observer = {
                latitude: Cesium.Math.toRadians(site.lat),
                longitude: Cesium.Math.toRadians(site.lon),
                height: 0
            };
            const gmst = window.satellite.gstime(clock);

            satrecs.forEach(sat => {
                const pva = window.satellite.propagate(sat.satrec, clock);
                if (!pva.position) return;

                const positionEcf = window.satellite.eciToEcf(pva.position, gmst);
                const lookAngles = window.satellite.ecfToLookAngles(observer, positionEcf);
                const elevationDeg = Cesium.Math.toDegrees(lookAngles.elevation);
                const rangeKm = lookAngles.rangeSat;
                const geodetic = window.satellite.eciToGeodetic(pva.position, gmst);
                const altKm = geodetic.height;
                const profile = resolveSensorProfile(sat);

                const assessment = isEffectivelyCovered({
                    elevationDeg,
                    rangeKm,
                    altKm,
                    profile,
                    minElevationDeg: Math.max(profile.minElevationDeg, sensorConeAngleDeg)
                });

                if (assessment.isEffectivelyCovered) {
                    activeCandidates.push({
                        sat,
                        assessment,
                        altKm,
                        profile,
                        positionEcf,
                        geodetic
                    });
                } else if (activeVisMode === "debug") {
                    // Draw thin red rejected look rays with diagnostics in Debug View
                    const satPosCartesian = new Cesium.Cartesian3(positionEcf.x * 1000, positionEcf.y * 1000, positionEcf.z * 1000);
                    const sitePosCartesian = Cesium.Cartesian3.fromDegrees(site.lon, site.lat, 0);

                    let reason = "BLIND";
                    if (assessment.rejectedByElevation) {
                        reason = `ELEV (${elevationDeg.toFixed(1)}°)`;
                    } else if (assessment.rejectedByOffNadir) {
                        const offNadir = computeOffNadirDeg(elevationDeg, altKm);
                        reason = `OFF-NADIR (${offNadir.toFixed(1)}°)`;
                    } else if (assessment.rejectedByRange) {
                        reason = `RANGE (${rangeKm.toFixed(0)}km)`;
                    } else if (assessment.rejectedByThreshold) {
                        reason = `THRESH (${assessment.coverageStrength.toFixed(2)})`;
                    }

                    const debugLine = viewer.entities.add({
                        name: `${sat.name} [REJECTED: ${reason}]`,
                        polyline: {
                            positions: [satPosCartesian, sitePosCartesian],
                            width: 1.0,
                            material: Cesium.Color.RED.withAlpha(0.25),
                            arcType: Cesium.ArcType.NONE
                        },
                        label: {
                            text: `${sat.name}\n[REJ: ${reason}]`,
                            font: '9px monospace',
                            fillColor: Cesium.Color.RED,
                            outlineColor: Cesium.Color.BLACK,
                            outlineWidth: 1.5,
                            style: Cesium.LabelStyle.FILL_AND_OUTLINE,
                            verticalOrigin: Cesium.VerticalOrigin.BOTTOM,
                            pixelOffset: new Cesium.Cartesian2(0, -8)
                        }
                    });
                    debugLookVectors.push(debugLine);
                }
            });
        }

        // 1. Sort active candidates by coverage strength descending
        activeCandidates.sort((a, b) => b.assessment.coverageStrength - a.assessment.coverageStrength);

        // 2. Select only the top contributors (Limit to 3)
        let topContributors = activeCandidates.slice(0, 3);
        const hasCurrentActive = topContributors.length > 0;

        // Transition Hold Hysteresis logic to prevent hand-over jitter/flickering
        if (hasCurrentActive) {
            const nowTime = Date.now();
            if (lastStrongestObserverId) {
                const prevActiveIdx = activeCandidates.findIndex(c => c.sat.name === lastStrongestObserverId);
                if (prevActiveIdx !== -1 && prevActiveIdx !== 0) {
                    if (lastStrongestObserverTime && (nowTime - lastStrongestObserverTime < OBSERVER_HOLD_MS)) {
                        // Hold the previous strongest observer as Rank 1
                        const prevObserver = activeCandidates[prevActiveIdx];
                        topContributors = topContributors.filter(c => c.sat.name !== lastStrongestObserverId);
                        topContributors.unshift(prevObserver);
                    }
                }
            }

            const selectedRank1 = topContributors[0];
            if (lastStrongestObserverId !== selectedRank1.sat.name) {
                lastStrongestObserverId = selectedRank1.sat.name;
                lastStrongestObserverTime = nowTime;
            }
        } else {
            lastStrongestObserverId = null;
            lastStrongestObserverTime = null;
        }

        // 3. Temporal Decay state logic
        let state = siteObservationState.get(i);
        if (!state) {
            state = { lastObservedTime: null, strongestObserver: null, baseStrength: 0 };
            siteObservationState.set(i, state);
        }

        if (hasCurrentActive) {
            state.lastObservedTime = clock.getTime();
            state.strongestObserver = topContributors[0].sat.name;
            state.baseStrength = topContributors[0].assessment.coverageStrength;
        }

        // Determine decayed coverage level and color
        let currentStrength = 0;
        let coverageStatus = "blind";
        let ageMinutes = 0;

        if (state.lastObservedTime !== null) {
            ageMinutes = (clock.getTime() - state.lastObservedTime) / 60000;
            if (ageMinutes <= 30) {
                currentStrength = state.baseStrength * Math.exp(-0.05 * ageMinutes);

                if (ageMinutes <= 10) {
                    coverageStatus = "strong";
                } else {
                    coverageStatus = "degraded";
                }
            } else {
                coverageStatus = "blind";
                currentStrength = 0;
            }
        }

        // Enforce RED color if blind spot gaps exist in the 24h schedule
        let color = hasBlindSpots
            ? Cesium.Color.RED
            : (coverageStatus === "strong" ? Cesium.Color.GREEN :
               coverageStatus === "degraded" ? Cesium.Color.YELLOW :
               Cesium.Color.RED);

        // 4. Render direct Sight Axis laser lock for the strongest contributor (Rank 1)
        if (hasCurrentActive) {
            const topSat = topContributors[0];
            const profile = topSat.profile;
            const altKm = topSat.altKm;
            const positionEcf = topSat.positionEcf;
            const geodetic = topSat.geodetic;

            const satPosCartesian = new Cesium.Cartesian3(positionEcf.x * 1000, positionEcf.y * 1000, positionEcf.z * 1000);
            const satLat = Cesium.Math.toDegrees(geodetic.latitude);
            const satLon = Cesium.Math.toDegrees(geodetic.longitude);

            const swathColor = profile.key === "opticalRecon" ? Cesium.Color.CYAN :
                               profile.key === "sarRecon" ? Cesium.Color.MAGENTA :
                               Cesium.Color.GREEN;

            // Direct Sight Axis laser is rendered in ALL modes (Tactical, Geometry, Debug)
            const sitePosCartesian = Cesium.Cartesian3.fromDegrees(site.lon, site.lat, 0);

            // Hide Sight Axis laser line for Other Military satellites as requested by user
            const isOtherMilitary = /COSMOS|DEFENSE|MILSTAR/i.test(topSat.sat.name);
            if (!isOtherMilitary) {
                const axisEntity = viewer.entities.add({
                    name: `${topSat.sat.name} Sight Axis to Site`,
                    polyline: {
                        positions: [satPosCartesian, sitePosCartesian],
                        width: 3.0,
                        material: new Cesium.PolylineGlowMaterialProperty({
                            glowPower: 0.25,
                            color: swathColor.withAlpha(0.7)
                        }),
                        arcType: Cesium.ArcType.NONE
                    }
                });
                activeSightAxisEntities.push(axisEntity);
            }

            // 5. Render look frustum rays ONLY in Geometry or Debug View
            if (activeVisMode === "geometry" || activeVisMode === "debug") {
                let lookLat = satLat;
                let lookLon = satLon;
                if (profile.key === "sarRecon") {
                    const sideLookOffsetKm = altKm * Math.tan(Cesium.Math.toRadians(25));
                    const sideLookDeltaLon = (sideLookOffsetKm / (111.32 * Math.cos(Cesium.Math.toRadians(satLat))));
                    lookLon = satLon + sideLookDeltaLon;
                    lookLat = satLat + 0.05;
                }
                const radiusKm = getSwathRadiusKm(altKm, profile.maxOffNadirDeg || 30) * (profile.footprintFactor || 1);

                const dLat = (radiusKm / 111.32);
                const dLon = (radiusKm / (111.32 * Math.cos(Cesium.Math.toRadians(lookLat))));
                const perimeterPoints = [
                    Cesium.Cartesian3.fromDegrees(lookLon, lookLat + dLat, 0),
                    Cesium.Cartesian3.fromDegrees(lookLon, lookLat - dLat, 0),
                    Cesium.Cartesian3.fromDegrees(lookLon + dLon, lookLat, 0),
                    Cesium.Cartesian3.fromDegrees(lookLon - dLon, lookLat, 0)
                ];

                perimeterPoints.forEach((pt, idx) => {
                    const rayEntity = viewer.entities.add({
                        name: `${topSat.sat.name} Look Ray ${idx + 1}`,
                        polyline: {
                            positions: [satPosCartesian, pt],
                            width: 1.2,
                            material: swathColor.withAlpha(0.2),
                            arcType: Cesium.ArcType.NONE
                        }
                    });
                    activeContributorPolylines.push(rayEntity);
                });
            }
        }

        // 6. Render ground footprints ONLY in Geometry or Debug View, with active-vs-potential opacities and region fading
        if (activeVisMode === "geometry" || activeVisMode === "debug") {
            topContributors.forEach(c => {
                const profile = c.profile;
                const altKm = c.altKm;
                const geodetic = c.geodetic;
                const satLat = Cesium.Math.toDegrees(geodetic.latitude);
                const satLon = Cesium.Math.toDegrees(geodetic.longitude);

                let lookLat = satLat;
                let lookLon = satLon;
                if (profile.key === "sarRecon") {
                    const sideLookOffsetKm = altKm * Math.tan(Cesium.Math.toRadians(25));
                    const sideLookDeltaLon = (sideLookOffsetKm / (111.32 * Math.cos(Cesium.Math.toRadians(satLat))));
                    lookLon = satLon + sideLookDeltaLon;
                    lookLat = satLat + 0.05;
                }
                const lookPos = Cesium.Cartesian3.fromDegrees(lookLon, lookLat, 0);

                const radiusKm = getSwathRadiusKm(altKm, profile.maxOffNadirDeg || 30) * (profile.footprintFactor || 1);
                const swathColor = profile.key === "opticalRecon" ? Cesium.Color.CYAN :
                                   profile.key === "sarRecon" ? Cesium.Color.MAGENTA :
                                   Cesium.Color.GREEN;

                // Active (Rank 1) vs. Potential (Rank 2-3) opacities
                const isRank1 = hasCurrentActive && (c.sat.name === topContributors[0].sat.name);
                const baseFill = isRank1 ? 0.25 : 0.05;
                const baseOutline = isRank1 ? 0.6 : 0.15;

                // Apply region fading factor for constrained swath rendering
                const intersectionFactor = getRegionIntersectionFactor(lookLat, lookLon, radiusKm, site);
                const finalFill = baseFill * intersectionFactor;
                const finalOutline = baseOutline * intersectionFactor;

                // Do not render swaths that are completely faded out outside region limits
                if (finalOutline > 0.01) {
                    const footprintEntity = viewer.entities.add({
                        name: `${c.sat.name} Swath [${isRank1 ? "ACTIVE" : "POTENTIAL"}]`,
                        position: lookPos,
                        ellipse: {
                            semiMinorAxis: radiusKm * 1000,
                            semiMajorAxis: radiusKm * 1000 * (profile.key === "sarRecon" ? 1.4 : 1.0),
                            material: swathColor.withAlpha(finalFill),
                            outline: true,
                            outlineColor: swathColor.withAlpha(finalOutline),
                            outlineWidth: isRank1 ? 2.0 : 1.0,
                            height: 0
                        }
                    });
                    temporarySwathEntities.push(footprintEntity);
                }
            });
        }

        // 7. Render site as a clean, high-value strategic tactical node beacon circle
        const beaconRadiusMeters = 40000;

        let labelText = site.name.toUpperCase();
        if (hasBlindSpots) {
            labelText += `\n[SENSOR BLIND SPOT]`;
        } else if (coverageStatus === "strong") {
            labelText += `\n[PASS OBS: ${state.strongestObserver}]`;
        } else if (coverageStatus === "degraded") {
            labelText += `\n[DEGRADED DATA | AGE: ${Math.round(ageMinutes)}m]`;
        } else {
            labelText += `\n[SENSOR BLIND SPOT]`;
        }

        if (!entity) {
            entity = viewer.entities.add({
                position: Cesium.Cartesian3.fromDegrees(site.lon, site.lat),
                ellipse: {
                    semiMinorAxis: beaconRadiusMeters,
                    semiMajorAxis: beaconRadiusMeters,
                    material: color.withAlpha(0.18),
                    outline: true,
                    outlineColor: color,
                    outlineWidth: 2.5
                },
                label: {
                    text: labelText,
                    font: 'bold 10px monospace',
                    fillColor: Cesium.Color.WHITE,
                    outlineColor: Cesium.Color.BLACK,
                    outlineWidth: 2.5,
                    style: Cesium.LabelStyle.FILL_AND_OUTLINE,
                    verticalOrigin: Cesium.VerticalOrigin.BOTTOM,
                    pixelOffset: new Cesium.Cartesian2(0, -18)
                }
            });
            siteEntities.set(i, entity);
        } else {
            entity.show = true;
            entity.ellipse.semiMinorAxis = beaconRadiusMeters;
            entity.ellipse.semiMajorAxis = beaconRadiusMeters;
            entity.ellipse.material = color.withAlpha(0.18);
            entity.ellipse.outlineColor = color;
            entity.label.text = labelText;
        }
    });
}

function updateTracedAreaVisual(clock, satrecs, viewer, focusedSite, sensorConeAngleDeg, hasBlindSpots = false) {
    if (!hasSelectedArea() || focusedSite) {
        if (tracedAreaEntity) tracedAreaEntity.show = false;
        clearGridVisuals(viewer);
        return;
    }

    if (!appState.selectedArea.grid && appState.selectedArea.bounds) {
        appState.selectedArea.grid = buildRegionGrid(appState.selectedArea, 100);
    } else if (Array.isArray(appState.selectedArea.grid) && Array.isArray(appState.selectedArea.points) && appState.selectedArea.points.length >= 3) {
        appState.selectedArea.grid = appState.selectedArea.grid.filter((pt) => pointInPolygon(pt, appState.selectedArea.points));
    }

    const site = {
        name: appState.selectedArea.name || "Traced Region",
        lat: appState.selectedArea.centroid.lat,
        lon: appState.selectedArea.centroid.lon
    };

    const positions = appState.selectedArea.points.map(p => Cesium.Cartesian3.fromDegrees(p.lon, p.lat));

    clearDynamicVisuals(viewer);

    // Compute active and rejected candidates relative to the centroid
    const activeCandidates = [];
    if (satrecs && satrecs.length > 0) {
        const observer = {
            latitude: Cesium.Math.toRadians(site.lat),
            longitude: Cesium.Math.toRadians(site.lon),
            height: 0
        };
        const gmst = window.satellite.gstime(clock);

        satrecs.forEach(sat => {
            const pva = window.satellite.propagate(sat.satrec, clock);
            if (!pva.position) return;

            const positionEcf = window.satellite.eciToEcf(pva.position, gmst);
            const lookAngles = window.satellite.ecfToLookAngles(observer, positionEcf);
            const elevationDeg = Cesium.Math.toDegrees(lookAngles.elevation);
            const rangeKm = lookAngles.rangeSat;
            const geodetic = window.satellite.eciToGeodetic(pva.position, gmst);
            const altKm = geodetic.height;
            const profile = resolveSensorProfile(sat);

            const assessment = isEffectivelyCovered({
                elevationDeg,
                rangeKm,
                altKm,
                profile,
                date: clock,
                name: sat.name,
                minElevationDeg: Math.max(profile.minElevationDeg, sensorConeAngleDeg)
            });

            if (assessment.isEffectivelyCovered) {
                activeCandidates.push({
                    sat,
                    assessment,
                    altKm,
                    profile,
                    positionEcf,
                    geodetic
                });
            } else if (activeVisMode === "debug") {
                // Draw thin red rejected look rays with diagnostics in Debug View to region centroid
                const satPosCartesian = new Cesium.Cartesian3(positionEcf.x * 1000, positionEcf.y * 1000, positionEcf.z * 1000);
                const centroidPosCartesian = Cesium.Cartesian3.fromDegrees(site.lon, site.lat, 0);

                let reason = "BLIND";
                if (assessment.rejectedByElevation) {
                    reason = `ELEV (${elevationDeg.toFixed(1)}°)`;
                } else if (assessment.rejectedByOffNadir) {
                    const offNadir = computeOffNadirDeg(elevationDeg, altKm);
                    reason = `OFF-NADIR (${offNadir.toFixed(1)}°)`;
                } else if (assessment.rejectedByRange) {
                    reason = `RANGE (${rangeKm.toFixed(0)}km)`;
                } else if (assessment.rejectedByThreshold) {
                    reason = `THRESH (${assessment.coverageStrength.toFixed(2)})`;
                }

                const debugLine = viewer.entities.add({
                    name: `${sat.name} [REJECTED: ${reason}]`,
                    polyline: {
                        positions: [satPosCartesian, centroidPosCartesian],
                        width: 1.0,
                        material: Cesium.Color.RED.withAlpha(0.25),
                        arcType: Cesium.ArcType.NONE
                    },
                    label: {
                        text: `${sat.name}\n[REJ: ${reason}]`,
                        font: '9px monospace',
                        fillColor: Cesium.Color.RED,
                        outlineColor: Cesium.Color.BLACK,
                        outlineWidth: 1.5,
                        style: Cesium.LabelStyle.FILL_AND_OUTLINE,
                        verticalOrigin: Cesium.VerticalOrigin.BOTTOM,
                        pixelOffset: new Cesium.Cartesian2(0, -8)
                    }
                });
                debugLookVectors.push(debugLine);
            }
        });
    }

    // Sort active candidates by strength descending
    activeCandidates.sort((a, b) => b.assessment.coverageStrength - a.assessment.coverageStrength);
    let topContributors = activeCandidates.slice(0, 3);
    const hasCurrentActive = topContributors.length > 0;

    // Transition Hold Hysteresis logic to prevent hand-over jitter/flickering
    if (hasCurrentActive) {
        const nowTime = Date.now();
        if (lastStrongestObserverId) {
            const prevActiveIdx = activeCandidates.findIndex(c => c.sat.name === lastStrongestObserverId);
            if (prevActiveIdx !== -1 && prevActiveIdx !== 0) {
                if (lastStrongestObserverTime && (nowTime - lastStrongestObserverTime < OBSERVER_HOLD_MS)) {
                    // Hold the previous strongest observer as Rank 1
                    const prevObserver = activeCandidates[prevActiveIdx];
                    topContributors = topContributors.filter(c => c.sat.name !== lastStrongestObserverId);
                    topContributors.unshift(prevObserver);
                }
            }
        }

        const selectedRank1 = topContributors[0];
        if (lastStrongestObserverId !== selectedRank1.sat.name) {
            lastStrongestObserverId = selectedRank1.sat.name;
            lastStrongestObserverTime = nowTime;
        }
    } else {
        lastStrongestObserverId = null;
        lastStrongestObserverTime = null;
    }

    // 4. Render direct Sight Axis laser lock from the Rank 1 contributor to region centroid
    if (hasCurrentActive) {
        const p = topContributors[0];
        const profile = p.profile;
        const altKm = p.altKm;
        const positionEcf = p.positionEcf;
        const geodetic = p.geodetic;

        const satPosCartesian = new Cesium.Cartesian3(positionEcf.x * 1000, positionEcf.y * 1000, positionEcf.z * 1000);
        const satLat = Cesium.Math.toDegrees(geodetic.latitude);
        const satLon = Cesium.Math.toDegrees(geodetic.longitude);

        const swathColor = profile.key === "opticalRecon" ? Cesium.Color.CYAN :
                           profile.key === "sarRecon" ? Cesium.Color.MAGENTA :
                           Cesium.Color.GREEN;

        // Render glowing laser sight axis in ALL modes
        const centroidPos = Cesium.Cartesian3.fromDegrees(site.lon, site.lat, 0);

        // Hide Sight Axis laser line for Other Military satellites as requested by user
        const isOtherMilitary = /COSMOS|DEFENSE|MILSTAR/i.test(p.sat.name);
        if (!isOtherMilitary) {
            const axisEntity = viewer.entities.add({
                name: `${p.sat.name} Sight Axis to Centroid`,
                polyline: {
                    positions: [satPosCartesian, centroidPos],
                    width: 3.0,
                    material: new Cesium.PolylineGlowMaterialProperty({
                        glowPower: 0.25,
                        color: swathColor.withAlpha(0.7)
                    }),
                    arcType: Cesium.ArcType.NONE
                }
            });
            activeSightAxisEntities.push(axisEntity);
        }

        // Render wireframe frustum rays ONLY in Geometry or Debug View for the active contributor
        if (activeVisMode === "geometry" || activeVisMode === "debug") {
            let lookLat = satLat;
            let lookLon = satLon;
            if (profile.key === "sarRecon") {
                const sideLookOffsetKm = altKm * Math.tan(Cesium.Math.toRadians(25));
                const sideLookDeltaLon = (sideLookOffsetKm / (111.32 * Math.cos(Cesium.Math.toRadians(satLat))));
                lookLon = satLon + sideLookDeltaLon;
                lookLat = satLat + 0.05;
            }
            const radiusKm = getSwathRadiusKm(altKm, profile.maxOffNadirDeg || 30) * (profile.footprintFactor || 1);

            const dLat = (radiusKm / 111.32);
            const dLon = (radiusKm / (111.32 * Math.cos(Cesium.Math.toRadians(lookLat))));
            const perimeterPoints = [
                Cesium.Cartesian3.fromDegrees(lookLon, lookLat + dLat, 0),
                Cesium.Cartesian3.fromDegrees(lookLon, lookLat - dLat, 0),
                Cesium.Cartesian3.fromDegrees(lookLon + dLon, lookLat, 0),
                Cesium.Cartesian3.fromDegrees(lookLon - dLon, lookLat, 0)
            ];

            perimeterPoints.forEach((pt, idx) => {
                const rayEntity = viewer.entities.add({
                    name: `${p.sat.name} Look Ray ${idx + 1}`,
                    polyline: {
                        positions: [satPosCartesian, pt],
                        width: 1.2,
                        material: swathColor.withAlpha(0.2),
                        arcType: Cesium.ArcType.NONE
                    }
                });
                activeContributorPolylines.push(rayEntity);
            });
        }
    }

    // 5. Render ground footprints ONLY in Geometry or Debug View, with active-vs-potential opacities and region fading
    if (activeVisMode === "geometry" || activeVisMode === "debug") {
        topContributors.forEach(c => {
            const profile = c.profile;
            const altKm = c.altKm;
            const geodetic = c.geodetic;
            const satLat = Cesium.Math.toDegrees(geodetic.latitude);
            const satLon = Cesium.Math.toDegrees(geodetic.longitude);

            let lookLat = satLat;
            let lookLon = satLon;
            if (profile.key === "sarRecon") {
                const sideLookOffsetKm = altKm * Math.tan(Cesium.Math.toRadians(25));
                const sideLookDeltaLon = (sideLookOffsetKm / (111.32 * Math.cos(Cesium.Math.toRadians(satLat))));
                lookLon = satLon + sideLookDeltaLon;
                lookLat = satLat + 0.05;
            }
            const lookPos = Cesium.Cartesian3.fromDegrees(lookLon, lookLat, 0);

            const radiusKm = getSwathRadiusKm(altKm, profile.maxOffNadirDeg || 30) * (profile.footprintFactor || 1);
            const swathColor = profile.key === "opticalRecon" ? Cesium.Color.CYAN :
                               profile.key === "sarRecon" ? Cesium.Color.MAGENTA :
                               Cesium.Color.GREEN;

            // Active (Rank 1) vs. Potential (Rank 2-3) opacities
            const isRank1 = hasCurrentActive && (c.sat.name === topContributors[0].sat.name);
            const baseFill = isRank1 ? 0.25 : 0.05;
            const baseOutline = isRank1 ? 0.6 : 0.15;

            // Apply region-constrained swath rendering factor relative to the manual region / country polygon
            const intersectionFactor = getRegionIntersectionFactor(lookLat, lookLon, radiusKm, null);
            const finalFill = baseFill * intersectionFactor;
            const finalOutline = baseOutline * intersectionFactor;

            if (finalOutline > 0.01) {
                const footprintEntity = viewer.entities.add({
                    name: `${c.sat.name} Swath [${isRank1 ? "ACTIVE" : "POTENTIAL"}]`,
                    position: lookPos,
                    ellipse: {
                        semiMinorAxis: radiusKm * 1000,
                        semiMajorAxis: radiusKm * 1000 * (profile.key === "sarRecon" ? 1.4 : 1.0),
                        material: swathColor.withAlpha(finalFill),
                        outline: true,
                        outlineColor: swathColor.withAlpha(finalOutline),
                        outlineWidth: isRank1 ? 2.0 : 1.0,
                        height: 0
                    }
                });
                temporarySwathEntities.push(footprintEntity);
            }
        });
    }

    // Calculate region-wide aggregate coverage status
    let totalStrength = 0;
    let strongCount = 0;
    let coveredCount = 0;
    if (appState.selectedArea.grid) {
        appState.selectedArea.grid.forEach(pt => {
            const res = evaluateCoverageAtPoint(pt.lat, pt.lon, clock, satrecs, sensorConeAngleDeg);
            totalStrength += res.coverageStrength || 0;
            if (res.coverageStatus === "strong") strongCount++;
            if (res.isEffectivelyCovered) coveredCount++;
        });
    }
    const totalCount = Math.max(1, appState.selectedArea.grid ? appState.selectedArea.grid.length : 1);
    const coverageRatio = coveredCount / totalCount;
    const strongRatio = strongCount / totalCount;
    const meanStrength = totalStrength / totalCount;
    const regionScore = Math.max(meanStrength, coverageRatio * 0.85);

    // Enforce RED traced region border outline color when blind spot schedule gaps exist
    const borderOutlineColor = hasBlindSpots
        ? Cesium.Color.RED
        : (regionScore >= 0.28 && strongRatio >= 0.55
            ? Cesium.Color.GREEN
            : regionScore >= 0.12
                ? Cesium.Color.YELLOW
                : Cesium.Color.RED);

    if (!tracedAreaEntity) {
        tracedAreaEntity = viewer.entities.add({
            position: Cesium.Cartesian3.fromDegrees(site.lon, site.lat),
            polygon: {
                hierarchy: positions,
                material: borderOutlineColor.withAlpha(0.04), // ultra transparent fill
                outline: true,
                outlineColor: borderOutlineColor,
                outlineWidth: 3
            },
            label: {
                text: site.name.toUpperCase() + `\n[COVERAGE SCORE: ${(regionScore * 100).toFixed(0)}%]`,
                font: 'bold 11px monospace',
                fillColor: Cesium.Color.WHITE,
                outlineColor: Cesium.Color.BLACK,
                outlineWidth: 2,
                style: Cesium.LabelStyle.FILL_AND_OUTLINE,
                verticalOrigin: Cesium.VerticalOrigin.CENTER,
                pixelOffset: new Cesium.Cartesian2(0, 0)
            }
        });
    } else {
        tracedAreaEntity.show = true;
        tracedAreaEntity.position = Cesium.Cartesian3.fromDegrees(site.lon, site.lat);
        tracedAreaEntity.polygon.hierarchy = positions;
        tracedAreaEntity.polygon.material = borderOutlineColor.withAlpha(0.04);
        tracedAreaEntity.polygon.outlineColor = borderOutlineColor;
        tracedAreaEntity.label.text = site.name.toUpperCase() + `\n[COVERAGE SCORE: ${(regionScore * 100).toFixed(0)}%]`;
    }

    // 6. Draw Localized Coverage Confidence Heatmap on the grid points!
    if (appState.selectedArea.grid && appState.selectedArea.grid.length > 0) {
        if (gridEntities.length !== appState.selectedArea.grid.length) {
            clearGridVisuals(viewer);
            gridObservationState.clear();
        }

        if (gridEntities.length === 0) {
            appState.selectedArea.grid.forEach((pt, gridIdx) => {
                const covResult = evaluateCoverageAtPoint(pt.lat, pt.lon, clock, satrecs, sensorConeAngleDeg);

                // Temporal decay logic for each grid point
                let gState = gridObservationState.get(gridIdx);
                if (!gState) {
                    gState = { lastObservedTime: null, strongestObserver: null, baseStrength: 0 };
                    gridObservationState.set(gridIdx, gState);
                }

                if (covResult.isEffectivelyCovered) {
                    gState.lastObservedTime = clock.getTime();
                    gState.strongestObserver = covResult.bestSatelliteName;
                    gState.baseStrength = covResult.coverageStrength;
                }

                let decayedStrength = 0;
                let gridStatus = "blind";
                if (gState.lastObservedTime !== null) {
                    const elapsed = (clock.getTime() - gState.lastObservedTime) / 60000;
                    if (elapsed <= 30) {
                        decayedStrength = gState.baseStrength * Math.exp(-0.05 * elapsed);
                        gridStatus = elapsed <= 10 ? "strong" : "degraded";
                    }
                }

                const ptColor = gridStatus === "strong" ? Cesium.Color.GREEN.withAlpha(0.24) :
                                gridStatus === "degraded" ? Cesium.Color.YELLOW.withAlpha(0.16) :
                                Cesium.Color.RED.withAlpha(0.04);

                const e = viewer.entities.add({
                    position: Cesium.Cartesian3.fromDegrees(pt.lon, pt.lat),
                    ellipse: {
                        semiMinorAxis: 15000,
                        semiMajorAxis: 15000,
                        material: ptColor,
                        outline: gridStatus !== "blind",
                        outlineColor: ptColor.withAlpha(0.4),
                        outlineWidth: 1,
                        height: 0
                    }
                });
                gridEntities.push(e);
            });
        } else {
            const updateCount = Math.min(gridEntities.length, appState.selectedArea.grid.length);
            for (let i = 0; i < updateCount; i++) {
                const pt = appState.selectedArea.grid[i];
                const covResult = evaluateCoverageAtPoint(pt.lat, pt.lon, clock, satrecs, sensorConeAngleDeg);

                // Temporal decay
                let gState = gridObservationState.get(i);
                if (!gState) {
                    gState = { lastObservedTime: null, strongestObserver: null, baseStrength: 0 };
                    gridObservationState.set(i, gState);
                }

                if (covResult.isEffectivelyCovered) {
                    gState.lastObservedTime = clock.getTime();
                    gState.strongestObserver = covResult.bestSatelliteName;
                    gState.baseStrength = covResult.coverageStrength;
                }

                let decayedStrength = 0;
                let gridStatus = "blind";
                if (gState.lastObservedTime !== null) {
                    const elapsed = (clock.getTime() - gState.lastObservedTime) / 60000;
                    if (elapsed <= 30) {
                        decayedStrength = gState.baseStrength * Math.exp(-0.05 * elapsed);
                        gridStatus = elapsed <= 10 ? "strong" : "degraded";
                    }
                }

                const ptColor = gridStatus === "strong" ? Cesium.Color.GREEN.withAlpha(0.24) :
                                gridStatus === "degraded" ? Cesium.Color.YELLOW.withAlpha(0.16) :
                                Cesium.Color.RED.withAlpha(0.04);

                gridEntities[i].ellipse.material = ptColor;
                gridEntities[i].ellipse.outline = (gridStatus !== "blind");
                gridEntities[i].ellipse.outlineColor = ptColor.withAlpha(0.4);
            }
        }
    }
}

function clearVisuals(viewer) {
    siteEntities.forEach(entity => viewer.entities.remove(entity));
    siteEntities.clear();
    if (tracedAreaEntity) {
        viewer.entities.remove(tracedAreaEntity);
        tracedAreaEntity = null;
    }
    clearGridVisuals(viewer);
    clearDynamicVisuals(viewer);
    siteObservationState.clear();
    gridObservationState.clear();
}

function selectRepresentativeGridPoints(grid, count = 9) {
    if (!grid || grid.length === 0) return [];
    if (grid.length <= count) return [...grid];

    // Sort by lat then lon, pick evenly spaced samples for spatial distribution
    const sorted = [...grid].sort((a, b) => a.lat - b.lat || a.lon - b.lon);
    const step = Math.max(1, Math.floor(sorted.length / count));
    const selected = [];
    for (let i = 0; i < count; i++) {
        selected.push(sorted[Math.min(i * step, sorted.length - 1)]);
    }
    return selected;
}

function generateSchedule(site, satrecs, timeframeHours = 24, elevationThresholdDeg = 10) {
    if (!site || !Number.isFinite(site.lat) || !Number.isFinite(site.lon)) return [];

    const schedule = [];
    const debugMetrics = {
        totalSamples: 0,
        coveredSamples: 0,
        darkIntervalsMinutes: [],
        averageCoverageStrength: 0,
        coverageStrengthMin: Number.POSITIVE_INFINITY,
        coverageStrengthMax: 0,
        profileUsageCounts: {},
        visibleCount: 0,
        effectiveCoverageCount: 0,
        rejectedByRange: 0,
        rejectedByOffNadir: 0,
        rejectedByElevation: 0,
        rejectedByThreshold: 0,
        geoContributionCount: 0,
        isrContributionCount: 0,
        samplePointCount: 0,
        coverageFractionRequired: 1.0
    };
    const baseDate = new Date(currentBaseDate);
    const startOfToday = new Date(baseDate);
    startOfToday.setUTCHours(0,0,0,0);

    // Multi-point sampling: for region analysis, require most grid points to be covered
    const isRegionAnalysis = !!appState.selectedArea?.grid?.length;
    const samplePoints = isRegionAnalysis
        ? selectRepresentativeGridPoints(appState.selectedArea.grid, 9)
        : [{ lat: site.lat, lon: site.lon }];
    const coverageFractionRequired = isRegionAnalysis ? 0.6 : 1.0;

    debugMetrics.samplePointCount = samplePoints.length;
    debugMetrics.coverageFractionRequired = coverageFractionRequired;

    let currentBlindSpot = null;
    let pendingCoverageStart = null;
    let coverageStreak = 0;
    let stepMinutes = 2;
    const totalMinutes = timeframeHours * 60;
    const minimumObservationMinutes = 4;
    const requiredCoverageSamples = Math.max(1, Math.ceil(minimumObservationMinutes / stepMinutes));
    let darkStartMinute = null;
    let coverageStrengthSum = 0;

    for (let m = 0; m <= totalMinutes; m += stepMinutes) {
        const d = new Date(startOfToday.getTime() + m * 60000);
        const sampleMetrics = {
            profileUsageCounts: {},
            evaluations: 0,
            visibleCount: 0,
            effectiveCoverageCount: 0,
            rejectedByRange: 0,
            rejectedByOffNadir: 0,
            rejectedByElevation: 0,
            rejectedByThreshold: 0,
            coverageStrengthSum: 0,
            coverageStrengthMin: Number.POSITIVE_INFINITY,
            coverageStrengthMax: 0
        };

        // Multi-point coverage check
        let coveredPointCount = 0;
        let stepStrengthSum = 0;
        let stepHasIsrContributor = false;
        let stepHasGeoContributor = false;

        for (const pt of samplePoints) {
            const coverage = evaluateCoverageAtPoint(pt.lat, pt.lon, d, satrecs, elevationThresholdDeg, sampleMetrics);
            stepStrengthSum += coverage.coverageStrength || 0;
            if (coverage.isEffectivelyCovered) {
                coveredPointCount++;
                if (coverage.isrCapable === false || coverage.profileKey === "geoComm") {
                    stepHasGeoContributor = true;
                } else {
                    stepHasIsrContributor = true;
                }
            }
        }

        const coverageFraction = coveredPointCount / samplePoints.length;
        const isCovered = coverageFraction >= coverageFractionRequired;
        const avgStrength = stepStrengthSum / samplePoints.length;

        debugMetrics.totalSamples += 1;
        debugMetrics.coveredSamples += isCovered ? 1 : 0;
        coverageStrengthSum += avgStrength;
        debugMetrics.coverageStrengthMin = Math.min(debugMetrics.coverageStrengthMin, avgStrength);
        debugMetrics.coverageStrengthMax = Math.max(debugMetrics.coverageStrengthMax, avgStrength);
        debugMetrics.visibleCount += sampleMetrics.visibleCount;
        debugMetrics.effectiveCoverageCount += sampleMetrics.effectiveCoverageCount;
        debugMetrics.rejectedByRange += sampleMetrics.rejectedByRange;
        debugMetrics.rejectedByOffNadir += sampleMetrics.rejectedByOffNadir;
        debugMetrics.rejectedByElevation += sampleMetrics.rejectedByElevation;
        debugMetrics.rejectedByThreshold += sampleMetrics.rejectedByThreshold;
        if (isCovered && stepHasIsrContributor) debugMetrics.isrContributionCount += 1;
        if (isCovered && stepHasGeoContributor && !stepHasIsrContributor) debugMetrics.geoContributionCount += 1;
        for (const [key, value] of Object.entries(sampleMetrics.profileUsageCounts)) {
            debugMetrics.profileUsageCounts[key] = (debugMetrics.profileUsageCounts[key] || 0) + value;
        }

        if (isCovered) {
            if (darkStartMinute !== null) {
                debugMetrics.darkIntervalsMinutes.push(m - darkStartMinute);
                darkStartMinute = null;
            }
            if (!pendingCoverageStart) {
                pendingCoverageStart = d;
                coverageStreak = 1;
            } else {
                coverageStreak += 1;
            }

            if (coverageStreak >= requiredCoverageSamples && currentBlindSpot) {
                currentBlindSpot.end = pendingCoverageStart;
                currentBlindSpot.duration = Math.max(0, Math.round((currentBlindSpot.end - currentBlindSpot.start) / 60000));
                if (currentBlindSpot.duration > 0) {
                    schedule.push(currentBlindSpot);
                }
                currentBlindSpot = null;
            }
        } else {
            pendingCoverageStart = null;
            coverageStreak = 0;
            if (darkStartMinute === null) {
                darkStartMinute = m;
            }
            if (!currentBlindSpot) {
                currentBlindSpot = { start: d };
            }
        }
    }

    if (currentBlindSpot) {
        currentBlindSpot.end = new Date(startOfToday.getTime() + totalMinutes * 60000);
        currentBlindSpot.duration = Math.round((currentBlindSpot.end - currentBlindSpot.start) / 60000);
        schedule.push(currentBlindSpot);
    }

    if (darkStartMinute !== null) {
        debugMetrics.darkIntervalsMinutes.push(totalMinutes - darkStartMinute);
    }

    debugMetrics.averageCoverageStrength = debugMetrics.totalSamples > 0
        ? coverageStrengthSum / debugMetrics.totalSamples
        : 0;
    debugMetrics.coverageStrengthMin = Number.isFinite(debugMetrics.coverageStrengthMin) ? debugMetrics.coverageStrengthMin : 0;
    debugMetrics.coverageStrengthMax = Number.isFinite(debugMetrics.coverageStrengthMax) ? debugMetrics.coverageStrengthMax : 0;
    debugMetrics.persistentCoveragePercent = debugMetrics.totalSamples > 0
        ? (debugMetrics.coveredSamples / debugMetrics.totalSamples) * 100
        : 0;
    debugMetrics.averageDarkDurationMinutes = debugMetrics.darkIntervalsMinutes.length
        ? debugMetrics.darkIntervalsMinutes.reduce((sum, value) => sum + value, 0) / debugMetrics.darkIntervalsMinutes.length
        : 0;
    debugMetrics.maxDarkDurationMinutes = debugMetrics.darkIntervalsMinutes.length
        ? Math.max(...debugMetrics.darkIntervalsMinutes)
        : 0;
    debugMetrics.revisitIntervalMinutes = debugMetrics.averageDarkDurationMinutes;
    schedule.debugMetrics = debugMetrics;

    return schedule;
}

function renderSchedule(scheduleContainer, schedule) {
    if (!scheduleContainer) return;

    if (schedule.length === 0) {
        scheduleContainer.innerHTML = `<div class="empty-state">No blind windows detected. The computed assessment remains stable until the next recalculation.</div>`;
        return;
    }

    const coverageGroups = SATELLITE_GROUPS.filter(g => g.selected).map(g => g.label).join(", ");
    const istOffset = 5.5 * 60 * 60 * 1000;
    const debugMetrics = schedule.debugMetrics;
    const debugBlock = debugMetrics ? `
        <div class="micro-card" style="margin-bottom: 10px; padding: 10px;">
            <div style="font-weight: 700; margin-bottom: 6px;">Debug Metrics</div>
            <div style="display:grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 6px; font-size: 11px; color: var(--text-dim);">
                <div>Avg Strength: <strong style="color: white;">${debugMetrics.averageCoverageStrength.toFixed(3)}</strong></div>
                <div>Pass Rate: <strong style="color: white;">${debugMetrics.persistentCoveragePercent.toFixed(1)}%</strong></div>
                <div>Max Dark: <strong style="color: white;">${debugMetrics.maxDarkDurationMinutes.toFixed(0)}m</strong></div>
                <div>Avg Dark: <strong style="color: white;">${debugMetrics.averageDarkDurationMinutes.toFixed(0)}m</strong></div>
                <div>ISR Contrib.: <strong style="color: #4fc3f7;">${debugMetrics.isrContributionCount || 0}</strong></div>
            </div>
        </div>
    ` : "";

    scheduleContainer.innerHTML = schedule.map(bs => {
        const istStart = new Date(bs.start.getTime() + istOffset);
        const istEnd = new Date(bs.end.getTime() + istOffset);
        return `
            <div class="list-item danger" style="padding: 10px; margin-bottom: 8px;">
                <div style="font-weight:bold; margin-bottom: 4px; color: var(--severity-danger);">Computed Blind Window</div>
                <div style="display:flex; justify-content:space-between; font-size: 0.85em; color: var(--text-dim); margin-bottom: 4px;">
                    <span>Start: ${istStart.toISOString().substr(11,5)}</span>
                    <span>End: ${istEnd.toISOString().substr(11,5)}</span>
                </div>
                <div style="font-size: 0.85em; margin-bottom: 4px;">Duration: <strong style="color:white;">${bs.duration} mins</strong></div>
                <div style="font-size: 0.75em; color: var(--text-dim); font-style: italic;">Coverage set: ${coverageGroups || "None"}</div>
            </div>
        `;
    }).join("");

    scheduleContainer.innerHTML = `${debugBlock}${scheduleContainer.innerHTML}`;
}

function generateGrid(bounds, count = 15) {
    const grid = [];
    const latStep = (bounds.maxLat - bounds.minLat) / Math.sqrt(count);
    const lonStep = (bounds.maxLon - bounds.minLon) / Math.sqrt(count);

    for (let lat = bounds.minLat + latStep/2; lat < bounds.maxLat; lat += latStep) {
        for (let lon = bounds.minLon + lonStep/2; lon < bounds.maxLon; lon += lonStep) {
            grid.push({ lat, lon });
        }
    }
    return grid;
}

function pointInPolygon(point, polygon) {
    if (!point || !Array.isArray(polygon) || polygon.length < 3) return false;

    let inside = false;
    for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
        const xi = polygon[i].lon;
        const yi = polygon[i].lat;
        const xj = polygon[j].lon;
        const yj = polygon[j].lat;

        const intersects = ((yi > point.lat) !== (yj > point.lat)) &&
            (point.lon < ((xj - xi) * (point.lat - yi)) / ((yj - yi) || 1e-12) + xi);
        if (intersects) inside = !inside;
    }
    return inside;
}

function buildRegionGrid(area, count = 100) {
    if (!area?.bounds) return [];
    const rawGrid = generateGrid(area.bounds, count);
    if (!Array.isArray(area.points) || area.points.length < 3) {
        return rawGrid;
    }
    return rawGrid.filter((pt) => pointInPolygon(pt, area.points));
}

export default {
    id: "blind-spot-detection",
    label: "Blind Spot Detection",
    eyebrow: "Coverage Intelligence",
    description: "Computed operational blind spot assessment for strategic regions over a 24-hour window.",
    dockEyebrow: "Coverage",
    dockLabel: "Blind Spot",
    status: "ready",
    async mount(ctx) {
        const root = ctx.containers.sidebarRoot;
        root.innerHTML = buildSidebar();

        const tlContainer = document.getElementById("bsTimelineContainer");
        if (tlContainer) {
            tlContainer.innerHTML = buildTimeline();
        }

        if (!worldData) {
            try {
                const resp = await fetch(WORLD_BOUNDARIES_URL);
                worldData = await resp.json();
            } catch (e) {
                console.error("Failed to load world boundaries:", e);
            }
        }

        const scope = new ListenerScope();
        let focusedSite = null;
        let currentSatrecs = getFilteredSatrecs();
        let analysisTimeframeHours = 24;
        let sensorConeAngleDeg = 10;
        let lastBlindSpotSchedule = [];
        let lastActiveTarget = null;

        appState.realTimeMultiplier = 1;
        currentBaseDate = new Date();
        currentBaseDate.setUTCHours(0,0,0,0);
        appState.realTimeClock = new Date();

        const timeDisplay = document.getElementById("bsTimeDisplay");
        const scrubber = document.getElementById("bsTimeScrubber");
        const statusBadge = document.getElementById("bsCoverageStatus");
        const scheduleContainer = document.getElementById("bsScheduleContainer");
        const searchInput = document.getElementById("bsSearchInput");
        const searchBtn = document.getElementById("bsSearchBtn");
        const dateDisplay = document.getElementById("bsCurrentDateDisplay");
        const exportCsvBtn = document.getElementById("bsExportCsvBtn");


        const siteButtons = document.querySelectorAll(".site-btn");
        const cbGroup = document.querySelectorAll(".sat-group-cb");

        const triggerRecalculate = () => {
            currentSatrecs = getFilteredSatrecs();
            let target = focusedSite;
            if (!target && hasSelectedArea()) {
                target = {
                    name: appState.selectedArea.name || "Traced Region",
                    lat: appState.selectedArea.centroid.lat,
                    lon: appState.selectedArea.centroid.lon
                };
            }
            if (target) {
                lastActiveTarget = target;
                const schedule = generateSchedule(target, currentSatrecs, analysisTimeframeHours, sensorConeAngleDeg);
                lastBlindSpotSchedule = schedule;
                renderSchedule(scheduleContainer, schedule);

                const clock = appState.realTimeClock || new Date();
                const hasBlindSpots = schedule.length > 0;
                updateSiteVisuals(clock, currentSatrecs, ctx.shared.viewer, focusedSite, sensorConeAngleDeg, hasBlindSpots);
                updateTracedAreaVisual(clock, currentSatrecs, ctx.shared.viewer, focusedSite, sensorConeAngleDeg, hasBlindSpots);

                if (statusBadge) {
                    if (currentSatrecs.length === 0) {
                        statusBadge.textContent = "NO SATELLITES SELECTED";
                        statusBadge.style.color = "var(--severity-warning)";
                    } else if (schedule.length === 0) {
                        statusBadge.textContent = "COVERAGE STABLE";
                        statusBadge.style.color = "var(--severity-success)";
                    } else {
                        statusBadge.textContent = "BLIND WINDOWS MAPPED";
                        statusBadge.style.color = "var(--severity-danger)";
                    }
                }
            }

            updateCurrentTimeUI();
        };

        const updateCurrentTimeUI = () => {
            const clock = appState.realTimeClock || new Date();

            if (timeDisplay) timeDisplay.textContent = formatIST(clock);
            if (scrubber) {
                const midnight = new Date(clock);
                midnight.setUTCHours(0,0,0,0);
                scrubber.value = (clock.getTime() - midnight.getTime()) / 1000;
            }
            if (statusBadge && !focusedSite && !hasSelectedArea()) {
                statusBadge.textContent = "SELECT REGION";
                statusBadge.style.color = "white";
            }
        };

        const updateLoop = setInterval(() => {
            if (appState.realTimeMultiplier > 0) {
                appState.realTimeClock = new Date(appState.realTimeClock.getTime() + (appState.realTimeMultiplier * 100));
                // Automatically refresh map visuals dynamically in real time
                const target = focusedSite || (hasSelectedArea() ? {
                    name: appState.selectedArea.name || "Traced Region",
                    lat: appState.selectedArea.centroid.lat,
                    lon: appState.selectedArea.centroid.lon
                } : null);
                if (target) {
                    const clock = appState.realTimeClock || new Date();
                    const hasBlindSpots = lastBlindSpotSchedule.length > 0;
                    updateSiteVisuals(clock, currentSatrecs, ctx.shared.viewer, focusedSite, sensorConeAngleDeg, hasBlindSpots);
                    updateTracedAreaVisual(clock, currentSatrecs, ctx.shared.viewer, focusedSite, sensorConeAngleDeg, hasBlindSpots);
                }
            }
            updateCurrentTimeUI();
        }, 100);
        scope.addCleanup(() => clearInterval(updateLoop));


        const updateDateDisplay = () => {
            const today = new Date();
            today.setUTCHours(0,0,0,0);
            const diff = Math.round((currentBaseDate.getTime() - today.getTime()) / (24 * 60 * 60000));

            if (diff === 0) dateDisplay.textContent = "TODAY";
            else if (diff === 1) dateDisplay.textContent = "TOMORROW";
            else if (diff === -1) dateDisplay.textContent = "YESTERDAY";
            else dateDisplay.textContent = formatDateHeader(currentBaseDate);

            const timeOfDay = appState.realTimeClock.getTime() - new Date(appState.realTimeClock).setUTCHours(0,0,0,0);
            appState.realTimeClock = new Date(currentBaseDate.getTime() + timeOfDay);
            triggerRecalculate();
        };

        const performSearch = () => {
            const term = searchInput.value.trim().toLowerCase();
            if (!term) return;

            const siteIdx = STRATEGIC_SITES.findIndex(s => s.name.toLowerCase().includes(term));
            if (siteIdx !== -1) {
                focusedSite = STRATEGIC_SITES[siteIdx];
                ctx.shared.viewer.camera.flyTo({
                    destination: Cesium.Cartesian3.fromDegrees(focusedSite.lon, focusedSite.lat, 2500000),
                    duration: 1.5
                });
                appState.selectedArea = null;
                triggerRecalculate();
                setStatus(`Monitoring ${focusedSite.name}...`);
                return;
            }

            if (worldData) {
                const feature = worldData.features.find(f => {
                    const name = f.properties.name || f.properties.NAME || f.properties.admin || "";
                    return name.toLowerCase().includes(term);
                });

                if (feature) {
                    const name = feature.properties.name || feature.properties.NAME || feature.properties.admin;
                    setStatus(`Found ${name}. Calculating coverage...`);

                    let minLat = 90, maxLat = -90, minLon = 180, maxLon = -180;
                    const flattened = feature.geometry.type === "MultiPolygon"
                        ? feature.geometry.coordinates.flat(2)
                        : feature.geometry.coordinates.flat(1);

                    flattened.forEach(c => {
                        if (c[1] < minLat) minLat = c[1];
                        if (c[1] > maxLat) maxLat = c[1];
                        if (c[0] < minLon) minLon = c[0];
                        if (c[0] > maxLon) maxLon = c[0];
                    });

                    const lat = (minLat + maxLat) / 2;
                    const lon = (minLon + maxLon) / 2;

                    ctx.shared.viewer.camera.flyTo({
                        destination: Cesium.Cartesian3.fromDegrees(lon, lat, 5000000),
                        duration: 1.5
                    });

                    appState.selectedArea = {
                        name: name,
                        centroid: { lat, lon },
                        points: flattened.map(c => ({ lat: c[1], lon: c[0] })),
                        grid: buildRegionGrid({
                            bounds: { minLat, maxLat, minLon, maxLon },
                            points: flattened.map(c => ({ lat: c[1], lon: c[0] }))
                        }, 100),
                        bounds: { minLat, maxLat, minLon, maxLon }
                    };

                    focusedSite = null;
                    clearGridVisuals(ctx.shared.viewer);
                    triggerRecalculate();
                    return;
                }
            }

            setStatus(`No region or country found for "${term}".`);
        };

        const minimizeBtn = document.getElementById("bsMinimizeBtn");
        const tlContent = document.getElementById("bsTimelineContent");
        const tlOverlay = document.getElementById("bsTimelineOverlay");
        let isMinimized = false;

        scope.add(minimizeBtn, "click", () => {
            isMinimized = !isMinimized;
            tlContent.style.display = isMinimized ? "none" : "flex";
            minimizeBtn.innerHTML = isMinimized ? "\u25FB" : "\u2212";
            tlOverlay.style.bottom = isMinimized ? "10px" : "100px";
            tlOverlay.style.width = isMinimized ? "250px" : "650px";
        });

        scope.add(document.getElementById("bsPrevDayBtn"), "click", () => {
            currentBaseDate = new Date(currentBaseDate.getTime() - 24 * 60 * 60000);
            updateDateDisplay();
        });

        scope.add(document.getElementById("bsNextDayBtn"), "click", () => {
            currentBaseDate = new Date(currentBaseDate.getTime() + 24 * 60 * 60000);
            updateDateDisplay();
        });

        siteButtons.forEach(btn => {
            scope.add(btn, "click", (e) => {
                const idx = e.target.dataset.index;
                focusedSite = STRATEGIC_SITES[idx];
                ctx.shared.viewer.camera.flyTo({
                    destination: Cesium.Cartesian3.fromDegrees(focusedSite.lon, focusedSite.lat, 2500000),
                    duration: 1.5
                });
                appState.selectedArea = null;
                clearGridVisuals(ctx.shared.viewer);
                triggerRecalculate();
                setStatus(`Monitoring ${focusedSite.name}...`);
            });
        });

        attachRegionTracingControls(scope, {
            onAnalyze: () => {
                focusedSite = null;
                clearGridVisuals(ctx.shared.viewer);
                triggerRecalculate();
                setStatus("Monitoring traced region blind spots...");
            }
        });

        scope.add(document.getElementById("bsRecalculateBtn"), "click", () => {
            cbGroup.forEach(cb => {
                const idx = cb.dataset.index;
                SATELLITE_GROUPS[idx].selected = cb.checked;
            });
            triggerRecalculate();
            setStatus(`Filters updated. Schedule regenerated.`);
        });

        scope.add(searchInput, "input", (e) => {
            const term = e.target.value.toLowerCase();
            siteButtons.forEach((btn, i) => {
                btn.style.display = STRATEGIC_SITES[i].name.toLowerCase().includes(term) ? "block" : "none";
            });
        });

        scope.add(searchInput, "keydown", (e) => {
            if (e.key === "Enter") performSearch();
        });

        scope.add(searchBtn, "click", performSearch);

        scope.add(exportCsvBtn, "click", () => {
            if (!lastBlindSpotSchedule || lastBlindSpotSchedule.length === 0) {
                setStatus("Please select a region and generate a schedule before exporting.");
                return;
            }

            const activeTargetName = lastActiveTarget ? lastActiveTarget.name : "Traced Region";
            const coverageGroups = SATELLITE_GROUPS.filter(g => g.selected).map(g => g.label).join("; ");

            // Build CSV content
            let csvRows = [];
            csvRows.push("Strategic Region,Start Time (UTC),End Time (UTC),Start Time (IST),End Time (IST),Duration (Minutes),Coverage Set");

            const istOffset = 5.5 * 60 * 60 * 1000;

            lastBlindSpotSchedule.forEach(bs => {
                const startUTC = bs.start.toISOString();
                const endUTC = bs.end.toISOString();

                const startIST = new Date(bs.start.getTime() + istOffset).toISOString().substr(11, 8);
                const endIST = new Date(bs.end.getTime() + istOffset).toISOString().substr(11, 8);

                const row = [
                    `"${activeTargetName.replace(/"/g, '""')}"`,
                    `"${startUTC}"`,
                    `"${endUTC}"`,
                    `"${startIST}"`,
                    `"${endIST}"`,
                    bs.duration,
                    `"${coverageGroups.replace(/"/g, '""')}"`
                ].join(",");

                csvRows.push(row);
            });

            const csvString = csvRows.join("\r\n");
            const blob = new Blob([csvString], { type: "text/csv;charset=utf-8;" });
            const url = URL.createObjectURL(blob);

            const link = document.createElement("a");
            link.setAttribute("href", url);
            link.setAttribute("download", `Blind_Spot_Schedule_${activeTargetName.replace(/[^a-zA-Z0-9]/g, "_")}.csv`);
            link.style.visibility = "hidden";
            document.body.appendChild(link);
            link.click();
            document.body.removeChild(link);

            setStatus("CSV schedule exported successfully.");
        });

        const playBtn = document.getElementById("bsPlayPauseBtn");
        const fastBtn = document.getElementById("bsFastBtn");
        const liveBtn = document.getElementById("bsLiveBtn");

        scope.add(playBtn, "click", () => {
            appState.realTimeMultiplier = (appState.realTimeMultiplier === 0) ? 1 : 0;
            playBtn.textContent = (appState.realTimeMultiplier === 0) ? "Play" : "Pause";
        });

        scope.add(fastBtn, "click", () => {
            appState.realTimeMultiplier = 3600;
            playBtn.textContent = "Pause";
        });

        scope.add(liveBtn, "click", () => {
            appState.realTimeClock = new Date();
            appState.realTimeMultiplier = 1;
            playBtn.textContent = "Pause";
            currentBaseDate = new Date();
            currentBaseDate.setUTCHours(0,0,0,0);
            updateDateDisplay();
        });

        scope.add(scrubber, "input", (e) => {
            const seconds = Number(e.target.value);
            const midnight = new Date(appState.realTimeClock);
            midnight.setUTCHours(0,0,0,0);
            appState.realTimeClock = new Date(midnight.getTime() + seconds * 1000);
            // Refresh visuals instantly during scrubbing
            const clock = appState.realTimeClock || new Date();
            const hasBlindSpots = lastBlindSpotSchedule.length > 0;
            updateSiteVisuals(clock, currentSatrecs, ctx.shared.viewer, focusedSite, sensorConeAngleDeg, hasBlindSpots);
            updateTracedAreaVisual(clock, currentSatrecs, ctx.shared.viewer, focusedSite, sensorConeAngleDeg, hasBlindSpots);
        });

        scope.add(scrubber, "mousedown", () => {
            appState._prevMultiplier = appState.realTimeMultiplier;
            appState.realTimeMultiplier = 0;
        });

        scope.add(scrubber, "mouseup", () => {
            appState.realTimeMultiplier = appState._prevMultiplier !== undefined ? appState._prevMultiplier : 1;
            playBtn.textContent = (appState.realTimeMultiplier === 0) ? "Play" : "Pause";
        });

        scope.addCleanup(eventBus.on(events.areaSelected, () => {
            focusedSite = null;
            clearGridVisuals(ctx.shared.viewer);
            triggerRecalculate();
        }));

        return {
            unmount() {
                scope.dispose();
                if (tlContainer) tlContainer.innerHTML = "";
                clearVisuals(ctx.shared.viewer);
                appState.realTimeMultiplier = 1;
            }
        };
    }
};
