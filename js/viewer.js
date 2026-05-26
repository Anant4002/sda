import { COLORS, INDIA_BOUNDARY_GEOJSON_URL } from "./config.js";
import { appState } from "./state.js";
import { setStatus } from "./ui.js";
import { deriveSatelliteGroupLabel, formatNumber, isCommercialSatelliteName } from "./utils.js";
import "../shared/blindSpotCoverageUtils.js";

const {
    resolveSensorProfile,
    computeOperationalRadiusKm,
    computeCoverageStrength,
    isEffectivelyCovered
} = globalThis.blindSpotCoverageUtils;

export const viewer = new Cesium.Viewer("cesiumContainer", {
    animation: false,
    timeline: false,
    infoBox: false,
    selectionIndicator: false,
    geocoder: false,
    homeButton: false,
    baseLayerPicker: false,
    navigationHelpButton: false,
    sceneModePicker: false,
    fullscreenButton: false,
    shouldAnimate: true,
    baseLayer: false,
    terrainProvider: new Cesium.EllipsoidTerrainProvider()
});

viewer.imageryLayers.removeAll();
viewer.imageryLayers.addImageryProvider(
    new Cesium.OpenStreetMapImageryProvider({
        url: "https://tile.openstreetmap.org/"
    })
);

viewer.scene.skyBox.show = false;
viewer.scene.skyAtmosphere.show = false;
viewer.scene.globe.baseColor = Cesium.Color.fromCssColorString("#04111f");
viewer.scene.screenSpaceCameraController.inertiaSpin = 0.92;
viewer.scene.screenSpaceCameraController.inertiaTranslate = 0.9;
viewer.scene.screenSpaceCameraController.inertiaZoom = 0.85;
viewer.scene.screenSpaceCameraController.maximumMovementRatio = 0.15;
viewer.camera.setView({
    destination: Cesium.Cartesian3.fromDegrees(78.9629, 20.5937, 20000000)
});

export const satellitePoints = viewer.scene.primitives.add(new Cesium.PointPrimitiveCollection());

const areaFillColor = Cesium.Color.fromCssColorString(COLORS.areaFill).withAlpha(0.16);
const areaOutlineColor = Cesium.Color.fromCssColorString(COLORS.areaOutline);
const indiaBoundaryColor = Cesium.Color.fromCssColorString(COLORS.indiaBoundary);

export async function loadIndiaBoundaryOverlay(setStatus) {
    try {
        const boundaryDataSource = await Cesium.GeoJsonDataSource.load(INDIA_BOUNDARY_GEOJSON_URL, {
            stroke: indiaBoundaryColor,
            strokeWidth: 10,
            fill: Cesium.Color.TRANSPARENT
        });

        for (const entity of boundaryDataSource.entities.values) {
            if (entity.polygon) {
                entity.polygon.material = Cesium.Color.TRANSPARENT;
                entity.polygon.outline = true;
                entity.polygon.outlineColor = indiaBoundaryColor;
                entity.polygon.outlineWidth = 10;
                entity.polygon.height = 0;
            }

            if (entity.polyline) {
                entity.polyline.material = indiaBoundaryColor;
                entity.polyline.width = 10;
                entity.polyline.clampToGround = true;
            }
        }

        viewer.dataSources.add(boundaryDataSource);
        setStatus("Official Survey of India boundary overlay loaded.");
    } catch (error) {
        console.error("Failed to load India boundary overlay:", error);
        setStatus("Boundary overlay unavailable. Satellite tracking is still available.");
    }
}

export function updateSelectedAreaVisual(selectedArea) {
    if (!selectedArea) {
        if (appState.areaEntity) {
            viewer.entities.remove(appState.areaEntity);
            appState.areaEntity = null;
        }
        return;
    }

    const positions = selectedArea.points.map((point) => Cesium.Cartesian3.fromDegrees(point.lon, point.lat, 0));
    const labelPosition = Cesium.Cartesian3.fromDegrees(selectedArea.centroid.lon, selectedArea.centroid.lat, 0);
    const labelText = `Analysis Region\n${selectedArea.points.length} trace points`;

    if (!appState.areaEntity) {
        appState.areaEntity = viewer.entities.add({
            position: labelPosition,
            polygon: {
                hierarchy: positions,
                height: 0,
                material: areaFillColor,
                outline: true,
                outlineColor: areaOutlineColor
            },
            polyline: {
                positions: [...positions, positions[0]],
                width: 3,
                material: areaOutlineColor,
                clampToGround: true
            },
            label: {
                text: labelText,
                fillColor: Cesium.Color.WHITE,
                style: Cesium.LabelStyle.FILL_AND_OUTLINE,
                outlineWidth: 2,
                verticalOrigin: Cesium.VerticalOrigin.BOTTOM,
                pixelOffset: new Cesium.Cartesian2(0, -18)
            }
        });
        return;
    }

    appState.areaEntity.position = labelPosition;
    appState.areaEntity.polygon.hierarchy = positions;
    appState.areaEntity.polyline.positions = [...positions, positions[0]];
    appState.areaEntity.label.text = labelText;
}

