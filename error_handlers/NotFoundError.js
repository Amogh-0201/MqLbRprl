const CustomApiError = require("./CustomApiError");

class NotFoundError extends CustomApiError {
    constructor(message) {
        super(message, 404);
    }
}

module.exports = NotFoundError;
