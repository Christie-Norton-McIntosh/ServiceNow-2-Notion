// Proxy API Communication - Direct communication with M2N proxy server

import { debug, getConfig } from "../config.js";
import { normalizeUrl, isValidImageUrl } from "../utils/url-utils.js";
import { hyphenateNotionId, findProperty } from "../utils/notion-utils.js";

const RETRYABLE_STATUS_CODES = new Set([408, 425, 429, 500, 502, 503, 504]);
const NETWORK_ERROR_CODES = new Set(["network", "timeout", "abort"]);

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function createRequestError(code, detail = {}) {
  const status =
    typeof detail.status === "number"
      ? detail.status
      : typeof detail.responseStatus === "number"
      ? detail.responseStatus
      : undefined;

  const messageSource =
    detail.error || detail.message || detail.statusText || code || "error";

  const error = new Error(
    code === "timeout"
      ? "Proxy request timed out before completion"
      : code === "abort"
      ? "Proxy request was aborted"
      : typeof messageSource === "string"
      ? messageSource
      : "Network error contacting proxy"
  );

  error.code = code;
  if (status) error.status = status;
  error.detail = detail;
  return error;
}

function shouldRetryRequest(error, attempt, maxAttempts) {
  if (!error || attempt >= maxAttempts - 1) {
    return false;
  }

  if (error.code && NETWORK_ERROR_CODES.has(error.code)) {
    return true;
  }

  if (typeof error.status === "number") {
    return RETRYABLE_STATUS_CODES.has(error.status);
  }

  const message = (error.message || "").toLowerCase();
  if (!message) return false;

  return (
    message.includes("network error") ||
    message.includes("failed to fetch") ||
    message.includes("timeout")
  );
}

function sanitizeTimeoutValue(timeoutFromConfig) {
  const parsed = Number(timeoutFromConfig);
  if (Number.isFinite(parsed) && parsed >= 1000) {
    return parsed;
  }
  return null;
}

/**
 * Make an API call to the proxy server with optional retries.
 * @param {string} method - HTTP method (GET, POST, etc.)
 * @param {string} endpoint - API endpoint path (e.g. /api/W2N)
 * @param {Object|null} data - Request payload for POST/PUT requests
 * @returns {Promise<Object>} API response
 */
export async function apiCall(method, endpoint, data = null) {
  const config = getConfig();
  const url = config.proxyUrl + endpoint;
  const timeout = sanitizeTimeoutValue(config.proxyTimeoutMs);
  const maxAttempts = 3;

  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    try {
      if (typeof GM_xmlhttpRequest === "undefined") {
        return await fallbackFetchCall(method, url, data, timeout);
      }

      return await sendWithGM(method, url, data, timeout);
    } catch (error) {
      if (!shouldRetryRequest(error, attempt, maxAttempts)) {
        throw error;
      }

      const backoffMs = Math.min(5000, 750 * (attempt + 1));
      debug(
        `⏳ Proxy request retry ${attempt + 1}/${
          maxAttempts - 1
        } in ${backoffMs}ms`
      );
      await delay(backoffMs);
    }
  }

  throw new Error("Unable to reach proxy after retries");
}

function sendWithGM(method, url, data, timeout) {
  const payload = data ? JSON.stringify(data) : undefined;

  return new Promise((resolve, reject) => {
    const request = {
      method,
      url,
      headers: {
        "Content-Type": "application/json",
      },
      data: payload,
      onload: function (response) {
        try {
          const result = JSON.parse(response.responseText);
          resolve(result);
        } catch (e) {
          debug("❌ Failed to parse API response:", response.responseText);
          resolve({ success: false, error: "Invalid API response" });
        }
      },
      onabort: function (error) {
        debug("❌ API call aborted:", error);
        reject(createRequestError("abort", error || {}));
      },
      ontimeout: function (error) {
        debug("❌ API call timed out:", error);
        reject(createRequestError("timeout", error || { status: 408 }));
      },
      onerror: function (error) {
        debug("❌ API call failed:", error);
        reject(createRequestError("network", error || {}));
      },
    };

    if (typeof timeout === "number" && timeout > 0) {
      request.timeout = timeout;
    }

    GM_xmlhttpRequest(request);
  });
}

