const PRODUCT_ID = "6a9ada36d88fa505e6d2c4fd";

const TOKEN = process.env.TEST_TOKEN;

const BASE_URL = "http://localhost:8080";

const TOTAL_REQUESTS = 100;
const QUANTITY_PER_REQUEST = 1;

const POLL_INTERVAL_MS = 250;
const JOB_TIMEOUT_MS = 30_000;

if (!TOKEN) {
    console.error(
        "Missing TEST_TOKEN environment variable."
    );
    console.error(
        "PowerShell: $env:TEST_TOKEN=\"YOUR_JWT\""
    );
    process.exit(1);
}

async function sendOrder(requestNumber) {
    const idempotencyKey =
        `flash-test-${Date.now()}-${requestNumber}`;

    try {
        const response = await fetch(
            `${BASE_URL}/api/v1/orders`,
            {
                method: "POST",

                headers: {
                    "Content-Type": "application/json",

                    "Authorization":
                        `Bearer ${TOKEN}`,

                    "Idempotency-Key":
                        idempotencyKey
                },

                body: JSON.stringify({
                    productId: PRODUCT_ID,
                    quantity: QUANTITY_PER_REQUEST
                })
            }
        );

        const text = await response.text();

        let body;

        try {
            body = JSON.parse(text);
        } catch {
            body = {
                raw: text
            };
        }

        return {
            requestNumber,
            idempotencyKey,
            status: response.status,
            body
        };

    } catch (error) {
        return {
            requestNumber,
            idempotencyKey,
            status: "NETWORK_ERROR",
            body: {
                message: error.message
            }
        };
    }
}

async function getJobStatus(jobId) {
    const response = await fetch(
        `${BASE_URL}/api/v1/orders/jobs/${jobId}`,
        {
            method: "GET",

            headers: {
                "Authorization":
                    `Bearer ${TOKEN}`
            }
        }
    );

    const text = await response.text();

    let body;

    try {
        body = JSON.parse(text);
    } catch {
        body = {
            raw: text
        };
    }

    return {
        httpStatus: response.status,
        body
    };
}

function sleep(ms) {
    return new Promise(resolve =>
        setTimeout(resolve, ms)
    );
}

async function waitForJob(jobId) {
    const start = Date.now();

    let lastStatus = null;

    while (
        Date.now() - start <
        JOB_TIMEOUT_MS
    ) {
        try {
            const result =
                await getJobStatus(jobId);

            const status =
                result.body?.status;

            /*
                Only print when the job state changes.
            */
            if (status !== lastStatus) {
                console.log(
                    `   Job ${jobId} → ${status}`
                );

                lastStatus = status;
            }

            if (
                status === "COMPLETED" ||
                status === "FAILED"
            ) {
                return result.body;
            }

        } catch (error) {
            console.log(
                `   Job ${jobId} status check failed: ${error.message}`
            );
        }

        await sleep(
            POLL_INTERVAL_MS
        );
    }

    return {
        status: "TIMEOUT"
    };
}

