const crypto = require("node:crypto");
const { Op } = require("sequelize");
const { sequelize } = require("../db");
const { OperationalAlert } = require("../models/operationalAlert");
const { Satellite } = require("../models/satellite");
const { Debris } = require("../models/debris");
const { RocketBody } = require("../models/rocketBody");
const { CorrelationRule } = require("../models/correlationRule");
const { IncidentGroup } = require("../models/incidentGroup");
const { AlertCorrelation } = require("../models/alertCorrelation");
const { IncidentEventLink } = require("../models/incidentEventLink");
const { ThreatScore } = require("../models/threatScore");
require("../models/correlationAssociations");

const ALGORITHM_VERSION = "correlation-engine-v1";

const DEFAULT_RULES = [
    {
        ruleKey: "engine_config",
        ruleType: "config",
        description: "Default correlation windows and score thresholds.",
        enabled: true,
        config: {
            incidentWindowMinutes: 360,
            sameObjectWindowMinutes: 720,
            sameRegionWindowMinutes: 240,
            lowMax: 24,
            mediumMax: 49,
            highMax: 79,
            scoreCap: 100
        }
    },
    { ruleKey: "weight_conjunction", ruleType: "weight", category: "conjunction", weight: 25, description: "Base conjunction risk weight." },
    { ruleKey: "weight_collision_risk", ruleType: "weight", category: "collision_risk", weight: 40, description: "Collision probability and critical miss-distance weight." },
    { ruleKey: "weight_manoeuvre", ruleType: "weight", category: "manoeuvre", weight: 30, description: "Manoeuvre detection weight." },
    { ruleKey: "weight_blind_spot", ruleType: "weight", category: "blind_spot", weight: 25, description: "Blind spot coverage gap weight." },
    { ruleKey: "weight_neighbourhood_watch", ruleType: "weight", category: "neighbourhood_watch", weight: 20, description: "Neighbourhood watch proximity weight." },
    { ruleKey: "weight_reentry", ruleType: "weight", category: "reentry", weight: 10, description: "Re-entry analysis weight." },
    { ruleKey: "weight_rapid_threat", ruleType: "weight", category: "rapid_threat", weight: 50, description: "Rapid threat processing weight." },
    { ruleKey: "weight_volumetric_scan", ruleType: "weight", category: "volumetric_scan", weight: 10, description: "Volumetric scan event weight." },
    {
        ruleKey: "combo_conjunction_collision",
        ruleType: "combination",
        requiredCategories: ["conjunction", "collision_risk"],
        weight: 20,
        priority: "HIGH",
        recommendationText: "Immediate Monitoring",
        description: "Escalate when conjunction and collision-risk signals appear together."
    },
    {
        ruleKey: "combo_manoeuvre_neighbourhood",
        ruleType: "combination",
        requiredCategories: ["manoeuvre", "neighbourhood_watch"],
        weight: 15,
        priority: "HIGH",
        recommendationText: "Suspicious Behaviour",
        description: "Escalate when a manoeuvre is followed by proximity activity."
    },
    {
        ruleKey: "combo_blindspot_adversary",
        ruleType: "combination",
        requiredCategories: ["blind_spot", "adversary"],
        weight: 15,
        priority: "HIGH",
        recommendationText: "Surveillance Opportunity",
        description: "Escalate blind spots over adversary-linked activity."
    },
    {
        ruleKey: "combo_rapid_reentry",
        ruleType: "combination",
        requiredCategories: ["rapid_threat", "reentry"],
        weight: 30,
        priority: "CRITICAL",
        recommendationText: "Critical Event",
        description: "Escalate when rapid threat detection overlaps with re-entry risk."
    },
    { ruleKey: "threshold_low", ruleType: "threshold", minScore: 0, maxScore: 24, priority: "LOW", description: "Low threat band." },
    { ruleKey: "threshold_medium", ruleType: "threshold", minScore: 25, maxScore: 49, priority: "MEDIUM", description: "Medium threat band." },
    { ruleKey: "threshold_high", ruleType: "threshold", minScore: 50, maxScore: 79, priority: "HIGH", description: "High threat band." },
    { ruleKey: "threshold_critical", ruleType: "threshold", minScore: 80, maxScore: 100, priority: "CRITICAL", description: "Critical threat band." }
];

const ADVERSARY_PATTERNS = [
    /YAOGAN/i,
    /GAOFEN/i,
    /TIANHUI/i,
    /SHIJIAN/i,
    /ZHUHAI/i,
    /KOSMOS/i,
    /COSMOS/i,
    /NROL/i,
    /MILSTAR/i,
    /SBIRS/i,
    /AEHF/i
];

const INDIAN_PATTERNS = [
    /GSAT/i,
    /INSAT/i,
    /IRNSS/i,
    /NAVIC/i,
    /RISAT/i,
    /CARTOSAT/i,
    /RESOURCESAT/i,
    /EOS/i,
    /OCEANSAT/i,
    /SCATSAT/i,
    /MICROSAT/i,
    /TECHSAT/i,
    /HYSIS/i,
    /ASTROSAT/i
];

const MODULE_LABELS = {
    conjunction: "Conjunction Analysis",
    collision_risk: "Collision Detection",
    manoeuvre: "Manoeuvre Detection",
    blind_spot: "Blind Spot Detection",
    neighbourhood_watch: "Neighbourhood Watch",
    reentry: "Re-entry Analysis",
    rapid_threat: "Rapid Threat Processing",
    volumetric_scan: "Volumetric Scan"
};

const PLACEHOLDER_NAME_PATTERNS = [
    /^SAT[-_\s]?[A-Z0-9]+$/i,
    /^SATELLITE[-_\s]?[A-Z0-9]+$/i,
    /^OBJECT[-_\s]?[A-Z0-9]+$/i,
    /^UNKNOWN$/i,
    /^UNKNOWN OBJECT$/i,
    /^UNCATALOGUED$/i,
    /^UNCATALOGUED OBJECT$/i,
    /^N\/A$/i
];

function normalizeText(value) {
    return value === undefined || value === null ? "" : String(value).trim();
}

function lowerText(value) {
    return normalizeText(value).toLowerCase();
}

function isFiniteDate(value) {
    if (!value) {
        return false;
    }
    const time = new Date(value).getTime();
    return Number.isFinite(time);
}

function toDate(value, fallback = new Date()) {
    const candidate = new Date(value);
    return Number.isFinite(candidate.getTime()) ? candidate : new Date(fallback);
}

function hashKey(parts) {
    return crypto.createHash("sha1").update(parts.filter(Boolean).join("|")).digest("hex");
}

function toPlain(record) {
    if (!record) {
        return null;
    }
    if (typeof record.get === "function") {
        return record.get({ plain: true });
    }
    return { ...record };
}

function parseJsonSafe(value, fallback = null) {
    if (value === null || value === undefined) {
        return fallback;
    }
    if (typeof value === "object") {
        return value;
    }
    try {
        return JSON.parse(value);
    } catch (error) {
        return fallback;
    }
}

function isPlaceholderObjectLabel(value) {
    const normalized = normalizeText(value);
    if (!normalized) {
        return true;
    }
    return PLACEHOLDER_NAME_PATTERNS.some((pattern) => pattern.test(normalized));
}

function firstFiniteNumber(...values) {
    for (const value of values) {
        const numeric = Number(value);
        if (Number.isFinite(numeric)) {
            return numeric;
        }
    }
    return null;
}

function firstPositiveNumber(...values) {
    for (const value of values) {
        if (value === undefined || value === null || value === "") {
            continue;
        }
        const numeric = Number(value);
        if (Number.isFinite(numeric) && numeric > 0) {
            return numeric;
        }
    }
    return null;
}