export function updateTraceDraftVisual(tracePoints, previewPoint = null) {
    const draftPoints = previewPoint ? [...tracePoints, previewPoint] : [...tracePoints];

    if (!draftPoints.length) {
        if (appState.traceDraftEntity) {
            viewer.entities.remove(appState.traceDraftEntity);
            appState.traceDraftEntity = null;
        }
        return;
    }

    const positions = draftPoints.map((point) => Cesium.Cartesian3.fromDegrees(point.lon, point.lat, 0));
    const anchorPoint = draftPoints[draftPoints.length - 1];
    const anchorPosition = Cesium.Cartesian3.fromDegrees(anchorPoint.lon, anchorPoint.lat, 0);
    const hasPolygon = tracePoints.length >= 3;

    if (!appState.traceDraftEntity) {
        appState.traceDraftEntity = viewer.entities.add({
            position: anchorPosition,
            polyline: {
                positions,
                width: 3,
                material: areaOutlineColor,
                clampToGround: true
            },
            polygon: hasPolygon ? {
                hierarchy: tracePoints.map((point) => Cesium.Cartesian3.fromDegrees(point.lon, point.lat, 0)),
                height: 0,
                material: areaFillColor,
                outline: true,
                outlineColor: areaOutlineColor
            } : undefined,
            point: {
                pixelSize: 9,
                color: Cesium.Color.fromCssColorString("#ffcf5a"),
                outlineColor: Cesium.Color.BLACK,
                outlineWidth: 2
            },
            label: {
                text: `Tracing Region\n${tracePoints.length} point${tracePoints.length === 1 ? "" : "s"}`,
                fillColor: Cesium.Color.WHITE,
                style: Cesium.LabelStyle.FILL_AND_OUTLINE,
                outlineWidth: 2,
                verticalOrigin: Cesium.VerticalOrigin.BOTTOM,
                pixelOffset: new Cesium.Cartesian2(0, -18)
            }
        });
        return;
    }

    appState.traceDraftEntity.position = anchorPosition;
    appState.traceDraftEntity.polyline.positions = positions;
    appState.traceDraftEntity.label.text = `Tracing Region\n${tracePoints.length} point${tracePoints.length === 1 ? "" : "s"}`;

    if (hasPolygon) {
        const polygonPositions = tracePoints.map((point) => Cesium.Cartesian3.fromDegrees(point.lon, point.lat, 0));
        if (!appState.traceDraftEntity.polygon) {
            appState.traceDraftEntity.polygon = new Cesium.PolygonGraphics({
                hierarchy: polygonPositions,
                height: 0,
                material: areaFillColor,
                outline: true,
                outlineColor: areaOutlineColor
            });
        } else {
            appState.traceDraftEntity.polygon.hierarchy = polygonPositions;
        }
    } else if (appState.traceDraftEntity.polygon) {
        appState.traceDraftEntity.polygon = undefined;
    }
}

export function clearTraceDraftVisual() {
    if (appState.traceDraftEntity) {
        viewer.entities.remove(appState.traceDraftEntity);
        appState.traceDraftEntity = null;
    }
}

export function clearPathEntities() {
    for (const entity of appState.pathEntities) {
        viewer.entities.remove(entity);
    }
    appState.pathEntities = [];
}

export function clearDriftTracks() {
    if (appState.driftEntities) {
        for (const entity of appState.driftEntities) {
            viewer.entities.remove(entity);
        }
        appState.driftEntities = [];
    }
}

function transformEciToFixedAtSampleTime(eciPosition, sampleTime) {
    // Why: satellite.js propagates TEME states, so using an ICRF transform warps orbit geometry even when sampled per-point.
    const temeToFixed = Cesium.Transforms.computeTemeToPseudoFixedMatrix(sampleTime);
    if (!Cesium.defined(temeToFixed)) {
        return null;
    }

    return Cesium.Matrix3.multiplyByVector(temeToFixed, eciPosition, new Cesium.Cartesian3());
}

function transformEciToFixedAtCurrentTime(eciPosition, currentTime) {
    const temeToFixed = Cesium.Transforms.computeTemeToPseudoFixedMatrix(currentTime);
    if (!Cesium.defined(temeToFixed)) {
        return null;
    }

    return Cesium.Matrix3.multiplyByVector(temeToFixed, eciPosition, new Cesium.Cartesian3());
}

function offsetPositionHeight(position, altitudeOffsetMeters) {
    if (!altitudeOffsetMeters) {
        return position;
    }

    const cartographic = Cesium.Cartographic.fromCartesian(position);
    if (!cartographic) {
        return position;
    }

    return Cesium.Cartesian3.fromRadians(
        cartographic.longitude,
        cartographic.latitude,
        cartographic.height + altitudeOffsetMeters
    );
}

function buildPathPositionsProperty(samples, options = {}) {
    const scale = options.scale ?? 1;
    const altitudeOffsetMeters = options.altitudeOffsetMeters ?? 0;
    const renderFrame = options.renderFrame ?? "earthFixed";

    return new Cesium.CallbackProperty((time) => {
        const positions = [];

        samples.forEach((sample) => {
            if (Number.isFinite(sample.x) && Number.isFinite(sample.y) && Number.isFinite(sample.z)) {
                const eciPos = new Cesium.Cartesian3(sample.x * scale, sample.y * scale, sample.z * scale);
                const transformedPos = (renderFrame === "inertial") || (renderFrame === "toggleable" && appState.isInertialViewEnabled)
                    ? transformEciToFixedAtCurrentTime(eciPos, time)
                    : transformEciToFixedAtSampleTime(
                        eciPos,
                        sample.time ? Cesium.JulianDate.fromIso8601(sample.time) : time
                    );

                if (transformedPos) {
                    positions.push(offsetPositionHeight(transformedPos, altitudeOffsetMeters));
                }
                return;
            }

            if (Number.isFinite(sample.lat) && Number.isFinite(sample.lon)) {
                positions.push(
                    Cesium.Cartesian3.fromDegrees(
                        sample.lon,
                        sample.lat,
                        ((sample.altKm || 0) * 1000) + altitudeOffsetMeters
                    )
                );
            }
        });

        return positions;
    }, false);
}

export function clearConjunctionVisuals() {
    if (appState.conjunctionEntities) {
        appState.conjunctionEntities.forEach(e => viewer.entities.remove(e));
        appState.conjunctionEntities = [];
    }
}

