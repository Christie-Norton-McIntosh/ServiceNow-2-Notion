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
function setVerbose(v) {
  SN2N_VERBOSE = !!v;
  return SN2N_VERBOSE;
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
      notion = new NotionClient({ auth: process.env.NOTION_TOKEN });
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

  // Don't extract images at the top - they'll be processed inline within their context
  // This ensures images appear in their proper position in the document flow

  /*
	// REMOVED: This code extracted all images at the start, causing them to appear at the top
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

          if (changed) break; // Restart search after removal
        }
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
      const blockElements = [];
      let processedTextContent = textContent;

      // Extract <pre> elements first
      const preRegex = /<pre[^>]*>([\s\S]*?)<\/pre>/gi;
      let preMatch;
      while ((preMatch = preRegex.exec(textContent)) !== null) {
        const codeContent = preMatch[1].replace(/<[^>]*>/g, "").trim();
        if (codeContent) {
          blockElements.push({
            object: "block",
            type: "code",
            code: {
              caption: [],
              rich_text: [{ type: "text", text: { content: codeContent } }],
              language: "javascript",
            },
          });
        }
        processedTextContent = processedTextContent.replace(preMatch[0], "");
      }

      // Process images inline
      const imgRegex =
        /<img[^>]*src=["']([^"']+)["'][^>]*(?:alt=["']([^"']*)["'][^>]*)?>/gi;
      let imgMatch;
      while ((imgMatch = imgRegex.exec(processedTextContent)) !== null) {
        const imgUrl = normalizeUrl(imgMatch[1]);
        const imgAlt = imgMatch[2] || "image";

        if (isValidImageUrl(imgUrl)) {
          const uploadedId = await downloadAndUploadImage(imgUrl, imgAlt);
          if (uploadedId) {
            blockElements.push({
              object: "block",
              type: "image",
              image: {
                type: "file",
                file: { url: uploadedId },
              },
            });
          }
        }
        processedTextContent = processedTextContent.replace(imgMatch[0], "");
      }

      // Clean up remaining HTML tags
      processedTextContent = processedTextContent
        .replace(/<[^>]*>/g, " ")
        .replace(/\s+/g, " ")
        .trim();

      // Create the list item
      const item = {
        object: "block",
        type: listType,
        [listType]: {
          rich_text: processedTextContent
            ? [
                {
                  type: "text",
                  text: { content: processedTextContent },
                },
              ]
            : [],
        },
      };

      // Add children if any
      if (children.length > 0) {
        item[listType].children = children;
      }

      items.push(item);

      // Add any block elements after the list item
      items.push(...blockElements);
    }

    return items;
  }

  // Main parsing logic: walk through HTML and convert to Notion blocks
  const elementRegex =
    /<(h1|h2|h3|h4|h5|h6|p|blockquote|pre|ul|ol|li|table|tr|td|th|img|a|br)[^>]*>([\s\S]*?)<\/\1>/gi;
  let match;
  const topLevelBlocks = [];

  while ((match = elementRegex.exec(html)) !== null) {
    const tagName = match[1].toLowerCase();
    const innerHtml = match[2];

    log(`🔧 Found ${tagName} element, processing...`);

    switch (tagName) {
      case "h1":
      case "h2":
      case "h3":
      case "h4":
      case "h5":
      case "h6":
        // Header elements
        topLevelBlocks.push({
          object: "block",
          type: "heading_" + tagName.charAt(1),
          heading_3: {
            rich_text: [
              {
                type: "text",
                text: { content: innerHtml },
              },
            ],
          },
        });
        break;

      case "p":
        // Paragraphs
        topLevelBlocks.push({
          object: "block",
          type: "paragraph",
          paragraph: {
            rich_text: [
              {
                type: "text",
                text: { content: innerHtml },
              },
            ],
          },
        });
        break;

      case "blockquote":
        // Blockquotes
        topLevelBlocks.push({
          object: "block",
          type: "quote",
          quote: {
            rich_text: [
              {
                type: "text",
                text: { content: innerHtml },
              },
            ],
          },
        });
        break;

      case "pre":
        // Code blocks (from <pre> tags)
        const codeContent = innerHtml.replace(/<[^>]*>/g, "").trim();
        topLevelBlocks.push({
          object: "block",
          type: "code",
          code: {
            caption: [],
            rich_text: [{ type: "text", text: { content: codeContent } }],
            language: "javascript",
          },
        });
        break;

      case "ul":
      case "ol":
        // Lists
        const listType =
          tagName === "ul" ? "bulleted_list_item" : "numbered_list_item";
        const listItems = await parseListItems(innerHtml, listType);
        topLevelBlocks.push(...listItems);
        break;

      case "img":
        // Images (from <img> tags)
        const imgUrl = normalizeUrl(innerHtml);
        const imgAlt = "image";

        if (isValidImageUrl(imgUrl)) {
          const uploadedId = await downloadAndUploadImage(imgUrl, imgAlt);
          if (uploadedId) {
            topLevelBlocks.push({
              object: "block",
              type: "image",
              image: {
                type: "file",
                file: { url: uploadedId },
              },
            });
          }
        }
        break;

      case "a":
        // Links (from <a> tags)
        topLevelBlocks.push({
          object: "block",
          type: "bookmark",
          bookmark: {
            url: innerHtml,
            title: innerHtml,
          },
        });
        break;

      case "br":
        // Line breaks (from <br> tags)
        topLevelBlocks.push({
          object: "block",
          type: "divider",
        });
        break;

      default:
        log(`⚠️ Unsupported or unrecognized tag: ${tagName}`);
        break;
    }
  }

  log(`✅ Conversion complete: ${topLevelBlocks.length} blocks created`);

  return {
    blocks: topLevelBlocks,
    hasVideos: hasDetectedVideos,
  };
}

// ...existing code...
