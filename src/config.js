// Configuration constants and default settings

// =============================================================================
// PROVIDER CONSTANTS
// =============================================================================

export const PROVIDER_VERSION = "8.0.0";
export const PROVIDER_ID = "servicenow";
export const PROVIDER_NAME = "ServiceNow";

// =============================================================================
// DEFAULT BRANDING ASSETS
// =============================================================================

// Default ServiceNow branding assets
export const BRANDING = {
  primaryColor: "#0066cc",
  hoverColor: "#004499",
  dangerColor: "#dc3545",
  successColor: "#28a745",
  warningColor: "#ffc107",
};
export const DEFAULT_SERVICENOW_ICON =
  "data:image/png;base64,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";

// Cover image URL - using external URL to keep userscript size reasonable
export const DEFAULT_SERVICENOW_COVER_URL =
  "https://raw.githubusercontent.com/Christie-Norton-McIntosh/WEB-2-N0T10N/Web-2-Notion/W2N/img/ServiceNow%20Yokohama%20banner.png";

// =============================================================================
// DEFAULT CONFIGURATION
// =============================================================================

export const defaultConfig = {
  databaseId: "24ca89fe-dba5-806f-91a6-e831a6efe344",
  databaseName: "ServiceNow-2-Notion (API DB)",
  proxyUrl: "http://localhost:3004",
  useMartian: true,
  directSDKImages: true,
  debugMode: true,
  showAllDatabases: false,
  enableDuplicateDetection: true,
  enableAdvancedContent: true,
};

// =============================================================================
// CACHE SETTINGS
// =============================================================================

// cache TTL for database list (milliseconds) - default 10 minutes
export const DB_CACHE_TTL = 10 * 60 * 1000;

// =============================================================================
// CUSTOM SELECTORS
// =============================================================================

// Custom selectors assigned interactively for specific properties
export const DEFAULT_CUSTOM_SELECTORS = {
  // Version provided earlier by the user
  version:
    "#zDocsContent > header > ul > li.zDocsTopicPageCluster > div > div > button > div > div > div",
  // Updated date selector provided by the user
  updated:
    "#zDocsContent > header > ul > li.zDocsTopicPageDate.css-cinqea > span",
  // Breadcrumb selector provided by the user
  breadcrumb:
    "#zDocsTopicPage > div.zDocsTopicPageTopicContainer > div.zDocsTopicPageBreadcrumbsContainer > div",
  // Map misspelled 'Catagory' property to its selector
  Catagory:
    "#zDocsTopicPage > div.zDocsTopicPageTopicContainer > div.zDocsTopicPageBreadcrumbsContainer > div > span:nth-child(3) > a",
  // Map lowercase 'category' for metadata extraction
  category:
    "#zDocsTopicPage > div.zDocsTopicPageTopicContainer > div.zDocsTopicPageBreadcrumbsContainer > div > span:nth-child(3) > a",
  // Map 'Section' property to 4th span in breadcrumb (try anchor first, then span)
  Section:
    "#zDocsTopicPage > div.zDocsTopicPageTopicContainer > div.zDocsTopicPageBreadcrumbsContainer > div > span:nth-child(4) > a",
  // Map lowercase 'section' for metadata extraction (try anchor first, then span)
  section:
    "#zDocsTopicPage > div.zDocsTopicPageTopicContainer > div.zDocsTopicPageBreadcrumbsContainer > div > span:nth-child(4) > a",
  // Title selector (H1 in header)
  title: "#zDocsContent > header > h1",
};

// =============================================================================
// CONFIGURATION UTILITIES
// =============================================================================

/**
 * Get configuration with defaults
 * @returns {Object} Configuration object
 */
export function getConfig() {
  if (typeof GM_getValue === "undefined") {
    return defaultConfig;
  }

  let config = { ...defaultConfig, ...GM_getValue("notionConfig", {}) };

  // If the saved config explicitly cleared the databaseId or name, fall back
  // to the hardcoded defaults so the script defaults to the intended DB.
  if (!config.databaseId) {
    config.databaseId = defaultConfig.databaseId;
    config.databaseName = defaultConfig.databaseName;
  }

  return config;
}

/**
 * Get custom property selectors
 * @returns {Object} Custom selectors object
 */
export function getCustomSelectors() {
  return Object.assign(
    {},
    DEFAULT_CUSTOM_SELECTORS,
    (typeof window !== "undefined" && window.W2N_CUSTOM_SELECTORS) || {}
  );
}

/**
 * Debug logging utility
 * @param {...any} args - Arguments to log
 */
export function debug(...args) {
  const config = getConfig();
  if (config.debugMode) {
    // Use console.log through the debug helper for consistent gating
    console.log(`[${PROVIDER_NAME}]`, ...args);
  }
}

/**
 * Initialize configuration - performs migration and returns current config
 * @returns {Object} Initialized configuration object
 */
export async function initializeConfig() {
  debug("🔧 Initializing configuration...");

  // Migrate any legacy config first
  const migrated = migrateOldConfig();
  if (migrated) {
    debug("✅ Configuration migration completed");
  }

  // Get current config
  const config = getConfig();

  debug("✅ Configuration initialized:", {
    version: PROVIDER_VERSION,
    databaseId: config.databaseId ? config.databaseId.slice(-8) : "none",
    proxyUrl: config.proxyUrl,
    debugMode: config.debugMode,
  });

  return config;
}

/**
 * Migrate legacy saved config for backward compatibility
 * @returns {boolean} Whether migration was performed
 */
export function migrateOldConfig() {
  if (
    typeof GM_getValue === "undefined" ||
    typeof GM_setValue === "undefined"
  ) {
    return false;
  }

  try {
    const legacy = GM_getValue("w2n_config");
    if (!legacy) return false;

    // Legacy may have been saved as a JSON string or object
    let legacyObj = legacy;
    if (typeof legacy === "string") {
      try {
        legacyObj = JSON.parse(legacy);
      } catch (e) {
        // keep as string value under a field to avoid data loss
        legacyObj = { legacyValue: legacy };
      }
    }

    // Merge legacy into current config (without overwriting explicit defaults unless present)
    const migrated = { ...GM_getValue("notionConfig", {}), ...legacyObj };
    GM_setValue("notionConfig", migrated);
    debug("🔁 Migrated legacy w2n_config to notionConfig:", migrated);

    // Remove old key if supported by the environment
    try {
      GM_setValue("w2n_config", null);
    } catch (e) {
      // Some GM implementations don't support deleting; ignore
    }

    return true;
  } catch (error) {
    debug("Migration check failed:", error);
    return false;
  }
}
