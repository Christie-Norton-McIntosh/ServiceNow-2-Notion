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
function log(...args) {
  if (!SN2N_VERBOSE) return;
  console.log(new Date().toISOString(), "[SN2N]", ...args);
}
function getVerbose() {
  return !!SN2N_VERBOSE;
}
function setVerbose(v) {
  SN2N_VERBOSE = !!v;
  return SN2N_VERBOSE;
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
  sendSuccess(res, { verbose: getVerbose() })
);

app.post("/api/logging", (req, res) => {
  try {
    const { verbose } = req.body || {};
    const newVal = setVerbose(!!verbose);
    return sendSuccess(res, { verbose: newVal });
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
              // Found the matching closing tag, remove the entire element
              result = result.substring(0, startPos) + result.substring(pos);
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

    // Match list items at this level (non-greedy to avoid matching nested items)
    const liRegex = /<li[^>]*>([\s\S]*?)<\/li>/gi;
    let match;

    while ((match = liRegex.exec(html)) !== null) {
      const fullItemContent = match[1];

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

      // Extract <table> elements
      const tableRegex = /<table[^>]*>([\s\S]*?)<\/table>/gi;
      let tableMatch;
      while ((tableMatch = tableRegex.exec(textContent)) !== null) {
        try {
          const tableContent = tableMatch[1];
          const tableBlocks = await parseTableToNotionBlock(tableContent);
          if (tableBlocks && tableBlocks.length > 0) {
            blockElements.push(...tableBlocks);
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
            blockElements.push({
              object: "block",
              type: "paragraph",
              paragraph: {
                rich_text: [
                  {
                    type: "text",
                    text: { content: captionText },
                    annotations: {
                      bold: false,
                      italic: true,
                      strikethrough: false,
                      underline: false,
                      code: false,
                      color: "default",
                    },
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
                blockElements.push(imageBlock);
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
              blockElements.push(imageBlock);
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

      // Extract <pre> elements
      const preRegex = /<pre[^>]*>([\s\S]*?)<\/pre>/gi;
      let preMatch;
      while ((preMatch = preRegex.exec(textContent)) !== null) {
        const preAttributes = preMatch[0].match(/<pre([^>]*)>/i)?.[1] || "";
        const preContent = preMatch[1];

        // Create a code block
        let language = "plain text";
        const classMatch = preAttributes.match(/class=["']([^"']*)["']/i);
        if (classMatch) {
          const classes = classMatch[1];
          const languageMatch = classes.match(/language-(\w+)/);
          if (languageMatch) {
            language = languageMatch[1];
          }
        }

        // Map common language names
        const languageMap = {
          javascript: "javascript",
          js: "javascript",
          python: "python",
          py: "python",
          java: "java",
          cpp: "cpp",
          "c++": "cpp",
          csharp: "csharp",
          "c#": "csharp",
          php: "php",
          ruby: "ruby",
          go: "go",
          rust: "rust",
          swift: "swift",
          kotlin: "kotlin",
          scala: "scala",
          html: "html",
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
          sql: "sql",
          bash: "bash",
          shell: "bash",
          sh: "bash",
          powershell: "powershell",
          plaintext: "plain text",
          text: "plain text",
        };

        if (languageMap[language.toLowerCase()]) {
          language = languageMap[language.toLowerCase()];
        }

        const codeText = cleanHtmlText(preContent);
        if (codeText && codeText.length > 0) {
          blockElements.push({
            object: "block",
            type: "code",
            code: {
              rich_text: [{ type: "text", text: { content: codeText } }],
              language: language,
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

        items.push(item);
      }

      // Add any block elements found in this list item
      items.push(...blockElements);
    }

    return items;
  }

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
  async function extractBlocksFromHTML(htmlStr) {
    const tempBlocks = [];

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

    const openingTagRegex = new RegExp(
      `<(${allTags.join("|")})([^>]*)(/?)>`,
      "gi"
    );
    let match;
    const matches = [];

    // Collect all top-level matches with proper nested tag handling
    while ((match = openingTagRegex.exec(htmlStr)) !== null) {
      const tag = match[1].toLowerCase();
      const attributes = match[2];
      const isSelfClosing = !!match[3] || selfClosingTags.includes(tag);
      const startPos = match.index;
      const afterOpenTag = openingTagRegex.lastIndex;

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
    }

    // Process matches and text between them
    let lastEndPos = 0;
    for (const m of matches) {
      // Extract any text before this match
      if (m.index > lastEndPos) {
        const textBetween = htmlStr.substring(lastEndPos, m.index);
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

      const tag = m.tag.toLowerCase();
      const content = m.content;
      const isSelfClosing = m.isSelfClosing;

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
        const codeText = cleanHtmlText(content);
        log(
          `🔍 Pre element content length: ${content.length}, cleaned text length: ${codeText.length}`
        );
        log(`🔍 Pre element content sample: ${content.substring(0, 100)}`);
        if (codeText && codeText.length > 0) {
          // Try to detect language from class or data attribute
          let language = "plain text";
          const classMatch = attributes.match(/class=["']([^"']*)["']/i);
          if (classMatch) {
            const classes = classMatch[1];
            log(`🔍 Pre element classes: ${classes}`);
            const languageMatch = classes.match(/language-(\w+)/);
            if (languageMatch) {
              language = languageMatch[1];
              log(`🔍 Detected language: ${language}`);
            }
          }

          // Map common language names
          const languageMap = {
            javascript: "javascript",
            js: "javascript",
            python: "python",
            py: "python",
            java: "java",
            cpp: "cpp",
            "c++": "cpp",
            csharp: "csharp",
            "c#": "csharp",
            php: "php",
            ruby: "ruby",
            go: "go",
            rust: "rust",
            swift: "swift",
            kotlin: "kotlin",
            scala: "scala",
            html: "html",
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
            sql: "sql",
            bash: "bash",
            shell: "bash",
            sh: "bash",
            powershell: "powershell",
            plaintext: "plain text",
            text: "plain text",
          };

          if (languageMap[language.toLowerCase()]) {
            language = languageMap[language.toLowerCase()];
          }

          log(`🔍 Creating code block with language: ${language}`);
          tempBlocks.push({
            object: "block",
            type: "code",
            code: {
              rich_text: [{ type: "text", text: { content: codeText } }],
              language: language,
            },
          });
          log(`✅ Code block added to blocks array`);
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
                  annotations: {
                    bold: false,
                    italic: true,
                    strikethrough: false,
                    underline: false,
                    code: false,
                    color: "default",
                  },
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
          // Convert to Notion callout block
          const result = await htmlToNotionRichText(content);
          const richText = result.richText;
          if (
            richText.length > 0 &&
            richText[0].text.content.trim().length > 0
          ) {
            // Determine emoji and color based on class
            let emoji = "📝"; // default note emoji
            let color = "blue_background"; // default note color

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

            tempBlocks.push({
              object: "block",
              type: "callout",
              callout: {
                rich_text: richText,
                icon: { type: "emoji", emoji: emoji },
                color: color,
              },
            });
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
            let language = "plain text";
            const classMatch = preAttributes.match(/class=["']([^"']*)["']/i);
            if (classMatch) {
              const classes = classMatch[1];
              const languageMatch = classes.match(/language-(\w+)/);
              if (languageMatch) {
                language = languageMatch[1];
              }
            }

            // Map language names
            const languageMap = {
              javascript: "javascript",
              js: "javascript",
              python: "python",
              java: "java",
              plaintext: "plain text",
              text: "plain text",
            };

            if (languageMap[language.toLowerCase()]) {
              language = languageMap[language.toLowerCase()];
            }

            const codeText = cleanHtmlText(preContent);
            preElements.push({ placeholder, language, codeText });

            // Replace in content
            modifiedContent = modifiedContent.replace(preMatch[0], placeholder);
            preIndex++;
          }

          if (preElements.length > 0) {
            log(
              `🔍 Found ${preElements.length} pre elements in ${tag} container, processing with placeholders`
            );

            // Process the modified content with placeholders
            const nestedBlocks = await extractBlocksFromHTML(modifiedContent);

            // Helper function to check and replace placeholder in a block
            // Returns: { replacement: block|null, codeBlockToAdd: block|null }
            const checkAndReplacePlaceholder = (richTextArray) => {
              if (!richTextArray || richTextArray.length === 0)
                return { replacement: null, codeBlockToAdd: null };

              const allText = richTextArray
                .map((rt) => rt.text?.content || "")
                .join("");
              const placeholderMatch = allText.match(
                /___PRE_PLACEHOLDER_(\d+)___/
              );

              if (placeholderMatch && allText.trim() === placeholderMatch[0]) {
                // This is just a placeholder, replace with code block
                const index = parseInt(placeholderMatch[1]);
                const preInfo = preElements[index];
                if (
                  preInfo &&
                  preInfo.codeText &&
                  preInfo.codeText.length > 0
                ) {
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
                  };
                }
              } else if (placeholderMatch) {
                // Placeholder is mixed with text - remove placeholder, add code block separately
                const index = parseInt(placeholderMatch[1]);
                const preInfo = preElements[index];

                if (
                  preInfo &&
                  preInfo.codeText &&
                  preInfo.codeText.length > 0
                ) {
                  log(
                    `🔧 Removing placeholder ${index} from text and adding code block separately`
                  );

                  // Remove the placeholder from the rich text
                  const cleanedRichText = richTextArray
                    .map((rt) => {
                      if (rt.text?.content?.includes(placeholderMatch[0])) {
                        return {
                          ...rt,
                          text: {
                            ...rt.text,
                            content: rt.text.content
                              .replace(placeholderMatch[0], "")
                              .trim(),
                          },
                        };
                      }
                      return rt;
                    })
                    .filter((rt) => rt.text?.content); // Remove empty items

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
                    replacement: cleanedRichText,
                    codeBlockToAdd: codeBlock,
                  };
                } else {
                  log(
                    `⚠️ Placeholder ${
                      placeholderMatch[1]
                    } mixed with text but no code found: ${allText.substring(
                      0,
                      100
                    )}`
                  );
                }
              }

              return { replacement: null, codeBlockToAdd: null };
            };

            // Replace placeholder blocks with actual code blocks
            for (const block of nestedBlocks) {
              log(`🔍 Checking block type: ${block.type}`);

              if (block.type === "paragraph" && block.paragraph.rich_text) {
                const result = checkAndReplacePlaceholder(
                  block.paragraph.rich_text
                );
                if (result.replacement) {
                  tempBlocks.push(result.replacement);
                  if (result.codeBlockToAdd) {
                    tempBlocks.push(result.codeBlockToAdd);
                  }
                } else if (result.codeBlockToAdd) {
                  // Keep original block, add code block after
                  tempBlocks.push(block);
                  tempBlocks.push(result.codeBlockToAdd);
                } else {
                  tempBlocks.push(block);
                }
              } else if (
                block.type === "bulleted_list_item" &&
                block.bulleted_list_item?.rich_text
              ) {
                const result = checkAndReplacePlaceholder(
                  block.bulleted_list_item.rich_text
                );
                if (result.replacement && !result.codeBlockToAdd) {
                  // Entire list item is just a placeholder - replace with code block
                  tempBlocks.push(result.replacement);
                } else if (result.replacement && result.codeBlockToAdd) {
                  // List item has text + placeholder - update text and add code block
                  block.bulleted_list_item.rich_text = result.replacement;
                  tempBlocks.push(block);
                  tempBlocks.push(result.codeBlockToAdd);
                } else {
                  // No placeholder in main text, check children
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
                          updatedChildren.push(childResult.replacement);
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
                  tempBlocks.push(block);
                }
              } else if (
                block.type === "numbered_list_item" &&
                block.numbered_list_item?.rich_text
              ) {
                const result = checkAndReplacePlaceholder(
                  block.numbered_list_item.rich_text
                );
                if (result.replacement && !result.codeBlockToAdd) {
                  // Entire list item is just a placeholder - replace with code block
                  tempBlocks.push(result.replacement);
                } else if (result.replacement && result.codeBlockToAdd) {
                  // List item has text + placeholder - update text and add code block
                  block.numbered_list_item.rich_text = result.replacement;
                  tempBlocks.push(block);
                  tempBlocks.push(result.codeBlockToAdd);
                } else {
                  // No placeholder in main text, check children
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
                          updatedChildren.push(childResult.replacement);
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
                  tempBlocks.push(block);
                }
              } else {
                // Other block types
                tempBlocks.push(block);
              }
            }
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

            const nestedBlocks = await extractBlocksFromHTML(content);
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
        const remainingBlocks = await extractBlocksFromHTML(textAfter);
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

    return tempBlocks;
  }

  const extractedBlocks = await extractBlocksFromHTML(html);
  blocks.push(...extractedBlocks);

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

  return { blocks, hasVideos: hasDetectedVideos };
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

  // Handle technical identifiers in parentheses/brackets with dots or underscores as inline code
  // Matches patterns like: (com.snc.software_asset_management), ( com.snc.incident.ml_solution ), [sys.user_table], etc.
  text = text.replace(
    /([(\[])\s*([a-zA-Z0-9_.]+\.[a-zA-Z0-9_.]+)\s*([)\]])/g,
    (match, open, code, close) => {
      return `${open}__CODE_START__${code}__CODE_END__${close}`;
    }
  );

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

  // Handle span with class="ph" containing technical identifiers (plugin names, table names, etc.) as inline code
  text = text.replace(
    /<span[^>]*class=["'][^"']*\bph\b[^"']*["'][^>]*>([^<]*\.[^<]+)<\/span>/gi,
    (match, content) => {
      // Check if content looks like a technical identifier (contains dots or underscores)
      if (/[._]/.test(content)) {
        return `__CODE_START__${content.trim()}__CODE_END__`;
      }
      return match; // Return unchanged if not a technical identifier
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
      currentAnnotations.code = true;
      currentAnnotations.color = "red";
    } else if (part === "__CODE_END__") {
      currentAnnotations.code = false;
      currentAnnotations.color = "default";
    } else if (part === "__SOFT_BREAK__") {
      // Add a soft line break
      richText.push({
        type: "text",
        text: { content: "\n" },
        annotations: { ...currentAnnotations },
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
            annotations: { ...currentAnnotations },
          });
        } else {
          richText.push({
            type: "text",
            text: { content: linkInfo.content.trim() },
            annotations: { ...currentAnnotations },
          });
        }
      }
    } else if (part) {
      // Regular text
      const cleanedText = cleanHtmlText(part);
      if (cleanedText.trim()) {
        richText.push({
          type: "text",
          text: { content: cleanedText },
          annotations: { ...currentAnnotations },
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
        annotations: {
          bold: false,
          italic: false,
          strikethrough: false,
          underline: false,
          code: false,
          color: "default",
        },
      });
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

  if (rows.length === 0) return blocks.length > 0 ? blocks : null;

  // Determine table structure
  // If first body row has images, don't treat it as a header row
  const hasHeaders = theadRows.length > 0 && !firstBodyRowHasImages;
  const tableWidth = Math.max(...rows.map((row) => row.length));

  // Skip tables with no columns
  if (tableWidth === 0) return null;

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

    // Create the page
    log("🔍 Creating Notion page with:");
    log(`   Database ID: ${payload.databaseId}`);
    log(`   Properties: ${JSON.stringify(properties, null, 2)}`);
    log(`   Children blocks: ${children.length}`);

    // Log block types for debugging
    const blockTypes = children.map((b) => b.type).join(", ");
    log(`   Block types: ${blockTypes}`);

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
      children: children,
    });

    log("✅ Page created successfully:", response.id);
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
