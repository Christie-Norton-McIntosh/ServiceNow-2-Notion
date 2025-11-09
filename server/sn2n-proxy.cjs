
/**
 * SN2N Proxy Server (CommonJS) - ServiceNow to Notion Integration
 * 
 * MODULAR ARCHITECTURE (with fallback support for legacy monolith usage):
 * 
 * Core Components:
 * - server/converters/     Rich-text & table conversion utilities
 * - server/services/       Notion API & ServiceNow parsing services  
 * - server/orchestration/  Block chunking, marker management, deep nesting
 * - server/routes/         Express route handlers (health, w2n, databases, upload)
 * - server/utils/          Shared formatting and validation utilities
 * 
 * Fallback Strategy:
 * All module imports use try/catch with inline fallback implementations
 * to maintain backward compatibility when modular files are unavailable.
 * This ensures the server can run as either:
 * 1. Modular architecture (preferred) - clean separation of concerns
 * 2. Legacy monolith mode (fallback) - all functionality inline
 * 
 * Architecture Benefits:
 * - Improved maintainability through separation of concerns
 * - Better testability with isolated modules  
 * - Graceful degradation when modules are missing
 * - Production robustness with comprehensive error handling
 */

// SN2N proxy (CommonJS copy) - runnable even when package.json sets "type": "module"
const express = require("express");
const cors = require("cors");
const dotenv = require("dotenv");
const fs = require("fs");
const path = require("path");
const util = require("util");
const axios = require("axios");
const FormData = require("form-data");

// Import modules with fallback for legacy monolith usage
// Rich-text converter helpers
let richTextConverter;
try {
  richTextConverter = require('./converters/rich-text.cjs');
} catch (e) {
  console.log("⚠️ Rich-text converter not available, using fallback:", e.message);
  // Fallback for legacy monolith usage
  richTextConverter = {
    convertRichTextBlock: () => [],
    cloneRichText: (rt) => ({ ...rt }),
    sanitizeRichTextArray: (arr) => Array.isArray(arr) ? arr.filter(Boolean) : [],
    normalizeAnnotations: (annotations) => ({ 
      bold: false, italic: false, strikethrough: false, underline: false, 
      code: false, color: 'default', ...annotations 
    }),
    VALID_RICH_TEXT_COLORS: new Set(['default', 'gray', 'brown', 'orange', 'yellow', 'green', 'blue', 'purple', 'pink', 'red'])
  };
}

// Table converter helpers  
let tableConverter;
try {
  tableConverter = require('./converters/table.cjs');
} catch (e) {
  console.log("⚠️ Table converter not available, using fallback:", e.message);
  // Fallback for legacy monolith usage
  tableConverter = {
    convertTableBlock: () => [],
    deduplicateTableBlocks: (arr) => Array.isArray(arr) ? arr : []
  };
}

// Extract converter functions with fallback
const { 
  convertRichTextBlock, 
  cloneRichText, 
  sanitizeRichTextArray, 
  normalizeAnnotations,
  VALID_RICH_TEXT_COLORS 
} = richTextConverter;
const { convertTableBlock, deduplicateTableBlocks } = tableConverter;

// Notion and ServiceNow services with fallback
let notionService, servicenowService;
try {
  notionService = require('./services/notion.cjs');
  servicenowService = require('./services/servicenow.cjs');
  console.log("✅ Service modules loaded successfully");
  console.log("✅ servicenowService.extractContentFromHtml:", typeof servicenowService.extractContentFromHtml);
} catch (e) {
  console.log("⚠️ Service modules not available, using monolith mode:", e.message);
  console.error("⚠️ Full error:", e);
  // Services will be undefined, triggering fallback to inline functions
}

// Orchestration modules with fallback  
let blockChunking, markerManagement, deepNesting;
try {
  blockChunking = require('./orchestration/block-chunking.cjs');
  markerManagement = require('./orchestration/marker-management.cjs');
  deepNesting = require('./orchestration/deep-nesting.cjs');
} catch (e) {
  console.log("⚠️ Orchestration modules not available, using monolith mode:", e.message);
  // Orchestration will be undefined, triggering fallback to inline functions
}

// Verification log utility with fallback
let verificationLog;
try {
  verificationLog = require('./utils/verification-log.cjs');
} catch (e) {
  console.log("⚠️ Verification log utility not available:", e.message);
  verificationLog = null;
}

