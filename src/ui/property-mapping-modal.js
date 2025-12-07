// Property Mapping Modal - Dynamic property mapping system

import { debug, getConfig } from "../config.js";
import { getDatabase, refreshDatabase } from "../api/database-api.js";

/**
 * Inject the property mapping modal into the DOM
 */
export function injectPropertyMappingModal() {
  if (document.getElementById("w2n-property-mapping-modal")) return;

  const modal = document.createElement("div");
  modal.id = "w2n-property-mapping-modal";
  modal.style.cssText = `
    position: fixed; inset: 0; display:flex; align-items:center; justify-content:center; z-index:11000;
    background: rgba(0,0,0,0.4);
  `;

  modal.innerHTML = `
    <div style="width:600px; max-width:95%; background:white; border-radius:8px; box-shadow:0 10px 30px rgba(0,0,0,0.2); overflow:hidden;">
      <div style="padding:16px 20px; border-bottom:1px solid #eee; display:flex; justify-content:space-between; align-items:center;">
        <strong>🔗 Property Mapping</strong>
        <div style="display:flex; align-items:center; gap:10px;">
          <button id="w2n-refresh-property-mapping" title="Refresh database schema" style="background:#3b82f6;color:white;border:none;border-radius:4px;padding:4px 8px;font-size:12px;cursor:pointer;">
            🔄 Refresh
          </button>
          <button id="w2n-close-property-mapping" style="background:none;border:none;font-size:18px;cursor:pointer">×</button>
        </div>
      </div>
      <div style="padding:20px;">
        <div style="margin-bottom:16px; font-size:14px; color:#6b7280;">
          Map content from this page to database properties in: <strong id="w2n-mapping-db-name">Selected Database</strong>
        </div>
        
        <div id="w2n-property-mappings" style="margin-bottom:20px; max-height:300px; overflow-y:auto;">
          <!-- Property mappings will be populated here -->
        </div>
        
        <div style="display:flex; gap:10px; padding-top:16px; border-top:1px solid #eee;">
          <button id="w2n-save-property-mapping" style="flex:1;padding:10px;border-radius:6px;background:#10b981;color:white;border:none;cursor:pointer;font-size:14px;">
            Save Mapping
          </button>
          <button id="w2n-reset-property-mapping" style="padding:10px 16px;border-radius:6px;background:#ef4444;color:white;border:none;cursor:pointer;font-size:14px;">
            Reset
          </button>
          <button id="w2n-cancel-property-mapping" style="flex:1;padding:10px;border-radius:6px;background:#6b7280;color:white;border:none;cursor:pointer;font-size:14px;">
            Cancel
          </button>
        </div>
      </div>
    </div>
  `;

  document.body.appendChild(modal);
  setupPropertyMappingModal(modal);
}

/**
 * Setup the property mapping modal with event listeners and functionality
 * @param {HTMLElement} modal - The modal element
 */
