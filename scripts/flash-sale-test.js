const PRODUCT_ID = "6a9ada36d88fa505e6d2c4fd";
const TOKEN = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJ1c2VySWQiOiI2YTlhZDliZWQ4OGZhNTA1ZTZkMmM0ZmEiLCJyb2xlIjoidXNlciIsImlhdCI6MTc4OTkwNjgzNiwiZXhwIjoxNzkwMTY2MDM2fQ.fFP9W3X9Mnq-9pAzGPSaVag4KPC06-KQPOEKEWJIoME";

const TOTAL_REQUESTS = 100;

async function placeOrder(requestNumber) {

    try {

        const response = await fetch("http://localhost:8080/api/v1/orders", {
            method: "POST",
            headers: {
                "Content-Type": "application/json",
                "Authorization": `Bearer ${TOKEN}`
            },
            body: JSON.stringify({
                productId: PRODUCT_ID,
                quantity: 1
            })
        });

        const body = await response.text();

        return {
            requestNumber,
            status: response.status,
            body
        };

    } catch (err) {
        return {
            requestNumber,
            status: "NETWORK_ERROR",
            body: err.message
        };
    }
}

async function run() {

    console.log(`Sending ${TOTAL_REQUESTS} concurrent order requests...`);

    const start = Date.now();

    const results = await Promise.all(
        Array.from(
            { length: TOTAL_REQUESTS },
            (_, i) => placeOrder(i + 1)
        )
    );

    const elapsed = Date.now() - start;

    const successful = results.filter(r => r.status === 201);

    const insufficientStock = results.filter(
        r =>
            r.status === 400 &&
            r.body.toLowerCase().includes("insufficient")
    );

    const otherErrors = results.filter(
        r =>
            !successful.includes(r) &&
            !insufficientStock.includes(r)
    );

    console.log("\n========== RESULT ==========");
    console.log("Total requests:", TOTAL_REQUESTS);
    console.log("Successful:", successful.length);
    console.log("Insufficient stock:", insufficientStock.length);
    console.log("Other errors:", otherErrors.length);
    console.log("Elapsed:", `${elapsed} ms`);

    console.log("\nStatus counts:");

    const statusCounts = {};

    for (const result of results) {
        statusCounts[result.status] =
            (statusCounts[result.status] || 0) + 1;
    }

    console.table(statusCounts);

    if (otherErrors.length > 0) {
        console.log("\nOther errors:");
        console.log(otherErrors.slice(0, 10));
    }
}

run();