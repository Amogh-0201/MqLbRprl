const Redis = require("ioredis");
const redisConnection = require("../config/redis");

const redis = new Redis(redisConnection);

const COMPLETED_RESERVATION_TTL = 24 * 60 * 60; // 24 hours

const reserveStockScript = `
    local existingReservation = redis.call("GET", KEYS[2])

    if existingReservation then
        return {2, existingReservation}
    end

    local stock = tonumber(redis.call("GET", KEYS[1]))
    local requested = tonumber(ARGV[1])

    if not stock then
        return {-1, ""}
    end

    if stock < requested then
        return {0, ""}
    end

    redis.call(
        "DECRBY",
        KEYS[1],
        requested
    )

    redis.call(
        "SET",
        KEYS[2],
        ARGV[2]
    )

    return {1, ARGV[2]}
`;

const releaseReservationScript = `
    local raw = redis.call("GET", KEYS[2])

    if not raw then
        return 0
    end

    local reservation = cjson.decode(raw)

    if reservation.status ~= "RESERVED" then
        return 0
    end

    if reservation.reservationId ~= ARGV[2] then
        return 0
    end

    redis.call(
        "INCRBY",
        KEYS[1],
        ARGV[1]
    )

    redis.call(
        "DEL",
        KEYS[2]
    )

    return 1
`;

const completeReservationScript = `
    local raw = redis.call("GET", KEYS[1])

    if not raw then
        return 0
    end

    local reservation = cjson.decode(raw)

    if reservation.status ~= "RESERVED" then
        return 0
    end

    if reservation.reservationId ~= ARGV[2] then
        return 0
    end

    reservation.status = "COMPLETED"
    reservation.orderId = ARGV[1]

    redis.call(
        "SET",
        KEYS[1],
        cjson.encode(reservation),
        "EX",
        ARGV[3]
    )

    return 1
`;

async function isFlashSaleActive(productId) {
    const activeKey = `flash-sale:active:${productId}`;

    const value = await redis.get(activeKey);

    return value === "1";
}

async function reserveStock({
    productId,
    quantity,
    reservationId,
    userId,
    idempotencyKey
}) {
    const stockKey =
        `flash-sale:stock:${productId}`;

    const reservationKey =
        `flash-sale:reservation:${reservationId}`;

    const reservationRecord = JSON.stringify({
        status: "RESERVED",
        reservationId,
        userId,
        productId,
        quantity,
        idempotencyKey
    });

    const result = await redis.eval(
        reserveStockScript,
        2,
        stockKey,
        reservationKey,
        quantity,
        reservationRecord
    );

    const status = Number(result[0]);

    let record = null;

    if (result[1]) {
        record = JSON.parse(result[1]);
    }

    return {
        status,
        record
    };
}

async function completeReservation({
    reservationId,
    orderId
}) {
    const reservationKey =
        `flash-sale:reservation:${reservationId}`;

    return await redis.eval(
        completeReservationScript,
        1,
        reservationKey,
        orderId,
        reservationId,
        COMPLETED_RESERVATION_TTL
    );
}

async function releaseReservation({
    productId,
    quantity,
    reservationId
}) {
    const stockKey =
        `flash-sale:stock:${productId}`;

    const reservationKey =
        `flash-sale:reservation:${reservationId}`;

    return await redis.eval(
        releaseReservationScript,
        2,
        stockKey,
        reservationKey,
        quantity,
        reservationId
    );
}

async function getReservation(reservationId) {
    const reservationKey =
        `flash-sale:reservation:${reservationId}`;

    const value = await redis.get(reservationKey);

    if (!value) {
        return null;
    }

    return JSON.parse(value);
}

async function getAvailableStock(productId) {
    const stockKey =
        `flash-sale:stock:${productId}`;

    const stock = await redis.get(stockKey);

    return stock === null
        ? null
        : Number(stock);
}

async function initializeFlashSale(
    productId,
    quantity
) {
    const stockKey =
        `flash-sale:stock:${productId}`;

    const activeKey =
        `flash-sale:active:${productId}`;

    await redis.multi()
        .set(stockKey, quantity)
        .set(activeKey, "1")
        .exec();
}

async function deactivateFlashSale(productId) {
    const stockKey =
        `flash-sale:stock:${productId}`;

    const activeKey =
        `flash-sale:active:${productId}`;

    await redis.multi()
        .del(activeKey)
        .del(stockKey)
        .exec();
}

module.exports = {
    isFlashSaleActive,
    reserveStock,
    completeReservation,
    releaseReservation,
    getReservation,
    getAvailableStock,
    initializeFlashSale,
    deactivateFlashSale
};