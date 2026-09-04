const Order = require("../models/order");
const User = require("../models/user");
const Product = require("../models/product");
const BadRequestError = require("../error_handlers/BadRequestError");
const UnAuthenticatedError = require("../error_handlers/UnAuthenticatedError");

async function placeOrder(userId, productId, quantity) {

    if (!userId || !productId || quantity == null) {
        throw new BadRequestError("Please provide the required fields")
    }

    const user = await User.findById(userId);
    if (!user) {
        throw new BadRequestError("User not found");
    }
    if (user.role !== "user") {
        throw new UnAuthenticatedError("seller / admin can not order products");
    }

    const product = await Product.findById(productId);
    if (!product) {
        throw new BadRequestError("Product not found");
    }

    if (quantity <= 0) {
        throw new BadRequestError("Quantity must be greater than 0");
    }

    if (quantity > product.quantity) {
        throw new BadRequestError(`Insufficent Stock: Available - ${product.quantity} Required - ${quantity}`);
    }

    const orderPrice = quantity * product.price;

    const order = await Order.create({
        user: userId,
        product: productId,
        quantity: quantity,
        price: orderPrice,
        orderStatus: "pending"
    });

    await Product.findOneAndUpdate(
        { _id: productId },
        { $inc: { quantity: -quantity } },
        { returnDocument: 'after', runValidators: true }
    );

    return order;
}


async function getOrders(userId) {

    if (!userId) {
        throw new BadRequestError("User not found");
    }

    const user = await User.findById(userId);
    if (!user) {
        throw new BadRequestError("User not found");
    }

    if (user.role === "user") {
        const orders = await Order.find({ user: userId })
            .populate("product", "name price image description")
            .sort({ createdAt: -1 });
        return orders;
    } else {
        throw new UnAuthenticatedError("No orders for Admin / Seller");
    }
}

async function getOrderById(userId, orderId) {

    if (!userId || !orderId) {
        throw new BadRequestError("Please provide the required fields")
    }

    const user = await User.findById(userId);
    if (!user) {
        throw new BadRequestError("User not found");
    }

    if (user.role === "user") {
        const order = await Order.findOne({ _id: orderId, user: userId })
            .populate("product", "name price image description");

        if (!order) {
            throw new BadRequestError("Order not found");
        }

        return order;
    } else {
        throw new UnAuthenticatedError("No orders for Admin / Seller");
    }

}


async function updateOrderStatus(userId, orderId, orderStatus) {

    if (!userId || !orderId || !orderStatus) {
        throw new BadRequestError("Please provide all required fields");
    }

    const user = await User.findById(userId);
    if (!user) {
        throw new BadRequestError("User not found");
    }

    if (user.role !== "admin") {
        throw new UnAuthenticatedError("Only Admin can update order status");
    }

    const order = await Order.findById(orderId);
    if (!order) {
        throw new BadRequestError("Order not found");
    }

    const product = await Product.findById(order.product);
    if (!product) {
        throw new BadRequestError("ordered product not found");
    }

    if (product.adminId.toString() !== userId) {
        throw new UnAuthenticatedError("only admin who owns the product can update the order status");
    }

    if (order.orderStatus === "delivered" || order.orderStatus === "failed") {
        throw new BadRequestError("Order cannot be updated as it is already delivered or failed");
    }

    if (orderStatus === "failed") {
        const updatedOrder = await Order.findOneAndUpdate(
            { _id: orderId },
            { $set: { orderStatus: orderStatus } },
            { returnDocument: 'after', runValidators: true }
        );
        await Product.findOneAndUpdate(
            { _id: order.product },
            { $inc: { quantity: order.quantity } },
            { returnDocument: 'after', runValidators: true }
        );
        return updatedOrder;
    } else {
        const updatedOrder = await Order.findOneAndUpdate(
            { _id: orderId },
            { $set: { orderStatus: orderStatus } },
            { returnDocument: 'after', runValidators: true }
        );
        return updatedOrder.populate("product", "name price image description");
    }
}


async function updateOrderQuantity(userId, orderId, quantity) {

    if (!userId || !orderId || quantity == null) {
        throw new BadRequestError("Please provide all required fields");
    }

    const user = await User.findById(userId);
    if (!user) {
        throw new BadRequestError("User not found");
    }

    if (quantity <= 0) {
        throw new BadRequestError("Quantity must be greater than 0");
    }

    if (user.role !== "user") {
        throw new UnAuthenticatedError("only user can update order quantity");
    }

    const order = await Order.findById(orderId);
    if (!order) {
        throw new BadRequestError("Order not found");
    }

    if (order.user.toString() !== userId) {
        throw new UnAuthenticatedError("only user who owns the order can update the order quantity");
    }

    if (order.orderStatus !== "pending") {
        throw new BadRequestError(`Order cannot be updated as it is already ${order.orderStatus}`);
    }

    const product = await Product.findById(order.product);
    if (!product) {
        throw new BadRequestError("ordered product not found");
    }

    if (quantity > (product.quantity + order.quantity)) {
        throw new BadRequestError(`Insufficent Stock: Available - ${product.quantity + order.quantity} Required - ${quantity}`);
    }

    const updatedOrder = await Order.findOneAndUpdate(
        { _id: orderId },
        { $set: { quantity: quantity, price: quantity * product.price } },
        { returnDocument: 'after', runValidators: true }
    );

    await Product.findOneAndUpdate(
        { _id: order.product },
        { $inc: { quantity: order.quantity - quantity } },
        { returnDocument: 'after', runValidators: true }
    );

    return updatedOrder.populate("product", "name price image description");
}


async function deleteOrder(userId, orderId) {

    if (!userId || !orderId) {
        throw new BadRequestError("Please provide all required fields");
    }

    const user = await User.findById(userId);
    if (!user) {
        throw new BadRequestError("User not found");
    }

    if (user.role !== "user") {
        throw new UnAuthenticatedError("only user can delete order");
    }

    const order = await Order.findById(orderId);
    if (!order) {
        throw new BadRequestError("Order not found");
    }

    if (order.user.toString() !== userId) {
        throw new UnAuthenticatedError("only user who owns the order can delete the order");
    }

    if (order.orderStatus !== "pending") {
        throw new BadRequestError(`Order cannot be deleted as it is already ${order.orderStatus}`);
    }

    const product = await Product.findById(order.product);
    if (!product) {
        throw new BadRequestError("ordered product not found");
    }

    await Order.findByIdAndDelete(orderId);
    await Product.findOneAndUpdate(
        { _id: order.product },
        { $inc: { quantity: order.quantity } },
        { returnDocument: 'after', runValidators: true }
    );
}


module.exports = {
    placeOrder,
    getOrders,
    getOrderById,
    updateOrderStatus,
    updateOrderQuantity,
    deleteOrder
}