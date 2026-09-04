const { CustomApiError } = require("../error_handlers/CustomApiError");

const errorHandlerMiddleware = (error, req, res, next) => {
    if (error instanceof CustomApiError) {
        res.status(error.status).json({ error: error.message });
    }
    else {
        console.log(error);
        res.status(500).json({ error: "Something went wrong" });
    }
}

module.exports = errorHandlerMiddleware;