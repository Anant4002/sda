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
            <div class="section-title">Operational Parameters</div>
            <div style="display:flex; flex-direction:column; gap:8px;">
                <div>
                    <label style="font-size:11px; color:var(--text-dim);">Analysis Timeframe</label>
                    <div style="display:flex; gap:4px; margin-top:4px;">
                        <button class="bs-timeframe-btn secondary" data-hours="1" style="flex:1; padding:4px; font-size:10px;">1h</button>
                        <button class="bs-timeframe-btn secondary" data-hours="3" style="flex:1; padding:4px; font-size:10px;">3h</button>
                        <button class="bs-timeframe-btn secondary" data-hours="6" style="flex:1; padding:4px; font-size:10px;">6h</button>
                        <button class="bs-timeframe-btn secondary" data-hours="12" style="flex:1; padding:4px; font-size:10px;">12h</button>
                        <button class="bs-timeframe-btn primary" data-hours="24" style="flex:1; padding:4px; font-size:10px;">24h (Active)</button>
                    </div>
                </div>
                <div>
                    <label style="font-size:11px; color:var(--text-dim);">Sensor Cone Angle: <strong id="bsSensorConeDisplay">10°</strong></label>
                    <input type="range" id="bsSensorConeSlider" min="5" max="45" value="10" step="5" style="width:100%; margin-top:4px;">
                    <div style="display:flex; justify-content:space-between; font-size:9px; color:var(--text-dim); margin-top:2px;">
                        <span>5°</span><span>25°</span><span>45°</span>
                    </div>
                </div>
            </div>
        </div>

        <div class="section">
            <div class="section-title">Coverage Filters</div>
            <div class="micro-card" style="margin-bottom: 8px; font-size: 11px; color: var(--text-dim);">
                Indian assets include LEO, MEO, and GEO missions. Select the asset families you want to evaluate.
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
            <div style="display:flex; gap:4px; margin-top:8px;">
                <button id="bsExportCsvBtn" class="secondary" style="flex:1; font-size:11px;">Export CSV</button>
                <button id="bsExportJsonBtn" class="secondary" style="flex:1; font-size:11px;">Export JSON</button>
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
    const istOffset = 5.5 * 60 * 60 * 1000;
    const istDate = new Date(date.getTime() + istOffset);
    return istDate.toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' });
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

function checkCoverage(lat, lon, date, satrecs, elevationThresholdDeg = 10) {
    if (!satrecs || satrecs.length === 0) return "NO_SATS";

    const observer = {
        latitude: Cesium.Math.toRadians(lat),
        longitude: Cesium.Math.toRadians(lon),
        height: 0
    };

    const gmst = window.satellite.gstime(date);
    const thresholdRad = Cesium.Math.toRadians(elevationThresholdDeg);

    for(const sat of satrecs) {
        const pva = window.satellite.propagate(sat.satrec, date);
        if(!pva.position) continue;

        const positionEcf = window.satellite.eciToEcf(pva.position, gmst);
        const lookAngles = window.satellite.ecfToLookAngles(observer, positionEcf);

        if (lookAngles.elevation >= thresholdRad) {
            return sat.name;
        }
    }
    return null;
}

const siteEntities = new Map();
let tracedAreaEntity = null;
const gridEntities = [];

function clearGridVisuals(viewer) {
    gridEntities.forEach(e => viewer.entities.remove(e));
    gridEntities.length = 0;
}

function updateSiteVisuals(clock, satrecs, viewer, focusedSite, sensorConeAngleDeg) {
    STRATEGIC_SITES.forEach((site, i) => {
        let entity = siteEntities.get(i);
        const isFocused = focusedSite && focusedSite.name === site.name;

        if (!isFocused) {
            if (entity) entity.show = false;
            return;
        }

        const covResult = checkCoverage(site.lat, site.lon, clock, satrecs, sensorConeAngleDeg);
        const isBlind = !covResult || covResult === "NO_SATS";

        if (!entity) {
            entity = viewer.entities.add({
                position: Cesium.Cartesian3.fromDegrees(site.lon, site.lat),
                ellipse: {
                    semiMinorAxis: 150000.0,
                    semiMajorAxis: 150000.0,
                    material: isBlind ? Cesium.Color.RED.withAlpha(0.3) : Cesium.Color.GREEN.withAlpha(0.3),
                    outline: true,
                    outlineColor: isBlind ? Cesium.Color.RED : Cesium.Color.GREEN,
                    outlineWidth: 3
                },
                label: {
                    text: site.name,
                    font: 'bold 12px sans-serif',
                    fillColor: Cesium.Color.WHITE,
                    outlineColor: Cesium.Color.BLACK,
                    outlineWidth: 2,
                    style: Cesium.LabelStyle.FILL_AND_OUTLINE,
                    verticalOrigin: Cesium.VerticalOrigin.BOTTOM,
                    pixelOffset: new Cesium.Cartesian2(0, -20)
                }
            });
            siteEntities.set(i, entity);
        } else {
            entity.show = true;
            entity.ellipse.material = isBlind ? Cesium.Color.RED.withAlpha(0.3) : Cesium.Color.GREEN.withAlpha(0.3);
            entity.ellipse.outlineColor = isBlind ? Cesium.Color.RED : Cesium.Color.GREEN;
        }
    });
}

