class BadRequestError extends CustomApiError {
    constructor(message) {
        super(message, 400);
    }
}

module.exports = BadRequestError;