function getModuleLabel(alertType = "", sourceName = "") {
    const normalizedSource = lowerText(sourceName);
    if (normalizedSource) {
        const readable = sourceName
            .replace(/[_-]+/g, " ")
            .replace(/\s+/g, " ")
            .trim();
        const knownModuleLabels = new Set(Object.values(MODULE_LABELS).map((label) => lowerText(label)));
        if (knownModuleLabels.has(lowerText(readable))) {
            return readable;
        }
        if (/frontend|backend|system|analysis/i.test(readable)) {
            return MODULE_LABELS[lowerText(alertType)] || readable;
        }
    }

    const normalized = lowerText(alertType);
    return MODULE_LABELS[normalized] || (alertType ? alertType.replace(/[_-]+/g, " ") : "Linked Module");
}

function resolveObjectIdentity({ identifier = null, fallbackName = null, rawNoradId = null, rawCosparId = null, satelliteLookup = new Map() } = {}) {
    const identifierText = normalizeText(identifier);
    const fallbackText = normalizeText(fallbackName);
    const identifierKey = identifierText.toLowerCase();
    const fallbackKey = fallbackText.toLowerCase();
    const lookupKeys = [
        identifierKey,
        fallbackKey,
        String(identifierText),
        String(fallbackText)
    ].filter((value) => value && value !== "null" && value !== "undefined");

    let satellite = null;
    for (const key of lookupKeys) {
        satellite = satelliteLookup.get(key) || satelliteLookup.get(String(key)) || satelliteLookup.get(lowerText(key));
        if (satellite) {
            break;
        }
    }

    const lookupName = satellite?.name ? normalizeText(satellite.name) : null;
    const lookupNoradId = firstPositiveNumber(satellite?.noradId);
    const noradId = firstPositiveNumber(rawNoradId) ?? lookupNoradId;
    const cosparId = normalizeText(rawCosparId || satellite?.cosparId || satellite?.internationalDesignator || satellite?.intlDesignator);
    const fallbackIsValid = fallbackText && !isPlaceholderObjectLabel(fallbackText);
    const identifierIsValid = identifierText && !isPlaceholderObjectLabel(identifierText);

    let displayName = null;
    if (lookupName) {
        displayName = lookupName;
    } else if (fallbackIsValid) {
        displayName = fallbackText;
    } else if (identifierIsValid && !/^\d+$/.test(identifierText)) {
        displayName = identifierText;
    } else if (Number.isFinite(noradId) && noradId > 0) {
        displayName = `NORAD ID ${noradId}`;
    } else if (cosparId) {
        displayName = `COSPAR ID ${cosparId}`;
    } else {
        displayName = "Uncatalogued Object";
    }

    let identifierLabel = displayName;
    if (lookupName) {
        identifierLabel = lookupName;
    } else if (Number.isFinite(noradId) && noradId > 0) {
        identifierLabel = `NORAD ID ${noradId}`;
    } else if (cosparId) {
        identifierLabel = `COSPAR ID ${cosparId}`;
    } else {
        identifierLabel = "Uncatalogued Object";
    }

    return {
        satellite,
        displayName,
        identifierLabel,
        noradId,
        cosparId,
        isCatalogued: Boolean(lookupName || (Number.isFinite(noradId) && noradId > 0) || cosparId)
    };
}

function extractAlertEventDetails(alert) {
    const details = parseJsonSafe(alert?.details, {});
    const rawAlert = parseJsonSafe(details?.rawAlert, details?.rawAlert || {});
    const tca = details?.tca || details?.time || details?.closestApproachTime || details?.predictedReentryDate || rawAlert?.tca || rawAlert?.time || rawAlert?.closestApproachTime || rawAlert?.estimatedReentryDate || rawAlert?.predictedReentryDate || alert?.occurredAt;
    const missDistanceKm = firstFiniteNumber(
        alert?.closestDistanceKm,
        details?.missDistanceKm,
        details?.closestDistanceKm,
        details?.closestApproachKm,
        details?.minDistanceAfterKm,
        rawAlert?.closestDistanceKm,
        rawAlert?.missDistanceKm,
        rawAlert?.closestApproachKm,
        rawAlert?.minDistanceAfterKm
    );
    const relativeVelocityKmS = firstFiniteNumber(
        details?.relativeVelocityKmS,
        rawAlert?.relativeVelocityKmS,
        rawAlert?.relativeVelocityKmS,
        details?.relativeVelocity,
        rawAlert?.relativeVelocity
    );

    return {
        details,
        rawAlert,
        tca,
        missDistanceKm,
        relativeVelocityKmS,
        observationWindow: details?.observationWindow || rawAlert?.observationWindow || null,
        reentryWindow: details?.reentryWindow || rawAlert?.reentryWindow || null,
        impactCorridor: details?.impactCorridor || rawAlert?.impactCorridor || null,
        durationMinutes: details?.durationMinutes ?? rawAlert?.durationMinutes ?? null
    };
}

function buildOperationalWhyBullets(categories, alertType, alert) {
    const categorySet = new Set(categories);
    const bullets = [];

    if (categorySet.has("conjunction")) {
        bullets.push("Close approach detected between two objects.");
        bullets.push("Miss distance fell below the monitoring threshold.");
    }

    if (categorySet.has("collision_risk")) {
        bullets.push("Collision probability exceeded the warning threshold.");
        bullets.push("Relative velocity indicated elevated risk.");
    }

    if (categorySet.has("neighbourhood_watch")) {
        bullets.push("Object entered the configured monitoring zone.");
        bullets.push("Persistent activity detected near the protected asset.");
    }

    if (categorySet.has("blind_spot")) {
        bullets.push("Coverage gap identified over the monitored region.");
    }

    if (categorySet.has("manoeuvre")) {
        bullets.push("Orbital behaviour deviated from the expected trajectory.");
    }

    if (categorySet.has("reentry")) {
        bullets.push("Re-entry prediction confidence exceeded the threshold.");
    }

    if (categorySet.has("rapid_threat")) {
        bullets.push("Rapid threat processor escalated the track for immediate review.");
    }

    if (categorySet.has("volumetric_scan")) {
        bullets.push("Satellite intersected the traced search volume.");
    }

    if (!bullets.length) {
        bullets.push("Related activity was detected within the same monitoring window.");
        bullets.push("The incident combines linked analytical outputs into one operational picture.");
    }

    return [...new Set(bullets)].slice(0, 4);
}

function buildThreatRationale(incident, categories, recommendation, matchedRule, alertType = "") {
    const typeLabel = MODULE_LABELS[lowerText(alertType)] || alertType || "Linked module";
    const bullets = buildOperationalWhyBullets(categories, alertType, incident);
    return {
        typeLabel,
        bullets,
        recommendation: recommendation || "Review immediately.",
        prioritySummary: `${incident.threatScore}/100 threat score assigned from the correlated alerts.`
    };
}

function buildCorrelationExplanation(incident, categories, recommendation, matchedRule) {
    const categoryText = categories.length ? categories.map((category) => category.replaceAll("_", " ")).join(", ") : "general activity";
    const ruleText = matchedRule?.description || matchedRule?.recommendationText || "related alerts were combined for operator review";
    return {
        summary: `${incident.primaryObjectName} was correlated with ${categoryText}.`,
        bullets: [
            "The incident combines related module outputs into a single operational picture.",
            `Why this matters: ${ruleText}.`,
            `Recommended action: ${recommendation}.`
        ]
    };
}

function getSeverityRank(priority = "") {
    switch (String(priority || "").toUpperCase()) {
        case "CRITICAL":
            return 0;
        case "HIGH":
            return 1;
        case "MEDIUM":
            return 2;
        case "LOW":
            return 3;
        default:
            return 4;
    }
}

