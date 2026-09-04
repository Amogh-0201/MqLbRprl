const mongoose = require("mongoose");
const CustomApiError = require("../error_handlers/CustomApiError");
require("dotenv").config();

async function connectDb() {
    try {
        await mongoose.connect(process.env.MONGO_URI);
        console.log("Connected to MongoDB");
    } catch (error) {
        throw new CustomApiError("Failed to connect to MongoDB", 500);
    }
}

module.exports = connectDb;