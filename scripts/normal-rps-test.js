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
    Number(process.env.TARGET_RPS || 50);

const DURATION_SEC =
    Number(process.env.DURATION_SEC || 30);

const STOCK =
    Number(process.env.STOCK || 1000);

const QUANTITY_PER_REQUEST =
    Number(
        process.env.QUANTITY_PER_REQUEST || 1
    );

// 0 = no client-side timeout.
// This is preferable for capacity testing because
// the benchmark should not manufacture failures itself.
//
// Nginx/app may still return a real HTTP timeout/error.
const REQUEST_TIMEOUT_MS =
    Number(
        process.env.REQUEST_TIMEOUT_MS || 0
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
    options = {}
) {
    if (
        !REQUEST_TIMEOUT_MS ||
        REQUEST_TIMEOUT_MS <= 0
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
        }, REQUEST_TIMEOUT_MS);

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
// SEND ONE NORMAL ORDER
// ============================================================

async function sendOrder(
    requestNumber
) {
    const idempotencyKey =
        `normal-capacity-${RUN_ID}-${requestNumber}`;

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
// OPEN-LOOP RPS GENERATOR
//
// IMPORTANT:
//
// We do NOT do:
//
//   Promise.all(10000)
//
// immediately.
//
// Instead:
//
//   TARGET_RPS = 100
//
//   t=0      -> request
//   t=10ms   -> request
//   ...
//
// The generator keeps scheduling arrivals according
// to the target rate even while earlier requests are
// still being processed.
//
// This is what makes it a sustained-capacity benchmark.
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

        // Send every request whose scheduled
        // arrival time has been reached.
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
                `Load generation: ${Math.min(
                    nextRequestNumber - 1,
                    TOTAL_EXPECTED_REQUESTS
                )}/${TOTAL_EXPECTED_REQUESTS} requests started`
            );
        }

        // Yield to Node so sockets/responses
        // can continue being processed.
        await new Promise(
            resolve =>
                setImmediate(resolve)
        );
    }

    const generationEnd =
        performance.now();

    console.log(
        "\nAll scheduled requests have been launched."
    );

    console.log(
        "Waiting for outstanding responses..."
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
    const successful =
        results.filter(
            result =>
                result.status === 201
        );

    const insufficientStock =
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
                !successful.includes(
                    result
                ) &&
                !insufficientStock.includes(
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
        successful,
        insufficientStock,
        rateLimited,
        networkErrors,
        serverErrors,
        other
    };
}

// ============================================================
// MAIN
// ============================================================

async function run() {
    console.log(
        "\n=========================================="
    );

    console.log(
        "        NORMAL CAPACITY BENCHMARK"
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
        `Expected max orders:  ${Math.floor(
            STOCK /
            QUANTITY_PER_REQUEST
        )}`
    );

    console.log(
        `Request timeout:      ${REQUEST_TIMEOUT_MS > 0
            ? `${REQUEST_TIMEOUT_MS} ms`
            : "DISABLED"
        }`
    );

    console.log(
        "\nFlash sale MUST be inactive for this test."
    );

    console.log(
        "The benchmark does NOT modify stock."
    );

    console.log(
        "STOCK is the initial server-side stock prepared before the run."
    );

    // ========================================================
    // LOAD
    // ========================================================

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
        successful,
        insufficientStock,
        rateLimited,
        networkErrors,
        serverErrors,
        other
    } = classifyResults(
        results
    );

    // ========================================================
    // LATENCY
    //
    // ONLY actual HTTP responses.
    // Network failures do not enter HTTP latency stats.
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

    // ========================================================
    // METRICS
    // ========================================================

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
    // OUTPUT
    // ========================================================

    console.log(
        "\n=========================================="
    );

    console.log(
        "            LOAD GENERATION"
    );

    console.log(
        "=========================================="
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
        `Generation time:      ${formatMs(
            generationTimeMs
        )}`
    );

    console.log(
        `Total test time:      ${formatMs(
            totalTimeMs
        )}`
    );

    console.log(
        "\n=========================================="
    );

    console.log(
        "              HTTP RESULTS"
    );

    console.log(
        "=========================================="
    );

    console.log(
        `201 success:          ${successful.length}`
    );

    console.log(
        `400 insufficient:     ${insufficientStock.length}`
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
    } else {
        console.log(
            "HTTP latency:        no HTTP responses"
        );
    }

    // ========================================================
    // INVENTORY EXPECTATION
    // ========================================================

    const maximumPossibleOrders =
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
        `Maximum possible:     ${maximumPossibleOrders} orders`
    );

    console.log(
        `Successful 201s:      ${successful.length}`
    );

    console.log(
        `Insufficient stock:   ${insufficientStock.length}`
    );

    if (
        successful.length >
        maximumPossibleOrders
    ) {
        console.log(
            "WARNING: successful orders exceed expected stock capacity."
        );
    } else {
        console.log(
            "Inventory result is within the expected stock bound."
        );
    }

    // ========================================================
    // ERROR SAMPLES
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

    if (
        serverErrors.length > 0
    ) {
        console.log(
            "\nServer error samples:"
        );

        console.table(
            serverErrors
                .slice(0, 10)
                .map(item => ({
                    request:
                        item.requestNumber,

                    status:
                        item.status,

                    message:
                        item.body?.message ||
                        item.body?.msg ||
                        item.body?.error,

                    latencyMs:
                        item.latencyMs
                            .toFixed(2)
                }))
        );
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
        `201 successful:      ${successful.length}`
    );

    console.log(
        `400 sold out:        ${insufficientStock.length}`
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
        `Total test time:     ${formatMs(
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
