const { performance } = require("perf_hooks");
const crypto = require("crypto");

// ============================================================
// BENCHMARK INPUTS
// These are CLIENT/load parameters, not server configuration.
// ============================================================

const PRODUCT_ID = process.env.PRODUCT_ID;
const TOKEN = process.env.TEST_TOKEN;

const BASE_URL = "http://localhost:8080";

const TOTAL_REQUESTS =
    Number(process.env.TOTAL_REQUESTS || 100);

const QUANTITY_PER_REQUEST =
    Number(process.env.QUANTITY_PER_REQUEST || 1);

// ============================================================
// INTERNAL CLIENT BEHAVIOUR
// Do NOT change these for server-capacity experiments.
// ============================================================

const POLL_CONCURRENCY = 10;
const POLL_INTERVAL_MS = 500;

// One worker may legitimately need several minutes
// to drain a large queue.
const JOB_TIMEOUT_MS = 10 * 60 * 1000;

const REQUEST_TIMEOUT_MS = 30 * 1000;

const RUN_ID = crypto.randomUUID();

// ============================================================
// VALIDATION
// ============================================================

if (!TOKEN) {
    console.error("TEST_TOKEN is missing.");
    console.error(
        'PowerShell: $env:TEST_TOKEN="YOUR_JWT"'
    );
    process.exit(1);
}

if (!PRODUCT_ID) {
    console.error("PRODUCT_ID is missing.");
    console.error(
        'PowerShell: $env:PRODUCT_ID="YOUR_PRODUCT_ID"'
    );
    process.exit(1);
}

if (
    !Number.isInteger(TOTAL_REQUESTS) ||
    TOTAL_REQUESTS <= 0
) {
    console.error(
        "TOTAL_REQUESTS must be a positive integer."
    );
    process.exit(1);
}

if (
    !Number.isInteger(QUANTITY_PER_REQUEST) ||
    QUANTITY_PER_REQUEST <= 0
) {
    console.error(
        "QUANTITY_PER_REQUEST must be a positive integer."
    );
    process.exit(1);
}

// ============================================================
// HELPERS
// ============================================================

function sleep(ms) {
    return new Promise(resolve => {
        setTimeout(resolve, ms);
    });
}

function percentile(values, p) {
    if (values.length === 0) {
        return 0;
    }

    const sorted = [...values].sort(
        (a, b) => a - b
    );

    const index =
        Math.ceil(
            (p / 100) * sorted.length
        ) - 1;

    return sorted[
        Math.max(0, index)
    ];
}

function formatMs(value) {
    return `${value.toFixed(2)} ms`;
}

// ============================================================
// HTTP HELPER
// ============================================================

async function fetchWithTimeout(
    url,
    options = {}
) {
    const controller =
        new AbortController();

    const timeout =
        setTimeout(() => {
            controller.abort();
        }, REQUEST_TIMEOUT_MS);

    try {
        return await fetch(
            url,
            {
                ...options,
                signal: controller.signal
            }
        );
    } finally {
        clearTimeout(timeout);
    }
}

// ============================================================
// SEND ONE ORDER REQUEST
//
// This is the ONLY admission mechanism.
// The server decides:
//   Redis reservation
//   BullMQ enqueue
//   202 / 400 / 429 / etc.
// ============================================================

async function sendOrder(requestNumber) {
    const idempotencyKey =
        `flash-benchmark-${RUN_ID}-${requestNumber}`;

    const start =
        performance.now();

    try {
        const response =
            await fetchWithTimeout(
                `${BASE_URL}/api/v1/orders`,
                {
                    method: "POST",

                    headers: {
                        "Content-Type":
                            "application/json",

                        "Authorization":
                            `Bearer ${TOKEN}`,

                        "Idempotency-Key":
                            idempotencyKey
                    },

                    body: JSON.stringify({
                        productId:
                            PRODUCT_ID,

                        quantity:
                            QUANTITY_PER_REQUEST
                    })
                }
            );

        const end =
            performance.now();

        const bodyText =
            await response.text();

        let body;

        try {
            body = JSON.parse(
                bodyText
            );
        } catch {
            body = {
                raw: bodyText
            };
        }

        return {
            requestNumber,
            idempotencyKey,

            status:
                response.status,

            latencyMs:
                end - start,

            body
        };

    } catch (error) {
        const end =
            performance.now();

        return {
            requestNumber,
            idempotencyKey,

            status:
                "NETWORK_ERROR",

            latencyMs:
                end - start,

            body: {
                message:
                    error.message
            }
        };
    }
}

