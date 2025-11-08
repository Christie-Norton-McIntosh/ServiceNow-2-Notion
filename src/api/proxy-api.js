// Proxy API Communication - Direct communication with M2N proxy server

import { debug, getConfig } from "../config.js";
import { normalizeUrl, isValidImageUrl } from "../utils/url-utils.js";
import { hyphenateNotionId, findProperty } from "../utils/notion-utils.js";

/**
 * Make an API call to the proxy server
 * @param {string} method - HTTP method (GET, POST, etc.)
 * @param {string} endpoint - API e    if (result && result.success) {
      debug("Upload result:", result);
      let pageUrl = result.data ? result.data.pageUrl : result.pageUrl;
      const page = result.data ? result.data.page : result.page;
      if (!pageUrl && page && page.id) {
        pageUrl = `https://www.notion.so/${page.id.replace(/-/g, '')}`;
      }
      if (!pageUrl) {
        debug("❌ No page URL or page ID returned from proxy - page creation may have failed");
        throw new Error("Page creation failed - no page URL returned");
      }
      debug("✅ Content uploaded to Notion successfully:", pageUrl);
      return result;
    }path
 * @param {Object} data - Request data for POST/PUT requests
 * @returns {Promise<Object>} API response
 */
export async function apiCall(method, endpoint, data = null) {
  return new Promise((resolve, reject) => {
    const config = getConfig();
    const url = config.proxyUrl + endpoint;

    // DEBUG: Log data size before stringification
    if (data && (data.content || data.contentHtml)) {
      const html = data.content || data.contentHtml;
      console.log('🔍 apiCall - HTML length before stringify:', html.length);
      const sectionCount = (html.match(/<section[^>]*id="predictive-intelligence-for-incident__section_/g) || []).length;
      console.log('🔍 apiCall - Sections before stringify:', sectionCount);
    }

    if (typeof GM_xmlhttpRequest === "undefined") {
      // Fallback to fetch if GM_xmlhttpRequest is not available
      fallbackFetchCall(method, url, data).then(resolve).catch(reject);
      return;
    }

    const stringifiedData = data ? JSON.stringify(data) : undefined;
    
    // DEBUG: Log stringified data size
    if (stringifiedData && data && (data.content || data.contentHtml)) {
      console.log('🔍 apiCall - Stringified data length:', stringifiedData.length);
      // Check if sections are still in stringified data
      const sectionCountAfter = (stringifiedData.match(/predictive-intelligence-for-incident__section_/g) || []).length;
      console.log('🔍 apiCall - Sections in stringified data:', sectionCountAfter);
    }

    GM_xmlhttpRequest({
      method: method,
      url: url,
      headers: {
        "Content-Type": "application/json",
      },
      data: stringifiedData,
      timeout: 300000, // 5 minute timeout for large content with images
      onload: function (response) {
        try {
          // Check HTTP status
          if (response.status >= 200 && response.status < 300) {
            const result = JSON.parse(response.responseText);
            resolve(result);
          } else {
            debug(`❌ API call returned HTTP ${response.status}:`, response.responseText?.substring(0, 500));
            resolve({ success: false, error: `HTTP ${response.status}: ${response.statusText || 'Request failed'}` });
          }
        } catch (e) {
          debug("❌ Failed to parse API response:", response.responseText?.substring(0, 500));
          resolve({ success: false, error: "Invalid API response" });
        }
      },
      onerror: function (error) {
        debug("❌ API call onerror triggered:", error);
        const errorMsg = error?.error || error?.message || JSON.stringify(error) || "Network error";
        reject(new Error(`API call failed: ${errorMsg}`));
      },
      ontimeout: function () {
        debug("❌ API call timed out after 5 minutes");
        reject(new Error("API call failed: Request timed out after 5 minutes. The page may be too large or contain many images that need to be downloaded and uploaded."));
      },
    });
  });
}

/**
 * Fallback API call using fetch when GM_xmlhttpRequest is not available
 * @param {string} method - HTTP method
 * @param {string} url - Full URL
 * @param {Object} data - Request data
 * @returns {Promise<Object>} API response
 */
async function fallbackFetchCall(method, url, data = null) {
  try {
    const options = {
      method: method,
      headers: {
        "Content-Type": "application/json",
      },
    };

    if (data) {
      options.body = JSON.stringify(data);
    }

    const response = await fetch(url, options);

    if (!response.ok) {
      throw new Error(`HTTP error! status: ${response.status}`);
    }

    const result = await response.json();
    return result;
  } catch (error) {
    debug("❌ Fallback API call failed:", error);
    throw error;
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
    const result = await apiCall("GET", "/api/health");

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
    const result = await apiCall("GET", "/api/ping");
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
  
  // DEBUG: Check if all articles are in the HTML being sent
  if (processedData.contentHtml || processedData.content) {
    const html = processedData.contentHtml || processedData.content;
    console.log('📊 PROXY-API.JS - Total HTML length:', html.length);
    const sectionCount = (html.match(/<section[^>]*id="predictive-intelligence-for-incident__section_/g) || []).length;
    console.log('📊 PROXY-API.JS - Sections in HTML:', sectionCount);
    const nested1Count = (html.match(/class="topic task nested1"/g) || []).length;
    console.log('📊 PROXY-API.JS - Number of article.nested1 in HTML:', nested1Count);
    const nested0Count = (html.match(/class="[^"]*nested0[^"]*"/g) || []).length;
    console.log('📊 PROXY-API.JS - Number of article.nested0 in HTML:', nested0Count);
  }
  
  // Import overlay module for status updates
  const { overlayModule } = await import("../ui/overlay-progress.js");
  
  try {
    overlayModule.setMessage("Converting HTML to Notion blocks...");
    
    // DEBUG: Log right before API call
    console.log('🚀 PROXY-API.JS - About to call apiCall with processedData');
    console.log('🚀 PROXY-API.JS - processedData.content length:', processedData.content?.length);
    console.log('🚀 PROXY-API.JS - processedData.contentHtml length:', processedData.contentHtml?.length);
    
    const result = await apiCall("POST", "/api/W2N", processedData);

    debug("Raw proxy response:", JSON.stringify(result, null, 2));

    if (result && result.success) {
      // Show completion message
      overlayModule.setMessage("✓ Page created and nested content organized!");
      
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