/**
 * Fallback API call using fetch when GM_xmlhttpRequest is not available.
 * @param {string} method - HTTP method
 * @param {string} url - Full URL
 * @param {Object|null} data - Request data
 * @param {number|null} timeout - Optional timeout in milliseconds
 * @returns {Promise<Object>} API response
 */
async function fallbackFetchCall(method, url, data = null, timeout = null) {
  try {
    const hasTimeout = typeof timeout === "number" && timeout > 0;
    const controller =
      hasTimeout && typeof AbortController !== "undefined"
        ? new AbortController()
        : null;
    const abortTimer = controller
      ? setTimeout(() => {
          try {
            controller.abort();
          } catch (e) {
            // ignore abort errors
          }
        }, timeout)
      : null;

    const options = {
      method,
      headers: {
        "Content-Type": "application/json",
      },
      signal: controller ? controller.signal : undefined,
    };

    if (data) {
      options.body = JSON.stringify(data);
    }

    const response = await fetch(url, options);

    if (abortTimer) {
      clearTimeout(abortTimer);
    }

    if (!response.ok) {
      const error = new Error(`HTTP error! status: ${response.status}`);
      error.status = response.status;
      throw error;
    }

    const text = await response.text();
    try {
      return JSON.parse(text);
    } catch (error) {
      debug("❌ Failed to parse fallback API response:", text);
      return { success: false, error: "Invalid API response" };
    }
  } catch (error) {
    debug("❌ Fallback API call failed:", error);
    if (error && error.name === "AbortError") {
      throw createRequestError("timeout", {
        status: 408,
        message: error.message,
      });
    }
    throw error instanceof Error
      ? error
      : new Error("Network error contacting proxy");
  }
}

/**
 * Fetch database schema from the proxy
 * @param {string} databaseId - Database ID to fetch schema for
 * @returns {Promise<Object>} Database schema
 */
export async function fetchDatabaseSchema(databaseId) {
  debug(`📊 Fetching database schema for: ${databaseId}`);
  try {
    const result = await apiCall("GET", `/api/databases/${databaseId}`);
    // If the proxy returned a clear error message, propagate it so callers
    // can show a meaningful message instead of a generic 'Invalid' error.
    if (result && result.error) {
      debug(
        `❌ Proxy returned error fetching database schema: ${result.error}`
      );
      throw new Error(result.error);
    }
    // Accept multiple response shapes from the proxy:
    // 1) { database: { properties: {...} } }
    // 2) { success: true, data: { properties: {...} } }
    // 3) { success: true, properties: {...} }
    if (result && result.database) {
      debug(
        `✅ Database schema retrieved:`,
        result.database.properties
          ? Object.keys(result.database.properties)
          : "No properties"
      );
      return result.database;
    }

    if (result && result.success && result.data) {
      const db = result.data;
      const normalized = {
        id: db.id || databaseId,
        title: db.title || null,
        properties: db.properties || db.schema || {},
      };
      debug(
        `✅ Database schema retrieved (canonical):`,
        normalized.properties
          ? Object.keys(normalized.properties)
          : "No properties"
      );
      return normalized;
    }

    if (result && result.success && (result.properties || result.schema)) {
      const properties = result.properties || result.schema || {};
      const normalized = {
        id: result.id || databaseId,
        title: result.title || null,
        properties: properties,
      };
      debug(
        `✅ Database schema retrieved (normalized):`,
        properties ? Object.keys(properties) : "No properties"
      );
      return normalized;
    }

    throw new Error("Invalid database schema response");
  } catch (error) {
    debug(`❌ Failed to fetch database schema:`, error);
    throw error;
  }
}

/**
 * Fetch list of available databases
 * @param {Object} options - Query options
 * @returns {Promise<Array>} List of databases
 */
export async function fetchDatabases(options = {}) {
  debug("📊 Fetching available databases");
  try {
    const allDatabases = [];
    let startCursor = null;
    let hasMore = true;

    // Set default limit to maximum (100) if not specified
    const limit = options.limit || 100;

    while (hasMore) {
      const queryParams = new URLSearchParams();
      if (options.search) queryParams.set("search", options.search);
      queryParams.set("limit", limit.toString());
      if (startCursor) queryParams.set("start_cursor", startCursor);

      const endpoint = `/api/databases${
        queryParams.toString() ? "?" + queryParams.toString() : ""
      }`;
      const result = await apiCall("GET", endpoint);

      if (result && result.success && result.data) {
        const databases = result.data.results || [];
        allDatabases.push(...databases);

        hasMore = result.data.has_more || false;
        startCursor = result.data.next_cursor || null;

        debug(
          `📄 Fetched page with ${databases.length} databases, total: ${allDatabases.length}, has_more: ${hasMore}`
        );
      } else {
        hasMore = false;
      }
    }

    debug(`✅ Found ${allDatabases.length} databases total`);
    return allDatabases;
  } catch (error) {
    debug("❌ Failed to fetch databases:", error);
    throw error;
  }
}

