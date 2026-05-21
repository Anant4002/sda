/**
 * Structured Error Taxonomy
 */

class OperationalError extends Error {
    constructor(message, details = {}) {
        super(message);
        this.name = "OperationalError";
        this.details = details;
    }
}

class ValidationError extends OperationalError {
    constructor(message, details = {}) {
        super(message, details);
        this.name = "ValidationError";
    }
}

class PropagationError extends OperationalError {
    constructor(message, details = {}) {
        super(message, details);
        this.name = "PropagationError";
    }
}

class ExternalSourceError extends OperationalError {
    constructor(message, details = {}) {
        super(message, details);
        this.name = "ExternalSourceError";
    }
}

class AnalysisTimeoutError extends OperationalError {
    constructor(message, details = {}) {
        super(message, details);
        this.name = "AnalysisTimeoutError";
    }
}

class ConfigurationError extends OperationalError {
    constructor(message, details = {}) {
        super(message, details);
        this.name = "ConfigurationError";
    }
}

module.exports = {
    OperationalError,
    ValidationError,
    PropagationError,
    ExternalSourceError,
    AnalysisTimeoutError,
    ConfigurationError
};
