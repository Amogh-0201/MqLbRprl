const CustomApiError = require("../error_handlers/CustomApiError");

const errorHandlerMiddleware = (error, req, res, next) => {
    if (error instanceof CustomApiError) {
        return res.status(error.statusCode).json({ error: error.message });
    }
    else if (error.name === "ValidationError") {
        const message = Object.values(error.errors)
            .map((err) => err.message)
            .join(", ");
        return res.status(400).json({ error: message });
    }
    else if (error.name === "CastError" && error.kind === "ObjectId") {
        return res.status(400).json({
            error: `Invalid ID format: ${error.value}. Must be a 24-character hex string.`
        });
    }
    else if (error.code && error.code === 11000) {
        const field = Object.keys(error.keyValue).join(", ");
        return res.status(400).json({
            error: `Duplicate value entered for '${field}'. Please choose another value.`
        });
    }

    console.log(error);
    return res.status(500).json({ error: "Something went wrong" });
}

module.exports = errorHandlerMiddleware;