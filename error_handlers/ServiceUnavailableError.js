const CustomApiError = require("./CustomApiError");

class ServiceUnavailableError extends CustomApiError {
    constructor(message) {
        super(message, 503);
    }
}

module.exports = ServiceUnavailableError;