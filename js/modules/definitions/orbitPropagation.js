import { appState } from "../../state.js";
import { renderDefaultAnalysis, setStatus } from "../../ui.js";
import { ListenerScope } from "../../ui/panelSystem.js";
import { eventBus, events } from "../eventBus.js";
import { escapeHtml } from "../../utils.js";

// Helper to load/save friendly list
function loadFriendlySatellites() {
    try {
        const val = window.localStorage.getItem("sda_friendly_satellites");
        if (val) {
            return JSON.parse(val);
        }
    } catch (e) {
        console.warn("Failed to load friendly satellites.", e);
    }
    return ["GPS", "NOAA", "USA", "GOES", "LANDSAT"]; // Defaults
}

function saveFriendlySatellites(list) {
    try {
        window.localStorage.setItem("sda_friendly_satellites", JSON.stringify(list));
    } catch (e) {
        console.warn("Failed to save friendly satellites.", e);
    }
}

function buildSidebar() {
    return `
        <div class="section">
            <div class="section-title">Satellite Quick Search</div>
            <div class="field" style="position: relative;">
                <input id="orbitSearchInput" class="search-input" type="search" placeholder="Type satellite name or NORAD ID...">
                <div id="orbitSearchSpinner" class="is-hidden" style="position: absolute; right: 12px; top: 12px; border: 2px solid rgba(111, 226, 255, 0.1); border-left-color: var(--accent); border-radius: 50%; width: 16px; height: 16px; animation: spin 1s linear infinite;"></div>
            </div>
            <div id="orbitSearchResultList" class="sat-list" style="max-height: 160px; overflow-y: auto; margin-top: 8px;"></div>
        </div>

        <div class="section">
            <div class="section-title">Country-Wise Filters</div>
            <div style="display: flex; flex-direction: column; gap: 8px; margin-bottom: 12px;">
                <label style="display:flex; align-items:center; gap:8px; cursor:pointer; color:var(--text-main); font-weight:normal; text-transform:none; font-size:13px;">
                    <input type="radio" name="countryFilter" value="all" checked>
                    All Satellites
                </label>
                <label style="display:flex; align-items:center; gap:8px; cursor:pointer; color:var(--text-main); font-weight:normal; text-transform:none; font-size:13px;">
                    <input type="radio" name="countryFilter" value="indian">
                    Indian Satellites
                </label>
                <label style="display:flex; align-items:center; gap:8px; cursor:pointer; color:var(--text-main); font-weight:normal; text-transform:none; font-size:13px;">
                    <input type="radio" name="countryFilter" value="friendly">
                    Friendly Satellites
                </label>
                <label style="display:flex; align-items:center; gap:8px; cursor:pointer; color:var(--text-main); font-weight:normal; text-transform:none; font-size:13px;">
                    <input type="radio" name="countryFilter" value="adversary">
                    Adversary Satellites
                </label>
            </div>
        </div>

        <div class="section" id="friendlyConfigSection" style="display: none;">
            <div class="section-title">Configure Friendly Satellites</div>
            <textarea id="friendlyListInput" rows="3" style="width: 100%; background: rgba(14, 25, 41, 0.9); color: var(--text-main); border: 1px solid rgba(111, 226, 255, 0.35); border-radius: 10px; padding: 10px 12px; font-family: monospace; font-size: 12px; resize: vertical;" placeholder="Enter comma-separated patterns, e.g. GPS, NOAA, USA"></textarea>
            <button id="saveFriendlyListBtn" class="primary" style="width: 100%; margin-top: 8px;">Save Configuration</button>
        </div>

        <div class="section">
            <div class="section-title">Orbit Path Preview</div>
            <div class="list">
                <div class="list-item">
                    <strong>Preview Revolution</strong><br>
                    Click any satellite on the globe or from search results to render one full orbital revolution.
                </div>
            </div>
        </div>
        
        <div class="section">
            <div class="section-title">Active Selection</div>
            <div id="orbitActiveSelection" class="micro-card">No orbit currently rendered.</div>
            <button id="orbitClearButton" class="secondary" type="button" style="margin-top: 10px; width: 100%;">Clear Orbit Preview</button>
        </div>
    `;
}

