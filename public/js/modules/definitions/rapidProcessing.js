import { setStatus } from "../../ui.js";
import { escapeHtml, formatDateTime } from "../../utils.js";
import { ListenerScope } from "../../ui/panelSystem.js";
import { ingestRapidTrack, fetchRapidTracks } from "../../rapidService.js";
import { drawRapidTrack, clearRapidTracks } from "../../viewer.js";

function buildSidebar() {
    return `
        <div class="section">
            <div class="section-title">Rapid Orbital Threat Processing</div>
            <div class="micro-card">
                Fast ingestion and classification of unidentified orbital events, debris tracks, and fast-moving threats from direct sensor data.
            </div>
        </div>
        <div class="section">
            <div class="section-title">Live Sensor Simulation</div>
            <div class="micro-card" style="margin-bottom: 8px;">
                Inject simulated orbital tracks to test trajectory fitting and threat classification.
            </div>
            <div style="display: flex; flex-direction: column; gap: 8px;">
                <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 8px;">
                    <button id="simMissileButton" class="danger btn-sm" style="font-size: 11px;">Sim Missile</button>
                    <button id="simHGVButton" class="danger btn-sm" style="font-size: 11px;">Sim Hypersonic HGV</button>
                </div>
                <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 8px;">
                    <button id="simDebrisButton" class="warning btn-sm" style="font-size: 11px;">Sim Debris</button>
                    <button id="simMeteorButton" class="secondary btn-sm" style="font-size: 11px;">Sim Meteor</button>
                </div>
                <button id="simOrbitalButton" class="info btn-sm" style="width: 100%; font-size: 11px;">Sim Orbital Object</button>
            </div>
        </div>
        <div class="section">
            <div class="section-title">Active Rapid Tracks</div>
            <div id="rapidTrackList" class="list" style="max-height: 300px; overflow-y: auto;">
                <div class="hint">No active tracks.</div>
            </div>
            <button id="clearTracksButton" class="secondary" style="margin-top:8px; width:100%;">Clear Globe</button>
        </div>
    `;
}

function renderTrackList(tracks, container) {
    if (!tracks || !tracks.length) {
        container.innerHTML = '<div class="hint">No active tracks.</div>';
        return;
    }

    container.innerHTML = tracks.map(track => {
        const threatClass = track.threatLevel === "CRITICAL" ? "danger" : 
                            track.threatLevel === "WARNING" ? "warning" : 
                            track.threatLevel === "NON-THREAT" ? "success" : "info";
        return `
            <div class="list-item ${threatClass}" style="line-height: 1.4;">
                <strong>${escapeHtml(track.type)}</strong><br>
                <small>Confidence: ${(track.confidence * 100).toFixed(0)}% | Status: ${track.threatLevel}</small><br>
                <div style="font-size: 0.8em; margin-top: 4px; opacity: 0.8;">
                    ${escapeHtml(track.threatMessage)}
                </div>
            </div>
        `;
    }).join("");
}

export default {
    id: "rapid-processing",
    label: "Rapid Orbital Threat Processing",
    eyebrow: "Orbital Threat Ingestion",
    description: "Low-latency trajectory fitting and classification for unidentified orbital events, debris, and re-entry objects.",
    dockEyebrow: "Threat",
    dockLabel: "Rapid Threats",
    status: "ready",
    mount(ctx) {
        const root = ctx.containers.sidebarRoot;
        root.innerHTML = buildSidebar();

        const trackList = document.getElementById("rapidTrackList");
        const scope = new ListenerScope();

        const refreshTracks = async () => {
            try {
                const tracks = await fetchRapidTracks();
                renderTrackList(tracks, trackList);
            } catch (err) {
                console.error("Failed to fetch rapid tracks", err);
            }
        };

        const injectSimulatedTrack = async (type) => {
            setStatus(`Simulating ${type}...`);
            
            // Trajectory starting point positioned to fly northeast across the Indian mainland (from Arabian Sea to Centroid)
            const startLat = 10 + (Math.random() * 2);
            const startLon = 68 + (Math.random() * 2);
            
            const points = [];
            const now = Date.now();

            let velocity = 7.5; // km/s
            let altitude = 120; // km
            if (type === "Ballistic Missile") {
                velocity = 4.0;
                altitude = 80;
            } else if (type === "Hypersonic Glide Vehicle") {
                velocity = 7.5;
                altitude = 75;
            } else if (type === "Orbital Object") {
                velocity = 7.8;
                altitude = 350;
            } else if (type === "Meteor") {
                velocity = 16.0;
                altitude = 90;
            } else if (type === "Satellite Debris") {
                velocity = 7.2;
                altitude = 120;
            }

            const dxPerSec = velocity * 0.707;
            const dyPerSec = velocity * 0.707;
            const dzPerSec = 0.0; 
            
            for (let i = 0; i < 5; i++) {
                points.push({
                    x: (startLon * 100) + (i * dxPerSec), // Mock ECI (with correct velocity scale)
                    y: (startLat * 100) + (i * dyPerSec),
                    z: (150 * 100) + (i * dzPerSec),
                    altKm: altitude - (i * 0.5),
                    lat: startLat + (i * 0.02 * velocity), 
                    lon: startLon + (i * 0.02 * velocity),
                    time: new Date(now + i * 1000).toISOString()
                });
            }

            try {
                const result = await ingestRapidTrack({ points, sensorId: "RADAR-NORTH-01" });
                drawRapidTrack(result);
                await refreshTracks();
                setStatus(`Alert: ${result.type} detected. Threat Level: ${result.threatLevel}`);
                await ctx.shared.refreshOperationalAlerts();
            } catch (err) {
                setStatus("Failed to inject track.");
            }
        };

        scope.add(document.getElementById("simMissileButton"), "click", () => injectSimulatedTrack("Ballistic Missile"));
        scope.add(document.getElementById("simHGVButton"), "click", () => injectSimulatedTrack("Hypersonic Glide Vehicle"));
        scope.add(document.getElementById("simDebrisButton"), "click", () => injectSimulatedTrack("Satellite Debris"));
        scope.add(document.getElementById("simMeteorButton"), "click", () => injectSimulatedTrack("Meteor"));
        scope.add(document.getElementById("simOrbitalButton"), "click", () => injectSimulatedTrack("Orbital Object"));
        
        scope.add(document.getElementById("clearTracksButton"), "click", () => {
            clearRapidTracks();
            setStatus("Globe cleared of rapid tracks.");
        });

        refreshTracks();
        setStatus("Rapid Orbital Threat Processing module ready.");

        return {
            unmount() {
                scope.dispose();
            }
        };
    }
};
