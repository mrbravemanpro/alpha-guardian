const store = require("../lib/store");
const atelier = require("../lib/atelier");

module.exports = async (req, res) => {
  const creds = await atelier.getCredentials();
  res.status(200).json({
    status: "ok",
    service: "alpha-guardian",
    storageConfigured: store.isConfigured(),
    atelierRegistered: !!creds,
    time: new Date().toISOString(),
  });
};