function getComparableDistanceKm(value) {
    const numeric = Number(value);
    return Number.isFinite(numeric) && numeric >= 0 ? numeric : Number.POSITIVE_INFINITY;
}

function getComparableDate(value) {
    const time = new Date(value || 0).getTime();
    return Number.isFinite(time) ? time : Number.POSITIVE_INFINITY;
}

function deriveIncidentQueueMetrics(plainIncident, linkedAlerts = []) {
    const eventMetrics = linkedAlerts.map((alert) => {
        const details = extractAlertEventDetails(alert);
        const missDistanceKm = firstFiniteNumber(
            alert.closestDistanceKm,
            details.missDistanceKm,
            details.rawAlert?.missDistanceKm,
            details.rawAlert?.closestDistanceKm
        );
        const relativeVelocityKmS = firstFiniteNumber(
            alert.details?.relativeVelocityKmS,
            details.relativeVelocityKmS,
            details.rawAlert?.relativeVelocityKmS,
            details.rawAlert?.relativeVelocity
        );
        return {
            tca: details.tca || alert.occurredAt || plainIncident.lastDetectedAt || plainIncident.firstDetectedAt,
            missDistanceKm,
            relativeVelocityKmS
        };
    });

    const sortedMetrics = [...eventMetrics].sort((a, b) => {
        const distanceDelta = getComparableDistanceKm(a.missDistanceKm) - getComparableDistanceKm(b.missDistanceKm);
        if (distanceDelta !== 0) {
            return distanceDelta;
        }
        return getComparableDate(a.tca) - getComparableDate(b.tca);
    });

    const bestEvent = sortedMetrics[0] || null;
    const tca = bestEvent?.tca || plainIncident.lastDetectedAt || plainIncident.firstDetectedAt || null;
    const missDistanceKm = Number.isFinite(bestEvent?.missDistanceKm) ? bestEvent.missDistanceKm : null;
    const relativeVelocityKmS = Number.isFinite(bestEvent?.relativeVelocityKmS) ? bestEvent.relativeVelocityKmS : null;

    return {
        tca,
        missDistanceKm,
        relativeVelocityKmS,
        sortPriority: getSeverityRank(plainIncident.priority),
        sortDistanceKm: getComparableDistanceKm(missDistanceKm),
        sortTca: getComparableDate(tca)
    };
}

function deriveModuleCategory(alertType = "", details = {}) {
    const normalized = lowerText(alertType);
    if (normalized.includes("conjunction")) {
        return "conjunction";
    }
    if (normalized.includes("collision")) {
        return "collision_risk";
    }
    if (normalized.includes("manoeuvre") || normalized.includes("maneuver")) {
        return "manoeuvre";
    }
    if (normalized.includes("blind")) {
        return "blind_spot";
    }
    if (normalized.includes("neighbourhood") || normalized.includes("proximity")) {
        return "neighbourhood_watch";
    }
    if (normalized.includes("reentry") || normalized.includes("re-entry")) {
        return "reentry";
    }
    if (normalized.includes("rapid")) {
        return "rapid_threat";
    }
    if (normalized.includes("scan") || normalized.includes("volumetric") || normalized.includes("region")) {
        return "volumetric_scan";
    }

    const nestedClassification = lowerText(details?.classification || details?.rawAlert?.classification);
    if (nestedClassification.includes("proximity")) {
        return "collision_risk";
    }

    return "general";
}

function extractAlertAnchor(alert) {
    const details = parseJsonSafe(alert.details, {});
    const rawAlert = parseJsonSafe(details.rawAlert, details.rawAlert || {});
    const area = details.area || details.region || rawAlert.area || rawAlert.region || null;
    const regionHash = normalizeText(details.analysisKey || details.regionHash || rawAlert.analysisKey || rawAlert.regionHash || "");
    const regionName = normalizeText(area?.name || details.regionName || rawAlert.regionName || "");
    const primaryObjectName = normalizeText(
        details.primaryObjectName ||
        details.satelliteName ||
        rawAlert.satelliteName ||
        alert.primaryName ||
        rawAlert.primaryName ||
        alert.primaryId ||
        rawAlert.primaryId ||
        details.primaryId ||
        ""
    );
    const secondaryObjectName = normalizeText(
        details.secondaryObjectName ||
        rawAlert.secondaryObjectName ||
        alert.secondaryName ||
        rawAlert.secondaryName ||
        alert.secondaryId ||
        rawAlert.secondaryId ||
        details.secondaryId ||
        ""
    );
    const occurredAt = toDate(alert.occurredAt || alert.time || details.analysisTime || new Date());

    return {
        details,
        rawAlert,
        area,
        regionHash,
        regionName,
        primaryObjectName,
        secondaryObjectName,
        occurredAt,
        alertType: normalizeText(alert.alertType),
        sourceType: normalizeText(alert.sourceType),
        sourceName: normalizeText(alert.sourceName),
        eventKey: normalizeText(alert.eventKey),
        severity: normalizeText(alert.severity).toLowerCase() || "info",
        trainingSessionId: alert.trainingSessionId ?? null
    };
}

function classifyByName(name, satelliteLookup = new Map()) {
    const normalized = normalizeText(name);
    if (!normalized) {
        return null;
    }

    const lookup = satelliteLookup.get(normalized.toLowerCase()) || satelliteLookup.get(normalized);
    if (lookup?.isIndian) {
        return "INDIAN";
    }

    if (INDIAN_PATTERNS.some((pattern) => pattern.test(normalized))) {
        return "INDIAN";
    }

    if (ADVERSARY_PATTERNS.some((pattern) => pattern.test(normalized))) {
        return "ADVERSARY";
    }

    if (lookup) {
        return "FRIENDLY";
    }

    return "UNKNOWN";
}

function inferAssetClassification(anchor, satelliteLookup = new Map()) {
    const classifications = [
        classifyByName(anchor.primaryObjectName, satelliteLookup),
        classifyByName(anchor.secondaryObjectName, satelliteLookup)
    ].filter(Boolean);

    if (classifications.includes("INDIAN")) {
        return "INDIAN";
    }

    if (classifications.includes("ADVERSARY")) {
        return "ADVERSARY";
    }

    if (classifications.includes("FRIENDLY")) {
        return "FRIENDLY";
    }

    return "UNKNOWN";
}

function findSatelliteLookupName(record) {
    return lowerText(record?.name || record?.satelliteName || record?.primaryObjectName || record?.secondaryObjectName);
}