// Extract orchestration functions with fallback
const { appendBlocksToBlockId, deepStripPrivateKeys } = blockChunking || {};
const { 
  generateMarker, 
  collectAndStripMarkers, 
  removeCollectedBlocks,
  removeMarkerFromRichTextArray
} = markerManagement || {};
const { 
  findParentListItemByMarker,
  orchestrateDeepNesting,
  sweepAndRemoveMarkersFromPage 
} = deepNesting || {};

// Provide fallback implementations for legacy monolith mode
// These will be used if the orchestration modules are not available
const fallbackAppendBlocksToBlockId = appendBlocksToBlockId || (async (blockId, blocks) => {
  console.log("⚠️ Using fallback appendBlocksToBlockId - orchestration modules not available");
  return { appended: 0 };
});

const fallbackCollectAndStripMarkers = collectAndStripMarkers || ((blocks, map = {}) => {
  console.log("⚠️ Using fallback collectAndStripMarkers - orchestration modules not available");
  return map;
});

const fallbackOrchestrateDeepNesting = orchestrateDeepNesting || (async (pageId, markerMap) => {
  console.log("⚠️ Using fallback orchestrateDeepNesting - orchestration modules not available");
  return { appended: 0 };
});

const fallbackDeepStripPrivateKeys = deepStripPrivateKeys || ((blocks) => {
  console.log("⚠️ Using fallback deepStripPrivateKeys - orchestration modules not available");
  // Simple fallback that removes _sn2n_ keys
  if (Array.isArray(blocks)) {
    blocks.forEach(block => {
      if (block && typeof block === 'object') {
        Object.keys(block).forEach(key => {
          if (key.startsWith('_sn2n_')) delete block[key];
        });
      }
    });
  }
});

const fallbackGenerateMarker = generateMarker || (() => {
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
});

const fallbackRemoveCollectedBlocks = removeCollectedBlocks || ((blocks) => {
  console.log("⚠️ Using fallback removeCollectedBlocks - orchestration modules not available");
  return 0;
});

// Use fallbacks if original functions are undefined
const safeAppendBlocksToBlockId = appendBlocksToBlockId || fallbackAppendBlocksToBlockId;
const safeCollectAndStripMarkers = collectAndStripMarkers || fallbackCollectAndStripMarkers;
const safeOrchestrateDeepNesting = orchestrateDeepNesting || fallbackOrchestrateDeepNesting;
const safeDeepStripPrivateKeys = deepStripPrivateKeys || fallbackDeepStripPrivateKeys;
const safeGenerateMarker = generateMarker || fallbackGenerateMarker;
const safeRemoveCollectedBlocks = removeCollectedBlocks || fallbackRemoveCollectedBlocks;

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

app.use(express.json({ limit: "100mb" }));
app.use(express.urlencoded({ extended: true, limit: "100mb" }));

// Log incoming request size for debugging
app.use((req, res, next) => {
  const contentLength = req.headers['content-length'];
  if (contentLength && parseInt(contentLength) > 1024 * 1024) {
    const sizeMB = (parseInt(contentLength) / (1024 * 1024)).toFixed(2);
    log(`📦 Incoming ${req.method} ${req.path} - Size: ${sizeMB} MB`);
  }
  next();
});

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
let SN2N_VERBOSE = !!(
  process.env.SN2N_VERBOSE && String(process.env.SN2N_VERBOSE) === "1"
);
let SN2N_EXTRA_DEBUG = !!(
  process.env.SN2N_EXTRA_DEBUG && String(process.env.SN2N_EXTRA_DEBUG) === "1"
);

function getVerbose() {
  return !!SN2N_VERBOSE;
}

function setVerbose(enabled) {
  SN2N_VERBOSE = !!enabled;
  try {
    console.log(new Date().toISOString(), "[SN2N] Verbose set to", SN2N_VERBOSE);
  } catch (_) {}
  return SN2N_VERBOSE;
}

function setExtraDebug(enabled) {
  SN2N_EXTRA_DEBUG = !!enabled;
  try {
    console.log(new Date().toISOString(), "[SN2N] ExtraDebug set to", SN2N_EXTRA_DEBUG);
  } catch (_) {}
  return SN2N_EXTRA_DEBUG;
}

