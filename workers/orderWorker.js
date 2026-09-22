const { Worker } = require("bullmq");

const redisConnection =
    require("../config/redis");

const connectDb =
    require("../db/connectDb");

const {
    placeOrder
} = require("../services/orderService");

const {
    completeReservation,
    releaseReservation
} = require("../services/inventoryService");

async function startWorker() {
    try {
        console.log("[WORKER] Connecting to MongoDB...");

        await connectDb();

        console.log(
            "[WORKER] MongoDB connected"
        );

        const worker = new Worker(
            "order-queue",

            async (job) => {
                const {
                    userId,
                    productId,
                    quantity,
                    reservationId,
                    idempotencyKey
                } = job.data;

                console.log(
                    `\n[WORKER] Processing job ${job.id}`
                );

                const order =
                    await placeOrder(
                        userId,
                        productId,
                        quantity,
                        idempotencyKey
                    );

                await completeReservation({
                    reservationId,
                    orderId:
                        order._id.toString()
                });

                console.log(
                    `[WORKER] Order ${order._id} created`
                );

                return {
                    success: true,
                    orderId:
                        order._id.toString()
                };
            },

            {
                connection: redisConnection,
                concurrency: Number(process.env.WORKER_CONCURRENCY || 1)
            }
        );

        worker.on(
            "completed",
            (job, result) => {
                console.log(
                    `[WORKER] Job ${job.id} → COMPLETED`
                );

                console.log(
                    `[WORKER] Order ID: ${result.orderId}`
                );
            }
        );

        worker.on(
            "failed",
            async (job, error) => {
                console.error(
                    `[WORKER] Job ${job?.id} → FAILED`
                );

                console.error(
                    `[WORKER] ${error.message}`
                );

                if (!job) {
                    return;
                }

                const maxAttempts =
                    job.opts.attempts || 1;

                if (
                    job.attemptsMade <
                    maxAttempts
                ) {
                    return;
                }

                if (
                    error.releaseReservation === false
                ) {
                    return;
                }

                if (
                    error.message ===
                    "Insufficient Stock"
                ) {
                    console.error(
                        "[WORKER] Redis/MongoDB inventory mismatch"
                    );

                    return;
                }

                try {
                    await releaseReservation({
                        productId:
                            job.data.productId,

                        quantity:
                            job.data.quantity,

                        reservationId:
                            job.data.reservationId
                    });

                    console.log(
                        `[WORKER] Redis reservation released for job ${job.id}`
                    );

                } catch (releaseError) {
                    console.error(
                        "[WORKER] Failed to release reservation:",
                        releaseError.message
                    );
                }
            }
        );

        worker.on(
            "error",
            (error) => {
                console.error(
                    "[WORKER] Worker error:",
                    error
                );
            }
        );

        console.log(
            "[WORKER] Order worker started"
        );

        console.log(
            "[WORKER] Waiting for order jobs..."
        );

    } catch (error) {
        console.error(
            "[WORKER] Startup failed:",
            error
        );

        process.exit(1);
    }
}

startWorker();