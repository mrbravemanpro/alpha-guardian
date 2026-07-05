const { Redis } = require("@upstash/redis");

let client = null;
function isConfigured() {
  return !!(process.env.UPSTASH_REDIS_REST_URL && process.env.UPSTASH_REDIS_REST_TOKEN);
}
function getClient() {
  if (!isConfigured()) return null;
  if (!client) {
    client = new Redis({
      url: process.env.UPSTASH_REDIS_REST_URL,
      token: process.env.UPSTASH_REDIS_REST_TOKEN,
    });
  }
  return client;
}

async function get(key, fallback = null) {
  const c = getClient();
  if (!c) return fallback;
  try {
    const val = await c.get(key);
    return val ?? fallback;
  } catch (err) {
    console.error(`[store] get(${key}) failed:`, err.message);
    return fallback;
  }
}

async function set(key, value, opts = {}) {
  const c = getClient();
  if (!c) return null;
  try {
    if (opts.exSeconds) {
      return await c.set(key, value, { ex: opts.exSeconds });
    }
    return await c.set(key, value);
  } catch (err) {
    console.error(`[store] set(${key}) failed:`, err.message);
    return null;
  }
}

async function listByPrefix(prefix) {
  const c = getClient();
  if (!c) return [];
  try {
    const keys = [];
    let cursor = 0;
    do {
      const [nextCursor, batch] = await c.scan(cursor, { match: `${prefix}*`, count: 100 });
      keys.push(...batch);
      cursor = Number(nextCursor);
    } while (cursor !== 0);
    return keys;
  } catch (err) {
    console.error(`[store] listByPrefix(${prefix}) failed:`, err.message);
    return [];
  }
}

async function del(key) {
  const c = getClient();
  if (!c) return null;
  try {
    return await c.del(key);
  } catch (err) {
    console.error(`[store] del(${key}) failed:`, err.message);
    return null;
  }
}

module.exports = { get, set, del, listByPrefix, isConfigured };
