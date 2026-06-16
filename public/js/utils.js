export function formatDateTime(isoString) {
    return new Date(isoString).toLocaleString();
}

export function formatNumber(value, digits = 0) {
    return Number(value).toFixed(digits);
}

export function formatLatitude(value) {
    const suffix = value >= 0 ? "N" : "S";
    return `${Math.abs(value).toFixed(2)}\u00B0 ${suffix}`;
}

export function formatLongitude(value) {
    const suffix = value >= 0 ? "E" : "W";
    return `${Math.abs(value).toFixed(2)}\u00B0 ${suffix}`;
}

export function normalizeSearchValue(value) {
    return (value || "").trim().toUpperCase();
}

export function escapeHtml(value) {
    return String(value ?? "")
        .replaceAll("&", "&amp;")
        .replaceAll("<", "&lt;")
        .replaceAll(">", "&gt;")
        .replaceAll("\"", "&quot;")
        .replaceAll("'", "&#39;");
}

export function safeHtml(strings, ...values) {
    return strings.reduce((result, str, i) => {
        const value = values[i - 1];
        const safeValue = value instanceof safeHtml.SafeString ? value.toString() : escapeHtml(value);
        return result + safeValue + str;
    });
}

safeHtml.SafeString = class {
    constructor(html) {
        this.html = html;
    }
    toString() {
        return this.html;
    }
};

export function markSafe(html) {
    return new safeHtml.SafeString(html);
}

export function deriveSatelliteGroupLabel(name) {
    const safeName = (name || "").trim().toUpperCase();
    if (!safeName) {
        return "UNKNOWN";
    }

    const withoutParens = safeName.replace(/\s*\(.*?\)\s*/g, " ").trim();
    const alphaPrefixMatch = withoutParens.match(/^[A-Z]+(?:[- ][A-Z]+)*/);
    return alphaPrefixMatch ? alphaPrefixMatch[0].replace(/[- ]+$/, "") : withoutParens;
}

export function buildSatelliteGroups(satellites) {
    const groupMap = new Map();

    for (const satellite of satellites) {
        const groupLabel = deriveSatelliteGroupLabel(satellite.name);
        const existing = groupMap.get(groupLabel);

        if (existing) {
            existing.count += 1;
            existing.satellites.push(satellite);
            if (satellite.isIndian) {
                existing.indianCount += 1;
            }
            continue;
        }

        groupMap.set(groupLabel, {
            label: groupLabel,
            count: 1,
            indianCount: satellite.isIndian ? 1 : 0,
            satellites: [satellite]
        });
    }

    return Array.from(groupMap.values()).sort((first, second) => {
        // Sort by group size descending, then alphabetically
        if (second.count !== first.count) {
            return second.count - first.count;
        }
        return first.label.localeCompare(second.label);
    });
}

const COMMERCIAL_SATELLITE_NAME_REGEX = /STARLINK|ONEWEB|KUIPER|DIGUI/i;

export function isCommercialSatelliteName(name) {
    return COMMERCIAL_SATELLITE_NAME_REGEX.test(String(name || ""));
}

const THREAT_SATELLITE_NAME_REGEX = /YAOGAN|FENGYUN|SJ-|SHIYAN|BEIDOU/i;

export function isThreatSatellite(satellite) {
    const name = String(satellite?.name || "").toUpperCase();
    return THREAT_SATELLITE_NAME_REGEX.test(name);
}

export function computeBounds(points) {
    return points.reduce((bounds, point) => ({
        minLat: Math.min(bounds.minLat, point.lat),
        maxLat: Math.max(bounds.maxLat, point.lat),
        minLon: Math.min(bounds.minLon, point.lon),
        maxLon: Math.max(bounds.maxLon, point.lon)
    }), {
        minLat: Infinity,
        maxLat: -Infinity,
        minLon: Infinity,
        maxLon: -Infinity
    });
}

export function isValidSatelliteRecord(record) {
    return Boolean(
        record &&
        typeof record.name === "string" &&
        typeof record.line1 === "string" &&
        typeof record.line2 === "string" &&
        record.line1.startsWith("1 ") &&
        record.line2.startsWith("2 ")
    );
}