// ============================================================
// GET ONE JOB STATUS
//
// Again: HTTP only.
// No BullMQ / Redis access here.
// ============================================================

async function getJobStatus(jobId) {
    try {
        const response =
            await fetchWithTimeout(
                `${BASE_URL}/api/v1/orders/jobs/${jobId}`,
                {
                    headers: {
                        "Authorization":
                            `Bearer ${TOKEN}`
                    }
                }
            );

        const bodyText =
            await response.text();

        let body;

        try {
            body = JSON.parse(
                bodyText
            );
        } catch {
            body = {
                raw: bodyText
            };
        }

        return {
            httpStatus:
                response.status,

            body
        };

    } catch (error) {
        return {
            httpStatus:
                "NETWORK_ERROR",

            body: {
                message:
                    error.message
            }
        };
    }
}

// ============================================================
// WAIT FOR ONE JOB
//
// Only COMPLETED / FAILED stop polling.
// 429/network errors are retried.
// ============================================================

async function waitForJob(item) {
    const start =
        performance.now();

    while (
        performance.now() - start <
        JOB_TIMEOUT_MS
    ) {
        const result =
            await getJobStatus(
                item.body.jobId
            );

        const status =
            result.body?.status;

        if (
            status === "COMPLETED" ||
            status === "FAILED"
        ) {
            return {
                requestNumber:
                    item.requestNumber,

                jobId:
                    item.body.jobId,

                result:
                    result.body
            };
        }

        await sleep(
            POLL_INTERVAL_MS
        );
    }

    return {
        requestNumber:
            item.requestNumber,

        jobId:
            item.body.jobId,

        result: {
            status:
                "TIMEOUT"
        }
    };
}

// ============================================================
// LIMITED-CONCURRENCY JOB POLLING
//
// Important:
// We NEVER create 456/1000 simultaneous polling loops.
//
// At most 10 status requests are actively being monitored.
// ============================================================

async function waitForAllJobs(
    acceptedResults
) {
    const results = [];

    let nextIndex = 0;

    const workerCount =
        Math.min(
            POLL_CONCURRENCY,
            acceptedResults.length
        );

    async function pollWorker() {
        while (
            nextIndex <
            acceptedResults.length
        ) {
            const index =
                nextIndex++;

            const item =
                acceptedResults[index];

            const result =
                await waitForJob(item);

            results.push(result);

            const completedCount =
                results.length;

            if (
                completedCount % 50 === 0 ||
                completedCount ===
                acceptedResults.length
            ) {
                console.log(
                    `Job progress: ${completedCount}/${acceptedResults.length}`
                );
            }
        }
    }

    await Promise.all(
        Array.from(
            {
                length:
                    workerCount
            },
            () => pollWorker()
        )
    );

    return results;
}

// ============================================================
// MAIN BENCHMARK
// ============================================================

