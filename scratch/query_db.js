const { sequelize } = require("../backend/src/db");
const { evaluateReentryRisks } = require("../backend/src/services/reentryPredictionService");

async function main() {
    await sequelize.authenticate();
    console.log("Connected to database.");

    const start = Date.now();
    console.log("Running evaluateReentryRisks...");
    const results = await evaluateReentryRisks();
    console.log(`evaluateReentryRisks took ${Date.now() - start}ms. Found results: ${results.length}`);

    await sequelize.close();
}

main().catch(err => {
    console.error(err);
    process.exit(1);
});
