const { register, login, showMe } = require("../services/authService");

const registerController = async (req, res) => {
    const { name, email, password, role } = req.body;

    const token = await register(name, email, password, role);
    res.status(201).json({ token });

}

const loginController = async (req, res) => {
    const { email, password } = req.body;

    const token = await login(email, password);
    res.status(200).json({ token });
}

const showMeController = async (req, res) => {
    const { userId } = req.user;

    const user = await showMe(userId);
    res.status(200).json({ user });
}

module.exports = {
    registerController,
    loginController,
    showMeController
}