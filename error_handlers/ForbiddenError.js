const CustomApiError = require("./CustomApiError");

class ForbiddenError extends CustomApiError {
    constructor(message) {
        super(message, 403);
    }
}

module.exports = ForbiddenError;
