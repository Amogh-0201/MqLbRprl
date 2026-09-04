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

    console.log(error);
    return res.status(500).json({ msg: error });
}

module.exports = errorHandlerMiddleware;