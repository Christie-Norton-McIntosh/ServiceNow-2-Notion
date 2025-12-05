// Database API - Notion database operations and property mapping

import { debug, getConfig } from "../config.js";
import { fetchDatabaseSchema, fetchDatabases } from "./proxy-api.js";

/**
 * Fetch database from cache or API
 * @param {string} databaseId - The database ID to fetch
 * @returns {Promise<Object>} Database object
 */
export async function getDatabase(databaseId) {
  if (!databaseId) {
    throw new Error("Database ID is required");
  }

  debug(`🔍 Getting database: ${databaseId}`);

  // Check cache first
  const cached = await getCachedDatabase(databaseId);
  if (cached) {
    debug("✅ Using cached database schema");
    debug(
      "📋 Cached properties:",
      cached.properties ? Object.keys(cached.properties) : "No properties"
    );
    return cached;
  }

  // Fetch from API
  try {
    const database = await fetchDatabaseSchema(databaseId);

    // Cache the result
    await cacheDatabase(databaseId, database);

    return database;
  } catch (error) {
    debug("❌ Failed to get database:", error);
    throw error;
  }
}

/**
 * Get cached database from storage
 * @param {string} databaseId - Database ID
 * @returns {Promise<Object|null>} Cached database or null
 */
async function getCachedDatabase(databaseId) {
  return new Promise((resolve) => {
    const cacheKey = `database_${databaseId}`;

    if (typeof GM_getValue === "function") {
      try {
        const cached = GM_getValue(cacheKey, null);
        if (cached) {
          const data = JSON.parse(cached);
          // Check if cache is not older than 1 hour
          if (Date.now() - data.timestamp < 3600000) {
            resolve(data.database);
            return;
          }
        }
      } catch (e) {
        debug("❌ Failed to parse cached database:", e);
      }
    }

    resolve(null);
  });
}

/**
 * Cache database to storage
 * @param {string} databaseId - Database ID
 * @param {Object} database - Database object to cache
 */
async function cacheDatabase(databaseId, database) {
  if (typeof GM_setValue === "function") {
    try {
      const cacheKey = `database_${databaseId}`;
      const cacheData = {
        database: database,
        timestamp: Date.now(),
      };
      GM_setValue(cacheKey, JSON.stringify(cacheData));
      debug("✅ Database cached successfully");
    } catch (e) {
      debug("❌ Failed to cache database:", e);
    }
  }
}

/**
 * Clear cached database schema
 * @param {string} databaseId - Database ID
 */
export function clearDatabaseCache(databaseId) {
  if (typeof GM_setValue === "function" && databaseId) {
    try {
      const cacheKey = `database_${databaseId}`;
      GM_setValue(cacheKey, null);
      debug(`🗑️ Cleared database cache for: ${databaseId}`);
    } catch (e) {
      debug("❌ Failed to clear database cache:", e);
    }
  }
}

/**
 * Force refresh database schema (bypass cache)
 * @param {string} databaseId - Database ID
 * @returns {Promise<Object>} Fresh database object
 */
export async function refreshDatabase(databaseId) {
  if (!databaseId) {
    throw new Error("Database ID is required");
  }

  debug(`🔄 Force refreshing database: ${databaseId}`);

  // Clear cache first
  clearDatabaseCache(databaseId);

  // Fetch fresh from API
  try {
    const database = await fetchDatabaseSchema(databaseId);

    // Cache the fresh result
    await cacheDatabase(databaseId, database);

    debug("✅ Database schema refreshed successfully");
    return database;
  } catch (error) {
    debug("❌ Failed to refresh database:", error);
    throw error;
  }
}

/**
 * Get all available databases with caching
 * @param {Object} options - Query options
 * @returns {Promise<Array>} Array of databases
 */
export async function getAllDatabases(options = {}) {
  debug("📊 Getting all databases");

  try {
    const databases = await fetchDatabases(options);

    // Filter out databases without required permissions
    const accessibleDatabases = databases.filter((db) => {
      return db && db.id && db.title && db.title.length > 0;
    });

    debug(`✅ Retrieved ${accessibleDatabases.length} accessible databases`);
    return accessibleDatabases;
  } catch (error) {
    debug("❌ Failed to get databases:", error);
    return [];
  }
}

/**
 * Get property mappings for a database
 * @param {string} databaseId - Database ID
 * @returns {Promise<Object>} Property mappings
 */