async function resolveSatelliteLookup(alertRows) {
    const names = new Set();
    const noradIds = new Set();

    for (const row of alertRows) {
        const anchor = extractAlertAnchor(row);
        if (anchor.primaryObjectName) {
            names.add(anchor.primaryObjectName.toLowerCase());
        }
        if (anchor.secondaryObjectName) {
            names.add(anchor.secondaryObjectName.toLowerCase());
        }

        const primaryNorad = firstPositiveNumber(
            anchor.details?.primaryNoradId,
            anchor.rawAlert?.primaryNoradId,
            anchor.details?.primaryNorad,
            anchor.rawAlert?.primaryNorad,
            anchor.details?.noradId,
            anchor.rawAlert?.noradId
        );
        const secondaryNorad = firstPositiveNumber(
            anchor.details?.secondaryNoradId,
            anchor.rawAlert?.secondaryNoradId,
            anchor.details?.secondaryNorad,
            anchor.rawAlert?.secondaryNorad
        );
        if (Number.isFinite(primaryNorad)) {
            noradIds.add(primaryNorad);
        }
        if (Number.isFinite(secondaryNorad)) {
            noradIds.add(secondaryNorad);
        }
    }

    const where = [];
    if (names.size) {
        where.push(sequelize.where(sequelize.fn("lower", sequelize.col("name")), {
            [Op.in]: [...names]
        }));
    }
    if (noradIds.size) {
        where.push({ noradId: { [Op.in]: [...noradIds] } });
    }

    const lookup = new Map();
    if (where.length) {
        const queryOptions = {
            where: {
                [Op.or]: where
            }
        };
        const satellites = await Satellite.findAll(queryOptions);
        const debris = await Debris.findAll(queryOptions);
        const rocketBodies = await RocketBody.findAll(queryOptions);

        for (const sat of satellites) {
            const plain = sat.get({ plain: true });
            plain._modelName = "Satellite";
            lookup.set(lowerText(plain.name), plain);
            if (plain.id !== null && plain.id !== undefined) {
                lookup.set(String(plain.id), plain);
            }
            if (plain.noradId !== null && plain.noradId !== undefined) {
                lookup.set(String(plain.noradId), plain);
            }
        }

        for (const deb of debris) {
            const plain = deb.get({ plain: true });
            plain._modelName = "Debris";
            lookup.set(lowerText(plain.name), plain);
            if (plain.id !== null && plain.id !== undefined) {
                lookup.set(String(plain.id), plain);
            }
            if (plain.noradId !== null && plain.noradId !== undefined) {
                lookup.set(String(plain.noradId), plain);
            }
        }

        for (const rb of rocketBodies) {
            const plain = rb.get({ plain: true });
            plain._modelName = "RocketBody";
            lookup.set(lowerText(plain.name), plain);
            if (plain.id !== null && plain.id !== undefined) {
                lookup.set(String(plain.id), plain);
            }
            if (plain.noradId !== null && plain.noradId !== undefined) {
                lookup.set(String(plain.noradId), plain);
            }
        }
    }

    return lookup;
}

function getConfigRule(rules) {
    return rules.find((rule) => rule.ruleType === "config" && rule.ruleKey === "engine_config") || null;
}

function getThresholdRules(rules) {
    return rules.filter((rule) => rule.ruleType === "threshold" && rule.enabled);
}

function getWeightRules(rules) {
    return rules.filter((rule) => rule.ruleType === "weight" && rule.enabled);
}

function getCombinationRules(rules) {
    return rules.filter((rule) => rule.ruleType === "combination" && rule.enabled);
}

function ruleConfig(rule, fallback = {}) {
    const payload = parseJsonSafe(rule?.config, null);
    return payload && typeof payload === "object" ? { ...fallback, ...payload } : fallback;
}

async function ensureDefaultCorrelationRules(transaction = null) {
    const existingCount = await CorrelationRule.count({ transaction });
    if (existingCount > 0) {
        return CorrelationRule.findAll({ transaction });
    }

    await CorrelationRule.bulkCreate(DEFAULT_RULES, { transaction });
    return CorrelationRule.findAll({ transaction });
}

function getIncidentWindowMinutes(config) {
    return Number.isFinite(config?.incidentWindowMinutes) ? config.incidentWindowMinutes : 360;
}

function getSameObjectWindowMinutes(config) {
    return Number.isFinite(config?.sameObjectWindowMinutes) ? config.sameObjectWindowMinutes : 720;
}

function getSameRegionWindowMinutes(config) {
    return Number.isFinite(config?.sameRegionWindowMinutes) ? config.sameRegionWindowMinutes : 240;
}

function getScoreCap(config) {
    return Number.isFinite(config?.scoreCap) ? config.scoreCap : 100;
}

function getScoreBands(config) {
    return {
        lowMax: Number.isFinite(config?.lowMax) ? config.lowMax : 24,
        mediumMax: Number.isFinite(config?.mediumMax) ? config.mediumMax : 49,
        highMax: Number.isFinite(config?.highMax) ? config.highMax : 79
    };
}

function buildIncidentKey(envelope, assetClassification) {
    const anchor = envelope.primaryObjectName || envelope.secondaryObjectName || envelope.regionHash || envelope.regionName || envelope.alertType || "general";
    const scope = envelope.trainingSessionId ? `training:${envelope.trainingSessionId}` : "live";
    const normalizedAnchor = lowerText(anchor);
    const normalizedRegion = lowerText(envelope.regionHash || envelope.regionName || "");
    return hashKey([scope, normalizedAnchor, normalizedRegion, assetClassification]);
}

function buildCorrelationKey(incidentKey, eventKey) {
    return hashKey([incidentKey, eventKey]);
}

function buildEventWindow(envelope, config) {
    const occurredAt = envelope.occurredAt;
    const halfWindow = Math.max(15, Math.round(getIncidentWindowMinutes(config) / 2));
    const start = new Date(occurredAt.getTime() - halfWindow * 60000);
    const end = new Date(occurredAt.getTime() + halfWindow * 60000);
    return { start, end };
}

function buildMatchedCategories(envelope) {
    const categories = new Set();
    const category = deriveModuleCategory(envelope.alertType, envelope.details);
    if (category && category !== "general") {
        categories.add(category);
    }

    const severity = envelope.severity;
    const collisionProbability = Number(envelope.details?.collisionProbability ?? envelope.rawAlert?.collisionProbability);
    const closestDistanceKm = Number(envelope.details?.closestDistanceKm ?? envelope.rawAlert?.closestDistanceKm);

    if (category === "conjunction") {
        categories.add("conjunction");
        if (Number.isFinite(collisionProbability) && collisionProbability > 1e-4) {
            categories.add("collision_risk");
        }
        if (Number.isFinite(closestDistanceKm) && closestDistanceKm <= 5) {
            categories.add("collision_risk");
        }
        if (severity === "critical" || severity === "danger") {
            categories.add("collision_risk");
        }
    }

    if (category === "manoeuvre" && (envelope.details?.classification || envelope.rawAlert?.classification)) {
        categories.add("manoeuvre");
    }

    if (category === "blind_spot") {
        categories.add("blind_spot");
    }

    if (category === "neighbourhood_watch") {
        categories.add("neighbourhood_watch");
    }

    if (category === "reentry") {
        categories.add("reentry");
    }

    if (category === "rapid_threat") {
        categories.add("rapid_threat");
    }

    if (category === "volumetric_scan") {
        categories.add("volumetric_scan");
    }

    const classification = lowerText(envelope.details?.classification || envelope.rawAlert?.classification);
    if (classification === "proximity_approach") {
        categories.add("collision_risk");
        categories.add("manoeuvre");
    }

    return [...categories];
}

function countBy(values) {
    const counts = new Map();
    for (const value of values) {
        counts.set(value, (counts.get(value) || 0) + 1);
    }
    return counts;
}

function classifyPriority(score, rules = []) {
    const thresholdRules = getThresholdRules(rules);
    const match = thresholdRules.find((rule) => {
        const min = Number.isFinite(rule.minScore) ? rule.minScore : 0;
        const max = Number.isFinite(rule.maxScore) ? rule.maxScore : 100;
        return score >= min && score <= max;
    });
    return match?.priority || (score >= 80 ? "CRITICAL" : score >= 50 ? "HIGH" : score >= 25 ? "MEDIUM" : "LOW");
}

