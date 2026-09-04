const jwt = require("jsonwebtoken");
const UnAuthenticatedError = require("../error_handlers/UnAuthenticatedError");

const authenticateUser = async (req, res, next) => {

    const authHeader = req.headers.authorization;

    if (!authHeader || !authHeader.startsWith("Bearer ")) {
        throw new UnAuthenticatedError("No token provided")
    }

    const token = authHeader.split(" ")[1];

    try {
        const decodedToken = jwt.verify(token, process.env.JWT_SECRET);
        req.user = {
            userId: decodedToken.userId,
            role: decodedToken.role
        };
        next();
    } catch (error) {
        throw new UnAuthenticatedError("Not authorized to access this route")
    }
}

module.exports = authenticateUser;