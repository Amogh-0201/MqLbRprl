const orderQueue = require("../queues/orderQueue");

async function addOrderJob() {

    try {

        const job = await orderQueue.add("place-order", {
            userId: "test-user-123",
            productId: "test-product-456",
            quantity: 1
        });

        console.log("Job added successfully");
        console.log("Job ID:", job.id);
        console.log("Job name:", job.name);
        console.log("Job data:", job.data);

        const counts = await orderQueue.getJobCounts(
            "waiting",
            "active",
            "completed",
            "failed"
        );

        console.log("\nQueue status:");
        console.table(counts);

    } catch (error) {
        console.error("Failed to add job:", error);
        process.exitCode = 1;
    } finally {
        await orderQueue.close();
    }
}

addOrderJob();