async function run() {
    console.log(
        "\n=========================================="
    );

    console.log(
        "          FLASH-SALE BENCHMARK"
    );

    console.log(
        "=========================================="
    );

    console.log(
        `Run ID:              ${RUN_ID}`
    );

    console.log(
        `Product ID:          ${PRODUCT_ID}`
    );

    console.log(
        `Requests:            ${TOTAL_REQUESTS}`
    );

    console.log(
        `Quantity/request:    ${QUANTITY_PER_REQUEST}`
    );

    console.log(
        `Poll concurrency:    ${POLL_CONCURRENCY}`
    );

    console.log(
        "\nThe benchmark uses HTTP only."
    );

    // ========================================================
    // PHASE 1
    // ========================================================

    console.log(
        "\n=========================================="
    );

    console.log(
        "       PHASE 1: API ADMISSION"
    );

    console.log(
        "=========================================="
    );

    console.log(
        `Sending ${TOTAL_REQUESTS} concurrent POST requests...`
    );

    const benchmarkStart =
        performance.now();

    const requestResults =
        await Promise.all(
            Array.from(
                {
                    length:
                        TOTAL_REQUESTS
                },
                (_, index) =>
                    sendOrder(
                        index + 1
                    )
            )
        );

    const requestPhaseEnd =
        performance.now();

    // ========================================================
    // CLASSIFY
    // ========================================================

    const accepted =
        requestResults.filter(
            result =>
                result.status === 202
        );

    const soldOut =
        requestResults.filter(
            result => {
                const message =
                    String(
                        result.body?.message ||
                        result.body?.msg ||
                        result.body?.error ||
                        ""
                    ).toLowerCase();

                return (
                    result.status === 400 &&
                    message.includes(
                        "insufficient"
                    )
                );
            }
        );

    const rateLimited =
        requestResults.filter(
            result =>
                result.status === 429
        );

    const networkErrors =
        requestResults.filter(
            result =>
                result.status ===
                "NETWORK_ERROR"
        );

    const other =
        requestResults.filter(
            result =>
                !accepted.includes(result) &&
                !soldOut.includes(result) &&
                !rateLimited.includes(result) &&
                !networkErrors.includes(result)
        );

    // ========================================================
    // HTTP METRICS
    // ========================================================

    const httpLatencies =
        requestResults.map(
            result =>
                result.latencyMs
        );

    console.log(
        "\n------------------------------------------"
    );

    console.log(
        "HTTP / ADMISSION"
    );

    console.log(
        "------------------------------------------"
    );

    console.log(
        `Total requests:     ${TOTAL_REQUESTS}`
    );

    console.log(
        `Accepted (202):     ${accepted.length}`
    );

    console.log(
        `Sold out (400):     ${soldOut.length}`
    );

    console.log(
        `Rate limited (429): ${rateLimited.length}`
    );

    console.log(
        `Network errors:     ${networkErrors.length}`
    );

    console.log(
        `Other errors:       ${other.length}`
    );

    console.log(
        `HTTP p50:            ${formatMs(
            percentile(
                httpLatencies,
                50
            )
        )}`
    );

    console.log(
        `HTTP p95:            ${formatMs(
            percentile(
                httpLatencies,
                95
            )
        )}`
    );

    console.log(
        `HTTP p99:            ${formatMs(
            percentile(
                httpLatencies,
                99
            )
        )}`
    );

    console.log(
        `HTTP max:            ${formatMs(
            Math.max(
                ...httpLatencies
            )
        )}`
    );

    console.log(
        `Request phase:       ${formatMs(
            requestPhaseEnd -
            benchmarkStart
        )}`
    );

    console.log(
        `HTTP throughput:     ${(
            TOTAL_REQUESTS /
            (
                (
                    requestPhaseEnd -
                    benchmarkStart
                ) / 1000
            )
        ).toFixed(2)} req/s`
    );

    // ========================================================
    // SHOW UNEXPECTED ERRORS
    // ========================================================

    if (
        networkErrors.length > 0
    ) {
        console.log(
            "\nNetwork errors:"
        );

        console.table(
            networkErrors
                .slice(0, 10)
                .map(item => ({
                    request:
                        item.requestNumber,

                    message:
                        item.body?.message,

                    latencyMs:
                        item.latencyMs.toFixed(2)
                }))
        );
    }

    if (
        other.length > 0
    ) {
        console.log(
            "\nOther HTTP errors:"
        );

        console.table(
            other
                .slice(0, 10)
                .map(item => ({
                    request:
                        item.requestNumber,

                    status:
                        item.status,

                    message:
                        item.body?.message ||
                        item.body?.msg ||
                        item.body?.error
                }))
        );
    }

    // ========================================================
    // PHASE 2
    // ========================================================

    console.log(
        "\n=========================================="
    );

    console.log(
        "       PHASE 2: BULLMQ PROCESSING"
    );

    console.log(
        "=========================================="
    );

    if (
        accepted.length === 0
    ) {
        console.log(
            "No jobs were accepted."
        );
    }

    console.log(
        `Monitoring ${accepted.length} accepted jobs...`
    );

    const jobResults =
        await waitForAllJobs(
            accepted
        );

    // ========================================================
    // JOB RESULTS
    // ========================================================

    const completed =
        jobResults.filter(
            item =>
                item.result.status ===
                "COMPLETED"
        );

    const failed =
        jobResults.filter(
            item =>
                item.result.status ===
                "FAILED"
        );

    const timedOut =
        jobResults.filter(
            item =>
                item.result.status ===
                "TIMEOUT"
        );

    // ========================================================
    // SERVER-PROVIDED TIMINGS
    // ========================================================

    const queueWaits =
        completed
            .map(item =>
                Number(
                    item.result.queueWaitMs
                )
            )
            .filter(
                value =>
                    Number.isFinite(value)
            );

    const processingTimes =
        completed
            .map(item =>
                Number(
                    item.result.processingMs
                )
            )
            .filter(
                value =>
                    Number.isFinite(value)
            );

    const totalJobTimes =
        completed
            .map(item =>
                Number(
                    item.result.totalJobMs
                )
            )
            .filter(
                value =>
                    Number.isFinite(value)
            );

    // ========================================================
    // JOB PERFORMANCE
    // ========================================================

    console.log(
        "\n=========================================="
    );

    console.log(
        "             JOB PERFORMANCE"
    );

    console.log(
        "=========================================="
    );

    console.log(
        `Jobs accepted:      ${accepted.length}`
    );

    console.log(
        `Completed:          ${completed.length}`
    );

    console.log(
        `Failed:             ${failed.length}`
    );

    console.log(
        `Timed out:          ${timedOut.length}`
    );

    // --------------------------------------------------------
    // QUEUE WAIT
    // --------------------------------------------------------

    if (
        queueWaits.length > 0
    ) {
        console.log(
            "\nQueue wait time:"
        );

        console.log(
            `p50:                 ${formatMs(
                percentile(
                    queueWaits,
                    50
                )
            )}`
        );

        console.log(
            `p95:                 ${formatMs(
                percentile(
                    queueWaits,
                    95
                )
            )}`
        );

        console.log(
            `p99:                 ${formatMs(
                percentile(
                    queueWaits,
                    99
                )
            )}`
        );

        console.log(
            `max:                 ${formatMs(
                Math.max(
                    ...queueWaits
                )
            )}`
        );
    }

    // --------------------------------------------------------
    // PROCESSING
    // --------------------------------------------------------

    if (
        processingTimes.length > 0
    ) {
        console.log(
            "\nWorker processing time:"
        );

        console.log(
            `p50:                 ${formatMs(
                percentile(
                    processingTimes,
                    50
                )
            )}`
        );

        console.log(
            `p95:                 ${formatMs(
                percentile(
                    processingTimes,
                    95
                )
            )}`
        );

        console.log(
            `p99:                 ${formatMs(
                percentile(
                    processingTimes,
                    99
                )
            )}`
        );

        console.log(
            `max:                 ${formatMs(
                Math.max(
                    ...processingTimes
                )
            )}`
        );
    }

    // --------------------------------------------------------
    // TOTAL JOB LIFETIME
    // --------------------------------------------------------

    if (
        totalJobTimes.length > 0
    ) {
        console.log(
            "\nTotal job lifetime:"
        );

        console.log(
            `p50:                 ${formatMs(
                percentile(
                    totalJobTimes,
                    50
                )
            )}`
        );

        console.log(
            `p95:                 ${formatMs(
                percentile(
                    totalJobTimes,
                    95
                )
            )}`
        );

        console.log(
            `p99:                 ${formatMs(
                percentile(
                    totalJobTimes,
                    99
                )
            )}`
        );

        console.log(
            `max:                 ${formatMs(
                Math.max(
                    ...totalJobTimes
                )
            )}`
        );
    }

    // ========================================================
    // SAMPLE COMPLETED JOBS
    // ========================================================

    if (
        completed.length > 0
    ) {
        console.log(
            "\nSample completed jobs:"
        );

        console.table(
            completed
                .slice(0, 10)
                .map(item => ({
                    request:
                        item.requestNumber,

                    jobId:
                        item.jobId,

                    orderId:
                        item.result.orderId,

                    queueWaitMs:
                        item.result.queueWaitMs,

                    processingMs:
                        item.result.processingMs,

                    totalJobMs:
                        item.result.totalJobMs
                }))
        );
    }

    // ========================================================
    // FINAL
    // ========================================================

    const totalElapsed =
        performance.now() -
        benchmarkStart;

    console.log(
        "\n=========================================="
    );

    console.log(
        "                 FINAL"
    );

    console.log(
        "=========================================="
    );

    console.log(
        `Requests:             ${TOTAL_REQUESTS}`
    );

    console.log(
        `202 accepted:         ${accepted.length}`
    );

    console.log(
        `400 sold out:         ${soldOut.length}`
    );

    console.log(
        `429 rate limited:     ${rateLimited.length}`
    );

    console.log(
        `Network errors:       ${networkErrors.length}`
    );

    console.log(
        `Other errors:         ${other.length}`
    );

    console.log(
        `Jobs completed:       ${completed.length}`
    );

    console.log(
        `Jobs failed:          ${failed.length}`
    );

    console.log(
        `Jobs timed out:       ${timedOut.length}`
    );

    console.log(
        `Total benchmark time: ${formatMs(
            totalElapsed
        )}`
    );

    console.log(
        "==========================================\n"
    );
}

// ============================================================
// START
// ============================================================

run().catch(error => {
    console.error(
        "\nBenchmark failed:",
        error
    );

    process.exitCode = 1;
});