export default {
    id: "orbit-propagation",
    label: "Orbit Propagation and Tracking",
    eyebrow: "Tracking Operations",
    description: "Continuous SGP4 propagation of the catalog and one-orbit preview tooling.",
    dockEyebrow: "Tracking",
    dockLabel: "Orbit Propagation",
    status: "ready",
    mount(ctx) {
        const root = ctx.containers.sidebarRoot;
        root.innerHTML = buildSidebar();

        const scope = new ListenerScope();

        // Load friendly/adversary patterns
        appState.friendlySatellites = loadFriendlySatellites();
        appState.adversarySatellites = ["YAOGAN", "FENGYUN", "SJ-", "SHIYAN", "BEIDOU"];
        appState.orbitCountryFilter = "all";

        const orbitSearchInput = document.getElementById("orbitSearchInput");
        const orbitSearchResultList = document.getElementById("orbitSearchResultList");
        const friendlyConfigSection = document.getElementById("friendlyConfigSection");
        const friendlyListInput = document.getElementById("friendlyListInput");
        const saveFriendlyListBtn = document.getElementById("saveFriendlyListBtn");

        if (friendlyListInput) {
            friendlyListInput.value = appState.friendlySatellites.join(", ");
        }

        // Auto-refresh search result listing
        let searchTimeout = null;
        const refreshSearchList = () => {
            const query = (orbitSearchInput?.value || "").toUpperCase().trim();
            const spinner = document.getElementById("orbitSearchSpinner");

            if (!query) {
                if (spinner) spinner.classList.add("is-hidden");
                orbitSearchResultList.innerHTML = "";
                if (searchTimeout) clearTimeout(searchTimeout);
                return;
            }

            if (spinner) spinner.classList.remove("is-hidden");
            if (searchTimeout) clearTimeout(searchTimeout);

            searchTimeout = setTimeout(() => {
                // Filter satellites from appState matching query and current country filter
                let filtered = appState.satellites.filter(s => 
                    s.name.toUpperCase().includes(query) || 
                    (s.noradId && String(s.noradId).includes(query))
                );

                if (appState.orbitCountryFilter !== "all") {
                    filtered = filtered.filter(s => {
                        const name = s.name.toUpperCase();
                        if (appState.orbitCountryFilter === "indian") {
                            return s.isIndian;
                        } else if (appState.orbitCountryFilter === "friendly") {
                            return appState.friendlySatellites.some(p => name.includes(p.toUpperCase().trim()));
                        } else if (appState.orbitCountryFilter === "adversary") {
                            return appState.adversarySatellites.some(p => name.includes(p.toUpperCase().trim()));
                        }
                        return true;
                    });
                }

                const slice = filtered.slice(0, 10);
                if (slice.length === 0) {
                    orbitSearchResultList.innerHTML = `<div class="hint">No matches found.</div>`;
                    if (spinner) spinner.classList.add("is-hidden");
                    return;
                }

                orbitSearchResultList.innerHTML = slice.map(s => `
                    <div class="list-item" style="cursor: pointer; padding: 8px 10px; margin-bottom: 4px; display: flex; justify-content: space-between; align-items: center;" data-name="${escapeHtml(s.name)}">
                        <div>
                            <strong>${escapeHtml(s.name)}</strong>
                            <div style="font-size: 11px; opacity: 0.7; margin-top: 2px;">NORAD: ${s.noradId || "N/A"}</div>
                        </div>
                        ${s.isIndian ? '<span class="badge badge-success" style="margin-right: 0;">IND</span>' : ''}
                    </div>
                `).join("");

                if (spinner) spinner.classList.add("is-hidden");
            }, 300);
        };

        scope.add(orbitSearchInput, "input", refreshSearchList);

        scope.add(orbitSearchResultList, "click", (e) => {
            const item = e.target.closest(".list-item[data-name]");
            if (item) {
                const name = item.dataset.name;
                if (typeof ctx.shared.focusOnSatellite === "function") {
                    ctx.shared.focusOnSatellite(name);
                }
            }
        });

        // Country-wise Filters listeners
        const radios = document.getElementsByName("countryFilter");
        radios.forEach(radio => {
            scope.add(radio, "change", () => {
                appState.orbitCountryFilter = radio.value;
                
                // Show/hide friendly config block
                if (radio.value === "friendly") {
                    friendlyConfigSection.style.display = "block";
                } else {
                    friendlyConfigSection.style.display = "none";
                }

                if (typeof ctx.shared.refreshSatelliteVisibility === "function") {
                    ctx.shared.refreshSatelliteVisibility();
                }
                refreshSearchList();
                setStatus(`Orbit propagation filter set to: ${radio.value.toUpperCase()}`);
            });
        });

        // Save friendly list
        scope.add(saveFriendlyListBtn, "click", () => {
            const val = friendlyListInput.value || "";
            const list = val.split(",").map(p => p.trim()).filter(Boolean);
            appState.friendlySatellites = list;
            saveFriendlySatellites(list);
            
            if (typeof ctx.shared.refreshSatelliteVisibility === "function") {
                ctx.shared.refreshSatelliteVisibility();
            }
            refreshSearchList();
            setStatus("Friendly satellite patterns configuration updated.");
        });

        // active selections
        const renderActiveSelection = () => {
            const target = document.getElementById("orbitActiveSelection");
            if (!target) return;
            target.textContent = appState.activeSatellitePathId
                ? `Active orbit: ${appState.activeSatellitePathId}`
                : "No orbit currently rendered.";
        };

        scope.add(document.getElementById("orbitClearButton"), "click", () => {
            if (appState.activeSatellitePathId) {
                ctx.shared.toggleSatellitePath(appState.activeSatellitePathId);
                renderActiveSelection();
            } else {
                renderDefaultAnalysis("Orbit Path Cleared", "Click a satellite on the globe to render one full orbital revolution.");
            }
        });

        renderActiveSelection();
        
        scope.addCleanup(eventBus.on(events.satelliteSelected, () => renderActiveSelection()));
        scope.addCleanup(eventBus.on(events.satelliteCleared, () => renderActiveSelection()));

        if (typeof ctx.shared.setInertialView === "function") {
            ctx.shared.setInertialView(true);
        }
        setStatus("Orbit Propagation module active. Click any satellite on the globe for an orbit preview.");

        return {
            unmount() {
                if (appState.activeSatellitePathId) {
                    ctx.shared.toggleSatellitePath(appState.activeSatellitePathId);
                }
                appState.orbitCountryFilter = "all";
                if (typeof ctx.shared.refreshSatelliteVisibility === "function") {
                    ctx.shared.refreshSatelliteVisibility();
                }
                scope.dispose();
            }
        };
    }
};
