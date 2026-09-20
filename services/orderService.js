const Order = require("../models/order");
const User = require("../models/user");
const Product = require("../models/product");
const mongoose = require("mongoose");
const BadRequestError = require("../error_handlers/BadRequestError");
const UnAuthenticatedError = require("../error_handlers/UnAuthenticatedError");
const ForbiddenError = require("../error_handlers/ForbiddenError");
const NotFoundError = require("../error_handlers/NotFoundError");

async function placeOrder(userId, productId, quantity) {

    if (!userId || !productId || quantity == null) {
        throw new BadRequestError("Please provide all required fields");
    }

    if (!Number.isInteger(quantity) || quantity <= 0) {
        throw new BadRequestError("Quantity must be a positive integer");
    }

    const user = await User.findById(userId);
    if (!user) {
        throw new NotFoundError("User not found");
    }
    if (user.role !== "user") {
        throw new ForbiddenError("Seller / admin cannot order products");
    }

    const session = await mongoose.startSession();

    let order;

    try {
        await session.withTransaction(async () => {

            const product = await Product.findById(productId).session(session);

            if (!product) {
                throw new NotFoundError("Product not found");
            }

            const orderPrice = quantity * product.price;

            /*
                mongodb will update only if enough stocks is available at that moment
            */

            const updatedProduct = await Product.findOneAndUpdate(
                {
                    _id: productId,
                    quantity: { $gte: quantity }
                },
                {
                    $inc: { quantity: -quantity }
                },
                {
                    new: true,
                    session
                }
            );

            if (!updatedProduct) {
                throw new BadRequestError("Insufficient Stock");
            }

            order = new Order({
                user: userId,
                product: productId,
                quantity: quantity,
                price: orderPrice,
                orderStatus: "pending"
            });

            await order.save({ session });
        });

        return await order.populate(
            "product",
            "name price image description"
        );

    } catch (error) {
        throw error;
    } finally {
        session.endSession();
    }
}

async function getOrders(userId) {

    if (!userId) {
        throw new BadRequestError("User ID is required");
    }

    const user = await User.findById(userId);
    if (!user) {
        throw new NotFoundError("User not found");
    }

    if (user.role === "user") {
        const orders = await Order.find({ user: userId })
            .populate("product", "name price image description")
            .sort({ createdAt: -1 });
        return orders;
    } else if (user.role === "admin") {
        // Admin gets orders placed for products they manage
        const adminProducts = await Product.find({ adminId: userId }).select("_id");
        const productIds = adminProducts.map((p) => p._id);
        const orders = await Order.find({ product: { $in: productIds } })
            .populate("product", "name price image description")
            .populate("user", "name email address")
            .sort({ createdAt: -1 });
        return orders;
    } else {
        throw new ForbiddenError("Unauthorized role for fetching orders");
    }
}

async function getOrderById(userId, orderId) {

    if (!userId || !orderId) {
        throw new BadRequestError("Please provide all required fields");
    }

    const user = await User.findById(userId);
    if (!user) {
        throw new NotFoundError("User not found");
    }

    if (user.role === "user") {
        const order = await Order.findOne({ _id: orderId, user: userId })
            .populate("product", "name price image description");

        if (!order) {
            throw new NotFoundError("Order not found");
        }

        return order;
    } else if (user.role === "admin") {
        const order = await Order.findById(orderId)
            .populate("product", "name price image description adminId")
            .populate("user", "name email address");

        if (!order) {
            throw new NotFoundError("Order not found");
        }

        if (!order.product || order.product.adminId.toString() !== userId) {
            throw new ForbiddenError("Not authorized to view this order");
        }

        return order;
    } else {
        throw new ForbiddenError("Unauthorized role for fetching order");
    }
}


async function updateOrderStatus(userId, orderId, orderStatus) {

    if (!userId || !orderId || !orderStatus) {
        throw new BadRequestError("Please provide all required fields");
    }

    const validStatuses = ["pending", "failed", "packed", "in transit", "delivered"];
    if (!validStatuses.includes(orderStatus)) {
        throw new BadRequestError(`Invalid order status. Allowed values: ${validStatuses.join(", ")}`);
    }

    const user = await User.findById(userId);
    if (!user) {
        throw new NotFoundError("User not found");
    }

    if (user.role !== "admin") {
        throw new ForbiddenError("Only Admin can update order status");
    }

    const order = await Order.findById(orderId);
    if (!order) {
        throw new NotFoundError("Order not found");
    }

    const product = await Product.findById(order.product);
    if (!product) {
        throw new NotFoundError("Ordered product not found");
    }

    if (product.adminId.toString() !== userId) {
        throw new ForbiddenError("Only the admin who owns the product can update the order status");
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
        return await updatedOrder.populate("product", "name price image description");
    } else {
        const updatedOrder = await Order.findOneAndUpdate(
            { _id: orderId },
            { $set: { orderStatus: orderStatus } },
            { returnDocument: 'after', runValidators: true }
        );
        return await updatedOrder.populate("product", "name price image description");
    }
}


async function updateOrderQuantity(userId, orderId, quantity) {

    if (!userId || !orderId || quantity == null) {
        throw new BadRequestError("Please provide all required fields");
    }

    if (!Number.isInteger(quantity) || quantity <= 0) {
        throw new BadRequestError("Quantity must be a positive integer");
    }

    const user = await User.findById(userId);
    if (!user) {
        throw new NotFoundError("User not found");
    }

    if (user.role !== "user") {
        throw new ForbiddenError("Only user can update order quantity");
    }

    const order = await Order.findById(orderId);
    if (!order) {
        throw new NotFoundError("Order not found");
    }

    if (order.user.toString() !== userId) {
        throw new ForbiddenError("Only the user who owns the order can update the order quantity");
    }

    if (order.orderStatus !== "pending") {
        throw new BadRequestError(`Order cannot be updated as it is already ${order.orderStatus}`);
    }

    const product = await Product.findById(order.product);
    if (!product) {
        throw new NotFoundError("Ordered product not found");
    }

    if (quantity > (product.quantity + order.quantity)) {
        throw new BadRequestError(`Insufficient stock: Available - ${product.quantity + order.quantity}, Required - ${quantity}`);
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

    return await updatedOrder.populate("product", "name price image description");
}


async function deleteOrder(userId, orderId) {

    if (!userId || !orderId) {
        throw new BadRequestError("Please provide all required fields");
    }

    const user = await User.findById(userId);
    if (!user) {
        throw new NotFoundError("User not found");
    }

    if (user.role !== "user") {
        throw new ForbiddenError("Only user can delete order");
    }

    const order = await Order.findById(orderId);
    if (!order) {
        throw new NotFoundError("Order not found");
    }

    if (order.user.toString() !== userId) {
        throw new ForbiddenError("Only the user who owns the order can delete the order");
    }

    if (order.orderStatus !== "pending") {
        throw new BadRequestError(`Order cannot be deleted as it is already ${order.orderStatus}`);
    }

    await Order.findByIdAndDelete(orderId);

    // Restore product stock if product still exists
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