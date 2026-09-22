const { Queue } = require("bullmq");
const redisConnection = require("../config/redis");

const orderQueue = new Queue("order-queue", {
    connection: redisConnection
});

module.exports = orderQueue;