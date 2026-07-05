const store = require("../../lib/store");

module.exports = async (req, res) => {
  const orderId = (req.query && req.query.orderId) || new URL(req.url, "http://x").searchParams.get("orderId");
  if (!orderId) {
    res.status(400).json({ error: "Missing ?orderId=" });
    return;
  }
  const content = await store.get(`deliverable:${orderId}`, null);
  if (!content) {
    res.status(404).json({ error: "No deliverable found for this orderId (expired or never stored)" });
    return;
  }
  res.setHeader("Content-Type", "text/plain; charset=utf-8");
  res.status(200).send(typeof content === "string" ? content : JSON.stringify(content, null, 2));
};
