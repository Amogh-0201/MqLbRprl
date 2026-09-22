const { Worker } = require("bullmq");
const redisConnection = require("../config/redis");

const worker = new Worker(
    "order-queue",

    async (job) => {

        console.log("\n==============================");
        console.log("[WORKER] Processing job");
        console.log("Job ID:", job.id);
        console.log("Job Name:", job.name);
        console.log("Job Data:", job.data);
        console.log("==============================");

        // For now, we are only testing the producer-consumer flow.

        await new Promise(resolve => setTimeout(resolve, 1000));

        console.log(`[WORKER] Job ${job.id} processed successfully`);

        return {
            success: true,
            jobId: job.id
        };
    },
    {
        connection: redisConnection,
        concurrency: 1
    }
);

worker.on("completed", (job) => {
    console.log(`[WORKER] Job ${job.id} -> COMPLETED`);
});

worker.on("failed", (job, error) => {
    console.error(
        `[WORKER] Job ${job?.id} -> FAILED:`,
        error.message
    );
});

worker.on("error", (error) => {
    console.error("[WORKER] Worker error:", error);
});

console.log("[WORKER] Order worker started");
console.log("[WORKER] Waiting for jobs...");