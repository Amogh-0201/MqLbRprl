require("dotenv").config();

const connectDb = require("../db/connectDb");
const mongoose = require("mongoose");

const {
    startFlashSale
} = require("../services/flashSaleService");

async function main() {
    const productId = process.argv[2];

    if (!productId) {
        throw new Error(
            "Usage: node scripts/start-flash-sale.js <productId>"
        );
    }

    await connectDb();

    const result =
        await startFlashSale(productId);

    console.log("\nFLASH SALE STARTED");
    console.table(result);
}

main()
    .catch(error => {
        console.error("Failed:", error.message);
        process.exitCode = 1;
    })
    .finally(async () => {
        await mongoose.disconnect();
    });