#!/usr/bin/env node
// SN2N proxy (CommonJS copy) - runnable even when package.json sets "type": "module"
const express = require("express");
const cors = require("cors");
const dotenv = require("dotenv");
const fs = require("fs");
const path = require("path");
const axios = require("axios");
const FormData = require("form-data");

// Import Martian helper for advanced HTML-to-Notion conversion
let martianHelper = null;
try {
  martianHelper = require(path.join(__dirname, "martian-helper.cjs"));
} catch (e) {
  console.log("⚠️ Martian helper not available:", e.message);
}

let { Client: NotionClient } = {};
try {
  NotionClient = require("@notionhq/client").Client;
} catch (e) {
  NotionClient = null;
}

// Prefer loading .env from the server folder (robust when starting from project root or server/)
try {
  dotenv.config({ path: path.join(__dirname, ".env") });
} catch (e) {
  // Fallback to default behavior
  dotenv.config();
}

const PORT = process.env.PORT || 3004;

const app = express();
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

// Logging helper: quiet by default, enable verbose output with SN2N_VERBOSE=1
// Mutable at runtime via API below
let SN2N_VERBOSE = !!(
  process.env.SN2N_VERBOSE && String(process.env.SN2N_VERBOSE) === "1"
);
let SN2N_EXTRA_DEBUG = !!(
  process.env.SN2N_EXTRA_DEBUG && String(process.env.SN2N_EXTRA_DEBUG) === "1"
);

const DEBUG_PATTERNS = [
  /^🔍/,
  /^🔧/,
  /^📊/,
  /^📄/,
  /^📝/,
  /^🎯/,
  /^📦/,
  /^🔄/,
  /^✅ (Placeholder|Found|Code|Adding)/,
  /^❌ Placeholder/,
  /^⚠️ Placeholder/,
  /^\s{3}/,
];

function log(...args) {
  if (!SN2N_VERBOSE) return;
  if (
    !SN2N_EXTRA_DEBUG &&
    args.length > 0 &&
    typeof args[0] === "string" &&
    DEBUG_PATTERNS.some((pattern) => pattern.test(args[0]))
  ) {
    return;
  }
  console.log(new Date().toISOString(), "[SN2N]", ...args);
}
function getVerbose() {
  return !!SN2N_VERBOSE;
}
// Verify that no blocks on the page still contain any (sn2n:...) markers.
async function verifyNoMarkersOnPage(rootPageId) {
  if (!notion) throw new Error("Notion client not initialized");
  const markerRegex = /\(sn2n:[^)]+\)/g;

  async function listChildren(blockId, cursor) {
    return await notion.blocks.children.list({
      block_id: blockId,
      page_size: 100,
      start_cursor: cursor,
    });
  }

  const queue = [rootPageId];
  const visited = new Set();
  const found = [];

  while (queue.length > 0) {
    const current = queue.shift();
    if (visited.has(current)) continue;
    visited.add(current);

    let cursor = undefined;
    do {
      const res = await listChildren(current, cursor);
      cursor = res.has_more ? res.next_cursor : undefined;
      const children = res.results || [];
      for (const child of children) {
        try {
          const t = child.type;
          const payload = child[t] || child.paragraph || {};
          const rich = Array.isArray(payload.rich_text)
            ? payload.rich_text
            : [];
          const plain = rich.map((r) => r?.text?.content || "").join("");
          const matches = plain.match(markerRegex) || [];
          if (matches.length > 0) {
            found.push({
              id: child.id,
              type: child.type,
              preview: plain,
              matches,
            });
          }
          if (child.has_children) queue.push(child.id);
        } catch (e) {
          log("⚠️ verifyNoMarkersOnPage inner error:", e && e.message);
        }
      }
    } while (cursor);
  }

  return { found };
}
function getExtraDebug() {
  return !!SN2N_EXTRA_DEBUG;
}
function setExtraDebug(v) {
  SN2N_EXTRA_DEBUG = !!v;
  return SN2N_EXTRA_DEBUG;
}

try {
  const logsDir = path.join(__dirname, "logs");
  if (!fs.existsSync(logsDir)) fs.mkdirSync(logsDir);
} catch (e) {}

function hyphenateNotionId(id) {
  if (!id || typeof id !== "string") return id;
  const clean = id.replace(/[^a-f0-9]/gi, "");
  if (clean.length !== 32) return id;
  return clean.replace(/^(.{8})(.{4})(.{4})(.{4})(.{12})$/, "$1-$2-$3-$4-$5");
}

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

const NOTION_CODE_LANGUAGES = new Set(
  [
    "abap",
    "abc",
    "agda",
    "arduino",
    "ascii art",
    "assembly",
    "bash",
    "basic",
    "bnf",
    "c",
    "c#",
    "c++",
    "clojure",
    "coffeescript",
    "coq",
    "css",
    "dart",
    "dhall",
    "diff",
    "docker",
    "ebnf",
    "elixir",
    "elm",
    "erlang",
    "f#",
    "flow",
    "fortran",
    "gherkin",
    "glsl",
    "go",
    "graphql",
    "groovy",
    "haskell",
    "hcl",
    "html",
    "idris",
    "java",
    "javascript",
    "json",
    "julia",
    "kotlin",
    "latex",
    "less",
    "lisp",
    "livescript",
    "llvm ir",
    "lua",
    "makefile",
    "markdown",
    "markup",
    "matlab",
    "mathematica",
    "mermaid",
    "nix",
    "notion formula",
    "objective-c",
    "ocaml",
    "pascal",
    "perl",
    "php",
    "plain text",
    "powershell",
    "prolog",
    "protobuf",
    "purescript",
    "python",
    "r",
    "racket",
    "reason",
    "ruby",
    "rust",
    "sass",
    "scala",
    "scheme",
    "scss",
    "shell",
    "smalltalk",
    "solidity",
    "sql",
    "swift",
    "toml",
    "typescript",
    "vb.net",
    "verilog",
    "vhdl",
    "visual basic",
    "webassembly",
    "xml",
    "yaml",
    "java/c/c++/c#",
  ].map((lang) => lang.toLowerCase())
);

const CODE_LANGUAGE_ALIASES = {
  js: "javascript",
  jsx: "javascript",
  javascript: "javascript",
  ts: "typescript",
  tsx: "typescript",
  typescript: "typescript",
  py: "python",
  python: "python",
  rb: "ruby",
  ruby: "ruby",
  php: "php",
  java: "java",
  kotlin: "kotlin",
  swift: "swift",
  go: "go",
  golang: "go",
  rust: "rust",
  sql: "sql",
  tsql: "sql",
  groovy: "groovy",
  gradle: "groovy",
  bash: "bash",
  sh: "shell",
  shell: "shell",
  zsh: "shell",
  fish: "shell",
  powershell: "powershell",
  ps1: "powershell",
  c: "c",
  cpp: "c++",
  cc: "c++",
  "c++": "c++",
  csharp: "c#",
  cs: "c#",
  "c#": "c#",
  objectivec: "objective-c",
  "objective-c": "objective-c",
  objc: "objective-c",
  h: "objective-c",
  scala: "scala",
  clj: "clojure",
  clojure: "clojure",
  coffee: "coffeescript",
  coffeescript: "coffeescript",
  dart: "dart",
  elixir: "elixir",
  elm: "elm",
  erlang: "erlang",
  haskell: "haskell",
  hs: "haskell",
  hcl: "hcl",
  html: "html",
  xhtml: "html",
  xml: "xml",
  css: "css",
  scss: "scss",
  sass: "sass",
  less: "less",
  json: "json",
  yaml: "yaml",
  yml: "yaml",
  markdown: "markdown",
  md: "markdown",
  markup: "markup",
  latex: "latex",
  tex: "latex",
  matlab: "matlab",
  mathematica: "mathematica",
  mermaid: "mermaid",
  nix: "nix",
  protobuf: "protobuf",
  proto: "protobuf",
  r: "r",
  racket: "racket",
  reason: "reason",
  scheme: "scheme",
  solidity: "solidity",
  toml: "toml",
  vb: "visual basic",
  "visual basic": "visual basic",
  vbnet: "vb.net",
  "vb.net": "vb.net",
  plain: "plain text",
  plaintext: "plain text",
  "plain-text": "plain text",
  plain_text: "plain text",
  text: "plain text",
  none: "plain text",
  generic: "plain text",
  properties: "plain text",
  ini: "plain text",
  conf: "plain text",
  log: "plain text",
  diff: "diff",
  dockerfile: "docker",
  docker: "docker",
  make: "makefile",
  makefile: "makefile",
  graphql: "graphql",
  glsl: "glsl",
};

const VALID_RICH_TEXT_COLORS = new Set([
  "default",
  "gray",
  "brown",
  "orange",
  "yellow",
  "green",
  "blue",
  "purple",
  "pink",
  "red",
  "gray_background",
  "brown_background",
  "orange_background",
  "yellow_background",
  "green_background",
  "blue_background",
  "purple_background",
  "pink_background",
  "red_background",
]);

function normalizeAnnotations(annotations) {
  const input =
    annotations && typeof annotations === "object" ? annotations : {};
  const normalized = {
    bold: !!input.bold,
    italic: !!input.italic,
    strikethrough: !!input.strikethrough,
    underline: !!input.underline,
    code: !!input.code,
    color: "default",
  };

  if (typeof input.color === "string") {
    const candidate = input.color.toLowerCase();
    if (VALID_RICH_TEXT_COLORS.has(candidate)) {
      normalized.color = candidate;
    }
  }

  if (!VALID_RICH_TEXT_COLORS.has(normalized.color)) {
    normalized.color = "default";
  }

  return normalized;
}

function normalizeCodeLanguage(language) {
  if (!language || typeof language !== "string") {
    return "javascript";
  }

  const cleaned = language.trim().toLowerCase();
  if (!cleaned) {
    return "javascript";
  }

  if (CODE_LANGUAGE_ALIASES[cleaned]) {
    return CODE_LANGUAGE_ALIASES[cleaned];
  }

  if (NOTION_CODE_LANGUAGES.has(cleaned)) {
    return cleaned;
  }

  return "javascript";
}

let notion = null;
if (process.env.NOTION_TOKEN) {
  try {
    if (NotionClient)
      notion = new NotionClient({
        auth: process.env.NOTION_TOKEN,
        notionVersion: "2022-06-28",
      });
    else notion = null;
    log("Notion token configured: true");

    // Initialize Martian helper with Notion client
    if (martianHelper && typeof martianHelper.setNotionClient === "function") {
      martianHelper.setNotionClient(notion);
      log("✅ Martian helper initialized with Notion client");
    }
  } catch (e) {
    notion = null;
    log("Notion client init failed:", e.message);
  }
} else {
  // Minimal startup notice when not verbose
  if (SN2N_VERBOSE) log("Notion token not configured (NOTION_TOKEN missing)");
}

function ensureFileUploadAvailable() {
  if (process.env.NOTION_TOKEN && process.env.NOTION_TOKEN.length > 10)
    return true;
  return false;
}

// Standard response helpers: success/data/meta and error shape
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

async function downloadAndUploadImage(imageUrl, alt = "image") {
  try {
    if (SN2N_VERBOSE)
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
    if (SN2N_VERBOSE) log("downloadAndUploadImage failed:", err.message || err);
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
    if (SN2N_VERBOSE) log(`📤 Creating file upload object for ${filename}`);
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

    if (SN2N_VERBOSE)
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

    const returnedId = uploadRes.data && (uploadRes.data.id || fileUploadId);
    if (SN2N_VERBOSE)
      log(
        `✅ Upload response status: ${uploadRes.status}, id: ${String(
          returnedId
        ).substring(0, 20)}...`
      );
    return returnedId || fileUploadId || null;
  } catch (err) {
    if (SN2N_VERBOSE) log("uploadBufferToNotion failed:", err.message || err);
    if (SN2N_VERBOSE && err.response)
      log("Upload error response:", err.response.data);
    return null;
  }
}

app.get("/health", (req, res) => {
  return sendSuccess(res, {
    status: "ok",
    version: process.env.npm_package_version || "dev",
    notion: {
      tokenConfigured: !!process.env.NOTION_TOKEN,
      clientInitialized: !!notion,
    },
    ts: new Date().toISOString(),
  });
});

app.get("/ping", (req, res) =>
  sendSuccess(res, { pong: true, ts: Date.now() })
);

app.get("/api/status", (req, res) => {
  return sendSuccess(res, {
    service: "sn2n-proxy",
    version: process.env.npm_package_version || "dev",
    uptime: process.uptime(),
    timestamp: new Date().toISOString(),
  });
});

// Runtime logging control endpoints
app.get("/api/logging", (req, res) =>
  sendSuccess(res, {
    verbose: getVerbose(),
    extraDebug: getExtraDebug(),
  })
);

app.post("/api/logging", (req, res) => {
  try {
    const { verbose, extraDebug } = req.body || {};
    const response = {};

    if (typeof verbose !== "undefined") {
      response.verbose = setVerbose(!!verbose);
    } else {
      response.verbose = getVerbose();
    }

    if (typeof extraDebug !== "undefined") {
      response.extraDebug = setExtraDebug(!!extraDebug);
    } else {
      response.extraDebug = getExtraDebug();
    }

    return sendSuccess(res, response);
  } catch (e) {
    return sendError(res, "SERVER_ERROR", e.message || String(e));
  }
});

// Global tracker for video detection (reset per conversion)
let hasDetectedVideos = false;

// Helper function to check if an iframe URL is from a known video platform
function isVideoIframeUrl(url) {
  if (!url) return false;
  const videoPatterns = [
    /youtube\.com\/embed\//i,
    /youtube-nocookie\.com\/embed\//i,
    /player\.vimeo\.com\//i,
    /vimeo\.com\/video\//i,
    /wistia\.(com|net)/i,
    /fast\.wistia\.(com|net)/i,
    /loom\.com\/embed\//i,
    /vidyard\.com\/embed\//i,
    /brightcove\.(com|net)/i,
  ];
  return videoPatterns.some((pattern) => pattern.test(url));
}

