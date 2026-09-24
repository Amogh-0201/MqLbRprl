const { performance } = require("perf_hooks");
const crypto = require("crypto");

// ============================================================
// BENCHMARK INPUTS
// ============================================================

const PRODUCT_ID = process.env.PRODUCT_ID;
const TOKEN = process.env.TEST_TOKEN;

const BASE_URL =
    process.env.BASE_URL ||
    "http://localhost:8080";

const TARGET_RPS =
    Number(process.env.TARGET_RPS || 1000);

const DURATION_SEC =
    Number(process.env.DURATION_SEC || 30);

const STOCK =
    Number(process.env.STOCK || 50);

const QUANTITY_PER_REQUEST =
    Number(
        process.env.QUANTITY_PER_REQUEST || 1
    );

// Set false when measuring ONLY admission capacity.
// Set true when you also want to monitor every accepted job.
const POLL_JOBS =
    String(
        process.env.POLL_JOBS || "true"
    ).toLowerCase() === "true";

const POLL_CONCURRENCY = 10;

const POLL_INTERVAL_MS = 500;

const JOB_TIMEOUT_MS =
    Number(
        process.env.JOB_TIMEOUT_MS ||
        10 * 60 * 1000
    );

// 0 = no artificial client-side admission timeout.
const REQUEST_TIMEOUT_MS =
    Number(
        process.env.REQUEST_TIMEOUT_MS || 0
    );

// Separate timeout for job-status requests.
const POLL_REQUEST_TIMEOUT_MS =
    Number(
        process.env.POLL_REQUEST_TIMEOUT_MS ||
        15000
    );

const RUN_ID =
    crypto.randomUUID();

const TOTAL_EXPECTED_REQUESTS =
    Math.floor(
        TARGET_RPS * DURATION_SEC
    );

const DURATION_MS =
    DURATION_SEC * 1000;

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
    !Number.isFinite(TARGET_RPS) ||
    TARGET_RPS <= 0
) {
    console.error(
        "TARGET_RPS must be greater than 0."
    );
    process.exit(1);
}

if (
    !Number.isFinite(DURATION_SEC) ||
    DURATION_SEC <= 0
) {
    console.error(
        "DURATION_SEC must be greater than 0."
    );
    process.exit(1);
}

if (
    !Number.isInteger(STOCK) ||
    STOCK < 0
) {
    console.error(
        "STOCK must be a non-negative integer."
    );
    process.exit(1);
}

if (
    !Number.isInteger(
        QUANTITY_PER_REQUEST
    ) ||
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

function percentile(values, p) {
    if (values.length === 0) {
        return 0;
    }

    const sorted = [...values].sort(
        (a, b) => a - b
    );

    const index =
        Math.ceil(
            (p / 100) *
            sorted.length
        ) - 1;

    return sorted[
        Math.max(0, index)
    ];
}

function formatMs(value) {
    return `${value.toFixed(2)} ms`;
}

function sleep(ms) {
    return new Promise(resolve => {
        setTimeout(resolve, ms);
    });
}

// ============================================================
// HTTP HELPER
// ============================================================

async function fetchRequest(
    url,
    options = {},
    timeoutMs = 0
) {
    if (
        !timeoutMs ||
        timeoutMs <= 0
    ) {
        return fetch(
            url,
            options
        );
    }

    const controller =
        new AbortController();

    const timeout =
        setTimeout(() => {
            controller.abort();
        }, timeoutMs);

    try {
        return await fetch(
            url,
            {
                ...options,
                signal:
                    controller.signal
            }
        );
    } finally {
        clearTimeout(timeout);
    }
}

// ============================================================
// SEND ONE FLASH-SALE REQUEST
// ============================================================

async function sendOrder(
    requestNumber
) {
    const idempotencyKey =
        `flash-rps-${RUN_ID}-${requestNumber}`;

    const start =
        performance.now();

    try {
        const response =
            await fetchRequest(
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
                },

                REQUEST_TIMEOUT_MS
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
                raw:
                    bodyText
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
                    error.message,

                cause:
                    error.cause
                        ? {
                            code:
                                error.cause.code,

                            message:
                                error.cause.message
                        }
                        : null
            }
        };
    }
}

// ============================================================
// OPEN-LOOP FLASH-SALE LOAD GENERATOR
// ============================================================

