const { test, describe, beforeAll, afterAll } = require("@jest/globals");
const assert = require("node:assert/strict");
const User = require("../models/user");
const Product = require("../models/product");
const Order = require("../models/order");
const { setupTestEnvironment, teardownTestEnvironment, apiRequest, uniqueEmail } = require("./testHelper");

describe("Order Lifecycle & Inventory Endpoints", () => {
    let adminToken = "";
    let adminId = "";
    let userToken = "";
    let userId = "";
    let otherUserToken = "";

    let testProductId = "";
    const initialProductStock = 20;
    const productPrice = 50;

    const userEmails = [];

    beforeAll(async () => {
        await setupTestEnvironment();

        // 1. Create Admin
        const adminEmail = uniqueEmail("order_admin");
        userEmails.push(adminEmail);
        const adminRes = await apiRequest("POST", "/api/v1/auth/register", {
            body: { name: "Merchant Admin", email: adminEmail, password: "password123", address: "Warehouse 1", role: "admin" }
        });
        adminToken = adminRes.data.token;
        const adminDoc = await User.findOne({ email: adminEmail });
        adminId = adminDoc._id.toString();

        // 2. Create Primary Buyer User
        const userEmail = uniqueEmail("order_buyer1");
        userEmails.push(userEmail);
        const userRes = await apiRequest("POST", "/api/v1/auth/register", {
            body: { name: "Customer Alice", email: userEmail, password: "password123", address: "Buyer Apt 4B", role: "user" }
        });
        userToken = userRes.data.token;
        const userDoc = await User.findOne({ email: userEmail });
        userId = userDoc._id.toString();

        // 3. Create Secondary Buyer User
        const otherUserEmail = uniqueEmail("order_buyer2");
        userEmails.push(otherUserEmail);
        const otherUserRes = await apiRequest("POST", "/api/v1/auth/register", {
            body: { name: "Customer Bob", email: otherUserEmail, password: "password123", address: "Buyer Apt 5C", role: "user" }
        });
        otherUserToken = otherUserRes.data.token;

        // 4. Create Product with 20 stock
        const prodRes = await apiRequest("POST", "/api/v1/products", {
            token: adminToken,
            body: {
                name: "Mechanical Keyboard Pro",
                price: productPrice,
                quantity: initialProductStock,
                description: "Tenkeyless mechanical keyboard"
            }
        });
        testProductId = prodRes.data.product._id;
    });

    afterAll(async () => {
        await Order.deleteMany({ user: { $in: [userId] } });
        await Product.deleteMany({ adminId });
        await User.deleteMany({ email: { $in: userEmails } });
        await teardownTestEnvironment();
    });

    describe("POST /api/v1/orders", () => {
        let placedOrderId = "";

        test("should place an order and atomically decrement product inventory (201 Created)", async () => {
            const orderQty = 4;
            const res = await apiRequest("POST", "/api/v1/orders", {
                token: userToken,
                body: {
                    productId: testProductId,
                    quantity: orderQty
                }
            });

            assert.equal(res.status, 201);
            assert.ok(res.data.order);
            assert.equal(res.data.order.quantity, orderQty);
            assert.equal(res.data.order.price, orderQty * productPrice);
            assert.equal(res.data.order.orderStatus, "pending");
            assert.ok(res.data.order.product.name, "Product details should be populated");
            placedOrderId = res.data.order._id;

            // Verify database stock decreased from 20 to 16
            const productInDb = await Product.findById(testProductId);
            assert.equal(productInDb.quantity, initialProductStock - orderQty);
        });

        test("should reject order if quantity exceeds available stock (400 Bad Request)", async () => {
            const res = await apiRequest("POST", "/api/v1/orders", {
                token: userToken,
                body: {
                    productId: testProductId,
                    quantity: 999
                }
            });

            assert.equal(res.status, 400);
            assert.match(res.data.error, /insufficient stock/i);
        });

        test("should reject order if quantity is a float / non-integer (400 Bad Request)", async () => {
            const res = await apiRequest("POST", "/api/v1/orders", {
                token: userToken,
                body: {
                    productId: testProductId,
                    quantity: 2.5
                }
            });

            assert.equal(res.status, 400);
            assert.match(res.data.error, /positive integer/i);
        });

        test("should return 403 Forbidden if admin tries to place an order", async () => {
            const res = await apiRequest("POST", "/api/v1/orders", {
                token: adminToken,
                body: {
                    productId: testProductId,
                    quantity: 1
                }
            });

            assert.equal(res.status, 403);
            assert.match(res.data.error, /cannot order products/i);
        });
    });

    describe("GET /api/v1/orders and GET /api/v1/orders/:orderId", () => {
        let orderId = "";

        beforeAll(async () => {
            // Place an order to inspect
            const res = await apiRequest("POST", "/api/v1/orders", {
                token: userToken,
                body: { productId: testProductId, quantity: 2 }
            });
            orderId = res.data.order._id;
        });

        test("should allow buyer to retrieve their orders (200 OK)", async () => {
            const res = await apiRequest("GET", "/api/v1/orders", { token: userToken });

            assert.equal(res.status, 200);
            assert.ok(Array.isArray(res.data.orders));
            assert.ok(res.data.orders.length >= 1);
        });

        test("should allow admin to retrieve orders placed for their products (200 OK)", async () => {
            const res = await apiRequest("GET", "/api/v1/orders", { token: adminToken });

            assert.equal(res.status, 200);
            assert.ok(Array.isArray(res.data.orders));
            assert.ok(res.data.orders.length >= 1);
            // Verify customer user info is populated for the admin
            assert.ok(res.data.orders[0].user.name);
            assert.ok(res.data.orders[0].user.email);
        });

        test("should allow buyer to retrieve single order by ID (200 OK)", async () => {
            const res = await apiRequest("GET", `/api/v1/orders/${orderId}`, { token: userToken });

            assert.equal(res.status, 200);
            assert.equal(res.data.order._id, orderId);
        });

        test("should allow admin to retrieve single order by ID (200 OK)", async () => {
            const res = await apiRequest("GET", `/api/v1/orders/${orderId}`, { token: adminToken });

            assert.equal(res.status, 200);
            assert.equal(res.data.order._id, orderId);
        });

        test("should return 404 for non-existent order ID", async () => {
            const fakeOrderId = "65e63a12a0e4c6b8c9d1a999";
            const res = await apiRequest("GET", `/api/v1/orders/${fakeOrderId}`, { token: userToken });

            assert.equal(res.status, 404);
        });
    });

    describe("PATCH /api/v1/orders/:orderId/quantity", () => {
        let editableOrderId = "";

        beforeAll(async () => {
            const res = await apiRequest("POST", "/api/v1/orders", {
                token: userToken,
                body: { productId: testProductId, quantity: 2 }
            });
            editableOrderId = res.data.order._id;
        });

        test("should increase order quantity and deduct additional stock from product (200 OK)", async () => {
            const productBefore = await Product.findById(testProductId);

            // Increase from 2 to 4 (delta +2)
            const res = await apiRequest("PATCH", `/api/v1/orders/${editableOrderId}/quantity`, {
                token: userToken,
                body: { quantity: 4 }
            });

            assert.equal(res.status, 200);
            assert.equal(res.data.order.quantity, 4);
            assert.equal(res.data.order.price, 4 * productPrice);

            // Product inventory should have decreased by 2
            const productAfter = await Product.findById(testProductId);
            assert.equal(productAfter.quantity, productBefore.quantity - 2);
        });

        test("should decrease order quantity and return surplus stock to product (200 OK)", async () => {
            const productBefore = await Product.findById(testProductId);

            // Decrease from 4 to 1 (delta -3)
            const res = await apiRequest("PATCH", `/api/v1/orders/${editableOrderId}/quantity`, {
                token: userToken,
                body: { quantity: 1 }
            });

            assert.equal(res.status, 200);
            assert.equal(res.data.order.quantity, 1);
            assert.equal(res.data.order.price, 1 * productPrice);

            // Product inventory should have increased by 3
            const productAfter = await Product.findById(testProductId);
            assert.equal(productAfter.quantity, productBefore.quantity + 3);
        });

        test("should return 403 Forbidden when another user tries to change quantity", async () => {
            const res = await apiRequest("PATCH", `/api/v1/orders/${editableOrderId}/quantity`, {
                token: otherUserToken,
                body: { quantity: 5 }
            });

            assert.equal(res.status, 403);
        });
    });

    describe("PATCH /api/v1/orders/:orderId/status", () => {
        let lifecycleOrderId = "";

        beforeAll(async () => {
            const res = await apiRequest("POST", "/api/v1/orders", {
                token: userToken,
                body: { productId: testProductId, quantity: 2 }
            });
            lifecycleOrderId = res.data.order._id;
        });

        test("should allow the admin to progress status from pending -> packed -> in transit (200 OK)", async () => {
            // Update to packed
            let res = await apiRequest("PATCH", `/api/v1/orders/${lifecycleOrderId}/status`, {
                token: adminToken,
                body: { orderStatus: "packed" }
            });
            assert.equal(res.status, 200);
            assert.equal(res.data.order.orderStatus, "packed");

            // Update to in transit
            res = await apiRequest("PATCH", `/api/v1/orders/${lifecycleOrderId}/status`, {
                token: adminToken,
                body: { orderStatus: "in transit" }
            });
            assert.equal(res.status, 200);
            assert.equal(res.data.order.orderStatus, "in transit");
        });

        test("should return 403 Forbidden if a regular user attempts to change status", async () => {
            const res = await apiRequest("PATCH", `/api/v1/orders/${lifecycleOrderId}/status`, {
                token: userToken,
                body: { orderStatus: "delivered" }
            });

            assert.equal(res.status, 403);
        });

        test("should return 400 Bad Request for invalid order status value", async () => {
            const res = await apiRequest("PATCH", `/api/v1/orders/${lifecycleOrderId}/status`, {
                token: adminToken,
                body: { orderStatus: "shipped_express" }
            });

            assert.equal(res.status, 400);
            assert.match(res.data.error, /invalid order status/i);
        });

        test("should restore stock when order is marked as 'failed' (200 OK)", async () => {
            // Create a new order to test failure
            const orderRes = await apiRequest("POST", "/api/v1/orders", {
                token: userToken,
                body: { productId: testProductId, quantity: 3 }
            });
            const failOrderId = orderRes.data.order._id;

            const stockBefore = (await Product.findById(testProductId)).quantity;

            // Admin marks failed
            const res = await apiRequest("PATCH", `/api/v1/orders/${failOrderId}/status`, {
                token: adminToken,
                body: { orderStatus: "failed" }
            });
            assert.equal(res.status, 200);
            assert.equal(res.data.order.orderStatus, "failed");

            // Stock must be restored (+3)
            const stockAfter = (await Product.findById(testProductId)).quantity;
            assert.equal(stockAfter, stockBefore + 3);
        });
    });

    describe("DELETE /api/v1/orders/:orderId", () => {
        let cancellableOrderId = "";
        const cancelQty = 2;

        beforeAll(async () => {
            const res = await apiRequest("POST", "/api/v1/orders", {
                token: userToken,
                body: { productId: testProductId, quantity: cancelQty }
            });
            cancellableOrderId = res.data.order._id;
        });

        test("should return 403 Forbidden when a different user tries to cancel order", async () => {
            const res = await apiRequest("DELETE", `/api/v1/orders/${cancellableOrderId}`, {
                token: otherUserToken
            });

            assert.equal(res.status, 403);
        });

        test("should allow buyer to cancel pending order and restore inventory (200 OK)", async () => {
            const stockBefore = (await Product.findById(testProductId)).quantity;

            const res = await apiRequest("DELETE", `/api/v1/orders/${cancellableOrderId}`, {
                token: userToken
            });

            assert.equal(res.status, 200);
            assert.equal(res.data.msg, "Order deleted successfully");

            // Verify order is removed from DB
            const orderDoc = await Order.findById(cancellableOrderId);
            assert.equal(orderDoc, null);

            // Verify inventory restored
            const stockAfter = (await Product.findById(testProductId)).quantity;
            assert.equal(stockAfter, stockBefore + cancelQty);
        });
    });
});
