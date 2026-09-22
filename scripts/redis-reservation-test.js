const {
    reserveStock,
    getAvailableStock
} = require("../services/inventoryService");

async function redisReservationTest() {

    const productId = process.argv[2];

    if (!productId) {
        throw new Error(
            "Usage: node scripts/redis-reservation-test.js <productId>"
        );
    }

    console.log(
        "Available stock before:",
        await getAvailableStock(productId)
    );

    const successful = [];
    const rejected = [];

    const TOTAL_REQUESTS = 100;

    const results = await Promise.all(
        Array.from(
            { length: TOTAL_REQUESTS },
            async (_, index) => {
                const success = await reserveStock(
                    productId,
                    1
                );

                return {
                    request: index + 1,
                    success
                };
            }
        )
    );

    for (const result of results) {
        if (result.success) {
            successful.push(result);
        } else {
            rejected.push(result);
        }
    }

    console.log("\n========== REDIS RESERVATION TEST ==========");
    console.log("Total requests:", TOTAL_REQUESTS);
    console.log("Successful reservations:", successful.length);
    console.log("Rejected:", rejected.length);

    console.log(
        "Available stock after:",
        await getAvailableStock(productId)
    );
}

async function main() {
    try {
        await redisReservationTest();
    } catch (error) {
        console.error(error);
        process.exitCode = 1;
    }
}

main();