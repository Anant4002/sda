const INDIAN_SATELLITE_PATTERNS = [
    /^(GSAT|INSAT|CARTOSAT|RISAT|IRNSS|NAVIC|ASTROSAT|RESOURCESAT|OCEANSAT|SCATSAT|EMISAT|HYSIS|CHANDRAYAAN|ADITYA|NVS-|ANAND|AZAADSAT|YOUTHSAT|SARAL)/i,
    /^EOS-\d+/i,
    /^INS-\d+/i,
    /^MICROSAT-(R|TD)/i
];

function isIndianSatelliteName(name) {
    return INDIAN_SATELLITE_PATTERNS.some((pattern) => pattern.test(name || ""));
}

module.exports = {
    isIndianSatelliteName
};
