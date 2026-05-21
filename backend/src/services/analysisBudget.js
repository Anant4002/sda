const { operationalConfig } = require("../config/operationalConfig");

const DEFAULT_ANALYSIS_TIMEOUT_MS = Number.isFinite(operationalConfig.analysisTimeoutMs)
    ? operationalConfig.analysisTimeoutMs
    : 12000;

function createAnalysisDeadline(timeoutMs = DEFAULT_ANALYSIS_TIMEOUT_MS) {
    return Date.now() + Math.max(1000, timeoutMs);
}

function createAnalysisTimeoutError(label, timeoutMs = DEFAULT_ANALYSIS_TIMEOUT_MS) {
    const error = new Error(`${label} timed out after ${Math.round(timeoutMs / 1000)}s.`);
    error.code = "ANALYSIS_TIMEOUT";
    error.statusCode = 504;
    return error;
}

function assertAnalysisWithinDeadline(deadlineMs, label, timeoutMs = DEFAULT_ANALYSIS_TIMEOUT_MS) {
    if (Date.now() > deadlineMs) {
        throw createAnalysisTimeoutError(label, timeoutMs);
    }
}

module.exports = {
    DEFAULT_ANALYSIS_TIMEOUT_MS,
    assertAnalysisWithinDeadline,
    createAnalysisDeadline,
    createAnalysisTimeoutError
};