// When verbose mode is enabled, tee all console output to a debug log file under /tmp
// This ensures the "Start Server (Verbose)" task also produces a persistent log at /tmp/sn2n-debug.log
let _sn2nDebugStream = null;
if (SN2N_VERBOSE) {
  try {
    const DEBUG_LOG_FILE = process.env.SN2N_DEBUG_LOG_FILE || "/tmp/sn2n-debug.log";
    _sn2nDebugStream = fs.createWriteStream(DEBUG_LOG_FILE, { flags: "a" });

    const writeLine = (line) => {
      try {
        _sn2nDebugStream && _sn2nDebugStream.write(line + "\n");
      } catch (_) {
        // ignore file write errors to avoid crashing server
      }
    };

    // Session header
    writeLine("\n==================== SN2N SESSION START ====================");
    writeLine(`${new Date().toISOString()} [SN2N] PID: ${process.pid}`);
    writeLine(`${new Date().toISOString()} [SN2N] CWD: ${process.cwd()}`);
    writeLine(`${new Date().toISOString()} [SN2N] Version: ${process.env.npm_package_version || "dev"}`);
    writeLine(`${new Date().toISOString()} [SN2N] Verbose: ${SN2N_VERBOSE}  ExtraDebug: ${SN2N_EXTRA_DEBUG}`);
    if (process.env.NOTION_TOKEN) writeLine(`${new Date().toISOString()} [SN2N] Notion token configured: true`);
    writeLine("============================================================\n");

    // Tee console methods to the debug file
    const original = {
      log: console.log,
      info: console.info,
      warn: console.warn,
      error: console.error,
    };

    function toMessage(args) {
      try {
        return args
          .map((a) =>
            typeof a === "string"
              ? a
              : a instanceof Error
              ? (a.stack || a.message || String(a))
              : util.inspect(a, { depth: 4, colors: false })
          )
          .join(" ");
      } catch (_) {
        return args.map(String).join(" ");
      }
    }

    function tee(level, args) {
      const msg = toMessage(args);
      writeLine(`${new Date().toISOString()} [${level.toUpperCase()}] ${msg}`);
    }

    console.log = function (...args) {
      try { original.log.apply(console, args); } finally { tee("log", args); }
    };
    console.info = function (...args) {
      try { original.info.apply(console, args); } finally { tee("info", args); }
    };
    console.warn = function (...args) {
      try { original.warn.apply(console, args); } finally { tee("warn", args); }
    };
    console.error = function (...args) {
      try { original.error.apply(console, args); } finally { tee("error", args); }
    };

    // Ensure stream is closed on exit
    const cleanUp = () => {
      try { _sn2nDebugStream && _sn2nDebugStream.end(); } catch (_) {}
    };
    process.on("exit", cleanUp);
    process.on("SIGINT", () => { cleanUp(); process.exit(0); });
    process.on("SIGTERM", () => { cleanUp(); process.exit(0); });
  } catch (e) {
    // If file logging fails, continue without crashing
    // eslint-disable-next-line no-console
    console.warn("[SN2N] Failed to initialize /tmp log tee:", e && e.message);
  }
}

function log(...args) {
  if (!SN2N_VERBOSE) return;
  if (
    !SN2N_EXTRA_DEBUG &&
    args.length > 0 &&
    typeof args[0] === "string" &&
    [
      /^🔍/, /^🔧/, /^📊/, /^📄/, /^📝/, /^🎯/, /^📦/, /^🔄/,
      /^✅ (Placeholder|Found|Code|Adding)/, /^❌ Placeholder/, /^⚠️ Placeholder/, /^\s{3}/
    ].some((pattern) => pattern.test(args[0]))
  ) {
    return;
  }
  console.log(new Date().toISOString(), "[SN2N]", ...args);
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

function hyphenateNotionId(id) {
  if (!id || typeof id !== "string") return id;
  const clean = id.replace(/[^a-f0-9]/gi, "");
  if (clean.length !== 32) return id;
  return clean.replace(/^(.{8})(.{4})(.{4})(.{4})(.{12})$/, "$1-$2-$3-$4-$5");
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
      try {
        martianHelper.setNotionClient(notion);
        log("✅ Martian helper initialized with Notion client");
      } catch (err) {
        log("⚠️ Martian helper setNotionClient failed:", err.message);
      }
    }
  } catch (e) {
    notion = null;
    log("Notion client init failed:", e.message);
  }
} else {
  // Minimal startup notice when not verbose
  if (SN2N_VERBOSE) log("Notion token not configured (NOTION_TOKEN missing)");
}

