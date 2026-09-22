const { Queue } = require("bullmq");
const { performance } = require("perf_hooks");
const crypto = require("crypto");

const PRODUCT_ID = process.env.PRODUCT_ID;

const TOKEN = process.env.TEST_TOKEN;

const BASE_URL =
    "http://localhost:8080";

const REDIS_CONNECTION = {
    host: "127.0.0.1",
    port: 6379
};

const TOTAL_REQUESTS =
    Number(process.env.TOTAL_REQUESTS || 100);

const QUANTITY_PER_REQUEST =
    Number(process.env.QUANTITY_PER_REQUEST || 1);

const POLL_INTERVAL_MS = 100;

const JOB_TIMEOUT_MS =
    120_000;

const RUN_ID =
    crypto.randomUUID();

if (!TOKEN) {
    console.error(
        "TEST_TOKEN is missing."
    );

    console.error(
        'PowerShell: $env:TEST_TOKEN="YOUR_JWT"'
    );

    process.exit(1);
}

const orderQueue = new Queue(
    "order-queue",
    {
        connection: REDIS_CONNECTION
    }
);

function sleep(ms) {
    return new Promise(
        resolve => setTimeout(resolve, ms)
    );
}

function percentile(values, p) {
    if (values.length === 0) {
        return 0;
    }

    const sorted =
        [...values].sort(
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

async function sendOrder(
    requestNumber
) {
    const idempotencyKey =
        `flash-benchmark-${RUN_ID}-${requestNumber}`;

    const start =
        performance.now();

    try {
        const response =
            await fetch(
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
            body =
                JSON.parse(bodyText);
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

async function getJobStatus(
    jobId
) {
    const response =
        await fetch(
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
        body =
            JSON.parse(bodyText);
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
}

async function waitForJob(
    jobId
) {
    const start =
        performance.now();

    while (
        performance.now() - start
        <
        JOB_TIMEOUT_MS
    ) {
        const result =
            await getJobStatus(
                jobId
            );

        const status =
            result.body?.status;

        if (
            status === "COMPLETED" ||
            status === "FAILED"
        ) {
            return result.body;
        }

        await sleep(
            POLL_INTERVAL_MS
        );
    }

    return {
        status: "TIMEOUT"
    };
}

async function collectQueueDepth() {
    const counts =
        await orderQueue.getJobCounts(
            "waiting",
            "active"
        );

    return (
        Number(counts.waiting || 0) +
        Number(counts.active || 0)
    );
}

async function run() {
    console.log(
        "\n=========================================="
    );

    console.log(
        "        FLASH-SALE BENCHMARK"
    );

    console.log(
        "=========================================="
    );

    console.log(
        `Run ID:             ${RUN_ID}`
    );

    console.log(
        `Requests:           ${TOTAL_REQUESTS}`
    );

    console.log(
        `Quantity/request:   ${QUANTITY_PER_REQUEST}`
    );

    console.log(
        "\nSending concurrent requests..."
    );

    const benchmarkStart =
        performance.now();

    let maxQueueDepth = 0;

    let sampling = true;

    const sampler =
        (async () => {
            while (sampling) {
                try {
                    const depth =
                        await collectQueueDepth();

                    maxQueueDepth =
                        Math.max(
                            maxQueueDepth,
                            depth
                        );
                } catch {
                    // Ignore sampling errors.
                }

                await sleep(100);
            }
        })();

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

    /*
        Stop queue sampling later,
        after accepted jobs finish.
    */

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

    const other =
        requestResults.filter(
            result =>
                !accepted.includes(result) &&
                !soldOut.includes(result) &&
                !rateLimited.includes(result)
        );

    /*
        ----------------------------------------
        HTTP LATENCY
        ----------------------------------------
    */

    const httpLatencies =
        requestResults.map(
            result =>
                result.latencyMs
        );

    console.log(
        "\n=========================================="
    );

    console.log(
        "          HTTP / ADMISSION"
    );

    console.log(
        "=========================================="
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
        `Rate limited:       ${rateLimited.length}`
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

    /*
        ----------------------------------------
        JOB COMPLETION
        ----------------------------------------
    */

    console.log(
        "\n=========================================="
    );

    console.log(
        "          BULLMQ WORKER"
    );

    console.log(
        "=========================================="
    );

    console.log(
        `Waiting for ${accepted.length} jobs...`
    );

    const jobResults =
        await Promise.all(
            accepted.map(
                async result => {

                    const finalStatus =
                        await waitForJob(
                            result.body.jobId
                        );

                    return {
                        requestNumber:
                            result.requestNumber,

                        jobId:
                            result.body.jobId,

                        result:
                            finalStatus
                    };
                }
            )
        );

    sampling = false;

    await sampler;

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

    /*
        ----------------------------------------
        GET RAW BULLMQ TIMINGS
        ----------------------------------------
    */

    const timings = [];

    for (
        const completedJob of completed
    ) {
        const job =
            await orderQueue.getJob(
                completedJob.jobId
            );

        if (!job) {
            continue;
        }

        if (
            job.timestamp == null ||
            job.processedOn == null ||
            job.finishedOn == null
        ) {
            continue;
        }

        timings.push({
            jobId:
                job.id,

            queueWaitMs:
                job.processedOn -
                job.timestamp,

            processingMs:
                job.finishedOn -
                job.processedOn,

            totalJobMs:
                job.finishedOn -
                job.timestamp,

            orderId:
                job.returnvalue?.orderId
        });
    }

    const queueWaits =
        timings.map(
            item =>
                item.queueWaitMs
        );

    const processingTimes =
        timings.map(
            item =>
                item.processingMs
        );

    const totalJobTimes =
        timings.map(
            item =>
                item.totalJobMs
        );

    console.log(
        "\n=========================================="
    );

    console.log(
        "          JOB PERFORMANCE"
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

    console.log(
        `Maximum queue depth:${maxQueueDepth}`
    );

    if (queueWaits.length > 0) {
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

    if (processingTimes.length > 0) {
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
    }

    if (totalJobTimes.length > 0) {
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

    const completedJobIds =
        timings
            .map(item => item.jobId);

    if (
        completedJobIds.length > 0
    ) {
        const first =
            timings.reduce(
                (a, b) =>
                    Math.min(
                        a.queueWaitMs +
                        b.totalJobMs,
                        b.totalJobMs
                    )
            );

        console.log(
            `\nWorker completion count: ${completedJobIds.length}`
        );
    }

    /*
        ----------------------------------------
        FINAL SUMMARY
        ----------------------------------------
    */

    const totalElapsed =
        performance.now() -
        benchmarkStart;

    console.log(
        "\n=========================================="
    );

    console.log(
        "              FINAL"
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
        `Jobs completed:       ${completed.length}`
    );

    console.log(
        `Jobs failed:          ${failed.length}`
    );

    console.log(
        `Jobs timed out:       ${timedOut.length}`
    );

    console.log(
        `Maximum queue depth:  ${maxQueueDepth}`
    );

    console.log(
        `Total benchmark time: ${formatMs(
            totalElapsed
        )}`
    );

    if (
        other.length > 0
    ) {
        console.log(
            "\nOther errors:"
        );

        console.table(
            other.slice(0, 10)
        );
    }

    console.log(
        "\n==========================================\n"
    );
}

run()
    .catch(error => {
        console.error(
            "\nBenchmark failed:",
            error
        );

        process.exitCode = 1;
    })
    .finally(async () => {
        await orderQueue.close();
    });