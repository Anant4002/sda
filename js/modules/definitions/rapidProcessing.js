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
            <div style="display: grid; grid-template-columns: 1fr 1px 1fr; gap: 8px;">
                <button id="simMissileButton" class="danger btn-sm">Sim Orbital Event</button>
                <div style="background: rgba(255,255,255,0.1);"></div>
                <button id="simUnknownButton" class="warning btn-sm">Sim Unknown Track</button>
            </div>
            <button id="simMeteorButton" class="secondary btn-sm" style="width:100%; margin-top: 8px;">Sim Debris Track</button>
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
                            track.threatLevel === "WARNING" ? "warning" : "success";
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
            
            // Base starting point near borders
            const startLat = 30 + (Math.random() * 5);
            const startLon = 60 + (Math.random() * 10);
            
            const points = [];
            const now = Date.now();
            
            for (let i = 0; i < 5; i++) {
                points.push({
                    x: (startLon + i * 0.1) * 100, // Mock ECI
                    y: (startLat + i * 0.1) * 100,
                    z: (150 - i * 5) * 100,
                    altKm: type === "Debris Track" ? 200 - i * 10 : 80 - i * 2,
                    lat: startLat + i * 0.1,
                    lon: startLon + i * 0.1,
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

        scope.add(document.getElementById("simMissileButton"), "click", () => injectSimulatedTrack("Orbital Event"));
        scope.add(document.getElementById("simUnknownButton"), "click", () => injectSimulatedTrack("Unknown Track"));
        scope.add(document.getElementById("simMeteorButton"), "click", () => injectSimulatedTrack("Debris Track"));
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