// HTML to Notion blocks conversion function
async function htmlToNotionBlocks(html) {
  if (!html || typeof html !== "string")
    return { blocks: [], hasVideos: false };

  // Reset video detection flag for this conversion
  hasDetectedVideos = false;

  log(`🔄 Converting HTML to Notion blocks (${html.length} chars)`);
  log(`📄 HTML sample: ${html.substring(0, 500)}...`);

  // DEBUG: Check for pre tags in input HTML
  const hasPreInInput = html.includes("<pre");
  log(`🔍 DEBUG: Input HTML contains <pre tags: ${hasPreInInput}`);

  // DISABLED: Martian conversion bypasses our custom image processing
  // Images need to be processed directly with our image handling code
  // that supports ServiceNow authentication and proper positioning
  /*
  if (
    martianHelper &&
    typeof martianHelper.convertToNotionBlocks === "function"
  ) {
    try {
      log("🚀 Using Martian helper for HTML-to-Notion conversion");
      const convertedBlocks = await martianHelper.convertToNotionBlocks(html, {
        from: "html",
        options: { strictImageUrls: false },
      });

      if (
        convertedBlocks &&
        Array.isArray(convertedBlocks) &&
        convertedBlocks.length > 0
      ) {
        log(`✅ Martian converted HTML to ${convertedBlocks.length} blocks`);
        return { blocks: convertedBlocks, hasVideos: false };
      } else {
        log("⚠️ Martian returned empty result, falling back to basic parsing");
      }
    } catch (martianError) {
      log(`❌ Martian conversion failed: ${martianError.message}`);
      log("🔄 Falling back to basic HTML parsing");
    }
  } else {
    log("⚠️ Martian helper not available, using basic HTML parsing");
  }
  */

  log("📝 Using custom HTML parsing with direct Notion SDK image handling");

  // Fallback to improved DOM-based parsing
  const blocks = [];

  // Remove script and style tags
  html = html.replace(/<script[^>]*>[\s\S]*?<\/script>/gi, "");
  html = html.replace(/<style[^>]*>[\s\S]*?<\/style>/gi, "");

  // Remove ServiceNow documentation helper UI elements that shouldn't appear in Notion output
  html = html.replace(
    /<div[^>]*class="[^"]*zDocsCodeExplanationContainer[^"]*"[^>]*>[\s\S]*?<\/div>/gi,
    ""
  );
  html = html.replace(
    /<button[^>]*class="[^"]*zDocsAiActionsButton[^"]*"[^>]*>[\s\S]*?<\/button>/gi,
    ""
  );
  html = html.replace(
    /<div[^>]*class="(?![^"]*code-toolbar)[^"]*\btoolbar\b[^"]*"[^>]*>[\s\S]*?<\/div>/gi,
    ""
  );
  html = html.replace(
    /<button[^>]*class="[^"]*copy-to-clipboard-button[^"]*"[^>]*>[\s\S]*?<\/button>/gi,
    ""
  );

  // Don't extract images at the top - they'll be processed inline within their context
  // This ensures images appear in their proper position in the document flow

  /*
  // REMOVED: This code extracted all images at the start, causing them to appear at the top
  const imgRegex = /<img[^>]*>/gi;
  let imgMatch;
  while ((imgMatch = imgRegex.exec(html)) !== null) {
    const imgTag = imgMatch[0];
    const srcMatch = imgTag.match(/src=["']([^"']*)["']/i);
    const altMatch = imgTag.match(/alt=["']([^"']*)["']/i);

    if (srcMatch && srcMatch[1]) {
      let src = srcMatch[1];
      const alt = altMatch ? altMatch[1] : "";

      // Convert relative URLs to absolute
      src = convertServiceNowUrl(src);

      if (src && isValidImageUrl(src)) {
        // For ServiceNow images, use external URLs directly since they require authentication
        const isServiceNowImage =
          src.includes("servicenow.com") || src.includes("servicenow-be-prod");

        if (!isServiceNowImage) {
          // Try to download and upload non-ServiceNow images
          try {
            log(`🖼️ Processing image: ${src.substring(0, 80)}...`);
            const uploadId = await downloadAndUploadImage(src, alt || "image");

            if (uploadId) {
              // Successfully uploaded - use file reference
              blocks.push({
                object: "block",
                type: "image",
                image: {
                  type: "file_upload",
                  file_upload: {
                    id: uploadId,
                  },
                  caption: alt
                    ? [{ type: "text", text: { content: alt } }]
                    : [],
                },
              });
              log(`✅ Image uploaded successfully with ID: ${uploadId}`);
            } else {
              // Upload failed - fallback to external URL
              log(`⚠️ Image upload failed, using external URL as fallback`);
              blocks.push({
                object: "block",
                type: "image",
                image: {
                  type: "external",
                  external: { url: src },
                  caption: alt
                    ? [{ type: "text", text: { content: alt } }]
                    : [],
                },
              });
            }
          } catch (error) {
            log(
              `⚠️ Error uploading image: ${error.message}, falling back to external URL`
            );
            blocks.push({
              object: "block",
              type: "image",
              image: {
                type: "external",
                external: { url: src },
                caption: alt ? [{ type: "text", text: { content: alt } }] : [],
              },
            });
          }
        } else {
          // Use external URL for ServiceNow images
          log(`🔗 Using external image URL: ${src.substring(0, 80)}...`);
          blocks.push({
            object: "block",
            type: "image",
            image: {
              type: "external",
              external: { url: src },
              caption: alt ? [{ type: "text", text: { content: alt } }] : [],
            },
          });
        }
      }
    }
  }
  */

  // Remove smartTable dropdown/filter UI elements globally (accounting for nested divs)
  // This function properly handles nested div tags
  function removeSmartTableElements(html) {
    let result = html;
    let changed = true;

    log(`🧹 Starting smartTable element removal...`);

    // Keep removing until no more matches found
    while (changed) {
      changed = false;

      // Find divs with smartTable or zDocsFilterTableDiv classes
      const regex =
        /<div[^>]*class="[^"]*(?:smartTable|zDocsFilterTableDiv)[^"]*"[^>]*>/gi;
      let match;

      while ((match = regex.exec(result)) !== null) {
        const startPos = match.index;
        const afterOpenTag = regex.lastIndex;

        log(`🗑️ Found smartTable wrapper at position ${startPos}`);

        // Find the matching closing tag
        let depth = 1;
        let pos = afterOpenTag;

        while (depth > 0 && pos < result.length) {
          const nextOpen = result.indexOf("<div", pos);
          const nextClose = result.indexOf("</div>", pos);

          if (nextClose === -1) {
            // No closing tag found, break
            break;
          }

          if (nextOpen !== -1 && nextOpen < nextClose) {
            // Found an opening div before closing div
            depth++;
            pos = nextOpen + 4;
          } else {
            // Found a closing div
            depth--;
            pos = nextClose + 6;

            if (depth === 0) {
              // Found the matching closing tag
              // Extract any tables from inside this wrapper before removing it
              const wrapperContent = result.substring(startPos, pos);
              const tableRegex = /<table[^>]*>[\s\S]*?<\/table>/gi;
              const tablesInWrapper = [];
              let tableMatch;

              while ((tableMatch = tableRegex.exec(wrapperContent)) !== null) {
                tablesInWrapper.push(tableMatch[0]);
                log(
                  `📋 Extracted table from smartTable wrapper: ${tableMatch[0].substring(
                    0,
                    100
                  )}...`
                );
              }

              // Replace the wrapper with just the extracted tables (or remove if no tables)
              if (tablesInWrapper.length > 0) {
                const tablesHtml = tablesInWrapper.join("\n");
                result =
                  result.substring(0, startPos) +
                  tablesHtml +
                  result.substring(pos);
                log(
                  `✅ Replaced smartTable wrapper with ${tablesInWrapper.length} extracted table(s)`
                );
              } else {
                // No tables found, remove the entire wrapper
                result = result.substring(0, startPos) + result.substring(pos);
                log(`🗑️ Removed smartTable wrapper (no tables found)`);
              }

              changed = true;
              break;
            }
          }
        }

        if (changed) break; // Restart search after removal
      }
    }

    return result;
  }

  html = removeSmartTableElements(html);

  // Use simple DOM-like parsing: create a temporary div and walk through child nodes
  // This is a simplified approach that processes elements sequentially
  log("📝 Using improved DOM-based HTML parsing");

  // Helper function to find the matching closing tag for a nested element
  function findMatchingClosingTag(html, startPos, tagName) {
    let depth = 1;
    let pos = startPos;
    const openRegex = new RegExp(`<${tagName}[^>]*>`, "gi");
    const closeRegex = new RegExp(`</${tagName}>`, "gi");

    while (depth > 0 && pos < html.length) {
      // Find next opening or closing tag
      openRegex.lastIndex = pos;
      closeRegex.lastIndex = pos;

      const openMatch = openRegex.exec(html);
      const closeMatch = closeRegex.exec(html);

      // If no closing tag found, return -1
      if (!closeMatch) {
        return -1;
      }

      // If opening tag comes before closing tag, increment depth
      if (openMatch && openMatch.index < closeMatch.index) {
        depth++;
        pos = openRegex.lastIndex;
      } else {
        // Closing tag found
        depth--;
        pos = closeRegex.lastIndex;
        if (depth === 0) {
          return pos;
        }
      }
    }

    return -1;
  }

  // Helper function to parse list items with support for nested lists
  // Notion has a depth limit of 2 levels for nested blocks
  async function parseListItems(html, listType, currentDepth = 0) {
    const MAX_DEPTH = 2; // Notion's maximum nesting depth
    const items = [];

    const closingTagLength = "</li>".length;
    let searchPos = 0;

    while (searchPos < html.length) {
      const liStart = html.toLowerCase().indexOf("<li", searchPos);
      if (liStart === -1) break;

      const openTagEnd = html.indexOf(">", liStart);
      if (openTagEnd === -1) break;

      const contentStart = openTagEnd + 1;
      const closingPos = findMatchingClosingTag(html, contentStart, "li");
      if (closingPos === -1) {
        // Fallback: advance by a single character to avoid infinite loops
        searchPos = contentStart;
        continue;
      }

      const contentEnd = closingPos - closingTagLength;
      const fullItemContent = html.substring(contentStart, contentEnd);
      searchPos = closingPos;

      // Check if this item contains a nested list
      const nestedListRegex = /<(ul|ol)[^>]*>([\s\S]*?)<\/\1>/i;
      const nestedMatch = nestedListRegex.exec(fullItemContent);

      let textContent = fullItemContent;
      let children = [];

      // Detect li open tag classes (e.g., class="link ulchildlink") so we can apply special handling
      const liOpenTag = html.substring(liStart, openTagEnd + 1);
      const liClassMatch = liOpenTag.match(/class=["']([^"']*)["']/i);
      const liClasses = liClassMatch ? liClassMatch[1].toLowerCase() : "";
      const isUlChildLink = /\bulchildlink\b/.test(liClasses);

      if (nestedMatch && currentDepth < MAX_DEPTH) {
        // Extract text before the nested list
        textContent = fullItemContent.substring(0, nestedMatch.index);

        // Parse the nested list
        const nestedListType =
          nestedMatch[1] === "ul" ? "bulleted_list_item" : "numbered_list_item";
        children = await parseListItems(
          nestedMatch[2],
          nestedListType,
          currentDepth + 1
        );
      } else if (nestedMatch && currentDepth >= MAX_DEPTH) {
        // At max depth, flatten the nested content into the parent item
        log(
          `⚠️ List nesting exceeds Notion's limit (${MAX_DEPTH} levels). Flattening nested content.`
        );
        textContent = fullItemContent; // Include nested list as text
      }

      // Extract block elements like <pre>, <table>, <img> from the text content
      const childBlocks = [];
      const siblingBlocks = [];
      let processedTextContent = textContent;

      // Extract <table> elements
      const tableRegex = /<table[^>]*>([\s\S]*?)<\/table>/gi;
      let tableMatch;
      while ((tableMatch = tableRegex.exec(textContent)) !== null) {
        try {
          const fullTableHtml = tableMatch[0]; // Use full match including <table> tags
          const tableBlocks = await parseTableToNotionBlock(fullTableHtml);
          if (tableBlocks && tableBlocks.length > 0) {
            if (currentDepth < MAX_DEPTH) {
              childBlocks.push(...tableBlocks);
            } else {
              siblingBlocks.push(...tableBlocks);
            }
            log(`✅ Found table in list item with ${tableBlocks.length} rows`);
          }
          // Remove the <table> element from the text content
          processedTextContent = processedTextContent.replace(
            tableMatch[0],
            ""
          );
        } catch (tableError) {
          log(`⚠️ Error parsing table in list item: ${tableError.message}`);
        }
      }

      // Extract <figure> elements (which contain figcaption + img)
      const figureRegex = /<figure[^>]*>([\s\S]*?)<\/figure>/gi;
      let figureMatch;
      while ((figureMatch = figureRegex.exec(textContent)) !== null) {
        const figureContent = figureMatch[1];

        // Extract figcaption
        const figcaptionMatch = figureContent.match(
          /<figcaption[^>]*>([\s\S]*?)<\/figcaption>/i
        );
        if (figcaptionMatch) {
          const captionText = cleanHtmlText(figcaptionMatch[1]);
          if (captionText && captionText.trim().length > 0) {
            childBlocks.push({
              object: "block",
              type: "paragraph",
              paragraph: {
                rich_text: [
                  {
                    type: "text",
                    text: { content: captionText },
                    annotations: normalizeAnnotations({ italic: true }),
                  },
                ],
              },
            });
            log(
              `✅ Found figcaption in list item: ${captionText.substring(
                0,
                50
              )}...`
            );
          }
        }

        // Extract image from figure
        const imgMatch = figureContent.match(/<img[^>]*>/i);
        if (imgMatch) {
          const srcMatch = imgMatch[0].match(/src=["']([^"']*)["\']/i);
          const altMatch = imgMatch[0].match(/alt=["']([^"']*)["\']/i);

          if (srcMatch && srcMatch[1]) {
            let src = srcMatch[1];
            const alt = altMatch ? altMatch[1] : "";
            src = convertServiceNowUrl(src);

            if (src && isValidImageUrl(src)) {
              const imageBlock = await createImageBlock(src, alt);
              if (imageBlock) {
                childBlocks.push(imageBlock);
                log(
                  `✅ Found image in figure in list item: ${src.substring(
                    0,
                    50
                  )}...`
                );
              }
            }
          }
        }

        // Remove the entire <figure> element from the text content
        processedTextContent = processedTextContent.replace(figureMatch[0], "");
      }

      // Extract standalone <img> elements (not inside figures)
      const imgRegex = /<img[^>]*>/gi;
      let imgMatch;
      while ((imgMatch = imgRegex.exec(processedTextContent)) !== null) {
        const srcMatch = imgMatch[0].match(/src=["']([^"']*)["\']/i);
        const altMatch = imgMatch[0].match(/alt=["']([^"']*)["\']/i);

        if (srcMatch && srcMatch[1]) {
          let src = srcMatch[1];
          const alt = altMatch ? altMatch[1] : "";
          src = convertServiceNowUrl(src);

          if (src && isValidImageUrl(src)) {
            const imageBlock = await createImageBlock(src, alt);
            if (imageBlock) {
              childBlocks.push(imageBlock);
              log(
                `✅ Found standalone image in list item: ${src.substring(
                  0,
                  50
                )}...`
              );
            }
          }
        }
        // Remove the <img> element from the text content
        processedTextContent = processedTextContent.replace(imgMatch[0], "");
      }

      // If this list item is a 'ulchildlink', ensure a soft return marker between </a> and following <p>
      // Insert the internal __SOFT_BREAK__ token so htmlToNotionRichText will convert it to a newline run.
      if (isUlChildLink) {
        const before = processedTextContent;
        processedTextContent = processedTextContent.replace(
          /(<\/a>)(\s*<p\b)/gi,
          "$1__SOFT_BREAK__$2"
        );
        if (processedTextContent !== before) {
          log(
            `🔧 ulchildlink: inserted __SOFT_BREAK__ between </a> and <p> for list item at pos ${liStart}`
          );
        }
      }

      // Extract <pre> elements
      const preRegex = /<pre[^>]*>([\s\S]*?)<\/pre>/gi;
      let preMatch;
      while ((preMatch = preRegex.exec(textContent)) !== null) {
        const preAttributes = preMatch[0].match(/<pre([^>]*)>/i)?.[1] || "";
        const preContent = preMatch[1];

        // Create a code block
        let language = "";
        const classMatch = preAttributes.match(/class=["']([^"']*)["']/i);
        if (classMatch) {
          const classes = classMatch[1]
            .split(/\s+/)
            .map((cls) => cls.trim())
            .filter(Boolean);
          const languageClass = classes.find((cls) =>
            cls.toLowerCase().startsWith("language-")
          );
          if (languageClass) {
            language = languageClass.substring("language-".length);
          }
        }

        if (!language) {
          const dataLanguageMatch = preAttributes.match(
            /data-language=["']([^"']+)["']/i
          );
          if (dataLanguageMatch) {
            language = dataLanguageMatch[1];
          }
        }

        const normalizedLanguage = normalizeCodeLanguage(language);

        const codeText = extractPreCodeText(preContent);
        if (codeText && codeText.length > 0) {
          childBlocks.push({
            object: "block",
            type: "code",
            code: {
              rich_text: [{ type: "text", text: { content: codeText } }],
              language: normalizedLanguage,
            },
          });
          log(
            `✅ Found code block in list item: ${codeText.substring(0, 50)}...`
          );
        }

        // Remove the <pre> element from the text content
        processedTextContent = processedTextContent.replace(preMatch[0], "");
      }

      // Clean the remaining text content and convert to rich text
      const result = await htmlToNotionRichText(processedTextContent);
      const richText = result.richText;

      let handledChildBlocks = false;

      if (richText.length > 0 && richText[0].text.content.trim().length > 0) {
        const item = {
          object: "block",
          type: listType,
          [listType]: {
            rich_text: richText,
          },
        };

        // Add children if there are any and we haven't exceeded depth
        if (children.length > 0 && currentDepth < MAX_DEPTH) {
          item[listType].children = children;
        }

        if (childBlocks.length > 0) {
          if (currentDepth < MAX_DEPTH) {
            if (!item[listType].children) {
              item[listType].children = [];
            }
            item[listType].children.push(...childBlocks);
            handledChildBlocks = true;
          } else {
            siblingBlocks.push(...childBlocks);
            handledChildBlocks = true;
          }
        }

        items.push(item);
      } else if (childBlocks.length > 0) {
        if (currentDepth < MAX_DEPTH) {
          const emptyItem = {
            object: "block",
            type: listType,
            [listType]: {
              rich_text: [],
              children: [...childBlocks],
            },
          };
          items.push(emptyItem);
          handledChildBlocks = true;
        } else {
          siblingBlocks.push(...childBlocks);
          handledChildBlocks = true;
        }
      }

      if (!handledChildBlocks && childBlocks.length > 0) {
        siblingBlocks.push(...childBlocks);
      }

      // Add any block elements that should remain siblings
      items.push(...siblingBlocks);
    }

    return items;
  }

  function cloneRichText(rt) {
    if (!rt || typeof rt !== "object") {
      return null;
    }
    const cloned = {
      ...rt,
      annotations: normalizeAnnotations(rt.annotations),
    };
    if (rt.text && typeof rt.text === "object") {
      cloned.text = { ...rt.text };
    }
    if (typeof cloned.plain_text !== "string" && cloned.text?.content) {
      cloned.plain_text = cloned.text.content;
    }
    return cloned;
  }

  function sanitizeRichTextArray(items) {
    if (!Array.isArray(items)) {
      return [];
    }
    return items
      .map((rt) => cloneRichText(rt))
      .filter((rt) => {
        if (!rt || typeof rt.type !== "string") {
          return false;
        }
        if (rt.type === "text") {
          const content = rt.text?.content;
          if (typeof content !== "string") {
            return false;
          }
          return content.trim().length > 0 || !!rt.text?.link;
        }
        return !!rt[rt.type];
      });
  }

  function sanitizeBlocks(blocksToValidate, contextLabel = "root") {
    if (!Array.isArray(blocksToValidate)) return [];

    const ensureBlockHasTypedPayload = (block, path) => {
      if (!block || typeof block !== "object") {
        log(`⚠️ Dropping malformed block at ${path}: not an object`);
        return null;
      }

      const { type } = block;
      if (!type || typeof type !== "string") {
        log(
          `⚠️ Dropping block at ${path}: missing type ${JSON.stringify(block)}`
        );
        return null;
      }

      const payload = block[type];
      if (!payload || typeof payload !== "object") {
        const fallbackSources = [
          Array.isArray(block.rich_text) ? block.rich_text : null,
          Array.isArray(block.paragraph?.rich_text)
            ? block.paragraph.rich_text
            : null,
          Array.isArray(block.quote?.rich_text) ? block.quote.rich_text : null,
          Array.isArray(block.callout?.rich_text)
            ? block.callout.rich_text
            : null,
        ].filter(
          (candidate) => Array.isArray(candidate) && candidate.length > 0
        );

        if (fallbackSources.length > 0) {
          const fallbackRichText = fallbackSources[0]
            .map((rt) => cloneRichText(rt))
            .filter(Boolean);
          if (fallbackRichText.length > 0) {
            log(
              `⚠️ Coercing block at ${path} from type "${type}" to paragraph due to missing payload`
            );
            return {
              object: "block",
              type: "paragraph",
              paragraph: { rich_text: fallbackRichText },
            };
          }
        }

        log(
          `⚠️ Dropping block at ${path}: missing payload for type "${type}" (${JSON.stringify(
            block
          )})`
        );
        return null;
      }

      if (Array.isArray(block.children)) {
        const cleanedChildren = block.children
          .map((child, idx) =>
            ensureBlockHasTypedPayload(child, `${path}.children[${idx}]`)
          )
          .filter(Boolean);
        if (cleanedChildren.length > 0) {
          block.children = cleanedChildren;
        } else {
          delete block.children;
        }
      }

      if (Array.isArray(payload.children)) {
        const cleanedChildren = payload.children
          .map((child, idx) =>
            ensureBlockHasTypedPayload(
              child,
              `${path}.${type}.children[${idx}]`
            )
          )
          .filter(Boolean);
        if (cleanedChildren.length > 0) {
          payload.children = cleanedChildren;
        } else {
          delete payload.children;
        }
      }

      return block;
    };

    return blocksToValidate
      .map((block, index) =>
        ensureBlockHasTypedPayload(block, `${contextLabel}[${index}]`)
      )
      .filter(Boolean);
  }

  function flattenListUnsupportedBlocks(blocksToProcess) {
    if (!Array.isArray(blocksToProcess)) return [];

    const result = [];
    for (const block of blocksToProcess) {
      const { primary, trailing } = flattenBlock(block);
      if (primary) {
        result.push(primary);
      }
      if (Array.isArray(trailing) && trailing.length > 0) {
        result.push(...trailing);
      }
    }
    return result;
  }

  function flattenBlock(block) {
    if (!block || typeof block !== "object") {
      return { primary: null, trailing: [] };
    }

    const cloned = { ...block };
    let trailingBlocks = [];

    if (Array.isArray(cloned.children)) {
      const flattenedChildren = [];
      for (const child of cloned.children) {
        const { primary: childPrimary, trailing: childTrailing } =
          flattenBlock(child);
        if (childPrimary) {
          flattenedChildren.push(childPrimary);
        }
        if (Array.isArray(childTrailing) && childTrailing.length > 0) {
          trailingBlocks.push(...childTrailing);
        }
      }
      if (flattenedChildren.length > 0) {
        cloned.children = flattenedChildren;
      } else {
        delete cloned.children;
      }
    }

    const { type } = cloned;
    if (
      (type === "numbered_list_item" || type === "bulleted_list_item") &&
      cloned[type]
    ) {
      if (Array.isArray(cloned[type].rich_text)) {
        cloned[type].rich_text = sanitizeRichTextArray(cloned[type].rich_text);
      }

      const originalChildren = Array.isArray(cloned[type].children)
        ? cloned[type].children
        : [];
      const newChildren = [];

      for (const child of originalChildren) {
        const flattenedChild = flattenBlock(child);
        const childPrimary = flattenedChild.primary;
        let childTrailing = flattenedChild.trailing;

        if (childPrimary && childPrimary.type === "table") {
          let titleBlock = null;
          if (newChildren.length > 0) {
            const lastChild = newChildren[newChildren.length - 1];
            if (
              isHeadingBlock(lastChild) ||
              isParagraphTitleCandidate(lastChild)
            ) {
              titleBlock = newChildren.pop();
            }
          }

          if (!titleBlock) {
            const { headingCandidate, remainingChildren } =
              extractHeadingFromChildren(childTrailing);
            if (headingCandidate) {
              titleBlock = headingCandidate;
              childTrailing = remainingChildren;
            }
          }

          const tableTitle = getBlockPlainText(titleBlock) || "Table";

          const titleRichText = titleBlock
            ? getBlockRichText(titleBlock)
            : null;

          // Create a short unique marker for this table and attach it to the
          // preserved title (or a generated paragraph) so the orchestrator can
          // reliably locate the parent list-item later. We'll remove this
          // visible marker after appending the table.
          const marker = generateMarker();

          // Keep the original title block inside the list item when present;
          // when absent, create a small paragraph title to keep table context.
          if (titleBlock) {
            try {
              const tType = titleBlock.type;
              if (
                tType &&
                titleBlock[tType] &&
                Array.isArray(titleBlock[tType].rich_text)
              ) {
                titleBlock[tType].rich_text.push({
                  type: "text",
                  text: { content: ` (sn2n:${marker})` },
                });
              }
            } catch (e) {
              // ignore marker attach failures and proceed
            }
            newChildren.push(titleBlock);
          } else {
            const safeTitle = tableTitle || "Table";
            newChildren.push({
              object: "block",
              type: "paragraph",
              paragraph: {
                rich_text: [
                  {
                    type: "text",
                    text: { content: safeTitle + ` (sn2n:${marker})` },
                  },
                ],
              },
            });
          }

          // Move the table to trailing blocks but tag it with the same marker so the orchestrator
          // can append it as a child of this list item afterwards.
          if (childPrimary && typeof childPrimary === "object") {
            childPrimary._sn2n_marker = marker;
            trailingBlocks.push(childPrimary);
          }
        } else if (childPrimary) {
          newChildren.push(childPrimary);
        }

        if (Array.isArray(childTrailing) && childTrailing.length > 0) {
          trailingBlocks.push(...childTrailing);
        }
      }

      if (newChildren.length > 0) {
        const cleanedChildren = newChildren.filter(
          (child) => !isEmptyParagraphBlock(child)
        );
        if (cleanedChildren.length > 0) {
          const payload = { ...cloned[type] };
          payload.children = cleanedChildren;
          cloned[type] = payload;
          delete cloned.children;
        } else {
          const payload = { ...cloned[type] };
          delete payload.children;
          cloned[type] = payload;
          delete cloned.children;
        }
      } else {
        const payload = { ...cloned[type] };
        delete payload.children;
        cloned[type] = payload;
        delete cloned.children;
      }
    }

    return { primary: cloned, trailing: trailingBlocks };
  }

  function isEmptyParagraphBlock(block) {
    if (!block || block.type !== "paragraph") return false;
    const richText = Array.isArray(block.paragraph?.rich_text)
      ? block.paragraph.rich_text
      : [];
    if (richText.length === 0) return true;
    return richText.every((rt) => {
      const content =
        typeof rt?.text?.content === "string" ? rt.text.content : "";
      return content.trim().length === 0;
    });
  }

  function isHeadingBlock(block) {
    if (!block || typeof block.type !== "string") return false;
    return (
      block.type === "heading_1" ||
      block.type === "heading_2" ||
      block.type === "heading_3"
    );
  }

  function isParagraphTitleCandidate(block) {
    if (!block || block.type !== "paragraph") return false;
    const richText = block.paragraph?.rich_text;
    if (!Array.isArray(richText) || richText.length === 0) return false;
    const text = richText
      .map((rt) =>
        typeof rt?.text?.content === "string" ? rt.text.content : ""
      )
      .join(" ")
      .trim();
    return text.length > 0 && text.length <= 200;
  }

  function extractHeadingFromChildren(children) {
    if (!Array.isArray(children) || children.length === 0) {
      return { headingCandidate: null, remainingChildren: children };
    }

    const remaining = [...children];
    let headingCandidate = null;

    while (remaining.length > 0) {
      const next = remaining.shift();
      if (isHeadingBlock(next) || isParagraphTitleCandidate(next)) {
        headingCandidate = next;
        break;
      }
    }

    if (headingCandidate) {
      return { headingCandidate, remainingChildren: remaining };
    }

    return { headingCandidate: null, remainingChildren: children };
  }

  function getBlockPlainText(block) {
    if (!block || typeof block !== "object") return "";

    if (isHeadingBlock(block)) {
      const richText = block[block.type]?.rich_text || [];
      return richText
        .map((rt) =>
          typeof rt?.text?.content === "string" ? rt.text.content : ""
        )
        .join(" ")
        .trim();
    }

    if (block.type === "paragraph") {
      const richText = block.paragraph?.rich_text || [];
      return richText
        .map((rt) =>
          typeof rt?.text?.content === "string" ? rt.text.content : ""
        )
        .join(" ")
        .trim();
    }

    return "";
  }

  function getBlockRichText(block) {
    if (!block || typeof block !== "object") return null;
    const type = block.type;
    if (!type) return null;
    const payload = block[type];
    if (!payload || !Array.isArray(payload.rich_text)) return null;
    return sanitizeRichTextArray(payload.rich_text);
  }
  // Toggle/reference helpers removed: tables will keep their original title inside
  // the list item and the table block will be moved to trailing blocks with a marker
  // so the orchestrator can append it as a child of the list item.

  // Helper function to split rich text into chunks that fit Notion's 2000 character limit
  function splitRichTextIntoParagraphs(richTextArray) {
    const paragraphs = [];
    let currentChunk = [];
    let currentLength = 0;

    for (const textElement of richTextArray) {
      const elementLength = textElement.text.content.length;

      // If adding this element would exceed the limit, start a new paragraph
      if (currentLength + elementLength > 2000 && currentChunk.length > 0) {
        paragraphs.push(currentChunk);
        currentChunk = [];
        currentLength = 0;
      }

      // If this single element is longer than 2000 chars, we need to split it
      if (elementLength > 2000) {
        // Split the content into chunks of 2000 characters
        const content = textElement.text.content;
        for (let i = 0; i < content.length; i += 2000) {
          const chunkContent = content.substring(i, i + 2000);
          const chunkElement = {
            ...textElement,
            text: { ...textElement.text, content: chunkContent },
          };
          if (currentChunk.length > 0) {
            paragraphs.push(currentChunk);
            currentChunk = [];
            currentLength = 0;
          }
          paragraphs.push([chunkElement]);
        }
      } else {
        currentChunk.push(textElement);
        currentLength += elementLength;
      }
    }

    // Add any remaining chunk
    if (currentChunk.length > 0) {
      paragraphs.push(currentChunk);
    }

    return paragraphs;
  }

  // Simple function to extract text blocks from HTML by walking the tree
  async function extractBlocksFromHTML(
    htmlStr,
    skipPlaceholderCleanup = false
  ) {
    const tempBlocks = [];

    const splitRichTextAtIndex = (richTextArray, index) => {
      if (!Array.isArray(richTextArray)) {
        return { before: [], after: [] };
      }

      const before = [];
      const after = [];

      if (index <= 0) {
        for (const rt of richTextArray) {
          after.push(cloneRichText(rt));
        }
        return { before, after };
      }

      let consumed = 0;
      let splitCompleted = false;

      for (const rt of richTextArray) {
        const textValue = rt.text?.content || "";
        const length = textValue.length;
        const start = consumed;
        const end = consumed + length;

        if (!splitCompleted) {
          if (index >= end) {
            before.push(cloneRichText(rt));
          } else if (index <= start) {
            after.push(cloneRichText(rt));
            splitCompleted = true;
          } else {
            const splitPos = index - start;
            const beforeText = textValue.slice(0, splitPos);
            const afterText = textValue.slice(splitPos);

            if (beforeText.length > 0) {
              const beforeClone = cloneRichText(rt);
              beforeClone.text = {
                ...(beforeClone.text || {}),
                content: beforeText,
              };
              before.push(beforeClone);
            }

            if (afterText.length > 0) {
              const afterClone = cloneRichText(rt);
              afterClone.text = {
                ...(afterClone.text || {}),
                content: afterText,
              };
              after.push(afterClone);
            }

            splitCompleted = true;
          }
        } else {
          after.push(cloneRichText(rt));
        }

        consumed += length;
      }

      return { before, after };
    };

    const trimTrailingWhitespaceRichText = (richTextArray) => {
      for (let i = richTextArray.length - 1; i >= 0; i--) {
        const rt = richTextArray[i];
        const textValue = rt.text?.content || "";
        const trimmed = textValue.replace(/\s+$/g, "");

        if (trimmed.length === 0) {
          richTextArray.splice(i, 1);
        } else {
          richTextArray[i] = {
            ...rt,
            text: { ...(rt.text || {}), content: trimmed },
          };
          break;
        }
      }
    };

    const trimLeadingWhitespaceRichText = (richTextArray) => {
      for (let i = 0; i < richTextArray.length; i++) {
        const rt = richTextArray[i];
        const textValue = rt.text?.content || "";
        const trimmed = textValue.replace(/^\s+/g, "");

        if (trimmed.length === 0) {
          richTextArray.splice(i, 1);
          i--;
        } else {
          richTextArray[i] = {
            ...rt,
            text: { ...(rt.text || {}), content: trimmed },
          };
          break;
        }
      }
    };

    const maybeSplitParagraphForTrailingText = (
      blocks,
      contextTag,
      { skipWhenTrailingHandled = false } = {}
    ) => {
      if (!blocks || blocks.length === 0) return;

      const codeIndex = blocks.length - 1;
      const codeBlock = blocks[codeIndex];
      if (!codeBlock || codeBlock.type !== "code") return;

      let paragraphIndex = -1;
      for (let i = codeIndex - 1; i >= 0; i--) {
        if (blocks[i].type === "paragraph") {
          paragraphIndex = i;
          break;
        }
      }

      if (paragraphIndex === -1) return;

      const paragraphBlock = blocks[paragraphIndex];
      const richTextArray = paragraphBlock.paragraph?.rich_text || [];
      if (!Array.isArray(richTextArray) || richTextArray.length === 0) return;

      const combinedText = richTextArray
        .map((rt) => rt.text?.content || "")
        .join("");

      const colonIndex = combinedText.lastIndexOf(":");
      if (colonIndex === -1) return;

      const trailingText = combinedText.substring(colonIndex + 1);
      if (!trailingText || !trailingText.trim()) return;

      if (!/^\s*[A-Z0-9]/.test(trailingText)) {
        return;
      }

      const { before, after } = splitRichTextAtIndex(
        richTextArray,
        colonIndex + 1
      );

      if (!after || after.length === 0) return;

      trimTrailingWhitespaceRichText(before);
      trimLeadingWhitespaceRichText(after);

      if (before.length === 0 || after.length === 0) {
        return;
      }

      const afterTextCombined = after
        .map((rt) => rt.text?.content || "")
        .join("");
      if (!afterTextCombined.trim()) {
        return;
      }

      if (skipWhenTrailingHandled && afterTextCombined.trim().length === 0) {
        return;
      }

      paragraphBlock.paragraph.rich_text = before;

      const trailingParagraph = {
        object: "block",
        type: "paragraph",
        paragraph: {
          rich_text: after,
        },
      };

      const [extractedCodeBlock] = blocks.splice(codeIndex, 1);
      const insertionIndex = paragraphIndex + 1;
      blocks.splice(insertionIndex, 0, extractedCodeBlock);
      blocks.splice(insertionIndex + 1, 0, trailingParagraph);

      if (process.env.SN2N_DEBUG_SPLIT) {
        console.log(
          `helper-split context=${contextTag} paragraphIndex=${paragraphIndex} codeIndex=${codeIndex} colonIndex=${colonIndex} beforeLen=${before.length} afterLen=${after.length}`
        );
      }
      log(
        `🔧 Split paragraph to position code block correctly (context=${
          contextTag || "unknown"
        })`
      );
    };

    const createPlaceholderProcessor = (preElements) => {
      const splitRichTextByPlaceholder = (richTextArray, placeholder) => {
        const before = [];
        const after = [];
        let seenPlaceholder = false;

        richTextArray.forEach((rt) => {
          const textContent = rt.text?.content ?? "";
          if (!textContent.includes(placeholder)) {
            const target = seenPlaceholder ? after : before;
            if (textContent.trim().length > 0) {
              target.push({
                ...rt,
                text: { ...rt.text, content: textContent },
              });
            }
            return;
          }

          const parts = textContent.split(placeholder);
          parts.forEach((part, idx) => {
            if (part.trim().length === 0) {
              return;
            }
            const cloned = {
              ...rt,
              text: { ...rt.text, content: part },
            };
            if (!seenPlaceholder) {
              before.push(cloned);
            } else {
              after.push(cloned);
            }
            if (idx < parts.length - 1) {
              seenPlaceholder = true;
            }
          });

          if (parts.length > 1) {
            seenPlaceholder = true;
          }
        });

        if (after.length === 0 && before.length > 0) {
          const lastIdx = before.length - 1;
          const original = before[lastIdx];
          const textContent = original.text?.content ?? "";
          const colonIndex = textContent.lastIndexOf(":");

          if (colonIndex !== -1) {
            const trailingRaw = textContent.substring(colonIndex + 1);
            const trailingClean = trailingRaw.trim();
            const leadingClean = textContent
              .substring(0, colonIndex + 1)
              .replace(/\s+$/g, "");

            if (trailingClean.length > 0 && leadingClean.length > 0) {
              log(
                `   ➗ Splitting trailing colon text for placeholder positioning`
              );
              before[lastIdx] = {
                ...original,
                text: {
                  ...original.text,
                  content: leadingClean,
                },
              };
              after.unshift({
                ...original,
                text: {
                  ...original.text,
                  content: trailingClean,
                },
              });
            }
          }
        }

        return { before, after };
      };

      const checkAndReplacePlaceholder = (richTextArray) => {
        if (!richTextArray || richTextArray.length === 0) {
          return {
            replacement: null,
            codeBlockToAdd: null,
            trailingRichText: null,
          };
        }

        const allText = richTextArray
          .map((rt) => rt.text?.content || "")
          .join("");
        const placeholderMatch = allText.match(/___PRE_PLACEHOLDER_(\d+)___/);

        if (placeholderMatch) {
          log(`🔍 checkAndReplacePlaceholder: Found placeholder match`);
          log(`   allText: "${allText}"`);
          log(`   allText.trim(): "${allText.trim()}"`);
          log(`   placeholderMatch[0]: "${placeholderMatch[0]}"`);
          log(`   Equals check: ${allText.trim() === placeholderMatch[0]}`);
        }

        if (placeholderMatch && allText.trim() === placeholderMatch[0]) {
          const index = parseInt(placeholderMatch[1]);
          const preInfo = preElements[index];
          if (preInfo && preInfo.codeText && preInfo.codeText.length > 0) {
            log(
              `✅ Replacing placeholder ${index} with code block: ${preInfo.codeText.substring(
                0,
                50
              )}...`
            );
            return {
              replacement: {
                object: "block",
                type: "code",
                code: {
                  rich_text: [
                    { type: "text", text: { content: preInfo.codeText } },
                  ],
                  language: preInfo.language,
                },
              },
              codeBlockToAdd: null,
              trailingRichText: null,
            };
          }
        } else if (placeholderMatch) {
          const index = parseInt(placeholderMatch[1]);
          const preInfo = preElements[index];

          if (preInfo && preInfo.codeText && preInfo.codeText.length > 0) {
            log(
              `🔧 Removing placeholder ${index} from text and adding code block separately`
            );

            const { before, after } = splitRichTextByPlaceholder(
              richTextArray,
              placeholderMatch[0]
            );

            log(
              `   splitRichTextByPlaceholder before=${
                before.map((rt) => rt.text?.content).join(" | ") || "<empty>"
              }`
            );
            log(
              `   splitRichTextByPlaceholder after=${
                after.map((rt) => rt.text?.content).join(" | ") || "<empty>"
              }`
            );

            const codeBlock = {
              object: "block",
              type: "code",
              code: {
                rich_text: [
                  { type: "text", text: { content: preInfo.codeText } },
                ],
                language: preInfo.language,
              },
            };

            return {
              replacement: before.length > 0 ? before : null,
              codeBlockToAdd: codeBlock,
              trailingRichText: after.length > 0 ? after : null,
            };
          } else {
            log(
              `⚠️ Placeholder ${
                placeholderMatch[1]
              } mixed with text but no code found: ${allText.substring(0, 100)}`
            );
          }
        }

        return {
          replacement: null,
          codeBlockToAdd: null,
          trailingRichText: null,
        };
      };

      const processBlocksWithPlaceholders = (blocks) => {
        const processedBlocks = [];
        let blockIndex = 0;

        for (const block of blocks) {
          log(`🔍 Checking block ${blockIndex} type: ${block.type}`);

          if (block.type === "paragraph" && block.paragraph?.rich_text) {
            const allText = block.paragraph.rich_text
              .map((rt) => rt.text?.content || "")
              .join("");
            log(
              `🔍 Block ${blockIndex} paragraph contains: "${allText.substring(
                0,
                100
              )}"`
            );
            log(
              `🔍 Block ${blockIndex} rich_text array length: ${block.paragraph.rich_text.length}`
            );
            if (block.paragraph.rich_text.length > 0) {
              log(
                `🔍 Block ${blockIndex} first rich_text item: ${JSON.stringify(
                  block.paragraph.rich_text[0]
                ).substring(0, 200)}`
              );
            }
            const result = checkAndReplacePlaceholder(
              block.paragraph.rich_text
            );
            if (result.replacement) {
              if (
                Array.isArray(result.replacement) &&
                result.replacement.length > 0
              ) {
                log(
                  `   ✏️ Updating paragraph before placeholder: ${result.replacement
                    .map((rt) => rt.text?.content)
                    .join("")}`
                );
                block.paragraph.rich_text = result.replacement;
                processedBlocks.push(block);
              } else {
                processedBlocks.push(result.replacement);
                if (result.replacement.type === "code") {
                  maybeSplitParagraphForTrailingText(
                    processedBlocks,
                    "placeholder-direct",
                    {
                      skipWhenTrailingHandled:
                        Array.isArray(result.trailingRichText) &&
                        result.trailingRichText.length > 0,
                    }
                  );
                }
              }
              if (result.codeBlockToAdd) {
                log(
                  `   ➕ Adding code block after placeholder (language=${result.codeBlockToAdd.code.language})`
                );
                processedBlocks.push(result.codeBlockToAdd);
                maybeSplitParagraphForTrailingText(
                  processedBlocks,
                  "placeholder-replacement",
                  {
                    skipWhenTrailingHandled:
                      Array.isArray(result.trailingRichText) &&
                      result.trailingRichText.length > 0,
                  }
                );
              }
              if (
                Array.isArray(result.trailingRichText) &&
                result.trailingRichText.length > 0
              ) {
                log(
                  `   ➕ Adding trailing paragraph: ${result.trailingRichText
                    .map((rt) => rt.text?.content)
                    .join("")}`
                );
                processedBlocks.push({
                  object: "block",
                  type: "paragraph",
                  paragraph: { rich_text: result.trailingRichText },
                });
              }
            } else if (result.codeBlockToAdd) {
              log(`   ➕ Keeping original paragraph and inserting code block`);
              processedBlocks.push(block);
              processedBlocks.push(result.codeBlockToAdd);
              maybeSplitParagraphForTrailingText(
                processedBlocks,
                "placeholder-original",
                {
                  skipWhenTrailingHandled:
                    Array.isArray(result.trailingRichText) &&
                    result.trailingRichText.length > 0,
                }
              );
              if (
                Array.isArray(result.trailingRichText) &&
                result.trailingRichText.length > 0
              ) {
                log(
                  `   ➕ Adding trailing paragraph after preserved block: ${result.trailingRichText
                    .map((rt) => rt.text?.content)
                    .join("")}`
                );
                processedBlocks.push({
                  object: "block",
                  type: "paragraph",
                  paragraph: { rich_text: result.trailingRichText },
                });
              }
            } else {
              processedBlocks.push(block);
            }
          } else if (
            block.type === "bulleted_list_item" &&
            block.bulleted_list_item?.rich_text
          ) {
            const result = checkAndReplacePlaceholder(
              block.bulleted_list_item.rich_text
            );
            if (result.replacement && !result.codeBlockToAdd) {
              processedBlocks.push(result.replacement);
            } else if (result.replacement && result.codeBlockToAdd) {
              if (Array.isArray(result.replacement)) {
                block.bulleted_list_item.rich_text = result.replacement;
              } else {
                log(
                  `⚠️ Unexpected block replacement for list item, keeping original`
                );
              }
              processedBlocks.push(block);
              processedBlocks.push(result.codeBlockToAdd);
              maybeSplitParagraphForTrailingText(
                processedBlocks,
                "placeholder-list",
                {
                  skipWhenTrailingHandled: false,
                }
              );
            } else {
              if (block.bulleted_list_item.children) {
                const updatedChildren = [];
                for (const child of block.bulleted_list_item.children) {
                  if (
                    child.type === "paragraph" &&
                    child.paragraph?.rich_text
                  ) {
                    const childResult = checkAndReplacePlaceholder(
                      child.paragraph.rich_text
                    );
                    if (childResult.replacement) {
                      if (Array.isArray(childResult.replacement)) {
                        updatedChildren.push({
                          object: "block",
                          type: "paragraph",
                          paragraph: {
                            rich_text: childResult.replacement,
                          },
                        });
                      } else {
                        updatedChildren.push(childResult.replacement);
                      }
                      if (childResult.codeBlockToAdd) {
                        updatedChildren.push(childResult.codeBlockToAdd);
                      }
                    } else if (childResult.codeBlockToAdd) {
                      updatedChildren.push(child);
                      updatedChildren.push(childResult.codeBlockToAdd);
                    } else {
                      updatedChildren.push(child);
                    }
                  } else {
                    updatedChildren.push(child);
                  }
                }
                block.bulleted_list_item.children = updatedChildren;
              }
              processedBlocks.push(block);
            }
          } else if (
            block.type === "numbered_list_item" &&
            block.numbered_list_item?.rich_text
          ) {
            const result = checkAndReplacePlaceholder(
              block.numbered_list_item.rich_text
            );
            if (result.replacement && !result.codeBlockToAdd) {
              processedBlocks.push(result.replacement);
            } else if (result.replacement && result.codeBlockToAdd) {
              block.numbered_list_item.rich_text = result.replacement;
              processedBlocks.push(block);
              processedBlocks.push(result.codeBlockToAdd);
              maybeSplitParagraphForTrailingText(
                processedBlocks,
                "placeholder-numbered-list",
                {
                  skipWhenTrailingHandled: false,
                }
              );
            } else {
              if (block.numbered_list_item.children) {
                const updatedChildren = [];
                for (const child of block.numbered_list_item.children) {
                  if (
                    child.type === "paragraph" &&
                    child.paragraph?.rich_text
                  ) {
                    const childResult = checkAndReplacePlaceholder(
                      child.paragraph.rich_text
                    );
                    if (childResult.replacement) {
                      if (Array.isArray(childResult.replacement)) {
                        updatedChildren.push({
                          object: "block",
                          type: "paragraph",
                          paragraph: {
                            rich_text: childResult.replacement,
                          },
                        });
                      } else {
                        updatedChildren.push(childResult.replacement);
                      }
                      if (childResult.codeBlockToAdd) {
                        updatedChildren.push(childResult.codeBlockToAdd);
                      }
                    } else if (childResult.codeBlockToAdd) {
                      updatedChildren.push(child);
                      updatedChildren.push(childResult.codeBlockToAdd);
                    } else {
                      updatedChildren.push(child);
                    }
                  } else {
                    updatedChildren.push(child);
                  }
                }
                block.numbered_list_item.children = updatedChildren;
              }
              processedBlocks.push(block);
            }
          } else {
            processedBlocks.push(block);
          }

          blockIndex++;
        }

        return processedBlocks;
      };

      return { processBlocksWithPlaceholders };
    };

    // Match opening tags for block elements
    const blockTags = [
      "h1",
      "h2",
      "h3",
      "h4",
      "h5",
      "h6",
      "p",
      "div",
      "section",
      "article",
      "ul",
      "ol",
      "table",
      "header",
      "footer",
      "main",
      "pre",
      "blockquote",
      "aside",
      "details",
      "figure",
    ];
    const selfClosingTags = ["hr", "img", "iframe"];
    const allTags = [...blockTags, ...selfClosingTags];
    const tagPattern = [...allTags]
      .sort((a, b) => b.length - a.length)
      .join("|");

    const openingTagRegex = new RegExp(`<(${tagPattern})([^>]*)(/?)>`, "gi");
    let match;
    const matches = [];

    // Collect all top-level matches with proper nested tag handling
    while ((match = openingTagRegex.exec(htmlStr)) !== null) {
      const tag = match[1].toLowerCase();
      const attributes = match[2];
      const isSelfClosing = !!match[3] || selfClosingTags.includes(tag);
      const startPos = match.index;
      const afterOpenTag = openingTagRegex.lastIndex;

      // DEBUG: Log every tag match, especially pre tags
      if (tag === "pre") {
        log(`🔍 REGEX MATCHED: <${tag}> at position ${startPos}`);
        log(`   Attributes: ${attributes}`);
        log(`   After tag position: ${afterOpenTag}`);
        log(`   HTML snippet: ${htmlStr.substring(startPos, startPos + 150)}`);
      }

      if (isSelfClosing) {
        // Self-closing tag - no content
        matches.push({
          fullMatch: match[0],
          tag: tag,
          attributes: attributes,
          content: "",
          index: startPos,
          isSelfClosing: true,
        });
      } else {
        // Find the matching closing tag, accounting for nested tags
        const endPos = findMatchingClosingTag(htmlStr, afterOpenTag, tag);
        if (endPos > 0) {
          const content = htmlStr.substring(
            afterOpenTag,
            endPos - tag.length - 3
          ); // -3 for </>
          matches.push({
            fullMatch: htmlStr.substring(startPos, endPos),
            tag: tag,
            attributes: attributes,
            content: content,
            index: startPos,
            isSelfClosing: false,
          });
          // Skip past the closing tag
          openingTagRegex.lastIndex = endPos;
        } else if (tag === "pre") {
          // DEBUG: Log when pre tag doesn't have a closing tag
          log(`❌ DEBUG: Pre tag at position ${startPos} has no closing tag!`);
          const snippet = htmlStr.substring(startPos, startPos + 300);
          log(`   Snippet: ${snippet}`);
        }
      }
    }

    log(
      `📊 Found ${matches.length} matches in HTML (${htmlStr.substring(
        0,
        100
      )}...)`
    );

    // Log what tags were matched
    if (matches.length > 0) {
      const matchedTags = matches.map((m) => m.tag).join(", ");
      log(`   Matched tags: ${matchedTags}`);

      // DEBUG: Check specifically for pre tags
      const preCount = matches.filter((m) => m.tag === "pre").length;
      log(`🔍 DEBUG: Found ${preCount} <pre> tag(s) in matches`);
    }

    // Process matches and text between them
    let lastEndPos = 0;
    for (const m of matches) {
      // Extract any text before this match
      if (m.index > lastEndPos) {
        const textBetween = htmlStr.substring(lastEndPos, m.index);

        // DEBUG: Log textBetween for placeholder debugging
        if (
          textBetween.includes("___PRE_PLACEHOLDER_") ||
          (textBetween.trim() === "" && m.tag === "p")
        ) {
          log(
            `🔍 TEXT BETWEEN: "${textBetween.substring(0, 100)}" (${
              textBetween.length
            } chars) before <${m.tag}>`
          );
        }

        const result = await htmlToNotionRichText(textBetween);
        const richText = result.richText;

        // Split into multiple paragraphs if needed
        const textParagraphs = splitRichTextIntoParagraphs(richText);
        for (const paragraphRichText of textParagraphs) {
          if (
            paragraphRichText.length > 0 &&
            paragraphRichText[0].text.content.trim().length > 0
          ) {
            tempBlocks.push({
              object: "block",
              type: "paragraph",
              paragraph: {
                // Deep copy to prevent modifications to shared objects
                rich_text: paragraphRichText.map((rt) => ({
                  ...rt,
                  text: { ...rt.text },
                  annotations: normalizeAnnotations(rt.annotations),
                })),
              },
            });
          }
        }

        // Add any inline images after the paragraph
        if (result.inlineImages && result.inlineImages.length > 0) {
          tempBlocks.push(...result.inlineImages);
        }
      }

      const tag = m.tag.toLowerCase();
      const content = m.content;
      const isSelfClosing = m.isSelfClosing;
      const attributes = m.attributes || "";

      // Update lastEndPos to the end of this match
      lastEndPos = m.index + m.fullMatch.length;

      // Headers
      if (/^h[1-6]$/.test(tag)) {
        const level = parseInt(tag[1]);
        const result = await htmlToNotionRichText(content);
        const richText = result.richText;
        if (richText.length > 0 && richText[0].text.content.length > 0) {
          tempBlocks.push({
            object: "block",
            type: `heading_${Math.min(level, 3)}`,
            [`heading_${Math.min(level, 3)}`]: {
              rich_text: richText,
            },
          });
          // Add any inline images after the heading
          if (result.inlineImages && result.inlineImages.length > 0) {
            tempBlocks.push(...result.inlineImages);
          }
        }
      }
      // Paragraphs
      else if (tag === "p") {
        // DEBUG: Log if this is the placeholder paragraph
        if (content && content.includes("___PRE_PLACEHOLDER_")) {
          log(
            `🎯 Found placeholder in <p> tag! Content: "${content.substring(
              0,
              150
            )}"`
          );
        }

        // Check if paragraph has sectiontitle tasklabel class
        const classMatch = m.attributes.match(/class=["']([^"']*)["']/i);
        const hasSectionTitle =
          classMatch &&
          /sectiontitle.*tasklabel|tasklabel.*sectiontitle/.test(classMatch[1]);

        // Wrap content with bold markers if it's a section title
        const processedContent = hasSectionTitle
          ? `<b>${content}</b>`
          : content;

        const result = await htmlToNotionRichText(processedContent);
        const richText = result.richText;

        // Debug: Check total character length and annotations
        const totalLength = richText.reduce(
          (sum, rt) => sum + (rt.text?.content?.length || 0),
          0
        );
        const hasAnnotations = richText.some((rt) => {
          const ann = rt.annotations || {};
          return ann.bold || ann.italic || ann.code;
        });
        log(
          `🔍 Paragraph: ${richText.length} rich text items, ${totalLength} total chars, hasAnnotations=${hasAnnotations}`
        );
        if (richText.length > 0 && richText[0].text) {
          log(
            `   First item preview: "${richText[0].text.content.substring(
              0,
              100
            )}..."`
          );
          log(
            `   First item annotations:`,
            JSON.stringify(richText[0].annotations)
          );
        }

        // Split into multiple paragraphs if needed to respect 2000 char limit
        const textParagraphs = splitRichTextIntoParagraphs(richText);
        for (const paragraphRichText of textParagraphs) {
          // DEBUG: Log placeholder paragraph filtering
          const joinedContent = paragraphRichText
            .map((rt) => rt.text?.content || "")
            .join("");
          const hasPlaceholder = joinedContent.includes("___PRE_PLACEHOLDER_");
          const hasTextContent = paragraphRichText.some((rt) => {
            const textValue = rt.text?.content || "";
            if (textValue.includes("___PRE_PLACEHOLDER_")) return true;
            return textValue.trim().length > 0;
          });
          const previewText =
            paragraphRichText.find((rt) => {
              const textValue = rt.text?.content || "";
              return textValue.trim().length > 0;
            })?.text?.content ||
            (hasPlaceholder ? "___PRE_PLACEHOLDER___" : "");
          if (hasPlaceholder) {
            log(
              `🔍 Placeholder paragraph: length=${paragraphRichText.length}, preview="${previewText}", hasTextContent=${hasTextContent}`
            );
          }

          if (hasTextContent) {
            const copiedRichText = paragraphRichText.map((rt) => ({
              ...rt,
              text: { ...rt.text },
              annotations: normalizeAnnotations(rt.annotations),
            }));

            const joinedCopy = copiedRichText
              .map((rt) => rt.text?.content || "")
              .join("");
            const isRoleRequired = joinedCopy
              .replace(/^\s+/, "")
              .toLowerCase()
              .startsWith("role required:");

            let blockToPush;
            if (isRoleRequired) {
              // Surface role requirement as a default-colored callout (no emoji prefix)
              blockToPush = {
                object: "block",
                type: "callout",
                callout: {
                  rich_text: copiedRichText,
                },
              };
            } else {
              blockToPush = {
                object: "block",
                type: "paragraph",
                paragraph: {
                  rich_text: copiedRichText,
                },
              };
            }

            tempBlocks.push(blockToPush);

            if (hasPlaceholder && blockToPush.type === "paragraph") {
              log(
                `✅ Placeholder paragraph ADDED to tempBlocks at index ${
                  tempBlocks.length - 1
                }`
              );
              log(
                `   Pushed paragraph rich_text has ${blockToPush.paragraph.rich_text.length} items`
              );
              log(
                `   First item text.content: "${
                  blockToPush.paragraph.rich_text[0]?.text?.content ||
                  "UNDEFINED"
                }"`
              );
            }
          } else if (hasPlaceholder) {
            log(`❌ Placeholder paragraph SKIPPED (failed condition check)`);
          }
        }

        // Add any inline images (even if paragraph had no text)
        if (result.inlineImages && result.inlineImages.length > 0) {
          log(`✅ Adding ${result.inlineImages.length} inline images`);
          tempBlocks.push(...result.inlineImages);
        }
      }
      // Lists (with nested list support up to Notion's 2-level limit)
      else if (tag === "ul") {
        const listItems = await parseListItems(
          content,
          "bulleted_list_item",
          0
        );
        tempBlocks.push(...listItems);
      } else if (tag === "ol") {
        const listItems = await parseListItems(
          content,
          "numbered_list_item",
          0
        );
        tempBlocks.push(...listItems);
      }
      // Tables
      else if (tag === "table") {
        try {
          const tableBlocks = await parseTableToNotionBlock(content);
          if (tableBlocks && tableBlocks.length > 0) {
            tempBlocks.push(...tableBlocks);
          }
        } catch (tableError) {
          log("⚠️ Error parsing table:", tableError.message);
          // Fallback: treat as container with formatting
          const result = await htmlToNotionRichText(content);
          const richText = result.richText;
          if (
            richText.length > 0 &&
            richText[0].text.content.trim().length > 0
          ) {
            // Split text into chunks if it exceeds 2000 characters
            const textParagraphs = splitRichTextIntoParagraphs(richText);
            for (const paragraphRichText of textParagraphs) {
              tempBlocks.push({
                object: "block",
                type: "paragraph",
                paragraph: {
                  rich_text: paragraphRichText,
                },
              });
            }
          }
          // Add any inline images
          if (result.inlineImages && result.inlineImages.length > 0) {
            tempBlocks.push(...result.inlineImages);
          }
        }
      }
      // Code blocks
      else if (tag === "pre") {
        log(`🔍 Found pre element with attributes: ${attributes}`);
        const codeText = extractPreCodeText(content);
        log(
          `🔍 Pre element content length: ${content.length}, cleaned text length: ${codeText.length}`
        );
        log(`🔍 Pre element content sample: ${codeText.substring(0, 100)}`);
        if (codeText && codeText.length > 0) {
          // Try to detect language from class or data attribute
          let language = "";
          const classMatch = attributes.match(/class=["']([^"']*)["']/i);
          if (classMatch) {
            const classes = classMatch[1];
            log(`🔍 Pre element classes: ${classes}`);
            const languageClass = classes
              .split(/\s+/)
              .map((cls) => cls.trim())
              .find((cls) => cls.toLowerCase().startsWith("language-"));
            if (languageClass) {
              language = languageClass.substring("language-".length);
              log(`🔍 Detected language: ${language}`);
            }
          }

          if (!language) {
            const dataLanguageMatch = attributes.match(
              /data-language=["']([^"']+)["']/i
            );
            if (dataLanguageMatch) {
              language = dataLanguageMatch[1];
              log(`🔍 Detected data-language: ${language}`);
            }
          }

          const normalizedLanguage = normalizeCodeLanguage(language);

          log(`🔍 Creating code block with language: ${normalizedLanguage}`);
          tempBlocks.push({
            object: "block",
            type: "code",
            code: {
              rich_text: [{ type: "text", text: { content: codeText } }],
              language: normalizedLanguage,
            },
          });
          log(`✅ Code block added to blocks array`);
          if (process.env.SN2N_DEBUG_SPLIT) {
            console.log(
              `pre-tag helper before split: tempBlocks length=${tempBlocks.length}`
            );
          }
          maybeSplitParagraphForTrailingText(tempBlocks, "pre-tag");
        } else {
          log(`⚠️ Pre element had no valid text content`);
        }
      }
      // Quote blocks
      else if (tag === "blockquote") {
        const quoteText = cleanHtmlText(content);
        if (quoteText && quoteText.length > 0) {
          tempBlocks.push({
            object: "block",
            type: "quote",
            quote: {
              rich_text: [{ type: "text", text: { content: quoteText } }],
            },
          });
        }
      }
      // Image blocks
      else if (tag === "img") {
        log(
          `🔍 Processing img tag with attributes: ${m.attributes.substring(
            0,
            100
          )}`
        );
        const srcMatch = m.attributes.match(/src=["']([^"']*)["\']/i);
        const altMatch = m.attributes.match(/alt=["']([^"']*)["\']/i);

        if (srcMatch && srcMatch[1]) {
          let src = srcMatch[1];
          const alt = altMatch ? altMatch[1] : "";
          log(`🔍 Found src: ${src.substring(0, 80)}`);

          // Convert relative URLs to absolute
          src = convertServiceNowUrl(src);
          log(
            `🔍 After conversion: ${src.substring(
              0,
              80
            )}, isValid: ${isValidImageUrl(src)}`
          );

          if (src && isValidImageUrl(src)) {
            log(`🔍 About to create image block...`);
            const imageBlock = await createImageBlock(src, alt);
            log(
              `🔍 createImageBlock returned: ${
                imageBlock ? "block object" : "null"
              }`
            );
            if (imageBlock) {
              log(
                `✅ Image block created and added to tempBlocks (type: ${imageBlock.type})`
              );
              tempBlocks.push(imageBlock);
            } else {
              log(`❌ imageBlock was null!`);
            }
          } else {
            log(`❌ Image validation failed for: ${src}`);
          }
        } else {
          log(`❌ No src found in img tag`);
        }
      }
      // Divider blocks
      else if (tag === "hr") {
        tempBlocks.push({
          object: "block",
          type: "divider",
          divider: {},
        });
      }
      // Embed blocks (for iframes)
      else if (tag === "iframe") {
        const iframeMatch = m.attributes.match(/src=["']([^"']*)["\']/i);
        if (iframeMatch) {
          const src = iframeMatch[1];
          if (src && src.startsWith("http")) {
            // Only mark as video if it's from a known video platform
            if (isVideoIframeUrl(src)) {
              hasDetectedVideos = true;
            }
            tempBlocks.push({
              object: "block",
              type: "embed",
              embed: {
                url: src,
              },
            });
          }
        }
      }
      // Callout blocks (from aside elements)
      else if (tag === "aside") {
        const calloutText = cleanHtmlText(content);
        if (calloutText && calloutText.length > 0) {
          tempBlocks.push({
            object: "block",
            type: "callout",
            callout: {
              rich_text: [{ type: "text", text: { content: calloutText } }],
              icon: { type: "emoji", emoji: "💡" }, // Default icon
            },
          });
        }
      }
      // Toggle blocks (from details/summary)
      else if (tag === "details") {
        const summaryMatch = content.match(
          /<summary[^>]*>([\s\S]*?)<\/summary>/i
        );
        if (summaryMatch) {
          const summaryText = cleanHtmlText(summaryMatch[1]);
          const bodyContent = content.replace(
            /<summary[^>]*>[\s\S]*?<\/summary>/i,
            ""
          );
          const bodyText = cleanHtmlText(bodyContent);

          if (summaryText) {
            const toggleBlock = {
              object: "block",
              type: "toggle",
              toggle: {
                rich_text: [{ type: "text", text: { content: summaryText } }],
              },
            };

            // Add children if there's body content
            if (bodyText && bodyText.length > 0) {
              toggleBlock.toggle.children = [
                {
                  object: "block",
                  type: "paragraph",
                  paragraph: {
                    rich_text: [{ type: "text", text: { content: bodyText } }],
                  },
                },
              ];
            }

            tempBlocks.push(toggleBlock);
          }
        }
      }
      // Figure blocks (extract figcaption and image)
      else if (tag === "figure") {
        // Extract figcaption if present
        const figcaptionMatch = content.match(
          /<figcaption[^>]*>([\s\S]*?)<\/figcaption>/i
        );
        let captionText = "";
        if (figcaptionMatch) {
          captionText = cleanHtmlText(figcaptionMatch[1]);
        }

        // Add caption as a paragraph if present
        if (captionText && captionText.trim().length > 0) {
          tempBlocks.push({
            object: "block",
            type: "paragraph",
            paragraph: {
              rich_text: [
                {
                  type: "text",
                  text: { content: captionText },
                  annotations: normalizeAnnotations({ italic: true }),
                },
              ],
            },
          });
        }

        // Extract and process image
        const imgMatch = content.match(/<img[^>]*>/i);
        if (imgMatch) {
          const imgTag = imgMatch[0];
          const srcMatch = imgTag.match(/src=["']([^"']*)["']/i);
          const altMatch = imgTag.match(/alt=["']([^"']*)["']/i);

          if (srcMatch && srcMatch[1]) {
            let src = srcMatch[1];
            const alt = altMatch ? altMatch[1] : captionText; // Use caption as alt if no alt attribute
            src = convertServiceNowUrl(src);

            if (src && isValidImageUrl(src)) {
              const imageBlock = await createImageBlock(src, alt);
              if (imageBlock) {
                tempBlocks.push(imageBlock);
              }
            }
          }
        }
      }
      // Containers (div, section, article, header, footer, main) - extract nested paragraphs/text
      else if (
        ["div", "section", "article", "header", "footer", "main"].includes(tag)
      ) {
        log(
          `📦 Processing container: ${tag}, content length: ${
            content.length
          }, attributes: ${m.attributes.substring(0, 100)}`
        );
        // Check if this div has note/callout classes
        const classMatch = m.attributes.match(/class=["']([^"']*)["\']/i);
        const classes = classMatch ? classMatch[1].toLowerCase() : "";

        // Check for note-like classes (note, important, warning, tip, caution, info, related)
        const isNoteCallout =
          /\b(note|important|warning|tip|caution|info|related)\b/.test(classes);

        if (isNoteCallout) {
          let emoji = "📍";
          let color = "blue_background";

          if (/\b(important|warning|caution)\b/.test(classes)) {
            emoji = "⚠️";
            color = "green_background";
          } else if (/\btip\b/.test(classes)) {
            emoji = "💡";
            color = "yellow_background";
          } else if (/\binfo\b/.test(classes)) {
            emoji = "ℹ️";
            color = "blue_background";
          } else if (/\brelated\b/.test(classes)) {
            emoji = "🔗";
            color = "gray_background";
          }

          const preElements = [];
          const preRegex = /<pre([^>]*?)>([\s\S]*?)<\/pre>/gi;
          let preMatch;
          let modifiedContent = content;
          let preIndex = 0;

          while ((preMatch = preRegex.exec(content)) !== null) {
            const preAttributes = preMatch[1];
            const preContent = preMatch[2];
            const placeholder = `___PRE_PLACEHOLDER_${preIndex}___`;

            let language = "";
            const classMatchInner = preAttributes.match(
              /class=["']([^"']*)["']/i
            );
            if (classMatchInner) {
              const classesInner = classMatchInner[1]
                .split(/\s+/)
                .map((cls) => cls.trim())
                .filter(Boolean);
              const languageClass = classesInner.find((cls) =>
                cls.toLowerCase().startsWith("language-")
              );
              if (languageClass) {
                language = languageClass.substring("language-".length);
              }
            }

            if (!language) {
              const dataLanguageMatch = preAttributes.match(
                /data-language=["']([^"']+)["']/i
              );
              if (dataLanguageMatch) {
                language = dataLanguageMatch[1];
              }
            }

            const normalizedLanguage = normalizeCodeLanguage(language);
            const codeText = extractPreCodeText(preContent);

            preElements.push({
              placeholder,
              language: normalizedLanguage,
              codeText,
            });

            log(
              `🔧 (callout) Replacing <pre> with placeholder: ${placeholder}`
            );
            modifiedContent = modifiedContent.replace(preMatch[0], placeholder);
            preIndex++;
          }

          const { processBlocksWithPlaceholders } =
            createPlaceholderProcessor(preElements);

          const nestedBlocks = await extractBlocksFromHTML(
            preElements.length > 0 ? modifiedContent : content,
            preElements.length > 0
          );
          const processedBlocks = processBlocksWithPlaceholders(nestedBlocks);

          let calloutRichText = [];
          let calloutSourceParagraph = null;
          const calloutChildren = [];

          for (const block of processedBlocks) {
            if (
              calloutRichText.length === 0 &&
              block.type === "paragraph" &&
              block.paragraph?.rich_text &&
              block.paragraph.rich_text.length > 0
            ) {
              calloutRichText = sanitizeRichTextArray(
                block.paragraph.rich_text
              );
              calloutSourceParagraph = block;
              continue;
            }
            calloutChildren.push(block);
          }

          if (calloutRichText.length === 0) {
            const fallback = await htmlToNotionRichText(content);
            if (fallback.richText.length > 0) {
              calloutRichText = sanitizeRichTextArray(fallback.richText);
            } else {
              calloutRichText = [];
            }
          }

          calloutRichText = calloutRichText.filter(Boolean);

          if (calloutRichText.length === 0) {
            if (calloutSourceParagraph) {
              tempBlocks.push(calloutSourceParagraph);
            }
            if (calloutChildren.length > 0) {
              tempBlocks.push(...calloutChildren);
            }
            continue;
          }

          const calloutBlock = {
            object: "block",
            type: "callout",
            callout: {
              rich_text: calloutRichText,
              icon: { type: "emoji", emoji },
              color,
            },
          };

          tempBlocks.push(calloutBlock);

          if (calloutChildren.length > 0) {
            for (const child of calloutChildren) {
              if (
                child.type === "paragraph" &&
                Array.isArray(child.paragraph?.rich_text) &&
                child.paragraph.rich_text.length > 0
              ) {
                const childRichText = sanitizeRichTextArray(
                  child.paragraph.rich_text
                );
                if (childRichText.length > 0) {
                  tempBlocks.push({
                    object: "block",
                    type: "callout",
                    callout: {
                      rich_text: childRichText,
                      icon: { type: "emoji", emoji },
                      color,
                    },
                  });
                  continue;
                }
              }
              tempBlocks.push(child);
            }
          }
        } else {
          // Check if this container has pre elements that should be extracted as code blocks
          // Replace pre elements with placeholders, process the content, then add code blocks
          const preElements = [];
          const preRegex = /<pre([^>]*?)>([\s\S]*?)<\/pre>/gi;
          let preMatch;
          let modifiedContent = content;

          // Extract all pre elements and replace with unique placeholders
          let preIndex = 0;
          while ((preMatch = preRegex.exec(content)) !== null) {
            const preAttributes = preMatch[1];
            const preContent = preMatch[2];
            const placeholder = `___PRE_PLACEHOLDER_${preIndex}___`;

            // Store pre element info
            let language = "";
            const classMatch = preAttributes.match(/class=["']([^"']*)["']/i);
            if (classMatch) {
              const classes = classMatch[1]
                .split(/\s+/)
                .map((cls) => cls.trim())
                .filter(Boolean);
              const languageClass = classes.find((cls) =>
                cls.toLowerCase().startsWith("language-")
              );
              if (languageClass) {
                language = languageClass.substring("language-".length);
              }
            }

            if (!language) {
              const dataLanguageMatch = preAttributes.match(
                /data-language=["']([^"']+)["']/i
              );
              if (dataLanguageMatch) {
                language = dataLanguageMatch[1];
              }
            }

            const normalizedLanguage = normalizeCodeLanguage(language);

            const codeText = extractPreCodeText(preContent);
            preElements.push({
              placeholder,
              language: normalizedLanguage,
              codeText,
            });

            // Replace in content with raw placeholder so surrounding text stays intact
            log(`🔧 Replacing <pre> with placeholder: ${placeholder}`);
            log(`   Pre tag to replace: ${preMatch[0].substring(0, 100)}...`);
            modifiedContent = modifiedContent.replace(preMatch[0], placeholder);
            log(
              `   Modified content now contains placeholder: ${modifiedContent.includes(
                placeholder
              )}`
            );
            preIndex++;
          }

          if (preElements.length > 0) {
            log(
              `🔍 Found ${preElements.length} pre elements in ${tag} container, processing with placeholders`
            );

            // Process the modified content with placeholders
            // Skip placeholder cleanup in the recursive call - we'll replace them here
            const nestedBlocks = await extractBlocksFromHTML(
              modifiedContent,
              true
            );

            // DEBUG: Log blocks right after recursive call
            log(`📊 Recursive call returned ${nestedBlocks.length} blocks`);
            nestedBlocks.forEach((b, i) => {
              if (b.type === "paragraph" && b.paragraph?.rich_text) {
                const text = b.paragraph.rich_text
                  .map((rt) => rt.text?.content || "")
                  .join("");
                log(
                  `   Block ${i} (${b.type}): length=${
                    b.paragraph.rich_text.length
                  }, text="${text.substring(0, 50)}"`
                );
              } else {
                log(`   Block ${i} (${b.type})`);
              }
            });

            const { processBlocksWithPlaceholders } =
              createPlaceholderProcessor(preElements);
            const processedBlocks = processBlocksWithPlaceholders(nestedBlocks);
            tempBlocks.push(...processedBlocks);
          } else {
            // No pre elements, process normally
            log(
              `🔄 Making recursive call for ${tag} with content length ${content.length}`
            );
            log(`   Content preview: ${content.substring(0, 200)}...`);

            // Debug: Check for block tags in content
            const hasBlockTags =
              /<(p|div|section|article|ul|ol|h[1-6]|table|pre|blockquote)[>\s]/i.test(
                content
              );
            log(`   Has block tags in content: ${hasBlockTags}`);
            if (hasBlockTags) {
              // Show which tags are present
              const foundTags = [];
              const tagMatches = content.matchAll(
                /<(p|div|section|article|ul|ol|h[1-6]|table|pre|blockquote)[>\s]/gi
              );
              for (const m of tagMatches) {
                if (!foundTags.includes(m[1].toLowerCase())) {
                  foundTags.push(m[1].toLowerCase());
                }
              }
              log(`   Found block tags: ${foundTags.join(", ")}`);
            }

            const nestedBlocks = await extractBlocksFromHTML(
              content,
              skipPlaceholderCleanup
            );
            if (nestedBlocks.length > 0) {
              log(
                `🔄 Recursive call returned ${
                  nestedBlocks.length
                } blocks: ${nestedBlocks.map((b) => b.type).join(", ")}`
              );

              // Debug: Check if paragraphs have formatting
              nestedBlocks.forEach((block, idx) => {
                if (block.type === "paragraph" && block.paragraph?.rich_text) {
                  const hasAnnotations = block.paragraph.rich_text.some(
                    (rt) => {
                      const ann = rt.annotations || {};
                      return ann.bold || ann.italic || ann.code;
                    }
                  );
                  const preview =
                    block.paragraph.rich_text[0]?.text?.content?.substring(
                      0,
                      80
                    ) || "";
                  log(
                    `   Block ${idx} (paragraph): hasAnnotations=${hasAnnotations}, preview="${preview}..."`
                  );

                  // Show detailed annotation info for first few items
                  if (hasAnnotations && block.paragraph.rich_text.length <= 5) {
                    log(
                      `   Full rich_text structure:`,
                      JSON.stringify(block.paragraph.rich_text, null, 2)
                    );
                  }
                }
              });

              tempBlocks.push(...nestedBlocks);
            } else {
              // Extract text with formatting from container if no blocks found
              const result = await htmlToNotionRichText(content);
              const richText = result.richText;
              if (
                richText.length > 0 &&
                richText[0].text.content.trim().length > 0
              ) {
                // Split text into chunks if it exceeds 2000 characters
                const textParagraphs = splitRichTextIntoParagraphs(richText);
                for (const paragraphRichText of textParagraphs) {
                  tempBlocks.push({
                    object: "block",
                    type: "paragraph",
                    paragraph: {
                      rich_text: paragraphRichText,
                    },
                  });
                }
              }
              // Add any inline images
              if (result.inlineImages && result.inlineImages.length > 0) {
                tempBlocks.push(...result.inlineImages);
              }
            }
          }
        }
      }
    }

    // Handle any remaining text after the last match
    if (matches.length > 0 && lastEndPos < htmlStr.length) {
      const textAfter = htmlStr.substring(lastEndPos);

      log(
        `📝 Checking remaining text (${
          textAfter.length
        } chars): ${textAfter.substring(0, 200)}...`
      );

      // Check if remaining text contains block-level elements
      const hasBlockElements =
        /<(p|div|section|article|ul|ol|h[1-6]|table|pre|blockquote)[>\s]/i.test(
          textAfter
        );

      if (!hasBlockElements && textAfter.includes("<table")) {
        log(
          `⚠️ WARNING: textAfter contains '<table' but regex didn't match! Looking for table tags...`
        );
        const tableMatches = textAfter.match(/<table[^>]*>/gi);
        if (tableMatches) {
          log(`   Found table tags: ${tableMatches.join(", ")}`);
        }
      }

      if (hasBlockElements) {
        // Recursively process remaining text to extract blocks
        log(`📝 Processing remaining text recursively (has block elements)...`);
        const remainingBlocks = await extractBlocksFromHTML(
          textAfter,
          skipPlaceholderCleanup
        );
        tempBlocks.push(...remainingBlocks);
      } else {
        // No block elements, treat as inline text with formatting
        log(`📝 Processing remaining text as inline (no block elements)...`);
        const result = await htmlToNotionRichText(textAfter);
        const richText = result.richText;

        // Split into multiple paragraphs if needed
        const textParagraphs = splitRichTextIntoParagraphs(richText);
        for (const paragraphRichText of textParagraphs) {
          if (
            paragraphRichText.length > 0 &&
            paragraphRichText[0].text.content.trim().length > 0
          ) {
            tempBlocks.push({
              object: "block",
              type: "paragraph",
              paragraph: {
                rich_text: paragraphRichText,
              },
            });
          }
        }

        // Add any inline images after the paragraph
        if (result.inlineImages && result.inlineImages.length > 0) {
          tempBlocks.push(...result.inlineImages);
        }
      }
    }

    // Final cleanup: Remove any remaining placeholders from all text content
    // Skip this cleanup if we're processing content with placeholders (they'll be replaced by the parent)
    if (!skipPlaceholderCleanup) {
      for (const block of tempBlocks) {
        if (block.type === "paragraph" && block.paragraph?.rich_text) {
          block.paragraph.rich_text = block.paragraph.rich_text
            .map((rt) => ({
              ...rt,
              text: {
                ...rt.text,
                content:
                  rt.text?.content?.replace(/___PRE_PLACEHOLDER_\d+___/g, "") ||
                  "",
              },
            }))
            .filter((rt) => rt.text?.content); // Remove empty text items
        } else if (
          block.type === "bulleted_list_item" &&
          block.bulleted_list_item?.rich_text
        ) {
          block.bulleted_list_item.rich_text =
            block.bulleted_list_item.rich_text
              .map((rt) => ({
                ...rt,
                text: {
                  ...rt.text,
                  content:
                    rt.text?.content?.replace(
                      /___PRE_PLACEHOLDER_\d+___/g,
                      ""
                    ) || "",
                },
              }))
              .filter((rt) => rt.text?.content);
        } else if (
          block.type === "numbered_list_item" &&
          block.numbered_list_item?.rich_text
        ) {
          block.numbered_list_item.rich_text =
            block.numbered_list_item.rich_text
              .map((rt) => ({
                ...rt,
                text: {
                  ...rt.text,
                  content:
                    rt.text?.content?.replace(
                      /___PRE_PLACEHOLDER_\d+___/g,
                      ""
                    ) || "",
                },
              }))
              .filter((rt) => rt.text?.content);
        }

        // Also clean children of list items
        if (
          (block.type === "bulleted_list_item" ||
            block.type === "numbered_list_item") &&
          block[block.type]?.children
        ) {
          for (const child of block[block.type].children) {
            if (child.type === "paragraph" && child.paragraph?.rich_text) {
              child.paragraph.rich_text = child.paragraph.rich_text
                .map((rt) => ({
                  ...rt,
                  text: {
                    ...rt.text,
                    content:
                      rt.text?.content?.replace(
                        /___PRE_PLACEHOLDER_\d+___/g,
                        ""
                      ) || "",
                  },
                }))
                .filter((rt) => rt.text?.content);
            }
          }
        }
      }
    }

    // DEBUG: Log tempBlocks before returning
    if (skipPlaceholderCleanup) {
      log(
        `🔍 DEBUG: About to return ${tempBlocks.length} blocks (skipPlaceholderCleanup=${skipPlaceholderCleanup})`
      );
      tempBlocks.forEach((b, i) => {
        if (b.type === "paragraph" && b.paragraph?.rich_text) {
          const text = b.paragraph.rich_text
            .map((rt) => rt.text?.content || "")
            .join("");
          if (text.includes("___PRE_PLACEHOLDER") || text === "") {
            log(
              `   BEFORE RETURN Block ${i} (${b.type}): length=${
                b.paragraph.rich_text.length
              }, text="${text.substring(0, 80)}"`
            );
          }
        }
      });
    }

    return tempBlocks;
  }

  const extractedBlocks = await extractBlocksFromHTML(html);
  const validatedExtractedBlocks = sanitizeBlocks(extractedBlocks, "extracted");
  blocks.push(...validatedExtractedBlocks);

  // If no blocks extracted, try text extraction with formatting as last resort
  if (blocks.length === 0) {
    log("⚠️ No blocks extracted, using text extraction with formatting");
    const result = await htmlToNotionRichText(html);
    const richText = result.richText;
    if (richText.length > 0 && richText[0].text.content.trim().length > 0) {
      // Split text into chunks if it exceeds 2000 characters
      const textParagraphs = splitRichTextIntoParagraphs(richText);
      for (const paragraphRichText of textParagraphs) {
        blocks.push({
          object: "block",
          type: "paragraph",
          paragraph: {
            rich_text: paragraphRichText,
          },
        });
      }
    }
    // Add any inline images
    if (result.inlineImages && result.inlineImages.length > 0) {
      blocks.push(...result.inlineImages);
    }
  }

  log(`✅ Extracted ${blocks.length} blocks from HTML`);

  // Debug: Check for oversized paragraphs
  blocks.forEach((block, index) => {
    if (block.type === "paragraph" && block.paragraph?.rich_text) {
      const totalLength = block.paragraph.rich_text.reduce(
        (sum, rt) => sum + (rt.text?.content?.length || 0),
        0
      );
      if (totalLength > 2000) {
        log(
          `⚠️ WARNING: Block ${index} (paragraph) has ${totalLength} characters, exceeds 2000 limit!`
        );
        log(
          `   Content preview: ${block.paragraph.rich_text[0]?.text?.content?.substring(
            0,
            100
          )}...`
        );
      }
    }
  });

  // Log video detection status
  if (hasDetectedVideos) {
    log(`🎥 Detected video content in HTML`);
  }

  const listSafeBlocks = flattenListUnsupportedBlocks(blocks);
  const finalBlocks = sanitizeBlocks(listSafeBlocks, "final");
  return { blocks: finalBlocks, hasVideos: hasDetectedVideos };
}

// Remove a marker token from a rich_text array even if it is split across elements.
// Returns a new sanitized rich_text array (does not mutate input).
function removeMarkerFromRichTextArray(richArray, marker) {
  if (!Array.isArray(richArray)) return [];
  const token = `(sn2n:${marker})`;

  // Local clone helper (don't rely on cloneRichText being in scope)
  function _clone(rt) {
    if (!rt || typeof rt !== "object") return null;
    const cloned = { ...rt };
    cloned.annotations = rt.annotations ? { ...rt.annotations } : {};
    if (rt.text && typeof rt.text === "object") cloned.text = { ...rt.text };
    if (typeof cloned.plain_text !== "string" && cloned.text?.content) {
      cloned.plain_text = cloned.text.content;
    }
    return cloned;
  }

  // Quick path: if any single element equals the token, drop it.
  const anyExact = richArray.some(
    (rt) => rt?.text?.content && rt.text.content.trim() === token
  );
  if (anyExact) {
    return richArray
      .filter((rt) => !(rt?.text?.content && rt.text.content.trim() === token))
      .map(_clone)
      .filter(Boolean);
  }

  // Otherwise we need to scan concatenated content and remove the token across boundaries while preserving annotations.
  // Build list of contents and track element boundaries.
  const parts = richArray.map((rt, idx) => ({
    idx,
    text: rt?.text?.content || "",
    raw: rt,
  }));
  const concat = parts.map((p) => p.text).join("");
  const pos = concat.indexOf(token);
  if (pos === -1) {
    // Nothing to remove; return sanitized clones using local _clone
    return richArray
      .map(_clone)
      .filter(
        (rt) =>
          rt &&
          rt.text &&
          typeof rt.text.content === "string" &&
          (rt.text.content.trim().length > 0 || !!rt.text.link)
      );
  }

  // Remove token by reconstructing the rich_text sequence with the token removed.
  const before = concat.slice(0, pos);
  const after = concat.slice(pos + token.length);

  // Re-slice into new rich_text pieces: keep existing annotations where possible by taking whole source elements
  // but trim leading/trailing content as needed.
  const newArray = [];
  let cursor = 0;
  for (const p of parts) {
    const len = p.text.length;
    const segStart = cursor;
    const segEnd = cursor + len;
    cursor = segEnd;

    // Determine portion of this element that remains (relative to concat)
    const keepParts = [];
    if (segEnd <= pos || segStart >= pos + token.length) {
      // Entire element is outside token range — keep whole element
      newArray.push(_clone(p.raw));
      continue;
    }

    // Element overlaps token — keep head and/or tail portions
    const headLen = Math.max(0, Math.min(len, Math.max(0, pos - segStart)));
    const tailLen = Math.max(
      0,
      Math.min(len, Math.max(0, segEnd - (pos + token.length)))
    );

    if (headLen > 0) {
      const headText = p.text.slice(0, headLen);
      const clone = _clone(p.raw);
      clone.text = { ...clone.text, content: headText };
      newArray.push(clone);
    }
    if (tailLen > 0) {
      const tailText = p.text.slice(len - tailLen);
      const clone = _clone(p.raw);
      clone.text = { ...clone.text, content: tailText };
      newArray.push(clone);
    }
  }

  // Finally sanitize and return using local rules (avoid external clone dependency)
  return newArray
    .map((rt) => _clone(rt))
    .filter(
      (rt) =>
        rt &&
        rt.text &&
        typeof rt.text.content === "string" &&
        (rt.text.content.trim().length > 0 || !!rt.text.link)
    );
}

// Helper function to clean HTML text
function cleanHtmlText(html) {
  if (!html) return "";

  // Remove HTML tags
  let text = html.replace(/<[^>]*>/g, " ");

  // Decode HTML entities (both named and numeric)
  text = text
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&nbsp;/g, " ")
    .replace(/&#xa0;/gi, " ") // Non-breaking space (hex)
    .replace(/&#160;/g, " ") // Non-breaking space (decimal)
    .replace(/&#(\d+);/g, (match, dec) => String.fromCharCode(dec)) // All decimal entities
    .replace(/&#x([0-9a-f]+);/gi, (match, hex) =>
      String.fromCharCode(parseInt(hex, 16))
    ); // All hex entities

  // Clean up whitespace
  text = text.replace(/\s+/g, " ").trim();

  return text;
}

// Helper function to validate URLs for Notion links
function isValidNotionUrl(url) {
  if (!url || typeof url !== "string") return false;

  // Trim whitespace
  url = url.trim();

  // Reject empty or whitespace-only URLs
  if (url.length === 0) return false;

  // Reject fragment-only URLs
  if (url.startsWith("#")) return false;

  // Reject javascript: protocol
  if (url.toLowerCase().startsWith("javascript:")) return false;

  // Notion API does NOT accept relative URLs - they must be absolute
  // Reject any URL that starts with / as it should have been converted by convertServiceNowUrl
  if (url.startsWith("/")) {
    return false;
  }

  try {
    const parsedUrl = new URL(url);

    // Only allow http and https protocols
    if (!["http:", "https:"].includes(parsedUrl.protocol)) {
      return false;
    }

    // Basic validation - URL should have a hostname
    if (!parsedUrl.hostname) {
      return false;
    }

    return true;
  } catch (e) {
    // Invalid URL format
    return false;
  }
}

// Helper function to convert ServiceNow relative URLs to absolute URLs
function convertServiceNowUrl(url) {
  if (!url || typeof url !== "string") return url;

  // Convert ServiceNow documentation relative URLs to absolute
  if (url.startsWith("/")) {
    // Convert any relative URL starting with / to absolute ServiceNow URL
    return "https://www.servicenow.com" + url;
  }

  return url;
}

// Helper function to create image blocks
async function createImageBlock(src, alt = "") {
  if (!src || !isValidImageUrl(src)) return null;

  // ServiceNow images require authentication, so they MUST be downloaded and uploaded
  // External URLs won't work for ServiceNow images outside the authenticated session
  const isServiceNowImage =
    src.includes("servicenow.com") || src.includes("servicenow-be-prod");

  // Always try to download and upload images to Notion
  try {
    log(`🖼️ Downloading and uploading image: ${src.substring(0, 80)}...`);
    const uploadId = await downloadAndUploadImage(src, alt || "image");

    if (uploadId) {
      // Successfully uploaded - use file reference
      log(`✅ Image uploaded successfully with ID: ${uploadId}`);
      return {
        object: "block",
        type: "image",
        image: {
          type: "file_upload",
          file_upload: {
            id: uploadId,
          },
          caption: alt ? [{ type: "text", text: { content: alt } }] : [],
        },
      };
    } else {
      // Upload failed
      if (isServiceNowImage) {
        // ServiceNow images REQUIRE upload - don't fallback to external
        log(
          `❌ ServiceNow image upload failed - cannot use external URL (requires auth)`
        );
        return null;
      } else {
        // Non-ServiceNow images can fallback to external URL
        log(`⚠️ Image upload failed, using external URL as fallback`);
        return {
          object: "block",
          type: "image",
          image: {
            type: "external",
            external: { url: src },
            caption: alt ? [{ type: "text", text: { content: alt } }] : [],
          },
        };
      }
    }
  } catch (error) {
    log(`❌ Error processing image ${src}: ${error.message}`);
    if (isServiceNowImage) {
      // ServiceNow images REQUIRE upload - don't fallback to external
      log(
        `❌ ServiceNow image error - cannot use external URL (requires auth)`
      );
      return null;
    } else {
      // Non-ServiceNow images can fallback to external URL
      return {
        object: "block",
        type: "image",
        image: {
          type: "external",
          external: { url: src },
          caption: alt ? [{ type: "text", text: { content: alt } }] : [],
        },
      };
    }
  }
}

// Helper function to convert HTML to Notion rich text format
async function htmlToNotionRichText(html) {
  // Debug: Check if input contains placeholder
  if (html && html.includes("___PRE_PLACEHOLDER_")) {
    log(
      `🔍 htmlToNotionRichText received placeholder: "${html.substring(
        0,
        150
      )}"`
    );
  }

  if (!html)
    return {
      richText: [{ type: "text", text: { content: "" } }],
      inlineImages: [],
    };

  const richText = [];
  const inlineImages = [];
  let text = html;

  // Extract and process img tags, converting them to inline images
  const imgRegex = /<img[^>]*>/gi;
  let imgMatch;

  while ((imgMatch = imgRegex.exec(text)) !== null) {
    const imgTag = imgMatch[0];
    const srcMatch = imgTag.match(/src=["']([^"']*)["']/i);
    const altMatch = imgTag.match(/alt=["']([^"']*)["']/i);

    if (srcMatch && srcMatch[1]) {
      let src = srcMatch[1];
      const alt = altMatch && altMatch[1] ? altMatch[1] : "";

      // Convert relative URLs to absolute
      src = convertServiceNowUrl(src);

      if (src && isValidImageUrl(src)) {
        // Create an inline image block
        const imageBlock = await createImageBlock(src, alt);
        if (imageBlock) {
          inlineImages.push(imageBlock);
        }
      }
    }

    // Remove the img tag from text
    text = text.replace(imgTag, "");
  }

  // First, handle bold/strong tags by replacing with markers
  text = text.replace(
    /<(b|strong)([^>]*)>([\s\S]*?)<\/\1>/gi,
    (match, tag, attrs, content) => {
      return `__BOLD_START__${content}__BOLD_END__`;
    }
  );

  // Handle italic/em tags
  text = text.replace(
    /<(i|em)([^>]*)>([\s\S]*?)<\/\1>/gi,
    (match, tag, attrs, content) => {
      return `__ITALIC_START__${content}__ITALIC_END__`;
    }
  );

  // Handle inline code tags
  text = text.replace(
    /<code([^>]*)>([\s\S]*?)<\/code>/gi,
    (match, attrs, content) => {
      return `__CODE_START__${content}__CODE_END__`;
    }
  );

  // Handle spans with technical identifier classes (ph, keyword, parmname, codeph, etc.) as inline code
  text = text.replace(
    /<span[^>]*class=["'][^"']*(?:\bph\b|\bkeyword\b|\bparmname\b|\bcodeph\b)[^"']*["'][^>]*>([\s\S]*?)<\/span>/gi,
    (match, content) => {
      const cleanedContent = cleanHtmlText(content);
      if (!cleanedContent || !cleanedContent.trim()) return match;

      const technicalTokenRegex =
        /[A-Za-z0-9][A-Za-z0-9._-]*[._][A-Za-z0-9._-]*/g;
      const strictTechnicalTokenRegex =
        /[A-Za-z0-9][A-Za-z0-9._-]*[._][A-Za-z0-9._-]+/g;

      let replaced = cleanedContent;

      replaced = replaced.replace(strictTechnicalTokenRegex, (token) => {
        const bareToken = token.trim();

        if (!bareToken) {
          return token;
        }

        // Skip uppercase acronyms without lowercase characters after removing separators
        const bareAlphaNumeric = bareToken.replace(/[._-]/g, "");
        if (bareAlphaNumeric && /^[A-Z0-9]+$/.test(bareAlphaNumeric)) {
          return token;
        }

        return `__CODE_START__${bareToken}__CODE_END__`;
      });

      if (replaced !== cleanedContent) {
        return replaced;
      }

      return match;
    }
  );

  // Remove surrounding parentheses/brackets around inline code markers
  text = text.replace(
    /([\(\[])(\s*(?:__CODE_START__[\s\S]*?__CODE_END__\s*)+)([\)\]])/g,
    (match, open, codes, close) => {
      const codeRegex = /__CODE_START__([\s\S]*?)__CODE_END__/g;
      let codeMatch;
      let shouldStrip = true;

      while ((codeMatch = codeRegex.exec(codes)) !== null) {
        const codeContent = codeMatch[1].trim();
        if (
          !codeContent ||
          !/^[A-Za-z0-9._-]+$/.test(codeContent) ||
          !/[._]/.test(codeContent)
        ) {
          shouldStrip = false;
          break;
        }
      }

      if (!shouldStrip) {
        return match;
      }

      return codes.trim();
    }
  );

  // Handle raw technical identifiers in parentheses/brackets as inline code (after removing wrappers above)
  text = text.replace(
    /([\(\[])[ \t\n\r]*([^\s()[\]]*[_.][^\s()[\]]*)[ \t\n\r]*([\)\]])/g,
    (match, open, code, close) => {
      return `__CODE_START__${code.trim()}__CODE_END__`;
    }
  );

  // Handle span with uicontrol class as bold + blue
  text = text.replace(
    /<span[^>]*class=["'][^"']*uicontrol[^"']*["'][^>]*>([\s\S]*?)<\/span>/gi,
    (match, content) => {
      return `__BOLD_BLUE_START__${content}__BOLD_BLUE_END__`;
    }
  );

  // Handle p/span with sectiontitle tasklabel class as bold
  text = text.replace(
    /<(p|span)[^>]*class=["'][^"']*sectiontitle[^"']*tasklabel[^"']*["'][^>]*>([\s\S]*?)<\/\1>/gi,
    (match, tag, content) => {
      return `__BOLD_START__${content}__BOLD_END__`;
    }
  );

  // Add soft return between </a> and <p class="shortdesc">
  text = text.replace(
    /(<\/a>)(\s*)(<p[^>]*class=["'][^"']*shortdesc[^"']*["'][^>]*>)/gi,
    (match, closingA, whitespace, openingP) => {
      return `${closingA}__SOFT_BREAK__${openingP}`;
    }
  );

  // Add soft return between closing span/a tags and <div class="itemgroup info">
  text = text.replace(
    /(<\/(span|a)>)(\s*)(<div[^>]*class=["'][^"']*itemgroup[^"']*info[^"']*["'][^>]*>)/gi,
    (match, closingTag, tagName, whitespace, openingDiv) => {
      return `${closingTag}__SOFT_BREAK__${openingDiv}`;
    }
  );

  // Handle links - extract before cleaning HTML
  const links = [];
  text = text.replace(
    /<a[^>]*href=["']([^"']*)["'][^>]*>([\s\S]*?)<\/a>/gi,
    (match, href, content) => {
      const linkIndex = links.length;
      links.push({ href, content: cleanHtmlText(content) });
      return `__LINK_${linkIndex}__`;
    }
  );

  // Now split by markers and build rich text
  const parts = text.split(
    /(__BOLD_START__|__BOLD_END__|__BOLD_BLUE_START__|__BOLD_BLUE_END__|__ITALIC_START__|__ITALIC_END__|__CODE_START__|__CODE_END__|__LINK_\d+__|__SOFT_BREAK__)/
  );

  // DEBUG: Log if placeholder in parts
  if (text.includes("___PRE_PLACEHOLDER_")) {
    log(`🔍 After split, parts array has ${parts.length} elements`);
    log(`🔍 Parts: ${JSON.stringify(parts)}`);
  }

  let currentAnnotations = {
    bold: false,
    italic: false,
    strikethrough: false,
    underline: false,
    code: false,
    color: "default",
  };

  for (const part of parts) {
    if (part === "__BOLD_START__") {
      currentAnnotations.bold = true;
    } else if (part === "__BOLD_END__") {
      currentAnnotations.bold = false;
    } else if (part === "__BOLD_BLUE_START__") {
      currentAnnotations.bold = true;
      currentAnnotations.color = "blue";
    } else if (part === "__BOLD_BLUE_END__") {
      currentAnnotations.bold = false;
      currentAnnotations.color = "default";
    } else if (part === "__ITALIC_START__") {
      currentAnnotations.italic = true;
    } else if (part === "__ITALIC_END__") {
      currentAnnotations.italic = false;
    } else if (part === "__CODE_START__") {
      currentAnnotations._colorBeforeCode = currentAnnotations.color;
      currentAnnotations.code = true;
      currentAnnotations.color = "red";
    } else if (part === "__CODE_END__") {
      currentAnnotations.code = false;
      if (currentAnnotations._colorBeforeCode !== undefined) {
        currentAnnotations.color = currentAnnotations._colorBeforeCode;
        delete currentAnnotations._colorBeforeCode;
      } else {
        currentAnnotations.color = "default";
      }
    } else if (part === "__SOFT_BREAK__") {
      // Add a soft line break
      richText.push({
        type: "text",
        text: { content: "\n" },
        annotations: normalizeAnnotations(currentAnnotations),
      });
    } else if (part.match(/^__LINK_(\d+)__$/)) {
      const linkMatch = part.match(/^__LINK_(\d+)__$/);
      const linkIndex = parseInt(linkMatch[1]);
      const linkInfo = links[linkIndex];
      if (linkInfo && linkInfo.content.trim()) {
        let url = convertServiceNowUrl(linkInfo.href);
        if (url && isValidNotionUrl(url)) {
          richText.push({
            type: "text",
            text: { content: linkInfo.content.trim(), link: { url } },
            annotations: normalizeAnnotations(currentAnnotations),
          });
        } else {
          richText.push({
            type: "text",
            text: { content: linkInfo.content.trim() },
            annotations: normalizeAnnotations(currentAnnotations),
          });
        }
      }
    } else if (part) {
      // Regular text
      const cleanedText = cleanHtmlText(part);

      // DEBUG: Log placeholder processing
      if (part.includes("___PRE_PLACEHOLDER_")) {
        log(`🔍 Processing placeholder part: "${part}"`);
        log(`🔍 After cleanHtmlText: "${cleanedText}"`);
        log(`🔍 cleanedText.trim(): "${cleanedText.trim()}"`);
      }

      if (cleanedText.trim()) {
        richText.push({
          type: "text",
          text: { content: cleanedText },
          annotations: normalizeAnnotations(currentAnnotations),
        });
      }
    }
  }

  // If no rich text was created, fall back to simple processing
  if (richText.length === 0) {
    const cleanedText = cleanHtmlText(text);
    if (cleanedText.trim()) {
      richText.push({
        type: "text",
        text: { content: cleanedText },
        annotations: normalizeAnnotations({}),
      });
    }
  }

  // DEBUG: Log final richText for placeholder
  if (html && html.includes("___PRE_PLACEHOLDER_")) {
    log(`🔍 Final richText array length: ${richText.length}`);
    if (richText.length > 0) {
      log(`🔍 First richText item: ${JSON.stringify(richText[0])}`);
    }
  }

  // Ensure proper spacing between rich text elements
  for (let i = 0; i < richText.length - 1; i++) {
    const current = richText[i];
    const next = richText[i + 1];

    // If current text doesn't end with space and next text doesn't start with space
    if (
      current.text.content &&
      next.text.content &&
      !current.text.content.endsWith(" ") &&
      !next.text.content.startsWith(" ")
    ) {
      // Add space to the end of current text
      current.text.content += " ";
    }
  }

  return { richText, inlineImages };
}

// Helper function to clean text while preserving newlines
function cleanTextPreserveNewlines(html, preserveLeadingTrailing = false) {
  if (!html) return "";

  // Remove HTML tags
  let text = html.replace(/<[^>]*>/g, " ");

  // Decode HTML entities
  text = text
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&nbsp;/g, " ");

  // Clean up whitespace on each line, but preserve newlines
  if (preserveLeadingTrailing) {
    // Preserve leading/trailing whitespace on each line, just collapse multiple spaces
    text = text
      .split("\n")
      .map((line) => line.replace(/ {2,}/g, " "))
      .join("\n");
  } else {
    // Normal mode: trim each line
    text = text
      .split("\n")
      .map((line) => line.replace(/\s+/g, " ").trim())
      .join("\n")
      .trim();
  }

  return text;
}

function extractPreCodeText(preContent) {
  if (!preContent) return "";
  let codeHtml = preContent.trim();
  if (/^<code[^>]*>/i.test(codeHtml) && /<\/code>$/i.test(codeHtml)) {
    codeHtml = codeHtml.replace(/^<code[^>]*>/i, "").replace(/<\/code>$/i, "");
  }
  return cleanTextPreserveNewlines(codeHtml, true);
}

// Helper function to convert HTML to rich text while preserving newlines
async function htmlToNotionRichTextPreserveNewlines(html) {
  if (!html)
    return {
      richText: [{ type: "text", text: { content: "" } }],
      inlineImages: [],
    };

  const richText = [];
  const inlineImages = [];
  let text = html;

  // Extract and process img tags, converting them to inline images
  const imgRegex = /<img[^>]*>/gi;
  let imgMatch;

  while ((imgMatch = imgRegex.exec(text)) !== null) {
    const imgTag = imgMatch[0];
    const srcMatch = imgTag.match(/src=["']([^"']*)["']/i);
    const altMatch = imgTag.match(/alt=["']([^"']*)["']/i);

    if (srcMatch && srcMatch[1]) {
      let src = srcMatch[1];
      const alt = altMatch && altMatch[1] ? altMatch[1] : "";

      // Convert relative URLs to absolute
      src = convertServiceNowUrl(src);

      if (src && isValidImageUrl(src)) {
        // Create an inline image block
        const imageBlock = await createImageBlock(src, alt);
        if (imageBlock) {
          inlineImages.push(imageBlock);
        }
      }
    }

    // Remove the img tag from text
    text = text.replace(imgTag, "");
  }

  // Handle links specially - support both single and double quotes
  const linkRegex = /<a[^>]*href=(["'])([^"']*)\1[^>]*>([\s\S]*?)<\/a>/gi;
  let lastIndex = 0;
  let match;

  while ((match = linkRegex.exec(text)) !== null) {
    // Add text before the link
    if (match.index > lastIndex) {
      const beforeText = text.substring(lastIndex, match.index);
      const cleanedBefore = cleanTextPreserveNewlines(beforeText, true);
      if (cleanedBefore) {
        richText.push({
          type: "text",
          text: { content: cleanedBefore },
        });
      }
    }

    // Add the link (only if URL is valid)
    const linkText = cleanTextPreserveNewlines(match[3]);
    let linkUrl = match[2];

    // Convert ServiceNow relative URLs to absolute URLs
    linkUrl = convertServiceNowUrl(linkUrl);

    if (linkText.trim()) {
      if (linkUrl && isValidNotionUrl(linkUrl)) {
        richText.push({
          type: "text",
          text: { content: linkText.trim(), link: { url: linkUrl } },
        });
      } else {
        // Invalid URL - just add as plain text
        richText.push({
          type: "text",
          text: { content: linkText.trim() },
        });
      }
    }

    lastIndex = linkRegex.lastIndex;
  }

  // Add remaining text after last link
  if (lastIndex < text.length) {
    const remainingText = text.substring(lastIndex);
    const cleanedRemaining = cleanTextPreserveNewlines(remainingText, true);
    if (cleanedRemaining) {
      richText.push({
        type: "text",
        text: { content: cleanedRemaining },
      });
    }
  }

  // If no rich text was created, add the cleaned text
  if (richText.length === 0) {
    const cleanedText = cleanTextPreserveNewlines(text);
    if (cleanedText.trim()) {
      richText.push({
        type: "text",
        text: { content: cleanedText },
      });
    }
  }

  return { richText, inlineImages };
}

// Helper function to process table cell content with proper list formatting and hyperlink preservation
async function processTableCellContent(html) {
  if (!html) return [{ type: "text", text: { content: "" } }];

  // Check if this cell contains images - replace them with bullet placeholders
  const hasImages = /<img[^>]*>/i.test(html);
  if (hasImages) {
    log(`🖼️ Table cell contains image(s), replacing with bullet placeholder`);
    // Replace each image with a bullet symbol placeholder
    html = html.replace(/<img[^>]*>/gi, " • ");
    log(`📝 After image replacement: ${html.substring(0, 100)}...`);
  }

  // Check if this cell contains lists
  const hasLists = /<[uo]l[^>]*>/i.test(html);

  if (hasLists) {
    // Handle lists specially - preserve line breaks between items
    let processedHtml = html;

    // Remove opening ul/ol tags
    processedHtml = processedHtml.replace(/<\/?[uo]l[^>]*>/gi, "");

    // Replace list items with bullets and newlines
    processedHtml = processedHtml.replace(/<li[^>]*>/gi, "\n• ");

    // Remove closing </li> tags
    processedHtml = processedHtml.replace(/<\/li>/gi, "");

    // Normalize newlines - replace multiple consecutive newlines with single newline
    processedHtml = processedHtml.replace(/\n\s*\n/g, "\n");

    // Remove all leading whitespace and newlines (from whitespace before list and first list item)
    processedHtml = processedHtml.replace(/^\s+/, "");

    // Also remove trailing whitespace
    processedHtml = processedHtml.replace(/\s+$/, "");

    // Use the newline-preserving version to maintain both links and line breaks
    return (await htmlToNotionRichTextPreserveNewlines(processedHtml)).richText;
  } else {
    // Use regular htmlToNotionRichText for non-list content
    return (await htmlToNotionRichText(html)).richText;
  }
}

// Helper function to parse HTML table to Notion table block
async function parseTableToNotionBlock(tableHtml) {
  const blocks = [];

  // Log the raw table HTML to see if images are present
  log(`🔍 Processing table (${tableHtml.length} chars)`);
  log(`🔍 Raw table HTML (first 500 chars): ${tableHtml.substring(0, 500)}...`);
  const hasImagesInTable = /<img[^>]*>/i.test(tableHtml);
  log(`🖼️ Table contains images: ${hasImagesInTable}`);

  // Remove table dropdown/filter elements
  let cleanedTableHtml = tableHtml.replace(
    /<div[^>]*class="[^"]*zDocsFilterTableDiv[^"]*"[^>]*>[\s\S]*?<\/div>/gi,
    ""
  );

  // Remove smartTable dropdown elements and their containers
  cleanedTableHtml = cleanedTableHtml.replace(
    /<div[^>]*class="[^"]*smartTable[^"]*"[^>]*>[\s\S]*?<\/div>/gi,
    ""
  );

  // Replace any remaining img tags with bullet symbols before processing cells
  // This handles cases where images are in the HTML
  if (hasImagesInTable) {
    log(
      `🔄 Replacing ${
        (cleanedTableHtml.match(/<img[^>]*>/gi) || []).length
      } images with bullet symbols`
    );
    cleanedTableHtml = cleanedTableHtml.replace(/<img[^>]*>/gi, " • ");
  } // Extract table caption if present
  const captionRegex = /<caption[^>]*>([\s\S]*?)<\/caption>/i;
  const captionMatch = cleanedTableHtml.match(captionRegex);
  if (captionMatch) {
    let captionContent = captionMatch[1];
    // Remove table title labels (span.table--title-label)
    captionContent = captionContent.replace(
      /<span[^>]*class="[^"]*table--title-label[^"]*"[^>]*>[\s\S]*?<\/span>/gi,
      ""
    );
    const captionText = cleanHtmlText(captionContent);
    if (captionText) {
      blocks.push({
        object: "block",
        type: "heading_3",
        heading_3: {
          rich_text: [{ type: "text", text: { content: captionText } }],
        },
      });
    }
  }

  // Extract thead and tbody sections separately
  const theadRegex = /<thead[^>]*>([\s\S]*?)<\/thead>/gi;
  const tbodyRegex = /<tbody[^>]*>([\s\S]*?)<\/tbody>/gi;

  const theadMatch = theadRegex.exec(cleanedTableHtml);
  const tbodyMatch = tbodyRegex.exec(cleanedTableHtml);

  // Extract table rows from thead
  const theadRows = [];
  if (theadMatch) {
    const theadContent = theadMatch[1];
    const rowRegex = /<tr[^>]*>([\s\S]*?)<\/tr>/gi;
    let rowMatch;

    while ((rowMatch = rowRegex.exec(theadContent)) !== null) {
      const rowContent = rowMatch[1];
      const cellRegex = /<t[dh][^>]*>([\s\S]*?)<\/t[dh]>/gi;
      const cells = [];
      let cellMatch;

      while ((cellMatch = cellRegex.exec(rowContent)) !== null) {
        const cellContent = cellMatch[1];
        log(
          `📋 Processing thead cell content (${
            cellContent.length
          } chars): ${cellContent.substring(0, 150)}...`
        );
        const cellRichText = await processTableCellContent(cellContent);
        cells.push(cellRichText);
      }

      if (cells.length > 0) {
        theadRows.push(cells);
      }
    }
  }

  // Extract table rows from tbody and check for images
  const tbodyRows = [];
  const tbodyRawRows = []; // Keep raw HTML for detecting images
  if (tbodyMatch) {
    const tbodyContent = tbodyMatch[1];
    const rowRegex = /<tr[^>]*>([\s\S]*?)<\/tr>/gi;
    let rowMatch;

    while ((rowMatch = rowRegex.exec(tbodyContent)) !== null) {
      const rowContent = rowMatch[1];
      tbodyRawRows.push(rowContent); // Store raw HTML before processing

      const cellRegex = /<t[dh][^>]*>([\s\S]*?)<\/t[dh]>/gi;
      const cells = [];
      let cellMatch;

      while ((cellMatch = cellRegex.exec(rowContent)) !== null) {
        const cellContent = cellMatch[1];
        log(
          `📋 Processing tbody cell content (${
            cellContent.length
          } chars): ${cellContent.substring(0, 150)}...`
        );
        const cellRichText = await processTableCellContent(cellContent);
        cells.push(cellRichText);
      }

      if (cells.length > 0) {
        tbodyRows.push(cells);
      }
    }
  }

  // If no thead/tbody structure, fall back to processing all <tr> elements
  let rows = [];
  let firstBodyRowHasImages = false;

  if (theadRows.length > 0 || tbodyRows.length > 0) {
    // Table has thead/tbody structure
    rows = [...theadRows, ...tbodyRows];

    // Check if first tbody row contains images
    if (tbodyRawRows.length > 0) {
      firstBodyRowHasImages = /<img[^>]*>/i.test(tbodyRawRows[0]);
    }
  } else {
    // No thead/tbody - process all rows as before
    const rowRegex = /<tr[^>]*>([\s\S]*?)<\/tr>/gi;
    const rawRows = [];
    let rowMatch;

    while ((rowMatch = rowRegex.exec(cleanedTableHtml)) !== null) {
      const rowContent = rowMatch[1];
      rawRows.push(rowContent);

      const cellRegex = /<t[dh][^>]*>([\s\S]*?)<\/t[dh]>/gi;
      const cells = [];
      let cellMatch;

      while ((cellMatch = cellRegex.exec(rowContent)) !== null) {
        const cellRichText = await processTableCellContent(cellMatch[1]);
        cells.push(cellRichText);
      }

      if (cells.length > 0) {
        rows.push(cells);
      }
    }

    // For tables without thead/tbody, check first row
    if (rawRows.length > 0) {
      firstBodyRowHasImages = /<img[^>]*>/i.test(rawRows[0]);
    }
  }

  if (rows.length === 0) {
    log(`⚠️ Table skipped: no valid rows found in table HTML`);
    log(`   theadRows: ${theadRows.length}, tbodyRows: ${tbodyRows.length}`);
    return blocks.length > 0 ? blocks : null;
  }

  const tableWidth = Math.max(...rows.map((row) => row.length));
  log(`📊 Table structure: ${rows.length} rows, max width: ${tableWidth}`);

  // Determine table structure
  // If first body row has images, don't treat it as a header row
  const hasHeaders = theadRows.length > 0 && !firstBodyRowHasImages;

  // Skip tables with no columns
  if (tableWidth === 0) {
    log(`⚠️ Table skipped: no columns found (tableWidth = 0)`);
    log(`   Table HTML sample: ${cleanedTableHtml.substring(0, 300)}...`);
    return null;
  }

  // Create Notion table block
  const tableBlock = {
    object: "block",
    type: "table",
    table: {
      table_width: tableWidth,
      has_column_header: hasHeaders,
      has_row_header: false, // Could be enhanced to detect row headers
      children: [],
    },
  };

  log(
    `✅ Created Notion table: ${tableWidth} columns, ${rows.length} rows, headers: ${hasHeaders}`
  );

  // Add table rows
  rows.forEach((row, rowIndex) => {
    const tableRow = {
      object: "block",
      type: "table_row",
      table_row: {
        cells: [],
      },
    };

    // Ensure all rows have the same number of cells
    for (let i = 0; i < tableWidth; i++) {
      const cellRichText = row[i] || [{ type: "text", text: { content: "" } }];
      tableRow.table_row.cells.push(cellRichText);
    }

    tableBlock.table.children.push(tableRow);
  });

  blocks.push(tableBlock);
  return blocks;
}

app.post("/api/W2N", async (req, res) => {
  try {
    const payload = req.body;
    log("📝 Processing W2N request for:", payload.title);

    // DEBUG: Check if HTML contains pre tags at the API entry point
    if (payload.contentHtml) {
      const hasPreTags = payload.contentHtml.includes("<pre");
      const hasClosingPreTags = payload.contentHtml.includes("</pre>");
      log(
        `🔍 DEBUG API: contentHtml has <pre>: ${hasPreTags}, has </pre>: ${hasClosingPreTags}`
      );
      if (hasPreTags) {
        const preIndex = payload.contentHtml.indexOf("<pre");
        const preSnippet = payload.contentHtml.substring(
          preIndex,
          preIndex + 200
        );
        log(`🔍 DEBUG API: Pre tag snippet: ${preSnippet}`);
      }
    }

    if (!payload.title || (!payload.content && !payload.contentHtml)) {
      return sendError(
        res,
        "MISSING_FIELDS",
        "Missing required fields: title and (content or contentHtml)",
        null,
        400
      );
    }

    if (!payload.databaseId) {
      // Allow a dry-run mode for testing conversions without creating a Notion page
      if (payload.dryRun) {
        // Create children blocks from content so the caller can inspect conversion
        let children = [];
        let hasVideos = false;
        if (payload.contentHtml) {
          log("🔄 (dryRun) Converting HTML content to Notion blocks");
          const result = await htmlToNotionBlocks(payload.contentHtml);
          children = result.blocks;
          hasVideos = result.hasVideos;
          log(`✅ (dryRun) Converted HTML to ${children.length} Notion blocks`);
          if (hasVideos) {
            log(`🎥 (dryRun) Video content detected`);
          }
        } else if (payload.content) {
          children = [
            {
              object: "block",
              type: "paragraph",
              paragraph: {
                rich_text: [
                  { type: "text", text: { content: payload.content } },
                ],
              },
            },
          ];
        }
        return sendSuccess(res, { dryRun: true, children, hasVideos });
      }

      return sendError(
        res,
        "MISSING_DATABASE_ID",
        "Missing databaseId",
        null,
        400
      );
    }

    if (!ensureFileUploadAvailable()) {
      return sendError(
        res,
        "NOTION_NOT_AVAILABLE",
        "Notion API not available (NOTION_TOKEN missing)",
        null,
        500
      );
    }

    // Create page properties
    const properties = {};

    // Set title property
    properties["Name"] = {
      title: [{ text: { content: String(payload.title || "") } }],
    };

    // Set URL if provided
    if (payload.url) {
      properties["URL"] = {
        url: payload.url,
      };
    }

    // Merge properties from payload (from userscript property mappings)
    if (payload.properties) {
      log("🔍 Received properties from userscript:");
      log(JSON.stringify(payload.properties, null, 2));
      Object.assign(properties, payload.properties);
      log("🔍 Properties after merge:");
      log(JSON.stringify(properties, null, 2));
    } else {
      log("⚠️ No properties received from userscript");
    }

    // Create children blocks from content
    let children = [];
    let hasVideos = false;

    // Prefer HTML content with conversion to Notion blocks
    if (payload.contentHtml) {
      log("🔄 Converting HTML content to Notion blocks");
      const result = await htmlToNotionBlocks(payload.contentHtml);
      children = result.blocks;
      hasVideos = result.hasVideos;
      log(`✅ Converted HTML to ${children.length} Notion blocks`);
      if (hasVideos) {
        log(`🎥 Video content detected - will set hasVideos property`);
      }
    } else if (payload.content) {
      log("📝 Using plain text content");
      children = [
        {
          object: "block",
          type: "paragraph",
          paragraph: {
            rich_text: [{ type: "text", text: { content: payload.content } }],
          },
        },
      ];
    }

    // Note: Video detection is handled by userscript's property mappings
    // The server detects videos during HTML conversion and logs it,
    // but the userscript is responsible for setting the appropriate property
    // based on its property mappings configuration
    if (hasVideos) {
      log("🎥 Videos detected in content during HTML conversion");
    }

    // Collect any in-memory markers that were attached to trailing blocks
    // These will be used by the orchestrator after the page is created
    const markerMap = collectAndStripMarkers(children, {});
    // Remove collected trailing blocks from the main children list so we don't
    // create duplicates on the page root. They'll be appended later by the
    // orchestrator to their intended parents.
    const removedCount = removeCollectedBlocks(children);
    if (removedCount > 0) {
      log(
        `🔖 Removed ${removedCount} collected trailing block(s) from initial children`
      );
    }
    if (Object.keys(markerMap).length > 0) {
      log(
        `🔖 Found ${
          Object.keys(markerMap).length
        } marker(s) to orchestrate after create`
      );
    }

    // Before creating the page, strip any internal helper keys from blocks
    deepStripPrivateKeys(children);

    // Create the page (handling Notion's 100-block limit)
    log("🔍 Creating Notion page with:");
    log(`   Database ID: ${payload.databaseId}`);
    log(`   Properties: ${JSON.stringify(properties, null, 2)}`);
    log(`   Children blocks: ${children.length}`);

    try {
      const dumpDir = path.join(__dirname, "logs");
      if (!fs.existsSync(dumpDir)) {
        fs.mkdirSync(dumpDir, { recursive: true });
      }
      const dumpPayload = {
        ts: new Date().toISOString(),
        databaseId: payload.databaseId,
        propertyKeys: Object.keys(properties || {}),
        blockCount: children.length,
        blockTypes: children.map((block) => block.type),
        meta: { hasVideos },
        sample: children.slice(0, 20),
      };
      const dumpName = `notion-payload-${dumpPayload.ts
        .replace(/:/g, "-")
        .replace(/\./g, "-")}.json`;
      fs.writeFileSync(
        path.join(dumpDir, dumpName),
        JSON.stringify(dumpPayload, null, 2)
      );
    } catch (err) {
      log(
        "⚠️ Failed to write notion payload dump:",
        err && err.message ? err.message : err
      );
    }

    // Split children into chunks of 100 (Notion's limit per request)
    const MAX_BLOCKS_PER_REQUEST = 100;
    const initialBlocks = children.slice(0, MAX_BLOCKS_PER_REQUEST);
    const remainingBlocks = children.slice(MAX_BLOCKS_PER_REQUEST);

    log(
      `   Initial blocks: ${initialBlocks.length}, Remaining blocks: ${remainingBlocks.length}`
    );

    // Log block types for debugging
    const blockTypes = children.map((b) => b.type).join(", ");
    log(`   Block types: ${blockTypes}`);

    if (getExtraDebug()) {
      children.slice(0, 5).forEach((child, idx) => {
        try {
          log(
            `   🔬 Child ${idx} structure: ${JSON.stringify(child, null, 2)}`
          );
        } catch (serializationError) {
          log(
            `   ⚠️ Failed to serialize child ${idx} for debug: ${serializationError.message}`
          );
        }
      });
    }

    // Debug: Show the actual children structure being sent to Notion
    children.forEach((child, idx) => {
      if (child.type === "paragraph") {
        const richText = child.paragraph?.rich_text || [];
        const hasAnnotations = richText.some((rt) => {
          const ann = rt.annotations || {};
          return ann.bold || ann.italic || ann.code;
        });
        const preview = richText[0]?.text?.content?.substring(0, 60) || "";
        log(
          `   Child ${idx} (paragraph): hasAnnotations=${hasAnnotations}, preview="${preview}..."`
        );

        // Show sample rich text item if it has annotations
        if (hasAnnotations && richText.length > 0) {
          log(
            `   Sample rich_text item:`,
            JSON.stringify(richText.slice(0, 2), null, 2)
          );
        }
      }
    });

    // Create the page with initial blocks
    const response = await notion.pages.create({
      parent: { database_id: payload.databaseId },
      properties: properties,
      icon: {
        type: "external",
        external: {
          url: "https://raw.githubusercontent.com/Christie-Norton-McIntosh/ServiceNow-2-Notion/main/ServiceNow-2-Notion/src/img/ServiceNow%20icon.png",
        },
      },
      cover: {
        type: "external",
        external: {
          url: "https://raw.githubusercontent.com/Christie-Norton-McIntosh/ServiceNow-2-Notion/main/ServiceNow-2-Notion/src/img/ServiceNow%20cover.png",
        },
      },
      children: initialBlocks,
    });

    log("✅ Page created successfully:", response.id);

    // Append remaining blocks in chunks if any
    if (remainingBlocks.length > 0) {
      log(
        `📝 Appending ${remainingBlocks.length} remaining blocks in chunks...`
      );

      // Split remaining blocks into chunks of 100
      const chunks = [];
      for (let i = 0; i < remainingBlocks.length; i += MAX_BLOCKS_PER_REQUEST) {
        chunks.push(remainingBlocks.slice(i, i + MAX_BLOCKS_PER_REQUEST));
      }

      log(
        `   Split into ${chunks.length} chunks of up to ${MAX_BLOCKS_PER_REQUEST} blocks each`
      );

      // Append each chunk
      for (let i = 0; i < chunks.length; i++) {
        const chunk = chunks[i];
        log(
          `   Appending chunk ${i + 1}/${chunks.length} (${
            chunk.length
          } blocks)...`
        );

        // Ensure no private keys in chunk
        deepStripPrivateKeys(chunk);
        await notion.blocks.children.append({
          block_id: response.id,
          children: chunk,
        });

        log(`   ✅ Chunk ${i + 1} appended successfully`);
      }

      log(
        `✅ All ${remainingBlocks.length} remaining blocks appended successfully`
      );
    }

    // After initial page creation and appending remaining blocks, run the orchestrator
    try {
      if (markerMap && Object.keys(markerMap).length > 0) {
        log("🔧 Running deep-nesting orchestrator...");
        const orch = await orchestrateDeepNesting(response.id, markerMap);
        log("🔧 Orchestrator result:", orch);
      }
    } catch (e) {
      log("⚠️ Orchestrator failed:", e && e.message);
    }

    log("🔗 Page URL:", response.url);

    return sendSuccess(res, {
      pageUrl: response.url,
      page: {
        id: response.id,
        url: response.url,
        title: payload.title,
      },
    });
  } catch (error) {
    log("❌ Error creating Notion page:", error.message);
    if (error && error.body) {
      try {
        const parsed =
          typeof error.body === "string" ? JSON.parse(error.body) : error.body;
        log("❌ Notion error body:", JSON.stringify(parsed, null, 2));
      } catch (parseErr) {
        log("❌ Failed to parse Notion error body:", parseErr.message);
        log("❌ Raw error body:", error.body);
      }
    }
    return sendError(res, "PAGE_CREATION_FAILED", error.message, null, 500);
  }
});

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
      err.message || "internal error",
      null,
      500
    );
  }
});

// Append blocks helper: appends children to a given block id using Notion API with chunking and retries
async function appendBlocksToBlockId(blockId, blocks, opts = {}) {
  if (!notion) throw new Error("Notion client not initialized");
  if (!blockId) throw new Error("Missing blockId");
  if (!Array.isArray(blocks) || blocks.length === 0) return { appended: 0 };

  const MAX = opts.maxPerRequest || 100;
  const chunks = [];
  for (let i = 0; i < blocks.length; i += MAX) {
    chunks.push(blocks.slice(i, i + MAX));
  }

  let appended = 0;
  for (let i = 0; i < chunks.length; i++) {
    const chunk = chunks[i];
    let attempts = 0;
    const maxAttempts = opts.maxAttempts || 3;
    while (attempts < maxAttempts) {
      attempts++;
      try {
        // Ensure private helper keys are removed from the chunk before sending
        deepStripPrivateKeys(chunk);
        await notion.blocks.children.append({
          block_id: blockId,
          children: chunk,
        });
        appended += chunk.length;
        break;
      } catch (err) {
        log(
          `⚠️ appendBlocksToBlockId chunk ${i + 1}/${
            chunks.length
          } failed (attempt ${attempts}): ${err.message}`
        );
        if (attempts >= maxAttempts) throw err;
        // small backoff
        await new Promise((r) => setTimeout(r, 250 * attempts));
      }
    }
  }

  return { appended };
}

// Top-level marker/orchestrator helpers (make available outside htmlToNotionBlocks)
function generateMarker() {
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

function collectAndStripMarkers(blocks, map = {}) {
  if (!Array.isArray(blocks)) return map;
  for (const b of blocks) {
    if (b && typeof b === "object") {
      if (b._sn2n_marker) {
        const m = String(b._sn2n_marker);
        if (!map[m]) map[m] = [];
        map[m].push(b);
        // mark this block as collected so we can remove it from the
        // top-level children before sending to Notion (avoids duplicates)
        b._sn2n_collected = true;
        delete b._sn2n_marker;
      }
      const type = b.type;
      if (type && b[type] && Array.isArray(b[type].children)) {
        collectAndStripMarkers(b[type].children, map);
      }
      if (Array.isArray(b.children)) {
        collectAndStripMarkers(b.children, map);
      }
    }
  }
  return map;
}

// Remove collected blocks (marked by _sn2n_collected) from an array of blocks
function removeCollectedBlocks(blocks) {
  if (!Array.isArray(blocks)) return 0;
  let removed = 0;
  for (let i = blocks.length - 1; i >= 0; i--) {
    const b = blocks[i];
    if (!b || typeof b !== "object") continue;
    if (b._sn2n_collected) {
      blocks.splice(i, 1);
      removed++;
      continue;
    }
    // Recurse into typed children areas if present
    const type = b.type;
    if (type && b[type] && Array.isArray(b[type].children)) {
      removed += removeCollectedBlocks(b[type].children);
    }
    if (Array.isArray(b.children)) {
      removed += removeCollectedBlocks(b.children);
    }
  }
  return removed;
}

// Deep-strip internal helper keys (any key starting with _sn2n_)
function deepStripPrivateKeys(blocks) {
  if (!Array.isArray(blocks)) return;
  for (const b of blocks) {
    if (!b || typeof b !== "object") continue;
    for (const k of Object.keys(b)) {
      if (k.startsWith("_sn2n_")) delete b[k];
    }
    const type = b.type;
    if (type && b[type] && Array.isArray(b[type].children)) {
      deepStripPrivateKeys(b[type].children);
    }
    if (Array.isArray(b.children)) deepStripPrivateKeys(b.children);
  }
}

async function findParentListItemByMarker(rootBlockId, marker) {
  if (!notion) throw new Error("Notion client not initialized");
  const token = `sn2n:${marker}`;

  async function listChildren(blockId, cursor) {
    const res = await notion.blocks.children.list({
      block_id: blockId,
      page_size: 100,
      start_cursor: cursor,
    });
    return res;
  }

  const queue = [rootBlockId];
  const visited = new Set();

  while (queue.length > 0) {
    const current = queue.shift();
    if (visited.has(current)) continue;
    visited.add(current);

    let cursor = undefined;
    do {
      const res = await listChildren(current, cursor);
      cursor = res.has_more ? res.next_cursor : undefined;
      const children = res.results || [];
      for (const child of children) {
        try {
          if (
            child.type === "numbered_list_item" ||
            child.type === "bulleted_list_item"
          ) {
            // First, check the list-item's own rich_text for the token
            try {
              const ownPayload = child[child.type] || {};
              const ownRich = Array.isArray(ownPayload.rich_text)
                ? ownPayload.rich_text
                : [];
              const ownPlain = ownRich
                .map((rt) => rt?.text?.content || "")
                .join(" ");
              if (ownPlain.includes(token)) {
                return { parentId: child.id, paragraphId: null };
              }
            } catch (e) {
              // ignore and continue
            }

            if (child.has_children) {
              let cCursor = undefined;
              do {
                const childList = await notion.blocks.children.list({
                  block_id: child.id,
                  page_size: 100,
                  start_cursor: cCursor,
                });
                cCursor = childList.has_more
                  ? childList.next_cursor
                  : undefined;
                const subChildren = childList.results || [];
                for (const sc of subChildren) {
                  try {
                    const scPayload = sc[sc.type] || sc.paragraph || {};
                    const r = Array.isArray(scPayload.rich_text)
                      ? scPayload.rich_text
                      : [];
                    const plain = r
                      .map((rt) => rt?.text?.content || "")
                      .join(" ");
                    if (plain.includes(token)) {
                      // return both the parent list-item id and the matching child id
                      return { parentId: child.id, paragraphId: sc.id };
                    }
                  } catch (e) {
                    // continue on errors for individual children
                  }
                }
              } while (cCursor);
            }
          }

          if (child.has_children) queue.push(child.id);
        } catch (err) {
          log("⚠️ findParentListItemByMarker inner error:", err && err.message);
        }
      }
    } while (cursor);
  }

  return null;
}

async function orchestrateDeepNesting(pageId, markerMap) {
  if (!markerMap || Object.keys(markerMap).length === 0) return { appended: 0 };
  let totalAppended = 0;
  for (const marker of Object.keys(markerMap)) {
    const blocksToAppend = markerMap[marker] || [];
    if (blocksToAppend.length === 0) continue;
    try {
      log(`🔄 Orchestrator: locating parent for marker sn2n:${marker}`);
      const parentInfo = await findParentListItemByMarker(pageId, marker);
      const parentId = parentInfo ? parentInfo.parentId : null;
      const paragraphId = parentInfo ? parentInfo.paragraphId : null;
      if (!parentId) {
        log(
          `⚠️ Orchestrator: parent not found for marker sn2n:${marker}. Appending to page root instead.`
        );
        // Ensure no private keys on blocks before appending to page root
        deepStripPrivateKeys(blocksToAppend);
        await appendBlocksToBlockId(pageId, blocksToAppend);
        totalAppended += blocksToAppend.length;
        continue;
      }

      log(
        `🔄 Orchestrator: appending ${blocksToAppend.length} block(s) to parent ${parentId} for marker sn2n:${marker}`
      );
      // Ensure no private helper keys are present before appending under parent
      deepStripPrivateKeys(blocksToAppend);
      const result = await appendBlocksToBlockId(parentId, blocksToAppend);
      totalAppended += result.appended || 0;
      log(
        `✅ Orchestrator: appended ${
          result.appended || 0
        } blocks for marker sn2n:${marker}`
      );
      // Attempt to clean up the inline marker from the paragraph we used to locate the parent
      if (paragraphId) {
        try {
          const retrieved = await notion.blocks.retrieve({
            block_id: paragraphId,
          });
          const existingRt = retrieved.paragraph?.rich_text || [];
          const newRt = removeMarkerFromRichTextArray(existingRt, marker);
          const joinedOld = existingRt
            .map((r) => r.text?.content || "")
            .join(" ");
          const joinedNew = newRt.map((r) => r.text?.content || "").join(" ");
          if (joinedOld !== joinedNew) {
            const safeNewRt = sanitizeRichTextArray(newRt);
            await notion.blocks.update({
              block_id: paragraphId,
              paragraph: { rich_text: safeNewRt },
            });
            log(
              `✅ Orchestrator: removed marker from paragraph ${paragraphId}`
            );
          }
        } catch (e) {
          log(
            "⚠️ Orchestrator: failed to remove marker from paragraph:",
            e && e.message
          );
        }
      }

      // If the marker was found on the list-item's own rich_text (paragraphId === null),
      // attempt to retrieve and update the list-item block to remove the inline marker.
      if (!paragraphId) {
        try {
          const listItem = await notion.blocks.retrieve({ block_id: parentId });
          const payload = listItem[listItem.type] || {};
          const existingRt = Array.isArray(payload.rich_text)
            ? payload.rich_text
            : [];
          const newRt = removeMarkerFromRichTextArray(existingRt, marker);
          const joinedOld = existingRt
            .map((r) => r.text?.content || "")
            .join(" ");
          const joinedNew = newRt.map((r) => r.text?.content || "").join(" ");
          if (joinedOld !== joinedNew) {
            const safeNewRt = sanitizeRichTextArray(newRt);
            await notion.blocks.update({
              block_id: parentId,
              [listItem.type]: { rich_text: safeNewRt },
            });
            log(`✅ Orchestrator: removed marker from list-item ${parentId}`);
          }
        } catch (e) {
          log(
            "⚠️ Orchestrator: failed to remove marker from list-item:",
            e && e.message
          );
        }
      }
    } catch (err) {
      log(
        `❌ Orchestrator error for marker sn2n:${marker}:`,
        err && err.message
      );
      try {
        await appendBlocksToBlockId(pageId, blocksToAppend);
      } catch (e) {
        log("❌ Orchestrator fallback append failed:", e && e.message);
      }
    }
  }
  // After orchestrating individual markers, run a final sweep to remove any residual marker tokens
  try {
    const sweep = await sweepAndRemoveMarkersFromPage(pageId);
    if (sweep && sweep.updated) {
      log(
        `🔍 Sweeper finished: updated ${sweep.updated} blocks to remove residual markers`
      );
    }
  } catch (e) {
    log("⚠️ Orchestrator: sweeper failed:", e && e.message);
  }

  return { appended: totalAppended };
}

// Sweep the page children and remove any remaining (sn2n:...) markers from rich_text
// This is append-only safe: it only updates blocks to remove visible marker tokens.
async function sweepAndRemoveMarkersFromPage(rootPageId) {
  if (!notion) throw new Error("Notion client not initialized");
  const tokenPrefix = "(sn2n:";

  async function listChildren(blockId, cursor) {
    return await notion.blocks.children.list({
      block_id: blockId,
      page_size: 100,
      start_cursor: cursor,
    });
  }

  const queue = [rootPageId];
  const visited = new Set();
  let updated = 0;

  while (queue.length > 0) {
    const current = queue.shift();
    if (visited.has(current)) continue;
    visited.add(current);

    let cursor = undefined;
    do {
      const res = await listChildren(current, cursor);
      cursor = res.has_more ? res.next_cursor : undefined;
      const children = res.results || [];
      for (const child of children) {
        try {
          // Check for rich_text on the block's typed payload
          const t = child.type;
          const payload = child[t] || child.paragraph || {};
          const rich = Array.isArray(payload.rich_text)
            ? payload.rich_text
            : [];
          const plain = rich.map((r) => r?.text?.content || "").join("");
          if (plain.includes("sn2n:") || plain.includes(tokenPrefix)) {
            // Attempt to remove any marker occurrence(s)
            // We'll try to remove all tokens found for any marker-like substring
            // Find all markers in the plain text matching sn2n:xxxx
            const markerRegex = /\(sn2n:[^)]+\)/g;
            const matches = plain.match(markerRegex) || [];
            let newRich = rich;
            for (const m of matches) {
              // remove each marker using existing helper
              const markerName =
                (m || "").replace(/^\(|\)$/g, "").split(":")[1] || null;
              if (markerName) {
                newRich = removeMarkerFromRichTextArray(newRich, markerName);
              } else {
                // fallback: remove literal m from concatenated content by a general pass
                newRich = newRich.map((rt) => {
                  if (!rt || !rt.text || typeof rt.text.content !== "string")
                    return rt;
                  const cleaned = rt.text.content.replace(m, "");
                  return { ...rt, text: { ...rt.text, content: cleaned } };
                });
              }
            }

            const joinedOld = rich.map((r) => r.text?.content || "").join(" ");
            const joinedNew = newRich
              .map((r) => r.text?.content || "")
              .join(" ");
            if (joinedOld !== joinedNew) {
              // Use newRich directly (it's produced by removeMarkerFromRichTextArray or a simple map)
              const safeNewRt = Array.isArray(newRich) ? newRich : [];
              const updateBody = {};
              updateBody[child.type] = { rich_text: safeNewRt };
              try {
                await notion.blocks.update({
                  block_id: child.id,
                  [child.type]: { rich_text: safeNewRt },
                });
                updated++;
                log(`🔧 Sweeper: removed marker(s) from block ${child.id}`);
              } catch (e) {
                log(
                  `⚠️ Sweeper: failed to update block ${child.id}:`,
                  e && e.message
                );
              }
            }
          }

          if (child.has_children) queue.push(child.id);
        } catch (e) {
          log("⚠️ Sweeper inner error:", e && e.message);
        }
      }
    } while (cursor);
  }

  return { updated };
}

// Public endpoint to append blocks to an existing block id. Useful for multi-request orchestration.
app.post("/api/blocks/append", async (req, res) => {
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

    // Sanitize blocks before sending
    const safeChildren = sanitizeBlocks(children, "append_children");

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

// List databases the integration can access (with optional name filter + short cache)
app.get("/api/databases", async (req, res) => {
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
    log("/api/databases error:", err && (err.message || err));
    return sendError(res, "SERVER_ERROR", err && err.message, null, 500);
  }
});

// Return typed property schema for a single database (useful for UI forms)
app.get("/api/databases/:id/schema", async (req, res) => {
  try {
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

// Alias GET /api/databases/:id -> return basic database info + typed schema
app.get("/api/databases/:id", async (req, res) => {
  try {
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
app.post("/api/databases/:id/query", async (req, res) => {
  try {
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

app.options("/*", (req, res) => res.sendStatus(204));

if (require.main === module) {
  app.listen(PORT, () => {
    // Always print a concise startup message; verbose logs use log()
    console.log(
      new Date().toISOString(),
      "[SN2N] SN2N proxy listening on port",
      PORT
    );
    console.log(
      new Date().toISOString(),
      "[SN2N] Notion configured:",
      !!process.env.NOTION_TOKEN
    );
  });
}

module.exports = {
  app,
  htmlToNotionBlocks,
  htmlToNotionRichText,
  cleanHtmlText,
  normalizeCodeLanguage,
  // Expose marker/orchestrator helpers for testing and external orchestration
  collectAndStripMarkers,
  generateMarker,
  appendBlocksToBlockId,
  findParentListItemByMarker,
  orchestrateDeepNesting,
  notion,
  removeCollectedBlocks,
  deepStripPrivateKeys,
};