/**
 * Query a Notion database via the proxy
 * @param {string} databaseId - Database identifier
 * @param {Object} body - Query payload (Notion database query structure)
 * @returns {Promise<Object>} Query response
 */
export async function queryDatabase(databaseId, body = {}) {
  if (!databaseId) {
    throw new Error("Database ID is required for query");
  }

  try {
    const endpoint = `/api/databases/${databaseId}/query`;
    const result = await apiCall("POST", endpoint, body);

    if (result && result.success) {
      return result;
    }

    const errorMessage =
      (result && (result.error || result.message)) ||
      "Failed to query database";
    throw new Error(errorMessage);
  } catch (error) {
    debug("❌ Database query failed:", error);
    throw error;
  }
}

/**
 * Create a new page in Notion via proxy
 * @param {Object} pageData - Page data to create
 * @returns {Promise<Object>} Created page result
 */
export async function createNotionPage(pageData) {
  debug("📝 Creating Notion page via proxy");
  try {
    const result = await apiCall("POST", "/api/pages", pageData);

    if (result && result.success) {
      debug("✅ Notion page created successfully:", result.pageId);
      return result;
    }

    throw new Error(result?.error || "Failed to create page");
  } catch (error) {
    debug("❌ Failed to create Notion page:", error);
    throw error;
  }
}

/**
 * Search for Unsplash images via proxy
 * @param {string} query - Search query
 * @param {Object} options - Search options
 * @returns {Promise<Object>} Unsplash search results
 */
export async function searchUnsplashImages(query, options = {}) {
  debug(`🔍 Searching Unsplash for: "${query}"`);
  try {
    const queryParams = new URLSearchParams({ query });
    if (options.page) queryParams.set("page", options.page.toString());
    if (options.per_page)
      queryParams.set("per_page", options.per_page.toString());

    const result = await apiCall(
      "GET",
      `/api/unsplash/search?${queryParams.toString()}`
    );

    if (result && result.success) {
      const photos = result.photos || result.images || [];
      debug(`✅ Found ${photos.length} Unsplash images`);
      return {
        success: true,
        photos: photos,
        total: result.total || photos.length,
      };
    }

    return { success: false, photos: [], error: result?.error };
  } catch (error) {
    debug("❌ Failed to search Unsplash:", error);
    throw error;
  }
}

/**
 * Get default Unsplash images via proxy
 * @returns {Promise<Object>} Default images result
 */
export async function getDefaultUnsplashImages() {
  debug("🖼️ Fetching default Unsplash images");
  try {
    const result = await apiCall("GET", "/api/unsplash/defaults");

    if (result && result.success) {
      const photos = result.photos || result.images || [];
      debug(`✅ Retrieved ${photos.length} default images`);
      return {
        success: true,
        photos: photos,
      };
    }

    return { success: false, photos: [] };
  } catch (error) {
    debug("❌ Failed to fetch default images:", error);
    return { success: false, photos: [] };
  }
}

/**
 * Upload file to proxy server
 * @param {string} type - Upload type ('icon' or 'cover')
 * @param {File|Blob} file - File to upload
 * @returns {Promise<Object>} Upload result
 */
