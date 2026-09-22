const orderQueue = require("../queues/orderQueue");

async function showQueueStatus() {
    try {
        const counts = await orderQueue.getJobCounts(
            "waiting",
            "active",
            "completed",
            "failed",
            "delayed"
        );

        console.log("\n========== ORDER QUEUE ==========");
        console.table(counts);
    } catch (error) {
        console.error("Failed to read queue:", error);
        process.exitCode = 1;
    } finally {
        await orderQueue.close();
    }
}

showQueueStatus();