async function run() {
    console.log(
        "\n=========================================="
    );

    console.log(
        "       FLASH SALE CONCURRENCY TEST"
    );

    console.log(
        "=========================================="
    );

    console.log(
        `Product: ${PRODUCT_ID}`
    );

    console.log(
        `Stock should be: 10`
    );

    console.log(
        `Concurrent requests: ${TOTAL_REQUESTS}`
    );

    console.log(
        `Quantity per request: ${QUANTITY_PER_REQUEST}`
    );

    console.log(
        "\nSending requests..."
    );

    const start =
        Date.now();

    const results =
        await Promise.all(
            Array.from(
                {
                    length: TOTAL_REQUESTS
                },
                (_, index) =>
                    sendOrder(index + 1)
            )
        );

    const requestElapsed =
        Date.now() - start;

    /*
        =========================================
        IMMEDIATE HTTP RESULTS
        =========================================
    */

    const accepted =
        results.filter(
            result =>
                result.status === 202
        );

    const soldOut =
        results.filter(
            result =>
                result.status === 400 &&
                String(
                    result.body?.message ||
                    result.body?.msg ||
                    result.body?.error ||
                    ""
                ).toLowerCase()
                    .includes("insufficient")
        );

    const rateLimited =
        results.filter(
            result =>
                result.status === 429
        );

    const other =
        results.filter(
            result =>
                !accepted.includes(result) &&
                !soldOut.includes(result) &&
                !rateLimited.includes(result)
        );

    console.log(
        "\n=========================================="
    );

    console.log(
        "        IMMEDIATE HTTP RESULT"
    );

    console.log(
        "=========================================="
    );

    console.log(
        `Total requests: ${TOTAL_REQUESTS}`
    );

    console.log(
        `Accepted into queue: ${accepted.length}`
    );

    console.log(
        `Sold out / rejected: ${soldOut.length}`
    );

    console.log(
        `Rate limited (429): ${rateLimited.length}`
    );

    console.log(
        `Other errors: ${other.length}`
    );

    console.log(
        `Request phase time: ${requestElapsed} ms`
    );

    console.log("\nHTTP status counts:");

    const statusCounts = {};

    for (const result of results) {
        statusCounts[result.status] =
            (statusCounts[result.status] || 0) + 1;
    }

    console.table(statusCounts);

    /*
        =========================================
        SHOW ACCEPTED JOBS
        =========================================
    */

    console.log(
        "\n=========================================="
    );

    console.log(
        "        ACCEPTED FLASH-SALE JOBS"
    );

    console.log(
        "=========================================="
    );

    if (accepted.length === 0) {
        console.log(
            "No jobs were accepted."
        );
    } else {
        accepted.forEach(result => {
            console.log(
                `Request #${result.requestNumber} → ` +
                `202 ACCEPTED → Job ${result.body.jobId}`
            );
        });
    }

    /*
        =========================================
        SHOW SOLD OUT REQUESTS
        =========================================
    */

    console.log(
        "\n=========================================="
    );

    console.log(
        "        REJECTED / SOLD OUT REQUESTS"
    );

    console.log(
        "=========================================="
    );

    soldOut.slice(0, 20).forEach(
        result => {
            console.log(
                `Request #${result.requestNumber} → ` +
                `400 → Insufficient Stock`
            );
        }
    );

    if (soldOut.length > 20) {
        console.log(
            `... and ${soldOut.length - 20} more`
        );
    }

    /*
        =========================================
        POLL ACCEPTED JOBS
        =========================================
    */

    console.log(
        "\n=========================================="
    );

    console.log(
        "        WORKER PROCESSING"
    );

    console.log(
        "=========================================="
    );

    const completed = [];
    const failed = [];
    const timedOut = [];

    for (const result of accepted) {
        const jobId =
            result.body.jobId;

        console.log(
            `\nRequest #${result.requestNumber}`
        );

        console.log(
            `Job ID: ${jobId}`
        );

        console.log(
            `Checking: GET /api/v1/orders/jobs/${jobId}`
        );

        const finalResult =
            await waitForJob(jobId);

        if (
            finalResult.status ===
            "COMPLETED"
        ) {
            completed.push({
                requestNumber:
                    result.requestNumber,

                jobId,

                orderId:
                    finalResult.orderId
            });

            console.log(
                `   ✅ ORDER CREATED`
            );

            console.log(
                `   Order ID: ${finalResult.orderId}`
            );

        } else if (
            finalResult.status ===
            "FAILED"
        ) {
            failed.push({
                requestNumber:
                    result.requestNumber,

                jobId,

                reason:
                    finalResult.reason
            });

            console.log(
                `   ❌ JOB FAILED`
            );

            console.log(
                `   Reason: ${finalResult.reason}`
            );

        } else {
            timedOut.push({
                requestNumber:
                    result.requestNumber,

                jobId
            });

            console.log(
                `   ⏰ JOB STATUS TIMEOUT`
            );
        }
    }

    /*
        =========================================
        FINAL RESULT
        =========================================
    */

    console.log(
        "\n\n=========================================="
    );

    console.log(
        "             FINAL RESULT"
    );

    console.log(
        "=========================================="
    );

    console.log(
        `Requests sent:       ${TOTAL_REQUESTS}`
    );

    console.log(
        `Redis accepted:      ${accepted.length}`
    );

    console.log(
        `Sold out:            ${soldOut.length}`
    );

    console.log(
        `Jobs completed:      ${completed.length}`
    );

    console.log(
        `Jobs failed:         ${failed.length}`
    );

    console.log(
        `Jobs timed out:      ${timedOut.length}`
    );

    console.log(
        `Total script time:   ${Date.now() - start
        } ms`
    );

    console.log(
        "\nExpected for stock=10:"
    );

    console.log(
        "10 accepted"
    );

    console.log(
        "90 sold out"
    );

    console.log(
        "10 completed orders"
    );

    console.log(
        "0 overselling"
    );

    console.log(
        "==========================================\n"
    );
}

run().catch(error => {
    console.error(
        "\nFatal test error:",
        error
    );

    process.exitCode = 1;
});