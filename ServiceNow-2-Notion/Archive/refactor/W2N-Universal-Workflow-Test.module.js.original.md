// ==UserScript==
// @name W2N Universal Workflow Module (SN2N - Port 3004)
// @namespace https://github.com/Christie-Norton-McIntosh/WEB-2-N0T10N
// @version 2.2.7-SN2N
// @description SN2N VERSION: Client-side workflow module (Turndown -> proxy/Martian -> Notion) for W2N userscripts. Configured for localhost:3004 SN2Ning. Exposes window.W2NWorkflow.
// @author W2N Contributors
// @match https://_.servicenow.com/_
// @match https://_.service-now.com/_
// @match https://_service-now_.com/*
// @match https://*servicenow*.com/*
// @match http://localhost:_/_
// @match https://localhost:_/_
// @match _://_/\*
// @grant GM_xmlhttpRequest
// @grant GM_getValue
// @grant GM_setValue
// @grant GM_notification
// @grant GM_registerMenuCommand
// @connect localhost
// @connect 127.0.0.1
// @run-at document-end
// @require https://unpkg.com/turndown/dist/turndown.js
// ==/UserScript==

/\*
W2N Universal Workflow Module - SN2N VERSION
v2.2.7-SN2N

🧪 SN2N CONFIGURATION:

- Default proxy URL: http://localhost:3004 (SN2N PROXY)
- Use this version when SN2Ning ServiceNow image validation fixes
- Production userscripts should use the main workflow module on port 3005

Purpose:

- Provide a comprehensive client-side workflow for HTML → Notion conversion
- Handles proper integration sequence: HTML → Turndown → Markdown → Martian → Notion blocks
- Preserves image positioning and ensures all images are downloaded/re-uploaded to Notion
- Creates functional Notion blocks with proper formatting matching the source

Content Processing Pipeline:

1.  Extract HTML content from webpage using site-specific extractors
2.  Clean and normalize HTML (remove scripts, inline events, excessive whitespace)
3.  Convert HTML to Markdown using Turndown.js (preserving structure and images)
4.  Send to proxy with image metadata and positioning information
5.  Proxy uses Martian to convert Markdown → Notion blocks while preserving image positions
6.  Proxy downloads images and uploads them as Notion file blocks
7.  Proxy creates Notion page with proper block structure

Image Handling Strategy:

- Images are preserved in their original positions within content
- External images are downloaded by the proxy and uploaded to Notion as file attachments
- Image alt text and captions are preserved where possible
- Base64/data URI images are handled properly
- CDN and protected images get appropriate headers/handling

Usage:

- Include this module inside a userscript or page context (Tampermonkey/Greasemonkey).
- Register a site-specific extractor using `Workflow.registerExtractor(name, fn)`
- Call `Workflow.processCurrentPage()` to run the extraction → conversion → upload pipeline

Security boundary:

