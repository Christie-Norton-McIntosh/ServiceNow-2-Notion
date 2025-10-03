const express = require("express");
const cors = require("cors");
const { Client } = require("@notionhq/client");
const { createApi } = require("unsplash-js");
const dotenv = require("dotenv");
const fs = require("fs");
const path = require("path");
const axios = require("axios");

// Helper function to normalize URLs by resolving relative paths
function normalizeUrl(url, baseUrl = null) {
  if (!url || typeof url !== "string") {
    return url;
  }

  // Decode HTML entities first
  const decodedUrl = url
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'");

  // Handle hash-only URLs (like #ico-angle-arrow-right)
  if (decodedUrl.startsWith("#")) {
    // For hash-only URLs, we can either remove them or keep them as-is
    // Since they're internal page anchors, we'll keep them but mark them as relative
    return decodedUrl;
  }

  // Handle relative paths starting with /
  if (decodedUrl.startsWith("/")) {
    // If we have a base URL, use it to create an absolute URL
    if (baseUrl) {
      try {
        const base = new URL(baseUrl);
        return new URL(decodedUrl, base).href;
      } catch (error) {
        // If base URL is invalid, return the relative URL as-is
        return decodedUrl;
      }
    }
    // Without a base URL, return the relative path as-is
    // Don't add https:// to relative paths as it creates invalid URLs
    return decodedUrl;
  }

  // Handle relative paths starting with ./
  if (decodedUrl.startsWith("./")) {
    if (baseUrl) {
      try {
        const base = new URL(baseUrl);
        return new URL(decodedUrl, base).href;
      } catch (error) {
        return decodedUrl;
      }
    }
    return decodedUrl;
  }

  // Try to parse as a complete URL
  try {
    const urlObj = new URL(decodedUrl);

    // Get pathname and normalize it (resolve .. and .)
    let pathname = urlObj.pathname;

    // Split into segments and resolve relative paths
    const segments = pathname.split("/").filter((segment) => segment !== "");
    const resolved = [];

    for (const segment of segments) {
      if (segment === "..") {
        resolved.pop();
      } else if (segment !== ".") {
        resolved.push(segment);
      }
    }

    // Reconstruct the URL
    urlObj.pathname = "/" + resolved.join("/");
    return urlObj.href;
  } catch (error) {
    // If URL parsing fails, try simple relative path resolution
    if (decodedUrl.includes("../")) {
      const parts = decodedUrl.split("/");
      const resolved = [];

      for (const part of parts) {
        if (part === "..") {
          resolved.pop();
        } else if (part !== "." && part !== "") {
          resolved.push(part);
        }
      }
      return resolved.join("/");
    }
    return decodedUrl;
  }
}

// Create logs directory if it doesn't exist
const logsDir = path.join(__dirname, "logs");
if (!fs.existsSync(logsDir)) {
  fs.mkdirSync(logsDir);
}

// Set up logging (guarded: enable with SN2N_VERBOSE=1 or SN2N_REF_DEBUG env var)
const logFile = path.join(
  logsDir,
  `m2n-proxy-${new Date().toISOString().replace(/:/g, "-")}.log`
);
const _REF_DEBUG = !!(
  process.env.SN2N_VERBOSE === "1" || process.env.SN2N_REF_DEBUG
);
function refLog(message, data = null) {
  if (!_REF_DEBUG) return;
  const timestamp = new Date().toISOString();
  const logMessage = `[${timestamp}] ${message} ${
    data ? JSON.stringify(data) : ""
  }`;
  try {
    console.log(logMessage);
  } catch (e) {}
  try {
    fs.appendFileSync(logFile, logMessage + "\n");
  } catch (e) {}
}
// Backwards-compatible alias used in this reference file
const log = refLog;

/**
 * Validates if a URL is valid for external image blocks in Notion
 * @param {string} url - The URL to validate
 * @returns {boolean} - True if valid, false otherwise
 */
function isValidImageUrl(url) {
  if (!url || typeof url !== "string") return false;

  // Normalize the URL first to handle HTML entities
  const normalizedUrl = normalizeUrl(url);

  // Check for hash-only URLs (these are not image URLs)
  if (normalizedUrl.startsWith("#")) {
    return false;
  }

  // Check for relative URLs (these are invalid for Notion external images)
  if (
    normalizedUrl.startsWith("../") ||
    normalizedUrl.startsWith("./") ||
    normalizedUrl.startsWith("/")
  ) {
    return false;
  }

  // Check for valid URL format
  try {
    const urlObj = new URL(normalizedUrl);
    // Must be http or https
    if (!["http:", "https:"].includes(urlObj.protocol)) {
      return false;
    }

    // Additional validation for ServiceNow URLs and other problematic patterns
    // URLs without file extensions but with query parameters can cause issues
    const hasFileExtension = /\.(jpg|jpeg|png|gif|webp|bmp|svg)$/i.test(
      urlObj.pathname
    );
    const hasQueryParams = urlObj.search.length > 0;

    // ServiceNow image URLs often lack proper extensions and have query params
    // Example: https://servicenow-be-prod.servicenow.com/bundle/.../image/cm-integration-discovery?_LANG=enus
    if (
      urlObj.hostname.includes("servicenow") &&
      !hasFileExtension &&
      hasQueryParams
    ) {
      log(
        `🚫 ServiceNow image URL rejected (no extension + query params): ${url}`
      );
      return false;
    }

    // General validation: URLs without extensions and with complex query params are often problematic
    if (!hasFileExtension && hasQueryParams && urlObj.search.length > 20) {
      log(`🚫 Complex URL rejected (no extension + long query): ${url}`);
      return false;
    }

    // Check if the URL looks like a documentation page rather than an image
    const isDocumentationUrl =
      /\/(docs?|documentation|bundle|page|help|guide)/i.test(urlObj.pathname);
    if (isDocumentationUrl && !hasFileExtension) {
      log(`🚫 Documentation URL rejected as image: ${url}`);
      return false;
    }

    return true;
  } catch (error) {
    return false;
  }
}

// Load environment variables from .env file
dotenv.config();

// Load database property mappings from userscript (dynamic mapping only)
// Static db-mappings.json file removed in favor of dynamic property mapping
// Dynamic property mapping system: properties are now matched by name directly

// Workflow internal keys that should not be saved as database properties
const workflowInternalKeys = new Set([
  "proxyUrl",
  "contentFormat",
  "debugMode",
  "useProxy",
  "useMartian",
  "capturedAt",
  "pageUrl",
  "requestId",
  "databaseId",
]);

// Normalize Notion IDs (hyphenate 32-char IDs). Notion accepts both
// hyphenated and non-hyphenated UUIDs, but the hyphenated form is canonical
// and some SDKs/tools expect it. Use this helper before passing IDs to the SDK.
function hyphenateNotionId(id) {
  if (!id || typeof id !== "string") return id;
  const clean = id.replace(/[^a-f0-9]/gi, "");
  if (clean.length !== 32) return id;
  return clean.replace(/^(.{8})(.{4})(.{4})(.{4})(.{12})$/, "$1-$2-$3-$4-$5");
}

// Helper function to find a property in database schema by name
function findProperty(properties, names) {
  if (!properties || !names) return null;

  // Try each name in order of preference
  for (const name of names) {
    // Check for exact match (case-sensitive)
    if (properties[name]) {
      return { id: name, ...properties[name] };
    }

    // Check for case-insensitive match
    const lowerName = name.toLowerCase();
    for (const [propName, propConfig] of Object.entries(properties)) {
      if (propName.toLowerCase() === lowerName) {
        return { id: propName, ...propConfig };
      }
    }
  }

  return null;
}

// Initialize Notion client
const notion = new Client({
  auth: process.env.NOTION_TOKEN,
});

// Initialize Unsplash API (optional - only if UNSPLASH_ACCESS_KEY is provided)
const unsplash = process.env.UNSPLASH_ACCESS_KEY
  ? createApi({
      accessKey: process.env.UNSPLASH_ACCESS_KEY,
    })
  : null;

const app = express();
app.use(cors());
app.use(express.json({ limit: "25mb" }));

/**
 * Helper function to download an image from URL and upload it to Notion
 * @param {string} imageUrl - The external image URL to download and upload
 * @param {string} alt - Alt text for the image (used for filename)
 * @returns {Promise<string|null>} - Returns Notion file upload ID if successful, null if failed
 */
async function downloadAndUploadImage(imageUrl, alt = "image") {
  try {
    log(`⬇️ Downloading image from: ${imageUrl.substring(0, 50)}...`);

    // Download the image
    const response = await axios({
      method: "get",
      url: imageUrl,
      responseType: "stream",
      timeout: 30000, // 30 second timeout
      headers: {
        "User-Agent": "W2N-Proxy/1.0 (Web-to-Notion Image Processor)",
      },
    });

    // Get content type to determine file extension
    const contentType = response.headers["content-type"] || "image/jpeg";
    const extension = contentType.split("/").pop().split(";")[0];
    const filename = `${alt
      .replace(/[^a-zA-Z0-9]/g, "_")
      .substring(0, 20)}.${extension}`;

    // Convert stream to buffer
    const chunks = [];
    for await (const chunk of response.data) {
      chunks.push(chunk);
    }
    const buffer = Buffer.concat(chunks);

    log(`📤 Uploading ${filename} (${buffer.length} bytes) to Notion...`);

    if (!ensureFileUploadAvailable()) {
      log(`❌ File upload not available, falling back to external link`);
      return null;
    }

    // Use proper Notion SDK file upload flow (matching examples)
    log(`Step 1: Creating file upload object for ${filename}`);

    // Step 1: Create file upload using Notion SDK
    const fileUpload = await notion.fileUploads.create({
      mode: "single_part",
      filename: filename,
      content_type: contentType,
    });

    log(`✅ Created file upload object: ${fileUpload.id}`);

    // Step 2: Send the file using Notion SDK's proper method
    log(`Step 2: Uploading binary content for ${filename}`);

    const sentFileUpload = await notion.fileUploads.send({
      file_upload_id: fileUpload.id,
      file: {
        filename: filename,
        data: new Blob([buffer], { type: contentType }),
      },
    });

    log(`✅ File uploaded successfully: ${sentFileUpload.status}`);

    // Step 3: Return the file upload ID
    log(`✅ Image uploaded to Notion with ID: ${sentFileUpload.id}`);
    return sentFileUpload.id;
  } catch (error) {
    log(`❌ Failed to download/upload image: ${error.message}`);
    if (error.response) {
      log(`📄 Error response:`, error.response.data);
    }
    return null;
  }
}

/**
 * Upload a buffer (or base64) to Notion using the file_uploads HTTP flow
 * @param {Buffer} buffer
 * @param {string} filename
 * @param {string} contentType
 * @returns {Promise<string|null>} fileUploadId or null on failure
 */
async function uploadBufferToNotion(
  buffer,
  filename,
  contentType = "image/png"
) {
  try {
    if (!ensureFileUploadAvailable()) {
      log("❌ File upload not available, cannot upload buffer");
      return null;
    }

    log(`Step 1: Creating file upload object for ${filename}`);

    // Step 1: Create file upload using Notion SDK
    const fileUpload = await notion.fileUploads.create({
      mode: "single_part",
      filename: filename,
      content_type: contentType,
    });

    log(`✅ Created file upload object: ${fileUpload.id}`);

    // Step 2: Send the file using Notion SDK's proper method
    log(`Step 2: Uploading binary content for ${filename}`);

    const sentFileUpload = await notion.fileUploads.send({
      file_upload_id: fileUpload.id,
      file: {
        filename: filename,
        data: new Blob([buffer], { type: contentType }),
      },
    });

    log(`✅ File uploaded successfully: ${sentFileUpload.status}`);
    return sentFileUpload.id;
  } catch (err) {
    log(`❌ uploadBufferToNotion failed: ${err.message}`);
    if (err.response) log("📄 upload error response:", err.response.data);
    return null;
  }
}

/**
 * Dynamically determine if the "Figure/Image" database property should be checked
 * based on whether images were successfully uploaded to placeholders in the content
 * @param {Array} uploadedImageIds - Array of successfully uploaded image objects
 * @param {Object} notionBlocks - The processed Notion blocks (optional, for additional validation)
 * @returns {boolean} - True if images were uploaded and integrated into content
 */
function shouldSetFigureImageProperty(
  uploadedImageIds = [],
  notionBlocks = null
) {
  // Check if we have any successfully uploaded images
  const successfulUploads = uploadedImageIds.filter(
    (img) => img && img.uploadId && img.uploadId.trim() !== ""
  );

  if (successfulUploads.length === 0) {
    log("📊 [Figure/Image] No successfully uploaded images found");
    return false;
  }

  log(
    `📊 [Figure/Image] Found ${successfulUploads.length} successfully uploaded images`
  );

  // Additional validation: check if blocks contain image blocks (optional)
  if (notionBlocks && Array.isArray(notionBlocks)) {
    const imageBlocks = notionBlocks.filter(
      (block) => block && (block.type === "image" || block.image)
    );

    if (imageBlocks.length > 0) {
      log(
        `📊 [Figure/Image] Found ${imageBlocks.length} image blocks in Notion content`
      );
      return true;
    } else {
      log("📊 [Figure/Image] No image blocks found in final Notion content");
      // Still return true if we have successful uploads, as images may be embedded differently
      return successfulUploads.length > 0;
    }
  }

  // Default: return true if we have any successful uploads
  const shouldSet = successfulUploads.length > 0;
  log(
    `📊 [Figure/Image] Final decision: ${
      shouldSet ? "CHECK" : "UNCHECK"
    } the Figure/Image property`
  );
  return shouldSet;
}

// Support urlencoded and multipart form-data for upload testing endpoint
app.use(express.urlencoded({ extended: true, limit: "50mb" }));

// Serve static files (like test-upload.html) from the current directory
app.use(express.static(__dirname));

// Attach martian-helper and inject Notion client when present
const martianHelper = require(path.join(__dirname, "martian-helper.js"));
if (martianHelper && typeof martianHelper.setNotionClient === "function") {
  martianHelper.setNotionClient(notion);
}

// 🛡️ PROTECTION: Helper function for safe content processing
function createContentProcessingSandbox(
  payload,
  allowedProperties = ["content", "useMartian", "images", "directSDKImages"]
) {
  const sandbox = {};
  allowedProperties.forEach((prop) => {
    if (payload.hasOwnProperty(prop)) {
      sandbox[prop] = payload[prop];
    }
  });
  log(
    `🛡️ Created content processing sandbox with properties: ${Object.keys(
      sandbox
    ).join(", ")}`
  );
  return sandbox;
}

// Helper: verify Notion SDK supports fileUploads
function ensureFileUploadAvailable() {
  if (!notion) {
    log("File upload check failed: Notion client not initialized");
    return false;
  }
  if (!notion.fileUploads) {
    log("File upload check failed: notion.fileUploads not available");
    return false;
  }
  if (typeof notion.fileUploads.create !== "function") {
    log(
      "File upload check failed: notion.fileUploads.create is not a function"
    );
    return false;
  }
  log("File upload API is available");
  return true;
}

// Default directories for file uploads
const ICON_UPLOAD_DIR =
  "/Users/norton-mcintosh/Library/Mobile Documents/com~apple~CloudDocs/Images/Notion Icons";
const COVER_UPLOAD_DIR =
  "/Users/norton-mcintosh/Library/Mobile Documents/com~apple~CloudDocs/Images/Notion Covers";

// Create upload directories if they don't exist
[ICON_UPLOAD_DIR, COVER_UPLOAD_DIR].forEach((dir) => {
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
    log(`Created upload directory: ${dir}`);
  }
});

// Multer for multipart form uploads (file fields)
let multer;
try {
  multer = require("multer");
} catch (e) {
  multer = null;
}

// Configure multer with disk storage and custom destination based on file type
const storage = multer
  ? multer.diskStorage({
      destination: function (req, file, cb) {
        const type = req.body.type || "icon"; // Default to icon if type not specified
        const uploadDir = type === "cover" ? COVER_UPLOAD_DIR : ICON_UPLOAD_DIR;
        cb(null, uploadDir);
      },
      filename: function (req, file, cb) {
        // Generate unique filename with timestamp
        const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
        const ext = path.extname(file.originalname);
        const name = path.basename(file.originalname, ext);
        cb(null, `${name}_${timestamp}${ext}`);
      },
    })
  : null;

const upload = multer && storage ? multer({ storage: storage }) : null;

log("Notion token configured:", !!process.env.NOTION_TOKEN);

// Basic info endpoint
app.get("/", (req, res) => {
  res.send("m2n proxy server running with proper Notion API integration");
});

// Health check endpoint
app.get("/health", (req, res) => {
  res.json({
    status: "ok",
    timestamp: new Date().toISOString(),
    version: "0.0.6",
    notion: {
      clientInitialized: !!notion,
      tokenConfigured: !!process.env.NOTION_TOKEN,
    },
  });
});

// Debug info
app.get("/debug", (req, res) => {
  res.json({
    notionClientInitialized: !!notion,
    envVars: {
      notionTokenSet: !!process.env.NOTION_TOKEN,
      notionTokenLength: process.env.NOTION_TOKEN
        ? process.env.NOTION_TOKEN.length
        : 0,
      notionTokenPrefix: process.env.NOTION_TOKEN
        ? process.env.NOTION_TOKEN.substring(0, 5) + "..."
        : "Not set",
    },
  });
});

// Serve embedded emoji metadata for clients (CSP-safe)
app.get("/api/emoji-data", (req, res) => {
  try {
    const filePath = path.join(__dirname, "emoji-data.json");
    if (fs.existsSync(filePath)) {
      const data = fs.readFileSync(filePath, "utf8");
      res.setHeader("Content-Type", "application/json");
      res.send(data);
    } else {
      res
        .status(404)
        .json({ success: false, error: "emoji-data.json not found" });
    }
  } catch (e) {
    log("Error serving emoji-data.json:", e.message);
    res.status(500).json({ success: false, error: e.message });
  }
});

// Test endpoint for page creation
app.get("/test-page", async (req, res) => {
  try {
    // Default test database ID
    const databaseId =
      req.query.databaseId || "24ca89fe-dba5-806f-91a6-e831a6efe344";

    // First verify connection
    try {
      const me = await notion.users.me();
      log("Connected to Notion as:", me.name);
    } catch (authError) {
      return res.status(401).json({
        error: "Authentication failed",
        details: authError.message,
      });
    }

    // Try to create a test page
    try {
      log("Creating test page in database:", databaseId);

      const response = await notion.pages.create({
        parent: {
          database_id: databaseId,
        },
        properties: {
          // Adjust this based on your actual database schema
          Name: {
            title: [
              {
                text: {
                  content: "Test Page " + new Date().toISOString(),
                },
              },
            ],
          },
        },
        children: [
          {
            object: "block",
            type: "paragraph",
            paragraph: {
              rich_text: [
                {
                  type: "text",
                  text: {
                    content:
                      "This is a test page created to diagnose mock URL issues.",
                  },
                },
              ],
            },
          },
        ],
      });

      log("Page created successfully!");
      log("Response URL:", response.url);
      log("Page ID:", response.id);

      return res.json({
        success: true,
        pageId: response.id,
        pageUrl: response.url,
        message: "Page created successfully",
      });
    } catch (pageError) {
      return res.status(500).json({
        error: "Failed to create page",
        details: pageError.message,
        code: pageError.code || "unknown",
      });
    }
  } catch (err) {
    return res.status(500).json({
      error: "Internal server error",
      details: err.message,
    });
  }
});