function buildRecommendation(categories, assetClassification, rules = []) {
    const categorySet = new Set(categories);
    const combinationRules = getCombinationRules(rules);
    const rankedMatches = combinationRules
        .filter((rule) => Array.isArray(rule.requiredCategories) && rule.requiredCategories.every((category) => categorySet.has(category)))
        .sort((a, b) => (b.weight || 0) - (a.weight || 0));

    if (rankedMatches.length) {
        const winner = rankedMatches[0];
        return {
            recommendation: winner.recommendationText || "Review immediately.",
            matchedRule: winner.ruleKey
        };
    }

    if (categorySet.has("collision_risk") || categorySet.has("conjunction")) {
        return {
            recommendation: "Immediate Monitoring",
            matchedRule: "fallback_conjunction_monitoring"
        };
    }

    if (categorySet.has("manoeuvre") && categorySet.has("neighbourhood_watch")) {
        return {
            recommendation: "Suspicious Behaviour",
            matchedRule: "fallback_manoeuvre_watch"
        };
    }

    if (categorySet.has("blind_spot") && assetClassification === "ADVERSARY") {
        return {
            recommendation: "Surveillance Opportunity",
            matchedRule: "fallback_blindspot_adversary"
        };
    }

    if (categorySet.has("rapid_threat") && categorySet.has("reentry")) {
        return {
            recommendation: "Critical Event",
            matchedRule: "fallback_rapid_reentry"
        };
    }

    return {
        recommendation: assetClassification === "INDIAN" ? "Continuous Monitoring" : "Review and classify.",
        matchedRule: "fallback_default"
    };
}

function buildIncidentSummary(envelope, categories, assetClassification, score, priority, recommendation) {
    const primary = envelope.primaryObjectName || envelope.secondaryObjectName || envelope.regionName || "Uncatalogued Object";
    const categoryText = categories.length ? categories.map((category) => category.replaceAll("_", " ")).join(", ") : "general activity";
    return `${primary} shows ${categoryText} with ${assetClassification.toLowerCase()} classification. Score ${score}/100.`;
}

async function loadOpenIncidentCandidates(incidentKey, envelope, config, transaction) {
    const incidentWindowMinutes = getIncidentWindowMinutes(config);
    const sameWindow = envelope.regionHash ? getSameRegionWindowMinutes(config) : getSameObjectWindowMinutes(config);
    const windowMinutes = Math.max(incidentWindowMinutes, sameWindow);
    const thresholdTime = new Date(envelope.occurredAt.getTime() - windowMinutes * 60000);

    return IncidentGroup.findAll({
        where: {
            incidentKey,
            status: {
                [Op.ne]: "closed"
            },
            lastDetectedAt: {
                [Op.gte]: thresholdTime
            }
        },
        order: [["lastDetectedAt", "DESC"]],
        transaction
    });
}

function pickBestCandidate(candidates, envelope) {
    if (!Array.isArray(candidates) || !candidates.length) {
        return null;
    }

    const normalizedPrimary = lowerText(envelope.primaryObjectName);
    const normalizedSecondary = lowerText(envelope.secondaryObjectName);
    const normalizedRegion = lowerText(envelope.regionHash || envelope.regionName);

    let best = null;
    let bestScore = -Infinity;
    for (const candidate of candidates) {
        const plain = toPlain(candidate);
        let score = 0;

        if (normalizedPrimary && lowerText(plain.primaryObjectName) === normalizedPrimary) {
            score += 30;
        }
        if (normalizedSecondary && lowerText(plain.secondaryObjectName) === normalizedSecondary) {
            score += 20;
        }
        if (normalizedRegion && lowerText(plain.regionHash) === normalizedRegion) {
            score += 25;
        }
        if (lowerText(plain.assetClassification) === lowerText(envelope.assetClassification)) {
            score += 10;
        }
        if (lowerText(plain.threatCategory) === lowerText(envelope.threatCategory)) {
            score += 10;
        }

        const elapsedMinutes = (envelope.occurredAt.getTime() - new Date(plain.lastDetectedAt).getTime()) / 60000;
        if (Number.isFinite(elapsedMinutes) && elapsedMinutes <= 720) {
            score += 10;
        }

        if (score > bestScore) {
            bestScore = score;
            best = candidate;
        }
    }

    if (bestScore < 20) {
        return null;
    }

    return best;
}