export function drawConjunctionEvent(conj) {
    clearConjunctionVisuals();
    if (!appState.conjunctionEntities) appState.conjunctionEntities = [];

    const severityColors = {
        critical: Cesium.Color.RED,
        high: Cesium.Color.ORANGE,
        medium: Cesium.Color.YELLOW,
        informational: Cesium.Color.GREEN
    };
    const color = severityColors[conj.severity] || Cesium.Color.WHITE;

    const conjunctionId = `conj-${String(conj.primaryId)}-${String(conj.secondaryId)}-${conj.time}`.replace(/\s+/g, "_");

    // 1. Primary Trajectory
    const primaryEntity = viewer.entities.add({
        id: `${conjunctionId}-primary`,
        name: `${conj.primaryId} Approach`,
        polyline: {
            positions: buildPathPositionsProperty(conj.primaryPath),
            width: 4,
            material: new Cesium.PolylineGlowMaterialProperty({
                glowPower: 0.2,
                color: conj.primaryIsIndian ? Cesium.Color.CYAN : color
            }),
            arcType: Cesium.ArcType.NONE
        }
    });
    appState.conjunctionEntities.push(primaryEntity);

    // 2. Secondary Trajectory
    const secondaryEntity = viewer.entities.add({
        id: `${conjunctionId}-secondary`,
        name: `${conj.secondaryId} Approach`,
        polyline: {
            positions: buildPathPositionsProperty(conj.secondaryPath),
            width: 4,
            material: new Cesium.PolylineGlowMaterialProperty({
                glowPower: 0.2,
                color: conj.secondaryIsIndian ? Cesium.Color.CYAN : color
            }),
            arcType: Cesium.ArcType.NONE
        }
    });
    appState.conjunctionEntities.push(secondaryEntity);

    // 3. TCA Marker (at the closest point)
    const pPos = new Cesium.Cartesian3(conj.primaryPos.x * 1000, conj.primaryPos.y * 1000, conj.primaryPos.z * 1000);
    const sPos = new Cesium.Cartesian3(conj.secondaryPos.x * 1000, conj.secondaryPos.y * 1000, conj.secondaryPos.z * 1000);
    const midpoint = Cesium.Cartesian3.lerp(pPos, sPos, 0.5, new Cesium.Cartesian3());

    const tcaMarker = viewer.entities.add({
        id: `${conjunctionId}-tca`,
        position: midpoint,
        point: {
            pixelSize: 15,
            color: color,
            outlineColor: Cesium.Color.WHITE,
            outlineWidth: 2,
            disableDepthTestDistance: Number.POSITIVE_INFINITY
        },
        label: {
            text: `TCA EVENT: ${conj.severity.toUpperCase()}\nMiss Distance: ${formatNumber(conj.closestDistanceKm, 2)} km`,
            font: "bold 14px monospace",
            fillColor: color,
            outlineColor: Cesium.Color.BLACK,
            outlineWidth: 2,
            style: Cesium.LabelStyle.FILL_AND_OUTLINE,
            verticalOrigin: Cesium.VerticalOrigin.BOTTOM,
            pixelOffset: new Cesium.Cartesian2(0, -20),
            disableDepthTestDistance: Number.POSITIVE_INFINITY
        }
    });
    appState.conjunctionEntities.push(tcaMarker);

    // 4. Danger Sphere (radius = threshold or miss distance buffer)
    const sphereRadius = Math.max(10000, conj.closestDistanceKm * 1000 * 2);
    const dangerSphere = viewer.entities.add({
        id: `${conjunctionId}-sphere`,
        position: midpoint,
        ellipsoid: {
            radii: new Cesium.Cartesian3(sphereRadius, sphereRadius, sphereRadius),
            material: color.withAlpha(0.15),
            outline: true,
            outlineColor: color.withAlpha(0.5)
        }
    });
    appState.conjunctionEntities.push(dangerSphere);

    // 5. Line between objects at TCA
    const separationLine = viewer.entities.add({
        id: `${conjunctionId}-sep`,
        polyline: {
            positions: [pPos, sPos],
            width: 3,
            material: color,
            arcType: Cesium.ArcType.NONE
        }
    });
    appState.conjunctionEntities.push(separationLine);
}

export function clearProximityAlerts() {
    if (appState.proximityEntities) {
        appState.proximityEntities.forEach(e => viewer.entities.remove(e));
        appState.proximityEntities = [];
    }
}

export function drawProximityAlerts(alerts) {
    clearProximityAlerts();
    if (!appState.proximityEntities) appState.proximityEntities = [];

    alerts.forEach((alert, index) => {
        if (!alert.primaryPos || !alert.secondaryPos) return;

        const pPos = new Cesium.Cartesian3(alert.primaryPos.x * 1000, alert.primaryPos.y * 1000, alert.primaryPos.z * 1000);
        const sPos = new Cesium.Cartesian3(alert.secondaryPos.x * 1000, alert.secondaryPos.y * 1000, alert.secondaryPos.z * 1000);

        const color = alert.severity === "critical" ? Cesium.Color.RED : Cesium.Color.ORANGE;

        // Line between satellites
        const line = viewer.entities.add({
            polyline: {
                positions: [pPos, sPos],
                width: 2,
                material: new Cesium.PolylineDashMaterialProperty({
                    color: color.withAlpha(0.7),
                    dashLength: 8
                }),
                arcType: Cesium.ArcType.NONE
            }
        });
        appState.proximityEntities.push(line);

        // Marker at the point of proximity (midpoint for visual clarity)
        const midpoint = Cesium.Cartesian3.lerp(pPos, sPos, 0.5, new Cesium.Cartesian3());
        const marker = viewer.entities.add({
            position: midpoint,
            point: {
                pixelSize: 12,
                color: color,
                outlineColor: Cesium.Color.WHITE,
                outlineWidth: 2,
                disableDepthTestDistance: Number.POSITIVE_INFINITY
            },
            label: {
                text: `${alert.primaryId} ↔ ${alert.secondaryId}\n${formatNumber(alert.closestDistanceKm, 1)} km`,
                font: "12px monospace",
                fillColor: Cesium.Color.WHITE,
                outlineColor: Cesium.Color.BLACK,
                outlineWidth: 2,
                style: Cesium.LabelStyle.FILL_AND_OUTLINE,
                verticalOrigin: Cesium.VerticalOrigin.BOTTOM,
                pixelOffset: new Cesium.Cartesian2(0, -15),
                disableDepthTestDistance: Number.POSITIVE_INFINITY
            }
        });
        appState.proximityEntities.push(marker);
    });
}


