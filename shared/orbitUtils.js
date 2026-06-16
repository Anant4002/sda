(function attachOrbitUtils(root, factory) {
    const orbitUtils = factory();

    if (typeof module === "object" && module.exports) {
        module.exports = orbitUtils;
    }

    root.orbitUtils = orbitUtils;
}(typeof globalThis !== "undefined" ? globalThis : this, function createOrbitUtils() {
    const MIN_SAMPLES_PER_REV = 180;
    const MIN_INTERVAL_S = 10;

    // LEO paths need period-scaled sampling to avoid straight-line distortion.
    function getSampleIntervalSeconds(satrec) {
        if (!satrec || !Number.isFinite(satrec.no) || satrec.no <= 0) {
            return MIN_INTERVAL_S;
        }

        const periodMinutes = (2 * Math.PI) / satrec.no;
        return Math.max(MIN_INTERVAL_S, (periodMinutes * 60) / MIN_SAMPLES_PER_REV);
    }

    return {
        getSampleIntervalSeconds
    };
}));
