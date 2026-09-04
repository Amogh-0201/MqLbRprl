require("dotenv").config();
const express = require("express");

//middlewares
const errorHandlerMiddleware = require("./middlewares/errorhandler_middleware");
const notFound = require("./middlewares/not_found");
const connectDb = require("./db/connectDb");

//routes
const authRouter = require("./routes/authRoute");

const app = express();

const port = process.env.PORT || 3000;

app.use(express.json());
app.use("/api/v1/auth", authRouter);

app.use(notFound);
app.use(errorHandlerMiddleware);

async function start() {
    await connectDb();
    app.listen(port, () => {
        console.log(`Server is running on port ${port}`);
    });
}

start();