export async function getPropertyMappings(databaseId) {
  const mappingKey = `w2n_property_mappings_${databaseId}`;

  return new Promise((resolve) => {
    if (typeof GM_getValue === "function") {
      try {
        const saved = GM_getValue(mappingKey, "{}");
        debug(`🔍 Loading mappings with key: ${mappingKey}`);
        debug(`🔍 Raw saved value: ${saved}`);
        const mappings = JSON.parse(saved);
        debug(
          `✅ Retrieved property mappings (${
            Object.keys(mappings).length
          } mappings):`,
          mappings
        );
        resolve(mappings);
      } catch (e) {
        debug("❌ Failed to parse property mappings:", e);
        resolve({});
      }
    } else {
      debug("⚠️ GM_getValue not available");
      resolve({});
    }
  });
}

/**
 * Save property mappings for a database
 * @param {string} databaseId - Database ID
 * @param {Object} mappings - Property mappings to save
 */
export async function savePropertyMappings(databaseId, mappings) {
  const mappingKey = `w2n_property_mappings_${databaseId}`;

  return new Promise((resolve, reject) => {
    if (typeof GM_setValue === "function") {
      try {
        const jsonStr = JSON.stringify(mappings);
        debug(`💾 Saving mappings with key: ${mappingKey}`);
        debug(
          `💾 Mappings to save (${Object.keys(mappings).length} mappings):`,
          mappings
        );
        GM_setValue(mappingKey, jsonStr);
        debug("✅ Property mappings saved successfully");
        resolve();
      } catch (e) {
        debug("❌ Failed to save property mappings:", e);
        reject(e);
      }
    } else {
      debug("⚠️ GM_setValue not available, mappings not saved");
      resolve();
    }
  });
}

/**
 * Apply property mappings to extracted data
 * @param {Object} extractedData - Data extracted from the page
 * @param {Object} database - Database schema
 * @param {Object} mappings - Property mappings
 * @returns {Object} Mapped properties for Notion page
 */
export function applyPropertyMappings(extractedData, database, mappings) {
  debug("🔧 Applying property mappings");

  const properties = {};
  const dbProperties = database.properties || {};

  // Apply user-configured mappings
  Object.entries(mappings).forEach(([notionProperty, sourceField]) => {
    if (!sourceField || !dbProperties[notionProperty]) return;

    const propConfig = dbProperties[notionProperty];
    const sourceValue = getNestedValue(extractedData, sourceField);

    if (
      sourceValue !== undefined &&
      sourceValue !== null &&
      sourceValue !== ""
    ) {
      const mappedValue = mapValueToNotionProperty(sourceValue, propConfig);
      if (mappedValue !== null) {
        properties[notionProperty] = mappedValue;
      }
    }
  });

  // Auto-map hardcoded properties (Page URL, Content Source, Current Release URL)
  // These are automatically extracted and should always be included if the properties exist
  const autoMappings = {
    'Page URL': window.location.href,
    'Content Source': 'ServiceNow Technical Documentation',
    'Current Release URL': extractedData.CurrentReleaseURL || window.location.href,
  };

  Object.entries(autoMappings).forEach(([notionProperty, value]) => {
    if (dbProperties[notionProperty] && value) {
      const propConfig = dbProperties[notionProperty];
      const mappedValue = mapValueToNotionProperty(value, propConfig);
      if (mappedValue !== null) {
        properties[notionProperty] = mappedValue;
        debug(`✅ Auto-mapped: "${notionProperty}" = "${value}"`);
      }
    }
  });

  debug(`✅ Applied ${Object.keys(properties).length} property mappings (user + auto)`);
  return properties;
}

/**
 * Get nested value from object using dot notation
 * @param {Object} obj - Object to search
 * @param {string} path - Dot-separated path
 * @returns {*} Value at path or undefined
 */
function getNestedValue(obj, path) {
  if (!path || !obj) return undefined;

  return path.split(".").reduce((current, key) => {
    return current && current[key] !== undefined ? current[key] : undefined;
  }, obj);
}

/**
 * Map a value to appropriate Notion property format
 * @param {*} value - Source value
 * @param {Object} propertyConfig - Notion property configuration
 * @returns {Object|null} Notion property value or null
 */