// Check duplicates endpoint (simple implementation)
app.post("/api/check-duplicates", async (req, res) => {
  try {
    // For now, just return no duplicates found
    // This can be enhanced later with actual duplicate checking logic
    res.json({ duplicates: [] });
  } catch (error) {
    log(`❌ Check duplicates error: ${error.message}`);
    res.status(500).json({ error: "Failed to check duplicates" });
  }
});

// Main API endpoint for W2N
app.post("/api/W2N", async (req, res) => {
  try {
    // Validate input
    const payload = req.body;
    log("📝 Processing W2N request");

    // Debug: Log database properties in payload
    console.log("🔍 [Proxy] Received payload properties:");
    console.log("  - payload.bookTitle:", payload.bookTitle);
    console.log("  - payload.author:", payload.author);
    console.log("  - payload.epubID:", payload.epubID);
    console.log("  - payload.epubType:", payload.epubType);
    if (payload.metadata) {
      console.log(
        "  - metadata['Book Title']:",
        payload.metadata["Book Title"]
      );
      console.log("  - metadata.Author:", payload.metadata.Author);
      console.log("  - metadata.epubID:", payload.metadata.epubID);
      console.log("  - metadata.epubType:", payload.metadata.epubType);
    }

    // Log sanitization information if present
    if (payload.sanitized) {
      log(
        "🧹 Content sanitization was applied by userscript:",
        payload.sanitizationDetails
      );
      console.log("🧹 SANITIZATION APPLIED:", {
        sanitized: payload.sanitized,
        details: payload.sanitizationDetails,
      });
    }

    // Debug: Log icon and cover data if present
    if (payload.icon) {
      log("🔍 Icon data received:", payload.icon);
    }
    if (payload.cover) {
      log("🔍 Cover data received:", payload.cover);
    }

    // ✅ PRESERVE HTML CONTENT - Don't convert to plain text, let Martian handle HTML conversion
    if (!payload.content && payload.contentHtml) {
      log(
        "🔧 HTML content provided without plain content - will use Martian for HTML→Notion conversion"
      );
      // Don't coerce to plain text - let Martian properly convert HTML to Notion blocks
      // This preserves tables, links, and formatting that would be lost in plain text conversion
    }

    if (!payload.title || (!payload.content && !payload.contentHtml)) {
      log("❌ Missing required fields");
      return res.status(400).json({
        error: "Missing required fields: title and (content or contentHtml)",
      });
    }

    if (!payload.databaseId) {
      log("❌ Missing databaseId");
      return res.status(400).json({
        error: "Missing databaseId",
      });
    }

    // Verify Notion client is available
    if (!notion) {
      log("❌ Notion client not initialized");
      return res.status(500).json({
        error: "Notion API client not initialized",
        details: "Check that NOTION_TOKEN is set in your .env file",
      });
    }

    log(
      `📋 Creating page in database ${payload.databaseId} with title: ${payload.title}`
    );

    try {
      // 🛡️ PROTECTION: Preserve icon/cover data before any processing
      const preservedIconCover = {
        icon: payload.icon ? JSON.parse(JSON.stringify(payload.icon)) : null,
        cover: payload.cover ? JSON.parse(JSON.stringify(payload.cover)) : null,
      };
      log(
        "🛡️ Preserved icon/cover data for protection during content processing"
      );

      // Initialize array to track uploaded image mappings for Martian post-processing
      const uploadedImageIds = [];

      // Hoist pageCreateObject so it can be inspected in error handlers for debugging
      let pageCreateObject = null;

      // Retrieve database schema
      const dbInfo = await notion.databases.retrieve({
        database_id: payload.databaseId,
      });

      // Find title property (prefer explicit title type)
      const properties = {};
      let titleProperty = null;

      // First pass: exact type match
      for (const [name, prop] of Object.entries(dbInfo.properties)) {
        if (prop && prop.type === "title") {
          titleProperty = name;
          break;
        }
      }

      // Second pass: fallback to common name "Name"
      if (!titleProperty && dbInfo.properties["Name"]) {
        titleProperty = "Name";
      }

      // Last resort: pick the first property and hope for the best
      if (!titleProperty) {
        const firstProp = Object.keys(dbInfo.properties)[0];
        log(
          `⚠️ No canonical title property found; falling back to first property: ${firstProp}`
        );
        titleProperty = firstProp;
      }

      log(`📌 Selected title property key: '${titleProperty}'`);

      // Ensure the selected title property is set with the correct Notion shape
      try {
        const titlePropConfig = dbInfo.properties[titleProperty];
        if (!titlePropConfig || titlePropConfig.type !== "title") {
          // Try to locate any property that truly is a title type
          const realTitle = Object.entries(dbInfo.properties).find(
            ([n, p]) => p && p.type === "title"
          );
          if (realTitle) {
            const realTitleName = realTitle[0];
            log(
              `🔧 Coercing title to actual title property '${realTitleName}' instead of '${titleProperty}'`
            );
            titleProperty = realTitleName;
          } else {
            log(
              "⚠️ No property with type 'title' exists in DB schema; will still set chosen property with title shape"
            );
          }
        }
      } catch (e) {
        log("⚠️ Title property detection failed:", e.message);
      }

      // Finally, set the title property using the correct Notion 'title' shape
      properties[titleProperty] = {
        title: [{ text: { content: String(payload.title || "") } }],
      };

      // Handle URL if present - preserve original URL for database storage
      if (payload.url) {
        log(`🔍 Processing URL: ${payload.url}`);

        // Store the original URL for database storage - this needs to be complete
        const originalUrl = payload.url;
        log(`🔗 Original URL for database: ${originalUrl}`);

        // For now, skip URL cleaning/validation since we need the full URL
        // The URL property in the database should preserve the complete Percipio URL
        // including fragments and query parameters for proper navigation
        cleanUrl = originalUrl;

        // Get database schema to determine properties
        const dbSchema = await notion.databases.retrieve({
          database_id: payload.databaseId,
        });
        console.log("📋 Database schema retrieved");

        // Find URL-like property and set it according to the property's actual type
        const urlProperty = findProperty(dbSchema.properties, [
          "URL",
          "url",
          "Url",
          "Link",
          "link",
        ]);

        // Helper: set a property value based on its Notion type
        function setPropertyValueByType(propName, propConfig, value) {
          const t = propConfig && propConfig.type ? propConfig.type : null;
          try {
            if (t === "url") {
              // Validate URL before setting it
              const isValidUrl = (url) => {
                try {
                  if (!url || typeof url !== "string") return false;

                  const trimmed = url.trim();
                  if (trimmed === "" || trimmed.length > 2048) return false;

                  // Reject obviously malformed URLs
                  if (
                    trimmed.includes(" ") ||
                    trimmed.includes("|") ||
                    trimmed.includes("{") ||
                    trimmed.includes("}") ||
                    trimmed.includes("[") ||
                    trimmed.includes("]") ||
                    trimmed.includes("???") ||
                    trimmed.includes("\\")
                  ) {
                    return false;
                  }

                  // Must start with http:// or https://
                  if (
                    !trimmed.startsWith("http://") &&
                    !trimmed.startsWith("https://")
                  ) {
                    return false;
                  }

                  const urlObj = new URL(trimmed);

                  // Must have valid protocol and hostname
                  if (
                    (urlObj.protocol !== "http:" &&
                      urlObj.protocol !== "https:") ||
                    !urlObj.hostname ||
                    urlObj.hostname.length === 0
                  ) {
                    return false;
                  }

                  // Reject localhost URLs (they won't work in Notion)
                  if (
                    urlObj.hostname === "localhost" ||
                    urlObj.hostname === "127.0.0.1"
                  ) {
                    return false;
                  }

                  // Hostname should contain at least one dot (proper domain)
                  if (!urlObj.hostname.includes(".")) {
                    return false;
                  }

                  // Reject URLs with excessive parameters that might be malformed
                  if (urlObj.search && urlObj.search.length > 1000) {
                    return false;
                  }

                  return true;
                } catch (error) {
                  return false;
                }
              };

              // Use the same sanitization approach for consistency
              const urlValue = String(value);
              try {
                // Simple validation that allows the URL through if it's basically valid
                const urlObj = new URL(urlValue);
                if (
                  urlObj.protocol === "http:" ||
                  urlObj.protocol === "https:"
                ) {
                  properties[propName] = { url: urlObj.href };
                  log(`✅ Set URL property ${propName}: ${urlObj.href}`);
                } else {
                  throw new Error("Invalid protocol");
                }
              } catch (error) {
                log(
                  `⚠️ URL validation failed for property ${propName}: "${urlValue}" - converting to rich_text`
                );
                // Fallback to rich_text instead of failing
                properties[propName] = {
                  rich_text: [{ type: "text", text: { content: urlValue } }],
                };
              }
            } else if (t === "rich_text") {
              properties[propName] = {
                rich_text: [{ type: "text", text: { content: String(value) } }],
              };
            } else if (t === "title") {
              properties[propName] = {
                title: [{ text: { content: String(value) } }],
              };
            } else if (t === "text") {
              // Some schemas may use 'text' (rare) - use rich_text as fallback
              properties[propName] = {
                rich_text: [{ type: "text", text: { content: String(value) } }],
              };
            } else if (t === "checkbox") {
              // Handle checkbox properties - convert various values to boolean
              const checkboxValue =
                value === true ||
                value === "true" ||
                value === "1" ||
                value === 1 ||
                value === "yes" ||
                value === "on" ||
                (typeof value === "string" && value.toLowerCase() === "true");
              properties[propName] = { checkbox: checkboxValue };
            } else if (t === "select") {
              // Handle select properties with name-based selection
              properties[propName] = {
                select: { name: String(value) },
              };
            } else {
              // Unknown/unsupported property type - fall back to rich_text
              properties[propName] = {
                rich_text: [{ type: "text", text: { content: String(value) } }],
              };
            }
            log(`✅ Set property '${propName}' (type:${t || "unknown"})`);
          } catch (err) {
            log(`⚠️ Failed to set property '${propName}': ${err.message}`);
          }
        }

        if (urlProperty && cleanUrl) {
          try {
            // Ensure it's a valid URL
            new URL(cleanUrl);

            // Determine the human-readable property name in the DB schema
            // urlProperty.id here may contain the property's internal id (e.g., 'FXFJ')
            // so find the property name (key) whose config.id matches it.
            let propName = null;
            const targetId = urlProperty.id;
            for (const [pn, pc] of Object.entries(dbSchema.properties)) {
              if (pc && pc.id === targetId) {
                propName = pn;
                break;
              }
            }

            // As a fallback, if we couldn't find by matching id, attempt to use
            // the returned urlProperty.id as a name (legacy behavior)
            if (!propName)
              propName = urlProperty.id || Object.keys(dbSchema.properties)[0];

            // Force the correct Notion shape for URL properties to avoid validation errors
            properties[propName] = { url: cleanUrl };
            log(
              `✅ Forced URL property '${propName}' to { url: '${cleanUrl}' }`
            );
          } catch (urlError) {
            log(
              `⚠️ URL validation failed for: ${cleanUrl}, skipping URL property`
            );
          }
        } else if (urlProperty) {
          log(
            "📝 URL-like property exists but no valid URL available, skipping"
          );
        } else {
          log("📝 No URL-like property found in database schema");
        }

        // Map direct payload fields to properties (backward compatibility) - MOVED HERE TO ACCESS dbSchema
        // NOTE: Updated mapping for new ServiceNow properties. Removed old properties no longer in use.
        const directFieldMapping = {
          source: "Source", // Map payload.source to "Source" property
          // figureImage: "Figure/Image", // This is handled automatically by image upload logic
          version: "Version", // Map payload.version to "Version" property
          updated: "Updated", // Map payload.updated to "Updated" property
        };

        for (const [payloadField, propertyName] of Object.entries(
          directFieldMapping
        )) {
          if (
            payload[payloadField] !== undefined &&
            payload[payloadField] !== null &&
            payload[payloadField] !== "" &&
            !properties[propertyName]
          ) {
            const value = payload[payloadField];
            console.log(
              `🔍 [Proxy] Processing direct field mapping: ${payloadField} -> ${propertyName}: ${value}`
            );
            log(
              `📝 Mapping direct field ${payloadField} -> ${propertyName}: ${value}`
            );

            // Use the setPropertyValueByType function to handle different property types
            const propertyConfig = dbSchema.properties[propertyName];
            log(
              `🔍 Debug: Property ${propertyName} config: ${JSON.stringify(
                propertyConfig
              )}`
            );
            try {
              setPropertyValueByType(propertyName, propertyConfig, value);
            } catch (setPropError) {
              log(
                `❌ Error in setPropertyValueByType for ${propertyName}: ${setPropError.message}`
              );
              // Fallback to rich_text
              properties[propertyName] = {
                rich_text: [{ text: { content: String(value) } }],
              };
            }
            log(`✅ Added mapped property: ${propertyName}`);
          } else if (
            payload[payloadField] === undefined ||
            payload[payloadField] === null ||
            payload[payloadField] === ""
          ) {
            log(
              `⏭️ Skipping ${payloadField} -> ${propertyName}: value is empty/undefined`
            );
          }
        }
      }

      // Process custom metadata using direct property name matching
      // Dynamic property mapping system: metadata properties should match database property names
      if (payload.metadata && typeof payload.metadata === "object") {
        log(
          `🔍 Processing ${
            Object.keys(payload.metadata).length
          } metadata properties with direct name matching`
        );

        Object.entries(payload.metadata).forEach(([key, value]) => {
          log(
            `🔍 Debug: Processing metadata key: "${key}" with value: "${value}"`
          );

          // Skip workflow internal keys
          if (workflowInternalKeys.has(key)) {
            log(`⏭️ Skipping workflow internal key: ${key}`);
            return;
          }

          // Skip empty values
          if (value === undefined || value === null || value === "") {
            log(`⏭️ Skipping empty value for key: ${key}`);
            return;
          }

          // Try to find a property in dbInfo.properties with a matching name (case-insensitive)
          const match = Object.entries(dbInfo.properties).find(
            ([propName]) => propName.toLowerCase() === key.toLowerCase()
          );

          if (match) {
            const [propName, propertyConfig] = match;
            log(
              `✅ Found direct property name match: "${key}" -> "${propName}"`
            );

            try {
              // Set property using the property NAME as the key (Notion expects property names)
              if (propertyConfig.type === "rich_text") {
                properties[propName] = {
                  rich_text: [{ text: { content: String(value) } }],
                };
              } else if (propertyConfig.type === "title") {
                properties[propName] = {
                  title: [{ text: { content: String(value) } }],
                };
              } else if (propertyConfig.type === "url") {
                let urlValue = String(value);

                // Sanitize URL for Notion compatibility while preserving it as a URL
                const sanitizeUrlForNotion = (url) => {
                  try {
                    if (!url || typeof url !== "string") return null;

                    let trimmed = url.trim();
                    if (trimmed === "" || trimmed.length > 2048) return null;

                    // Remove obviously problematic characters that would break URLs
                    if (
                      trimmed.includes(" ") ||
                      trimmed.includes("|") ||
                      trimmed.includes("{") ||
                      trimmed.includes("}") ||
                      trimmed.includes("[") ||
                      trimmed.includes("]") ||
                      trimmed.includes("???") ||
                      trimmed.includes("\\")
                    ) {
                      return null;
                    }

                    // Must start with http:// or https://
                    if (
                      !trimmed.startsWith("http://") &&
                      !trimmed.startsWith("https://")
                    ) {
                      return null;
                    }

                    const urlObj = new URL(trimmed);

                    // Must have valid protocol and hostname
                    if (
                      (urlObj.protocol !== "http:" &&
                        urlObj.protocol !== "https:") ||
                      !urlObj.hostname ||
                      urlObj.hostname.length === 0
                    ) {
                      return null;
                    }

                    // Reject localhost URLs (they won't work in Notion)
                    if (
                      urlObj.hostname === "localhost" ||
                      urlObj.hostname === "127.0.0.1"
                    ) {
                      return null;
                    }

                    // Hostname should contain at least one dot (proper domain)
                    if (!urlObj.hostname.includes(".")) {
                      return null;
                    }

                    // URL seems valid - return the cleaned version
                    // Notion might be rejecting due to encoding issues, so let's ensure clean encoding
                    return urlObj.href;
                  } catch (error) {
                    log(
                      `❌ URL validation failed for ${url}: ${error.message}`
                    );
                    return null;
                  }
                };

                const sanitizedUrl = sanitizeUrlForNotion(urlValue);
                if (sanitizedUrl) {
                  properties[propName] = { url: sanitizedUrl };
                  log(
                    `✅ Set sanitized URL property ${propName}: ${sanitizedUrl}`
                  );
                } else {
                  log(
                    `⚠️ Cannot sanitize URL for property ${propName}: "${urlValue}" - converting to rich_text`
                  );
                  // Fallback to rich_text for problematic URLs
                  properties[propName] = {
                    rich_text: [{ text: { content: urlValue } }],
                  };
                }
              } else if (propertyConfig.type === "checkbox") {
                const checkboxValue =
                  value === true ||
                  value === "true" ||
                  value === "1" ||
                  value === 1 ||
                  value === "yes" ||
                  value === "on" ||
                  (typeof value === "string" && value.toLowerCase() === "true");
                properties[propName] = { checkbox: checkboxValue };
              } else if (
                propertyConfig.type === "select" &&
                propertyConfig.select
              ) {
                const matchingOption = propertyConfig.select.options.find(
                  (opt) =>
                    opt.name.toLowerCase() === String(value).toLowerCase()
                );
                if (matchingOption) {
                  properties[propName] = {
                    select: { name: matchingOption.name },
                  };
                } else {
                  log(
                    `⚠️ No matching select option for ${key}: ${value}, using rich_text fallback`
                  );
                  properties[propName] = {
                    rich_text: [{ text: { content: String(value) } }],
                  };
                }
              } else {
                // Fallback to rich_text for unknown property types
                properties[propName] = {
                  rich_text: [{ text: { content: String(value) } }],
                };
              }
              log(
                `✅ Set metadata property ${key} -> ${propName} (${propertyConfig.type})`
              );
            } catch (error) {
              log(
                `❌ Error setting metadata property ${key}: ${error.message}`
              );
            }
          } else {
            log(`⚠️ No database property found matching metadata key: ${key}`);
          }
        });
      }

      // MOVED: Process and upload images from content BEFORE Martian conversion
      // This ensures uploadedImageIds is populated for post-processing
      if (
        payload.images &&
        Array.isArray(payload.images) &&
        payload.images.length > 0
      ) {
        log(`📸 Processing ${payload.images.length} images from content...`);

        for (let i = 0; i < payload.images.length; i++) {
          const img = payload.images[i];
          log(`🔍 Debug image ${i + 1}:`, JSON.stringify(img, null, 2));
          if (!img || !img.url) {
            log(`⚠️ Skipping invalid image ${i + 1}`);
            continue;
          }

          try {
            // Skip data URIs or base64 - for now only handle external URLs
            if (img.url.startsWith("data:") || img.url.startsWith("blob:")) {
              log(
                `⚠️ Skipping data/blob URL image ${i + 1} (not supported yet)`
              );
              continue;
            }

            let uploadId = null;

            // If userscript pre-uploaded and provided a fileUploadId, use it
            if (img.fileUploadId) {
              uploadId = img.fileUploadId;
              log(`Using provided fileUploadId for image ${i + 1}`);
            }

            // If image is provided as base64/data, upload buffer directly
            if (!uploadId && img.base64) {
              log(`📤 Using base64 data for image ${i + 1}`);
              try {
                const buffer = Buffer.from(img.base64, "base64");
                const filename =
                  img.filename || `${img.alt || `image-${i + 1}`}.png`;
                uploadId = await uploadBufferToNotion(
                  buffer,
                  filename,
                  img.mimeType || "image/png"
                );
              } catch (bErr) {
                log(
                  `❌ Failed to upload base64 image ${i + 1}: ${bErr.message}`
                );
              }
            }

            // Otherwise, try to download and upload the external URL
            if (!uploadId) {
              uploadId = await downloadAndUploadImage(
                img.url,
                img.alt || `image-${i + 1}`
              );
            }

            if (uploadId) {
              // Track this upload for Martian post-processing with caption
              uploadedImageIds.push({
                originalUrl: img.url,
                uploadId: uploadId,
                caption: img.caption || img.alt || "", // Preserve caption from userscript
                figureNumber: img.figureNumber || "",
              });
              log(
                `✅ Added uploaded image ${i + 1} with ID: ${uploadId.substring(
                  0,
                  20
                )}... to tracking array`
              );
            } else {
              log(
                `⚠️ Upload failed for image ${i + 1}: ${img.url.substring(
                  0,
                  50
                )}...`
              );
            }
          } catch (imageError) {
            log(`❌ Failed to process image ${i + 1}:`, imageError.message);
            log(`🔍 Image error details:`, imageError);
          }
        }

        log(
          `✅ Processed ${payload.images.length} images - ${uploadedImageIds.length} uploaded successfully`
        );
      }

      // Set Figure/Image checkbox based on successful image uploads
      // This should be after image processing but before content creation
      const figureImageProperty = findProperty(
        dbInfo.properties,
        "Figure/Image"
      );
      if (figureImageProperty && figureImageProperty.type === "checkbox") {
        const hasSuccessfulUploads = uploadedImageIds.length > 0;
        properties["Figure/Image"] = { checkbox: hasSuccessfulUploads };
        log(
          `✅ Set Figure/Image checkbox to ${hasSuccessfulUploads} based on ${uploadedImageIds.length} successful uploads`
        );
      } else if (figureImageProperty) {
        log(
          `⚠️ Figure/Image property exists but is not a checkbox (type: ${figureImageProperty.type})`
        );
      } else {
        log(`ℹ️ No Figure/Image property found in database schema`);
      }

      // Handle direct SDK image blocks if requested
      let directImageBlocks = [];
      if (
        (payload.imageHandling === "direct_sdk" || payload.directSDKImages) &&
        uploadedImageIds.length > 0
      ) {
        log(
          "🖼️ Direct SDK images enabled - will use post-processing instead of prepending blocks"
        );
        log(
          `📸 ${uploadedImageIds.length} images uploaded via SDK, will be inserted at correct positions via Martian post-processing`
        );
        // Skip creating directImageBlocks - let post-processing handle image insertion at correct positions
      }

      // Handle content blocks - use Martian if requested and available
      let contentBlocks = [];

      // Use Martian conversion when requested OR when HTML content is provided
      if (
        (payload.useMartian && martianHelper) ||
        (payload.contentHtml && martianHelper)
      ) {
        log(
          "🔄 Using Martian to convert content to Notion blocks (markdown or html)"
        );

        // Check if we should process images directly via SDK instead of through Martian
        if (
          payload.directSDKImages &&
          uploadedImageIds &&
          uploadedImageIds.length > 0
        ) {
          log(
            "🖼️ Direct SDK image processing enabled - content should already have image markdown stripped"
          );
          log(
            `📸 Will create ${uploadedImageIds.length} direct SDK image blocks after text content`
          );
        }

        try {
          // Choose processed content: prefer HTML if present, otherwise use markdown/plain text
          let processedContent = payload.content || "";
          let martianFrom = "markdown";

          if (
            payload.contentHtml &&
            String(payload.contentHtml).trim().length > 0
          ) {
            log(
              "🔧 Preprocessing payload.contentHtml for caption recovery and header styling"
            );
            try {
              // ✅ FIX LINE BREAKS - Simple preprocessing before DOM parsing
              log("🔧 Preprocessing <br> tags for better line break handling");
              let preprocessedHtml = payload.contentHtml;

              // Convert <br> tags to newlines that work better for table content
              const originalBrCount = (
                payload.contentHtml.match(/<br\s*\/?>/gi) || []
              ).length;

              // Replace <br> tags with newlines - simpler approach
              preprocessedHtml = preprocessedHtml.replace(/<br\s*\/?>/gi, "\n");

              log(`🔧 Converted ${originalBrCount} <br> tags to newlines`);

              const JSDOM = require("jsdom").JSDOM;
              const parser = new JSDOM(preprocessedHtml);
              const doc = parser.window.document;

              // ✅ PRESERVE ALL URLs - Skip URL preprocessing to maintain original links
              log(
                "✅ Preserving ALL URLs without modification - no preprocessing"
              );
              const links = Array.from(doc.querySelectorAll("a[href]"));
              log(
                `🔗 Found ${links.length} links in content - preserving ALL as-is`
              );

              // ✅ FIX LINE BREAKS - Convert <br> tags to proper line breaks in table cells
              log(
                "🔧 Preprocessing line breaks in table cells for proper formatting"
              );
              const tableCells = Array.from(doc.querySelectorAll("td, th"));
              let lineBreaksFixed = 0;

              tableCells.forEach((cell) => {
                // Check for any remaining <br> tags (should be minimal after string preprocessing)
                const brTags = Array.from(cell.querySelectorAll("br"));
                brTags.forEach((br) => {
                  // Simple replacement with text node containing line breaks
                  const newlines = doc.createTextNode("\n\n");
                  br.parentNode.insertBefore(newlines, br);
                  br.remove();
                  lineBreaksFixed++;
                });
              });
              log(
                `🔧 Fixed ${lineBreaksFixed} line breaks in ${tableCells.length} table cells`
              );

              // Recover caption-like spans immediately before tables and build markdown fallback
              const tables = Array.from(
                doc.querySelectorAll(
                  "table, .table, .data-table, .record-table"
                )
              );

              // If tables exist, recover caption spans into H3 elements and preserve HTML
              if (tables.length > 0) {
                tables.forEach((table) => {
                  try {
                    const prev = table.previousElementSibling;
                    if (
                      prev &&
                      prev.tagName &&
                      prev.tagName.toLowerCase() === "span"
                    ) {
                      const cls = prev.getAttribute("class") || "";
                      if (cls.split(/\s+/).includes("title")) {
                        const h3 = doc.createElement("h3");
                        h3.className = "table-caption-title";
                        h3.textContent = prev.textContent.trim();
                        table.parentNode.insertBefore(h3, table);
                        prev.remove();
                      }
                    }

                    // Also add inline styling to header cells where possible
                    try {
                      const headerRow =
                        table.querySelector("thead tr") ||
                        table.querySelector("tr");
                      if (headerRow) {
                        const headerCells = Array.from(
                          headerRow.querySelectorAll("th,td")
                        );
                        headerCells.forEach((cell) => {
                          const existing = cell.getAttribute("style") || "";
                          cell.setAttribute(
                            "style",
                            existing + ";background-color: #cfe2ff;"
                          );
                        });
                      }
                    } catch (e) {
                      // ignore inline style failures
                    }
                  } catch (e) {
                    /* ignore */
                  }
                });

                // Build Notion-native table blocks directly to preserve structure
                const builtTableBlocks = [];

                tables.forEach((tableEl) => {
                  try {
                    // If a caption h3 was inserted, add it as heading_3 block
                    const prev = tableEl.previousElementSibling;
                    if (
                      prev &&
                      prev.tagName &&
                      prev.tagName.toLowerCase() === "h3"
                    ) {
                      builtTableBlocks.push({
                        object: "block",
                        type: "heading_3",
                        heading_3: {
                          rich_text: [
                            {
                              type: "text",
                              text: {
                                content: String(prev.textContent || "").trim(),
                              },
                              annotations: {
                                bold: false,
                                italic: false,
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

                    const rows = Array.from(tableEl.querySelectorAll("tr"));
                    const children = rows.map((row) => {
                      const cells = Array.from(
                        row.querySelectorAll("th,td")
                      ).map((c) => {
                        // Extract text content while preserving line breaks
                        let content = String(c.textContent || "").trim();

                        // Check for line break indicators that our preprocessing added
                        if (content.includes("\n")) {
                          // Split on newlines and create separate rich text elements
                          const parts = content
                            .split("\n")
                            .filter((part) => part.trim().length > 0);
                          if (parts.length > 1) {
                            log(
                              `🔧 Native table: Found ${parts.length} line break parts in cell: "${content}"`
                            );
                            return parts; // Return array of text parts
                          }
                        }

                        return [content]; // Return single text as array for consistency
                      });

                      // Convert cell content to rich text format
                      const cellRich = cells.map((textParts) => {
                        if (Array.isArray(textParts) && textParts.length > 1) {
                          // Multiple parts - create separate rich text elements with line breaks
                          const richTextElements = [];
                          textParts.forEach((part, index) => {
                            richTextElements.push({
                              type: "text",
                              text: { content: part.trim() },
                              annotations: {
                                bold: false,
                                italic: false,
                                strikethrough: false,
                                underline: false,
                                code: false,
                                color: "default",
                              },
                            });

                            // Add line break element between parts (except after the last one)
                            if (index < textParts.length - 1) {
                              richTextElements.push({
                                type: "text",
                                text: { content: "\n" },
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
                          });
                          return richTextElements;
                        } else {
                          // Single part - standard processing
                          const text = Array.isArray(textParts)
                            ? textParts[0]
                            : textParts;
                          return [
                            {
                              type: "text",
                              text: { content: text },
                              annotations: {
                                bold: false,
                                italic: false,
                                strikethrough: false,
                                underline: false,
                                code: false,
                                color: "default",
                              },
                            },
                          ];
                        }
                      });

                      return {
                        object: "block",
                        type: "table_row",
                        table_row: { cells: cellRich },
                      };
                    });

                    const tableBlock = {
                      object: "block",
                      type: "table",
                      table: {
                        table_width: rows[0]
                          ? Math.max(
                              1,
                              rows[0].querySelectorAll("th,td").length
                            )
                          : 1,
                        children,
                      },
                    };

                    builtTableBlocks.push(tableBlock);
                  } catch (e) {
                    /* ignore per-table failures */
                  }
                });

                // Use builtTableBlocks as the processed content blocks and skip Martian
                contentBlocks = builtTableBlocks;
                martianFrom = "html";
                log(
                  "🔍 MARTIAN: Built native Notion table blocks from HTML tables (skipping Martian for tables)"
                );
              } else {
                // No tables - keep as HTML but still recover captions by converting spans to h3
                tables.forEach((table) => {
                  try {
                    const prev = table.previousElementSibling;
                    if (
                      prev &&
                      prev.tagName &&
                      prev.tagName.toLowerCase() === "span"
                    ) {
                      const cls = prev.getAttribute("class") || "";
                      if (cls.split(/\s+/).includes("title")) {
                        const h3 = doc.createElement("h3");
                        h3.className = "table-caption-title";
                        h3.textContent = prev.textContent;
                        table.parentNode.insertBefore(h3, table);
                        prev.remove();
                      }
                    }
                  } catch (e) {
                    /* ignore */
                  }
                });
                processedContent = doc.body.innerHTML;
                martianFrom = "html";
              }
            } catch (e) {
              log(
                "⚠️ HTML preprocessing failed, falling back to raw HTML:",
                e.message || e
              );
              processedContent = payload.contentHtml;
              martianFrom = "html";
            }
          } else {
            log("🔍 MARTIAN: Using markdown/plain-text input for conversion");

            // Fix URLs in Markdown content for Notion compatibility
            if (processedContent && typeof processedContent === "string") {
              log("🔗 Preprocessing Markdown URLs for Notion compatibility");

              let urlsProcessed = 0;
              let urlsFixed = 0;

              // Handle markdown links [text](url)
              processedContent = processedContent.replace(
                /\[([^\]]*)\]\(([^)]+)\)/g,
                (match, text, url) => {
                  urlsProcessed++;

                  // Remove hash-only URLs
                  if (url.startsWith("#")) {
                    log(`🔗 Removing hash-only URL: ${url}`);
                    urlsFixed++;
                    return text; // Just return the text without the link
                  }

                  // Convert relative URLs to absolute
                  if (url.startsWith("/") && payload.url) {
                    try {
                      const baseUrl = new URL(payload.url);
                      const absoluteUrl = new URL(url, baseUrl).href;
                      log(
                        `🔗 Converting relative URL: ${url} → ${absoluteUrl}`
                      );
                      urlsFixed++;
                      return `[${text}](${absoluteUrl})`;
                    } catch (error) {
                      log(
                        `⚠️ Failed to convert relative URL ${url}: ${error.message}`
                      );
                      return match; // Keep original
                    }
                  }

                  return match; // Keep original if no changes needed
                }
              );

              log(
                `🔗 Markdown URL preprocessing complete: ${urlsProcessed} URLs processed, ${urlsFixed} URLs fixed`
              );
            }
          }

          if (uploadedImageIds && uploadedImageIds.length > 0) {
            log(
              `🔄 Pre-processing ${uploadedImageIds.length} uploaded images in content`
            );
            uploadedImageIds.forEach((uploadInfo, index) => {
              if (uploadInfo.originalUrl && uploadInfo.uploadId) {
                // Replace the original URL with a Notion file upload reference
                // This is a placeholder - Martian doesn't support file_upload syntax in markdown
                // So we'll need to post-process the blocks instead
                log(
                  `📝 Found uploaded image ${index + 1}: ${
                    uploadInfo.originalUrl
                  } -> ${uploadInfo.uploadId}`
                );
              }
            });
          }

          // Use Martian to convert markdown to Notion blocks
          // Support Martian options from payload for advanced features

          // Debug: Log URLs in content before Martian processing
          const urlMatches =
            processedContent.match(/\[([^\]]*)\]\(([^)]*)\)/g) || [];
          log(
            `🔍 MARTIAN-INPUT: Found ${urlMatches.length} markdown links in content`
          );
          urlMatches.forEach((match, index) => {
            const [, linkText, url] = match.match(/\[([^\]]*)\]\(([^)]*)\)/);
            log(
              `🔍 MARTIAN-INPUT: Link ${index + 1}: "${linkText}" -> "${url}"`
            );
          });

          const martianOptions = payload.martianOptions || {};
          const convertedBlocks = await martianHelper.convertToNotionBlocks(
            processedContent,
            { from: martianFrom, options: martianOptions }
          );

          if (
            convertedBlocks &&
            Array.isArray(convertedBlocks) &&
            convertedBlocks.length > 0
          ) {
            log(
              `✅ Martian converted content to ${convertedBlocks.length} blocks`
            );
            contentBlocks = convertedBlocks;

            // ✅ PRESERVE ALL URLS - No cleaning or validation applied
            console.log(
              "✅ Processing content blocks while preserving ALL URLs..."
            );

            // Function to preserve ALL URLs and fix line breaks in rich text
            const cleanUrlsFromRichText = (richTextArray) => {
              // ✅ PRESERVE ALL URLS - No cleaning or filtering
              if (!Array.isArray(richTextArray)) return richTextArray;

              // Process each rich text item to fix concatenated text (e.g., "Washington DCXanaduYokohama")
              return richTextArray.flatMap((richTextItem) => {
                if (richTextItem.type === "text" && richTextItem.text) {
                  let content = richTextItem.text.content || "";

                  // Check if content looks like concatenated words (common with table cell conversion)
                  // Pattern: CapitalLetterLowercaseLettersCapitalLetter (like "DCXanadu")
                  const concatenatedPattern = /([A-Z][a-z]+)([A-Z][a-z]*)/g;

                  // Also handle newlines that may have been preserved
                  if (
                    content.includes("\n") ||
                    concatenatedPattern.test(content)
                  ) {
                    let processedContent = content;

                    // First handle explicit newlines
                    if (content.includes("\n")) {
                      // Split on newlines and rejoin with space to separate lines
                      processedContent = content
                        .split("\n")
                        .filter((line) => line.trim())
                        .join("\n");
                    } else {
                      // Try to detect and fix concatenated words by adding spaces
                      // This handles cases like "Washington DCXanaduYokohama" -> "Washington DC\nXanadu\nYokohama"
                      processedContent = content.replace(
                        /([a-z])([A-Z])/g,
                        "$1\n$2"
                      );
                    }

                    // If we have line breaks now, split into separate text items
                    if (processedContent.includes("\n")) {
                      const lines = processedContent
                        .split("\n")
                        .filter((line) => line.trim());

                      return lines.map((line, index) => ({
                        ...richTextItem,
                        text: {
                          ...richTextItem.text,
                          content: line.trim(),
                        },
                      }));
                    }
                  }
                }

                // Return unchanged if no processing needed
                return [richTextItem];
              });
            }; // Clean all blocks properly using object manipulation instead of string replacement
            contentBlocks = contentBlocks.map((block, idx) => {
              const cleanedBlock = { ...block };

              switch (block.type) {
                case "paragraph":
                  if (block.paragraph?.rich_text) {
                    cleanedBlock.paragraph = {
                      ...block.paragraph,
                      rich_text: cleanUrlsFromRichText(
                        block.paragraph.rich_text
                      ),
                    };
                  }
                  break;
                case "heading_1":
                  if (block.heading_1?.rich_text) {
                    cleanedBlock.heading_1 = {
                      ...block.heading_1,
                      rich_text: cleanUrlsFromRichText(
                        block.heading_1.rich_text
                      ),
                    };
                  }
                  break;
                case "heading_2":
                  if (block.heading_2?.rich_text) {
                    cleanedBlock.heading_2 = {
                      ...block.heading_2,
                      rich_text: cleanUrlsFromRichText(
                        block.heading_2.rich_text
                      ),
                    };
                  }
                  break;
                case "heading_3":
                  if (block.heading_3?.rich_text) {
                    cleanedBlock.heading_3 = {
                      ...block.heading_3,
                      rich_text: cleanUrlsFromRichText(
                        block.heading_3.rich_text
                      ),
                    };
                  }
                  break;
                case "quote":
                  if (block.quote?.rich_text) {
                    cleanedBlock.quote = {
                      ...block.quote,
                      rich_text: cleanUrlsFromRichText(block.quote.rich_text),
                    };
                  }
                  break;
                case "bulleted_list_item":
                  if (block.bulleted_list_item?.rich_text) {
                    cleanedBlock.bulleted_list_item = {
                      ...block.bulleted_list_item,
                      rich_text: cleanUrlsFromRichText(
                        block.bulleted_list_item.rich_text
                      ),
                    };
                  }
                  break;
                case "numbered_list_item":
                  if (block.numbered_list_item?.rich_text) {
                    cleanedBlock.numbered_list_item = {
                      ...block.numbered_list_item,
                      rich_text: cleanUrlsFromRichText(
                        block.numbered_list_item.rich_text
                      ),
                    };
                  }
                  break;
              }

              return cleanedBlock;
            });

            console.log(
              "✅ Advanced URL cleaning complete - removed all link objects to prevent validation errors"
            );

            // Post-process Martian blocks to replace external images with uploaded files
            if (uploadedImageIds && uploadedImageIds.length > 0) {
              log(`🔄 Post-processing Martian blocks to use uploaded images`);
              log(`📋 Available uploaded images: ${uploadedImageIds.length}`);
              uploadedImageIds.forEach((img, idx) => {
                log(
                  `  ${idx + 1}. ${img.originalUrl} -> ${img.uploadId}${
                    img.caption
                      ? ` (caption: "${img.caption.substring(0, 50)}${
                          img.caption.length > 50 ? "..." : ""
                        }")`
                      : " (no caption)"
                  }`
                );
                log(`  🔍 Debug img object:`, JSON.stringify(img, null, 2));
              });

              log(
                `📋 Scanning ${contentBlocks.length} Martian blocks for images...`
              );

              // New approach: scan all blocks for image markdown syntax within text content
              const newBlocks = [];

              contentBlocks.forEach((block, blockIndex) => {
                log(`  Block ${blockIndex + 1}: ${block.type}`);

                // Check if this is an image block (legacy approach)
                if (
                  block.type === "image" &&
                  block.image?.type === "external"
                ) {
                  const externalUrl = block.image.external?.url;
                  log(`  📸 Found external image block: ${externalUrl}`);
                  if (externalUrl) {
                    const uploadedImage = uploadedImageIds.find((img) => {
                      // First try exact URL match
                      if (
                        normalizeUrl(img.originalUrl) ===
                        normalizeUrl(externalUrl)
                      ) {
                        return true;
                      }

                      // For relative paths, try filename matching
                      if (
                        externalUrl.includes("../") ||
                        !externalUrl.includes("://")
                      ) {
                        const externalFilename = externalUrl.split("/").pop();
                        const uploadedFilename = img.originalUrl
                          .split("/")
                          .pop();
                        log(
                          `🔍 Comparing filenames: "${externalFilename}" vs "${uploadedFilename}"`
                        );
                        return externalFilename === uploadedFilename;
                      }

                      return false;
                    });

                    if (uploadedImage && uploadedImage.uploadId) {
                      log(
                        `🔄 Replacing external image block with uploaded file: ${uploadedImage.uploadId.substring(
                          0,
                          20
                        )}...`
                      );

                      // Check surrounding blocks for figcaption content
                      let figcaptionText = "";
                      let figcaptionBlockIndex = -1;

                      // Check previous block for figcaption-like content
                      const prevBlock = contentBlocks[blockIndex - 1];
                      if (
                        prevBlock &&
                        prevBlock.type === "paragraph" &&
                        prevBlock.paragraph?.rich_text
                      ) {
                        const prevText = prevBlock.paragraph.rich_text
                          .map((rt) => rt.text?.content || "")
                          .join("")
                          .trim();

                        // Detect figcaption patterns (usually short descriptive text)
                        if (
                          prevText &&
                          prevText.length > 5 &&
                          prevText.length < 200 &&
                          !prevText.includes("http") &&
                          !prevText.includes("section-")
                        ) {
                          figcaptionText = prevText;
                          figcaptionBlockIndex = blockIndex - 1;
                          log(
                            `🖼️ Found potential figcaption before image: "${figcaptionText}"`
                          );
                        }
                      }

                      // If no previous figcaption, check next block
                      if (!figcaptionText) {
                        const nextBlockForCaption =
                          contentBlocks[blockIndex + 1];
                        if (
                          nextBlockForCaption &&
                          nextBlockForCaption.type === "paragraph" &&
                          nextBlockForCaption.paragraph?.rich_text
                        ) {
                          const nextText =
                            nextBlockForCaption.paragraph.rich_text
                              .map((rt) => rt.text?.content || "")
                              .join("")
                              .trim();

                          // Detect figcaption patterns (but not blockquotes)
                          if (
                            nextText &&
                            nextText.length > 5 &&
                            nextText.length < 200 &&
                            !nextText.includes("http") &&
                            !nextText.includes("section-") &&
                            !nextText.startsWith("Figure")
                          ) {
                            figcaptionText = nextText;
                            figcaptionBlockIndex = blockIndex + 1;
                            log(
                              `🖼️ Found potential figcaption after image: "${figcaptionText}"`
                            );
                          }
                        }
                      }

                      // Check if next block is a blockquote - use as caption
                      let captionBlocks = [];
                      let skipNextBlock = false;

                      const nextBlock = contentBlocks[blockIndex + 1];
                      log(
                        `🔍 Checking next block (${blockIndex + 1}): ${
                          nextBlock ? nextBlock.type : "none"
                        }`
                      );
                      if (nextBlock) {
                        log(
                          `🔍 Next block structure:`,
                          JSON.stringify(nextBlock, null, 2)
                        );
                      }
                      if (
                        nextBlock &&
                        nextBlock.type === "quote" &&
                        (nextBlock.quote?.rich_text ||
                          nextBlock.quote?.children)
                      ) {
                        let quoteText = "";

                        // First try direct rich_text
                        if (nextBlock.quote.rich_text) {
                          quoteText = nextBlock.quote.rich_text
                            .map((rt) => rt.text?.content || "")
                            .join("")
                            .trim();
                        }

                        // If direct rich_text is empty, check children (nested paragraphs)
                        if (!quoteText && nextBlock.quote.children) {
                          const childTexts = [];
                          for (const child of nextBlock.quote.children) {
                            if (
                              child.type === "paragraph" &&
                              child.paragraph?.rich_text
                            ) {
                              const childText = child.paragraph.rich_text
                                .map((rt) => rt.text?.content || "")
                                .join("")
                                .trim();
                              if (childText) childTexts.push(childText);
                            }
                          }
                          quoteText = childTexts.join(" ").trim();
                        }

                        log(`🔍 Found quote text: "${quoteText}"`);
                        if (quoteText) {
                          // Build comprehensive caption: figcaption + existing caption + blockquote
                          let finalCaptionText = "";
                          const captionParts = [];

                          // Add detected figcaption
                          if (figcaptionText) {
                            captionParts.push(figcaptionText);
                          }

                          // Add existing uploaded caption (may include alt text)
                          if (
                            uploadedImage.caption &&
                            uploadedImage.caption.trim()
                          ) {
                            captionParts.push(uploadedImage.caption);
                          }

                          // Add blockquote text
                          captionParts.push(quoteText);

                          finalCaptionText = captionParts.join(" - ");
                          log(
                            `📝 Built comprehensive caption: "${finalCaptionText}"`
                          );

                          captionBlocks = [
                            {
                              type: "text",
                              text: { content: finalCaptionText },
                              annotations: {
                                bold: false,
                                italic: false,
                                strikethrough: false,
                                underline: false,
                                code: false,
                                color: "default",
                              },
                            },
                          ];
                          skipNextBlock = true;
                          // Mark the next block to be skipped
                          contentBlocks[blockIndex + 1]._skipBlock = true;

                          // Also mark the figcaption block to be skipped if found
                          if (figcaptionBlockIndex >= 0) {
                            contentBlocks[
                              figcaptionBlockIndex
                            ]._skipBlock = true;
                            log(
                              `📝 Marking figcaption block ${figcaptionBlockIndex} for removal`
                            );
                          }
                        }
                      } else if (
                        figcaptionText ||
                        (uploadedImage.caption && uploadedImage.caption.trim())
                      ) {
                        // No blockquote, but we have figcaption and/or uploaded caption
                        let finalCaptionText = "";
                        const captionParts = [];

                        if (figcaptionText) {
                          captionParts.push(figcaptionText);
                        }

                        if (
                          uploadedImage.caption &&
                          uploadedImage.caption.trim()
                        ) {
                          captionParts.push(uploadedImage.caption);
                        }

                        finalCaptionText = captionParts.join(" - ");

                        captionBlocks = [
                          {
                            type: "text",
                            text: { content: finalCaptionText },
                            annotations: {
                              bold: false,
                              italic: false,
                              strikethrough: false,
                              underline: false,
                              code: false,
                              color: "default",
                            },
                          },
                        ];
                        log(
                          `📝 Using figcaption/caption: "${finalCaptionText}"`
                        );

                        // Mark the figcaption block to be skipped if found
                        if (figcaptionBlockIndex >= 0) {
                          contentBlocks[figcaptionBlockIndex]._skipBlock = true;
                          log(
                            `📝 Marking figcaption block ${figcaptionBlockIndex} for removal`
                          );
                        }
                      }

                      newBlocks.push({
                        object: "block",
                        type: "image",
                        image: {
                          type: "file_upload",
                          file_upload: { id: uploadedImage.uploadId },
                          caption: captionBlocks,
                        },
                      });
                      return;
                    } else {
                      log(`⚠️ No matching upload found for: ${externalUrl}`);
                      // Check if URL is valid - if not, convert to paragraph with broken image indicator
                      const isValidUrl = isValidImageUrl(externalUrl);
                      if (!isValidUrl) {
                        log(
                          `🚫 Invalid image URL detected, converting to text: ${externalUrl}`
                        );
                        newBlocks.push({
                          object: "block",
                          type: "paragraph",
                          paragraph: {
                            rich_text: [
                              {
                                type: "text",
                                text: {
                                  content: `[Invalid Image: ${externalUrl}]`,
                                },
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
                        return;
                      }
                    }
                  }
                }

                // Check if this block is marked to be skipped (used as caption)
                if (block._skipBlock) {
                  log(
                    `⏭️ Skipping block ${
                      blockIndex + 1
                    } - used as image caption`
                  );
                  return;
                }

                // New approach: Check if this block contains markdown image syntax in text content
                let foundImageInText = false;
                if (block.type === "paragraph" && block.paragraph?.rich_text) {
                  // Check if any rich text contains image markdown
                  const richTextArray = block.paragraph.rich_text;
                  const textContent = richTextArray
                    .map((rt) => rt.text?.content || "")
                    .join("");

                  // Look for markdown image patterns: ![caption](url)
                  const imagePattern = /!\[([^\]]*)\]\(([^)]+)\)/g;
                  let match;

                  while ((match = imagePattern.exec(textContent)) !== null) {
                    const [fullMatch, caption, url] = match;
                    log(`  🔍 Found image markdown in paragraph: ${fullMatch}`);

                    // Find matching uploaded image
                    const uploadedImage = uploadedImageIds.find((img) => {
                      // First try exact URL match
                      if (normalizeUrl(img.originalUrl) === normalizeUrl(url)) {
                        return true;
                      }

                      // For relative paths, try filename matching
                      if (url.includes("../") || !url.includes("://")) {
                        const urlFilename = url.split("/").pop();
                        const uploadedFilename = img.originalUrl
                          .split("/")
                          .pop();
                        log(
                          `🔍 Comparing markdown filenames: "${urlFilename}" vs "${uploadedFilename}"`
                        );
                        return urlFilename === uploadedFilename;
                      }

                      return false;
                    });

                    if (uploadedImage && uploadedImage.uploadId) {
                      log(
                        `  ✅ Found matching upload for markdown image: ${url} -> ${uploadedImage.uploadId}`
                      );
                      foundImageInText = true;

                      // Check if next block is a blockquote - use as caption
                      let captionBlocks = [];
                      const nextBlock = contentBlocks[blockIndex + 1];
                      if (
                        nextBlock &&
                        nextBlock.type === "quote" &&
                        (nextBlock.quote?.rich_text ||
                          nextBlock.quote?.children)
                      ) {
                        let quoteText = "";

                        // First try direct rich_text
                        if (nextBlock.quote.rich_text) {
                          quoteText = nextBlock.quote.rich_text
                            .map((rt) => rt.text?.content || "")
                            .join("")
                            .trim();
                        }

                        // If direct rich_text is empty, check children (nested paragraphs)
                        if (!quoteText && nextBlock.quote.children) {
                          const childTexts = [];
                          for (const child of nextBlock.quote.children) {
                            if (
                              child.type === "paragraph" &&
                              child.paragraph?.rich_text
                            ) {
                              const childText = child.paragraph.rich_text
                                .map((rt) => rt.text?.content || "")
                                .join("")
                                .trim();
                              if (childText) childTexts.push(childText);
                            }
                          }
                          quoteText = childTexts.join(" ").trim();
                        }

                        if (quoteText) {
                          log(
                            `📝 Using following blockquote as markdown image caption: "${quoteText}"`
                          );
                          captionBlocks = [
                            {
                              type: "text",
                              text: { content: quoteText },
                              annotations: {
                                bold: false,
                                italic: false,
                                strikethrough: false,
                                underline: false,
                                code: false,
                                color: "default",
                              },
                            },
                          ];
                          // Mark the next block to be skipped
                          contentBlocks[blockIndex + 1]._skipBlock = true;
                        }
                      } else {
                        // Use existing caption logic
                        const captionText = uploadedImage.caption || caption;
                        if (captionText && captionText.trim()) {
                          captionBlocks = [
                            {
                              type: "text",
                              text: { content: captionText },
                              annotations: {
                                bold: false,
                                italic: false,
                                strikethrough: false,
                                underline: false,
                                code: false,
                                color: "default",
                              },
                            },
                          ];
                        }
                      }

                      // Add the image block
                      newBlocks.push({
                        object: "block",
                        type: "image",
                        image: {
                          type: "file_upload",
                          file_upload: { id: uploadedImage.uploadId },
                          caption: captionBlocks,
                        },
                      });

                      log(
                        `  📸 Created image block from markdown: ${uploadedImage.uploadId.substring(
                          0,
                          20
                        )}...`
                      );
                    } else {
                      log(
                        `  ⚠️ No matching upload found for markdown image: ${url}`
                      );
                    }
                  }

                  // If we found images in this paragraph, create a cleaned paragraph without the image markdown
                  if (foundImageInText) {
                    let cleanedTextContent = textContent
                      .replace(/!\[([^\]]*)\]\(([^)]+)\)/g, "")
                      .replace(/\[W2N-IMG-MARKER:[^\]]+\]/g, "")
                      .trim();

                    // Only add the paragraph if there's still text content after removing images
                    if (cleanedTextContent) {
                      newBlocks.push({
                        object: "block",
                        type: "paragraph",
                        paragraph: {
                          rich_text: [
                            {
                              type: "text",
                              text: { content: cleanedTextContent },
                              annotations: {
                                bold: false,
                                italic: false,
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
                    return; // Skip adding the original block
                  }
                }

                // If no images found, add the original block
                newBlocks.push(block);
              });

              contentBlocks = newBlocks;
            }

            // Validate that all blocks are within Notion's limits
            contentBlocks.forEach((block, index) => {
              if (block.type === "paragraph" && block.paragraph?.rich_text) {
                const totalLength = block.paragraph.rich_text.reduce(
                  (sum, textObj) => {
                    return sum + (textObj.text?.content?.length || 0);
                  },
                  0
                );
                if (totalLength > 2000) {
                  log(
                    `⚠️ WARNING: Martian block ${
                      index + 1
                    } exceeds 2000 chars: ${totalLength}`
                  );
                }
              }
            });
          } else {
            log(
              "⚠️ Martian conversion returned empty/invalid blocks, falling back to manual chunking"
            );
          }
        } catch (martianError) {
          log("❌ Martian conversion failed:", martianError.message);
          log("🔄 Falling back to manual content chunking");
        }
      } else {
        log(
          `📝 Using manual content chunking (useMartian: ${
            payload.useMartian
          }, martianHelper available: ${!!martianHelper})`
        );
      }

      // Fallback to manual chunking if Martian didn't work
      if (contentBlocks.length === 0) {
        // Split content into paragraphs (the userscript should have already chunked this properly)
        const paragraphs = payload.content
          .split(/\n\s*\n/)
          .filter((p) => p.trim());

        log(`📝 Processing ${paragraphs.length} paragraphs for content blocks`);

        paragraphs.forEach((paragraph, index) => {
          const trimmedPara = paragraph.trim();
          if (!trimmedPara) return;

          // Check if paragraph exceeds Notion's limit
          if (trimmedPara.length > 2000) {
            log(
              `⚠️ WARNING: Paragraph ${index + 1} exceeds 2000 chars (${
                trimmedPara.length
              }), splitting...`
            );

            // Emergency split by sentences if a paragraph is still too long
            const sentences = trimmedPara.match(/[^.!?]*[.!?]+/g) || [
              trimmedPara,
            ];
            let currentChunk = "";

            sentences.forEach((sentence) => {
              if (currentChunk.length + sentence.length > 1950) {
                if (currentChunk) {
                  contentBlocks.push({
                    object: "block",
                    type: "paragraph",
                    paragraph: {
                      rich_text: [
                        {
                          type: "text",
                          text: { content: currentChunk.trim() },
                        },
                      ],
                    },
                  });
                  currentChunk = sentence;
                } else {
                  // Single sentence too long, truncate it
                  contentBlocks.push({
                    object: "block",
                    type: "paragraph",
                    paragraph: {
                      rich_text: [
                        {
                          type: "text",
                          text: { content: sentence.substring(0, 1950) },
                        },
                      ],
                    },
                  });
                  if (sentence.length > 1950) {
                    currentChunk = sentence.substring(1950);
                  }
                }
              } else {
                currentChunk += (currentChunk ? " " : "") + sentence;
              }
            });

            if (currentChunk) {
              contentBlocks.push({
                object: "block",
                type: "paragraph",
                paragraph: {
                  rich_text: [
                    { type: "text", text: { content: currentChunk.trim() } },
                  ],
                },
              });
            }
          } else {
            // Paragraph is within limits, add it directly
            contentBlocks.push({
              object: "block",
              type: "paragraph",
              paragraph: {
                rich_text: [{ type: "text", text: { content: trimmedPara } }],
              },
            });
          }
        });
      }

      // Ensure we have at least one content block
      if (contentBlocks.length === 0) {
        log("⚠️ No content blocks created, adding default block");
        contentBlocks.push({
          object: "block",
          type: "paragraph",
          paragraph: {
            rich_text: [
              {
                type: "text",
                text: { content: payload.content || "Empty content" },
              },
            ],
          },
        });
      }

      log(`✅ Created ${contentBlocks.length} content blocks for page`);

      // Log block sizes for debugging
      contentBlocks.forEach((block, i) => {
        const textContent =
          block.paragraph?.rich_text?.[0]?.text?.content || "";
        log(`📝 Block ${i + 1}: ${textContent.length} chars`);
      });

      // Ensure URL-type properties are correctly shaped for Notion
      try {
        if (dbInfo && dbInfo.properties && payload.url) {
          Object.entries(dbInfo.properties).forEach(([dbKey, dbCfg]) => {
            try {
              if (dbCfg && dbCfg.type === "url") {
                const current = properties[dbKey];
                if (current && !current.url) {
                  // If it's rich_text carrying the URL, extract and coerce
                  if (
                    current.rich_text &&
                    Array.isArray(current.rich_text) &&
                    current.rich_text[0] &&
                    current.rich_text[0].text &&
                    typeof current.rich_text[0].text.content === "string"
                  ) {
                    const candidate = current.rich_text[0].text.content.trim();

                    // Use strict URL validation instead of basic URL constructor
                    const isValidUrl = (url) => {
                      try {
                        if (!url || typeof url !== "string") return false;

                        const trimmed = url.trim();
                        if (trimmed === "" || trimmed.length > 2048)
                          return false;

                        // Reject obviously malformed URLs
                        if (
                          trimmed.includes(" ") ||
                          trimmed.includes("|") ||
                          trimmed.includes("{") ||
                          trimmed.includes("}") ||
                          trimmed.includes("[") ||
                          trimmed.includes("]") ||
                          trimmed.includes("???") ||
                          trimmed.includes("\\")
                        ) {
                          return false;
                        }

                        // Must start with http:// or https://
                        if (
                          !trimmed.startsWith("http://") &&
                          !trimmed.startsWith("https://")
                        ) {
                          return false;
                        }

                        const urlObj = new URL(trimmed);

                        // Must have valid protocol and hostname
                        if (
                          (urlObj.protocol !== "http:" &&
                            urlObj.protocol !== "https:") ||
                          !urlObj.hostname ||
                          urlObj.hostname.length === 0
                        ) {
                          return false;
                        }

                        // Reject localhost URLs (they won't work in Notion)
                        if (
                          urlObj.hostname === "localhost" ||
                          urlObj.hostname === "127.0.0.1"
                        ) {
                          return false;
                        }

                        // Hostname should contain at least one dot (proper domain)
                        if (!urlObj.hostname.includes(".")) {
                          return false;
                        }

                        // Reject URLs with excessive parameters that might be malformed
                        if (urlObj.search && urlObj.search.length > 1000) {
                          return false;
                        }

                        return true;
                      } catch (error) {
                        return false;
                      }
                    };

                    // Use simpler validation for coercion - just check if it's a valid URL
                    try {
                      const urlObj = new URL(candidate);
                      if (
                        urlObj.protocol === "http:" ||
                        urlObj.protocol === "https:"
                      ) {
                        properties[dbKey] = { url: urlObj.href };
                        log(
                          `🔧 Coerced property '${dbKey}' to url type with value: ${urlObj.href}`
                        );
                      } else {
                        log(
                          `⚠️ Cannot coerce property '${dbKey}' - invalid protocol: "${candidate}" - keeping as rich_text`
                        );
                      }
                    } catch (e) {
                      log(
                        `⚠️ Cannot coerce property '${dbKey}' - not a valid URL: "${candidate}" - keeping as rich_text`
                      );
                    }
                  } else if (typeof current === "string") {
                    // Use the same strict URL validation
                    const isValidUrl = (url) => {
                      try {
                        if (!url || typeof url !== "string") return false;

                        const trimmed = url.trim();
                        if (trimmed === "" || trimmed.length > 2048)
                          return false;

                        // Reject obviously malformed URLs
                        if (
                          trimmed.includes(" ") ||
                          trimmed.includes("|") ||
                          trimmed.includes("{") ||
                          trimmed.includes("}") ||
                          trimmed.includes("[") ||
                          trimmed.includes("]") ||
                          trimmed.includes("???") ||
                          trimmed.includes("\\")
                        ) {
                          return false;
                        }

                        // Must start with http:// or https://
                        if (
                          !trimmed.startsWith("http://") &&
                          !trimmed.startsWith("https://")
                        ) {
                          return false;
                        }

                        const urlObj = new URL(trimmed);

                        // Must have valid protocol and hostname
                        if (
                          (urlObj.protocol !== "http:" &&
                            urlObj.protocol !== "https:") ||
                          !urlObj.hostname ||
                          urlObj.hostname.length === 0
                        ) {
                          return false;
                        }

                        // Reject localhost URLs (they won't work in Notion)
                        if (
                          urlObj.hostname === "localhost" ||
                          urlObj.hostname === "127.0.0.1"
                        ) {
                          return false;
                        }

                        // Hostname should contain at least one dot (proper domain)
                        if (!urlObj.hostname.includes(".")) {
                          return false;
                        }

                        // Reject URLs with excessive parameters that might be malformed
                        if (urlObj.search && urlObj.search.length > 1000) {
                          return false;
                        }

                        return true;
                      } catch (error) {
                        return false;
                      }
                    };

                    // Use simpler validation for string coercion
                    try {
                      const urlObj = new URL(current);
                      if (
                        urlObj.protocol === "http:" ||
                        urlObj.protocol === "https:"
                      ) {
                        properties[dbKey] = { url: urlObj.href };
                        log(
                          `🔧 Coerced string property '${dbKey}' to url type with value: ${urlObj.href}`
                        );
                      } else {
                        log(
                          `⚠️ Cannot coerce string property '${dbKey}' - invalid protocol: "${current}" - converting to rich_text`
                        );
                        properties[dbKey] = {
                          rich_text: [{ text: { content: String(current) } }],
                        };
                      }
                    } catch (e) {
                      log(
                        `⚠️ Cannot coerce string property '${dbKey}' - not a valid URL: "${current}" - converting to rich_text`
                      );
                      properties[dbKey] = {
                        rich_text: [{ text: { content: String(current) } }],
                      };
                    }
                  }
                }
              }
            } catch (e) {
              // ignore per-property failures
            }
          });
        }
      } catch (e) {
        log("⚠️ URL property coercion failed:", e.message);
      }

      // Merge custom properties from payload if they exist
      if (payload.properties && typeof payload.properties === "object") {
        log(
          `📝 Merging ${
            Object.keys(payload.properties).length
          } custom properties from payload`
        );

        for (const [propName, propValue] of Object.entries(
          payload.properties
        )) {
          // Only merge if the property isn't already set (preserve existing title, URL, etc.)
          if (!properties[propName]) {
            properties[propName] = propValue;
            log(`✅ Added custom property: ${propName}`);
          } else {
            log(`⚠️ Skipped custom property '${propName}' - already exists`);
          }
        }
      }

      // Prepend direct SDK image blocks if we have them
      if (directImageBlocks.length > 0) {
        log(
          `🖼️ Prepending ${directImageBlocks.length} direct SDK image blocks to content`
        );
        contentBlocks = [...directImageBlocks, ...contentBlocks];
        log(`✅ Total blocks after adding images: ${contentBlocks.length}`);
      }

      // 🎥 Create video blocks if videos are present
      let videoBlocks = [];
      if (
        payload.videos &&
        Array.isArray(payload.videos) &&
        payload.videos.length > 0
      ) {
        log(`🎥 Processing ${payload.videos.length} videos from payload`);

        payload.videos.forEach((video, index) => {
          try {
            let videoBlock = null;

            switch (video.type) {
              case "embed":
                // Create embed block for platforms like Vimeo, YouTube
                videoBlock = {
                  object: "block",
                  type: "embed",
                  embed: {
                    url: video.url,
                    caption: video.title
                      ? [{ type: "text", text: { content: video.title } }]
                      : [],
                  },
                };
                log(
                  `🎥 Created embed block for ${video.platform}: ${video.title}`
                );
                break;

              case "video":
                // Create video block for direct video files
                videoBlock = {
                  object: "block",
                  type: "video",
                  video: {
                    type: "external",
                    external: { url: video.src || video.url },
                    caption: video.title
                      ? [{ type: "text", text: { content: video.title } }]
                      : [],
                  },
                };
                log(`🎥 Created video block: ${video.title}`);
                break;

              case "bookmark":
                // Create bookmark block for video links
                videoBlock = {
                  object: "block",
                  type: "bookmark",
                  bookmark: {
                    url: video.url,
                    caption: video.title
                      ? [{ type: "text", text: { content: video.title } }]
                      : [],
                  },
                };
                log(`🎥 Created bookmark block for video link: ${video.title}`);
                break;

              default:
                log(
                  `⚠️ Unknown video type: ${video.type}, skipping video ${
                    index + 1
                  }`
                );
                return;
            }

            if (videoBlock) {
              // Add video metadata as a paragraph if we have additional info
              if (video.duration || video.chapters) {
                const metadataText = [];
                if (video.duration)
                  metadataText.push(`Duration: ${video.duration}`);
                if (video.chapters && video.chapters.length > 0) {
                  metadataText.push(`Chapters: ${video.chapters.join(", ")}`);
                }

                if (metadataText.length > 0) {
                  const metadataBlock = {
                    object: "block",
                    type: "paragraph",
                    paragraph: {
                      rich_text: [
                        {
                          type: "text",
                          text: { content: `📺 ${metadataText.join(" | ")}` },
                          annotations: { italic: true, color: "gray" },
                        },
                      ],
                    },
                  };
                  videoBlocks.push(videoBlock, metadataBlock);
                } else {
                  videoBlocks.push(videoBlock);
                }
              } else {
                videoBlocks.push(videoBlock);
              }
            }
          } catch (error) {
            log(`❌ Error creating video block ${index + 1}: ${error.message}`);
          }
        });

        if (videoBlocks.length > 0) {
          log(`🎥 Adding ${videoBlocks.length} video blocks to content`);
          contentBlocks = [...videoBlocks, ...contentBlocks];
          log(`✅ Total blocks after adding videos: ${contentBlocks.length}`);
        }
      }

      // Filter out blocks marked for skipping (used as captions)
      const blocksBeforeFiltering = contentBlocks.length;
      contentBlocks = contentBlocks.filter((block) => !block._skipBlock);
      const filteredBlockCount = blocksBeforeFiltering - contentBlocks.length;
      if (filteredBlockCount > 0) {
        log(
          `🧹 Filtered out ${filteredBlockCount} blocks marked with _skipBlock`
        );
      }

      // Clean any remaining _skipBlock properties from blocks that passed the filter
      contentBlocks = contentBlocks.map((block) => {
        if (block._skipBlock !== undefined) {
          const cleanBlock = { ...block };
          delete cleanBlock._skipBlock;
          return cleanBlock;
        }
        return block;
      });

      // Filter out image blocks with invalid URLs to prevent Notion validation errors
      const blocksBeforeImageValidation = contentBlocks.length;
      contentBlocks = contentBlocks.filter((block, index) => {
        if (block && block.image && block.image.type === "external") {
          const imageUrl = block.image.external?.url;
          const isValid = isValidImageUrl(imageUrl);
          if (!isValid) {
            log(
              `🚫 Removed image block at position ${index} with invalid URL: ${imageUrl}`
            );
            return false;
          }
        }
        return true;
      });
      const invalidImageBlockCount =
        blocksBeforeImageValidation - contentBlocks.length;
      if (invalidImageBlockCount > 0) {
        log(
          `🧹 Filtered out ${invalidImageBlockCount} blocks with invalid image URLs`
        );
      }

      // Filter out undefined blocks to prevent Notion validation errors
      const originalBlockCount = contentBlocks.length;
      contentBlocks = contentBlocks.filter((block, index) => {
        if (block === undefined || block === null) {
          log(`🚫 Removed undefined/null block at position ${index}`);
          return false;
        }
        if (typeof block !== "object") {
          log(
            `🚫 Removed invalid block (not object) at position ${index}: ${typeof block}`
          );
          return false;
        }
        if (!block.type) {
          log(`🚫 Removed block without type at position ${index}`);
          return false;
        }
        return true;
      });

      if (originalBlockCount !== contentBlocks.length) {
        log(
          `🧹 Block validation: Removed ${
            originalBlockCount - contentBlocks.length
          } invalid blocks (${contentBlocks.length} remaining)`
        );
      } else {
        log(
          `✅ Block validation: All ${contentBlocks.length} blocks are valid`
        );
      }

      // Ensure we have at least one content block after filtering
      if (contentBlocks.length === 0) {
        log(
          "⚠️ No valid content blocks after filtering, adding fallback block"
        );
        contentBlocks.push({
          object: "block",
          type: "paragraph",
          paragraph: {
            rich_text: [
              {
                type: "text",
                text: {
                  content:
                    payload.content ||
                    "Content processing error - please try again",
                },
              },
            ],
          },
        });
      }

      // Prepare to create pages in batches to respect Notion's block limits (100)
      const MAX_BLOCKS = 100;
      // initialChildren is used for the initial pages.create() call
      // remainingChildren will be appended in batches after the page is created
      let initialChildren = contentBlocks;
      let remainingChildren = [];
      if (contentBlocks.length > MAX_BLOCKS) {
        log(
          `⚠️ Content has ${contentBlocks.length} blocks; will create page with first ${MAX_BLOCKS} blocks and append the remaining in batches`
        );
        initialChildren = contentBlocks.slice(0, MAX_BLOCKS);
        remainingChildren = contentBlocks.slice(MAX_BLOCKS);
        log(
          `✅ Prepared initial ${initialChildren.length} blocks and ${remainingChildren.length} remaining to append`
        );
      }

      // Apply dynamic Figure/Image property detection
      // Check if Figure/Image was explicitly set by userscript first
      let figureImagePropertySet = false;
      if (properties["Figure/Image"] !== undefined) {
        log("✅ Figure/Image property explicitly provided by userscript");
        figureImagePropertySet = true;
      } else {
        // Use dynamic detection based on uploaded images
        const hasFigureImages = shouldSetFigureImageProperty(
          uploadedImageIds,
          contentBlocks
        );
        if (hasFigureImages) {
          properties["Figure/Image"] = { checkbox: true };
          log(
            "✅ Dynamic Figure/Image property set to true based on uploaded images"
          );
          figureImagePropertySet = true;
        } else {
          log("ℹ️ No uploaded images detected - Figure/Image property not set");
        }
      }

      // Protect dynamic Figure/Image property from being overwritten by metadata processing
      const dynamicFigureImageValue = figureImagePropertySet
        ? properties["Figure/Image"]
        : null;

      // Prepare page creation object
      pageCreateObject = {
        parent: { database_id: payload.databaseId },
        properties: properties,
        children: initialChildren,
      };

      // If caller requests full payload for debugging, return it now without calling Notion
      try {
        const debugHeader = req.headers && req.headers["x-debug-full-payload"];
        if (debugHeader && String(debugHeader) === "1") {
          log(
            "🔧 x-debug-full-payload header detected - returning assembled pageCreateObject for inspection"
          );
          // Return a safe, circular-free copy
          function getCircularReplacer() {
            const seen = new WeakSet();
            return function (key, value) {
              if (typeof value === "object" && value !== null) {
                if (seen.has(value)) return "[Circular]";
                seen.add(value);
              }
              return value;
            };
          }
          const safeString = JSON.stringify(
            pageCreateObject,
            getCircularReplacer(),
            2
          );
          let parsed;
          try {
            parsed = JSON.parse(safeString);
          } catch (e) {
            parsed = safeString;
          }
          return res
            .status(200)
            .json({ success: true, debugFullPayload: parsed });
        }
      } catch (e) {
        log("⚠️ Debug early-return failed:", e.message);
      }

      // Handle icon downloads before page creation
      if (
        payload.icon &&
        payload.icon.type === "file_upload" &&
        payload.icon.url &&
        !payload.icon.fileUploadId
      ) {
        try {
          log(
            "⬇️ Icon has URL but no fileUploadId, downloading and uploading..."
          );

          let uploadId = null;

          // Handle data URLs differently from external URLs
          if (payload.icon.url.startsWith("data:")) {
            log("📁 Icon is data URL, converting to buffer for upload...");
            const base64Data = payload.icon.url.split(",")[1];
            const buffer = Buffer.from(base64Data, "base64");
            const mimeType = payload.icon.mimeType || "image/png";
            const filename = payload.icon.name || "icon.png";

            uploadId = await uploadBufferToNotion(buffer, filename, mimeType);
          } else {
            uploadId = await downloadAndUploadImage(
              payload.icon.url,
              payload.icon.alt || "icon"
            );
          }

          if (uploadId) {
            payload.icon.fileUploadId = uploadId;
            log("✅ Icon downloaded and uploaded, fileUploadId:", uploadId);
          } else {
            log(
              "❌ Failed to download and upload icon, falling back to external"
            );
            payload.icon.type = "external";
          }
        } catch (error) {
          log("❌ Error downloading icon:", error.message);
          log("Falling back to external icon");
          payload.icon.type = "external";
        }
      }

      // 🛡️ PROTECTION: Validate icon/cover data integrity before processing
      const warnings = [];
      if (preservedIconCover.icon && !payload.icon) {
        warnings.push("Icon data was lost during content processing");
        payload.icon = preservedIconCover.icon;
      }
      if (preservedIconCover.cover && !payload.cover) {
        warnings.push("Cover data was lost during content processing");
        payload.cover = preservedIconCover.cover;
      }
      if (warnings.length > 0) {
        log("🛡️ PROTECTION: Restored icon/cover data:", warnings.join(", "));
      }

      // Add icon if provided
      if (payload.icon) {
        if (payload.icon.type === "emoji" && payload.icon.emoji) {
          pageCreateObject.icon = {
            type: "emoji",
            emoji: payload.icon.emoji,
          };
          log("🎭 Adding emoji icon:", payload.icon.emoji);
        } else if (payload.icon.type === "external" && payload.icon.url) {
          pageCreateObject.icon = {
            type: "external",
            external: { url: payload.icon.url },
          };
          log("🖼️ Adding external icon:", payload.icon.url);
        } else if (
          (payload.icon.type === "file" ||
            payload.icon.type === "file_upload") &&
          payload.icon.fileUploadId
        ) {
          pageCreateObject.icon = {
            type: "file_upload",
            file_upload: { id: payload.icon.fileUploadId },
          };
          log("📁 Adding file icon with upload ID:", payload.icon.fileUploadId);
        }
      }

      // Handle cover downloads before page creation
      if (
        payload.cover &&
        payload.cover.type === "file_upload" &&
        payload.cover.url &&
        !payload.cover.fileUploadId
      ) {
        try {
          log(
            "⬇️ Cover has URL but no fileUploadId, downloading and uploading..."
          );

          let uploadId = null;

          // Handle data URLs differently from external URLs
          if (payload.cover.url.startsWith("data:")) {
            log("🖼️ Cover is data URL, converting to buffer for upload...");
            const base64Data = payload.cover.url.split(",")[1];
            const buffer = Buffer.from(base64Data, "base64");
            const mimeType = payload.cover.mimeType || "image/png";
            const filename = payload.cover.name || "cover.png";

            uploadId = await uploadBufferToNotion(buffer, filename, mimeType);
          } else {
            uploadId = await downloadAndUploadImage(
              payload.cover.url,
              payload.cover.alt || "cover"
            );
          }

          if (uploadId) {
            payload.cover.fileUploadId = uploadId;
            log("✅ Cover downloaded and uploaded, fileUploadId:", uploadId);
          } else {
            log(
              "❌ Failed to download and upload cover, falling back to external"
            );
            payload.cover.type = "external";
          }
        } catch (error) {
          log("❌ Error downloading cover:", error.message);
          log("Falling back to external cover");
          payload.cover.type = "external";
        }
      }

      // Add cover if provided (only external covers in initial creation)
      if (
        payload.cover &&
        payload.cover.type === "external" &&
        payload.cover.url
      ) {
        pageCreateObject.cover = {
          type: "external",
          external: { url: payload.cover.url },
        };
        log("🖼️ Adding external cover:", payload.cover.url);
      }
      // Note: Uploaded file covers are handled after page creation

      // Create the page
      // Build a JSON-safe summary of properties to aid debugging if Notion rejects the payload
      const debugPropertiesSummary = Object.entries(properties || {}).reduce(
        (acc, [k, v]) => {
          try {
            acc[k] = Object.keys(v || {});
          } catch (e) {
            acc[k] = typeof v;
          }
          return acc;
        },
        {}
      );

      log("🔎 Page properties summary:", debugPropertiesSummary);
      try {
        log("🔎 Full properties payload:", JSON.stringify(properties, null, 2));
      } catch (e) {
        log(
          "� Full properties payload (stringify failed):",
          String(properties)
        );
      }

      log("�📄 Creating page in Notion...");

      // Enhanced debug logging for image validation errors
      if (
        pageCreateObject.children &&
        Array.isArray(pageCreateObject.children)
      ) {
        log(
          `🔍 Debugging page content before creation - ${pageCreateObject.children.length} blocks:`
        );
        pageCreateObject.children.forEach((block, index) => {
          if (block && block.image && block.image.type === "external") {
            log(
              `  📸 Block ${index + 1}: External image URL: ${
                block.image.external?.url
              }`
            );
            const isValid = isValidImageUrl(block.image.external?.url);
            log(`  📸 Block ${index + 1}: URL validation result: ${isValid}`);
          }
        });
      }

      // Debug icon and cover URLs
      if (pageCreateObject.icon && pageCreateObject.icon.type === "external") {
        log(`🖼️ Icon URL: ${pageCreateObject.icon.external?.url}`);
        log(
          `🖼️ Icon validation: ${isValidImageUrl(
            pageCreateObject.icon.external?.url
          )}`
        );
      }
      if (
        pageCreateObject.cover &&
        pageCreateObject.cover.type === "external"
      ) {
        log(`🖼️ Cover URL: ${pageCreateObject.cover.external?.url}`);
        log(
          `🖼️ Cover validation: ${isValidImageUrl(
            pageCreateObject.cover.external?.url
          )}`
        );
      }

      // SANITIZE: Remove any undefined or non-object children blocks AND fix malformed blocks
      try {
        log(
          "🔍 Starting sanitization - children count:",
          pageCreateObject.children?.length || 0
        );
        log("🔍 pageCreateObject exists:", !!pageCreateObject);
        log(
          "🔍 pageCreateObject.children exists:",
          !!pageCreateObject.children
        );
        log(
          "🔍 pageCreateObject.children is array:",
          Array.isArray(pageCreateObject.children)
        );
        if (
          pageCreateObject.children &&
          Array.isArray(pageCreateObject.children)
        ) {
          const originalCount = pageCreateObject.children.length;
          const removedIndices = [];
          const fixedIndices = [];

          // Valid Notion block types
          const validTypes = [
            "paragraph",
            "heading_1",
            "heading_2",
            "heading_3",
            "bulleted_list_item",
            "numbered_list_item",
            "to_do",
            "toggle",
            "quote",
            "callout",
            "code",
            "embed",
            "image",
            "video",
            "file",
            "pdf",
            "audio",
            "bookmark",
            "equation",
            "divider",
            "table_of_contents",
            "breadcrumb",
            "link_to_page",
            "table",
            "table_row",
            "ai_block",
            "synced_block",
            "template",
          ];

          const sanitized = pageCreateObject.children
            .filter((block, idx) => {
              const ok = block && typeof block === "object";
              if (!ok) removedIndices.push(idx);
              return ok;
            })
            .map((block, idx) => {
              // Check if block has any valid type property
              const hasValidType = validTypes.some(
                (type) => block[type] !== undefined
              );

              if (!hasValidType) {
                // This is a malformed block - convert to safe paragraph
                fixedIndices.push(idx);
                log(
                  `🔧 Fixed malformed block at index ${idx}: no valid type properties found, object=${block.object}`
                );
                return {
                  object: "block",
                  type: "paragraph",
                  paragraph: {
                    rich_text: [
                      {
                        type: "text",
                        text: {
                          content: "[Recovered content from malformed block]",
                        },
                      },
                    ],
                  },
                };
              }

              return block;
            });

          if (removedIndices.length > 0) {
            log(
              `⚠️ Sanitized page children: removed ${
                removedIndices.length
              } invalid blocks at indices: ${removedIndices.join(", ")}`
            );
          }

          if (fixedIndices.length > 0) {
            log(
              `🔧 Fixed ${
                fixedIndices.length
              } malformed blocks at indices: ${fixedIndices.join(", ")}`
            );
          }

          if (removedIndices.length > 0 || fixedIndices.length > 0) {
            log(`⚠️ Children count: ${originalCount} → ${sanitized.length}`);
          }

          // Replace with sanitized array
          pageCreateObject.children = sanitized;

          // Recursively sanitize nested children with depth tracking
          function sanitizeNestedChildren(
            blocks,
            depth = 0,
            parentPath = "root"
          ) {
            if (!Array.isArray(blocks)) return;

            blocks.forEach((block, blockIdx) => {
              if (!block || typeof block !== "object") return;

              const currentPath = `${parentPath}[${blockIdx}]`;
              log(
                `🔍 Examining block at ${currentPath}, depth: ${depth}, type: ${block.type}`
              );

              // Notion has limits on nesting depth - remove children from deeply nested list items
              const MAX_NESTING_DEPTH = 2; // Very conservative limit to prevent validation errors

              if (depth >= MAX_NESTING_DEPTH) {
                let removedChildren = false;

                // Remove all possible children properties from deeply nested blocks
                if (block.children) {
                  log(
                    `🚨 Removing generic children from deeply nested block at ${currentPath} (depth ${depth})`
                  );
                  delete block.children;
                  removedChildren = true;
                }

                if (
                  block.bulleted_list_item &&
                  block.bulleted_list_item.children
                ) {
                  log(
                    `🚨 Removing children from deeply nested bulleted_list_item at ${currentPath} (depth ${depth})`
                  );
                  delete block.bulleted_list_item.children;
                  removedChildren = true;
                }

                if (
                  block.numbered_list_item &&
                  block.numbered_list_item.children
                ) {
                  log(
                    `🚨 Removing children from deeply nested numbered_list_item at ${currentPath} (depth ${depth})`
                  );
                  delete block.numbered_list_item.children;
                  removedChildren = true;
                }

                if (block.toggle && block.toggle.children) {
                  log(
                    `🚨 Removing children from deeply nested toggle at ${currentPath} (depth ${depth})`
                  );
                  delete block.toggle.children;
                  removedChildren = true;
                }

                if (block.callout && block.callout.children) {
                  log(
                    `🚨 Removing children from deeply nested callout at ${currentPath} (depth ${depth})`
                  );
                  delete block.callout.children;
                  removedChildren = true;
                }

                if (removedChildren) {
                  log(
                    `✂️ Flattened deeply nested block at ${currentPath} to prevent validation errors`
                  );
                  return; // Skip further processing since we removed children
                }
              }

              // Helper function to sanitize a children array
              function sanitizeChildrenArray(children, pathDescription) {
                if (!Array.isArray(children)) return;

                log(
                  `🔍 Sanitizing nested children at ${pathDescription} - count: ${children.length}`
                );

                const nestedOriginalCount = children.length;
                const nestedRemovedIndices = [];
                const nestedFixedIndices = [];

                const sanitizedChildren = children
                  .filter((child, childIdx) => {
                    const childOk = child && typeof child === "object";
                    if (!childOk) {
                      nestedRemovedIndices.push(childIdx);
                      log(
                        `🗑️ Removing invalid nested child at ${pathDescription}[${childIdx}]`
                      );
                      return false;
                    }
                    return true;
                  })
                  .map((child, childIdx) => {
                    const hasValidNestedType = validTypes.some(
                      (type) => child[type] !== undefined
                    );

                    if (!hasValidNestedType) {
                      nestedFixedIndices.push(childIdx);
                      log(
                        `🔧 Fixed malformed nested child at ${pathDescription}[${childIdx}], had object=${child.object}`
                      );
                      return {
                        object: "block",
                        type: "paragraph",
                        paragraph: {
                          rich_text: [
                            {
                              type: "text",
                              text: { content: "[Recovered nested content]" },
                            },
                          ],
                        },
                      };
                    }

                    return child;
                  });

                if (nestedRemovedIndices.length > 0) {
                  log(
                    `🔧 Removed ${nestedRemovedIndices.length} invalid nested children from ${pathDescription}`
                  );
                }
                if (nestedFixedIndices.length > 0) {
                  log(
                    `🔧 Fixed ${nestedFixedIndices.length} malformed nested children in ${pathDescription}`
                  );
                }

                return sanitizedChildren;
              }

              // Check for standard .children property
              if (block.children && Array.isArray(block.children)) {
                const childPath = `${currentPath}.children`;
                block.children = sanitizeChildrenArray(
                  block.children,
                  childPath
                );
                // Recursively sanitize deeper levels
                sanitizeNestedChildren(block.children, depth + 1, childPath);
              }

              // Check for list-specific children properties
              if (
                block.bulleted_list_item &&
                block.bulleted_list_item.children
              ) {
                const childPath = `${currentPath}.bulleted_list_item.children`;
                block.bulleted_list_item.children = sanitizeChildrenArray(
                  block.bulleted_list_item.children,
                  childPath
                );
                // Recursively sanitize deeper levels with incremented depth
                sanitizeNestedChildren(
                  block.bulleted_list_item.children,
                  depth + 1,
                  childPath
                );
              }

              if (
                block.numbered_list_item &&
                block.numbered_list_item.children
              ) {
                const childPath = `${currentPath}.numbered_list_item.children`;
                block.numbered_list_item.children = sanitizeChildrenArray(
                  block.numbered_list_item.children,
                  childPath
                );
                // Recursively sanitize deeper levels with incremented depth
                sanitizeNestedChildren(
                  block.numbered_list_item.children,
                  depth + 1,
                  childPath
                );
              }

              // Check for other block types that can have children
              if (block.toggle && block.toggle.children) {
                const childPath = `${currentPath}.toggle.children`;
                block.toggle.children = sanitizeChildrenArray(
                  block.toggle.children,
                  childPath
                );
                sanitizeNestedChildren(
                  block.toggle.children,
                  depth + 1,
                  childPath
                );
              }

              if (block.callout && block.callout.children) {
                const childPath = `${currentPath}.callout.children`;
                block.callout.children = sanitizeChildrenArray(
                  block.callout.children,
                  childPath
                );
                sanitizeNestedChildren(
                  block.callout.children,
                  depth + 1,
                  childPath
                );
              }
            });
          }

          sanitizeNestedChildren(pageCreateObject.children, 0, "children");
        }
        log(
          "🔍 Sanitization complete - final children count:",
          pageCreateObject.children?.length || 0
        );
      } catch (e) {
        log("❌ CRITICAL: Sanitization failed with error:", e);
        log("❌ Error message:", e && e.message ? e.message : "Unknown error");
        log("❌ Error stack:", e && e.stack ? e.stack : "No stack trace");
        // Don't let sanitization errors prevent the API call, just log them
      }

      // VALIDATE URLS: Scan and fix invalid URLs in all rich_text content
      try {
        log("🔗 Starting URL validation in rich_text content...");

        function isValidNotionUrl(url) {
          if (!url || typeof url !== "string") return false;

          const trimmed = url.trim();
          if (trimmed === "" || trimmed.length > 2048) return false;

          // Reject obviously malformed URLs with problematic characters
          if (
            trimmed.includes(" ") ||
            trimmed.includes("|") ||
            trimmed.includes("{") ||
            trimmed.includes("}") ||
            trimmed.includes("[") ||
            trimmed.includes("]") ||
            trimmed.includes("???") ||
            trimmed.includes("\\")
          ) {
            return false;
          }

          // Reject relative URLs
          if (
            trimmed.startsWith("./") ||
            trimmed.startsWith("../") ||
            trimmed.startsWith("/")
          ) {
            return false;
          }

          // Reject fragment-only URLs
          if (trimmed.startsWith("#")) return false;

          // Must start with valid protocol
          if (
            !trimmed.startsWith("http://") &&
            !trimmed.startsWith("https://")
          ) {
            return false;
          }

          // Reject javascript:, data:, file:, ftp: URLs for security
          if (
            trimmed.startsWith("javascript:") ||
            trimmed.startsWith("data:") ||
            trimmed.startsWith("file:") ||
            trimmed.startsWith("ftp:")
          ) {
            return false;
          }

          try {
            const urlObj = new URL(trimmed);

            // Must be http or https
            if (!["http:", "https:"].includes(urlObj.protocol)) {
              return false;
            }

            // Must have a valid hostname
            if (!urlObj.hostname || urlObj.hostname.length === 0) {
              return false;
            }

            // Reject localhost URLs (they won't work in Notion)
            if (
              urlObj.hostname === "localhost" ||
              urlObj.hostname === "127.0.0.1"
            ) {
              return false;
            }

            // Hostname should contain at least one dot (proper domain)
            if (!urlObj.hostname.includes(".")) {
              return false;
            }

            // Reject URLs with excessive parameters that might be malformed
            if (urlObj.search && urlObj.search.length > 1000) {
              return false;
            }

            return true;
          } catch (error) {
            return false;
          }
        }

        function sanitizeRichTextArray(richTextArray, blockPath = "unknown") {
          if (!Array.isArray(richTextArray)) return richTextArray;

          let urlsFixed = 0;
          const sanitized = richTextArray.map((richTextItem, idx) => {
            if (!richTextItem || typeof richTextItem !== "object") {
              return richTextItem;
            }

            // Check for link annotations
            if (
              richTextItem.annotations &&
              richTextItem.annotations.link &&
              richTextItem.annotations.link.url
            ) {
              const url = richTextItem.annotations.link.url;
              if (!isValidNotionUrl(url)) {
                log(
                  `🔗 Removing invalid URL from rich_text at ${blockPath}[${idx}]: "${url.substring(
                    0,
                    100
                  )}..."`
                );
                // Remove the link annotation but keep the text
                const fixed = { ...richTextItem };
                if (fixed.annotations) {
                  fixed.annotations = { ...fixed.annotations };
                  delete fixed.annotations.link;
                }
                urlsFixed++;
                return fixed;
              }
            }

            // Check direct href property (alternative format)
            if (richTextItem.href && !isValidNotionUrl(richTextItem.href)) {
              log(
                `🔗 Removing invalid href from rich_text at ${blockPath}[${idx}]: "${richTextItem.href.substring(
                  0,
                  100
                )}..."`
              );
              const fixed = { ...richTextItem };
              delete fixed.href;
              urlsFixed++;
              return fixed;
            }

            return richTextItem;
          });

          if (urlsFixed > 0) {
            log(
              `🔗 Fixed ${urlsFixed} invalid URLs in rich_text at ${blockPath}`
            );
          }

          return sanitized;
        }

        function sanitizeBlockUrls(block, blockPath = "unknown") {
          if (!block || typeof block !== "object") return;

          // Handle different block types with rich_text
          const blockType = block.type;
          if (blockType && block[blockType]) {
            const blockContent = block[blockType];

            // Sanitize rich_text arrays in various block types
            if (blockContent.rich_text) {
              blockContent.rich_text = sanitizeRichTextArray(
                blockContent.rich_text,
                `${blockPath}.${blockType}.rich_text`
              );
            }

            // Handle specific block types with nested rich_text
            if (blockType === "callout" && blockContent.rich_text) {
              blockContent.rich_text = sanitizeRichTextArray(
                blockContent.rich_text,
                `${blockPath}.callout.rich_text`
              );
            }

            if (blockType === "quote" && blockContent.rich_text) {
              blockContent.rich_text = sanitizeRichTextArray(
                blockContent.rich_text,
                `${blockPath}.quote.rich_text`
              );
            }

            // Handle table rows
            if (blockType === "table_row" && blockContent.cells) {
              blockContent.cells = blockContent.cells.map((cell, cellIdx) => {
                if (Array.isArray(cell)) {
                  return sanitizeRichTextArray(
                    cell,
                    `${blockPath}.table_row.cells[${cellIdx}]`
                  );
                }
                return cell;
              });
            }

            // Handle heading blocks
            if (
              ["heading_1", "heading_2", "heading_3"].includes(blockType) &&
              blockContent.rich_text
            ) {
              blockContent.rich_text = sanitizeRichTextArray(
                blockContent.rich_text,
                `${blockPath}.${blockType}.rich_text`
              );
            }

            // Recursively handle children
            if (blockContent.children && Array.isArray(blockContent.children)) {
              blockContent.children.forEach((child, childIdx) => {
                sanitizeBlockUrls(
                  child,
                  `${blockPath}.${blockType}.children[${childIdx}]`
                );
              });
            }
          }
        }

        // Sanitize URLs in the main content blocks
        if (
          pageCreateObject.children &&
          Array.isArray(pageCreateObject.children)
        ) {
          pageCreateObject.children.forEach((block, idx) => {
            sanitizeBlockUrls(block, `children[${idx}]`);
          });
        }

        log("🔗 URL validation completed");
      } catch (urlError) {
        log("❌ URL validation failed:", urlError.message);
        // Don't fail the request due to URL validation errors
      }

      log("✅ Sanitization block completed - proceeding to API call");
      log("🚀 Sending to Notion API...");

      let response;
      let attemptCount = 0;
      const maxAttempts = 2;

      while (attemptCount < maxAttempts) {
        attemptCount++;

        try {
          log(
            `🔄 Attempt ${attemptCount}/${maxAttempts} - Creating page in Notion...`
          );
          response = await notion.pages.create(pageCreateObject);
          break; // Success, exit the retry loop
        } catch (notionError) {
          log(`❌ Notion API error (attempt ${attemptCount}):`, notionError);

          // Check if this is a URL validation error
          const errorMessage =
            notionError?.body || notionError?.message || String(notionError);
          const isUrlError =
            errorMessage.includes("Invalid URL for link") ||
            errorMessage.includes("validation_error");

          if (isUrlError && attemptCount < maxAttempts) {
            log(
              "🔧 Detected URL validation error - attempting fallback with all links removed"
            );

            // Strip ALL links from content as a fallback
            function stripAllLinksFromRichText(richTextArray) {
              if (!Array.isArray(richTextArray)) return richTextArray;

              return richTextArray.map((item) => {
                if (!item || typeof item !== "object") return item;

                // Remove link annotations
                if (item.annotations && item.annotations.link) {
                  const cleaned = { ...item };
                  cleaned.annotations = { ...cleaned.annotations };
                  delete cleaned.annotations.link;
                  log("🔗 Stripped link annotation from rich_text item");
                  return cleaned;
                }

                // Remove href property
                if (item.href) {
                  const cleaned = { ...item };
                  delete cleaned.href;
                  log("🔗 Stripped href from rich_text item");
                  return cleaned;
                }

                return item;
              });
            }

            function stripAllLinksFromBlock(block) {
              if (!block || typeof block !== "object") return;

              const blockType = block.type;
              if (blockType && block[blockType]) {
                const blockContent = block[blockType];

                // Strip links from rich_text arrays
                if (blockContent.rich_text) {
                  blockContent.rich_text = stripAllLinksFromRichText(
                    blockContent.rich_text
                  );
                }

                // Handle table rows
                if (blockType === "table_row" && blockContent.cells) {
                  blockContent.cells = blockContent.cells.map((cell) => {
                    if (Array.isArray(cell)) {
                      return stripAllLinksFromRichText(cell);
                    }
                    return cell;
                  });
                }

                // Handle children recursively
                if (
                  blockContent.children &&
                  Array.isArray(blockContent.children)
                ) {
                  blockContent.children.forEach((child) => {
                    stripAllLinksFromBlock(child);
                  });
                }
              }
            }

            // Apply link stripping to all content
            if (
              pageCreateObject.children &&
              Array.isArray(pageCreateObject.children)
            ) {
              pageCreateObject.children.forEach((block) => {
                stripAllLinksFromBlock(block);
              });
            }

            log("🔧 All links stripped from content - retrying page creation");
            continue; // Retry with stripped content
          } else {
            // Not a URL error or we've exhausted attempts - re-throw the error
            throw notionError;
          }
        }
      }

      if (attemptCount === 1) {
        log("✅ Page created successfully on first attempt!");
      } else {
        log(
          `✅ Page created successfully on attempt ${attemptCount} (after URL link stripping fallback)!`
        );
      }
      log("📄 Page ID:", response.id);
      log("🔗 Page URL:", response.url);

      // If we have remaining children, append them in batches of MAX_BLOCKS
      if (remainingChildren && remainingChildren.length > 0) {
        try {
          log(
            `🔁 Appending remaining ${remainingChildren.length} blocks in batches of ${MAX_BLOCKS} to page ${response.id}`
          );

          for (let i = 0; i < remainingChildren.length; i += MAX_BLOCKS) {
            const chunk = remainingChildren.slice(i, i + MAX_BLOCKS);

            // Filter out any undefined blocks in this chunk
            const validChunk = chunk.filter((block, chunkIndex) => {
              if (block === undefined || block === null) {
                log(
                  `🚫 Skipping undefined/null block in append chunk at position ${
                    i + chunkIndex
                  }`
                );
                return false;
              }
              if (typeof block !== "object") {
                log(
                  `🚫 Skipping invalid block (not object) in append chunk at position ${
                    i + chunkIndex
                  }: ${typeof block}`
                );
                return false;
              }
              if (!block.type) {
                log(
                  `🚫 Skipping block without type in append chunk at position ${
                    i + chunkIndex
                  }`
                );
                return false;
              }
              return true;
            });

            if (validChunk.length !== chunk.length) {
              log(
                `🧹 Append chunk validation: Filtered ${
                  chunk.length - validChunk.length
                } invalid blocks (${validChunk.length} remaining)`
              );
            }

            // Only append if we have valid blocks
            if (validChunk.length > 0) {
              const chunkIndex = Math.floor(i / MAX_BLOCKS) + 1;
              log(
                `🧩 Appending chunk ${chunkIndex} with ${validChunk.length} valid blocks`
              );
              await notion.blocks.children.append({
                block_id: response.id,
                children: validChunk,
              });
              log(`✅ Appended chunk ${chunkIndex}`);
            } else {
              log(
                `⚠️ Skipping empty chunk ${
                  Math.floor(i / MAX_BLOCKS) + 1
                } (no valid blocks)`
              );
            }
          }

          log("✅ All remaining blocks appended successfully");
        } catch (appendErr) {
          log("⚠️ Failed to append remaining blocks:", appendErr.message);
          // Don't fail the whole request for append failures; surface a warning in logs
        }
      }

      // Handle cover separately if it's an uploaded file (covers often need post-creation update)
      if (
        payload.cover &&
        (payload.cover.type === "file" ||
          payload.cover.type === "file_upload") &&
        payload.cover.fileUploadId
      ) {
        try {
          log(
            "🖼️ Updating page cover with uploaded file (optimistic update)..."
          );
          log("🖼️ Cover fileUploadId:", payload.cover.fileUploadId);

          // Perform an optimistic update: set the page cover to the uploaded file_upload id
          // Do not block on notion.fileUploads.retrieve() as that can introduce a race
          // and sometimes returns a non-uploaded status even though the file is usable.
          await notion.pages.update({
            page_id: response.id,
            cover: {
              type: "file_upload",
              file_upload: {
                id: payload.cover.fileUploadId,
              },
            },
          });

          log(
            "✅ Cover update attempted with file upload ID:",
            payload.cover.fileUploadId
          );
        } catch (coverError) {
          log("⚠️ Failed to update cover:", coverError.message);
          log("🔍 Cover error details:", coverError);
          // Don't fail the whole request if just the cover fails
        }
      }

      // Validate URL format
      if (!response.url || !response.url.includes("notion.so")) {
        log("⚠️ WARNING: Suspicious URL format:", response.url);
        return res.status(500).json({
          success: false,
          error: "Invalid URL returned by Notion API",
          details: "URL does not contain notion.so domain",
        });
      }

      // Return success response
      return res.json({
        success: true,
        pageUrl: response.url,
        page: {
          url: response.url,
          id: response.id,
          title: payload.title,
        },
      });
    } catch (notionError) {
      log("❌ Notion API error:", notionError);
      try {
        log("🔍 Full error object:", JSON.stringify(notionError, null, 2));
      } catch (e) {
        log("🔍 Full error object (string fallback):", String(notionError));
      }

      // Extract more detailed error information
      let errorDetails = notionError.message || "Unknown Notion error";
      let errorCode = notionError.code || "unknown";

      // Pull any upstream HTTP response info (axios-like / notion client)
      const upstreamStatus =
        notionError.status ||
        notionError.statusCode ||
        (notionError.response && notionError.response.status) ||
        null;
      const upstreamBody =
        (notionError.response && notionError.response.data) ||
        notionError.body ||
        null;

      if (upstreamBody) {
        try {
          log("🔍 Error body:", JSON.stringify(upstreamBody, null, 2));
        } catch (e) {
          log("🔍 Error body (string):", String(upstreamBody));
        }
        // Prefer message from upstream body if available
        if (upstreamBody && upstreamBody.message) {
          errorDetails = upstreamBody.message;
        }
        if (upstreamBody && upstreamBody.code) {
          errorCode = upstreamBody.code;
        }
      } else if (notionError.body) {
        // legacy fallback
        log("🔍 Error body:", JSON.stringify(notionError.body, null, 2));
        if (notionError.body.message) {
          errorDetails = notionError.body.message;
        }
        if (notionError.body.code) {
          errorCode = notionError.body.code;
        }
      }

      // Include a JSON-safe debug summary of properties in the response for local debugging
      const debugPayloadSummary =
        typeof debugPropertiesSummary !== "undefined"
          ? debugPropertiesSummary
          : null;

      // Optionally include the full pageCreateObject when the caller provides a debug header
      log(
        "🔧 Debug header x-debug-full-payload:",
        req.headers && req.headers["x-debug-full-payload"]
      );
      const includeFull =
        req.headers && String(req.headers["x-debug-full-payload"]) === "1";
      const debugFullPayload = includeFull ? pageCreateObject : undefined;

      // Helper to safely stringify objects with circular refs
      function getCircularReplacer() {
        const seen = new WeakSet();
        return function (key, value) {
          if (typeof value === "object" && value !== null) {
            if (seen.has(value)) return "[Circular]";
            seen.add(value);
          }
          return value;
        };
      }

      const errorResponse = {
        success: false,
        error: "Failed to create page in Notion",
        details: errorDetails,
        code: errorCode,
        notionUpstreamStatus: upstreamStatus,
        notionUpstreamBody: upstreamBody,
        debugPropertiesSummary: debugPayloadSummary,
      };

      if (debugFullPayload) {
        // For quicker local debugging, include the full pageCreateObject inline in the response
        // Use a circular-safe stringifier and attempt to parse back to an object; if parsing fails,
        // include the safe string instead.
        try {
          const safeString = JSON.stringify(
            debugFullPayload,
            getCircularReplacer(),
            2
          );
          let parsedPayload;
          try {
            parsedPayload = JSON.parse(safeString);
          } catch (parseErr) {
            // If parsing fails, fall back to providing the safe string
            parsedPayload = safeString;
          }
          errorResponse.debugFullPayload = parsedPayload;
          // Log a truncated preview to the server log for quick reference
          log(
            `🗂️ Included debug full payload inline (preview): ${String(
              safeString
            ).substring(0, 1000)}`
          );
        } catch (e) {
          log("⚠️ Failed to include debug full payload inline:", e.message);
          try {
            errorResponse.debugFullPayload = JSON.parse(
              JSON.stringify(debugFullPayload)
            );
          } catch (e2) {
            errorResponse.debugFullPayload = String(debugFullPayload);
          }
        }
      }

      // Include a small preview of sanitized children to help debugging without
      // returning massive payloads. Only include minimal fields per child.
      try {
        if (
          pageCreateObject &&
          Array.isArray(pageCreateObject.children) &&
          pageCreateObject.children.length > 0
        ) {
          errorResponse.sanitizedChildrenPreview = pageCreateObject.children
            .slice(0, 10)
            .map((c) => {
              try {
                const preview = { type: c && c.type ? c.type : typeof c };
                // extract short text preview when present
                if (
                  c &&
                  c[c.type] &&
                  c[c.type].rich_text &&
                  Array.isArray(c[c.type].rich_text) &&
                  c[c.type].rich_text[0]
                ) {
                  const txt =
                    c[c.type].rich_text[0].plain_text ||
                    c[c.type].rich_text[0].text?.content;
                  if (txt) preview.text = String(txt).substring(0, 120);
                }
                // handle paragraph plain_text fallback
                if (
                  !preview.text &&
                  c &&
                  c.paragraph &&
                  c.paragraph.rich_text &&
                  c.paragraph.rich_text[0]
                ) {
                  preview.text = String(
                    c.paragraph.rich_text[0].plain_text ||
                      c.paragraph.rich_text[0].text?.content
                  ).substring(0, 120);
                }
                return preview;
              } catch (e) {
                return { type: c && c.type ? c.type : typeof c };
              }
            });
        }
      } catch (e) {
        // swallow preview errors — don't obscure the original error
        log(
          "⚠️ Failed to build sanitizedChildrenPreview:",
          e && e.message ? e.message : e
        );
      }

      return res.status(500).json(errorResponse);
    }
  } catch (err) {
    log("❌ General error:", err);
    return res.status(500).json({
      error: "Internal server error",
      details: err.message,
    });
  }
});

// Database Operations API Routes

/**
 * GET /api/databases - List all databases accessible to the integration
 * Query params:
 *   - search (optional) - search term to filter databases
 *   - start_cursor (optional) - pagination cursor
 *   - page_size (optional) - number of results per page (default 100, max 100)
 * Returns: { databases: [...], next_cursor?: string, has_more: boolean }
 * Note: Uses Search API since databases.list() was deprecated
 */
app.get("/api/databases", async (req, res) => {
  try {
    const searchTerm = req.query.search;
    const startCursor = req.query.start_cursor;
    const pageSize = Math.min(parseInt(req.query.page_size) || 100, 100);

    if (searchTerm) {
      log(`📋 Searching databases for term: "${searchTerm}"`);
    } else {
      log(
        `📋 Fetching accessible databases using Search API (page_size: ${pageSize})`
      );
    }

    // Use search API to find databases
    const searchQuery = {
      filter: {
        value: "database",
        property: "object",
      },
      sort: {
        direction: "ascending",
        timestamp: "last_edited_time",
      },
      page_size: pageSize,
    };

    // Add search query if provided
    if (searchTerm) {
      searchQuery.query = searchTerm;
    }

    // Add pagination cursor if provided
    if (startCursor) {
      searchQuery.start_cursor = startCursor;
    }

    const response = await notion.search(searchQuery);

    // Helper function to get database title
    const getDatabaseTitle = (database) => {
      if (database.title && database.title.length > 0) {
        return (
          database.title[0].plain_text ||
          database.title[0].text?.content ||
          "Untitled Database"
        );
      }
      return "Untitled Database";
    };

    // Sort databases: Nexus first, then alphabetically
    const sortedDatabases = response.results.sort((a, b) => {
      const titleA = getDatabaseTitle(a);
      const titleB = getDatabaseTitle(b);

      const isNexusA =
        titleA.toLowerCase().includes("nexus") ||
        (a.parent?.type === "page_id" &&
          titleA.toLowerCase().includes("nexus"));
      const isNexusB =
        titleB.toLowerCase().includes("nexus") ||
        (b.parent?.type === "page_id" &&
          titleB.toLowerCase().includes("nexus"));

      // Nexus databases first
      if (isNexusA && !isNexusB) return -1;
      if (!isNexusA && isNexusB) return 1;

      // Then alphabetical
      return titleA.localeCompare(titleB);
    });

    log(
      `✅ Found ${sortedDatabases.length} databases via Search API (${
        searchTerm ? "filtered" : "all"
      })${response.has_more ? " - more available" : ""}`
    );

    res.json({
      databases: sortedDatabases,
      count: sortedDatabases.length,
      searchTerm: searchTerm || null,
      next_cursor: response.next_cursor,
      has_more: response.has_more,
    });
  } catch (error) {
    log("❌ Error fetching databases:", error);
    res.status(500).json({
      error: "Failed to fetch databases",
      details: error.message,
    });
  }
});

/**
 * GET /api/databases/:id - Get database schema and properties
 * Returns: { database: {...} }
 */
app.get("/api/databases/:id", async (req, res) => {
  try {
    const databaseId = hyphenateNotionId(req.params.id);
    log(`📊 Fetching database schema: ${databaseId}`);

    const response = await notion.databases.retrieve({
      database_id: databaseId,
    });

    log("✅ Database schema retrieved");
    res.json({ database: response });
  } catch (error) {
    log("❌ Error fetching database:", error);
    res.status(500).json({
      error: "Failed to fetch database",
      details: error.message,
    });
  }
});

/**
 * POST /api/databases/:id/query - Query database pages with filtering/sorting
 * Body: { filter?: {...}, sorts?: [...], page_size?: number, start_cursor?: string }
 * Returns: { results: [...], next_cursor?: string, has_more: boolean }
 */
app.post("/api/databases/:id/query", async (req, res) => {
  try {
    const databaseId = hyphenateNotionId(req.params.id);
    const { filter, sorts, page_size, start_cursor } = req.body;

    log(`🔍 Querying database: ${databaseId}`);

    const queryParams = { database_id: databaseId };
    if (filter) queryParams.filter = filter;
    if (sorts) queryParams.sorts = sorts;
    if (page_size) queryParams.page_size = page_size;
    if (start_cursor) queryParams.start_cursor = start_cursor;

    const response = await notion.databases.query(queryParams);

    log(`✅ Query returned ${response.results.length} pages`);
    res.json({
      results: response.results,
      next_cursor: response.next_cursor,
      has_more: response.has_more,
      count: response.results.length,
    });
  } catch (error) {
    log("❌ Error querying database:", error);
    res.status(500).json({
      error: "Failed to query database",
      details: error.message,
    });
  }
});

// Page Operations API Routes

/**
 * GET /api/pages/:id - Retrieve page details and properties
 * Returns: { page: {...} }
 */
app.get("/api/pages/:id", async (req, res) => {
  try {
    const pageId = hyphenateNotionId(req.params.id);
    log(`📄 Fetching page: ${pageId}`);

    const response = await notion.pages.retrieve({ page_id: pageId });

    log("✅ Page retrieved");
    res.json({ page: response });
  } catch (error) {
    log("❌ Error fetching page:", error);
    res.status(500).json({
      error: "Failed to fetch page",
      details: error.message,
    });
  }
});

/**
 * PATCH /api/pages/:id - Update page properties
 * Body: { properties: {...}, archived?: boolean }
 * Returns: { page: {...} }
 */
app.patch("/api/pages/:id", async (req, res) => {
  try {
    const pageId = hyphenateNotionId(req.params.id);
    const { properties, archived } = req.body;

    log(`📝 Updating page: ${pageId}`);

    const updateParams = { page_id: pageId };
    if (properties) updateParams.properties = properties;
    if (typeof archived === "boolean") updateParams.archived = archived;

    const response = await notion.pages.update(updateParams);

    log("✅ Page updated");
    res.json({ page: response });
  } catch (error) {
    log("❌ Error updating page:", error);
    res.status(500).json({
      error: "Failed to update page",
      details: error.message,
    });
  }
});

/**
 * GET /api/pages/:id/blocks - Get page content blocks
 * Query: page_size?, start_cursor?
 * Returns: { blocks: [...], next_cursor?: string, has_more: boolean }
 */
app.get("/api/pages/:id/blocks", async (req, res) => {
  try {
    const pageId = hyphenateNotionId(req.params.id);
    const { page_size, start_cursor } = req.query;

    log(`🧱 Fetching blocks for page: ${pageId}`);

    const queryParams = { block_id: pageId };
    if (page_size) queryParams.page_size = parseInt(page_size);
    if (start_cursor) queryParams.start_cursor = start_cursor;

    const response = await notion.blocks.children.list(queryParams);

    log(`✅ Retrieved ${response.results.length} blocks`);
    res.json({
      blocks: response.results,
      next_cursor: response.next_cursor,
      has_more: response.has_more,
      count: response.results.length,
    });
  } catch (error) {
    log("❌ Error fetching blocks:", error);
    res.status(500).json({
      error: "Failed to fetch blocks",
      details: error.message,
    });
  }
});

// Block Operations API Routes

/**
 * POST /api/blocks/:id/children - Append blocks to a page or block
 * Body: { children: [...] }
 * Returns: { blocks: [...] }
 */
app.post("/api/blocks/:id/children", async (req, res) => {
  try {
    const blockId = hyphenateNotionId(req.params.id);
    const { children } = req.body;

    if (!children || !Array.isArray(children)) {
      return res.status(400).json({
        error: "Missing or invalid children array",
      });
    }

    log(`📝 Appending ${children.length} blocks to: ${blockId}`);

    const response = await notion.blocks.children.append({
      block_id: blockId,
      children: children,
    });

    log("✅ Blocks appended successfully");
    res.json({
      blocks: response.results,
      count: response.results.length,
    });
  } catch (error) {
    log("❌ Error appending blocks:", error);
    res.status(500).json({
      error: "Failed to append blocks",
      details: error.message,
    });
  }
});

/**
 * PATCH /api/blocks/:id - Update a specific block
 * Body: block update object (varies by block type)
 * Returns: { block: {...} }
 */
app.patch("/api/blocks/:id", async (req, res) => {
  try {
    const blockId = hyphenateNotionId(req.params.id);
    const updateData = req.body;

    log(`🔧 Updating block: ${blockId}`);

    const response = await notion.blocks.update({
      block_id: blockId,
      ...updateData,
    });

    log("✅ Block updated");
    res.json({ block: response });
  } catch (error) {
    log("❌ Error updating block:", error);
    res.status(500).json({
      error: "Failed to update block",
      details: error.message,
    });
  }
});

/**
 * DELETE /api/blocks/:id - Archive/delete a block
 * Returns: { block: {...} }
 */
app.delete("/api/blocks/:id", async (req, res) => {
  try {
    const blockId = hyphenateNotionId(req.params.id);

    log(`🗑️ Archiving block: ${blockId}`);

    const response = await notion.blocks.update({
      block_id: blockId,
      archived: true,
    });

    log("✅ Block archived");
    res.json({ block: response });
  } catch (error) {
    log("❌ Error archiving block:", error);
    res.status(500).json({
      error: "Failed to archive block",
      details: error.message,
    });
  }
});

/**
 * Dev endpoint: upload image bytes (base64 or multipart) directly to Notion
 * - Accepts JSON: { filename, data } where data is a data URI or base64
 * - Or accepts multipart/form-data with a file field named `file`
 * Returns: { success, fileUploadId, fileName }
 * Note: this endpoint is intended for local/dev testing. For production,
 * integrate uploads into your main page creation flow.
 */
app.post(
  "/upload-to-notion",
  upload ? upload.single("file") : (req, res, next) => next(),
  async (req, res) => {
    try {
      if (!notion) {
        return res.status(500).json({ error: "Notion client not initialized" });
      }

      let filename;
      let buffer;
      let filePath = null; // Initialize filePath to avoid undefined reference

      // Check if we have a multipart file upload (saved to disk by multer)
      if (req.file) {
        filename = req.file.filename;
        filePath = req.file.path;
        buffer = fs.readFileSync(filePath);
        log(`Processing uploaded file: ${filename} from ${filePath}`);
      } else if (req.body && req.body.data) {
        // data URI or base64 string
        const data = req.body.data;
        // data may be a data URI like data:image/png;base64,AAA...
        const match = data.match(/^data:(.+);base64,(.*)$/);
        if (match) {
          const contentType = match[1];
          const base64 = match[2];
          buffer = Buffer.from(base64, "base64");
          const ext = contentType.split("/").pop().split("+")[0];
          filename = req.body.filename || `upload.${ext}`;
        } else {
          // assume raw base64
          buffer = Buffer.from(data, "base64");
          filename = req.body.filename || `upload.bin`;
        }
      } else if (req.body && req.body.filename && req.body.base64) {
        buffer = Buffer.from(req.body.base64, "base64");
        filename = req.body.filename;
      } else {
        return res.status(400).json({ error: "No file data provided" });
      }

      // Extract MIME type if provided
      const mimeType = req.body.mimeType || null;

      if (!ensureFileUploadAvailable()) {
        return res.status(500).json({
          error:
            "Notion SDK file upload API not available. Upgrade @notionhq/client or use external image URLs",
        });
      }

      // FIXED IMPLEMENTATION: Using direct HTTP requests instead of SDK
      // This follows the official Notion API pattern from your documentation
      log(`Uploading ${filename} using direct HTTP API approach`);

      const axios = require("axios");
      const FormData = require("form-data");

      try {
        // Step 1: Create a File Upload object via direct HTTP
        log(`Step 1: Creating file upload object for ${filename}`);

        const createResponse = await axios.post(
          "https://api.notion.com/v1/file_uploads",
          {
            mode: "single_part",
            filename: filename,
            content_type: mimeType || "image/png",
          },
          {
            headers: {
              Authorization: `Bearer ${process.env.NOTION_TOKEN}`,
              "Content-Type": "application/json",
              "Notion-Version": "2022-06-28",
            },
          }
        );

        const fileUploadId = createResponse.data.id;
        const uploadUrl = createResponse.data.upload_url;
        log(`✅ Created file upload object: ${fileUploadId}`);
        log(`📤 Upload URL: ${uploadUrl.substring(0, 50)}...`);

        // Step 2: Send the file content using multipart/form-data
        log(`Step 2: Uploading binary content for ${filename}`);

        const formData = new FormData();
        formData.append("file", buffer, {
          filename: filename,
          contentType: mimeType || "image/png",
        });

        const uploadResponse = await axios.post(uploadUrl, formData, {
          headers: {
            Authorization: `Bearer ${process.env.NOTION_TOKEN}`,
            "Notion-Version": "2022-06-28",
            ...formData.getHeaders(),
          },
          maxContentLength: Infinity,
          maxBodyLength: Infinity,
        });

        log(`✅ File uploaded successfully: ${uploadResponse.status}`);
        log(`📁 Upload response:`, uploadResponse.data);

        return res.json({
          success: true,
          fileUploadId: uploadResponse.data.id || fileUploadId,
          fileName: filename,
          status: uploadResponse.data.status || "uploaded",
          uploadDetails: {
            contentType: uploadResponse.data.content_type,
            contentLength: uploadResponse.data.content_length,
          },
        });
      } catch (uploadError) {
        log(
          `❌ Direct HTTP upload failed for ${filename}:`,
          uploadError.message
        );

        if (uploadError.response) {
          log(`📄 Error response:`, uploadError.response.data);
          return res.status(500).json({
            error: "File upload failed",
            details: uploadError.response.data,
            stage: uploadError.config?.url?.includes("file_uploads/")
              ? "file_send"
              : "file_create",
          });
        } else {
          return res.status(500).json({
            error: "File upload failed",
            details: uploadError.message,
          });
        }
      }
    } catch (err) {
      return res
        .status(500)
        .json({ error: "Internal server error", details: err.message });
    } finally {
      // Clean up temporary file if it was uploaded to disk via multer
      // Only relevant for multipart uploads saved to disk, not base64 uploads
      if (req.file && req.file.path && fs.existsSync(req.file.path)) {
        try {
          fs.unlinkSync(req.file.path);
          log(`Cleaned up temporary file: ${req.file.path}`);
        } catch (cleanupErr) {
          log(
            `Warning: Could not clean up temporary file ${req.file.path}: ${cleanupErr.message}`
          );
        }
      }
    }
  }
);

/**
 * Endpoint: multipart file upload (field `file`) -> upload to Notion -> append image block to NOTION_PAGE_ID
 * Useful for local end-to-end testing.
 */
app.post(
  "/upload-and-append",
  upload ? upload.single("file") : (req, res, next) => next(),
  async (req, res) => {
    try {
      if (!notion)
        return res.status(500).json({ error: "Notion client not initialized" });

      let pageId = process.env.NOTION_PAGE_ID;
      if (!pageId)
        return res.status(400).json({ error: "NOTION_PAGE_ID not set in env" });
      pageId = hyphenateNotionId(pageId);

      let buffer, filename, filePath;
      if (req.file) {
        // File was uploaded and saved to disk by multer
        filename = req.file.filename;
        filePath = req.file.path;
        buffer = fs.readFileSync(filePath);
        log(`Processing uploaded file: ${filename} from ${filePath}`);
      } else if (req.body && req.body.data) {
        // data URI
        const match = req.body.data.match(/^data:(.+);base64,(.*)$/);
        if (match) {
          buffer = Buffer.from(match[2], "base64");
          const ext = match[1].split("/").pop().split("+")[0];
          filename = req.body.filename || `upload.${ext}`;
        }
      }

      if (!buffer) return res.status(400).json({ error: "No file provided" });

      // Ensure the SDK supports file uploads
      if (!ensureFileUploadAvailable()) {
        return res.status(500).json({
          error:
            "Notion SDK file upload API not available. Upgrade @notionhq/client or use external image URLs",
        });
      }

      // Use helper to upload (or create a multipart session)
      // First, try a direct single_part create + send using the SDK with a Node Blob
      try {
        const ext = (filename || "").split(".").pop().toLowerCase();
        const ctMap = {
          png: "image/png",
          jpg: "image/jpeg",
          jpeg: "image/jpeg",
          gif: "image/gif",
          webp: "image/webp",
        };
        const content_type = ctMap[ext] || "application/octet-stream";
        const createRes = await notion.fileUploads.create({
          mode: "single_part",
          filename,
          content_type,
        });
        const uploadId = createRes.id || createRes.file_upload_id;
        if (uploadId && typeof notion.fileUploads.send === "function") {
          // construct Node Blob
          let BlobCtor = globalThis.Blob;
          try {
            if (!BlobCtor) BlobCtor = require("buffer").Blob;
          } catch (bErr) {
            BlobCtor = null;
          }
          let dataForSend = buffer;
          if (BlobCtor) {
            try {
              dataForSend = new BlobCtor([buffer], { type: content_type });
            } catch (bErr) {
              dataForSend = buffer;
            }
          }
          const sendRes = await notion.fileUploads.send({
            file_upload_id: uploadId,
            file: { filename, data: dataForSend },
          });
          // If send succeeds, append block and return
          if (sendRes && (sendRes.id || sendRes.file_upload_id)) {
            const usedId = sendRes.id || sendRes.file_upload_id || uploadId;
            const block = {
              object: "block",
              type: "image",
              image: { type: "file_upload", file_upload: { id: usedId } },
            };
            const appendRes = await notion.blocks.children.append({
              block_id: pageId,
              children: [block],
            });
            return res.json({
              success: true,
              appended: !!appendRes,
              fileUploadId: usedId,
            });
          }
        }
      } catch (inlineErr) {
        // Log and fall through to helper path
        log(
          "[m2n-proxy] inline single_part send failed",
          inlineErr && inlineErr.message
        );
      }

      const uploadResult = await martianHelper.uploadFileToNotion(
        buffer,
        filename
      );

      // If helper returned a ready-to-append block (e.g., multipart completed), append it.
      if (uploadResult && uploadResult.block) {
        const appendRes = await notion.blocks.children.append({
          block_id: pageId,
          children: [uploadResult.block],
        });
        return res.json({
          success: true,
          appended: !!appendRes,
          fileUploadId: uploadResult.fileUploadId,
        });
      }

      // Otherwise surface multipart session info
      if (uploadResult && uploadResult.multipart) {
        return res.status(200).json({
          success: true,
          multipart: true,
          fileUploadId: uploadResult.fileUploadId,
        });
      }

      return res.status(500).json({
        error: "Upload did not return a usable block or multipart session",
      });
    } catch (err) {
      return res
        .status(500)
        .json({ error: "Upload and append failed", details: err.message });
    } finally {
      // Clean up temporary file if it was uploaded to disk
      if (filePath) {
        try {
          fs.unlinkSync(filePath);
          log(`Cleaned up temporary file: ${filePath}`);
        } catch (cleanupErr) {
          log(
            `Warning: Could not clean up temporary file ${filePath}: ${cleanupErr.message}`
          );
        }
      }
    }
  }
);

/**
 * POST /fetch-and-upload
 * Payload: { url: string, filename?: string, alt?: string }
 * Downloads an external image URL server-side and uploads it to Notion using existing helpers.
 * Returns: { success: boolean, fileUploadId?: string, fileName?: string, error?: string }
 */
app.post("/fetch-and-upload", async (req, res) => {
  try {
    const { url, filename, alt } = req.body || {};
    if (!url)
      return res.status(400).json({ error: "Missing 'url' in request body" });

    log(`🔁 fetch-and-upload requested for: ${url}`);

    // Attempt to download and upload using helper
    const uploadId = await downloadAndUploadImage(
      url,
      alt || filename || "image"
    );

    if (!uploadId) {
      log(`⚠️ fetch-and-upload failed for: ${url}`);
      return res
        .status(500)
        .json({ success: false, error: "Failed to download or upload image" });
    }

    log(`✅ fetch-and-upload succeeded: ${uploadId}`);
    return res.json({
      success: true,
      fileUploadId: uploadId,
      fileName: filename || alt || path.basename(url),
    });
  } catch (err) {
    log(`❌ fetch-and-upload error: ${err.message}`);
    return res.status(500).json({ success: false, error: err.message });
  }
});

// Unsplash search endpoint
app.get("/api/unsplash/search", async (req, res) => {
  log("🔍 Unsplash search request received");

  if (!unsplash) {
    log("❌ Unsplash API not configured - UNSPLASH_ACCESS_KEY missing");
    return res.status(500).json({
      success: false,
      error:
        "Unsplash API not configured. Please add UNSPLASH_ACCESS_KEY to your .env file",
    });
  }

  const {
    query,
    page = 1,
    per_page = 20,
    orientation = "landscape",
  } = req.query;

  if (!query) {
    return res.status(400).json({
      success: false,
      error: "Query parameter is required",
    });
  }

  try {
    log(
      `🔍 Searching Unsplash for: "${query}" (page ${page}, per_page ${per_page})`
    );

    const result = await unsplash.search.getPhotos({
      query,
      page: parseInt(page),
      perPage: parseInt(per_page),
      orientation,
    });

    if (result.errors) {
      log(`❌ Unsplash API error:`, result.errors);
      return res.status(500).json({
        success: false,
        error: "Unsplash API error",
        details: result.errors,
      });
    }

    const photos = result.response.results.map((photo) => ({
      id: photo.id,
      url: photo.urls.regular,
      thumb: photo.urls.thumb,
      full: photo.urls.full,
      alt: photo.alt_description || photo.description || "",
      photographer: photo.user.name,
      photographerUrl: photo.user.links.html,
      downloadUrl: photo.links.download_location,
      color: photo.color,
      width: photo.width,
      height: photo.height,
    }));

    log(`✅ Found ${photos.length} photos for "${query}"`);

    res.json({
      success: true,
      photos,
      total: result.response.total,
      total_pages: result.response.total_pages,
      current_page: parseInt(page),
    });
  } catch (err) {
    log(`❌ Unsplash search error: ${err.message}`);
    return res.status(500).json({
      success: false,
      error: err.message,
    });
  }
});

// Get default Unsplash photos for specified categories
app.get("/api/unsplash/defaults", async (req, res) => {
  log("🎨 Default Unsplash photos request received");

  if (!unsplash) {
    log("❌ Unsplash API not configured - UNSPLASH_ACCESS_KEY missing");
    return res.status(500).json({
      success: false,
      error:
        "Unsplash API not configured. Please add UNSPLASH_ACCESS_KEY to your .env file",
    });
  }

  // Default search terms for covers
  const defaultTerms = ["texture", "abstract", "background", "geometric"];
  const { terms = defaultTerms.join(","), per_category = 5 } = req.query;

  const searchTerms = terms.split(",").map((term) => term.trim());

  try {
    log(`🎨 Fetching default photos for categories: ${searchTerms.join(", ")}`);

    const allPhotos = [];

    for (const term of searchTerms) {
      try {
        const result = await unsplash.search.getPhotos({
          query: term,
          page: 1,
          perPage: parseInt(per_category),
          orientation: "landscape",
        });

        if (result.response && result.response.results) {
          const photos = result.response.results.map((photo) => ({
            id: photo.id,
            url: photo.urls.regular,
            thumb: photo.urls.thumb,
            full: photo.urls.full,
            alt:
              photo.alt_description ||
              photo.description ||
              `${term} background`,
            photographer: photo.user.name,
            photographerUrl: photo.user.links.html,
            downloadUrl: photo.links.download_location,
            color: photo.color,
            width: photo.width,
            height: photo.height,
            category: term,
          }));
          allPhotos.push(...photos);
        }
      } catch (termError) {
        log(`⚠️ Error fetching photos for "${term}": ${termError.message}`);
      }
    }

    log(`✅ Fetched ${allPhotos.length} default photos`);

    res.json({
      success: true,
      photos: allPhotos,
      categories: searchTerms,
      total: allPhotos.length,
    });
  } catch (err) {
    log(`❌ Default photos error: ${err.message}`);
    return res.status(500).json({
      success: false,
      error: err.message,
    });
  }
});

const port = 3004;
app.listen(port, () => {
  log(`🚀 W2N Proxy Server running on http://localhost:${port}`);
  log(`📌 Notion API client ${notion ? "initialized" : "NOT initialized"}`);
  log(`📄 Log file: ${logFile}`);
});