- This module sends structured payloads to a proxy endpoint (default: http://localhost:3004/api/W2N).
- The proxy is responsible for Notion API calls and must hold the Notion credentials.
- All image downloads and Notion uploads happen server-side for security

API Surface (methods you will use):

- Workflow.configure({ proxyUrl, defaultDatabaseId, debug, contentFormat })
- Workflow.registerExtractor(name, extractorFn)
- Workflow.setExtractor(name) // choose which extractor to use by default
- Workflow.processCurrentPage({ extractOverrides }) -> returns proxy response Promise
- Workflow.buildPayload({title, contentHtml, url, images, metadata}) -> payload object
- Workflow.sendToProxy(payload) -> Promise that resolves with proxy response
- Workflow.htmlToMarkdown(html) -> converts HTML to Markdown with preserved images
- Workflow.extractImagePositions(html) -> maps image positions for reconstruction

Example (in a userscript):
Workflow.configure({
proxyUrl: 'http://localhost:3004',
contentFormat: 'markdown', // ensures proper Turndown → Martian → Notion flow
preserveImagePositions: true
});
Workflow.registerExtractor('mySite', (document) => {
return { title, contentHtml, images, metadata }
});
Workflow.setExtractor('mySite');
(function(){
var REF_DEBUG = !!(typeof window !== 'undefined' && window.SN2N_REF_DEBUG);
Workflow.processCurrentPage().then(r => { if (REF_DEBUG && console && console.log) console.log('Saved to Notion:', r.pageUrl); });
})();

\*/

// Only show startup logs if debug mode would be enabled
if (
typeof window !== "undefined" &&
window.location.search.includes("w2n_debug=true")
) {
console.log(
"[W2N Workflow Module] Loading W2N Universal Workflow Module v2.1.9"
);
console.log(
"[W2N Workflow Module] TurndownService available:",
typeof TurndownService !== "undefined"
);
console.log(
"[W2N Workflow Module] Script context:",
typeof window !== "undefined" ? "browser/window" : "other"
);
}

// Note: verbose console overriding was removed to avoid affecting other scripts.
// Module-level logging is controlled by the `cfg.debug` flag or the
// `w2n_debug=true` URL query parameter (see `log()` below).

// Provide a safe global `log` shim for messages emitted after the module IIFE.
// This prevents ReferenceError when `log()` is used outside the IIFE.
(function () {
try {
if (typeof window !== "undefined") {
if (typeof window.log === "undefined") {
window.log = function (...args) {
try {
if (
window.location &&
window.location.search.includes("w2n_debug=true")
) {
if (typeof console !== "undefined" && console.log)
console.log("[W2N Workflow]", ...args);
}
} catch (e) {}
};
}
}
} catch (e) {}
})();

const Workflow = (function () {
const DEFAULT*PROXY = "http://localhost:3004";
let cfg = {
proxyUrl: DEFAULT_PROXY,
apiPath: "/api/W2N",
defaultDatabaseId: "24aa89fe-dba5-805d-80d1-e7e5db2e26a9",
debug: false,
contentFormat: "markdown", // 'html', 'markdown' - determines processing pipeline
preserveImagePositions: true, // maintain image positions in final Notion blocks
maxImageCount: 50, // increased for comprehensive content
safeChunk: 1800, // max chars per Notion rich_text paragraph block (conservative)
imageProcessingMode: "proxy", // 'proxy' = server downloads/uploads, 'notion-sdk' = direct SDK uploads, 'direct' = pass URLs only
turndownOptions: {
headingStyle: "atx", // # ## ### style headers
codeBlockStyle: "fenced", // ` code blocks
      fence: "`", // code block fence
emDelimiter: "*", // emphasis delimiter
strongDelimiter: "\*\*", // strong delimiter
linkStyle: "inlined", // [text](url) style links
linkReferenceStyle: "full", // full reference links
hr: "---", // horizontal rule
bulletListMarker: "-", // bullet list marker
preformattedCode: false, // don't escape code in <pre>
blankReplacement: function (content, node) {
// Handle special elements that should become line breaks
return node.isBlock ? "\n\n" : "";
},
},
};

const extractors = new Map();
let currentExtractor = "generic";
// module-level image metadata store (maps imageId -> metadata)
let imageMetadataStore = {};

function log(...args) {
try {
const urlDebug =
typeof window !== "undefined" &&
window.location.search.includes("w2n_debug=true");
if (cfg.debug || urlDebug) {
if (typeof console !== "undefined" && console.log)
console.log("[W2N Workflow]", ...args);
}
} catch (e) {
// swallow logging errors to avoid breaking host page
}
}

// -----------------------------
// Public configuration
// -----------------------------
function configure(options = {}) {
log("🔧 Configure called with options:", options);
log("🔧 Before merge - cfg.imageProcessingMode:", cfg.imageProcessingMode);
cfg = { ...cfg, ...options };
log("🔧 After merge - cfg.imageProcessingMode:", cfg.imageProcessingMode);
if (cfg.proxyUrl && cfg.proxyUrl.endsWith("/"))
cfg.proxyUrl = cfg.proxyUrl.slice(0, -1);
log("configured", cfg);
}

// -----------------------------
// Extractor registration
// -----------------------------
function registerExtractor(name, fn) {
if (!name || typeof fn !== "function")
throw new Error("registerExtractor requires (name, function)");
extractors.set(name, fn);
log("registered extractor", name);
}

function setExtractor(name) {
if (!extractors.has(name)) throw new Error("Unknown extractor: " + name);
currentExtractor = name;
log("current extractor set to", name);
}

function getExtractor(name) {
return (
extractors.get(name || currentExtractor) || extractors.get("generic")
);
}

// -----------------------------
// Generic extractor (fallback)
// -----------------------------
function genericExtractor(doc = document) {
// Minimal but practical generic extraction strategy
const title = (
doc.querySelector('meta[property="og:title"]')?.content ||
doc.title ||
""
).trim();
const url = doc.location?.href || window.location.href;

    // Heuristics: find <main>, <article>, or biggest text node
    let contentEl = doc.querySelector(
      "main, article, .content, #content, .post, .entry-content"
    );
    if (!contentEl) {
      // fallback: pick the largest element by textContent length
      let best = doc.body;
      let bestScore = 0;
      const candidates = Array.from(
        doc.body.querySelectorAll("div, section, article")
      );
      candidates.forEach((c) => {
        const score = (c.textContent || "").length;
        if (score > bestScore) {
          best = c;
          bestScore = score;
        }
      });
      contentEl = best;
    }

    const contentHtml = contentEl ? contentEl.innerHTML : doc.body.innerHTML;

    // images
    const imgs = Array.from((contentEl || doc).querySelectorAll("img"))
      .map((img) => ({ url: img.src, alt: img.alt || "" }))
      .filter((i) => i.url && !i.url.startsWith("data:"))
      .slice(0, cfg.maxImageCount);

    return { title, contentHtml, url, images: imgs, metadata: {} };

}

registerExtractor("generic", genericExtractor);

// -----------------------------
// Content Processing Pipeline
// -----------------------------

// HTML to Markdown conversion using Turndown.js
// Includes comprehensive image position tracking for Notion block reconstruction
function htmlToMarkdown(html, options = {}) {
// Initialize Turndown with optimized settings for Notion conversion
const turndownOptions = { ...cfg.turndownOptions, ...options };

    // Ensure Turndown is available (should be loaded by provider or universal template)
    if (typeof TurndownService === "undefined") {
      throw new Error(
        "TurndownService not available. Ensure Turndown.js is loaded."
      );
    }

    const turndown = new TurndownService(turndownOptions);

    // Add custom rules for Notion-specific block types
    turndown.addRule("notionTable", {
      filter: "table",
      replacement: function (content, node) {
        try {
          // Convert HTML table to Markdown table format for proper processing
          const rows = Array.from(node.querySelectorAll("tr"));
          if (!rows.length) {
            // If no table rows, fallback to preserving HTML for Martian
            log("No table rows found, preserving HTML");
            return "\n\n" + node.outerHTML + "\n\n";
          }

          const markdownRows = [];
          let isFirstRow = true;

          for (const row of rows) {
            const cells = Array.from(row.querySelectorAll("td, th"));
            if (!cells.length) continue;

            // Extract cell content and clean it
            const cellContents = cells.map((cell) => {
              let text = cell.textContent || "";
              // Clean up whitespace and remove line breaks for table cells
              text = text.replace(/\s+/g, " ").trim();
              // Escape pipes in cell content
              text = text.replace(/\|/g, "\\|");
              return text || " "; // Ensure empty cells have at least a space
            });

            // Create markdown table row
            const markdownRow = "| " + cellContents.join(" | ") + " |";
            markdownRows.push(markdownRow);

            // Add separator row after header (first row)
            if (isFirstRow) {
              const separatorCells = cells.map(() => "---");
              const separatorRow = "| " + separatorCells.join(" | ") + " |";
              markdownRows.push(separatorRow);
              isFirstRow = false;
            }
          }

          if (markdownRows.length === 0) {
            // Fallback to HTML if conversion fails
            log("Table markdown conversion failed, preserving HTML");
            return "\n\n" + node.outerHTML + "\n\n";
          }

          log("Successfully converted HTML table to Markdown format");
          // Return markdown table with proper spacing
          return "\n\n" + markdownRows.join("\n") + "\n\n";
        } catch (error) {
          console.warn("[W2N Workflow] Table conversion error:", error);
          // Fallback to HTML preservation for Martian processing
          return "\n\n" + node.outerHTML + "\n\n";
        }
      },
    });

    turndown.addRule("notionCode", {
      filter: ["pre", "code"],
      replacement: function (content, node, options) {
        const parent = node.parentElement;
        const isCodeBlock =
          node.tagName === "PRE" || (parent && parent.tagName === "PRE");

        if (isCodeBlock) {
          // Extract language from class if available
          const langMatch = node.className.match(/language-(\w+)/);
          const language = langMatch ? langMatch[1] : "";
          return "\n```" + language + "\n" + content + "\n```\n";
        } else {
          return "`" + content + "`";
        }
      },
    });

    // Add rule to clean up "[Invalid Image: ...]" text from failed iframe image loads
    turndown.addRule("cleanInvalidImageText", {
      filter: function (node) {
        // Match text nodes and elements containing invalid image text
        if (node.nodeType === Node.TEXT_NODE) {
          return /\[Invalid Image:\s*[^\]]+\]/i.test(node.textContent || "");
        }
        if (node.nodeType === Node.ELEMENT_NODE) {
          return /\[Invalid Image:\s*[^\]]+\]/i.test(node.textContent || "");
        }
        return false;
      },
      replacement: function (content, node) {
        // Remove all [Invalid Image: ...] patterns
        let cleanupCount = 0;
        const cleaned = content.replace(
          /\[Invalid Image:\s*([^\]]+)\]/gi,
          (match, imagePath) => {
            cleanupCount++;
            // Extract filename for a cleaner placeholder
            const filename = imagePath.split("/").pop();
            return `_[Image: ${filename}]_`;
          }
        );
        if (cleanupCount > 0) {
          log(`🧹 Cleaned ${cleanupCount} invalid image text patterns`);
        }
        return cleaned;
      },
    });

    // Add rule for preserving image metadata
    turndown.addRule("imageWithMetadata", {
      filter: "img",
      replacement: function (content, node) {
        const alt = node.getAttribute("alt") || "";
        const src = node.getAttribute("src") || "";
        const title = node.getAttribute("title") || "";

        // Check if image is inside a figure element and capture figcaption
        let figcaption = "";
        let parentFigure = node.closest("figure");
        if (parentFigure) {
          const figcaptionEl = parentFigure.querySelector("figcaption");
          if (figcaptionEl) {
            figcaption = figcaptionEl.textContent || "";
            figcaption = figcaption.trim();
            log(`Found figcaption for image: "${figcaption}"`);
          }
        }

        // Check if image is inside or near a blockquote element and capture its content
        let blockquote = "";
        let parentBlockquote = node.closest("blockquote");
        if (parentBlockquote) {
          // Clone the blockquote to avoid modifying the original
          const blockquoteClone = parentBlockquote.cloneNode(true);

          // Remove all img elements from the clone to get just the text content
          const images = blockquoteClone.querySelectorAll("img");
          images.forEach((img) => img.remove());

          blockquote = blockquoteClone.textContent || "";
          blockquote = blockquote.trim();

          if (blockquote) {
            log(`Found blockquote for image: "${blockquote}"`);
          }
        }

        // Create marker for image position tracking
        const imageId =
          "img_" + Date.now() + "_" + Math.random().toString(36).substr(2, 9);

        // Combine alt text, figcaption, and blockquote for comprehensive caption
        let combinedCaption = "";
        const captionParts = [alt, figcaption, blockquote].filter(
          (part) => part && part.trim()
        );

        if (captionParts.length > 1) {
          combinedCaption = captionParts.join(" - ");
        } else if (captionParts.length === 1) {
          combinedCaption = captionParts[0];
        }

        // Store image metadata for later processing
        // populate module-level store (and keep window global for backwards compatibility)
        const meta = {
          src: src,
          alt: alt,
          title: title,
          figcaption: figcaption,
          blockquote: blockquote,
          combinedCaption: combinedCaption,
          width: node.getAttribute("width"),
          height: node.getAttribute("height"),
          originalElement: node.outerHTML,
        };
        imageMetadataStore[imageId] = meta;
        try {
          if (typeof window !== "undefined") {
            window.W2N_IMAGE_METADATA = window.W2N_IMAGE_METADATA || {};
            window.W2N_IMAGE_METADATA[imageId] = meta;
          }
        } catch (e) {}

        // Return markdown with position marker (only if not using SDK mode)
        const titlePart = title ? ` "${title}"` : "";
        if (cfg.imageProcessingMode === "notion-sdk") {
          // In SDK mode, don't add markers as proxy handles positioning
          return `![${combinedCaption}](${src}${titlePart})`;
        } else {
          // In standard mode, add position markers for processing
          return `![${combinedCaption}](${src}${titlePart})[W2N-IMG-MARKER:${imageId}]`;
        }
      },
    });

    try {
      // Initialize image metadata storage
      if (typeof window !== "undefined") {
        window.W2N_IMAGE_METADATA = window.W2N_IMAGE_METADATA || {};
      }

      // Preprocess HTML to remove invalid image text before Turndown conversion
      let preprocessedHtml = html;
      const invalidImagePattern = /\[Invalid Image:\s*([^\]]+)\]/gi;

      // Debug: Show if we have any invalid image text in the input
      if (invalidImagePattern.test(html)) {
        const matches = html.match(invalidImagePattern);
        log(
          `🧹 Found ${matches.length} invalid image patterns in HTML - preprocessing...`
        );

        let cleanupCount = 0;
        preprocessedHtml = html.replace(
          invalidImagePattern,
          (match, imagePath) => {
            cleanupCount++;
            const filename = imagePath.split("/").pop();
            return `<em>[Image: ${filename}]</em>`;
          }
        );

        log(`✅ Preprocessing removed ${cleanupCount} invalid image patterns`);
      } else {
        log("✅ No invalid image patterns found in HTML input");
      }

      let markdown = turndown.turndown(preprocessedHtml);
      log("HTML converted to Markdown successfully");

      // Clean up image position markers that may remain in SDK mode
      markdown = markdown.replace(/\[W2N-IMG-MARKER:[^\]]+\]/g, "");
      log("Cleaned up W2N-IMG-MARKER placeholders from markdown");

      // Debug: Check if invalid image text survived the conversion
      const finalInvalidPattern = /\[Invalid Image:\s*([^\]]+)\]/gi;
      if (finalInvalidPattern.test(markdown)) {
        log("⚠️ Invalid image text still present in final markdown!");
        const finalMatches = markdown.match(finalInvalidPattern);
        if (finalMatches) {
          log(`⚠️ Found ${finalMatches.length} remaining patterns`);
        }
      } else {
        log("✅ No invalid image text found in final markdown");
      }

      return {
        markdown: markdown,
        imageMetadata: { ...imageMetadataStore },
        success: true,
      };
    } catch (error) {
      console.error(
        "[W2N Workflow] HTML to Markdown conversion failed:",
        error
      );
      return {
        markdown: html, // fallback to original HTML
        imageMetadata: { ...imageMetadataStore },
        success: false,
        error: error.message,
      };
    }

}