function mapValueToNotionProperty(value, propertyConfig) {
  if (!propertyConfig || value === undefined || value === null) {
    return null;
  }

  const type = propertyConfig.type;
  const stringValue = String(value).trim();

  if (!stringValue) return null;

  switch (type) {
    case "title":
      return {
        title: [
          {
            type: "text",
            text: { content: stringValue.slice(0, 2000) }, // Notion title limit
          },
        ],
      };

    case "rich_text":
      return {
        rich_text: [
          {
            type: "text",
            text: { content: stringValue.slice(0, 2000) },
          },
        ],
      };

    case "number":
      const num = parseFloat(stringValue);
      return isNaN(num) ? null : { number: num };

    case "select":
      const options = propertyConfig.select?.options || [];
      const matchingOption = options.find(
        (opt) => opt.name.toLowerCase() === stringValue.toLowerCase()
      );
      return matchingOption ? { select: { name: matchingOption.name } } : null;

    case "multi_select":
      const multiOptions = propertyConfig.multi_select?.options || [];
      const values = stringValue.split(",").map((v) => v.trim());
      const matchingOptions = values
        .map((v) =>
          multiOptions.find((opt) => opt.name.toLowerCase() === v.toLowerCase())
        )
        .filter(Boolean);
      return matchingOptions.length > 0
        ? {
            multi_select: matchingOptions.map((opt) => ({ name: opt.name })),
          }
        : null;

    case "date":
      try {
        const date = new Date(stringValue);
        if (isNaN(date.getTime())) return null;
        return {
          date: { start: date.toISOString().split("T")[0] },
        };
      } catch (e) {
        return null;
      }

    case "checkbox":
      const boolValue = stringValue.toLowerCase();
      return {
        checkbox:
          boolValue === "true" || boolValue === "yes" || boolValue === "1",
      };

    case "url":
      try {
        new URL(stringValue);
        return { url: stringValue };
      } catch (e) {
        return null;
      }

    case "email":
      const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
      return emailRegex.test(stringValue) ? { email: stringValue } : null;

    case "phone_number":
      return { phone_number: stringValue };

    case "people":
      // This would need user ID mapping, which is complex
      return null;

    case "relation":
      // This would need related page mapping, which is complex
      return null;

    default:
      debug(`⚠️ Unsupported property type: ${type}`);
      return null;
  }
}

/**
 * Create default property mappings based on common field names
 * @param {Object} database - Database schema
 * @param {Object} extractedData - Extracted data to map from
 * @returns {Object} Suggested property mappings
 */
export function createDefaultMappings(database, extractedData) {
  debug("🎯 Creating default property mappings");

  const mappings = {};
  const dbProperties = database.properties || {};
  const dataFields = Object.keys(extractedData);

  // Common mapping patterns
  const mappingPatterns = {
    // Title mappings
    title: ["title", "name", "subject", "heading", "pageTitle"],
    // Text content mappings
    description: ["description", "summary", "content", "body"],
    // URL mappings
    url: ["url", "link", "pageUrl", "sourceUrl"],
    // Date mappings
    created: ["created", "createdAt", "dateCreated", "timestamp"],
    updated: ["updated", "updatedAt", "dateUpdated", "lastModified"],
    // Author mappings
    author: ["author", "createdBy", "user", "assignee"],
    // Status mappings
    status: ["status", "state", "condition"],
    // Priority mappings
    priority: ["priority", "importance", "urgency"],
  };

  // Try to match database properties with extracted data
  Object.entries(dbProperties).forEach(([propName, propConfig]) => {
    const propLower = propName.toLowerCase();

    // Check if there's a direct match
    const directMatch = dataFields.find(
      (field) => field.toLowerCase() === propLower
    );

    if (directMatch) {
      mappings[propName] = directMatch;
      return;
    }

    // Check pattern matches
    for (const [pattern, candidates] of Object.entries(mappingPatterns)) {
      if (candidates.some((candidate) => propLower.includes(candidate))) {
        const match = dataFields.find((field) =>
          candidates.some((candidate) =>
            field.toLowerCase().includes(candidate)
          )
        );
        if (match) {
          mappings[propName] = match;
          break;
        }
      }
    }
  });

  debug(`✅ Created ${Object.keys(mappings).length} default mappings`);
  return mappings;
}

/**
 * Validate property mappings against database schema
 * @param {Object} mappings - Property mappings to validate
 * @param {Object} database - Database schema
 * @returns {Object} Validation result
 */
export function validatePropertyMappings(mappings, database) {
  const dbProperties = database.properties || {};
  const validation = {
    valid: true,
    errors: [],
    warnings: [],
  };

  Object.entries(mappings).forEach(([notionProperty, sourceField]) => {
    if (!dbProperties[notionProperty]) {
      validation.errors.push(
        `Property "${notionProperty}" does not exist in database`
      );
      validation.valid = false;
    }

    if (!sourceField) {
      validation.warnings.push(
        `No source field mapped for "${notionProperty}"`
      );
    }
  });

  return validation;
}
