const Redis = require("ioredis");

const redis = new Redis({
    host: process.env.REDIS_HOST || "redis",
    port: Number(process.env.REDIS_PORT || 6379)
});

async function testRedis() {

    try {
        console.log("Connecting to Redis...");

        const pong = await redis.ping();
        console.log("Redis ping result:", pong);

        await redis.set("mq-lb-rprl:test", "Redis is Working");

        const value = await redis.get("mq-lb-rprl:test");

        console.log("stored value: ", value);

        await redis.del("mq-lb-rprl:test");

        console.log("Redis test successful");

    } catch (err) {
        console.error("Redis test failed:", err);
        process.exitCode = 1;
    } finally {
        await redis.quit();
    }
}

testRedis();