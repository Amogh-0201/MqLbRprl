const Product = require("../models/product");
const BadRequestError = require("../error_handlers/BadRequestError");
const NotFoundError = require("../error_handlers/NotFoundError");

const {
    initializeFlashSale,
    deactivateFlashSale,
    getAvailableStock
} = require("./inventoryService");

const orderQueue = require("../queues/orderQueue");

async function startFlashSale(productId) {

    const product = await Product.findById(productId);

    if (!product) {
        throw new NotFoundError("Product not found");
    }

    if (product.flashSaleActive) {
        throw new BadRequestError(
            "Flash sale is already active"
        );
    }

    if (product.quantity <= 0) {
        throw new BadRequestError(
            "Cannot start flash sale with zero stock"
        );
    }

    await initializeFlashSale(
        productId,
        product.quantity
    );

    try {
        await Product.findByIdAndUpdate(
            productId,
            {
                $set: {
                    flashSaleActive: true
                }
            }
        );
    } catch (error) {
        await deactivateFlashSale(productId);
        throw error;
    }

    return {
        productId,
        stock: product.quantity,
        flashSaleActive: true
    };
}

async function endFlashSale(productId) {
    const product = await Product.findById(productId);

    if (!product) {
        throw new NotFoundError("Product not found");
    }

    if (!product.flashSaleActive) {
        throw new BadRequestError(
            "Flash sale is not active"
        );
    }

    /*
        Don't end the sale while there are
        still order jobs being processed.
    */
    const jobs = await orderQueue.getJobs([
        "waiting",
        "active",
        "delayed"
    ]);

    const pendingProductJobs = jobs.filter(
        job =>
            job.data &&
            job.data.productId === productId
    );

    if (pendingProductJobs.length > 0) {
        throw new BadRequestError(
            `Cannot end flash sale. ${pendingProductJobs.length} order jobs are still pending.`
        );
    }

    const redisStock =
        await getAvailableStock(productId);

    if (redisStock === null) {
        throw new BadRequestError(
            "Redis flash-sale inventory does not exist"
        );
    }

    /*
        MongoDB and Redis should match once all
        flash-sale work has been persisted.
    */
    if (redisStock !== product.quantity) {
        throw new BadRequestError(
            `Inventory mismatch. MongoDB=${product.quantity}, Redis=${redisStock}`
        );
    }

    /*
        Set MongoDB inactive first so the product
        returns to the normal-order mode.
    */
    await Product.findByIdAndUpdate(
        productId,
        {
            $set: {
                flashSaleActive: false
            }
        }
    );

    await deactivateFlashSale(productId);

    return {
        productId,
        remainingStock: redisStock,
        flashSaleActive: false
    };
}

module.exports = {
    startFlashSale,
    endFlashSale
};