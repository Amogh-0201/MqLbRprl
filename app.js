require("dotenv").config();
const express = require("express");

// middlewares
const errorHandlerMiddleware = require("./middlewares/errorhandler_middleware");
const notFound = require("./middlewares/not_found");
const connectDb = require("./db/connectDb");

// routes
const authRouter = require("./routes/authRoute");
const productRouter = require("./routes/productRoute");
const orderRouter = require("./routes/orderRoute")

const app = express();

const port = process.env.PORT || 3000;

// instance ids for different server instances
const instanceId = process.env.INSTANCE_ID || `instance-${process.pid}`;

// Basic Middleware
app.use(express.json());

// to show load balancing is actually happening
app.use((req, res, next) => {
    res.setHeader("X-INSTANCE-ID", instanceId);
    next();
});

// health check
app.get("/health", (req, res) => {
    res.status(200).json({
        status: "ok",
        instanceId,
        pid: process.pid
    });
});

// all routes
app.use("/api/v1/auth", authRouter);
app.use("/api/v1/products", productRouter);
app.use("/api/v1/orders", orderRouter);

// Not Found and Error Handler Middlewares
app.use(notFound);
app.use(errorHandlerMiddleware);


// Server Startup
async function start() {
    await connectDb();
    app.listen(port, () => {
        console.log(`Server is running on port ${port}`);
    });
}

if (require.main === module) {
    start();
}

module.exports = app;