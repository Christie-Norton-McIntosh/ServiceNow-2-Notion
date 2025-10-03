#!/usr/bin/env node
// Lightweight SN2N proxy for local development and simple deployments
// - CORS is configured to echo the request origin and allow credentials
// - Provides minimal endpoints: /health, /ping, /api/status, /api/W2N (echo)

const express = require("express");
const cors = require("cors");
const dotenv = require("dotenv");
const fs = require("fs");
const path = require("path");
const axios = require("axios");
const FormData = require("form-data");

// Optional Notion SDK - used where available for other operations
let { Client: NotionClient } = {};
try {
  NotionClient = require("@notionhq/client").Client;
} catch (e) {
  // Notion SDK not installed - we'll use direct HTTP uploads when needed
  NotionClient = null;
}

dotenv.config();

const PORT = process.env.PORT || 3004;

const app = express();

// Allow CORS but reflect origin to support credentials (better than wildcard when requests include credentials)
app.use(
  cors({
    origin: (origin, callback) => {
      if (!origin) return callback(null, true);
      return callback(null, true);
    },
    credentials: true,
    exposedHeaders: ["Content-Type"],
  })
);

app.use(express.json({ limit: "50mb" }));
app.use(express.urlencoded({ extended: true, limit: "50mb" }));

// Development-friendly CORS fallback: ensure preflight and simple fetches
// work even when the userscript runs without GM_xmlhttpRequest (browser fetch).
// This echoes the Origin header and allows common headers/methods for dev.
app.use((req, res, next) => {
  const origin = req.headers.origin || req.headers.Origin;
  if (origin) {
    // Echo the origin to avoid wildcard+credentials conflicts
    res.setHeader("Access-Control-Allow-Origin", origin);
  } else {
    res.setHeader("Access-Control-Allow-Origin", "*");
  }
  res.setHeader("Access-Control-Allow-Credentials", "true");
  res.setHeader(
    "Access-Control-Allow-Headers",
    "Content-Type, Authorization, X-Requested-With"
  );
  res.setHeader("Access-Control-Allow-Methods", "GET,POST,PUT,DELETE,OPTIONS");
  if (req.method === "OPTIONS") return res.sendStatus(204);
  next();
});

// Basic logger (guarded). Enable verbose logs with SN2N_VERBOSE=1 or SN2N_REF_DEBUG env var.
const _REF_DEBUG = !!(
  process.env.SN2N_VERBOSE === "1" || process.env.SN2N_REF_DEBUG
);
function log(...args) {
  if (!_REF_DEBUG) return;
  try {
    console.log(new Date().toISOString(), "[SN2N]", ...args);
  } catch (e) {}
}

// Create logs directory if needed (silent failure ok)
try {
  const logsDir = path.join(__dirname, "logs");
  if (!fs.existsSync(logsDir)) fs.mkdirSync(logsDir);
} catch (e) {
  /* ignore */
}

// Helper: normalize simple notion id (hyphenate 32 char hex)
function hyphenateNotionId(id) {
  if (!id || typeof id !== "string") return id;
  const clean = id.replace(/[^a-f0-9]/gi, "");
  if (clean.length !== 32) return id;
  return clean.replace(/^(.{8})(.{4})(.{4})(.{4})(.{12})$/, "$1-$2-$3-$4-$5");
}

// normalizeUrl and isValidImageUrl are useful server-side helpers
function normalizeUrl(url, baseUrl = null) {
  if (!url || typeof url !== "string") return url;
  const decodedUrl = url
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'");

  if (decodedUrl.startsWith("#")) return decodedUrl;
  if (decodedUrl.startsWith("/")) {
    if (baseUrl) {
      try {
        const base = new URL(baseUrl);
        return new URL(decodedUrl, base).href;
      } catch (e) {
        return decodedUrl;
      }
    }
    return decodedUrl;
  }
  try {
    const u = new URL(decodedUrl);
    // normalize path
    const segments = u.pathname.split("/").filter(Boolean);
    const resolved = [];
    for (const s of segments) {
      if (s === "..") resolved.pop();
      else if (s !== ".") resolved.push(s);
    }
    u.pathname = "/" + resolved.join("/");
    return u.href;
  } catch (e) {
    return decodedUrl;
  }
}