async function createOrUpdateIncident(alertRow, envelope, satelliteLookup, rules, transaction) {
    const configRule = getConfigRule(rules);
    const config = ruleConfig(configRule, {});
    const rawDetails = envelope.details || {};
    const rawAlert = envelope.rawAlert || rawDetails.rawAlert || {};
    const primaryNorad = firstFiniteNumber(
        rawDetails.primaryNoradId,
        rawDetails.primaryNorad,
        rawAlert.primaryNoradId,
        rawAlert.primaryNorad,
        alertRow?.primaryNoradId
    );
    const secondaryNorad = firstFiniteNumber(
        rawDetails.secondaryNoradId,
        rawDetails.secondaryNorad,
        rawAlert.secondaryNoradId,
        rawAlert.secondaryNorad,
        alertRow?.secondaryNoradId
    );
    const primaryCospar = normalizeText(rawDetails.primaryCosparId || rawDetails.primaryCospar || rawAlert.primaryCosparId || rawAlert.primaryCospar);
    const secondaryCospar = normalizeText(rawDetails.secondaryCosparId || rawDetails.secondaryCospar || rawAlert.secondaryCosparId || rawAlert.secondaryCospar);
    const primaryIdentity = resolveObjectIdentity({
        identifier: alertRow?.primaryId || envelope.primaryObjectName,
        fallbackName: envelope.primaryObjectName,
        rawNoradId: primaryNorad,
        rawCosparId: primaryCospar,
        satelliteLookup
    });
    const secondaryIdentity = resolveObjectIdentity({
        identifier: alertRow?.secondaryId || envelope.secondaryObjectName,
        fallbackName: envelope.secondaryObjectName,
        rawNoradId: secondaryNorad,
        rawCosparId: secondaryCospar,
        satelliteLookup
    });
    const assetClassification = inferAssetClassification({
        primaryObjectName: primaryIdentity.satellite?.name || envelope.primaryObjectName,
        secondaryObjectName: secondaryIdentity.satellite?.name || envelope.secondaryObjectName
    }, satelliteLookup);
    const identityEnvelope = {
        ...envelope,
        primaryObjectName: primaryIdentity.displayName,
        secondaryObjectName: secondaryIdentity.displayName,
        primaryIdentity,
        secondaryIdentity,
        primaryLabel: primaryIdentity.identifierLabel,
        secondaryLabel: secondaryIdentity.identifierLabel
    };
    const categories = buildMatchedCategories({ ...identityEnvelope, assetClassification });
    const incidentKey = buildIncidentKey(identityEnvelope, assetClassification);
    const candidates = await loadOpenIncidentCandidates(incidentKey, identityEnvelope, config, transaction);
    const bestCandidate = pickBestCandidate(candidates, identityEnvelope);
    const { recommendation, matchedRule } = buildRecommendation(categories, assetClassification, rules);
    const scoreBands = getScoreBands(config);
    const scoreCap = getScoreCap(config);

    const weightRules = getWeightRules(rules);
    const categoryCounts = countBy(categories);
    let score = 0;
    const scoreBreakdown = [];

    for (const category of categories) {
        const rule = weightRules.find((item) => lowerText(item.category) === lowerText(category));
        const weight = Number.isFinite(rule?.weight) ? rule.weight : 0;
        score += weight;
        scoreBreakdown.push({
            category,
            weight
        });
    }

    const combinationRules = getCombinationRules(rules);
    const combinationMatches = combinationRules.filter((rule) => Array.isArray(rule.requiredCategories) && rule.requiredCategories.every((category) => categories.includes(category)));
    for (const rule of combinationMatches) {
        const weight = Number.isFinite(rule.weight) ? rule.weight : 0;
        score += weight;
    }

    if (envelope.severity === "critical" || envelope.severity === "danger") {
        score += 10;
    } else if (envelope.severity === "warning") {
        score += 5;
    }

    score = Math.max(0, Math.min(scoreCap, Math.round(score)));
    const priority = classifyPriority(score, rules);
    const window = buildEventWindow(envelope, config);

    const sourceTypes = new Set();
    const linkedPrimarySat = primaryIdentity.satellite && primaryIdentity.satellite._modelName === "Satellite" ? primaryIdentity.satellite : null;
    const linkedSecondarySat = secondaryIdentity.satellite && secondaryIdentity.satellite._modelName === "Satellite" ? secondaryIdentity.satellite : null;

    if (envelope.sourceType) {
        sourceTypes.add(envelope.sourceType);
    }
    if (envelope.alertType) {
        sourceTypes.add(envelope.alertType);
    }

    const primaryName = primaryIdentity.displayName;
    const secondaryName = secondaryIdentity.displayName;

    const incidentPayload = {
        incidentUid: bestCandidate?.incidentUid || `INC-${Date.now()}-${crypto.randomBytes(4).toString("hex")}`,
        incidentKey,
        title: `${primaryName} Threat Insight`,
        summary: buildIncidentSummary(identityEnvelope, categories, assetClassification, score, priority, recommendation),
        recommendation,
        priority,
        status: "open",
        assetClassification,
        threatCategory: categories.includes("rapid_threat") ? "rapid_threat" : (categories[0] || "general"),
        primarySatelliteId: linkedPrimarySat?.id || bestCandidate?.primarySatelliteId || null,
        secondarySatelliteId: linkedSecondarySat?.id || bestCandidate?.secondarySatelliteId || null,
        trainingSessionId: envelope.trainingSessionId || bestCandidate?.trainingSessionId || null,
        primaryObjectName: primaryName,
        secondaryObjectName: secondaryName,
        regionName: envelope.regionName || bestCandidate?.regionName || null,
        regionHash: envelope.regionHash || bestCandidate?.regionHash || null,
        firstDetectedAt: bestCandidate ? toDate(bestCandidate.firstDetectedAt, envelope.occurredAt) : envelope.occurredAt,
        lastDetectedAt: envelope.occurredAt,
        lastCorrelationAt: envelope.occurredAt,
        eventCount: bestCandidate ? (bestCandidate.eventCount || 0) + 1 : 1,
        linkCount: bestCandidate ? (bestCandidate.linkCount || 0) + 1 : 1,
        confidence: Math.max(0.1, Math.min(1, score / 100)),
        threatScore: score,
        categorySummary: {
            categories,
            counts: Object.fromEntries(categoryCounts.entries())
        },
        sourceTypes: [...sourceTypes],
        metadata: {
            alertType: envelope.alertType,
            sourceName: envelope.sourceName,
            sourceType: envelope.sourceType,
            matchedRule,
            combinationMatches: combinationMatches.map((rule) => rule.ruleKey),
            threatRationale: buildThreatRationale({ ...envelope, primaryObjectName: primaryName, threatScore: score, summary: null }, categories, recommendation, matchedRule, envelope.alertType),
            correlationExplanation: buildCorrelationExplanation({ ...envelope, primaryObjectName: primaryName, threatScore: score }, categories, recommendation, matchedRule),
            windowMinutes: {
                incident: getIncidentWindowMinutes(config),
                sameObject: getSameObjectWindowMinutes(config),
                sameRegion: getSameRegionWindowMinutes(config)
            }
        }
    };

    let incident;
    if (bestCandidate) {
        incident = await bestCandidate.update(incidentPayload, { transaction });
    } else {
        incident = await IncidentGroup.create(incidentPayload, { transaction });
    }

    const correlationKey = buildCorrelationKey(incident.incidentKey, envelope.eventKey || String(alertRow.id));
    await AlertCorrelation.upsert({
        correlationKey,
        incidentGroupId: incident.id,
        alertId: alertRow.id,
        correlationType: envelope.alertType,
        sourceType: envelope.sourceType || null,
        sourceModule: envelope.sourceName || null,
        primaryObjectName: primaryName,
        secondaryObjectName: secondaryName,
        regionHash: envelope.regionHash || null,
        matchedCategories: categories,
        matchScore: score,
        confidence: Math.max(0.1, Math.min(1, score / 100)),
        rationale: buildIncidentSummary(envelope, categories, assetClassification, score, priority, recommendation),
        summary: recommendation,
        decision: bestCandidate ? "merged" : "created",
        windowStart: window.start,
        windowEnd: window.end,
        algorithmVersion: ALGORITHM_VERSION,
        metadata: {
            severity: envelope.severity,
            assetClassification,
            categories,
            sourceEventKey: envelope.eventKey
        }
    }, { transaction });

    const correlation = await AlertCorrelation.findOne({
        where: { correlationKey },
        transaction
    });

    const existingLink = await IncidentEventLink.findOne({
        where: {
            incidentGroupId: incident.id,
            alertId: alertRow.id
        },
        transaction
    });

    const linkPayload = {
        incidentGroupId: incident.id,
        alertId: alertRow.id,
        alertCorrelationId: correlation?.id || null,
        eventKey: envelope.eventKey || `alert:${alertRow.id}`,
        relationType: "member",
        linkRole: bestCandidate ? "supporting" : "primary",
        sourceType: envelope.sourceType || null,
        moduleName: envelope.sourceName || null,
        linkedAt: envelope.occurredAt,
        metadata: {
            categories,
            severity: envelope.severity
        }
    };

    if (existingLink) {
        await existingLink.update(linkPayload, { transaction });
    } else {
        await IncidentEventLink.create(linkPayload, { transaction });
    }

    const currentLinks = await IncidentEventLink.findAll({
        where: { incidentGroupId: incident.id },
        include: [{ association: "alert" }],
        transaction
    });

    const linkedAlerts = currentLinks
        .map((link) => link.alert ? link.alert.get({ plain: true }) : null)
        .filter(Boolean);

    const recalculatedCategories = [];
    const recalculatedSourceTypes = new Set();
    const primaryNames = [];
    const secondaryNames = [];
    let earliest = null;
    let latest = null;

    for (const linked of linkedAlerts) {
        const linkedEnvelope = extractAlertAnchor(linked);
        const linkedCategories = buildMatchedCategories(linkedEnvelope);
        recalculatedCategories.push(...linkedCategories);
        if (linkedEnvelope.sourceType) {
            recalculatedSourceTypes.add(linkedEnvelope.sourceType);
        }
        if (linkedEnvelope.primaryObjectName) {
            primaryNames.push(linkedEnvelope.primaryObjectName);
        }
        if (linkedEnvelope.secondaryObjectName) {
            secondaryNames.push(linkedEnvelope.secondaryObjectName);
        }
        if (!earliest || linkedEnvelope.occurredAt < earliest) {
            earliest = linkedEnvelope.occurredAt;
        }
        if (!latest || linkedEnvelope.occurredAt > latest) {
            latest = linkedEnvelope.occurredAt;
        }
    }

    const recalculatedCategoryCounts = countBy(recalculatedCategories);
    const combinedCategories = [...new Set(recalculatedCategories)];
    const recalculatedAssetClassification = inferAssetClassification({
        primaryObjectName: primaryNames[0] || incident.primaryObjectName,
        secondaryObjectName: secondaryNames[0] || incident.secondaryObjectName
    }, satelliteLookup);
    const recalculatedRecommendation = buildRecommendation(combinedCategories, recalculatedAssetClassification, rules);
    let recalculatedScore = 0;
    for (const category of combinedCategories) {
        const rule = weightRules.find((item) => lowerText(item.category) === lowerText(category));
        recalculatedScore += Number.isFinite(rule?.weight) ? rule.weight : 0;
    }
    for (const rule of combinationRules) {
        if (Array.isArray(rule.requiredCategories) && rule.requiredCategories.every((category) => combinedCategories.includes(category))) {
            recalculatedScore += Number.isFinite(rule.weight) ? rule.weight : 0;
        }
    }
    recalculatedScore = Math.max(0, Math.min(scoreCap, Math.round(recalculatedScore)));
    const recalculatedPriority = classifyPriority(recalculatedScore, rules);

    await incident.update({
        assetClassification: recalculatedAssetClassification,
        threatCategory: combinedCategories.includes("rapid_threat") ? "rapid_threat" : (combinedCategories[0] || "general"),
        primaryObjectName: primaryNames[0] || incident.primaryObjectName,
        secondaryObjectName: secondaryNames[0] || incident.secondaryObjectName,
        firstDetectedAt: earliest || incident.firstDetectedAt,
        lastDetectedAt: latest || incident.lastDetectedAt,
        lastCorrelationAt: envelope.occurredAt,
        eventCount: linkedAlerts.length,
        linkCount: linkedAlerts.length,
        confidence: Math.max(0.1, Math.min(1, recalculatedScore / 100)),
        threatScore: recalculatedScore,
        priority: recalculatedPriority,
        recommendation: recalculatedRecommendation.recommendation,
        summary: buildIncidentSummary(
            {
                primaryObjectName: primaryNames[0] || incident.primaryObjectName,
                secondaryObjectName: secondaryNames[0] || incident.secondaryObjectName,
                regionName: incident.regionName,
                alertType: envelope.alertType
            },
            combinedCategories,
            recalculatedAssetClassification,
            recalculatedScore,
            recalculatedPriority,
            recalculatedRecommendation.recommendation
        ),
        categorySummary: {
            categories: combinedCategories,
            counts: Object.fromEntries(recalculatedCategoryCounts.entries())
        },
        sourceTypes: [...new Set([...incident.sourceTypes || [], ...recalculatedSourceTypes])],
        metadata: {
            ...(incident.metadata || {}),
            threatRationale: buildThreatRationale({
                primaryObjectName: primaryNames[0] || incident.primaryObjectName,
                threatScore: recalculatedScore,
                summary: buildIncidentSummary(
                    {
                        primaryObjectName: primaryNames[0] || incident.primaryObjectName,
                        secondaryObjectName: secondaryNames[0] || incident.secondaryObjectName,
                        regionName: incident.regionName,
                        alertType: envelope.alertType
                    },
                    combinedCategories,
                    recalculatedAssetClassification,
                    recalculatedScore,
                    recalculatedPriority,
                    recalculatedRecommendation.recommendation
                )
            }, combinedCategories, recalculatedRecommendation.recommendation, combinationMatches[0] || matchedRule || null, envelope.alertType),
            correlationExplanation: buildCorrelationExplanation({
                primaryObjectName: primaryNames[0] || incident.primaryObjectName,
                threatScore: recalculatedScore
            }, combinedCategories, recalculatedRecommendation.recommendation, combinationMatches[0] || matchedRule || null)
        }
    }, { transaction });

    const scorePayload = {
        incidentGroupId: incident.id,
        score: recalculatedScore,
        priority: recalculatedPriority,
        level: recalculatedPriority,
        breakdown: {
            categories: combinedCategories,
            counts: Object.fromEntries(recalculatedCategoryCounts.entries()),
            weights: combinedCategories.map((category) => {
                const rule = weightRules.find((item) => lowerText(item.category) === lowerText(category));
                return {
                    category,
                    weight: Number.isFinite(rule?.weight) ? rule.weight : 0
                };
            }),
            combinationRules: combinationRules
                .filter((rule) => Array.isArray(rule.requiredCategories) && rule.requiredCategories.every((category) => combinedCategories.includes(category)))
                .map((rule) => ({
                    ruleKey: rule.ruleKey,
                    weight: Number.isFinite(rule.weight) ? rule.weight : 0,
                    recommendation: rule.recommendationText || null
                }))
        },
        weightedCategories: combinedCategories,
        sourceCount: linkedAlerts.length,
        confidence: Math.max(0.1, Math.min(1, recalculatedScore / 100)),
        recommendedAction: recalculatedRecommendation.recommendation,
        algorithmVersion: ALGORITHM_VERSION,
        modelVersion: "1.0",
        computedAt: envelope.occurredAt
    };

    const existingScore = await ThreatScore.findOne({
        where: {
            incidentGroupId: incident.id,
            computedAt: envelope.occurredAt,
            algorithmVersion: ALGORITHM_VERSION
        },
        transaction
    });

    if (existingScore) {
        await existingScore.update(scorePayload, { transaction });
    } else {
        await ThreatScore.create(scorePayload, { transaction });
    }

    return {
        incident,
        correlationType: envelope.alertType,
        score: recalculatedScore,
        priority: recalculatedPriority,
        recommendation: recalculatedRecommendation.recommendation,
        categories: combinedCategories
    };
}

