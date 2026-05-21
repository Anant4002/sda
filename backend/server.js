const { startServer } = require("./src/server");

startServer().catch((error) => {
    console.error("Database connection error:", error);
    process.exit(1);
});