export function setupPropertyMappingModal(modal) {
  if (!modal) return;
  if (modal.dataset && modal.dataset.w2nInit) return; // already initialized

  const closeBtn = modal.querySelector("#w2n-close-property-mapping");
  const saveBtn = modal.querySelector("#w2n-save-property-mapping");
  const resetBtn = modal.querySelector("#w2n-reset-property-mapping");
  const cancelBtn = modal.querySelector("#w2n-cancel-property-mapping");
  const refreshBtn = modal.querySelector("#w2n-refresh-property-mapping");
  const mappingsContainer = modal.querySelector("#w2n-property-mappings");
  const dbNameEl = modal.querySelector("#w2n-mapping-db-name");

  let currentDatabaseSchema = null;
  let currentMappings = {};

  function closeModal() {
    if (modal.parentNode) {
      modal.parentNode.removeChild(modal);
    }
  }

  closeBtn.onclick = closeModal;
  cancelBtn.onclick = closeModal;

  // Click outside to close
  modal.onclick = (e) => {
    if (e.target === modal) closeModal();
  };

  saveBtn.addEventListener("click", async () => {
    try {
      const config = getConfig();
      const databaseId = config.databaseId;
      if (!databaseId) {
        alert("No database selected. Please select a database first.");
        return;
      }

      // Collect current mappings from the form
      // Note: We store as notionProperty -> contentKey (reversed from UI)
      // so applyPropertyMappings can use it as {NotionProp: "content.field"}
      const mappings = {};
      const selects = mappingsContainer.querySelectorAll("select");
      selects.forEach((select) => {
        const contentKey = select.dataset.contentKey;
        const selectedNotionProperty = select.value;
        if (selectedNotionProperty && selectedNotionProperty !== "") {
          // Store reversed: Notion property name -> content key
          mappings[selectedNotionProperty] = contentKey;
        }
      });

      savePropertyMappings(databaseId, mappings);
      alert("Property mappings saved successfully!");
      closeModal();
    } catch (error) {
      debug("Error saving property mappings:", error);
      alert("Error saving property mappings. Check console for details.");
    }
  });

  // mark as initialized to avoid duplicate bindings
  try {
    modal.dataset = modal.dataset || {};
    modal.dataset.w2nInit = "1";
  } catch (e) {}

  resetBtn.addEventListener("click", () => {
    if (
      confirm(
        "Are you sure you want to reset all property mappings to default?"
      )
    ) {
      const config = getConfig();
      const databaseId = config.databaseId;
      if (databaseId) {
        resetPropertyMappings(databaseId);
        // Reload the properties to reflect the reset
        showPropertyMappingModal();
      }
    }
  });

  refreshBtn.addEventListener("click", async () => {
    const config = getConfig();
    if (config.databaseId) {
      debug("🔄 Refreshing database schema...");
      await loadDatabaseMappings(config.databaseId, config.databaseName, true);
    } else {
      alert("No database selected. Please select a database first.");
    }
  });

  // Load database schema and populate mappings
  async function loadDatabaseMappings(
    databaseId,
    databaseName,
    forceRefresh = false
  ) {
    try {
      dbNameEl.textContent = databaseName || "Loading...";
      mappingsContainer.innerHTML =
        '<div style="text-align:center;padding:20px;color:#6b7280;">Loading database schema...</div>';

      // Fetch database schema from API module (force refresh if requested)
      if (forceRefresh) {
        debug("🔄 Force refreshing database schema");
        currentDatabaseSchema = await refreshDatabase(databaseId);
      } else {
        currentDatabaseSchema = await getDatabase(databaseId);
      }

      // Load existing mappings for this database
      const existingMappings = loadPropertyMappings(databaseId);
      currentMappings = { ...existingMappings };

      // Populate UI
      populatePropertyMappings(
        currentDatabaseSchema.properties,
        currentMappings
      );
      dbNameEl.textContent =
        databaseName ||
        currentDatabaseSchema.title?.[0]?.text?.content ||
        "Unknown Database";

      if (forceRefresh) {
        debug("✅ Database schema refreshed");
      }
    } catch (error) {
      debug("❌ Failed to load database schema:", error);
      mappingsContainer.innerHTML =
        '<div style="text-align:center;padding:20px;color:#ef4444;">Failed to load database schema. Please try again.</div>';
    }
  }

  // Expose loadDatabaseMappings function on modal for external calls
  modal.loadDatabaseMappings = loadDatabaseMappings;

  // Auto-load current database if available
  const config = getConfig();
  if (config.databaseId) {
    loadDatabaseMappings(
      config.databaseId,
      config.databaseName || "Selected Database"
    );
  }

  // Make modal accessible via global scope for debugging
  if (typeof unsafeWindow !== "undefined") {
    unsafeWindow.propertyMappingModal = modal;
  }
}

/**
 * Populate the property mappings UI with available properties
 * @param {Object} properties - Database properties
 * @param {Object} mappings - Current mappings
 */
export function populatePropertyMappings(properties, mappings) {
  debug("Populating property mappings with properties:", properties);
  const contentProperties = [
    {
      key: "title",
      label: "Page Title",
      description: "The main title of the captured page",
    },
    {
      key: "category",
      label: "Category",
      description: "ServiceNow category or classification",
    },
    {
      key: "section",
      label: "Section",
      description: "ServiceNow documentation section from breadcrumb path",
    },
    {
      key: "version",
      label: "Version",
      description: "Version information",
    },
    {
      key: "updated",
      label: "Updated Date",
      description: "Last updated date",
    },
    {
      key: "breadcrumb",
      label: "Breadcrumb",
      description: "Navigation breadcrumb or content hierarchy path",
    },
    {
      key: "hasVideos",
      label: "Has Videos",
      description:
        "Automatically detected - indicates if the page contains video content",
    },
    {
      key: "hasFigureImage",
      label: "Has Images",
      description:
        "Automatically detected - indicates if the page contains images or figures",
    },
  ];

  const propertyOptions = Object.entries(properties)
    .map(([key, prop]) => {
      const type = prop.type || "unknown";
      const typeLabel = type.charAt(0).toUpperCase() + type.slice(1);
      return `<option value="${key}">[${typeLabel}] ${
        prop.name || key
      }</option>`;
    })
    .join("");

  const mappingsHtml = contentProperties
    .map((content) => {
      const currentMapping = mappings[content.key] || "";
      return `
      <div style="margin-bottom:12px; padding:12px; border:1px solid #e5e7eb; border-radius:6px;">
        <div style="display:flex; align-items:center; gap:12px;">
          <div style="flex:1; min-width:160px;">
            <strong style="font-size:13px;">${content.label}</strong>
            <div style="font-size:11px; color:#6b7280; margin-top:2px;">${content.description}</div>
          </div>
          <div style="flex:1; min-width:200px;">
            <select data-content-key="${content.key}" style="width:100%; padding:6px; border:1px solid #d1d5db; border-radius:4px; font-size:12px;">
              <option value="">-- No mapping --</option>
              ${propertyOptions}
            </select>
          </div>
        </div>
      </div>
    `;
    })
    .join("");

  const mappingsContainer = document.querySelector("#w2n-property-mappings");
  if (mappingsContainer) {
    mappingsContainer.innerHTML = mappingsHtml;

    // Set current mappings
    // mappings is stored as {NotionProperty: "contentKey"}, we need to reverse it for display
    Object.entries(mappings).forEach(([notionProperty, contentKey]) => {
      const select = mappingsContainer.querySelector(
        `select[data-content-key="${contentKey}"]`
      );
      if (select) {
        select.value = notionProperty;
      }
    });
  }
}

