const express = require("express");
const { registerController, loginController, showMeController } = require("../controllers/authController");
const authenticateUser = require("../middlewares/authentication");

const router = express.Router();

router.route("/register").post(registerController);
router.route("/login").post(loginController);
router.route("/me").get(authenticateUser, showMeController);

module.exports = router;