function isValidImageUrl(url) {
  if (!url || typeof url !== "string") return false;
  const normalized = normalizeUrl(url);
  if (normalized.startsWith("#")) return false;
  if (
    normalized.startsWith("../") ||
    normalized.startsWith("./") ||
    normalized.startsWith("/")
  )
    return false;
  try {
    const u = new URL(normalized);
    if (!["http:", "https:"].includes(u.protocol)) return false;
    const hasExt = /\.(jpg|jpeg|png|gif|webp|bmp|svg)$/i.test(u.pathname);
    const hasQuery = u.search.length > 0;
    if (u.hostname.includes("servicenow") && !hasExt && hasQuery) return false;
    if (!hasExt && hasQuery && u.search.length > 20) return false;
    const isDoc = /\/(docs?|documentation|bundle|page|help|guide)/i.test(
      u.pathname
    );
    if (isDoc && !hasExt) return false;
    return true;
  } catch (e) {
    return false;
  }
}

// Initialize Notion client if token present
let notion = null;
if (process.env.NOTION_TOKEN) {
  try {
    if (NotionClient)
      notion = new NotionClient({ auth: process.env.NOTION_TOKEN });
    else notion = null;
    log("Notion token configured: true");
  } catch (e) {
    notion = null;
    log("Notion client init failed:", e.message);
  }
} else {
  log("Notion token not configured (NOTION_TOKEN missing)");
}

function ensureFileUploadAvailable() {
  // Prefer direct HTTP flow which doesn't require SDK fileUploads
  if (process.env.NOTION_TOKEN && process.env.NOTION_TOKEN.length > 10)
    return true;
  return false;
}

// Response helpers
function sendSuccess(res, data = {}, meta = {}) {
  return res.json({ success: true, data: data, meta: meta });
}

function sendError(res, errorCode, message, details = null, statusCode = 500) {
  res.status(statusCode).json({
    success: false,
    error: errorCode || "ERROR",
    message: message || "An error occurred",
    details: details || null,
  });
}

// Download an image and upload to Notion via the direct file_uploads HTTP flow
async function downloadAndUploadImage(imageUrl, alt = "image") {
  try {
    log(`⬇️ Downloading image: ${String(imageUrl).substring(0, 120)}`);
    const response = await axios.get(imageUrl, {
      responseType: "arraybuffer",
      timeout: 30000,
      headers: { "User-Agent": "SN2N-Proxy/1.0" },
    });

    const buffer = Buffer.from(response.data);
    const contentType = response.headers["content-type"] || "image/png";
    const ext = contentType.split("/").pop().split(";")[0] || "png";
    const filename = `${(alt || "image")
      .replace(/[^a-zA-Z0-9]/g, "_")
      .substring(0, 20)}.${ext}`;

    const uploadId = await uploadBufferToNotion(buffer, filename, contentType);
    return uploadId;
  } catch (err) {
    log("downloadAndUploadImage failed:", err.message || err);
    return null;
  }
}

async function uploadBufferToNotion(
  buffer,
  filename,
  contentType = "image/png"
) {
  if (!ensureFileUploadAvailable()) {
    log("File upload not available: NOTION_TOKEN missing");
    return null;
  }

  try {
    log(`📤 Creating file upload object for ${filename}`);
    const createRes = await axios.post(
      "https://api.notion.com/v1/file_uploads",
      { mode: "single_part", filename, content_type: contentType },
      {
        headers: {
          Authorization: `Bearer ${process.env.NOTION_TOKEN}`,
          "Content-Type": "application/json",
          "Notion-Version": process.env.NOTION_VERSION || "2022-06-28",
        },
        timeout: 20000,
      }
    );

    const fileUploadId =
      createRes.data && (createRes.data.id || createRes.data.file_upload_id);
    const uploadUrl = createRes.data && createRes.data.upload_url;

    if (!uploadUrl) {
      log("No upload_url returned from Notion file_uploads create");
      return null;
    }

    log(`📤 Uploading file bytes to Notion upload URL (truncated)...`);
    const form = new FormData();
    form.append("file", buffer, { filename, contentType });

    const uploadRes = await axios.post(uploadUrl, form, {
      headers: {
        Authorization: `Bearer ${process.env.NOTION_TOKEN}`,
        "Notion-Version": process.env.NOTION_VERSION || "2022-06-28",
        ...form.getHeaders(),
      },
      maxContentLength: Infinity,
      maxBodyLength: Infinity,
      timeout: 60000,
    });

    // prefer returned id from upload response if present
    const returnedId = uploadRes.data && (uploadRes.data.id || fileUploadId);
    log(
      `✅ Upload response status: ${uploadRes.status}, id: ${String(
        returnedId
      ).substring(0, 20)}...`
    );
    return returnedId || fileUploadId || null;
  } catch (err) {
    log("uploadBufferToNotion failed:", err.message || err);
    if (err.response) log("Upload error response:", err.response.data);
    return null;
  }
}