// Extract and map image positions from content for proper Notion block reconstruction
function extractImagePositions(content, type = "markdown") {
const imagePositions = [];

    if (type === "markdown") {
      // Find markdown images with position markers
      const imageRegex = /!\[([^\]]*)\]\(([^)]+)\)\[W2N-IMG-MARKER:([^\]]+)\]/g;
      let match;
      let position = 0;

      while ((match = imageRegex.exec(content)) !== null) {
        const [fullMatch, alt, src, imageId] = match;
        const beforeContent = content.substring(position, match.index);
        const paragraphsBefore = (beforeContent.match(/\n\s*\n/g) || []).length;

        const storedMeta =
          window.W2N_IMAGE_METADATA?.[imageId] ||
          imageMetadataStore[imageId] ||
          {};
        imagePositions.push({
          id: imageId || `pos_${imagePositions.length}`,
          alt: alt,
          src: src,
          position: match.index,
          paragraphPosition: paragraphsBefore,
          fullMatch: fullMatch,
          caption: storedMeta.combinedCaption || alt, // Use combined caption if available
          metadata: storedMeta,
        });

        position = match.index + fullMatch.length;
      }
    } else if (type === "html") {
      // Extract from HTML - fallback method
      const parser = new DOMParser();
      const doc = parser.parseFromString(content, "text/html");
      const images = doc.querySelectorAll("img");

      images.forEach((img, index) => {
        imagePositions.push({
          id: `html_${index}`,
          alt: img.getAttribute("alt") || "",
          src: img.getAttribute("src") || "",
          position: -1, // HTML position tracking more complex
          paragraphPosition: -1,
          metadata: {
            width: img.getAttribute("width"),
            height: img.getAttribute("height"),
            title: img.getAttribute("title"),
            originalElement: img.outerHTML,
          },
        });
      });
    }

    log(
      `Extracted ${imagePositions.length} image positions from ${type} content`
    );
    return imagePositions;

}

