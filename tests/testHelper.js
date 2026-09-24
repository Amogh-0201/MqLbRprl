const mongoose = require("mongoose");

jest.mock("../services/inventoryService", () => {
    return {
        isFlashSaleActive: jest.fn().mockResolvedValue(false),
        reserveStock: jest.fn().mockResolvedValue({ status: 1, record: {} }),
        completeReservation: jest.fn().mockResolvedValue(1),
        releaseReservation: jest.fn().mockResolvedValue(1),
        getReservation: jest.fn().mockResolvedValue(null),
        getAvailableStock: jest.fn().mockResolvedValue(100),
        initializeFlashSale: jest.fn().mockResolvedValue(),
        deactivateFlashSale: jest.fn().mockResolvedValue()
    };
});

jest.mock("../queues/orderQueue", () => {
    return {
        add: jest.fn().mockResolvedValue({ id: "mock-job-id" }),
        getJob: jest.fn().mockResolvedValue(null),
        getJobs: jest.fn().mockResolvedValue([]),
        close: jest.fn().mockResolvedValue()
    };
});

const app = require("../app");
const request = require("supertest");
const { MongoMemoryServer } = require("mongodb-memory-server");

// Monkey-patch startSession to bypass transaction requirement on standalone MongoMemoryServer
const originalStartSession = mongoose.startSession.bind(mongoose);
mongoose.startSession = async function() {
    const session = await originalStartSession();
    session.withTransaction = async function(cb) {
        return await cb();
    };
    return session;
};

let mongoServer;

jest.setTimeout(120000);

/**
 * Initializes the database used by the integration tests.
 * Supertest invokes the exported Express app directly, so no HTTP server is needed.
 */
async function setupTestEnvironment() {
    mongoServer = await MongoMemoryServer.create();
    await mongoose.connect(mongoServer.getUri());
}

/**
 * Gracefully disconnects MongoDB after the suite completes.
 */
async function teardownTestEnvironment() {
    if (mongoose.connection.readyState !== 0) {
        await mongoose.disconnect();
    }
    if (mongoServer) {
        await mongoServer.stop();
        mongoServer = null;
    }
}

/**
 * Sends a request through the Express app and returns the response shape used by
 * the route tests.
 */
async function apiRequest(method, endpoint, options = {}) {
    const { body, token } = options;
    let testRequest = request(app)[method.toLowerCase()](endpoint);

    if (body) {
        testRequest = testRequest.send(body);
    }
    if (token) {
        testRequest = testRequest.set("Authorization", `Bearer ${token}`);
    }

    const response = await testRequest;
    const isJson = response.headers["content-type"]?.includes("application/json");

    return {
        status: response.status,
        data: isJson ? response.body : response.text
    };
}

/**
 * Generates a unique email with timestamp to avoid MongoDB unique constraint conflicts.
 */
function uniqueEmail(prefix = "test") {
    const random = Math.floor(Math.random() * 10000);
    return `${prefix}_${Date.now()}_${random}@test.com`;
}

module.exports = {
    setupTestEnvironment,
    teardownTestEnvironment,
    apiRequest,
    uniqueEmail
};
