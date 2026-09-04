const { createProduct, getProducts, getProduct, updateProduct, deleteProduct } = require("../services/productService");
const Joi = require("joi");
const BadRequestError = require("../error_handlers/BadRequestError");


const createProductController = async (req, res) => {

    const { name, price, quantity, image, description } = req.body;
    const { userId } = req.user;

    const product = await createProduct(userId, name, price, quantity, image, description);
    res.status(201).json({ msg: "Product created successfully", product });
}


async function getProductsController(req, res) {

    const products = await getProducts();
    res.status(200).json({ count: products.length, products });
}


async function getProductController(req, res) {

    const { productId } = req.params;
    const product = await getProduct(productId);
    res.status(200).json({ product });
}


const updateProductSchema = Joi.object({
    name: Joi.string().min(3).max(100),
    price: Joi.number().greater(0),
    quantity: Joi.number().integer().min(0),
    image: Joi.string().allow("", null),
    description: Joi.string().allow("", null)
})
    .min(1)
    .unknown(false);

async function updateProductController(req, res) {

    const { productId } = req.params;
    const { userId } = req.user;

    const { error, value } = updateProductSchema.validate(req.body, { abortEarly: false });

    if (error) {
        const errorMessage = error.details.map((detail) => detail.message).join(", ");
        throw new BadRequestError(errorMessage);
    }

    const updatedProduct = await updateProduct(productId, userId, value);

    res.status(200).json({ msg: "Product updated successfully", updatedProduct });
}


async function deleteProductController(req, res) {

    const { productId } = req.params;
    const { userId } = req.user;

    await deleteProduct(userId, productId);
    res.status(204).json({ msg: "Product deleted successfully" });
}


module.exports = {
    createProductController,
    getProductsController,
    getProductController,
    updateProductController,
    deleteProductController
}