// -----------------------------
// Content chunking helper
// -----------------------------
function applySafeChunking(content, maxChunkSize = 2000) {
if (!content || !maxChunkSize) return content;

    // For markdown content, split by paragraphs (double newlines) and rechunk if needed
    const paragraphs = content.split(/\n\s*\n/).filter((p) => p.trim());
    const chunkedParagraphs = [];

    for (const paragraph of paragraphs) {
      if (paragraph.length <= maxChunkSize) {
        chunkedParagraphs.push(paragraph);
      } else {
        // Split long paragraphs by sentences, then by words if needed
        const sentences = paragraph.split(/(?<=[.!?])\s+/);
        let currentChunk = "";

        for (const sentence of sentences) {
          if (!currentChunk) {
            currentChunk = sentence;
          } else if ((currentChunk + " " + sentence).length <= maxChunkSize) {
            currentChunk += " " + sentence;
          } else {
            // Current chunk is full, save it and start new chunk
            chunkedParagraphs.push(currentChunk);
            currentChunk = sentence;
          }

          // If even a single sentence is too long, split by words
          if (currentChunk.length > maxChunkSize) {
            const words = currentChunk.split(/\s+/);
            let wordChunk = "";

            for (const word of words) {
              if (!wordChunk) {
                wordChunk = word;
              } else if ((wordChunk + " " + word).length <= maxChunkSize) {
                wordChunk += " " + word;
              } else {
                chunkedParagraphs.push(wordChunk);
                wordChunk = word;
              }
            }
            currentChunk = wordChunk;
          }
        }

        // Add the final chunk if it exists
        if (currentChunk.trim()) {
          chunkedParagraphs.push(currentChunk);
        }
      }
    }

    const result = chunkedParagraphs.join("\n\n");
    log(
      `Content chunked: ${paragraphs.length} paragraphs → ${chunkedParagraphs.length} chunks (max ${maxChunkSize} chars)`
    );
    return result;

}

// -----------------------------
// HTML normalization & sanitation
// -----------------------------
function normalizeHtml(html) {
if (!html) return "";
// Create a document fragment and remove scripts/styles
const parser = new DOMParser();
const doc = parser.parseFromString(html, "text/html");

    // Remove scripts, noscript, style, and form elements
    doc
      .querySelectorAll("script, noscript, style, form")
      .forEach((n) => n.remove());

    // Remove inline event handlers
    Array.from(doc.querySelectorAll("*")).forEach((el) => {
      const atts = Array.from(el.attributes || []).filter((a) =>
        /^on/i.test(a.name)
      );
      atts.forEach((a) => el.removeAttribute(a.name));
    });

    // Trim excessive whitespace inside text nodes
    function tidy(node) {
      node.childNodes.forEach((c) => {
        if (c.nodeType === Node.TEXT_NODE) {
          c.textContent = c.textContent.replace(/\s{2,}/g, " ").trim();
        } else if (c.nodeType === Node.ELEMENT_NODE) {
          tidy(c);
        }
      });
    }
    tidy(doc.body);

    return doc.body.innerHTML;

}

// -----------------------------
// Remove duplicate title from content
// -----------------------------
function removeDuplicateTitle(html, pageTitle) {
if (!html || !pageTitle || pageTitle.trim() === "") return html;

    const parser = new DOMParser();
    const doc = parser.parseFromString(html, "text/html");

    // Look for the first heading that matches the page title
    const headings = doc.querySelectorAll("h1, h2, h3, h4, h5, h6");

    for (const heading of headings) {
      const headingText = heading.textContent?.trim() || "";
      const titleText = pageTitle.trim();

      // Check for exact match or close match (ignoring case and minor punctuation)
      const normalizeText = (text) =>
        text
          .toLowerCase()
          .replace(/[^\w\s]/g, "")
          .trim();

      if (normalizeText(headingText) === normalizeText(titleText)) {
        log(`🔄 Removing duplicate title heading: "${headingText}"`);
        heading.remove();
        break; // Only remove the first match to avoid removing legitimate section titles
      }
    }

    return doc.body.innerHTML;

}

// -----------------------------
// Image extraction helper
// -----------------------------
function extractImagesFromHtml(html) {
const parser = new DOMParser();
const doc = parser.parseFromString(html, "text/html");
const images = Array.from(doc.querySelectorAll("img"))
.map((img) => ({ url: img.src, alt: img.alt || "" }))
.filter((i) => i.url && !i.url.startsWith("data:"))
.slice(0, cfg.maxImageCount);
return images;
}

// -----------------------------
// Hooks & Observability
// -----------------------------
const hooks = {
// uploadImage: async(imageMeta) => { return { success:true, notionFile: {...}, url: 'https://...' } }
uploadImage: null,
// blockTransform: async(blocks, context) => blocks
blockTransform: null,
};

const listeners = new Map();
function emit(event, data) {
(listeners.get(event) || []).forEach((cb) => {
try {
cb(data);
} catch (e) {
log("listener error", e);
}
});
}

function on(event, cb) {
if (!listeners.has(event)) listeners.set(event, []);
listeners.get(event).push(cb);
return () => {
const arr = listeners.get(event) || [];
listeners.set(
event,
arr.filter((f) => f !== cb)
);
};
}

// Expose hooks for consumers
function setHooks(obj = {}) {
Object.assign(hooks, obj);
log("hooks set", Object.keys(hooks));
}

// -----------------------------
// Image upload helper (default proxy-backed)
// Supports concurrency, retries, caching
// -----------------------------
async function defaultUploadImage(imageMeta, { signal } = {}) {
// imageMeta: { url, alt, title, imageId, metadata }
const maxAttempts = 3;
const baseDelay = 500; // ms

    // Use GM caching if available
    const cacheKey = `W2N_IMG_CACHE_${
      imageMeta.imageId || btoa(imageMeta.url)
    }`;
    try {
      if (typeof GM_getValue === "function") {
        const cached = await GM_getValue(cacheKey);
        if (cached) {
          return { success: true, cached: true, result: cached };
        }
      }
    } catch (e) {
      // ignore cache errors
    }

    const uploadUrl = `${cfg.proxyUrl}/upload-to-notion`;

    const doFetch = async () => {
      if (signal && signal.aborted) throw new Error("aborted");
      const body = JSON.stringify({
        url: imageMeta.url,
        alt: imageMeta.alt,
        title: imageMeta.title,
        imageId: imageMeta.imageId,
        metadata: imageMeta.metadata || {},
      });
      const resp = await fetch(uploadUrl, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body,
        signal,
      });
      if (!resp.ok) {
        const text = await resp.text();
        throw new Error(`upload failed ${resp.status}: ${text}`);
      }
      const json = await resp.json();
      try {
        if (typeof GM_setValue === "function")
          await GM_setValue(cacheKey, json);
      } catch (e) {}
      return json;
    };

    try {
      const json = await retryWithBackoff(doFetch, {
        attempts: maxAttempts,
        baseDelay,
        signal,
      });
      return { success: true, result: json };
    } catch (err) {
      log(
        `upload failed after retries for ${imageMeta.url}`,
        err.message || err
      );
      return { success: false, error: err.message || String(err) };
    }

}

