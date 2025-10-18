const express = require('express');
const router = express.Router();

// Runtime access to global context
function getGlobals() {
  return {
    notion: global.notion,
    log: global.log,
    sendSuccess: global.sendSuccess,
    sendError: global.sendError,
    hyphenateNotionId: global.hyphenateNotionId,
    appendBlocksToBlockId: global.appendBlocksToBlockId
  };
}

// List databases the integration can access (with optional name filter + short cache)
router.get('/databases', async (req, res) => {
  const { notion, sendError, sendSuccess, log } = getGlobals();
  try {
    if (!notion)
      return sendError(
        res,
        "NOTION_CLIENT_UNINITIALIZED",
        "Notion client not initialized",
        null,
        500
      );
    const pageSize = Math.min(
      100,
      parseInt(req.query.page_size || req.query.pageSize || 20, 10) || 20
    );
    const start_cursor =
      req.query.start_cursor || req.query.startCursor || undefined;
    const q = (req.query.q || req.query.qs || req.query.qry || "").trim();

    if (!global._sn2n_db_cache)
      global._sn2n_db_cache = { map: new Map(), ttl: 30 * 1000 };
    const cacheKey = `databases:${q}:${pageSize}`;
    if (!start_cursor) {
      const cached = global._sn2n_db_cache.map.get(cacheKey);
      if (cached && Date.now() - cached.ts < global._sn2n_db_cache.ttl) {
        return sendSuccess(
          res,
          Object.assign({ cached: true }, cached.payload)
        );
      }
    }

    const searchBody = {
      filter: { property: "object", value: "database" },
      page_size: pageSize,
    };
    if (start_cursor) searchBody.start_cursor = start_cursor;
    if (q && q.length > 0) searchBody.query = q;

    const result = await notion.search(searchBody);
    const items = (result.results || []).map((d) => ({
      id: d.id,
      title: Array.isArray(d.title)
        ? d.title.map((t) => t.plain_text).join("")
        : d.title || "",
      properties: d.properties || {},
      url: d.url || null,
    }));

    const payload = {
      results: items,
      next_cursor: result.next_cursor || null,
      has_more: !!result.has_more,
    };
    if (!start_cursor)
      global._sn2n_db_cache.map.set(cacheKey, { ts: Date.now(), payload });
    return sendSuccess(res, payload);
  } catch (err) {
    const { log, sendError } = getGlobals();
    log("/api/databases error:", err && (err.message || err));
    return sendError(res, "SERVER_ERROR", err && err.message, null, 500);
  }
});

// Return typed property schema for a single database (useful for UI forms)
router.get('/databases/:id/schema', async (req, res) => {
  try {
    const { hyphenateNotionId, sendSuccess, sendError, log, notion } = getGlobals();
    if (!notion)
      return res.status(500).json({ error: "Notion client not initialized" });
    const dbId = hyphenateNotionId(req.params.id);
    let dbInfo;
    try {
      dbInfo = await notion.databases.retrieve({ database_id: dbId });
    } catch (e) {
      log("/api/databases/:id/schema retrieve error:", e && (e.message || e));
      return sendError(
        res,
        "FAILED_RETRIEVE_DATABASE",
        "Failed to retrieve database",
        e && e.message,
        500
      );
    }

    const schema = {};
    for (const [name, prop] of Object.entries(dbInfo.properties || {})) {
      const entry = { id: prop.id || null, name, type: prop.type };
      if (prop.type === "select" || prop.type === "multi_select") {
        entry.options =
          prop[prop.type] && prop[prop.type].options
            ? prop[prop.type].options.map((o) => ({
                id: o.id,
                name: o.name,
                color: o.color,
              }))
            : [];
      }
      if (prop.type === "number")
        entry.number = prop.number || { format: "number" };
      if (prop.type === "relation") entry.relation = prop.relation || {};
      if (prop.type === "formula")
        entry.formula = {
          expression: (prop.formula && prop.formula.expression) || null,
        };
      if (prop.type === "rollup") entry.rollup = prop.rollup || {};
      if (prop.type === "people") entry.people = {};
      if (prop.type === "files") entry.files = {};
      schema[name] = entry;
    }

    if (!global._sn2n_db_schema_cache) global._sn2n_db_schema_cache = new Map();
    global._sn2n_db_schema_cache.set(dbId, { ts: Date.now(), schema });
    return sendSuccess(res, {
      id: dbId,
      title: dbInfo.title || null,
      properties: dbInfo.properties || {},
      url: dbInfo.url || null,
      schema,
    });
  } catch (err) {
    const { log, sendError } = getGlobals();
    log("/api/databases/:id/schema error:", err && (err.message || err));
    return sendError(
      res,
      "SERVER_ERROR",
      err && (err.message || err),
      null,
      500
    );
  }
});

