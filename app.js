require("dotenv").config();
const express = require("express");
const errorHandlerMiddleware = require("./middlewares/errorhandler_middleware");
const notFound = require("./middlewares/not_found");
const connectDb = require("./db/connectDb");

const app = express();

const port = process.env.PORT || 3000;

app.use(express.json());

app.get("/", (req, res) => {
    res.send("Hello World!");
});

app.use(notFound);
app.use(errorHandlerMiddleware);

async function start() {
    await connectDb();
    app.listen(port, () => {
        console.log(`Server is running on port ${port}`);
    });
}

start();