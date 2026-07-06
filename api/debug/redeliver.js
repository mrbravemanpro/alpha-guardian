// One-off tool: re-run fulfillment for a specific order and re-deliver a
// corrected result. Used to fix orders that were processed by an earlier,
// buggy version of the fulfillment logic (e.g. before reference_urls was
// read correctly).

const atelier = require("../../lib/atelier");
const { scanSkill } = require("../../lib/scanner/engine");

function authorized(req) {
  if (!process.env.CRON_SECRET) return true;
  return req.headers["authorization"] === `Bearer ${process.env.CRON_SECRET}`;
}

function driveViewToDirectDownload(url) {
  const m = url.match(/drive\.google\.com\/file\/d\/([^/]+)/);
  if (!m) return url;
  return `https://drive.google.com/uc?export=download&id=${m[1]}`;
}

module.exports = async (req, res) => {
  if (!authorized(req)) {
    res.status(401).json({ error: "Unauthorized" });
    return;
  }
  if (req.method !== "POST") {
    res.status(405).json({ error: "POST { orderId, sourceUrl, skillName? }" });
    return;
  }

  let body = req.body;
  if (typeof body === "string") {
    try { body = JSON.parse(body); } catch { res.status(400).json({ error: "Invalid JSON" }); return; }
  }
  const { orderId, sourceUrl, skillName } = body || {};
  if (!orderId || !sourceUrl) {
    res.status(400).json({ error: "Require: orderId, sourceUrl" });
    return;
  }

  const creds = await atelier.getCredentials();
  if (!creds) {
    res.status(200).json({ status: "not_registered" });
    return;
  }

  const directUrl = driveViewToDirectDownload(sourceUrl);
  let report;
  try {
    const r = await fetch(directUrl);
    const text = await r.text();
    if (text.includes("Google Drive can't scan this file for viruses") || text.trim().startsWith("<html") || text.trim().startsWith("<!DOCTYPE")) {
      res.status(200).json({
        status: "source_unreadable",
        note: "The link returned an HTML page (Drive interstitial or similar), not raw file content. Ask the client to re-share as a raw-text link, or download it yourself and paste the content directly.",
        fetchedUrlTried: directUrl,
      });
      return;
    }
    report = scanSkill({ skillName: skillName || "resubmitted-skill", content: text, source: sourceUrl });
  } catch (err) {
    res.status(200).json({ status: "fetch_failed", error: err.message, fetchedUrlTried: directUrl });
    return;
  }

  try {
    const upload = await atelier.uploadDeliverable(creds.apiKey, report, "corrected-scan-report.json", "application/json");
    const deliver = await atelier.deliverOrder(creds.apiKey, orderId, { deliverableUrl: upload.url, mediaType: upload.media_type || "text" });
    res.status(200).json({ status: "redelivered", report, upload, deliver });
  } catch (err) {
    res.status(200).json({ status: "deliver_failed", error: err.message, body: err.body || null, report });
  }
};