async function ingestOperationalAlerts(alertInputs = [], context = {}) {
    const inputs = Array.isArray(alertInputs) ? alertInputs.filter(Boolean) : [alertInputs].filter(Boolean);
    if (!inputs.length) {
        return {
            processedCount: 0,
            incidents: []
        };
    }

    const eventKeys = [...new Set(inputs.map((input) => normalizeText(input?.eventKey || input?.event_key)).filter(Boolean))];
    const alerts = eventKeys.length
        ? await OperationalAlert.findAll({
            where: {
                eventKey: {
                    [Op.in]: eventKeys
                }
            }
        })
        : [];

    const alertsByEventKey = new Map(alerts.map((alert) => [alert.eventKey, alert.get({ plain: true })]));
    const rules = await ensureDefaultCorrelationRules();
    const satelliteLookup = await resolveSatelliteLookup(alerts.length ? alerts : inputs);

    const incidents = [];
    await sequelize.transaction(async (transaction) => {
        for (const input of inputs) {
            const eventKey = normalizeText(input?.eventKey || input?.event_key);
            const alertRow = alertsByEventKey.get(eventKey) || toPlain(input);
            if (!alertRow) {
                continue;
            }

            const envelope = extractAlertAnchor({
                ...alertRow,
                details: alertRow.details || input.details || null
            });

            const merged = await createOrUpdateIncident(alertRow, {
                ...envelope,
                alertType: alertRow.alertType || input.alertType || context.alertType || "generic",
                sourceType: alertRow.sourceType || input.sourceType || context.sourceType || "backend_service",
                sourceName: alertRow.sourceName || input.sourceName || context.sourceName || "System",
                trainingSessionId: alertRow.trainingSessionId ?? input.trainingSessionId ?? null,
                eventKey: alertRow.eventKey || eventKey,
                details: alertRow.details || input.details || null,
                rawAlert: alertRow.details?.rawAlert || input.details?.rawAlert || null
            }, satelliteLookup, rules, transaction);

            incidents.push({
                incident: merged.incident.get({ plain: true }),
                score: merged.score,
                priority: merged.priority,
                recommendation: merged.recommendation,
                categories: merged.categories
            });
        }
    });

    return {
        processedCount: incidents.length,
        incidents
    };
}

async function rebuildIncidentsFromAlerts({ limit = 5000 } = {}) {
    const alerts = await OperationalAlert.findAll({
        where: {
            trainingSessionId: null
        },
        order: [["occurredAt", "ASC"], ["createdAt", "ASC"]],
        limit: Math.max(1, Math.min(Number(limit) || 5000, 5000))
    });

    if (!alerts.length) {
        return {
            processedCount: 0,
            incidents: []
        };
    }

    await IncidentEventLink.destroy({ where: {} });
    await AlertCorrelation.destroy({ where: {} });
    await ThreatScore.destroy({ where: {} });
    await IncidentGroup.destroy({ where: {} });

    return ingestOperationalAlerts(alerts.map((alert) => alert.get({ plain: true })));
}

