const mongoose = require("mongoose");

const OrderSchema = new mongoose.Schema({
    user: {
        type: mongoose.Schema.Types.ObjectId,
        ref: "User",
        required: [true, "user is required"]
    },
    product: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'Product',
        required: [true, "product is required"]
    },
    quantity: {
        type: Number,
        required: [true, "quantity is required"],
        min: [1, "quantity must be at least 1"]
    },
    price: {
        type: Number,
        required: [true, "price is required"]
    },
    orderStatus: {
        type: String,
        enum: ["pending", "failed", "packed", "in transit", "delivered"],
        required: [true, "orderStatus is required"]
    }
}, {
    timestamps: true
});

module.exports = mongoose.model("Order", OrderSchema);