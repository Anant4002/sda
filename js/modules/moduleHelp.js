import { escapeHtml, formatNumber } from "../utils.js";
import { appState } from "../state.js";

function normalizeGuide(guide, definition) {
    const label = definition?.label || "Current Module";
    const description = definition?.description || "Use the controls in this module to complete the current workflow.";

    return {
        title: guide?.title || `${label} Guide`,
        summary: guide?.summary || description,
        steps: Array.isArray(guide?.steps) && guide.steps.length ? guide.steps : [
            "Read the module summary so you know what the workflow is for.",
            "Choose the target satellite, region, or scenario requested by the module.",
            "Adjust any filters, thresholds, or time windows if needed.",
            "Run the analysis or action button and review the results panel.",
            "Use the globe and the sidebar together to interpret what the output means."
        ],
        output: guide?.output || "The module will show results in the analysis panel and update the globe or catalog view.",
        meaning: guide?.meaning || "This is the result, alert, or prediction created by the selected module.",
        tips: Array.isArray(guide?.tips) ? guide.tips : []
    };
}

const MODULE_GUIDES = {
    "mission-control": {
        title: "Mission Control Guide",
        summary: "This is the catalog workspace. Use it to search satellites, hide groups, and control which objects stay visible.",
        steps: [
            "Wait for the catalog to finish loading.",
            "Use the search box to find a satellite name or use the filter toggles to narrow the catalog.",
            "Click a satellite entry to preview its orbit, or use the hide/show button to declutter the globe.",
            "If you want only the newest additions, turn on the new satellites filter."
        ],
        output: "You should see satellite groups in the sidebar and matching points on the globe.",
        meaning: "This is the live catalog view. If a satellite is visible here, it is part of the current working catalog.",
        tips: [
            "Use Mission Control first if you are unsure which satellite or region you need.",
            "A hidden group is still in the database, it is just hidden from view."
        ]
    },
    "orbit-propagation": {
        title: "Orbit Propagation Guide",
        summary: "Use this module to preview one satellite’s orbit and apply country-based filters.",
        steps: [
            "Search for a satellite by name or NORAD ID.",
            "Click a search result or a globe satellite to render its orbit path.",
            "Choose the country filter if you only want Indian, friendly, or adversary assets.",
            "Use the clear button when you want to remove the orbit preview and start again."
        ],
        output: "The globe should show one orbit line and the active selection card should name the chosen satellite.",
        meaning: "The rendered path is the predicted orbit of the selected satellite over one revolution.",
        tips: [
            "If the orbit looks disconnected, reselect the satellite so the path starts from the current propagation time."
        ]
    },
    "volumetric-scan": {
        title: "Volumetric Scan Guide",
        summary: "Trace or choose a region, define the altitude window, and scan for satellites that pass through that volume.",
        steps: [
            "Select a region by manual tracing or search for a location.",
            "Set the forecast window, altitude range, and proximity radius.",
            "Run the scan to calculate which satellites intersect the selected 3D volume.",
            "Review the highlighted satellites and the pass list in the analysis panel."
        ],
        output: "You should see a list of passes, the region outline, and the matching satellites filtered on the globe.",
        meaning: "This represents the satellites that pass through the selected region and altitude window.",
        tips: [
            "If the scene becomes crowded, the scan filter will keep the matching satellites visible while the rest stay hidden."
        ]
    },
    "neighbourhood-watch": {
        title: "Neighbourhood Watch Guide",
        summary: "Screen an Indian asset or the full Indian catalog against nearby satellites to find close approaches.",
        steps: [
            "Choose whether you want global screening or one specific Indian asset.",
            "Set the distance threshold to decide how close is important.",
            "Run the watch and wait for the alert list to populate.",
            "Open the most important events to inspect the closest approaches."
        ],
        output: "The panel will show proximity events and the globe will mark the close-approach locations.",
        meaning: "Each event is a satellite pair that came within the selected threshold.",
        tips: [
            "Lower thresholds mean fewer, more serious alerts. Higher thresholds mean more routine events."
        ]
    },
    "conjunction-analysis": {
        title: "Conjunction Analysis Guide",
        summary: "Use this module to search for potential close approaches inside a selected region and time horizon.",
        steps: [
            "Trace a region or choose a location to define the search area.",
            "Set the forecast horizon and conjunction distance threshold.",
            "Run the analysis to calculate likely conjunctions.",
            "Inspect the ranked list and click events to view the trajectory context."
        ],
        output: "You should see a conjunction list and paired trajectory visuals for the selected events.",
        meaning: "This shows predicted orbital intersections that deserve attention before they become critical.",
        tips: [
            "If you only want very high-risk events, use a smaller distance threshold."
        ]
    },
    "collision-detection": {
        title: "Collision Detection Guide",
        summary: "This is the high-risk version of conjunction screening. It focuses on the most dangerous close approaches.",
        steps: [
            "Select the region you want to inspect.",
            "Set the forecast window, collision threshold, and altitude window.",
            "Run the analysis and wait for the critical events to appear.",
            "Review the critical risk markers and the Pc values in the list."
        ],
        output: "The globe will show red risk markers and the analysis panel will rank the dangerous events.",
        meaning: "These are the conjunctions that are most likely to matter operationally because the risk is high.",
        tips: [
            "A very small Pc still matters if the consequence is high, so always read the marker context."
        ]
    },
    "blind-spot-detection": {
        title: "Blind Spot Detection Guide",
        summary: "Find when a site or region loses satellite coverage and when that coverage returns.",
        steps: [
            "Choose a strategic site or trace a custom region.",
            "Select the time window and sensor group filters you want to use.",
            "Press Update Analysis to rebuild the coverage timeline.",
            "Read the blind windows, coverage status, and chart-style timeline in the analysis panel."
        ],
        output: "You should see a coverage schedule, blind-window markers, and a visual timeline of gaps.",
        meaning: "A blind spot is a time period where the selected area is not effectively observed.",
        tips: [
            "A stable coverage result means the area remains observable for the full selected window."
        ]
    },
    "manoeuvre-detection": {
        title: "Manoeuvre Detection Guide",
        summary: "Use this module to inspect orbit changes, drift evolution, and emerging regional access patterns.",
        steps: [
            "Select a satellite for drift or manoeuvre analysis, or select a strategic region for regional access analysis.",
            "Run the drift view to compare historical orbital evolution.",
            "Run manoeuvre detection to compare old and new TLE-derived paths.",
            "Use the regional access action when you want to know whether a region is starting to receive more passes."
        ],
        output: "The globe should show drift tracks, old-vs-new orbit paths, or regional access findings depending on the action used.",
        meaning: "This module explains how an orbit has changed or whether a region is gaining new access.",
        tips: [
            "If you only need one workflow, ignore the others, but the help button will always tell you what each action does."
        ]
    },
    "reentry-analysis": {
        title: "Re-entry Analysis Guide",
        summary: "Predict when a decaying object may come back through the atmosphere and where the corridor could fall.",
        steps: [
            "Select a satellite with a decaying orbit or low perigee.",
            "Run the re-entry predictor.",
            "Review the simulation, corridor, and impact-related findings.",
            "Use the operational alert feed to see whether the result created any follow-up events."
        ],
        output: "You should see a re-entry corridor on the globe and a detailed prediction in the analysis panel.",
        meaning: "This tells you when an object is expected to re-enter and which areas might lie under the corridor.",
        tips: [
            "If the module says there is not enough data, the orbit history is too limited for a reliable forecast."
        ]
    },
    "characterisation-cataloguing": {
        title: "Characterisation Guide",
        summary: "Classify unknown objects, review the catalog, and attach intelligence notes.",
        steps: [
            "Use the UCT list to inspect unidentified targets.",
            "Search the catalog to open a known satellite or unknown object record.",
            "Review the classification, orbital data, and sensor recommendations.",
            "Add intelligence notes or flag a target if it needs follow-up."
        ],
        output: "The detail card should show object intelligence, catalog status, and any manual notes you add.",
        meaning: "This module helps convert raw orbital objects into tracked, explained catalog entries.",
        tips: [
            "UCT means the object has not yet been correlated to a known catalog entry."
        ]
    },
    "rapid-processing": {
        title: "Rapid Threat Processing Guide",
        summary: "Inject or ingest a fast-moving track and let the system classify it quickly.",
        steps: [
            "Choose one of the simulation buttons or ingest a live track.",
            "Wait for the classifier to assign a threat level.",
            "Review the active track list for confidence and status.",
            "Clear the globe when you want to start a new test."
        ],
        output: "You should see a new track on the globe and a threat classification in the active track list.",
        meaning: "This is the fast response layer for debris, meteors, orbital objects, or missile-like tracks.",
        tips: [
            "Use this module when the object is changing quickly and needs immediate classification."
        ]
    },
    "operational-alerts": {
        title: "Operational Alerts Guide",
        summary: "Read the backend alert stream that collects the latest analysis and event records.",
        steps: [
            "Open the alert feed or refresh it manually.",
            "Scan the latest records for the most relevant events.",
            "Use this panel as a log of what other modules produced.",
            "Refresh again after a new analysis if you want to confirm persistence."
        ],
        output: "You should see a list of recent operational events and alert summaries.",
        meaning: "This is the saved record of what the system has already detected or reported.",
        tips: [
            "If you do not see a fresh analysis here, the backend may still be updating."
        ]
    },
    "unified-threat-insights": {
        title: "Unified Threat Insights Guide",
        summary: "Use this panel to review how raw alerts from different modules were merged into one incident, scored, and assigned an action.",
        steps: [
            "Open the Unified Threat Insights module from the module dock.",
            "Choose an asset class filter if you want to focus on Indian, adversary, or friendly objects only.",
            "Choose a priority filter if you want to focus on LOW, MEDIUM, HIGH, or CRITICAL incidents.",
            "Click Refresh Unified Insights to load the latest correlated incidents.",
            "Read each incident card from top to bottom: incident ID, satellite name, threat score, priority, linked events, and recommended action.",
            "Open the linked events list to see which raw alerts were merged into the same incident."
        ],
        output: "You should see incident cards with a unified score, grouped alerts, timestamps, and a recommended action instead of disconnected module outputs.",
        meaning: "This is the correlation layer that turns separate module alerts into one operational story so the operator can act faster.",
        tips: [
            "A higher score means the incident is more urgent.",
            "If no incidents appear, the engine has not yet found enough related alerts to form a unified incident.",
            "Use this panel after running other modules so you can see which alerts belong to the same operational picture."
        ]
    },
    "training-simulation": {
        title: "Training Simulation Guide",
        summary: "Run rehearsal scenarios in a sandbox so operators can practice without affecting live operations.",
        steps: [
            "Pick a scenario from the library.",
            "Load or preview it to see the timeline and objectives.",
            "Start the scenario and respond to the simulated events.",
            "Watch the mission score and objective completion as the exercise unfolds."
        ],
        output: "The panel will show a scenario timeline, objective progress, and response performance metrics.",
        meaning: "This is a training replay that lets you practice the workflow before you work on live data.",
        tips: [
            "If you are new to the console, this is a safe place to learn how each workflow behaves."
        ]
    }
};

