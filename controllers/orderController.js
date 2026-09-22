const {
    placeOrder,
    getOrders,
    getOrderById,
    updateOrderQuantity,
    updateOrderStatus,
    deleteOrder
} = require("../services/orderService");

const orderQueue = require("../queues/orderQueue");

const {
    isFlashSaleActive,
    reserveStock,
    getReservation
} = require("../services/inventoryService");

const {
    createReservationId
} = require("../utils/orderRequestId");

const BadRequestError = require("../error_handlers/BadRequestError");
const ForbiddenError = require("../error_handlers/ForbiddenError");
const NotFoundError = require("../error_handlers/NotFoundError");
const ServiceUnavailableError = require("../error_handlers/ServiceUnavailableError.js");

const placeOrderController = async (req, res) => {

    const { productId, quantity } = req.body;
    const userId = req.user.userId;

    if (!userId || !productId || quantity == null) {
        throw new BadRequestError("Please provide all required fields");
    }

    if (!Number.isInteger(quantity) || quantity <= 0) {
        throw new BadRequestError("Quantity must be a positive integer");
    }

    const clientIdempotencyKey = req.get("Idempotency-Key");

    let flashSaleActive;

    try {
        flashSaleActive = await isFlashSaleActive(productId);
    } catch (error) {
        throw new ServiceUnavailableError("Order service is temporarily unavailable");
    }

    // Normal Order
    if (!flashSaleActive) {
        const idempotencyKey =
            clientIdempotencyKey
                ? createReservationId(
                    userId,
                    clientIdempotencyKey
                )
                : null;

        const order = await placeOrder(
            userId,
            productId,
            quantity,
            idempotencyKey
        );

        return res.status(201).json({
            msg: "Order placed successfully",
            order
        });
    }

    // Flash Sale Order
    if (!clientIdempotencyKey) {
        throw new BadRequestError("Idempotency-Key header is required for flash-sale orders");
    }

    const reservationId = createReservationId(userId, clientIdempotencyKey);

    const reservation = await reserveStock({
        productId,
        quantity,
        reservationId,
        userId,
        idempotencyKey: clientIdempotencyKey
    });

    if (reservation.status === -1) {
        throw new ServiceUnavailableError("Flash-sale inventory is not initialized");
    }

    if (reservation.status === 0) {
        throw new BadRequestError("Insufficient Stock");
    }

    if (reservation.status === 2) {
        const record = reservation.record;

        if (record.status === "COMPLETED") {
            const order = await getOrderById(userId, record.orderId);
            return res.status(200).json({ msg: "Order already processed", order });
        }
    }

    let job = await orderQueue.getJob(reservationId);

    if (!job) {
        job = await orderQueue.add("place-order",
            {
                userId,
                productId,
                quantity,
                reservationId,
                idempotencyKey:
                    clientIdempotencyKey,
                requestedAt:
                    new Date().toISOString()
            },
            {
                jobId: reservationId
            }
        );
    }

    return res.status(202).json({
        success: true,
        msg: "Order request accepted for processing",
        jobId: job.id,
        status: "PENDING"
    });

}


const getOrderJobStatusController = async (req, res) => {
    const { jobId } = req.params;
    const { userId } = req.user;

    if (!jobId) {
        throw new BadRequestError("Job ID is required");
    }

    const job = await orderQueue.getJob(jobId);

    /*
        Job may have been removed from BullMQ,
        so check our reservation record too.
    */
    const reservation =
        await getReservation(jobId);

    if (!job && !reservation) {
        throw new NotFoundError("Order job not found");
    }

    const ownerId = job?.data?.userId || reservation?.userId;

    if (ownerId && ownerId.toString() !== userId.toString()) {
        throw new ForbiddenError("You are not allowed to view this order job");
    }

    if (!job) {
        if (reservation?.status === "COMPLETED") {
            return res.status(200).json({
                jobId,
                status: "COMPLETED",
                orderId: reservation.orderId
            });
        }

        return res.status(200).json({
            jobId,
            status: "PENDING"
        });
    }

    const state = await job.getState();

    if (state === "waiting" || state === "delayed") {
        return res.status(200).json({
            jobId,
            status: "PENDING"
        });
    }

    if (state === "active") {
        return res.status(200).json({
            jobId,
            status: "PROCESSING"
        });
    }

    if (state === "completed") {
        return res.status(200).json({
            jobId,
            status: "COMPLETED",
            orderId:
                job.returnvalue?.orderId
        });
    }

    if (state === "failed") {
        return res.status(200).json({
            jobId,
            status: "FAILED",
            reason:
                job.failedReason
        });
    }

    return res.status(200).json({
        jobId,
        status: state.toUpperCase()
    });
}


const getOrdersController = async (req, res) => {

    const { userId } = req.user;
    const orders = await getOrders(userId);
    res.status(200).json({ count: orders.length, orders });
}

const getOrderByIdController = async (req, res) => {

    const { userId } = req.user;
    const { orderId } = req.params;
    const order = await getOrderById(userId, orderId);
    res.status(200).json({ order });
}

const updateOrderStatusController = async (req, res) => {

    const { userId } = req.user;
    const { orderId } = req.params;
    const { orderStatus } = req.body;
    const order = await updateOrderStatus(userId, orderId, orderStatus);
    res.status(200).json({ msg: "Order status updated successfully", order });
}

const updateOrderQuantityController = async (req, res) => {

    const { userId } = req.user;
    const { orderId } = req.params;
    const { quantity } = req.body;
    const order = await updateOrderQuantity(userId, orderId, quantity);
    res.status(200).json({ msg: "Order quantity updated successfully", order });
}

const deleteOrderController = async (req, res) => {

    const { userId } = req.user;
    const { orderId } = req.params;
    await deleteOrder(userId, orderId);
    res.status(200).json({ msg: "Order deleted successfully" });
}


module.exports = {
    placeOrderController,
    getOrderJobStatusController,
    getOrdersController,
    getOrderByIdController,
    updateOrderStatusController,
    updateOrderQuantityController,
    deleteOrderController
}