/**
 * Property mapping storage functions
 */
export function savePropertyMappings(databaseId, mappings) {
  const key = `w2n_property_mappings_${databaseId}`;
  if (typeof GM_setValue !== "undefined") {
    GM_setValue(key, JSON.stringify(mappings));
  }
  debug(`Property mappings saved for database ${databaseId}:`, mappings);
}

export function loadPropertyMappings(databaseId) {
  const key = `w2n_property_mappings_${databaseId}`;
  if (typeof GM_getValue === "undefined") {
    return {};
  }

  const stored = GM_getValue(key, "{}");
  try {
    return JSON.parse(stored);
  } catch (error) {
    debug("Error loading property mappings:", error);
    return {};
  }
}

export function resetPropertyMappings(databaseId) {
  const key = `w2n_property_mappings_${databaseId}`;
  if (typeof GM_setValue !== "undefined") {
    GM_setValue(key, "{}");
  }
  debug(`Property mappings reset for database ${databaseId}`);
}

/**
 * Generate default property mappings based on common ServiceNow fields
 * Maps common content types to Notion properties that might exist
 * @param {Object} schema - Database schema with property definitions
 * @returns {Object} Default property mappings
 */
export function generateDefaultPropertyMappings(schema) {
  const defaultMappings = {};
  
  if (!schema || typeof schema !== 'object') {
    debug('⚠️ No schema provided for default mapping generation');
    return defaultMappings;
  }

  // Map extracted content field names to possible Notion property names
  // Format: contentField -> [possible Notion property names]
  // Note: Page URL, Content Source, and CurrentReleaseURL are automatically handled
  // and should not be included in manual property mappings
  const contentFieldMappings = {
    // Extracted field name -> Possible Notion property names (case-sensitive)
    'title': ['Title', 'Name', 'Page Title'],
    'category': ['Category', 'Type', 'Topic', 'Classification'],
    'version': ['Version', 'Release', 'Build', 'Version Number'],
    'updated': ['Updated', 'Last Updated', 'Modified Date', 'Date Modified', 'Updated Date'],
    'status': ['Status', 'State', 'Page Status', 'Workflow Status'],
    'author': ['Author', 'Created By', 'Owner', 'Author Name'],
    'breadcrumb': ['Breadcrumb', 'Navigation', 'Path', 'Hierarchy'],
    'section': ['Section', 'Topic', 'Area'],
    'hasVideos': ['Has Videos', 'Video', 'Videos', 'Contains Videos'],
    'hasImages': ['Has Images', 'Image', 'Images', 'Contains Images'],
  };

  // Scan database schema for properties matching extracted content fields
  for (const [contentField, possibleNotionNames] of Object.entries(contentFieldMappings)) {
    // Check if any of the possible Notion property names exist in the schema
    for (const notionPropName of possibleNotionNames) {
      if (schema.hasOwnProperty(notionPropName)) {
        // Found a match - add to default mappings
        // Format: Notion property name -> content field name
        defaultMappings[notionPropName] = contentField;
        debug(`✅ Auto-mapped: Notion property "${notionPropName}" -> content field "${contentField}"`);
        break; // Move to next content field
      }
    }
  }

  return defaultMappings;
}

export function showPropertyMappingModal() {
  debug("🔗 Opening property mapping modal");
  injectPropertyMappingModal();
  const modal = document.getElementById("w2n-property-mapping-modal");
  const config = getConfig();
  if (modal && modal.loadDatabaseMappings) {
    modal.loadDatabaseMappings(config.databaseId, config.databaseName);
  }
}
