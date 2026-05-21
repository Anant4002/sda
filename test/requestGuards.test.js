const test = require("node:test");
const assert = require("node:assert/strict");
const {
    validateSatelliteQuery,
    requireSyncAccess
} = require("../backend/src/middleware/requestGuards");

function createResponseDouble() {
    return {
        headers: {},
        statusCode: 200,
        body: null,
        set(name, value) {
            this.headers[name] = value;
        },
        status(code) {
            this.statusCode = code;
            return this;
        },
        json(payload) {
            this.body = payload;
            return this;
        }
    };
}

test("validateSatelliteQuery accepts valid satellite filters", () => {
    const req = {
        query: {
            limit: "100",
            offset: "20",
            search: "STARLINK"
        }
    };
    const res = createResponseDouble();
    let nextCalled = false;

    validateSatelliteQuery(req, res, () => {
        nextCalled = true;
    });

    assert.equal(nextCalled, true);
    assert.equal(res.statusCode, 200);
});

test("validateSatelliteQuery rejects an invalid limit", () => {
    const req = {
        query: {
            limit: "0"
        }
    };
    const res = createResponseDouble();
    let nextCalled = false;

    validateSatelliteQuery(req, res, () => {
        nextCalled = true;
    });

    assert.equal(nextCalled, false);
    assert.equal(res.statusCode, 400);
    assert.match(res.body.message, /limit must be an integer/i);
});

test("requireSyncAccess allows loopback requests when no API key is configured", () => {
    const req = {
        headers: {},
        ip: "127.0.0.1",
        socket: {
            remoteAddress: "127.0.0.1"
        },
        get() {
            return "";
        }
    };
    const res = createResponseDouble();
    let nextCalled = false;

    requireSyncAccess(req, res, () => {
        nextCalled = true;
    });

    assert.equal(nextCalled, true);
    assert.equal(res.statusCode, 200);
});
