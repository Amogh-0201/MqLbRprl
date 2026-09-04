const { test, describe, beforeAll, afterAll } = require("@jest/globals");
const assert = require("node:assert/strict");
const User = require("../models/user");
const Product = require("../models/product");
const Order = require("../models/order");
const { setupTestEnvironment, teardownTestEnvironment, apiRequest, uniqueEmail } = require("./testHelper");

describe("Product Catalog Endpoints", () => {
    let adminToken = "";
    let adminId = "";
    let otherAdminToken = "";
    let userToken = "";
    let testProductId = "";

    const userEmails = [];

    beforeAll(async () => {
        await setupTestEnvironment();

        // 1. Create primary Admin
        const adminEmail = uniqueEmail("prod_admin1");
        userEmails.push(adminEmail);
        const adminRes = await apiRequest("POST", "/api/v1/auth/register", {
            body: { name: "Primary Admin", email: adminEmail, password: "password123", address: "Admin HQ", role: "admin" }
        });
        adminToken = adminRes.data.token;
        const adminDoc = await User.findOne({ email: adminEmail });
        adminId = adminDoc._id.toString();

        // 2. Create secondary Admin
        const otherAdminEmail = uniqueEmail("prod_admin2");
        userEmails.push(otherAdminEmail);
        const otherAdminRes = await apiRequest("POST", "/api/v1/auth/register", {
            body: { name: "Other Admin", email: otherAdminEmail, password: "password123", address: "Branch HQ", role: "admin" }
        });
        otherAdminToken = otherAdminRes.data.token;

        // 3. Create normal User
        const userEmail = uniqueEmail("prod_user");
        userEmails.push(userEmail);
        const userRes = await apiRequest("POST", "/api/v1/auth/register", {
            body: { name: "Shopper", email: userEmail, password: "password123", address: "Shopper Lane", role: "user" }
        });
        userToken = userRes.data.token;
    });

    afterAll(async () => {
        await Product.deleteMany({ adminId });
        await User.deleteMany({ email: { $in: userEmails } });
        await teardownTestEnvironment();
    });

    describe("POST /api/v1/products", () => {
        test("should allow an admin to create a new product (201 Created)", async () => {
            const res = await apiRequest("POST", "/api/v1/products", {
                token: adminToken,
                body: {
                    name: "Gaming Keyboard",
                    price: 99.99,
                    quantity: 20,
                    description: "RGB Mechanical Keyboard"
                }
            });

            assert.equal(res.status, 201);
            assert.ok(res.data.product);
            assert.equal(res.data.product.name, "Gaming Keyboard");
            assert.equal(res.data.product.price, 99.99);
            assert.equal(res.data.product.quantity, 20);
            testProductId = res.data.product._id;
        });

        test("should allow creating a product with initial zero stock (quantity: 0)", async () => {
            const res = await apiRequest("POST", "/api/v1/products", {
                token: adminToken,
                body: {
                    name: "Pre-order Monitor",
                    price: 299.99,
                    quantity: 0,
                    description: "Coming soon"
                }
            });

            assert.equal(res.status, 201);
            assert.equal(res.data.product.quantity, 0);

            // Clean up pre-order monitor
            await Product.findByIdAndDelete(res.data.product._id);
        });

        test("should return 403 Forbidden when a regular user attempts to create a product", async () => {
            const res = await apiRequest("POST", "/api/v1/products", {
                token: userToken,
                body: {
                    name: "Unauthorized Item",
                    price: 15.00,
                    quantity: 5
                }
            });

            assert.equal(res.status, 403);
            assert.match(res.data.error, /only admin/i);
        });

        test("should return 401 Unauthorized when no authentication token is provided", async () => {
            const res = await apiRequest("POST", "/api/v1/products", {
                body: {
                    name: "Ghost Item",
                    price: 50.00,
                    quantity: 10
                }
            });

            assert.equal(res.status, 401);
        });

        test("should return 400 Bad Request if price is zero or negative", async () => {
            const res = await apiRequest("POST", "/api/v1/products", {
                token: adminToken,
                body: {
                    name: "Free Item",
                    price: 0,
                    quantity: 10
                }
            });

            assert.equal(res.status, 400);
            assert.match(res.data.error, /greater than 0/i);
        });
    });

    describe("GET /api/v1/products", () => {
        test("should retrieve list of all products publicly without authentication (200 OK)", async () => {
            const res = await apiRequest("GET", "/api/v1/products");

            assert.equal(res.status, 200);
            assert.ok(Array.isArray(res.data.products));
            assert.ok(res.data.count >= 1);
        });
    });

    describe("GET /api/v1/products/:productId", () => {
        test("should retrieve a single product by ID (200 OK)", async () => {
            const res = await apiRequest("GET", `/api/v1/products/${testProductId}`);

            assert.equal(res.status, 200);
            assert.ok(res.data.product);
            assert.equal(res.data.product._id, testProductId);
        });

        test("should return 404 Not Found for non-existent 24-character ObjectId", async () => {
            const fakeId = "65e63980a0e4c6b8c9d1a999";
            const res = await apiRequest("GET", `/api/v1/products/${fakeId}`);

            assert.equal(res.status, 404);
            assert.match(res.data.error, /does not exist/i);
        });

        test("should return 400 Bad Request for malformed ID format", async () => {
            const res = await apiRequest("GET", "/api/v1/products/invalid-id-123");

            assert.equal(res.status, 400);
            assert.match(res.data.error, /invalid ID format/i);
        });
    });

    describe("PATCH /api/v1/products/:productId", () => {
        test("should allow the owner admin to update product details (200 OK)", async () => {
            const res = await apiRequest("PATCH", `/api/v1/products/${testProductId}`, {
                token: adminToken,
                body: {
                    price: 89.99,
                    quantity: 25
                }
            });

            assert.equal(res.status, 200);
            assert.equal(res.data.updatedProduct.price, 89.99);
            assert.equal(res.data.updatedProduct.quantity, 25);
        });

        test("should return 403 Forbidden if another admin tries to update the product", async () => {
            const res = await apiRequest("PATCH", `/api/v1/products/${testProductId}`, {
                token: otherAdminToken,
                body: {
                    price: 79.99
                }
            });

            assert.equal(res.status, 403);
            assert.match(res.data.error, /only the admin who created the product/i);
        });
    });

    describe("DELETE /api/v1/products/:productId", () => {
        let disposableProductId = "";

        beforeAll(async () => {
            const tempRes = await apiRequest("POST", "/api/v1/products", {
                token: adminToken,
                body: { name: "Disposable Item", price: 10, quantity: 5 }
            });
            disposableProductId = tempRes.data.product._id;
        });

        test("should return 403 Forbidden if a different admin tries to delete product", async () => {
            const res = await apiRequest("DELETE", `/api/v1/products/${disposableProductId}`, {
                token: otherAdminToken
            });

            assert.equal(res.status, 403);
        });

        test("should prevent deletion when an active pending order exists for the product (400)", async () => {
            // Create an active order for disposable item
            const userDoc = await User.findOne({ email: userEmails[2] });
            const activeOrder = await Order.create({
                user: userDoc._id,
                product: disposableProductId,
                quantity: 1,
                price: 10,
                orderStatus: "pending"
            });

            const res = await apiRequest("DELETE", `/api/v1/products/${disposableProductId}`, {
                token: adminToken
            });

            assert.equal(res.status, 400);
            assert.match(res.data.error, /cannot delete product with active orders/i);

            // Clean up active order
            await Order.findByIdAndDelete(activeOrder._id);
        });

        test("should allow the owner admin to delete product when no active orders exist (200 OK)", async () => {
            const res = await apiRequest("DELETE", `/api/v1/products/${disposableProductId}`, {
                token: adminToken
            });

            assert.equal(res.status, 200);
            assert.equal(res.data.msg, "Product deleted successfully");

            // Verify deleted from database
            const found = await Product.findById(disposableProductId);
            assert.equal(found, null);
        });
    });
});