function getExtraDebug() {
  return !!SN2N_EXTRA_DEBUG;
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

// Route imports with fallback for legacy monolith usage
try {
  app.use(require('./routes/health.cjs'));
  app.use(require('./routes/ping.cjs'));
  app.use(require('./routes/status.cjs'));
  app.use(require('./routes/logging.cjs'));
} catch (e) {
  console.log("⚠️ Route modules not available, using inline fallbacks:", e.message);
  
  // Fallback route implementations for legacy monolith mode
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
}

// Global tracker for video detection (reset per conversion)
let hasDetectedVideos = false;

// Helper function to check if an iframe URL is from a known video platform
// Import URL utilities
const { isVideoIframeUrl, isValidNotionUrl } = require("./utils/url.cjs");
const { cleanHtmlText } = require("./utils/notion-format.cjs");

// HTML to Notion blocks conversion function
async function htmlToNotionBlocks(html) {
  log("🚀 htmlToNotionBlocks called! HTML length:", html ? html.length : 0);
  
  if (!html || typeof html !== "string") {
    log("⚠️ Invalid HTML input, returning empty blocks");
    return { blocks: [], hasVideos: false };
  }
  
  // Delegate to ServiceNow service for extraction
  if (servicenowService && servicenowService.extractContentFromHtml) {
    log("🔄 Using servicenowService.extractContentFromHtml");
    const result = await servicenowService.extractContentFromHtml(html);
    log(`✅ servicenowService returned ${result.blocks.length} blocks`);
    return result;
  } else {
    log("⚠️ servicenowService.extractContentFromHtml not available!");
    log("⚠️ servicenowService:", typeof servicenowService);
    log("⚠️ extractContentFromHtml:", servicenowService ? typeof servicenowService.extractContentFromHtml : 'N/A');
    return { blocks: [], hasVideos: false };
  }
}

// Removed duplicate cleanHtmlText, isVideoIframeUrl, isValidNotionUrl - now imported from utils modules

// Helper function to validate URLs for Notion links (continued from import)
function _isValidNotionUrl_LEGACY(url) {
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

// All URL utilities (convertServiceNowUrl, isVideoIframeUrl, isValidNotionUrl) now imported from utils/url.cjs above

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

  // Add soft return between </a> and any <p> tag (including <p class="shortdesc">)
  text = text.replace(
    /(<\/a>)(\s*)(<p[^>]*>)/gi,
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

app.options("/*", (req, res) => res.sendStatus(204));

// Expose functions to global context for route modules
global.notion = notion;
global.log = log;
global.sendSuccess = sendSuccess;
global.sendError = sendError;
global.hyphenateNotionId = hyphenateNotionId;
global.htmlToNotionBlocks = htmlToNotionBlocks;
global.ensureFileUploadAvailable = ensureFileUploadAvailable;
global.getVerbose = getVerbose;
global.setVerbose = setVerbose;
global.setExtraDebug = setExtraDebug;
global.collectAndStripMarkers = safeCollectAndStripMarkers;
global.removeCollectedBlocks = safeRemoveCollectedBlocks;
global.deepStripPrivateKeys = safeDeepStripPrivateKeys;
global.orchestrateDeepNesting = safeOrchestrateDeepNesting;
global.getExtraDebug = getExtraDebug;
global.normalizeAnnotations = normalizeAnnotations;
global.normalizeUrl = normalizeUrl;
global.isValidImageUrl = isValidImageUrl;
global.isValidNotionUrl = isValidNotionUrl;
global.appendBlocksToBlockId = safeAppendBlocksToBlockId;
global.downloadAndUploadImage = downloadAndUploadImage;
global.normalizeCodeLanguage = normalizeCodeLanguage;

// Main API routes with fallback for legacy monolith usage (loaded after global context)
try {
  // TEST ROUTE: Verify routing works at all
  app.post("/api/W2N_TEST", (req, res) => {
    console.log('🧪 TEST ROUTE HIT!');
    res.json({ test: 'success', message: 'Routing works!' });
  });
  
  // HOT-RELOAD FIX: Dynamically load w2n.cjs on EVERY request to bypass all caching
  // CRITICAL: This wrapper MUST be registered BEFORE other /api routes
  // to intercept W2N requests and hot-reload the module
  app.post("/api/W2N", (req, res, next) => {
    console.log('🔥🔥🔥 HOT-RELOAD WRAPPER HIT! Method:', req.method, 'URL:', req.url, 'at', new Date().toISOString());
    
    // Resolve path and clear cache on EVERY W2N request
    const w2nPath = require.resolve('./routes/w2n.cjs');
    delete require.cache[w2nPath];
    
    // Also clear servicenow.cjs cache since w2n depends on it
    const servicenowPath = require.resolve('./services/servicenow.cjs');
    delete require.cache[servicenowPath];
    
    const freshRouter = require('./routes/w2n.cjs');
    
    console.log('🔥 Reloaded w2n.cjs + servicenow.cjs, delegating to freshly loaded router');
    
    // The router expects the request path to be /W2N (without /api prefix)
    // So we strip /api from req.url before delegating to the router
    const originalUrl = req.url;
    req.url = req.url.replace(/^\/api/, '');
    
    // Directly invoke the router (it handles POST /W2N internally)
    freshRouter(req, res, (err) => {
      req.url = originalUrl; // Restore original URL
      if (err) next(err);
    });
  });
  
  console.log('✅ W2N router configured with HOT-RELOAD wrapper');
  app.use("/api", require('./routes/databases.cjs'));
  app.use("/api", require('./routes/upload.cjs'));
} catch (e) {
  console.log("⚠️ API route modules not available, using inline fallbacks:", e.message);
  // Main API routes will be handled by the inline endpoints defined above

  // Fallback for /api/databases/:id
  app.get("/api/databases/:id", async (req, res) => {
    try {
      if (!notion) {
        return sendError(res, "NOTION_CLIENT_UNINITIALIZED", "Notion client not initialized", null, 500);
      }
      const dbId = hyphenateNotionId(req.params.id);
      let dbInfo;
      try {
        dbInfo = await notion.databases.retrieve({ database_id: dbId });
      } catch (e) {
        log("/api/databases/:id retrieve error (fallback):", e);
        return res.status(500).json({
          error: "Failed to retrieve database",
          details: {
            message: e && e.message,
            code: e && e.code,
            status: e && e.status,
            body: e && e.body,
            stack: e && e.stack,
            raw: e
          }
        });
      }
      const schema = {};
      for (const [name, prop] of Object.entries(dbInfo.properties || {})) {
        const entry = { id: prop.id || null, name, type: prop.type };
        if (prop.type === "select" || prop.type === "multi_select") {
          entry.options = prop[prop.type] && prop[prop.type].options
            ? prop[prop.type].options.map((o) => ({ id: o.id, name: o.name, color: o.color }))
            : [];
        }
        if (prop.type === "number") entry.number = prop.number || { format: "number" };
        if (prop.type === "relation") entry.relation = prop.relation || {};
        if (prop.type === "formula") entry.formula = { expression: (prop.formula && prop.formula.expression) || null };
        if (prop.type === "rollup") entry.rollup = prop.rollup || {};
        if (prop.type === "people") entry.people = {};
        if (prop.type === "files") entry.files = {};
        schema[name] = entry;
      }
      return sendSuccess(res, {
        id: dbId,
        title: dbInfo.title || null,
        properties: dbInfo.properties || {},
        url: dbInfo.url || null,
        schema,
      });
    } catch (err) {
      log("/api/databases/:id error (fallback):", err);
      return sendError(res, "SERVER_ERROR", {
        message: err && err.message,
        code: err && err.code,
        status: err && err.status,
        body: err && err.body,
        stack: err && err.stack,
        raw: err
      }, null, 500);
    }
  });
}

if (require.main === module) {
  // Clean old verification log entries on startup (keep last 24 hours)
  if (verificationLog && verificationLog.cleanOldEntries) {
    try {
      verificationLog.cleanOldEntries(24); // Keep last 24 hours
    } catch (err) {
      console.error("⚠️ Failed to clean verification log:", err.message);
    }
  }
  
  const server = app.listen(PORT, () => {
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
  
  // Set server timeout to 5 minutes to match client timeout
  server.timeout = 300000; // 5 minutes
  server.keepAliveTimeout = 305000; // Slightly longer than timeout
  server.headersTimeout = 310000; // Slightly longer than keepAliveTimeout
}

module.exports = {
  app,
  htmlToNotionBlocks,
  htmlToNotionRichText,
  cleanHtmlText,
  normalizeCodeLanguage,
  // Expose marker/orchestrator helpers for testing and external orchestration
  collectAndStripMarkers: safeCollectAndStripMarkers,
  generateMarker: safeGenerateMarker,
  appendBlocksToBlockId: safeAppendBlocksToBlockId,
  findParentListItemByMarker,
  orchestrateDeepNesting: safeOrchestrateDeepNesting,
  notion,
  removeCollectedBlocks: safeRemoveCollectedBlocks,
  deepStripPrivateKeys: safeDeepStripPrivateKeys,
};
