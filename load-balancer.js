/*
    JUST FOR LEARNING, NOW WE ARE NOT USING THIS BUT USING NGINX LOAD BALANCER LIKE INDUSTRY.
*/
const http = require("node:http");

const LB_PORT = process.env.LB_PORT || 4000;

const HEALTH_CHECK_INTERVAL = 5000;
const HEALTH_CHECK_TIMEOUT = 1500;
const REQUEST_TIMEOUT = 5000;

// Backend Replicas
const serverReplicas = [
    {
        id: "server-1",
        host: "127.0.0.1",
        port: 3001,
        healthy: false
    },
    {
        id: "server-2",
        host: "127.0.0.1",
        port: 3002,
        healthy: false
    },
    {
        id: "server-3",
        host: "127.0.0.1",
        port: 3003,
        healthy: false
    }
];

//health check
function updateHealth(replica, healthy) {
    if (replica.healthy !== healthy) {
        replica.healthy = healthy;
        console.log(`[HEALTH] ${replica.id} -> ${healthy ? 'UP' : 'DOWN'}`);
    }
}

function checkHealth(replica) {
    const request = http.get(
        {
            hostname: replica.host,
            port: replica.port,
            path: "/health",
            timeout: HEALTH_CHECK_TIMEOUT
        },
        (response) => {
            response.resume();
            updateHealth(replica, response.statusCode === 200);
        }
    );

    request.on("timeout", () => {
        request.destroy();
    });

    request.on("error", () => {
        updateHealth(replica, false);
    });
}

function checkAllReplicas() {
    for (const replica of serverReplicas) {
        checkHealth(replica);
    }
}

// initial health check
checkAllReplicas();

// continue health checks after every 5 seconds
setInterval(
    checkAllReplicas,
    HEALTH_CHECK_INTERVAL
);


// Round Robin selection of servers
let nextIndex = 0;

function getNextHealthyReplica() {
    for (let i = 0; i < serverReplicas.length; i++) {
        const index = (nextIndex + i) % serverReplicas.length;

        const replica = serverReplicas[index];

        if (replica.healthy) {
            nextIndex = (index + 1) % serverReplicas.length;
            return replica;
        }
    }

    return null;
}


// Load Balancer Server
const server = http.createServer((req, res) => {

    // load balancer own health end point
    if (req.method === "GET" && req.url === "/lb/health") {

        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(
            JSON.stringify({
                status: "ok",
                serverReplicas: serverReplicas.map((replica) => ({
                    id: replica.id,
                    host: replica.host,
                    port: replica.port,
                    healthy: replica.healthy
                }))
            })
        )
        return;
    }

    // choose server instance
    const replica = getNextHealthyReplica();

    if (!replica) {
        res.writeHead(503, {
            "Content-Type": "application/json"
        });

        res.end(
            JSON.stringify({
                error: "No healthy backend replicas available"
            })
        );

        return;
    }

    console.log(`[LB] ${req.method} ${req.url} -> ${replica.id}`);

    // forward the request
    const forwardedFor = req.headers["x-forwarded-for"]
        ? `${req.headers["x-forwarded-for"]}, ${req.socket.remoteAddress}`
        : req.socket.remoteAddress;

    const proxyRequest = http.request(
        {
            hostname: replica.host,
            port: replica.port,
            path: req.url,
            method: req.method,
            headers: {
                ...req.headers,
                host: `${replica.host}:${replica.port}`,
                "x-forwarded-for": forwardedFor,
                "x-load-balancer": "mq-lb-rprl"
            },
            timeout: REQUEST_TIMEOUT
        },
        (proxyResponse) => {
            res.writeHead(
                proxyResponse.statusCode,
                proxyResponse.headers
            );
            proxyResponse.pipe(res);
        }
    );

    // backend failed
    proxyRequest.on("error", (error) => {
        console.error(
            `[LB] ${replica.id} failed:`,
            error.message
        );

        // change the server instance state and remove it from rotation
        replica.healthy = false;

        if (!res.headersSent) {
            res.writeHead(502, { "Content-Type": "application/json" });

            res.end(
                JSON.stringify({
                    error: "Backend server unavailable",
                    backend: replica.id
                })
            );
        } else {
            res.destroy();
        }
    });

    // backend timeout
    proxyRequest.on("timeout", () => {
        proxyRequest.destroy(
            new Error("Backend request timeout")
        );
    });

    req.pipe(proxyRequest);
});


server.listen(LB_PORT, () => {

    console.log(
        `Load balancer running on http://localhost:${LB_PORT}`
    );

    console.log(
        "Backends:"
    );

    for (const replica of serverReplicas) {
        console.log(
            `  ${replica.id} -> http://${replica.host}:${replica.port}`
        );
    }
});