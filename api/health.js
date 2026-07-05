const store = require("../lib/store");

module.exports = async (req, res) => {
  res.status(200).json({
    status: "ok",
    service: "alpha-guardian",
    storageConfigured: store.isConfigured(),
    atelierRegistered: !!(await store.get("atelier:credentials", null)),
    time: new Date().toISOString(),
  });
};
