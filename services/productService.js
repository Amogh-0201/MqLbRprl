const Product = require("../models/product");
const User = require("../models/user");
const Order = require("../models/order");
const BadRequestError = require("../error_handlers/BadRequestError");
const UnAuthenticatedError = require("../error_handlers/UnAuthenticatedError");
const ForbiddenError = require("../error_handlers/ForbiddenError");
const NotFoundError = require("../error_handlers/NotFoundError");

async function createProduct(userId, name, price, quantity, image, description) {

    if (!userId || !name || price == null || quantity == null) {
        throw new BadRequestError("Please provide all required fields");
    }

    if (typeof price !== "number" || price <= 0) {
        throw new BadRequestError("Price must be greater than 0");
    }

    if (!Number.isInteger(quantity) || quantity < 0) {
        throw new BadRequestError("Quantity must be a non-negative integer");
    }

    const user = await User.findById(userId);
    if (!user) {
        throw new UnAuthenticatedError("User does not exist");
    }

    if (user.role !== "admin") {
        throw new ForbiddenError("Only admin can create products");
    }

    const product = await Product.create({
        adminId: userId,
        name,
        price,
        quantity,
        image,
        description
    });

    return product;
}


async function getProducts() {

    const products = await Product.find({});
    return products;
}


async function getProduct(productId) {

    const product = await Product.findById(productId);
    if (!product) {
        throw new NotFoundError("Product with the given product id does not exist");
    }
    return product;
}


async function updateProduct(productId, userId, updateData) {

    const product = await Product.findById(productId);
    if (!product) {
        throw new NotFoundError("Product with the given product id does not exist");
    }

    if (userId !== product.adminId.toString()) {
        throw new ForbiddenError("Only the admin who created the product can update it");
    }

    if (updateData.price !== undefined) {
        if (typeof updateData.price !== "number" || updateData.price <= 0) {
            throw new BadRequestError("Price must be greater than 0");
        }
    }

    if (updateData.quantity !== undefined) {
        if (!Number.isInteger(updateData.quantity) || updateData.quantity < 0) {
            throw new BadRequestError("Quantity must be a non-negative integer");
        }
    }

    if (
        updateData.quantity !== undefined &&
        product.flashSaleActive
    ) {
        throw new BadRequestError(
            "Cannot change product stock while flash sale is active"
        );
    }

    const fieldsToUpdate = {};
    for (const key in updateData) {
        if (updateData[key] !== undefined) {
            fieldsToUpdate[key] = updateData[key];
        }
    }

    const updatedProduct = await Product.findByIdAndUpdate(
        productId,
        { $set: fieldsToUpdate },
        { returnDocument: 'after', runValidators: true }
    );

    return updatedProduct;
}


async function deleteProduct(userId, productId) {

    const product = await Product.findById(productId);
    if (!product) {
        throw new NotFoundError("Product with the given product id does not exist");
    }

    if (userId !== product.adminId.toString()) {
        throw new ForbiddenError("Only the admin who created the product can delete it");
    }

    if (product.flashSaleActive) {
        throw new BadRequestError(
            "Cannot delete product while flash sale is active"
        );
    }

    const activeOrder = await Order.findOne({
        product: productId,
        orderStatus: { $in: ["pending", "packed", "in transit"] }
    });
    if (activeOrder) {
        throw new BadRequestError("Cannot delete product with active orders in progress");
    }

    const deletedProduct = await Product.findByIdAndDelete(productId);
    return deletedProduct;
}


module.exports = {
    createProduct,
    getProducts,
    getProduct,
    updateProduct,
    deleteProduct
}