// Health and info endpoints
app.get("/health", (req, res) =>
  sendSuccess(res, {
    status: "ok",
    version: process.env.npm_package_version || "dev",
    notion: {
      tokenConfigured: !!process.env.NOTION_TOKEN,
      clientInitialized: !!notion,
    },
    ts: new Date().toISOString(),
  })
);

app.get("/ping", (req, res) =>
  sendSuccess(res, { pong: true, ts: Date.now() })
);

app.get("/api/status", (req, res) =>
  sendSuccess(res, {
    service: "sn2n-proxy",
    version: process.env.npm_package_version || "dev",
    uptime: process.uptime(),
    timestamp: new Date().toISOString(),
  })
);

// Minimal W2N echo endpoint preserved for compatibility
app.post("/api/W2N", (req, res) => {
  try {
    const payload = req.body || {};
    log("/api/W2N received payload, size:", JSON.stringify(payload).length);
    // In the future this would orchestrate full page creation; for now reflect back
    return sendSuccess(res, { pageUrl: payload.pageUrl || null });
  } catch (err) {
    log("/api/W2N error:", err && err.message);
    return sendError(
      res,
      "SERVER_ERROR",
      (err && err.message) || "server error",
      null,
      500
    );
  }
});

// Endpoint: fetch external image URL and upload to Notion
app.post("/fetch-and-upload", async (req, res) => {
  try {
    const { url, filename, alt } = req.body || {};
    if (!url)
      return sendError(
        res,
        "MISSING_URL",
        "Missing 'url' in request body",
        null,
        400
      );
    log("fetch-and-upload ->", url);
    const uploadId = await downloadAndUploadImage(
      url,
      alt || filename || "image"
    );
    if (!uploadId)
      return sendError(
        res,
        "UPLOAD_FAILED",
        "Failed to download or upload image",
        null,
        500
      );
    return sendSuccess(res, {
      fileUploadId: uploadId,
      fileName: filename || alt || path.basename(url),
    });
  } catch (err) {
    log("fetch-and-upload error:", err && err.message);
    return sendError(res, "SERVER_ERROR", err && err.message, null, 500);
  }
});

// Endpoint: accept base64/data URI in JSON and upload to Notion
app.post("/upload-to-notion", async (req, res) => {
  try {
    if (!ensureFileUploadAvailable())
      return sendError(
        res,
        "NOTION_UPLOAD_NOT_AVAILABLE",
        "Notion file upload not available (NOTION_TOKEN missing)",
        null,
        500
      );

    let filename;
    let buffer;

    if (req.body && req.body.data) {
      const data = req.body.data;
      const match = String(data).match(/^data:(.+);base64,(.*)$/);
      if (match) {
        const mimeType = match[1];
        const b64 = match[2];
        buffer = Buffer.from(b64, "base64");
        const ext = mimeType.split("/").pop().split("+")[0];
        filename = req.body.filename || `upload.${ext}`;
      } else {
        // assume raw base64
        buffer = Buffer.from(String(data), "base64");
        filename = req.body.filename || `upload.bin`;
      }
    } else if (req.body && req.body.base64 && req.body.filename) {
      buffer = Buffer.from(req.body.base64, "base64");
      filename = req.body.filename;
    } else {
      return sendError(
        res,
        "NO_FILE_DATA",
        "No file data provided (expected data:dataURI or base64 + filename)",
        null,
        400
      );
    }

    const mimeType = req.body.mimeType || null;
    const fileUploadId = await uploadBufferToNotion(
      buffer,
      filename,
      mimeType || "application/octet-stream"
    );
    if (!fileUploadId)
      return sendError(res, "UPLOAD_FAILED", "Upload failed", null, 500);
    return sendSuccess(res, { fileUploadId, fileName: filename });
  } catch (err) {
    log("upload-to-notion error:", err && err.message);
    return sendError(
      res,
      "SERVER_ERROR",
      (err && err.message) || "internal error",
      null,
      500
    );
  }
});

// OPTIONS fallback
app.options("/*", (req, res) => res.sendStatus(204));

app.listen(PORT, () => {
  log(`SN2N proxy listening on port ${PORT}`);
  log(`Notion available: ${!!process.env.NOTION_TOKEN}`);
});