async function generateLoad() {
    const results = [];

    const pendingRequests = [];

    const testStart =
        performance.now();

    let nextRequestNumber = 1;

    let nextDueMs = 0;

    let lastLoggedSecond = -1;

    while (
        nextRequestNumber <=
        TOTAL_EXPECTED_REQUESTS
    ) {
        const now =
            performance.now();

        const elapsed =
            now - testStart;

        if (
            elapsed >
            DURATION_MS + 100
        ) {
            break;
        }

        while (
            nextRequestNumber <=
            TOTAL_EXPECTED_REQUESTS &&
            elapsed >= nextDueMs
        ) {
            const requestNumber =
                nextRequestNumber++;

            const promise =
                sendOrder(
                    requestNumber
                ).then(result => {
                    results.push(result);
                });

            pendingRequests.push(
                promise
            );

            nextDueMs +=
                1000 / TARGET_RPS;
        }

        const currentSecond =
            Math.floor(
                elapsed / 1000
            );

        if (
            currentSecond !==
            lastLoggedSecond &&
            currentSecond >= 0
        ) {
            lastLoggedSecond =
                currentSecond;

            console.log(
                `Admission generation: ${Math.min(
                    nextRequestNumber - 1,
                    TOTAL_EXPECTED_REQUESTS
                )}/${TOTAL_EXPECTED_REQUESTS} requests started`
            );
        }

        await new Promise(
            resolve =>
                setImmediate(resolve)
        );
    }

    const generationEnd =
        performance.now();

    console.log(
        "\nAll scheduled admission requests have been launched."
    );

    console.log(
        "Waiting for outstanding HTTP responses..."
    );

    await Promise.all(
        pendingRequests
    );

    const testEnd =
        performance.now();

    return {
        results,

        testStart,

        generationEnd,

        testEnd
    };
}

// ============================================================
// CLASSIFICATION
// ============================================================

