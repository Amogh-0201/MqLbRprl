const { Queue } = require("bullmq");
const redisConnection = require("../config/redis");

const orderQueue = new Queue("order-queue", {

    connection: redisConnection,

    defaultJobOptions: {
        attempts: 3,

        backoff: {
            type: "exponential",
            delay: 1000
        },

        removeOnComplete: {
            age: 24 * 60 * 60,
            count: 10000
        },

        removeOnFail: {
            age: 24 * 60 * 60,
            count: 10000
        }
    }
});

module.exports = orderQueue;