export async function uploadFile(type, file) {
  debug(`📁 Uploading ${type} file:`, file.name);

  return new Promise((resolve, reject) => {
    const config = getConfig();
    const url = `${config.proxyUrl}/api/upload/${type}`;

    const formData = new FormData();
    formData.append(type, file);

    if (typeof GM_xmlhttpRequest === "undefined") {
      // Fallback to fetch
      fetch(url, {
        method: "POST",
        body: formData,
      })
        .then((response) => response.json())
        .then(resolve)
        .catch(reject);
      return;
    }

    // Use GM_xmlhttpRequest for file upload
    GM_xmlhttpRequest({
      method: "POST",
      url: url,
      data: formData,
      onload: function (response) {
        try {
          const result = JSON.parse(response.responseText);
          if (result.success) {
            debug(`✅ ${type} uploaded successfully:`, result.url);
          } else {
            debug(`❌ ${type} upload failed:`, result.error);
          }
          resolve(result);
        } catch (e) {
          debug(`❌ Failed to parse upload response:`, response.responseText);
          reject(new Error("Invalid upload response"));
        }
      },
      onerror: function (error) {
        debug(`❌ ${type} upload failed:`, error);
        reject(new Error(`Upload failed: ${error.error || "Network error"}`));
      },
    });
  });
}

/**
 * Check proxy server health and availability
 * @returns {Promise<Object>} Health check result
 */
export async function checkProxyHealth() {
  debug("🏥 Checking proxy server health");
  try {
    const result = await apiCall("GET", "/health");

    // Support both legacy shape: { status: 'ok', ... }
    // and canonical proxy shape: { success: true, data: { status: 'ok', ... } }
    if (result) {
      if (result.status === "ok") {
        debug("✅ Proxy server is healthy (legacy shape)");
        return { healthy: true, ...result };
      }
      if (result.success && result.data && result.data.status === "ok") {
        debug("✅ Proxy server is healthy (canonical shape)");
        return { healthy: true, ...result.data, _meta: result.meta || {} };
      }
    }

    return { healthy: false, error: "Invalid health response" };
  } catch (error) {
    debug("❌ Proxy health check failed:", error);
    return { healthy: false, error: error.message };
  }
}

/**
 * Get proxy server status and configuration
 * @returns {Promise<Object>} Status information
 */
export async function getProxyStatus() {
  debug("📊 Getting proxy server status");
  try {
    const result = await apiCall("GET", "/api/status");

    // Accept both legacy and canonical shapes
    if (result) {
      if (result.success && result.data) return result.data;
      return result;
    }

    return { error: "No status response" };
  } catch (error) {
    debug("❌ Failed to get proxy status:", error);
    return { error: error.message };
  }
}

/**
 * Test proxy connection with a simple ping
 * @returns {Promise<boolean>} Whether proxy is reachable
 */
export async function pingProxy() {
  debug("🏓 Pinging proxy server");
  try {
    const result = await apiCall("GET", "/ping");
    // Accept legacy: { pong: true } or { status: 'ok' }
    // and canonical: { success: true, data: { pong: true } }
    let isReachable = false;
    if (result) {
      if (result.pong || result.status === "ok") isReachable = true;
      if (
        result.success &&
        result.data &&
        (result.data.pong || result.data.status === "ok")
      )
        isReachable = true;
    }
    if (isReachable) debug("✅ Proxy ping successful");
    else debug("❌ Proxy ping failed");
    return isReachable;
  } catch (error) {
    debug("❌ Proxy ping error:", error);
    return false;
  }
}

/**
 * Send processed content to proxy for final Notion upload
 * @param {Object} processedData - Processed content data
 * @returns {Promise<Object>} Upload result
 */
export async function sendProcessedContentToProxy(processedData) {
  debug("📤 Sending processed content to proxy for Notion upload");
  try {
    const result = await apiCall("POST", "/api/W2N", processedData);

    debug("Raw proxy response:", JSON.stringify(result, null, 2));

    if (result && result.success) {
      let pageUrl = result.data ? result.data.pageUrl : result.pageUrl;
      const page = result.data ? result.data.page : result.page;
      debug("Extracted pageUrl:", pageUrl);
      debug("Extracted page:", page);

      if (!pageUrl && page && page.id) {
        pageUrl = `https://www.notion.so/${page.id.replace(/-/g, "")}`;
        debug("Constructed pageUrl from page.id:", pageUrl);
      }
      if (!pageUrl) {
        debug(
          "❌ No page URL or page ID returned from proxy - page creation may have failed"
        );
        throw new Error("Page creation failed - no page URL returned");
      }
      debug("✅ Content uploaded to Notion successfully:", pageUrl);
      return result;
    }

    throw new Error(result?.error || "Failed to upload content");
  } catch (error) {
    debug("❌ Failed to send content to proxy:", error);
    throw error;
  }
}