export function drawDriftTracks(drift) {
    clearDriftTracks();

    if (!drift || !drift.tracks) return;

    // Sort tracks by dayOffset (oldest to latest)
    const sortedTracks = [...drift.tracks].sort((a, b) => a.dayOffset - b.dayOffset);
    const trackPositions = [];

    const altitudeStepMeters = 30000 * Math.max(1, appState.driftMagnification);

    sortedTracks.forEach((track, tIdx) => {
        if (!track.samples || track.samples.length < 2) return;
        const altitudeOffsetMeters = Math.abs(track.dayOffset) * altitudeStepMeters;
        const positionsProperty = buildPathPositionsProperty(track.samples, {
            altitudeOffsetMeters,
            renderFrame: "inertial"
        });
        const initialPositions = positionsProperty.getValue(viewer.clock.currentTime) || [];
        if (initialPositions.length < 2) return;
        trackPositions.push(positionsProperty);

        const baseColor = Cesium.Color.fromCssColorString(track.color || "#ffffff");
        const opacity = track.isCurrent ? 1.0 : Math.max(0.18, 0.58 - (0.1 * tIdx));
        const color = baseColor.withAlpha(opacity);

        // Render Orbit Ring
        const entity = viewer.entities.add({
            name: `Drift Ring Day ${track.dayOffset}`,
            polyline: {
                positions: positionsProperty,
                width: track.isCurrent ? 10 : 5,
                material: new Cesium.ColorMaterialProperty(color),
                clampToGround: false,
                arcType: Cesium.ArcType.NONE,
                zIndex: track.isCurrent ? 20 : (10 + track.dayOffset)
            }
        });
        appState.driftEntities.push(entity);

        // Epoch Marker
        const markerEntity = viewer.entities.add({
            position: new Cesium.CallbackProperty((time) => {
                const positions = positionsProperty.getValue(time) || [];
                return positions[0] || null;
            }, false),
            point: {
                pixelSize: track.isCurrent ? 18 : 10,
                color: color,
                outlineColor: Cesium.Color.BLACK,
                outlineWidth: 2,
                disableDepthTestDistance: Number.POSITIVE_INFINITY
            },
            label: {
                text: track.dayOffset === 0 ? "NOW" : `T-${track.dayOffset}D`,
                font: "bold 14px monospace",
                fillColor: Cesium.Color.WHITE,
                outlineColor: Cesium.Color.BLACK,
                outlineWidth: 3,
                style: Cesium.LabelStyle.FILL_AND_OUTLINE,
                pixelOffset: new Cesium.Cartesian2(0, -25),
                verticalOrigin: Cesium.VerticalOrigin.BOTTOM,
                disableDepthTestDistance: Number.POSITIVE_INFINITY
            }
        });
        appState.driftEntities.push(markerEntity);
    });

    // Render LONG Directional Drift Arrows between rings
    if (trackPositions.length > 1) {
        const samplesCount = trackPositions[0].getValue(viewer.clock.currentTime)?.length || 0;
        const arrowIndices = [0, Math.floor(samplesCount / 4), Math.floor(samplesCount / 2), Math.floor(3 * samplesCount / 4)];

        for (let i = 0; i < trackPositions.length - 1; i++) {
            const current = trackPositions[i];
            const next = trackPositions[i + 1];

            arrowIndices.forEach(idx => {
                const arrow = viewer.entities.add({
                    polyline: {
                        positions: new Cesium.CallbackProperty((time) => {
                            const currentPositions = current.getValue(time) || [];
                            const nextPositions = next.getValue(time) || [];
                            if (!currentPositions[idx] || !nextPositions[idx]) {
                                return [];
                            }
                            return [currentPositions[idx], nextPositions[idx]];
                        }, false),
                        width: 12,
                        material: new Cesium.PolylineArrowMaterialProperty(Cesium.Color.WHITE.withAlpha(0.7)),
                        arcType: Cesium.ArcType.NONE,
                        zIndex: 30
                    }
                });
                appState.driftEntities.push(arrow);
            });
        }
    }

    if (appState.driftEntities.length > 0) {
        appState.driftEntities.forEach(e => { e.show = true; });
    }
    viewer.scene.requestRender();
}

export function clearUctMarkers() {
    if (appState.uctEntities) {
        appState.uctEntities.forEach((entity) => viewer.entities.remove(entity));
    }
    appState.uctEntities = [];
    clearTrackingRegions();
}
export function clearTrackingRegions() {
    if (appState.trackingEntities) {
        appState.trackingEntities.forEach(e => viewer.entities.remove(e));
    }
    appState.trackingEntities = [];
    if (appState.uctPathEntity) {
        viewer.entities.remove(appState.uctPathEntity);
        appState.uctPathEntity = null;
    }
}

/**
 * Draw UCT predicted orbit path.
 */
export function drawUctPredictedPath(satellite) {
    if (!satellite.line1 || !satellite.line2) return;

    try {
        const satrec = satellite.twoline2satrec ? satellite : satellite.line1 && satellite.line2 ? satellite : null; // Handle both record formats
        const record = {
            id: satellite.name,
            satrec: satellite.satrec || satellite.line1 && satellite.line2 ? satellite.jsatrec || satellite.satrec || (typeof satellite.line1 === 'string' ? satellite.twoline2satrec?.(satellite.line1, satellite.line2) : null) : null
        };

        // If it's a raw satellite object from API
        if (!record.satrec && satellite.line1 && satellite.line2) {
            record.satrec = satellite.jsatrec || (window.satellite ? window.satellite.twoline2satrec(satellite.line1, satellite.line2) : null);
        }

        if (!record.satrec) return;

        const now = viewer.clock.currentTime;
        const startDate = Cesium.JulianDate.toDate(now);
        const endDate = new Date(startDate.getTime() + 90 * 60 * 1000);

        const samples = [];
        const step = 60; // 1 min steps
        for (let t = 0; t <= 5400; t += step) {
            const date = new Date(startDate.getTime() + t * 1000);
            const pva = window.satellite.propagate(record.satrec, date);
            if (pva.position) {
                const gmst = window.satellite.gstime(date);
                const itrf = window.satellite.eciToGeodetic(pva.position, gmst);
                samples.push(Cesium.Cartesian3.fromRadians(itrf.longitude, itrf.latitude, itrf.height));
            }
        }

        appState.uctPathEntity = viewer.entities.add({
            name: `${satellite.name} Predicted Path`,
            polyline: {
                positions: samples,
                width: 2,
                material: new Cesium.PolylineDashMaterialProperty({
                    color: Cesium.Color.RED.withAlpha(0.6),
                    dashLength: 12
                }),
                arcType: Cesium.ArcType.NONE
            }
        });
    } catch (e) {
        console.warn("UCT Path Prediction Error:", e);
    }
}

