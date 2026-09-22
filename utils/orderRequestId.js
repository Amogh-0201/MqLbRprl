const crypto = require("crypto");

function createReservationId(userId, idempotencyKey) {
    const hash = crypto
        .createHash("sha256")
        .update(`${userId}:${idempotencyKey}`)
        .digest("hex");

    return `order-${hash}`;
}

module.exports = {
    createReservationId
};