function classifyResults(
    results
) {
    const accepted =
        results.filter(
            result =>
                result.status === 202
        );

    const soldOut =
        results.filter(
            result => {
                const message =
                    String(
                        result.body
                            ?.message ||
                        result.body
                            ?.msg ||
                        result.body
                            ?.error ||
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
        results.filter(
            result =>
                result.status === 429
        );

    const networkErrors =
        results.filter(
            result =>
                result.status ===
                "NETWORK_ERROR"
        );

    const serverErrors =
        results.filter(
            result =>
                typeof result.status ===
                "number" &&
                result.status >= 500
        );

    const other =
        results.filter(
            result =>
                !accepted.includes(
                    result
                ) &&
                !soldOut.includes(
                    result
                ) &&
                !rateLimited.includes(
                    result
                ) &&
                !networkErrors.includes(
                    result
                ) &&
                !serverErrors.includes(
                    result
                )
        );

    return {
        accepted,
        soldOut,
        rateLimited,
        networkErrors,
        serverErrors,
        other
    };
}

// ============================================================
// JOB STATUS
// ============================================================

async function getJobStatus(
    jobId
) {
    try {
        const response =
            await fetchRequest(
                `${BASE_URL}/api/v1/orders/jobs/${jobId}`,
                {
                    headers: {
                        "Authorization":
                            `Bearer ${TOKEN}`
                    }
                },

                POLL_REQUEST_TIMEOUT_MS
            );

        const bodyText =
            await response.text();

        let body;

        try {
            body =
                JSON.parse(
                    bodyText
                );
        } catch {
            body = {
                raw:
                    bodyText
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
// ============================================================

async function waitForJob(
    item
) {
    const start =
        performance.now();

    while (
        performance.now() -
        start <
        JOB_TIMEOUT_MS
    ) {
        const result =
            await getJobStatus(
                item.body.jobId
            );

        const status =
            result.body?.status;

        if (
            status ===
            "COMPLETED" ||
            status ===
            "FAILED"
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
// POLL ACCEPTED JOBS
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

    if (
        workerCount === 0
    ) {
        return results;
    }

    async function pollWorker() {
        while (
            true
        ) {
            const index =
                nextIndex++;

            if (
                index >=
                acceptedResults.length
            ) {
                return;
            }

            const result =
                await waitForJob(
                    acceptedResults[
                    index
                    ]
                );

            results.push(
                result
            );

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
// MAIN
// ============================================================

async function run() {
    console.log(
        "\n=========================================="
    );

    console.log(
        "        FLASH-SALE RPS BENCHMARK"
    );

    console.log(
        "=========================================="
    );

    console.log(
        `Run ID:               ${RUN_ID}`
    );

    console.log(
        `Base URL:             ${BASE_URL}`
    );

    console.log(
        `Product ID:           ${PRODUCT_ID}`
    );

    console.log(
        `Target RPS:           ${TARGET_RPS}`
    );

    console.log(
        `Duration:             ${DURATION_SEC} sec`
    );

    console.log(
        `Expected requests:   ${TOTAL_EXPECTED_REQUESTS}`
    );

    console.log(
        `Initial stock:        ${STOCK}`
    );

    console.log(
        `Quantity/request:     ${QUANTITY_PER_REQUEST}`
    );

    console.log(
        `Max possible sales:   ${Math.floor(
            STOCK /
            QUANTITY_PER_REQUEST
        )}`
    );

    console.log(
        `Poll accepted jobs:   ${POLL_JOBS}`
    );

    console.log(
        `Poll concurrency:     ${POLL_CONCURRENCY}`
    );

    console.log(
        `Request timeout:      ${REQUEST_TIMEOUT_MS > 0
            ? `${REQUEST_TIMEOUT_MS} ms`
            : "DISABLED"
        }`
    );

    console.log(
        "\nFLASH SALE MUST ALREADY BE ACTIVE."
    );

    console.log(
        "The benchmark does NOT initialize or modify stock."
    );

    // ========================================================
    // PHASE 1
    // ========================================================

    console.log(
        "\n=========================================="
    );

    console.log(
        "       PHASE 1: FLASH-SALE ADMISSION"
    );

    console.log(
        "=========================================="
    );

    const {
        results,
        testStart,
        generationEnd,
        testEnd
    } = await generateLoad();

    // ========================================================
    // CLASSIFY
    // ========================================================

    const {
        accepted,
        soldOut,
        rateLimited,
        networkErrors,
        serverErrors,
        other
    } = classifyResults(
        results
    );

    // ========================================================
    // HTTP METRICS
    // ========================================================

    const httpLatencies =
        results
            .filter(
                result =>
                    typeof result.status ===
                    "number"
            )
            .map(
                result =>
                    result.latencyMs
            );

    const generationTimeMs =
        generationEnd -
        testStart;

    const totalTimeMs =
        testEnd -
        testStart;

    const responseCount =
        results.filter(
            result =>
                typeof result.status ===
                "number"
        ).length;

    const actualOfferedRps =
        results.length /
        (
            generationTimeMs /
            1000
        );

    const responseThroughput =
        responseCount /
        (
            totalTimeMs /
            1000
        );

    // ========================================================
    // ADMISSION OUTPUT
    // ========================================================

    console.log(
        "\n------------------------------------------"
    );

    console.log(
        "FLASH-SALE ADMISSION"
    );

    console.log(
        "------------------------------------------"
    );

    console.log(
        `Requests launched:   ${results.length}`
    );

    console.log(
        `Target RPS:           ${TARGET_RPS.toFixed(2)}`
    );

    console.log(
        `Actual offered RPS:   ${actualOfferedRps.toFixed(2)}`
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
        `5xx server errors:    ${serverErrors.length}`
    );

    console.log(
        `Network errors:       ${networkErrors.length}`
    );

    console.log(
        `Other errors:         ${other.length}`
    );

    console.log(
        `Response throughput:  ${responseThroughput.toFixed(2)} responses/s`
    );

    console.log(
        `Generation time:      ${formatMs(
            generationTimeMs
        )}`
    );

    console.log(
        `Total HTTP time:      ${formatMs(
            totalTimeMs
        )}`
    );

    if (
        httpLatencies.length > 0
    ) {
        console.log(
            `HTTP p50:             ${formatMs(
                percentile(
                    httpLatencies,
                    50
                )
            )}`
        );

        console.log(
            `HTTP p95:             ${formatMs(
                percentile(
                    httpLatencies,
                    95
                )
            )}`
        );

        console.log(
            `HTTP p99:             ${formatMs(
                percentile(
                    httpLatencies,
                    99
                )
            )}`
        );

        console.log(
            `HTTP max:             ${formatMs(
                Math.max(
                    ...httpLatencies
                )
            )}`
        );
    }

    // ========================================================
    // INVENTORY CHECK
    // ========================================================

    const maximumPossibleSales =
        Math.floor(
            STOCK /
            QUANTITY_PER_REQUEST
        );

    console.log(
        "\n=========================================="
    );

    console.log(
        "             INVENTORY CHECK"
    );

    console.log(
        "=========================================="
    );

    console.log(
        `Initial stock:        ${STOCK}`
    );

    console.log(
        `Quantity/request:     ${QUANTITY_PER_REQUEST}`
    );

    console.log(
        `Maximum possible:     ${maximumPossibleSales} accepted orders`
    );

    console.log(
        `Observed 202s:        ${accepted.length}`
    );

    console.log(
        `Observed sold out:    ${soldOut.length}`
    );

    if (
        accepted.length >
        maximumPossibleSales
    ) {
        console.log(
            "WARNING: accepted orders exceed expected stock capacity."
        );
    } else {
        console.log(
            "Accepted count is within the expected stock bound."
        );
    }

    // ========================================================
    // NETWORK ERRORS
    // ========================================================

    if (
        networkErrors.length > 0
    ) {
        console.log(
            "\nNetwork error samples:"
        );

        console.table(
            networkErrors
                .slice(0, 10)
                .map(item => ({
                    request:
                        item.requestNumber,

                    message:
                        item.body?.message,

                    cause:
                        item.body?.cause
                            ?.code ||
                        "",

                    latencyMs:
                        item.latencyMs
                            .toFixed(2)
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
        !POLL_JOBS
    ) {
        console.log(
            "Job polling disabled."
        );

        console.log(
            "Admission results above are the end of this benchmark."
        );
    } else if (
        accepted.length === 0
    ) {
        console.log(
            "No jobs were accepted."
        );
    } else {
        console.log(
            `Monitoring ${accepted.length} accepted jobs...`
        );

        const jobResults =
            await waitForAllJobs(
                accepted
            );

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

        const queueWaits =
            completed
                .map(item =>
                    Number(
                        item.result
                            .queueWaitMs
                    )
                )
                .filter(
                    value =>
                        Number.isFinite(
                            value
                        )
                );

        const processingTimes =
            completed
                .map(item =>
                    Number(
                        item.result
                            .processingMs
                    )
                )
                .filter(
                    value =>
                        Number.isFinite(
                            value
                        )
                );

        const totalJobTimes =
            completed
                .map(item =>
                    Number(
                        item.result
                            .totalJobMs
                    )
                )
                .filter(
                    value =>
                        Number.isFinite(
                            value
                        )
                );

        console.log(
            "\n------------------------------------------"
        );

        console.log(
            "JOB PERFORMANCE"
        );

        console.log(
            "------------------------------------------"
        );

        console.log(
            `Jobs accepted:       ${accepted.length}`
        );

        console.log(
            `Completed:           ${completed.length}`
        );

        console.log(
            `Failed:              ${failed.length}`
        );

        console.log(
            `Timed out:           ${timedOut.length}`
        );

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
                            item.result
                                .orderId,

                        queueWaitMs:
                            item.result
                                .queueWaitMs,

                        processingMs:
                            item.result
                                .processingMs,

                        totalJobMs:
                            item.result
                                .totalJobMs
                    }))
            );
        }
    }

    // ========================================================
    // FINAL
    // ========================================================

    console.log(
        "\n=========================================="
    );

    console.log(
        "                  FINAL"
    );

    console.log(
        "=========================================="
    );

    console.log(
        `Target RPS:           ${TARGET_RPS}`
    );

    console.log(
        `Duration:             ${DURATION_SEC}s`
    );

    console.log(
        `Requests launched:   ${results.length}`
    );

    console.log(
        `202 accepted:        ${accepted.length}`
    );

    console.log(
        `400 sold out:        ${soldOut.length}`
    );

    console.log(
        `429 rate limited:    ${rateLimited.length}`
    );

    console.log(
        `5xx errors:          ${serverErrors.length}`
    );

    console.log(
        `Network errors:      ${networkErrors.length}`
    );

    console.log(
        `Other errors:        ${other.length}`
    );

    console.log(
        `Actual offered RPS:  ${actualOfferedRps.toFixed(2)}`
    );

    console.log(
        `Response throughput: ${responseThroughput.toFixed(2)}`
    );

    console.log(
        `HTTP test time:      ${formatMs(
            totalTimeMs
        )}`
    );

    console.log(
        "==========================================\n"
    );
}

run().catch(error => {
    console.error(
        "\nBenchmark failed:",
        error
    );

    process.exitCode = 1;
});