function updateTracedAreaVisual(clock, satrecs, viewer, focusedSite, sensorConeAngleDeg) {
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

    // Calculate aggregate coverage for the polygon color
    let coveredCount = 0;
    if (appState.selectedArea.grid) {
        appState.selectedArea.grid.forEach(pt => {
            const res = checkCoverage(pt.lat, pt.lon, clock, satrecs, sensorConeAngleDeg);
            if (res && res !== "NO_SATS") coveredCount++;
        });
    }
    const totalCount = appState.selectedArea.grid ? appState.selectedArea.grid.length : 1;
    const percent = (coveredCount / totalCount) * 100;

    const isCovered = percent >= 99;
    const polyColor = isCovered ? Cesium.Color.GREEN : Cesium.Color.RED;

    if (!tracedAreaEntity) {
        tracedAreaEntity = viewer.entities.add({
            position: Cesium.Cartesian3.fromDegrees(site.lon, site.lat),
            polygon: {
                hierarchy: positions,
                material: polyColor.withAlpha(0.2),
                outline: true,
                outlineColor: polyColor,
                outlineWidth: 3
            },
            label: {
                text: site.name.toUpperCase(),
                font: 'bold 14px sans-serif',
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
        tracedAreaEntity.polygon.material = polyColor.withAlpha(0.2);
        tracedAreaEntity.polygon.outlineColor = polyColor;
        tracedAreaEntity.label.text = site.name.toUpperCase();
    }

    if (appState.selectedArea.grid && appState.selectedArea.grid.length > 0) {
        if (gridEntities.length !== appState.selectedArea.grid.length) {
            clearGridVisuals(viewer);
        }

        if (gridEntities.length === 0) {
            appState.selectedArea.grid.forEach(pt => {
                const covResult = checkCoverage(pt.lat, pt.lon, clock, satrecs, sensorConeAngleDeg);
                const isCovered = covResult && covResult !== "NO_SATS";

                const e = viewer.entities.add({
                    position: Cesium.Cartesian3.fromDegrees(pt.lon, pt.lat),
                    point: {
                        pixelSize: 10,
                        color: isCovered ? Cesium.Color.GREEN : Cesium.Color.RED,
                        outlineColor: Cesium.Color.BLACK,
                        outlineWidth: 1,
                        disableDepthTestDistance: Number.POSITIVE_INFINITY
                    }
                });
                gridEntities.push(e);
            });
        } else {
            const updateCount = Math.min(gridEntities.length, appState.selectedArea.grid.length);
            for (let i = 0; i < updateCount; i++) {
                const pt = appState.selectedArea.grid[i];
                const covResult = checkCoverage(pt.lat, pt.lon, clock, satrecs, sensorConeAngleDeg);
                const isCovered = covResult && covResult !== "NO_SATS";

                gridEntities[i].point.color = isCovered ? Cesium.Color.GREEN : Cesium.Color.RED;
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
}

function generateSchedule(site, satrecs, timeframeHours = 24, elevationThresholdDeg = 10) {
    if (!site || !Number.isFinite(site.lat) || !Number.isFinite(site.lon)) return [];

    const schedule = [];
    const baseDate = new Date(currentBaseDate);
    const startOfToday = new Date(baseDate);
    startOfToday.setUTCHours(0,0,0,0);

    let currentBlindSpot = null;
    let stepMinutes = 5;
    const totalMinutes = timeframeHours * 60;

    for (let m = 0; m <= totalMinutes; m += stepMinutes) {
        const d = new Date(startOfToday.getTime() + m * 60000);
        const coverageSource = checkCoverage(site.lat, site.lon, d, satrecs, elevationThresholdDeg);
        const isBlind = !coverageSource || coverageSource === "NO_SATS";

        if (isBlind) {
            if (!currentBlindSpot) {
                currentBlindSpot = { start: d };
            }
        } else {
            if (currentBlindSpot) {
                currentBlindSpot.end = d;
                currentBlindSpot.duration = Math.round((d - currentBlindSpot.start) / 60000);
                schedule.push(currentBlindSpot);
                currentBlindSpot = null;
            }
        }
    }

    if (currentBlindSpot) {
        currentBlindSpot.end = new Date(startOfToday.getTime() + totalMinutes * 60000);
        currentBlindSpot.duration = Math.round((currentBlindSpot.end - currentBlindSpot.start) / 60000);
        schedule.push(currentBlindSpot);
    }

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
        const sensorConeSlider = document.getElementById("bsSensorConeSlider");
        const sensorConeDisplay = document.getElementById("bsSensorConeDisplay");
        const exportCsvBtn = document.getElementById("bsExportCsvBtn");
        const exportJsonBtn = document.getElementById("bsExportJsonBtn");

        const siteButtons = document.querySelectorAll(".site-btn");
        const cbGroup = document.querySelectorAll(".sat-group-cb");
        const timeframeButtons = document.querySelectorAll(".bs-timeframe-btn");

        // Define helper functions before they're used in event handlers
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
                updateSiteVisuals(clock, currentSatrecs, ctx.shared.viewer, focusedSite, sensorConeAngleDeg);
                updateTracedAreaVisual(clock, currentSatrecs, ctx.shared.viewer, focusedSite, sensorConeAngleDeg);

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

        // Update sensor cone angle display
        scope.add(sensorConeSlider, "input", (e) => {
            sensorConeAngleDeg = Number(e.target.value);
            sensorConeDisplay.textContent = sensorConeAngleDeg + "°";
        });

        // Export CSV
        scope.add(exportCsvBtn, "click", () => {
            if (lastBlindSpotSchedule.length === 0) {
                setStatus("No blind spot schedule to export.");
                return;
            }
            const rows = [["Area", "Start (IST)", "End (IST)", "Duration (mins)", "Satellite Groups", "Selected Satellites"]];
            const areaName = lastActiveTarget ? lastActiveTarget.name : "Unknown Area";
            const satGroups = SATELLITE_GROUPS.filter(g => g.selected).map(g => g.label).join("; ");
            const selectedSatellites = currentSatrecs.map((sat) => sat.name).join("; ");

            lastBlindSpotSchedule.forEach(bs => {
                const istStart = new Date(bs.start.getTime() + 5.5 * 60 * 60 * 1000);
                const istEnd = new Date(bs.end.getTime() + 5.5 * 60 * 60 * 1000);
                rows.push([
                    areaName,
                    istStart.toISOString().substr(11, 5),
                    istEnd.toISOString().substr(11, 5),
                    bs.duration.toString(),
                    satGroups,
                    selectedSatellites
                ]);
            });

            const csv = rows.map(r => r.map(c => `"${String(c).replace(/"/g, '""')}"`).join(","));
            const blob = new Blob([csv.join("\n")], { type: "text/csv;charset=utf-8;" });
            const link = document.createElement("a");
            link.href = URL.createObjectURL(blob);
            link.download = `blind-spot-${areaName.replace(/\s+/g, "-")}-${new Date().toISOString().split("T")[0]}.csv`;
            link.click();
            setStatus(`Exported blind spot schedule as CSV.`);
        });

        // Export JSON
        scope.add(exportJsonBtn, "click", () => {
            if (lastBlindSpotSchedule.length === 0) {
                setStatus("No blind spot schedule to export.");
                return;
            }
            const areaName = lastActiveTarget ? lastActiveTarget.name : "Unknown Area";
            const satGroups = SATELLITE_GROUPS.filter(g => g.selected).map(g => ({ id: g.id, label: g.label }));
            const selectedSatellites = currentSatrecs.map((sat) => sat.name);

            const data = {
                exportedAt: new Date().toISOString(),
                analysisParameters: {
                    areaName,
                    timeframeHours: analysisTimeframeHours,
                    sensorConeAngleDeg,
                    satelliteGroups: satGroups
                },
                selectedSatellites,
                blindSpots: lastBlindSpotSchedule.map(bs => ({
                    startIST: new Date(bs.start.getTime() + 5.5 * 60 * 60 * 1000).toISOString().substr(11, 5),
                    endIST: new Date(bs.end.getTime() + 5.5 * 60 * 60 * 1000).toISOString().substr(11, 5),
                    durationMinutes: bs.duration,
                    utcStart: bs.start.toISOString(),
                    utcEnd: bs.end.toISOString()
                }))
            };

            const blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json;charset=utf-8;" });
            const link = document.createElement("a");
            link.href = URL.createObjectURL(blob);
            link.download = `blind-spot-${areaName.replace(/\s+/g, "-")}-${new Date().toISOString().split("T")[0]}.json`;
            link.click();
            setStatus(`Exported blind spot schedule as JSON.`);
        });

        // Timeframe selection
        timeframeButtons.forEach(btn => {
            scope.add(btn, "click", (e) => {
                timeframeButtons.forEach(b => b.classList.remove("primary"));
                timeframeButtons.forEach(b => b.classList.add("secondary"));
                e.target.classList.remove("secondary");
                e.target.classList.add("primary");
                analysisTimeframeHours = Number(e.target.dataset.hours);
                setStatus(`Analysis timeframe set to ${analysisTimeframeHours} hours.`);
                triggerRecalculate();
            });
        });

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
