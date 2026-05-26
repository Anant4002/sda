const { startCatalogSyncScheduler } = require("../services/catalogSyncScheduler");

async function startSchedulers(isDatabaseEmpty) {
    await startCatalogSyncScheduler(isDatabaseEmpty);
}

module.exports = { startSchedulers };
