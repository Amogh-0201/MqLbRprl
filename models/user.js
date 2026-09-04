const mongoose = require("mongoose");
const bcryptjs = require("bcryptjs");

const UserSchema = new mongoose.Schema({
    name: {
        type: String,
        required: [true, "name is required"],
        minLength: [3, "name must be at least 3 characters long"],
        maxLength: [30, "name must be at most 30 characters long"]
    },
    email: {
        type: String,
        required: [true, "email is required"],
        unique: true
    },
    password: {
        type: String,
        minLength: [6, "password must be at least 6 characters long"],
        required: [true, "password is required"]
    },
    address: {
        type: String,
        required: [true, "address is required"]
    },
    role: {
        type: String,
        enum: ['user', 'admin'],
        default: 'user',
        required: [true, "role is required"]
    }
}, {
    timestamps: true
});

UserSchema.pre('save', async function () {
    const salt = await bcryptjs.genSalt(10);
    this.password = await bcryptjs.hash(this.password, salt);
});

UserSchema.methods.comparePassword = async function (password) {
    const isMatch = await bcryptjs.compare(password, this.password);
    return isMatch;
}

module.exports = mongoose.model('User', UserSchema);