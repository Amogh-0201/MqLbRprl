const {
    placeOrder,
    getOrders,
    getOrderById,
    updateOrderQuantity,
    updateOrderStatus,
    deleteOrder
} = require("../services/orderService");

const placeOrderController = async (req, res) => {

    const { productId, quantity } = req.body;
    const userId = req.user.userId;

    const order = await placeOrder(userId, productId, quantity);
    res.status(201).json({ msg: "Order placed successfully", order });
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
    res.status(204).json({ msg: "Order deleted successfully" });
}


module.exports = {
    placeOrderController,
    getOrdersController,
    getOrderByIdController,
    updateOrderStatusController,
    updateOrderQuantityController,
    deleteOrderController
}