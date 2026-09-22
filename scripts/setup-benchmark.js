const crypto = require("crypto");
const jwt = require("jsonwebtoken");

const connectDb = require("../db/connectDb");

const User = require("../models/user");
const Product = require("../models/product");
const Order = require("../models/order");

const BENCHMARK_ADMIN_EMAIL =
    "benchmark-admin@mqlbrprl.local";

const BENCHMARK_USER_EMAIL =
    "benchmark-user@mqlbrprl.local";

const BENCHMARK_PRODUCT_NAME =
    "Flash Sale Benchmark Product";

const PRODUCT_PRICE = 100;

const STOCK = Number(
    process.argv[2] || process.env.BENCHMARK_STOCK || 10
);

function generatePassword() {
    return crypto
        .randomBytes(18)
        .toString("base64url");
}

function generateToken(user) {
    return jwt.sign(
        {
            userId: user._id,
            role: user.role
        },
        process.env.JWT_SECRET,
        {
            expiresIn: "3d"
        }
    );
}

async function createOrResetUser({
    email,
    name,
    address,
    role
}) {
    let user = await User.findOne({
        email
    });

    const password =
        generatePassword();

    if (!user) {
        user = new User({
            name,
            email,
            password,
            address,
            role
        });

        await user.save();

        console.log(
            `[SETUP] Created ${role}: ${email}`
        );
    } else {
        user.name = name;
        user.address = address;
        user.role = role;

        // pre-save hook will hash the new password
        user.password = password;

        await user.save();

        console.log(
            `[SETUP] Reset existing ${role}: ${email}`
        );
    }

    return {
        user,
        password
    };
}

async function createOrResetProduct(
    adminId
) {
    let product =
        await Product.findOne({
            name:
                BENCHMARK_PRODUCT_NAME
        });

    if (product) {
        /*
            This is a benchmark-only product,
            so remove its old benchmark orders.
        */
        await Order.deleteMany({
            product: product._id
        });

        product.adminId =
            adminId;

        product.price =
            PRODUCT_PRICE;

        product.quantity =
            STOCK;

        product.flashSaleActive =
            false;

        await product.save();

        console.log(
            "[SETUP] Reset benchmark product"
        );
    } else {
        product = await Product.create({
            adminId,
            name:
                BENCHMARK_PRODUCT_NAME,
            price:
                PRODUCT_PRICE,
            quantity:
                STOCK,
            description:
                "Dedicated local benchmark product"
        });

        console.log(
            "[SETUP] Created benchmark product"
        );
    }

    return product;
}

async function main() {
    if (!process.env.MONGO_URI) {
        throw new Error(
            "MONGO_URI is missing"
        );
    }

    if (!process.env.JWT_SECRET) {
        throw new Error(
            "JWT_SECRET is missing"
        );
    }

    if (
        !Number.isInteger(STOCK) ||
        STOCK <= 0
    ) {
        throw new Error(
            "BENCHMARK_STOCK must be a positive integer"
        );
    }

    console.log(
        "\n=========================================="
    );

    console.log(
        "       LOCAL BENCHMARK SETUP"
    );

    console.log(
        "=========================================="
    );

    await connectDb();

    const {
        user: admin,
        password: adminPassword
    } = await createOrResetUser({
        email:
            BENCHMARK_ADMIN_EMAIL,
        name:
            "Benchmark Admin",
        address:
            "Local Benchmark",
        role:
            "admin"
    });

    const {
        user,
        password: userPassword
    } = await createOrResetUser({
        email:
            BENCHMARK_USER_EMAIL,
        name:
            "Benchmark User",
        address:
            "Local Benchmark",
        role:
            "user"
    });

    const product =
        await createOrResetProduct(
            admin._id
        );

    const adminToken =
        generateToken(admin);

    const userToken =
        generateToken(user);

    const savedProduct =
        await Product.findById(
            product._id
        );

    console.log(
        "\n=========================================="
    );

    console.log(
        "          BENCHMARK DATA"
    );

    console.log(
        "=========================================="
    );

    console.log(
        `Admin ID:       ${admin._id}`
    );

    console.log(
        `Admin email:    ${admin.email}`
    );

    console.log(
        `Admin password: ${adminPassword}`
    );

    console.log(
        `User ID:        ${user._id}`
    );

    console.log(
        `User email:     ${user.email}`
    );

    console.log(
        `User password:  ${userPassword}`
    );

    console.log(
        `Product ID:     ${product._id}`
    );

    console.log(
        `Product name:   ${product.name}`
    );

    console.log(
        `Mongo stock:    ${savedProduct.quantity}`
    );

    console.log(
        `Flash sale:     ${savedProduct.flashSaleActive}`
    );

    console.log(
        "\n=========================================="
    );

    console.log(
        "             JWT TOKENS"
    );

    console.log(
        "=========================================="
    );

    console.log(
        "\nADMIN TOKEN:"
    );

    console.log(
        adminToken
    );

    console.log(
        "\nUSER TOKEN:"
    );

    console.log(
        userToken
    );

    console.log(
        "\n=========================================="
    );

    console.log(
        "             ENV VALUES"
    );

    console.log(
        "=========================================="
    );

    console.log(
        `$env:TEST_TOKEN="<USER_TOKEN>"`
    );

    console.log(
        `$env:PRODUCT_ID="${product._id}"`
    );

    console.log(
        "\nSetup completed successfully."
    );

    console.log(
        "==========================================\n"
    );
}

main()
    .catch(error => {
        console.error(
            "\n[SETUP] FAILED:",
            error
        );

        process.exitCode = 1;
    })
    .finally(async () => {
        const mongoose =
            require("mongoose");

        await mongoose.disconnect();
    });