// Alias GET /databases/:id -> return basic database info + typed schema
router.get('/databases/:id', async (req, res) => {
  try {
    const { hyphenateNotionId, sendSuccess, sendError, log, notion } = getGlobals();
    if (!notion)
      return sendError(
        res,
        "NOTION_CLIENT_UNINITIALIZED",
        "Notion client not initialized",
        null,
        500
      );
    const dbId = hyphenateNotionId(req.params.id);
    // Try to use cached schema if available
    if (
      global._sn2n_db_schema_cache &&
      global._sn2n_db_schema_cache.has(dbId)
    ) {
      const cached = global._sn2n_db_schema_cache.get(dbId);
      return sendSuccess(res, { id: dbId, schema: cached.schema });
    }

    let dbInfo;
    try {
      dbInfo = await notion.databases.retrieve({ database_id: dbId });
    } catch (e) {
      log("/api/databases/:id retrieve error:", e && (e.message || e));
      return res.status(500).json({
        error: "Failed to retrieve database",
        details: e && e.message,
      });
    }

    const schema = {};
    for (const [name, prop] of Object.entries(dbInfo.properties || {})) {
      const entry = { id: prop.id || null, name, type: prop.type };
      if (prop.type === "select" || prop.type === "multi_select") {
        entry.options =
          prop[prop.type] && prop[prop.type].options
            ? prop[prop.type].options.map((o) => ({
                id: o.id,
                name: o.name,
                color: o.color,
              }))
            : [];
      }
      if (prop.type === "number")
        entry.number = prop.number || { format: "number" };
      if (prop.type === "relation") entry.relation = prop.relation || {};
      if (prop.type === "formula")
        entry.formula = {
          expression: (prop.formula && prop.formula.expression) || null,
        };
      if (prop.type === "rollup") entry.rollup = prop.rollup || {};
      if (prop.type === "people") entry.people = {};
      if (prop.type === "files") entry.files = {};
      schema[name] = entry;
    }

    if (!global._sn2n_db_schema_cache) global._sn2n_db_schema_cache = new Map();
    global._sn2n_db_schema_cache.set(dbId, { ts: Date.now(), schema });

    return sendSuccess(res, {
      id: dbId,
      title: dbInfo.title || null,
      properties: dbInfo.properties || {},
      url: dbInfo.url || null,
      schema,
    });
  } catch (err) {
    const { log, sendError } = getGlobals();
    log("/api/databases/:id error:", err && (err.message || err));
    return sendError(
      res,
      "SERVER_ERROR",
      err && (err.message || err),
      null,
      500
    );
  }
});

// Query a database by id (passthrough to notion.databases.query)
router.post('/databases/:id/query', async (req, res) => {
  try {
    const { hyphenateNotionId, sendSuccess, sendError, log, notion } = getGlobals();
    if (!notion)
      return res.status(500).json({ error: "Notion client not initialized" });
    const dbId = hyphenateNotionId(req.params.id);
    const pageSize = Math.min(
      100,
      parseInt(
        req.body.page_size || req.body.pageSize || req.query.page_size || 20,
        10
      ) || 20
    );
    const start_cursor =
      req.body.start_cursor ||
      req.body.startCursor ||
      req.query.start_cursor ||
      undefined;

    const body = Object.assign({}, req.body || {});
    // protect and normalize
    body.database_id = dbId;
    if (!body.page_size) body.page_size = pageSize;
    if (start_cursor) body.start_cursor = start_cursor;

    const result = await notion.databases.query(body);
    res.json({
      success: true,
      results: result.results || [],
      next_cursor: result.next_cursor || null,
      has_more: !!result.has_more,
    });
  } catch (err) {
    const { log, sendError } = getGlobals();
    log("/api/databases/:id/query error:", err && (err.message || err));
    // surface Notion error body if present
    if (err && err.body)
      return sendError(
        res,
        "NOTION_ERROR",
        err.message || "Notion error",
        err.body || null,
        500
      );
    return sendError(res, "SERVER_ERROR", err && err.message, null, 500);
  }
});

// Public endpoint to append blocks to an existing block id. Useful for multi-request orchestration.
router.post('/blocks/append', async (req, res) => {
  const { notion, log, sendSuccess, sendError, appendBlocksToBlockId } = getGlobals();
  try {
    if (!notion)
      return sendError(
        res,
        "NOTION_CLIENT_UNINITIALIZED",
        "Notion client not initialized",
        null,
        500
      );
    const { blockId, children } = req.body || {};
    if (!blockId)
      return sendError(
        res,
        "MISSING_BLOCK_ID",
        "Missing blockId in request body",
        null,
        400
      );
    if (!Array.isArray(children) || children.length === 0)
      return sendError(
        res,
        "NO_CHILDREN",
        "Missing children blocks array",
        null,
        400
      );

    // Basic validation instead of sanitizeBlocks for now
    const safeChildren = children.filter(child => 
      child && typeof child === 'object' && typeof child.type === 'string'
    );

    const result = await appendBlocksToBlockId(blockId, safeChildren, {
      maxPerRequest: 100,
      maxAttempts: 3,
    });
    return sendSuccess(res, { appended: result.appended });
  } catch (err) {
    log("❌ /api/blocks/append error:", err && err.message);
    return sendError(res, "APPEND_FAILED", err && err.message, null, 500);
  }
});

module.exports = router;