/**
 * Draw sensor tracking region and predicted pass geometry on the globe.
 */
export function drawTrackingRegion(satellite, recommendation) {
    clearTrackingRegions();
    if (!appState.trackingEntities) appState.trackingEntities = [];

    // Visualize UCT Path too
    drawUctPredictedPath(satellite);

    const sensorPos = Cesium.Cartesian3.fromDegrees(77.6, 13.0, 0); // Mock sensor: Bengaluru
    const satPos = appState.pointMap.get(satellite.name)?.position;

    if (!satPos) return;

    // 1. Draw Sensor Observation Cone (Simplified as line for POC)
    const cone = viewer.entities.add({
        polyline: {
            positions: new Cesium.CallbackProperty(() => {
                const currentSatPos = appState.pointMap.get(satellite.name)?.position;
                return currentSatPos ? [sensorPos, currentSatPos] : [];
            }, false),
            width: 2,
            material: new Cesium.PolylineDashMaterialProperty({
                color: Cesium.Color.YELLOW.withAlpha(0.4),
                dashLength: 8
            }),
            arcType: Cesium.ArcType.NONE
        }
    });
    appState.trackingEntities.push(cone);

    // 2. Add Sensor Station Marker
    const sensorMarker = viewer.entities.add({
        position: sensorPos,
        point: {
            pixelSize: 10,
            color: Cesium.Color.CYAN,
            outlineColor: Cesium.Color.WHITE,
            outlineWidth: 2
        },
        label: {
            text: `ACTIVE SENSOR: ${recommendation.sensorName}\nTASKED FOR: ${satellite.name}`,
            font: "10px monospace",
            fillColor: Cesium.Color.CYAN,
            outlineColor: Cesium.Color.BLACK,
            outlineWidth: 2,
            style: Cesium.LabelStyle.FILL_AND_OUTLINE,
            verticalOrigin: Cesium.VerticalOrigin.BOTTOM,
            pixelOffset: new Cesium.Cartesian2(0, -15)
        }
    });
    appState.trackingEntities.push(sensorMarker);

    // 3. Highlight the observation region on ground
    const region = viewer.entities.add({
        position: sensorPos,
        ellipse: {
            semiMinorAxis: 500000,
            semiMajorAxis: 500000,
            material: Cesium.Color.CYAN.withAlpha(0.1),
            outline: true,
            outlineColor: Cesium.Color.CYAN,
            outlineWidth: 1,
            height: 0
        }
    });
    appState.trackingEntities.push(region);
}

window.drawTrackingRegion = drawTrackingRegion;
window.clearTrackingRegions = clearTrackingRegions;

export function drawUctMarkers(ucts) {
    clearUctMarkers();
    if (!appState.uctEntities) appState.uctEntities = [];

    ucts.forEach((uct) => {
        let positionProperty;
        const existingPoint = appState.pointMap.get(uct.name);

        if (existingPoint) {
            positionProperty = new Cesium.CallbackProperty(() => existingPoint.position, false);
        } else if (uct.line1 && uct.line2) {
            try {
                const satrec = satellite.twoline2satrec(uct.line1, uct.line2);
                positionProperty = new Cesium.CallbackProperty((time) => {
                    const date = Cesium.JulianDate.toDate(time);
                    const pva = satellite.propagate(satrec, date);
                    if (!pva.position) return null;
                    const gmst = satellite.gstime(date);
                    const itrf = satellite.eciToGeodetic(pva.position, gmst);
                    return Cesium.Cartesian3.fromRadians(itrf.longitude, itrf.latitude, itrf.height);
                }, false);
            } catch (e) {
                console.warn(`Failed to propagate UCT ${uct.name}:`, e);
                return;
            }
        }

        if (!positionProperty) return;

        // Blinking color logic
        const colorProperty = new Cesium.CallbackProperty((time) => {
            const seconds = time.secondsOfDay;
            const blink = Math.floor(seconds * 2) % 2 === 0;
            return blink ? Cesium.Color.RED : Cesium.Color.ORANGE;
        }, false);

        const entity = viewer.entities.add({
            id: `uct-${uct.name}`,
            position: positionProperty,
            point: {
                pixelSize: 15,
                color: colorProperty,
                outlineColor: Cesium.Color.WHITE,
                outlineWidth: 2,
                disableDepthTestDistance: Number.POSITIVE_INFINITY
            },
            label: {
                text: "UNKNOWN",
                font: "bold 12px monospace",
                fillColor: colorProperty,
                outlineColor: Cesium.Color.BLACK,
                outlineWidth: 2,
                style: Cesium.LabelStyle.FILL_AND_OUTLINE,
                verticalOrigin: Cesium.VerticalOrigin.BOTTOM,
                pixelOffset: new Cesium.Cartesian2(0, -15),
                disableDepthTestDistance: Number.POSITIVE_INFINITY
            },
            // Uncertainty Ring (Proposal Requirement)
            ellipse: {
                semiMinorAxis: 150000, // 150km uncertainty
                semiMajorAxis: 150000,
                material: Cesium.Color.ORANGE.withAlpha(0.2),
                outline: true,
                outlineColor: Cesium.Color.RED,
                outlineWidth: 2,
                height: 0,
                classificationType: Cesium.ClassificationType.TERRAIN
            }
        });
        appState.uctEntities.push(entity);
    });
}

