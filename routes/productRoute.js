const express = require("express");
const {
    createProductController,
    getProductsController,
    getProductController,
    updateProductController,
    deleteProductController
} = require("../controllers/productController");
const authMiddleware = require("../middlewares/authentication");


const router = express.Router();

router.post("/", authMiddleware, createProductController);
router.get("/", getProductsController);
router.get("/:productId", getProductController);
router.patch("/:productId", authMiddleware, updateProductController);
router.delete("/:productId", authMiddleware, deleteProductController);

module.exports = router;