// Orchestrate image uploads with concurrency
async function uploadImages(images, { concurrency = 3, signal } = {}) {
const results = {};
const queue = images.slice();
let active = 0;

    return new Promise((resolve, reject) => {
      const next = async () => {
        if (signal && signal.aborted) return reject(new Error("aborted"));
        if (!queue.length && active === 0) return resolve(results);
        while (active < concurrency && queue.length) {
          const img = queue.shift();
          active++;
          (async () => {
            try {
              const uploader = hooks.uploadImage || defaultUploadImage;
              emit("imageUploadStart", { image: img });
              const r = await uploader(img, { signal });
              results[img.imageId || img.url] = r;
              emit("imageUploadComplete", { image: img, result: r });
            } catch (e) {
              results[img.imageId || img.url] = {
                success: false,
                error: e.message || String(e),
              };
              emit("imageUploadError", { image: img, error: e });
            } finally {
              active--;
              emit("imageUploadProgress", { remaining: queue.length, active });
              next();
            }
          })();
        }
      };
      next();
    });

}

// -----------------------------
// Retry/backoff helper
// -----------------------------
async function retryWithBackoff(
fn,
{ attempts = 3, baseDelay = 300, factor = 2, signal } = {}
) {
let attempt = 0;
while (attempt < attempts) {
if (signal && signal.aborted) throw new Error("aborted");
try {
return await fn();
} catch (e) {
attempt++;
if (attempt >= attempts) throw e;
const delay = Math.floor(
baseDelay _ Math.pow(factor, attempt) + Math.random() _ baseDelay
);
await new Promise((r) => setTimeout(r, delay));
}
}
}

// simple concurrency limiter (returns a wrapped function that respects concurrency)
function concurrencyLimiter(fn, concurrency = 3) {
const queue = [];
let active = 0;
return function limited(...args) {
return new Promise((resolve, reject) => {
queue.push({ args, resolve, reject });
(async function next() {
if (active >= concurrency) return;
const item = queue.shift();
if (!item) return;
active++;
try {
const r = await fn(...item.args);
item.resolve(r);
} catch (e) {
item.reject(e);
} finally {
active--;
next();
}
})();
});
};
}