export function getModuleHelpGuide(definition) {
    const guide = definition ? MODULE_GUIDES[definition.id] : null;
    return normalizeGuide(guide, definition);
}

export function buildModuleHelpContent(definition) {
    if (definition && definition.id === "mission-control") {
        const activeCount = appState.satellites ? appState.satellites.length : 15510;
        const indianCount = appState.satellites ? appState.satellites.filter(s => s.isIndian).length : 49;

        let ageSec = 5;
        if (appState.catalogStatusSnapshot && appState.catalogStatusSnapshot.status) {
            ageSec = appState.catalogStatusSnapshot.status.dataAgeSeconds ?? 5;
        }

        let freshnessText = `${ageSec} seconds`;
        if (ageSec >= 60) {
            const min = Math.floor(ageSec / 60);
            freshnessText = `${min} minute${min === 1 ? "" : "s"}`;
        }

        return `
            <div class="help-guide" style="font-family: var(--font-mono); color: var(--text-main); font-size: 13px; line-height: 1.5;">
                <div class="help-section">
                    <div class="help-section-title" style="font-size: 1.1em; color: var(--text-bright); border-bottom: 1px solid rgba(255,255,255,0.1); padding-bottom: 6px; margin-bottom: 10px;">Mission Control</div>
                    <ul class="help-list" style="list-style-type: square; padding-left: 18px; display: flex; flex-direction: column; gap: 4px;">
                        <li>Catalog Health Monitoring</li>
                        <li>Satellite Search & Filtering</li>
                        <li>Orbit Preview</li>
                        <li>Catalog Synchronization</li>
                    </ul>
                </div>

                <div class="help-section" style="margin-top: 20px;">
                    <div class="help-section-title" style="font-size: 1em; color: var(--text-bright); margin-bottom: 8px;">Current Catalog:</div>
                    <div class="micro-card" style="padding: 12px; background: rgba(0,0,0,0.25); border: 1px solid var(--panel-border); border-radius: 6px;">
                        <table style="width: 100%; border-collapse: collapse; font-size: 12px;">
                            <tr style="border-bottom: 1px solid rgba(255,255,255,0.05);">
                                <td style="padding: 4px 0; color: var(--text-dim);">Active Objects:</td>
                                <td style="padding: 4px 0; text-align: right; font-weight: bold; color: white;">${formatNumber(activeCount, 0)}</td>
                            </tr>
                            <tr style="border-bottom: 1px solid rgba(255,255,255,0.05);">
                                <td style="padding: 4px 0; color: var(--text-dim);">Indian Assets:</td>
                                <td style="padding: 4px 0; text-align: right; font-weight: bold; color: var(--indian);">${indianCount}</td>
                            </tr>
                            <tr>
                                <td style="padding: 4px 0; color: var(--text-dim);">Freshness:</td>
                                <td style="padding: 4px 0; text-align: right; font-weight: bold; color: var(--success);">${freshnessText}</td>
                            </tr>
                        </table>
                    </div>
                </div>
            </div>
        `;
    }

    const guide = getModuleHelpGuide(definition);

    const stepItems = guide.steps.map((step) => `<li>${escapeHtml(step)}</li>`).join("");
    const tipItems = guide.tips.length
        ? `<div class="help-section">
                <div class="help-section-title">Tips</div>
                <ul class="help-list">${guide.tips.map((tip) => `<li>${escapeHtml(tip)}</li>`).join("")}</ul>
           </div>`
        : "";

    return `
        <div class="help-guide">
            <div class="help-section">
                <div class="help-section-title">What this module does</div>
                <div class="micro-card">${escapeHtml(guide.summary)}</div>
            </div>
            <div class="help-section">
                <div class="help-section-title">Steps</div>
                <ol class="help-list">${stepItems}</ol>
            </div>
            <div class="help-section">
                <div class="help-section-title">Expected output</div>
                <div class="micro-card">${escapeHtml(guide.output)}</div>
            </div>
            <div class="help-section">
                <div class="help-section-title">What it means</div>
                <div class="micro-card">${escapeHtml(guide.meaning)}</div>
            </div>
            ${tipItems}
        </div>
    `;
}
