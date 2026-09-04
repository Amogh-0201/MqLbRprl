const express = require("express");
const {
    placeOrderController,
    getOrdersController,
    getOrderByIdController,
    updateOrderStatusController,
    updateOrderQuantityController,
    deleteOrderController
} = require("../controllers/orderController");
const authenticateMiddleware = require("../middlewares/authentication");

const router = express.Router();

router.route("/")
    .post(authenticateMiddleware, placeOrderController)
    .get(authenticateMiddleware, getOrdersController);

router.route("/:orderId")
    .get(authenticateMiddleware, getOrderByIdController)
    .delete(authenticateMiddleware, deleteOrderController);

router.route("/:orderId/status")
    .patch(authenticateMiddleware, updateOrderStatusController);

router.route("/:orderId/quantity")
    .patch(authenticateMiddleware, updateOrderQuantityController);

module.exports = router;