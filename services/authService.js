const User = require("../models/user");
const BadRequestError = require("../error_handlers/BadRequestError");
const UnAuthenticatedError = require("../error_handlers/UnAuthenticatedError");
const jwt = require("jsonwebtoken");

async function register(name, email, password, address, role) {

    if (!name || !email || !password || !address) {
        throw new BadRequestError("Please provide all the details");
    }

    const userAlreadyExists = await User.findOne({ email: email });
    if (userAlreadyExists) {
        throw new BadRequestError("User already exists");
    }

    const user = await User.create({ name, email, password, address, role });

    const token = jwt.sign({ userId: user._id, role: user.role }, process.env.JWT_SECRET, { expiresIn: '3d' });

    return token;
}

async function login(email, password) {

    if (!email || !password) {
        throw new BadRequestError("Please provide all credentials");
    }

    const user = await User.findOne({ email: email });
    if (!user) {
        throw new UnAuthenticatedError("Invalid Credentials");
    }

    const isPasswordCorrect = await user.comparePassword(password);
    if (!isPasswordCorrect) {
        throw new UnAuthenticatedError("Invalid Credentials");
    }

    const token = jwt.sign({ userId: user._id, role: user.role }, process.env.JWT_SECRET, { expiresIn: '3d' });

    return token;
}

async function showMe(userId) {
    if (!userId) {
        throw new BadRequestError("No UserId Found");
    }

    const user = await User.findOne({ _id: userId });

    if (!user) {
        throw new UnAuthenticatedError("Invalid userId");
    }

    return user;
}

module.exports = {
    register,
    login,
    showMe
}