// -----------------------------
// Markdown -> Notion blocks conversion (adapter)
// Uses Martian on proxy or basic local conversion as fallback
// -----------------------------
async function markdownToBlocks(markdown, { signal } = {}) {
// If proxy/martian path preferred, call proxy to get blocks
if (
cfg.imageProcessingMode === "proxy" ||
cfg.imageProcessingMode === "notion-sdk"
) {
try {
const url = `${cfg.proxyUrl}/markdown-to-blocks`;
const resp = await fetch(url, {
method: "POST",
headers: { "Content-Type": "application/json" },
body: JSON.stringify({
markdown,
imageProcessingMode: cfg.imageProcessingMode, // Pass mode to proxy
}),
signal,
});
if (!resp.ok) throw new Error(`proxy martian failed ${resp.status}`);
const json = await resp.json();
return json.blocks || [];
} catch (e) {
log("proxy martian error, falling back to simple parser", e);
}
}

    // Fallback simple parser: split by double-newline into paragraphs; handle basic headings and lists
    const lines = markdown.split(/\n/);
    const blocks = [];
    let buf = [];

    function flushParagraph() {
      if (!buf.length) return;
      const text = buf.join("\n");
      if (cfg.safeChunk && text.length > cfg.safeChunk) {
        let start = 0;
        while (start < text.length) {
          const piece = text.substring(start, start + cfg.safeChunk);
          blocks.push({ type: "paragraph", text: piece });
          start += cfg.safeChunk;
        }
      } else {
        blocks.push({ type: "paragraph", text });
      }
      buf = [];
    }

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      if (/^#{1,6}\s/.test(line)) {
        flushParagraph();
        const depth = line.match(/^#+/)[0].length;
        blocks.push({
          type: `heading_${Math.min(depth, 3)}`,
          text: line.replace(/^#+\s*/, ""),
        });
      } else if (/^\s*[-*+]\s+/.test(line)) {
        flushParagraph();
        blocks.push({
          type: "bulleted_list_item",
          text: line.replace(/^\s*[-*+]\s+/, ""),
        });
      } else if (/^\s*\d+\.\s+/.test(line)) {
        flushParagraph();
        blocks.push({
          type: "numbered_list_item",
          text: line.replace(/^\s*\d+\.\s+/, ""),
        });
      } else if (/^```/.test(line)) {
        flushParagraph();
        const lang = line.replace(/```/, "").trim();
        const codeLines = [];
        i++;
        while (i < lines.length && !/^```/.test(lines[i])) {
          codeLines.push(lines[i]);
          i++;
        }
        blocks.push({
          type: "code",
          text: codeLines.join("\n"),
          language: lang,
        });
      } else if (/^>\s?/.test(line)) {
        flushParagraph();
        blocks.push({ type: "quote", text: line.replace(/^>\s?/, "") });
      } else if (/^---\s*$/.test(line)) {
        flushParagraph();
        blocks.push({ type: "divider" });
      } else if (/^\|.*\|/.test(line)) {
        // Markdown table detection
        flushParagraph();

        const tableLines = [line];
        let nextIndex = i + 1;

        // Collect consecutive table rows
        while (nextIndex < lines.length && /^\|.*\|/.test(lines[nextIndex])) {
          tableLines.push(lines[nextIndex]);
          nextIndex++;
        }

        // Skip separator row if present (e.g., |---|---|)
        if (tableLines.length > 1 && /^\|[\s-\|]+\|$/.test(tableLines[1])) {
          // Valid table with header separator
          const tableText = tableLines.join("\n");
          blocks.push({ type: "table", text: tableText });
        } else if (tableLines.length > 0) {
          // Table without proper separator, treat as paragraph but preserve structure
          const tableText = tableLines.join("\n");
          blocks.push({ type: "paragraph", text: tableText });
        }

        // Advance the index to skip processed table lines
        i = nextIndex - 1;
      } else {
        buf.push(line);
      }
    }
    flushParagraph();

    // Allow hook to transform blocks
    if (hooks.blockTransform) {
      try {
        const transformed = await hooks.blockTransform(blocks, { markdown });
        return transformed || blocks;
      } catch (e) {
        log("blockTransform hook error", e);
      }
    }

    return blocks;

}

// -----------------------------
// Replace image placeholders in blocks with Notion image blocks
// Input: blocks (array), resolvedImages {imageId|url: uploadResult}
// -----------------------------
function replacePlaceholdersWithImageBlocks(blocks, resolvedImages) {
const out = [];
for (const b of blocks) {
if (b.type === "paragraph" && typeof b.text === "string") {
// look for placeholder markers <!--W2N_IMG_imageId-->
const placeholderRegex = /<!--W2N_IMG_([^>]+)-->/g;
let m;
let lastIndex = 0;
const parts = [];
while ((m = placeholderRegex.exec(b.text)) !== null) {
const idx = m.index;
const imageId = m[1];
const before = b.text.substring(lastIndex, idx);
if (before && before.trim())
parts.push({ type: "paragraph", text: before });
const resolved =
resolvedImages[imageId] ||
resolvedImages[b.text.match(/\(([^)]+)\)/)?.[1]];
if (resolved && resolved.success) {
// create image block
const imageBlock = {
type: "image",
url:
resolved.result?.url ||
resolved.result?.hostedUrl ||
resolved.result?.notionFile?.url,
caption:
resolved.result?.caption ||
b.text.match(/!\[([^\]]\*)\]/)?.[1] ||
"",
};
parts.push(imageBlock);
} else {
// fallback: insert link block
const fallbackUrl = resolved
? resolved.result?.url || resolved.result?.hostedUrl
: null;
if (fallbackUrl)
parts.push({
type: "paragraph",
text: `[Image failed to upload](${fallbackUrl})`,
});
}
lastIndex = idx + m[0].length;
}
const tail = b.text.substring(lastIndex);
if (tail && tail.trim()) parts.push({ type: "paragraph", text: tail });

        if (parts.length) out.push(...parts);
        else out.push(b);
      } else {
        out.push(b);
      }
    }
    return out;

}

// -----------------------------
// Append blocks to Notion page in batches with backoff on 429
// This function delegates to proxy which should handle Notion auth
// -----------------------------
async function appendBlocksToPage(
pageId,
blocks,
{ batchSize = 10, pauseMs = 250, signal } = {}
) {
const url = `${cfg.proxyUrl}/append-blocks`;
let index = 0;
while (index < blocks.length) {
if (signal && signal.aborted) throw new Error("aborted");
const batch = blocks.slice(index, index + batchSize);
const resp = await fetch(url, {
method: "POST",
headers: { "Content-Type": "application/json" },
body: JSON.stringify({ pageId, blocks: batch }),
signal,
});
if (!resp.ok) {
if (resp.status === 429) {
// backoff then retry this batch
const wait = pauseMs _ 2 + Math.floor(Math.random() _ pauseMs);
await new Promise((r) => setTimeout(r, wait));
continue;
}
const txt = await resp.text();
throw new Error(`append blocks failed ${resp.status}: ${txt}`);
}
emit("blocksAppended", {
pageId,
batchIndex: index / batchSize,
batchCount: batch.length,
});
index += batchSize;
if (pauseMs) await new Promise((r) => setTimeout(r, pauseMs));
}
}

// -----------------------------
// Build payload for proxy
// -----------------------------
function buildPayload({
title,
contentHtml,
url,
images = [],
metadata = {},
databaseId = null,
icon = null,
cover = null,
}) {
let processedContent = contentHtml;
let imagePositions = [];
let finalImages = images;

    // Process content based on configuration and apply chunking
    if (contentHtml) {
      try {
        // First, remove duplicate title from HTML content if it exists
        const cleanedHtml = removeDuplicateTitle(contentHtml, title);

        log(
          "Converting HTML to Markdown with Turndown for proper table and image handling"
        );
        const conversionResult = htmlToMarkdown(cleanedHtml);

        if (conversionResult.success) {
          processedContent = conversionResult.markdown;

          // Apply safe chunking to prevent Notion validation errors
          processedContent = applySafeChunking(processedContent, cfg.safeChunk);

          // Extract image positions for proper Notion block reconstruction
          if (cfg.preserveImagePositions) {
            imagePositions = extractImagePositions(
              processedContent,
              "markdown"
            );
            log(
              `Mapped ${imagePositions.length} image positions for Notion reconstruction`
            );
          }

          // Merge extracted images with provided images, avoiding duplicates
          const extractedImages = imagePositions.map((pos) => ({
            url: pos.src,
            alt: pos.alt,
            caption: pos.caption || pos.alt, // Use combined caption from figcaption + alt
            imageId: pos.id,
            position: pos.paragraphPosition,
            metadata: pos.metadata,
          }));

          // Combine images, prioritizing those with position data
          const imageUrls = new Set();
          finalImages = [];

          // Helper function to extract filename from URL for matching
          function getImageFilename(url) {
            try {
              const urlObj = new URL(url, window.location.href);
              const pathname = urlObj.pathname;
              return pathname.split("/").pop() || "";
            } catch (e) {
              // Fallback for relative URLs
              return url.split("/").pop() || "";
            }
          }

          // Add positioned images first
          extractedImages.forEach((img) => {
            if (img.url && !imageUrls.has(img.url)) {
              finalImages.push(img);
              imageUrls.add(img.url);
            }
          });

          // Add remaining provided images, but try to match with existing images by filename
          images.forEach((img) => {
            if (img.url && !imageUrls.has(img.url)) {
              // Check if this image matches an existing image by filename
              const imgFilename = getImageFilename(img.url);
              let matchingImageId = null;
              let existingMatch = null;

              if (imgFilename) {
                // Look for an existing image with the same filename that has an imageId
                existingMatch = finalImages.find((existing) => {
                  const existingFilename = getImageFilename(existing.url);
                  return existingFilename === imgFilename && existing.imageId;
                });

                if (existingMatch) {
                  matchingImageId = existingMatch.imageId;
                  log(
                    `🔄 Detected same image with different URLs: ${imgFilename}`
                  );
                  log(
                    `  HTML version: ${existingMatch.url} (imageId: ${existingMatch.imageId}, caption: "${existingMatch.caption}")`
                  );
                  log(
                    `  Extracted version: ${img.url} (inheriting imageId and caption)`
                  );
                }
              }

              finalImages.push({
                url: img.url,
                alt: img.alt || "",
                caption:
                  matchingImageId && existingMatch
                    ? existingMatch.caption || img.caption || img.alt || ""
                    : img.caption || img.alt || "", // Inherit caption from matching image
                imageId: matchingImageId || img.imageId, // Use matched imageId or preserve original
                position: -1, // No specific position
                metadata: img.metadata || {},
              });
              imageUrls.add(img.url);
            }
          });
        } else {
          console.warn(
            "[W2N Workflow] Markdown conversion failed, using HTML:",
            conversionResult.error
          );
          processedContent = normalizeHtml(cleanedHtml);
          processedContent = applySafeChunking(processedContent, cfg.safeChunk);
          finalImages = images || extractImagesFromHtml(cleanedHtml);
        }
      } catch (error) {
        console.error("[W2N Workflow] Content processing error:", error);
        const cleanedHtml = removeDuplicateTitle(contentHtml, title);
        processedContent = normalizeHtml(cleanedHtml);
        processedContent = applySafeChunking(processedContent, cfg.safeChunk);
        finalImages = images || extractImagesFromHtml(cleanedHtml);
      }
    } else {
      // No content - use empty processed content
      processedContent = "";
      finalImages = images || [];
    }

    // Limit images to configured maximum
    if (finalImages.length > cfg.maxImageCount) {
      log(`Limiting images from ${finalImages.length} to ${cfg.maxImageCount}`);
      finalImages = finalImages.slice(0, cfg.maxImageCount);
    }

    const payload = {
      title: title || "Untitled",
      content: processedContent,
      url: url || window.location.href,
      images: finalImages,
      databaseId: databaseId || cfg.defaultDatabaseId,
      useMartian: true, // Always use Martian since we're sending processed Markdown
      // Set image processing parameters for proxy server
      directSDKImages: cfg.imageProcessingMode === "notion-sdk", // Enable direct SDK image processing
      imageHandling:
        cfg.imageProcessingMode === "notion-sdk" ? "direct_sdk" : "martian",
      // Add database properties as direct payload properties (for directFieldMapping)
      bookTitle: metadata["Book Title"],
      author: metadata.Author,
      epubID: metadata.epubID,
      epubType: metadata.epubType,
      metadata: {
        ...metadata, // Keep original metadata properties first
        contentFormat: "markdown", // Always markdown since we process HTML→Markdown
        originalContentFormat: cfg.contentFormat, // Track original config
        preserveImagePositions: cfg.preserveImagePositions,
        imagePositions: imagePositions,
        processingMode: cfg.imageProcessingMode,
        chunkingApplied: true,
        maxChunkSize: cfg.safeChunk,
      },
      // Preserve Source from metadata if provided, otherwise use workflow version
      source: metadata.Source || "W2N-Universal-Workflow-v2.2.4",
    };

    // Add icon if provided
    if (icon) {
      payload.icon = icon;
      log("🎭 Added icon to payload:", icon);
    }

    // Add cover if provided
    if (cover) {
      payload.cover = cover;
      log("🖼️ Added cover to payload:", cover);
    }

    log("built enhanced payload", payload);

    // Debug: Log image processing configuration
    log("🔧 BUILD PAYLOAD - cfg.imageProcessingMode:", cfg.imageProcessingMode);
    if (cfg.imageProcessingMode === "notion-sdk") {
      log("🖼️ Configured for direct Notion SDK image processing");
      log(
        `📸 Payload settings: directSDKImages=${payload.directSDKImages}, imageHandling=${payload.imageHandling}`
      );
      log(`🔢 Images to process: ${finalImages.length}`);
    }

    return payload;

}

// -----------------------------
// Send to proxy (uses GM_xmlhttpRequest when available, falls back to fetch)
// -----------------------------
function sendToProxy(payload) {
const url = `${cfg.proxyUrl}${cfg.apiPath}`;
log("sending to proxy", url, payload);

    // If GM_xmlhttpRequest is available (Tampermonkey), use it to avoid CORS issues
    if (typeof GM_xmlhttpRequest === "function") {
      return new Promise((resolve, reject) => {
        try {
          GM_xmlhttpRequest({
            method: "POST",
            url: url,
            headers: { "Content-Type": "application/json" },
            data: JSON.stringify(payload),
            onload: (resp) => {
              try {
                const result = JSON.parse(resp.responseText);
                log("proxy response", result);
                resolve(result);
              } catch (e) {
                log("proxy parse error", e);
                resolve({ error: "invalid_json", raw: resp.responseText });
              }
            },
            onerror: (err) => reject(err),
            ontimeout: () => reject(new Error("timeout")),
          });
        } catch (e) {
          reject(e);
        }
      });
    }

    // Fallback to fetch (may need CORS permission on proxy)
    return fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    })
      .then((r) => r.json())
      .catch((e) => ({ error: e.message || String(e) }));

}

// -----------------------------
// High-level orchestrator
// -----------------------------
async function processCurrentPage({
extractorName = null,
databaseId = null,
overrides = {},
} = {}) {
const extractor = getExtractor(extractorName);
if (!extractor) throw new Error("No extractor available");

    log("running extractor", extractorName || currentExtractor);

    const extracted = await Promise.resolve(extractor(document));

    const payload = buildPayload({
      title: extracted.title,
      contentHtml: extracted.contentHtml || extracted.content || "",
      url: extracted.url,
      images: extracted.images,
      metadata: extracted.metadata,
      databaseId: databaseId || extracted.databaseId || cfg.defaultDatabaseId,
      ...overrides,
    });

    const res = await sendToProxy(payload);
    return res;

}

// -----------------------------
// Process arbitrary content through full workflow
// This is the proper way for userscripts to send content through the Universal Workflow
// -----------------------------
async function processContent({
title,
contentHtml,
url = window.location.href,
images = [],
metadata = {},
databaseId = null,
icon = null,
cover = null,
overrides = {},
}) {
if (!title || !contentHtml) {
throw new Error("processContent requires title and contentHtml");
}

    log("processing content through Universal Workflow", {
      title: title.substring(0, 50) + "...",
      contentLength: contentHtml.length,
      imageCount: images.length,
      hasIcon: !!icon,
      hasCover: !!cover,
      metadata: metadata, // Debug: log the complete metadata object
    });

    // Build payload through the full workflow pipeline
    const payload = buildPayload({
      title,
      contentHtml,
      url,
      images,
      metadata,
      databaseId: databaseId || cfg.defaultDatabaseId,
      icon,
      cover,
      ...overrides,
    });

    // Debug: Check what's actually being sent to proxy
    if (payload.content) {
      const finalInvalidPattern = /\[Invalid Image:\s*([^\]]+)\]/gi;
      if (finalInvalidPattern.test(payload.content)) {
        const finalMatches = payload.content.match(finalInvalidPattern);
        console.error(
          `[W2N Workflow] 🚨 FINAL PAYLOAD HAS ${finalMatches.length} INVALID IMAGE PATTERNS!`
        );
        finalMatches.slice(0, 2).forEach((match, i) => {
          log(`  ${i + 1}: "${match}"`);
        });
      } else {
        log("✅ Final payload is clean");
      }
    }

    // Send through workflow-managed proxy communication
    const res = await sendToProxy(payload);
    return res;

}

// -----------------------------
// Small helpers
// -----------------------------
function chooseBestImage(images) {
if (!images || !images.length) return null;
// prefer larger images (try to get width from URL if available) — simple heuristic
return images[0];
}

// -----------------------------
// Expose public API
// -----------------------------
return {
// Core workflow configuration
configure,
registerExtractor,
setExtractor,
getExtractor,

    // PRIMARY WORKFLOW METHODS - Use these for all content processing
    processCurrentPage,
    processContent, // New: process arbitrary content through full workflow

    // Content processing utilities (read-only/analysis)
    extractImagesFromHtml,
    normalizeHtml,
    chooseBestImage,
    htmlToMarkdown,
    extractImagePositions,

    // Hook system for extensibility
    setHooks,
    on,

    // Advanced pipeline components (for custom workflows only)
    uploadImages,
    markdownToBlocks,
    replacePlaceholdersWithImageBlocks,
    appendBlocksToPage,

    // Utilities & debugging
    retryWithBackoff,
    concurrencyLimiter,
    _imageMetadata: () => ({ ...imageMetadataStore }),
    _cfg: () => ({ ...cfg, extractorCount: extractors.size }),

    // Convenience aliases
    run: (opts) => processCurrentPage(opts),

};
})();

// Expose in global for simple usage from userscripts/pages
try {
// Multiple exposure strategies to handle different contexts
if (typeof window !== "undefined") {
window.W2NWorkflow = Workflow;

    // Only show module loading logs if debug mode is enabled
    if (window.location.search.includes("w2n_debug=true")) {
      log("✅ Successfully exposed window.W2NWorkflow");
      log("Available methods:", Object.keys(Workflow));
      log("Workflow object type:", typeof Workflow);
      log("window.W2NWorkflow === Workflow:", window.W2NWorkflow === Workflow);
    }

    // Cross-context communication via DOM events
    // This handles Tampermonkey script isolation
    const workflowReadyEvent = new CustomEvent("W2N_WORKFLOW_READY", {
      detail: {
        available: true,
        methods: Object.keys(Workflow),
        version: "2.1.9",
        timestamp: Date.now(),
      },
    });
    document.dispatchEvent(workflowReadyEvent);

    if (window.location.search.includes("w2n_debug=true")) {
      log("📡 Dispatched W2N_WORKFLOW_READY event");
    }

    // Dispatch ready signal periodically to catch late-loading wrappers
    let readySignalCount = 0;
    const readySignalInterval = setInterval(() => {
      readySignalCount++;
      const delayedReadyEvent = new CustomEvent("W2N_WORKFLOW_READY", {
        detail: {
          available: true,
          methods: Object.keys(Workflow),
          version: "2.1.9",
          timestamp: Date.now(),
          signalNumber: readySignalCount,
        },
      });
      document.dispatchEvent(delayedReadyEvent);

      if (window.location.search.includes("w2n_debug=true")) {
        log(`📡 Dispatched delayed ready signal #${readySignalCount}`);
      }

      // Stop after 10 signals (10 seconds)
      if (readySignalCount >= 10) {
        clearInterval(readySignalInterval);
        log("📡 Stopped periodic ready signals");
      }
    }, 1000);

    // Listen for cross-context method calls
    document.addEventListener("W2N_WORKFLOW_CALL", async (event) => {
      log("📨 Received cross-context call:", event.detail);
      const { method, args, requestId } = event.detail;

      try {
        if (typeof Workflow[method] === "function") {
          const result = await Workflow[method](...args);
          const responseEvent = new CustomEvent("W2N_WORKFLOW_RESPONSE", {
            detail: {
              requestId,
              success: true,
              result,
            },
          });
          document.dispatchEvent(responseEvent);
          log("📤 Sent successful response for", method);
        } else {
          throw new Error(`Method ${method} not found on Workflow object`);
        }
      } catch (error) {
        const errorEvent = new CustomEvent("W2N_WORKFLOW_RESPONSE", {
          detail: {
            requestId,
            success: false,
            error: error.message || String(error),
          },
        });
        document.dispatchEvent(errorEvent);
        log("📤 Sent error response for", method, error);
      }
    });

    // Special event listener for wrapper ping requests
    document.addEventListener("W2N_WORKFLOW_PING", (event) => {
      log("🏓 Received ping, sending ready signal");
      const pingResponseEvent = new CustomEvent("W2N_WORKFLOW_READY", {
        detail: {
          available: true,
          methods: Object.keys(Workflow),
          version: "2.1.9",
          timestamp: Date.now(),
          responseType: "ping",
        },
      });
      document.dispatchEvent(pingResponseEvent);
    });

    // Handler for P2N userscript's nested event system
    document.addEventListener("W2N_WORKFLOW_EVENT", async (event) => {
      if (!event.detail) return;

      if (event.detail.type === "W2N_WORKFLOW_PING") {
        log("🏓 Received P2N ping, sending pong response");
        const pongResponseEvent = new CustomEvent("W2N_WORKFLOW_EVENT", {
          detail: {
            type: "W2N_WORKFLOW_PONG",
            requestId: event.detail.requestId,
            source: "W2N-Workflow-Module",
            available: true,
            methods: Object.keys(Workflow),
            version: "2.1.9",
            timestamp: Date.now(),
          },
        });
        document.dispatchEvent(pongResponseEvent);
      } else if (event.detail.type === "W2N_WORKFLOW_CALL") {
        const { requestId, method, args } = event.detail;
        log(`🔄 Received P2N method call: ${method}`);

        try {
          let result;
          if (typeof Workflow[method] === "function") {
            result = await Workflow[method](...(args || []));
          } else {
            throw new Error(`Method '${method}' not found on Workflow`);
          }

          // Send success response
          const responseEvent = new CustomEvent("W2N_WORKFLOW_EVENT", {
            detail: {
              type: "W2N_WORKFLOW_RESPONSE",
              requestId: requestId,
              success: true,
              result: result,
              source: "W2N-Workflow-Module",
              timestamp: Date.now(),
            },
          });
          document.dispatchEvent(responseEvent);
        } catch (error) {
          console.error(
            `[W2N Workflow Module] ❌ Method call failed: ${method}`,
            error
          );

          // Send error response
          const errorEvent = new CustomEvent("W2N_WORKFLOW_EVENT", {
            detail: {
              type: "W2N_WORKFLOW_RESPONSE",
              requestId: requestId,
              success: false,
              error: error.message || String(error),
              source: "W2N-Workflow-Module",
              timestamp: Date.now(),
            },
          });
          document.dispatchEvent(errorEvent);
        }
      }
    });

    // Verify exposure worked
    setTimeout(() => {
      log(
        "Verification - window.W2NWorkflow still available:",
        !!window.W2NWorkflow,
        typeof window.W2NWorkflow
      );
    }, 100);

} else {
console.warn("[W2N Workflow Module] window object not available");
}