export function enterFocusedAnalysisMode(satelliteId) {
    console.log(`[FocusMode] Entering focus mode for: ${satelliteId}`);

    if (viewer.scene.mode !== Cesium.SceneMode.SCENE3D) {
        viewer.scene.mode = Cesium.SceneMode.SCENE3D;
    }

    viewer.scene.screenSpaceCameraController.enableTilt = true;
    viewer.scene.screenSpaceCameraController.enableLook = true;

    appState.isFocusMode = true;
    appState.focusedSatelliteId = satelliteId;
    appState.savedVisibilityState.clear();

    // 1. Hide points
    for (let i = 0; i < satellitePoints.length; i++) {
        const point = satellitePoints.get(i);
        appState.savedVisibilityState.set(`point:${point.id}`, point.show);
        point.show = (point.id === satelliteId);
    }

    // 2. Hide entities safely
    // We use a small delay or ensure this runs BEFORE drawDriftTracks
    viewer.entities.values.forEach(entity => {
        // If the entity is already a drift entity, don't hide it
        if (appState.driftEntities && appState.driftEntities.includes(entity)) {
            entity.show = true;
            return;
        }

        // If it's an active path, keep it
        if (appState.pathEntities && appState.pathEntities.includes(entity)) {
            entity.show = true;
            return;
        }

        appState.savedVisibilityState.set(`entity:${entity.id}`, entity.show);
        entity.show = false;
    });

    setStatus(`Focused on ${satelliteId}.`);
}

export function exitFocusedAnalysisMode() {
    console.log("[FocusMode] Exiting focus mode. Restoring catalog visibility.");
    appState.isFocusMode = false;
    appState.focusedSatelliteId = null;

    const driftCount = appState.driftEntities ? appState.driftEntities.length : 0;
    clearDriftTracks();
    console.log(`[FocusMode] Cleaned up ${driftCount} drift tracks.`);

    // 1. Restore satellite points visibility
    let restoredPoints = 0;
    for (let i = 0; i < satellitePoints.length; i++) {
        const point = satellitePoints.get(i);
        const groupLabel = deriveSatelliteGroupLabel(point.id);
        const isGroupHidden = appState.hiddenGroupLabels.has(groupLabel);
        const isCommercialHidden = appState.hideCommercialSatellites && isCommercialSatelliteName(point.id);

        const saved = appState.savedVisibilityState.get(`point:${point.id}`);
        if (saved !== undefined) {
            // Restore saved state, but still respect global hidden groups and commercial filter
            point.show = (isGroupHidden || isCommercialHidden) ? false : saved;
            if (point.show) restoredPoints++;
        } else {
            // Default restore, respecting global filters
            point.show = !isGroupHidden && !isCommercialHidden;
            if (point.show) restoredPoints++;
        }
    }
    console.log(`[FocusMode] Restored ${restoredPoints} catalog points.`);

    // 2. Restore other entities visibility
    let restoredEntities = 0;
    viewer.entities.values.forEach(entity => {
        const saved = appState.savedVisibilityState.get(`entity:${entity.id}`);
        if (saved !== undefined) {
            entity.show = saved;
            if (saved) restoredEntities++;
        }
    });
    console.log(`[FocusMode] Restored ${restoredEntities} scene entities.`);

    appState.savedVisibilityState.clear();
    setStatus("Exited Focused Analysis Mode. Full catalog restored.");

    // Optional: Return camera to a more global perspective on exit
    viewer.camera.flyTo({
        destination: Cesium.Cartesian3.fromDegrees(78.9629, 20.5937, 20000000),
        duration: 1.5
    });
}

export function setInertialView(enabled) {
    appState.isInertialViewEnabled = true;
    viewer.scene.skyBox.show = true;
    viewer.scene.skyAtmosphere.show = true;
    setStatus("Orbit view locked to inertial tracking mode.");
}

// Why: keep user camera controls smooth; orbit geometry already updates in the chosen frame without forcing the camera transform every frame.
viewer.scene.postRender.addEventListener(() => {
    return;
});

export function drawPredictedPaths(paths) {
    clearPathEntities();

    const fallbackColors = ["#ffd166", "#ff5ea8", "#8f7dff"];
    const centeredOffsetIndex = (paths.length - 1) / 2;

    paths.forEach((path, index) => {
        if (!Array.isArray(path.samples) || path.samples.length < 2) {
            return;
        }

        const baseColor = Cesium.Color.fromCssColorString(path.color || fallbackColors[index % fallbackColors.length]);

        let material;
        if (path.style === "dotted") {
            material = new Cesium.PolylineDashMaterialProperty({
                color: baseColor.withAlpha(0.6),
                dashLength: 12
            });
        } else {
            material = new Cesium.ColorMaterialProperty(baseColor);
        }

        const entity = viewer.entities.add({
            polyline: {
                // Why: a slight altitude separation makes old-vs-new orbit comparisons readable without changing the underlying shape.
                positions: buildPathPositionsProperty(path.samples, {
                    altitudeOffsetMeters: (index - centeredOffsetIndex) * 18000,
                    renderFrame: path.renderFrame || "earthFixed"
                }),
                width: path.width || 2.5,
                material: material,
                clampToGround: false,
                arcType: Cesium.ArcType.NONE
            }
        });

        appState.pathEntities.push(entity);
    });
}

export function clearReentrySimulation() {
    if (appState.reentryEntities) {
        appState.reentryEntities.forEach(e => viewer.entities.remove(e));
        appState.reentryEntities = [];
    }
}