async function listUnifiedThreatInsights({
    classification = null,
    priority = null,
    page = 1,
    pageSize = 5,
    viewMode = "top10",
    trainingSessionId = null
} = {}) {
    const where = {};

    if (classification && classification !== "all") {
        where.assetClassification = classification.toUpperCase();
    }

    if (priority && priority !== "all") {
        where.priority = priority.toUpperCase();
    }

    if (trainingSessionId !== null && trainingSessionId !== undefined && trainingSessionId !== "") {
        where.trainingSessionId = Number(trainingSessionId);
    } else {
        where.trainingSessionId = null;
    }

    const incidents = await IncidentGroup.findAll({
        where,
        include: [
            {
                association: "eventLinks",
                include: [{ association: "alert" }]
            },
            {
                association: "primarySatellite"
            },
            {
                association: "secondarySatellite"
            }
        ],
        order: [["lastDetectedAt", "DESC"], ["createdAt", "DESC"]]
    });

    const enrichedIncidents = incidents.map((incident) => {
        const plain = incident.get({ plain: true });
        const linkedAlerts = Array.isArray(plain.eventLinks)
            ? plain.eventLinks
                .map((link) => link.alert)
                .filter(Boolean)
            : [];
        const primaryIdentity = resolveObjectIdentity({
            identifier: plain.primaryObjectName || plain.primary_object_name,
            fallbackName: plain.primarySatellite?.name || plain.primaryObjectName || plain.primary_object_name,
            rawNoradId: plain.primarySatellite?.noradId || null,
            rawCosparId: plain.primarySatellite?.cosparId || null,
            satelliteLookup: new Map()
        });
        const secondaryIdentity = resolveObjectIdentity({
            identifier: plain.secondaryObjectName || plain.secondary_object_name,
            fallbackName: plain.secondarySatellite?.name || plain.secondaryObjectName || plain.secondary_object_name,
            rawNoradId: plain.secondarySatellite?.noradId || null,
            rawCosparId: plain.secondarySatellite?.cosparId || null,
            satelliteLookup: new Map()
        });
        const linkedModules = [...new Set(linkedAlerts.map((alert) => getModuleLabel(alert.alertType, alert.sourceName)).filter(Boolean))];
        const incidentTypeLabel = MODULE_LABELS[lowerText(plain.threatCategory)] || MODULE_LABELS[lowerText(plain.metadata?.alertType)] || "Operational Incident";
        const whyThisMatters = buildOperationalWhyBullets(
            Array.isArray(plain.categorySummary?.categories) ? plain.categorySummary.categories : [],
            plain.metadata?.alertType || plain.threatCategory,
            plain
        );
        const queueMetrics = deriveIncidentQueueMetrics(plain, linkedAlerts);
        const threatRationale = plain.metadata?.threatRationale || {
            typeLabel: incidentTypeLabel,
            bullets: whyThisMatters,
            recommendation: plain.recommendation || "Review immediately.",
            prioritySummary: `${plain.threatScore}/100 threat score assigned from the correlated alerts.`
        };
        const correlationExplanation = plain.metadata?.correlationExplanation || {
            summary: `${primaryIdentity.displayName} is correlated with related module activity.`,
            bullets: [
                "The alert set was merged into a single incident to reduce operator noise.",
                `Linked modules: ${linkedModules.join(", ") || "none identified"}.`
            ]
        };
        return {
            ...plain,
            displayPrimaryName: primaryIdentity.displayName,
            displaySecondaryName: secondaryIdentity.displayName,
            primaryIdentity,
            secondaryIdentity,
            incidentTypeLabel,
            whyThisMatters,
            assessment: whyThisMatters,
            threatRationale,
            correlationExplanation,
            linkedModules,
            tca: queueMetrics.tca,
            missDistanceKm: queueMetrics.missDistanceKm,
            relativeVelocityKmS: queueMetrics.relativeVelocityKmS,
            threatBadge: plain.priority === "CRITICAL"
                ? "Immediate Action Required"
                : plain.priority === "HIGH"
                    ? "Monitor"
                    : plain.priority === "MEDIUM"
                        ? "Monitor"
                        : "Informational",
            linkedEvents: linkedAlerts.map((alert) => {
                const eventDetails = extractAlertEventDetails(alert);
                return {
                    id: alert.id,
                    eventKey: alert.eventKey,
                    alertType: alert.alertType,
                    title: alert.title,
                    severity: alert.severity,
                    occurredAt: alert.occurredAt,
                    sourceName: alert.sourceName,
                    moduleName: getModuleLabel(alert.alertType, alert.sourceName),
                    sourceType: alert.sourceType,
                    primaryId: alert.primaryId,
                    secondaryId: alert.secondaryId,
                    missDistanceKm: alert.closestDistanceKm ?? eventDetails.missDistanceKm,
                    relativeVelocityKmS: alert.details?.relativeVelocityKmS ?? eventDetails.relativeVelocityKmS,
                    tca: eventDetails.tca,
                    description: alert.message,
                    details: alert.details
                };
            }),
            linkedEventCount: linkedAlerts.length,
            sortPriority: queueMetrics.sortPriority,
            sortDistanceKm: queueMetrics.sortDistanceKm,
            sortTca: queueMetrics.sortTca
        };
    });

    const sortedIncidents = enrichedIncidents.sort((a, b) => {
        const priorityDelta = (a.sortPriority ?? 4) - (b.sortPriority ?? 4);
        if (priorityDelta !== 0) {
            return priorityDelta;
        }
        const distanceDelta = (a.sortDistanceKm ?? Number.POSITIVE_INFINITY) - (b.sortDistanceKm ?? Number.POSITIVE_INFINITY);
        if (distanceDelta !== 0) {
            return distanceDelta;
        }
        const tcaDelta = (a.sortTca ?? Number.POSITIVE_INFINITY) - (b.sortTca ?? Number.POSITIVE_INFINITY);
        if (tcaDelta !== 0) {
            return tcaDelta;
        }
        const updatedDelta = getComparableDate(b.lastDetectedAt) - getComparableDate(a.lastDetectedAt);
        if (updatedDelta !== 0) {
            return updatedDelta;
        }
        return getComparableDate(b.createdAt) - getComparableDate(a.createdAt);
    });

    const cappedIncidents = viewMode === "all" ? sortedIncidents : sortedIncidents.slice(0, 10);
    const totalCount = cappedIncidents.length;
    const safePageSize = Math.max(1, Math.min(Number(pageSize) || 5, 5));
    const totalPages = Math.max(1, Math.ceil(totalCount / safePageSize));
    const safePage = Math.max(1, Math.min(Number(page) || 1, totalPages));
    const startIndex = (safePage - 1) * safePageSize;
    const pageIncidents = cappedIncidents.slice(startIndex, startIndex + safePageSize);

    return {
        incidents: pageIncidents,
        pagination: {
            page: safePage,
            pageSize: safePageSize,
            totalCount,
            totalPages,
            startIndex: totalCount ? startIndex + 1 : 0,
            endIndex: Math.min(startIndex + safePageSize, totalCount),
            viewMode: viewMode === "all" ? "all" : "top10"
        }
    };
}

async function getCorrelationRules() {
    return ensureDefaultCorrelationRules();
}

module.exports = {
    ALGORITHM_VERSION,
    ensureDefaultCorrelationRules,
    ingestOperationalAlerts,
    listUnifiedThreatInsights,
    getCorrelationRules,
    rebuildIncidentsFromAlerts
};