// Try alternative exposure methods
if (typeof globalThis !== "undefined") {
globalThis.W2NWorkflow = Workflow;
log("Also exposed as globalThis.W2NWorkflow");
}

if (typeof self !== "undefined" && typeof window === "undefined") {
self.W2NWorkflow = Workflow;
log("Exposed as self.W2NWorkflow (worker context)");
}
} catch (error) {
console.error(
"[W2N Workflow Module] ❌ Failed to expose window.W2NWorkflow:",
error
);
console.error(
"[W2N Workflow Module] Error details:",
error.message,
error.stack
);
}

// Example automatic registration of a simple extractor for convenience (no-op if overwritten)
Workflow.registerExtractor &&
Workflow.registerExtractor("simple", (doc) => {
const title = doc.title || "";
const contentEl =
doc.querySelector("main, article, #content, .content") || doc.body;
const contentHtml = contentEl ? contentEl.innerHTML : doc.body.innerHTML;
const images = Array.from((contentEl || doc).querySelectorAll("img")).map(
(i) => ({ url: i.src, alt: i.alt || "" })
);
return { title, contentHtml, url: doc.location.href, images, metadata: {} };
});

// Periodic verification that window.W2NWorkflow remains exposed
// This helps debug if something is overwriting or clearing it
if (typeof window !== "undefined") {
let verificationCount = 0;
const verifyInterval = setInterval(() => {
verificationCount++;
const available = !!window.W2NWorkflow;
log(
`Verification ${verificationCount}/10 - window.W2NWorkflow available:`,
available
);

    if (!available && window.W2NWorkflow !== Workflow) {
      console.warn(
        `[W2N Workflow Module] ⚠️ window.W2NWorkflow was lost! Re-exposing...`
      );
      try {
        window.W2NWorkflow = Workflow;
        log(`✅ Re-exposed window.W2NWorkflow`);
      } catch (e) {
        console.error(`[W2N Workflow Module] ❌ Failed to re-expose:`, e);
      }
    }

    if (verificationCount >= 10) {
      clearInterval(verifyInterval);
      log(`Verification complete - final state:`, !!window.W2NWorkflow);
    }

}, 1000);
}
