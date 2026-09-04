const { test, describe } = require("@jest/globals");
const assert = require("node:assert/strict");
const request = require("supertest");
const app = require("../app");

describe("Application-level routes", () => {
    test("should return 404 JSON for an unknown route", async () => {
        const response = await request(app)
            .get("/api/v1/does-not-exist")
            .expect("Content-Type", /json/)
            .expect(404);

        assert.deepEqual(response.body, {
            error: "This route does not exist"
        });
    });
});