export function drawReentrySimulation(data) {
    clearReentrySimulation();
    if (!data) return;

    const { impactCorridor, strategicRisks, satelliteName } = data;

    // 1. Draw Impact Corridor (Shaded ground strip)
    if (impactCorridor && impactCorridor.length > 1) {
        const positions = impactCorridor.map(p => Cesium.Cartesian3.fromDegrees(p.lon, p.lat, 0));

        const corridor = viewer.entities.add({
            name: "Impact Corridor",
            polyline: {
                positions: positions,
                width: 40,
                material: new Cesium.PolylineDashMaterialProperty({
                    color: Cesium.Color.RED.withAlpha(0.4),
                    dashLength: 16
                }),
                clampToGround: true
            }
        });
        appState.reentryEntities.push(corridor);

        // Add a glow/outline to the corridor
        const outline = viewer.entities.add({
            polyline: {
                positions: positions,
                width: 2,
                material: Cesium.Color.RED,
                clampToGround: true
            }
        });
        appState.reentryEntities.push(outline);
    }

    // 2. Highlight Strategic Installations if at risk
    if (strategicRisks && strategicRisks.length > 0) {
        // We assume STRATEGIC_SITES matches what's in blindSpotDetection.js
        const STRATEGIC_SITES = [
            { name: "Pokhran Test Range", lat: 27.095, lon: 71.753 },
            { name: "Sriharikota", lat: 13.720, lon: 80.230 },
            { name: "Andaman & Nicobar", lat: 11.740, lon: 92.658 },
            { name: "New Delhi", lat: 28.613, lon: 77.209 },
            { name: "Karachi", lat: 24.860, lon: 67.001 },
            { name: "Sri Lanka", lat: 7.873, lon: 80.771 },
            { name: "Indian Ocean (Central)", lat: -5.0, lon: 80.0 }
        ];

        strategicRisks.forEach(risk => {
            const site = STRATEGIC_SITES.find(s => s.name === risk.name);
            if (site) {
                const entity = viewer.entities.add({
                    position: Cesium.Cartesian3.fromDegrees(site.lon, site.lat, 0),
                    point: {
                        pixelSize: 15,
                        color: Cesium.Color.RED,
                        outlineColor: Cesium.Color.WHITE,
                        outlineWidth: 3,
                        disableDepthTestDistance: Number.POSITIVE_INFINITY
                    },
                    label: {
                        text: `STRATEGIC RISK: ${site.name}\n${formatNumber(risk.distanceKm, 1)} km from impact zone`,
                        font: "bold 14px monospace",
                        fillColor: Cesium.Color.RED,
                        outlineColor: Cesium.Color.WHITE,
                        outlineWidth: 2,
                        style: Cesium.LabelStyle.FILL_AND_OUTLINE,
                        pixelOffset: new Cesium.Cartesian2(0, -30),
                        verticalOrigin: Cesium.VerticalOrigin.BOTTOM,
                        disableDepthTestDistance: Number.POSITIVE_INFINITY
                    }
                });
                appState.reentryEntities.push(entity);

                // Pulsing circle around the site
                const circle = viewer.entities.add({
                    position: Cesium.Cartesian3.fromDegrees(site.lon, site.lat, 0),
                    ellipse: {
                        semiMinorAxis: 200000,
                        semiMajorAxis: 200000,
                        material: Cesium.Color.RED.withAlpha(0.2),
                        outline: true,
                        outlineColor: Cesium.Color.RED,
                        height: 0
                    }
                });
                appState.reentryEntities.push(circle);
            }
        });
    }

    // 3. Spiral Decay (using impact corridor as proxy for final spiral)
    if (impactCorridor && impactCorridor.length > 1) {
        const spiralPositions = impactCorridor.map(p => Cesium.Cartesian3.fromDegrees(p.lon, p.lat, p.alt * 1000));
        const spiral = viewer.entities.add({
            name: "Spiral Decay Path",
            polyline: {
                positions: spiralPositions,
                width: 4,
                material: new Cesium.ColorMaterialProperty(Cesium.Color.ORANGE.withAlpha(0.8)),
                arcType: Cesium.ArcType.NONE
            }
        });
        appState.reentryEntities.push(spiral);
    }
}

export function drawRapidTrack(track) {
    if (!track || !track.trajectory) return;

    const color = track.threatLevel === "CRITICAL" ? Cesium.Color.RED :
                  track.threatLevel === "WARNING" ? Cesium.Color.ORANGE :
                  track.type === "Meteor" ? Cesium.Color.CYAN : Cesium.Color.WHITE;

    const positions = track.trajectory.map(p => Cesium.Cartesian3.fromDegrees(p.lon, p.lat, p.altKm * 1000));

    // Draw Trajectory
    const entity = viewer.entities.add({
        name: `${track.type}: ${track.id}`,
        polyline: {
            positions: positions,
            width: 3,
            material: new Cesium.PolylineGlowMaterialProperty({
                glowPower: 0.2,
                color: color
            }),
            arcType: Cesium.ArcType.NONE
        },
        label: {
            text: `${track.type}\nStatus: ${track.threatLevel}`,
            font: "12px monospace",
            fillColor: color,
            outlineColor: Cesium.Color.BLACK,
            outlineWidth: 2,
            style: Cesium.LabelStyle.FILL_AND_OUTLINE,
            verticalOrigin: Cesium.VerticalOrigin.BOTTOM,
            pixelOffset: new Cesium.Cartesian2(0, -15),
            disableDepthTestDistance: Number.POSITIVE_INFINITY
        }
    });

    // If impact point predicted, show it
    if (track.impactPoint) {
        viewer.entities.add({
            position: Cesium.Cartesian3.fromDegrees(track.impactPoint.lon, track.impactPoint.lat, 0),
            point: {
                pixelSize: 10,
                color: color,
                outlineColor: Cesium.Color.WHITE,
                outlineWidth: 2
            },
            ellipse: {
                semiMinorAxis: 50000,
                semiMajorAxis: 50000,
                material: color.withAlpha(0.2),
                outline: true,
                outlineColor: color
            }
        });
    }

    return entity;
}

export function clearRapidTracks() {
    // Basic cleanup - in a real app we'd track these in an array
    viewer.entities.values.filter(e => e.name && (e.name.includes("Ballistic") || e.name.includes("Hypersonic") || e.name.includes("Meteor"))).forEach(e => viewer.entities.remove(e));
}

export function clearRegionalAccessVisuals() {
    if (appState.regionalAccessEntities) {
        appState.regionalAccessEntities.forEach(e => viewer.entities.remove(e));
        appState.regionalAccessEntities = [];
    }
}

