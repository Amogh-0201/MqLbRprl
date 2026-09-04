class UnAuthenticatedError extends CustomApiError {
    constructor(message) {
        super(message, 401);
    }
}

module.exports = UnAuthenticatedError;