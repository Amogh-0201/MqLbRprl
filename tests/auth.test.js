const { test, describe, beforeAll, afterAll } = require("@jest/globals");
const assert = require("node:assert/strict");
const User = require("../models/user");
const { setupTestEnvironment, teardownTestEnvironment, apiRequest, uniqueEmail } = require("./testHelper");

describe("Authentication & User Profile Endpoints", () => {
    const createdUserEmails = [];

    beforeAll(async () => {
        await setupTestEnvironment();
    });

    afterAll(async () => {
        // Clean up users created during tests
        if (createdUserEmails.length > 0) {
            await User.deleteMany({ email: { $in: createdUserEmails } });
        }
        await teardownTestEnvironment();
    });

    describe("POST /api/v1/auth/register", () => {
        test("should register a normal user and return a JWT token (201 Created)", async () => {
            const email = uniqueEmail("buyer");
            createdUserEmails.push(email);

            const res = await apiRequest("POST", "/api/v1/auth/register", {
                body: {
                    name: "Alice Johnson",
                    email,
                    password: "password123",
                    address: "123 Elm Street"
                }
            });

            assert.equal(res.status, 201);
            assert.ok(res.data.token, "Expected token in response");
            assert.equal(typeof res.data.token, "string");
        });

        test("should register an admin when role is explicitly passed (201 Created)", async () => {
            const email = uniqueEmail("admin");
            createdUserEmails.push(email);

            const res = await apiRequest("POST", "/api/v1/auth/register", {
                body: {
                    name: "Bob Admin",
                    email,
                    password: "password123",
                    address: "456 Oak Avenue",
                    role: "admin"
                }
            });

            assert.equal(res.status, 201);
            assert.ok(res.data.token, "Expected token in response");

            // Verify admin role stored in database
            const userInDb = await User.findOne({ email });
            assert.equal(userInDb.role, "admin");
        });

        test("should return 400 Bad Request when required fields are missing", async () => {
            const res = await apiRequest("POST", "/api/v1/auth/register", {
                body: {
                    email: uniqueEmail("missing_fields"),
                    password: "password123"
                    // name and address are missing
                }
            });

            assert.equal(res.status, 400);
            assert.ok(res.data.error);
        });

        test("should return 400 Bad Request if email already exists", async () => {
            const email = uniqueEmail("duplicate");
            createdUserEmails.push(email);

            // First registration
            const firstRes = await apiRequest("POST", "/api/v1/auth/register", {
                body: {
                    name: "First User",
                    email,
                    password: "password123",
                    address: "789 Pine Road"
                }
            });
            assert.equal(firstRes.status, 201);

            // Duplicate registration
            const secondRes = await apiRequest("POST", "/api/v1/auth/register", {
                body: {
                    name: "Duplicate User",
                    email,
                    password: "password123",
                    address: "789 Pine Road"
                }
            });
            assert.equal(secondRes.status, 400);
            assert.match(secondRes.data.error, /already exists/i);
        });
    });

    describe("POST /api/v1/auth/login", () => {
        const userEmail = uniqueEmail("login_user");
        const userPassword = "securePassword!456";

        beforeAll(async () => {
            createdUserEmails.push(userEmail);
            await apiRequest("POST", "/api/v1/auth/register", {
                body: {
                    name: "Login Tester",
                    email: userEmail,
                    password: userPassword,
                    address: "100 Test Blvd"
                }
            });
        });

        test("should login successfully with valid credentials (200 OK)", async () => {
            const res = await apiRequest("POST", "/api/v1/auth/login", {
                body: {
                    email: userEmail,
                    password: userPassword
                }
            });

            assert.equal(res.status, 200);
            assert.ok(res.data.token, "Expected token on successful login");
        });

        test("should return 401 Unauthorized for incorrect password", async () => {
            const res = await apiRequest("POST", "/api/v1/auth/login", {
                body: {
                    email: userEmail,
                    password: "WrongPassword999"
                }
            });

            assert.equal(res.status, 401);
            assert.match(res.data.error, /invalid credentials/i);
        });

        test("should return 401 Unauthorized for non-existent email", async () => {
            const res = await apiRequest("POST", "/api/v1/auth/login", {
                body: {
                    email: "doesnotexist_999999@test.com",
                    password: "anyPassword"
                }
            });

            assert.equal(res.status, 401);
            assert.match(res.data.error, /invalid credentials/i);
        });

        test("should return 400 Bad Request if email or password missing", async () => {
            const res = await apiRequest("POST", "/api/v1/auth/login", {
                body: { email: userEmail }
            });

            assert.equal(res.status, 400);
        });
    });

    describe("GET /api/v1/auth/me", () => {
        let validToken = "";
        const meEmail = uniqueEmail("me_user");

        beforeAll(async () => {
            createdUserEmails.push(meEmail);
            const registerRes = await apiRequest("POST", "/api/v1/auth/register", {
                body: {
                    name: "Me Tester",
                    email: meEmail,
                    password: "password123",
                    address: "200 Me Street"
                }
            });
            validToken = registerRes.data.token;
        });

        test("should retrieve authenticated user profile without exposing password (200 OK)", async () => {
            const res = await apiRequest("GET", "/api/v1/auth/me", { token: validToken });

            assert.equal(res.status, 200);
            assert.ok(res.data.user);
            assert.equal(res.data.user.email, meEmail);
            assert.equal(res.data.user.name, "Me Tester");
            assert.equal(res.data.user.password, undefined, "Password hash must NEVER be returned");
        });

        test("should return 401 Unauthorized when no token is provided", async () => {
            const res = await apiRequest("GET", "/api/v1/auth/me");

            assert.equal(res.status, 401);
            assert.match(res.data.error, /no token provided/i);
        });

        test("should return 401 Unauthorized when invalid token is passed", async () => {
            const res = await apiRequest("GET", "/api/v1/auth/me", { token: "malformed.jwt.token" });

            assert.equal(res.status, 401);
            assert.match(res.data.error, /not authorized/i);
        });
    });
});