export function renderOperationalSwath(satelliteId, profile, time) {
    const point = appState.pointMap.get(satelliteId);
    if (!point || !point.position) return null;

    const cartographic = Cesium.Cartographic.fromCartesian(point.position);
    const altitudeKm = cartographic.height / 1000;
    
    // We assume the satellite is looking at its nadir for the swath visualization
    // In a real SDA system, this would use actual sensor pointing.
    const radiusKm = computeOperationalRadiusKm({
        profile,
        geometricRadiusKm: altitudeKm * Math.tan(Cesium.Math.toRadians(profile.maxOffNadirDeg || 30)),
        coverageStrength: 1.0 // Idealised swath at nadir
    });

    return {
        position: point.position,
        radius: radiusKm * 1000
    };
}

export function drawRegionalAccessIntelligence(details) {
    clearRegionalAccessVisuals();
    if (!appState.regionalAccessEntities) appState.regionalAccessEntities = [];

    const severityColors = {
        high: Cesium.Color.RED,
        medium: Cesium.Color.ORANGE,
        low: Cesium.Color.YELLOW
    };
    const mainColor = severityColors[details.operationalSeverity] || Cesium.Color.CYAN;

    // 1. Old vs New Orbit Comparison
    drawPredictedPaths([
        { ...details.oldOrbit, width: 3, style: "dotted" },
        { ...details.newOrbit, width: 5, color: mainColor.toCssColorString() }
    ]);
    // Note: drawPredictedPaths adds to appState.pathEntities, which is fine, 
    // but we might want them in regionalAccessEntities for combined cleanup.
    appState.regionalAccessEntities.push(...appState.pathEntities);

    // 2. Recent Pass Arc
    if (details.latestPassTrack && details.latestPassTrack.length > 1) {
        const arcEntity = viewer.entities.add({
            name: "Recent Regional Pass Arc",
            polyline: {
                positions: buildPathPositionsProperty(details.latestPassTrack),
                width: 8,
                material: new Cesium.PolylineGlowMaterialProperty({
                    glowPower: 0.3,
                    color: mainColor
                }),
                arcType: Cesium.ArcType.NONE,
                zIndex: 50
            }
        });
        appState.regionalAccessEntities.push(arcEntity);
    }

    // 3. First Access Marker
    if (details.firstDetectedAccess) {
        const firstAccessDate = Cesium.JulianDate.fromIso8601(details.firstDetectedAccess);
        // Find the sample in newOrbit that is closest to firstDetectedAccess time
        let closestSample = details.newOrbit.samples[0];
        if (details.newOrbit.samples.length > 1) {
            const targetMs = new Date(details.firstDetectedAccess).getTime();
            let minDiff = Infinity;
            for (const s of details.newOrbit.samples) {
                if (s.time) {
                    const diff = Math.abs(new Date(s.time).getTime() - targetMs);
                    if (diff < minDiff) {
                        minDiff = diff;
                        closestSample = s;
                    }
                }
            }
        }

        const firstAccessPos = (closestSample && closestSample.lat !== undefined) 
            ? Cesium.Cartesian3.fromDegrees(closestSample.lon, closestSample.lat, (closestSample.altKm || 400) * 1000) 
            : (closestSample ? new Cesium.Cartesian3(closestSample.x * 1000, closestSample.y * 1000, closestSample.z * 1000) : null);

        if (firstAccessPos) {
            const marker = viewer.entities.add({
                position: firstAccessPos,
                point: {
                    pixelSize: 12,
                    color: Cesium.Color.WHITE,
                    outlineColor: mainColor,
                    outlineWidth: 3
                },
                label: {
                    text: `FIRST ACCESS: ${new Date(details.firstDetectedAccess).toLocaleDateString()}`,
                    font: "bold 12px monospace",
                    fillColor: Cesium.Color.WHITE,
                    outlineColor: Cesium.Color.BLACK,
                    outlineWidth: 2,
                    style: Cesium.LabelStyle.FILL_AND_OUTLINE,
                    verticalOrigin: Cesium.VerticalOrigin.BOTTOM,
                    pixelOffset: new Cesium.Cartesian2(0, -20)
                }
            });
            appState.regionalAccessEntities.push(marker);
        }
    }

    // 4. Dynamic Operational Swath (attached to satellite)
    const profile = details.sensorProfile;
    const swathEntity = viewer.entities.add({
        name: "Operational Observation Swath",
        position: new Cesium.CallbackProperty(() => {
            const point = appState.pointMap.get(details.satelliteName);
            return point ? point.position : null;
        }, false),
        ellipse: {
            semiMinorAxis: new Cesium.CallbackProperty(() => {
                const swath = renderOperationalSwath(details.satelliteName, profile, viewer.clock.currentTime);
                return swath ? swath.radius : 1000;
            }, false),
            semiMajorAxis: new Cesium.CallbackProperty(() => {
                const swath = renderOperationalSwath(details.satelliteName, profile, viewer.clock.currentTime);
                return swath ? swath.radius : 1000;
            }, false),
            material: mainColor.withAlpha(0.2),
            outline: true,
            outlineColor: mainColor,
            height: 0
        }
    });
    appState.regionalAccessEntities.push(swathEntity);

    // 5. Visibility Corridor (Cone from satellite to region centroid)
    const corridor = viewer.entities.add({
        name: "Visibility Corridor",
        polyline: {
            positions: new Cesium.CallbackProperty(() => {
                const satPoint = appState.pointMap.get(details.satelliteName);
                if (!satPoint || !satPoint.position) return [];
                const regionPos = Cesium.Cartesian3.fromDegrees(details.region.centroid.lon, details.region.centroid.lat, 0);
                return [satPoint.position, regionPos];
            }, false),
            width: 2,
            material: new Cesium.PolylineDashMaterialProperty({
                color: mainColor.withAlpha(0.4),
                dashLength: 10
            }),
            arcType: Cesium.ArcType.NONE
        }
    });
    appState.regionalAccessEntities.push(corridor);

    setStatus(`Visualizing orbital intelligence for ${details.satelliteName} over ${details.region.name}.`);
}

