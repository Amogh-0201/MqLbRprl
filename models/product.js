const mongoose = require("mongoose");

const ProductSchema = new mongoose.Schema({
    adminId: {
        type: mongoose.Schema.Types.ObjectId,
        ref: "User",
        required: [true, "adminId is required"]
    },
    name: {
        type: String,
        required: [true, "name is required"],
        minLength: [3, "name must be at least 3 characters long"],
        maxLength: [100, "name must be at most 100 characters long"]
    },
    price: {
        type: Number,
        required: [true, "price is required"]
    },
    quantity: {
        type: Number,
        required: [true, "quantity is required"],
        validate: {
            validator: Number.isInteger,
            message: "{VALUE} is not an integer value"
        },
        min: [0, "quantity cannot be negative"]
    },
    flashSaleActive: {
        type: Boolean,
        default: false
    },
    image: {
        type: String
    },
    description: {
        type: String
    }
}, {
    timestamps: true
});

module.exports = mongoose.model("Product", ProductSchema);