const Product = require("../models/product");
const User = require("../models/user");
const BadRequestError = require("../error_handlers/BadRequestError");
const UnAuthenticatedError = require("../error_handlers/UnAuthenticatedError");

async function createProduct(userId, name, price, quantity, image, description) {

    if (!userId || !name || !price || !quantity) {
        throw new BadRequestError("Please Provide all required fields");
    }

    if (price <= 0) {
        throw new BadRequestError("Price must be greater than 0");
    }

    if (quantity < 0) {
        throw new BadRequestError("Quantity can't be negative");
    }

    const user = await User.findOne({ _id: userId });
    if (!user) {
        throw new UnAuthenticatedError("User does not exist")
    }

    if (user.role !== "admin") {
        throw new UnAuthenticatedError("Only admin can create products")
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
        throw new BadRequestError("Product with the given product id does not exist");
    }
    return product;
}


async function updateProduct(productId, userId, updateData) {

    const product = await Product.findOne({ _id: productId });
    if (!product) {
        throw new BadRequestError("Product with the given product id does not exist");
    }

    if (userId !== product.adminId.toString()) {
        throw new UnAuthenticatedError("Only the admin who created the product can update it");
    }

    if (updateData.price !== undefined) {
        if (updateData.price <= 0) {
            throw new BadRequestError("Price must be greater than 0");
        }
    }

    if (updateData.quantity !== undefined) {
        if (updateData.quantity < 0) {
            throw new BadRequestError("Quantity can't be negative");
        }
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

    const product = await Product.findOne({ _id: productId });
    if (!product) {
        throw new BadRequestError("Product with the given product id does not exist");
    }

    if (userId !== product.adminId.toString()) {
        throw new UnAuthenticatedError("Only the admin who created the product can delete it");
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