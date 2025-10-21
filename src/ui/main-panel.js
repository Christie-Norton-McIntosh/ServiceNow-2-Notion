// Main floating panel (ported from original createUI())

import { debug, getConfig } from "../config.js";
import { showPropertyMappingModal } from "./property-mapping-modal.js";
import { injectAdvancedSettingsModal } from "./advanced-settings-modal.js";
import { injectIconCoverModal } from "./icon-cover-modal.js";
import { getAllDatabases, getDatabase } from "../api/database-api.js";
import { overlayModule } from "./overlay-progress.js";
import { showToast } from "./utils.js";

// Simple hash function for content comparison
function simpleHash(str) {
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    const char = str.charCodeAt(i);
    hash = ((hash << 5) - hash) + char;
    hash = hash & hash; // Convert to 32bit integer
  }
  return hash;
}

export function injectMainPanel() {
  if (document.getElementById("w2n-notion-panel")) return;

  const config = getConfig();

  const panel = document.createElement("div");
  panel.id = "w2n-notion-panel";
  panel.style.cssText = `
    position: fixed;
    top: 20px;
    right: 20px;
    width: 320px;
    background: white;
    border: 1px solid #e5e7eb;
    border-radius: 8px;
    box-shadow: 0 10px 25px rgba(0,0,0,0.15);
    z-index: 10000;
    font-family: system-ui, -apple-system, sans-serif;
    font-size: 14px;
    user-select: none;
    opacity: 0.95;
    transition: opacity 0.2s ease;
  `;

  panel.addEventListener("mouseenter", () => (panel.style.opacity = "1"));
  panel.addEventListener("mouseleave", () => (panel.style.opacity = "0.95"));

  panel.innerHTML = `
    <style>
      @keyframes spin {
        0% { transform: rotate(0deg); }
        100% { transform: rotate(360deg); }
      }
    </style>
    <div id="w2n-header" style="padding: 16px; border-bottom: 1px solid #e5e7eb; background: #f9fafb; border-radius: 8px 8px 0 0; cursor: move; position: relative;">
      <div style="display:flex; justify-content:space-between; align-items:center;">
        <h3 style="margin:0; font-size:16px; color:#1f2937; display:flex; align-items:center; gap:8px;">
          📚 ServiceNow to Notion
          <span style="font-size:12px; color:#6b7280; font-weight:normal;">⇄ drag to move</span>
        </h3>
        <div style="display:flex; align-items:center; gap:8px;">
          <button id="w2n-advanced-settings-btn" title="Advanced Settings" style="background:none;border:none;font-size:16px;cursor:pointer;color:#6b7280;padding:4px;line-height:1;">⚙️</button>
          <button id="w2n-close" style="background:none;border:none;font-size:18px;cursor:pointer;color:#6b7280;padding:4px;line-height:1;">×</button>
        </div>
      </div>
    </div>

    <div style="padding:16px;">
      <div style="margin-bottom:16px;">
        <label style="display:block;margin-bottom:5px;font-weight:500;">Database:</label>
        <select id="w2n-database-select" style="width:100%;padding:8px;border:1px solid #d1d5db;border-radius:4px;">
          <option value="${config.databaseId || ""}">${
    config.databaseName || "(no database)"
  }</option>
        </select>
        <div id="w2n-selected-database-label" style="margin-top:8px;font-size:12px;color:#6b7280;">Database: ${
          config.databaseName || "(no database)"
        }</div>
        <div style="margin-top:8px; display:flex; gap:6px; align-items:center; flex-wrap:wrap;">
          <button id="w2n-refresh-dbs" style="font-size:11px;padding:4px 6px;border:1px solid #d1d5db;border-radius:4px;background:white;cursor:pointer;">Refresh</button>
          <button id="w2n-search-dbs" style="font-size:11px;padding:4px 6px;border:1px solid #d1d5db;border-radius:4px;background:white;cursor:pointer;">Search</button>
          <button id="w2n-get-db" style="font-size:11px;padding:4px 6px;border:1px solid #d1d5db;border-radius:4px;background:white;cursor:pointer;">By ID</button>
          <button id="w2n-configure-mapping" style="font-size:11px;padding:6px 8px;border:1px solid #10b981;border-radius:4px;background:#10b981;color:white;cursor:pointer;">Configure Property Mapping</button>
        </div>
        <div id="w2n-db-spinner" style="display:none; margin-top:8px; font-size:12px; color:#6b7280; align-items:center;">
          <span style="display:inline-block; width:12px; height:12px; border:2px solid #d1d5db; border-top:2px solid #10b981; border-radius:50%; animation:spin 1s linear infinite; margin-right:8px;"></span>
          Fetching databases...
        </div>
      </div>

      <div style="display:grid; gap:8px; margin-bottom:16px;">
        <button id="w2n-capture-page" style="width:100%; padding:12px; background:#10b981; color:white; border:none; border-radius:6px; cursor:pointer; font-weight:500;">📄 Save Current Page</button>
        <button id="w2n-capture-description" style="width:100%; padding:12px; background:#3b82f6; color:white; border:none; border-radius:6px; cursor:pointer; font-weight:500;">📖 Download PDF</button>
      </div>

      <div style="border-top:1px solid #e5e7eb; padding-top:16px;">
        <div style="display:flex; align-items:center; margin-bottom:12px;">
          <span style="font-size:16px; margin-right:8px;">🤖</span>
          <h4 style="margin:0; font-size:14px; font-weight:500;">AutoExtract Multi-Page</h4>
        </div>

        <div id="w2n-autoextract-controls">
          <div style="display:flex; gap:8px;">
            <button id="w2n-start-autoextract" style="flex:1; padding:10px; background:#f59e0b; color:white; border:none; border-radius:6px; cursor:pointer; font-weight:500;">Start AutoExtract</button>
            <button id="w2n-stop-autoextract" style="flex:1; padding:10px; background:#dc2626; color:white; border:none; border-radius:6px; cursor:pointer; font-weight:500; display:none;">⏹ Stop</button>
          </div>
          <div style="display:flex; gap:8px; margin-top:8px;">
            <button id="w2n-open-icon-cover" style="flex:1; padding:8px; background:#6b7280; color:white; border:none; border-radius:6px; cursor:pointer; font-size:13px;">Icon & Cover</button>
            <button id="w2n-diagnose-autoextract" style="flex:1; padding:8px; background:#0ea5e9; color:white; border:none; border-radius:6px; cursor:pointer; font-size:13px;">🔍 Diagnose</button>
          </div>
        </div>
      </div>
    </div>
  `;

  document.body.appendChild(panel);

  setupMainPanel(panel);
}

export function setupMainPanel(panel) {
  if (!panel) panel = document.getElementById("w2n-notion-panel");
  if (!panel) return;
  if (panel.dataset && panel.dataset.w2nInit) return;

  // Helper functions for spinner
  const showSpinner = () => {
    const spinner = panel.querySelector("#w2n-db-spinner");
    if (spinner) spinner.style.display = "flex";
  };

  const hideSpinner = () => {
    const spinner = panel.querySelector("#w2n-db-spinner");
    if (spinner) spinner.style.display = "none";
  };

  const closeBtn = panel.querySelector("#w2n-close");
  const advancedBtn = panel.querySelector("#w2n-advanced-settings-btn");
  const captureBtn = panel.querySelector("#w2n-capture-page");
  const configureBtn = panel.querySelector("#w2n-configure-mapping");
  const iconCoverBtn = panel.querySelector("#w2n-open-icon-cover");

  closeBtn.onclick = () => panel.remove();

  if (advancedBtn) {
    advancedBtn.onclick = (event) => {
      event.stopPropagation();
      try {
        injectAdvancedSettingsModal();
      } catch (e) {
        debug("Failed to open advanced settings modal from panel:", e);
      }
    };
  }

  captureBtn.onclick = async () => {
    try {
      if (
        window.ServiceNowToNotion &&
        typeof window.ServiceNowToNotion.app === "function"
      ) {
        const app = window.ServiceNowToNotion.app();
        if (app && typeof app.handleMainAction === "function") {
          await app.handleMainAction();
        }
      }
    } catch (e) {
      debug("Failed to execute capture action:", e);
    }
  };

  configureBtn.onclick = () => {
    try {
      showPropertyMappingModal();
    } catch (e) {
      debug("Failed to open property mapping modal:", e);
    }
  };

  iconCoverBtn.onclick = () => {
    try {
      injectIconCoverModal();
    } catch (e) {
      debug("Failed to open icon cover modal:", e);
    }
  };

  // Database button handlers
  const refreshBtn = panel.querySelector("#w2n-refresh-dbs");
  const searchBtn = panel.querySelector("#w2n-search-dbs");
  const getByIdBtn = panel.querySelector("#w2n-get-db");
  const databaseSelect = panel.querySelector("#w2n-database-select");
  const databaseLabel = panel.querySelector("#w2n-selected-database-label");

  if (refreshBtn) {
    refreshBtn.onclick = async () => {
      try {
        debug("🔄 Refreshing database list...");
        showSpinner();
        const databases = await getAllDatabases({ forceRefresh: true });
        populateDatabaseSelect(databaseSelect, databases);
        debug(`✅ Refreshed ${databases.length} databases`);
      } catch (e) {
        debug("Failed to refresh databases:", e);
      } finally {
        hideSpinner();
      }
    };
  }

  if (searchBtn) {
    searchBtn.onclick = async () => {
      try {
        const searchTerm = prompt("Enter database name or ID to search:");
        if (!searchTerm || searchTerm.trim() === "") return;

        debug(`🔍 Searching for database: ${searchTerm}`);
        showSpinner();

        // Query all databases fresh (no cache)
        const databases = await getAllDatabases({ forceRefresh: true });

        debug(
          `📋 Available databases: ${databases
            .map((db) => `${db.id.slice(-8)}: ${db.title || "Untitled"}`)
            .join(", ")}`
        );

        // Find matching database
        const searchTermTrimmed = searchTerm.trim();
        let matchingDb = databases.find(
          (db) =>
            db.id === searchTermTrimmed ||
            (db.title &&
              typeof db.title === "string" &&
              db.title.toLowerCase().includes(searchTermTrimmed.toLowerCase()))
        );

        // If not found by exact match, try partial ID match (last 8 chars)
        if (!matchingDb && searchTermTrimmed.length >= 8) {
          const partialId = searchTermTrimmed.slice(-8);
          matchingDb = databases.find((db) => db.id.endsWith(partialId));
          if (matchingDb) {
            debug(`✅ Found database by partial ID match: ${partialId}`);
          }
        }

        if (matchingDb) {
          // Update config with new database
          const config = getConfig();
          config.databaseId = matchingDb.id;
          config.databaseName =
            typeof matchingDb.title === "string"
              ? matchingDb.title
              : "Unknown Database";

          // Save to storage
          if (typeof GM_setValue === "function") {
            GM_setValue("notionConfig", config);
          }

          // Update UI
          databaseSelect.innerHTML = `<option value="${matchingDb.id}">${config.databaseName}</option>`;
          databaseLabel.textContent = `Database: ${config.databaseName}`;

          debug(
            `✅ Set target database to: ${config.databaseName} (${matchingDb.id})`
          );
        } else {
          alert(`Database "${searchTerm}" not found.`);
          debug(`❌ Database "${searchTerm}" not found`);
        }
      } catch (e) {
        debug("Failed to search database:", e);
        alert("Error searching for database. Check console for details.");
      } finally {
        hideSpinner();
      }
    };
  }

  if (getByIdBtn) {
    getByIdBtn.onclick = async () => {
      try {
        const dbId = prompt("Enter database ID:");
        if (!dbId || dbId.trim() === "") return;

        const cleanDbId = dbId.trim();
        debug(`🔍 Getting database by ID: ${cleanDbId}`);
        showSpinner();

        // Fetch database details to validate and get name
        const dbDetails = await getDatabase(cleanDbId);

        // Update config with validated database
        const config = getConfig();
        config.databaseId = cleanDbId;
        config.databaseName = dbDetails.title || "Database by ID";

        if (typeof GM_setValue === "function") {
          GM_setValue("notionConfig", config);
        }

        // Update UI
        databaseSelect.innerHTML = `<option value="${cleanDbId}">${config.databaseName}</option>`;
        databaseLabel.textContent = `Database: ${config.databaseName}`;

        debug(
          `✅ Set target database to: ${config.databaseName} (${cleanDbId})`
        );
      } catch (e) {
        debug("Failed to get database by ID:", e);
        alert(
          `Error: Could not access database with ID "${dbId}". Make sure the database is shared with your Notion integration.`
        );
      } finally {
        hideSpinner();
      }
    };
  }

  // Check for saved autoExtractState from page reload and resume if found
  const savedAutoExtractState = GM_getValue("w2n_autoExtractState");
  debug(`🔍 Checking for saved autoExtractState: ${savedAutoExtractState ? 'FOUND' : 'NOT FOUND'}`);
  if (savedAutoExtractState) {
    try {
      const parsedState = JSON.parse(savedAutoExtractState);
      debug(`🔄 Found saved autoExtractState from page reload:`, parsedState);

      // Check if we've exceeded max reload attempts
      const reloadAttempts = parsedState.reloadAttempts || 0;
      if (reloadAttempts > 3) {
        debug(`❌ Maximum reload attempts (3) exceeded - not resuming`);
        alert(
          `❌ AutoExtract stopped: Maximum reload attempts (3) exceeded.\n\nThe page failed to load properly after 3 reload attempts.\n\nTotal pages processed: ${parsedState.totalProcessed || 0}`
        );
        GM_setValue("w2n_autoExtractState", null);
        return;
      }

      // Clear the saved state
      GM_setValue("w2n_autoExtractState", null);

      // Resume auto-extraction after a short delay to let page fully load
      setTimeout(async () => {
        debug(`▶️ Resuming auto-extraction after page reload (attempt ${reloadAttempts}/3)...`);
        await resumeAutoExtraction(parsedState);
      }, 2000);
    } catch (e) {
      debug(`❌ Error parsing saved autoExtractState:`, e);
      GM_setValue("w2n_autoExtractState", null);
    }
  }

  // AutoExtract button handlers
  const startAutoExtractBtn = panel.querySelector("#w2n-start-autoextract");
  const stopAutoExtractBtn = panel.querySelector("#w2n-stop-autoextract");
  const diagnoseAutoExtractBtn = panel.querySelector(
    "#w2n-diagnose-autoextract"
  );

  if (startAutoExtractBtn) {
    startAutoExtractBtn.onclick = async () => {
      try {
        // Show stop button, hide start button
        startAutoExtractBtn.style.display = "none";
        if (stopAutoExtractBtn) stopAutoExtractBtn.style.display = "block";

        await startAutoExtraction();

        // After completion, restore buttons
        startAutoExtractBtn.style.display = "block";
        if (stopAutoExtractBtn) stopAutoExtractBtn.style.display = "none";
      } catch (e) {
        debug("Failed to start auto extraction:", e);
        alert("Error starting auto extraction. Check console for details.");
        // Restore buttons on error
        startAutoExtractBtn.style.display = "block";
        if (stopAutoExtractBtn) stopAutoExtractBtn.style.display = "none";
      }
    };
  }

  if (stopAutoExtractBtn) {
    stopAutoExtractBtn.onclick = () => {
      // Stop the extraction by setting running to false
      if (
        window.ServiceNowToNotion &&
        window.ServiceNowToNotion.autoExtractState
      ) {
        window.ServiceNowToNotion.autoExtractState.running = false;
        showToast("⏹ Stopping AutoExtract after current page...", 3000);
      }
      // Restore buttons
      startAutoExtractBtn.style.display = "block";
      stopAutoExtractBtn.style.display = "none";
    };
  }

  if (diagnoseAutoExtractBtn) {
    diagnoseAutoExtractBtn.onclick = () => {
      try {
        diagnoseAutoExtraction();
      } catch (e) {
        debug("Failed to diagnose auto extraction:", e);
        alert("Error diagnosing auto extraction. Check console for details.");
      }
    };
  }

  // mark as initialized
  try {
    panel.dataset = panel.dataset || {};
    panel.dataset.w2nInit = "1";
  } catch (e) {}
}

// Drag-to-move behavior: pointer-based, clamps to viewport, switches to left positioning while dragging
function enablePanelDrag(panel) {
  const header = panel.querySelector("#w2n-header");
  if (!header) return;
  let dragging = false;
  let startX = 0;
  let startY = 0;
  let startLeft = 0;
  let startTop = 0;

  const onPointerDown = (ev) => {
    // Only primary button
    if (ev.button && ev.button !== 0) return;
    // Skip dragging if clicking on a button
    if (ev.target.tagName === "BUTTON" || ev.target.closest("button")) return;
    header.setPointerCapture && header.setPointerCapture(ev.pointerId);
    dragging = true;
    startX = ev.clientX;
    startY = ev.clientY;

    // compute current panel position; prefer left when dragging so we can move freely
    const rect = panel.getBoundingClientRect();
    // If panel is positioned with right, compute an equivalent left
    const computed = window.getComputedStyle(panel);
    if (computed.right && computed.right !== "auto") {
      // convert to left
      const rightPx = parseFloat(computed.right) || 0;
      startLeft = window.innerWidth - rect.width - rightPx;
    } else {
      startLeft = rect.left;
    }
    startTop = rect.top;

    // switch to left positioning for the duration of the drag
    panel.style.left = `${Math.max(8, startLeft)}px`;
    panel.style.right = "auto";
    panel.style.transition = "none";
  };

  const onPointerMove = (ev) => {
    if (!dragging) return;
    ev.preventDefault();
    const dx = ev.clientX - startX;
    const dy = ev.clientY - startY;
    let newLeft = startLeft + dx;
    let newTop = startTop + dy;

    // clamp to viewport with 8px margin
    const margin = 8;
    const rect = panel.getBoundingClientRect();
    newLeft = Math.min(
      Math.max(margin, newLeft),
      window.innerWidth - rect.width - margin
    );
    newTop = Math.min(
      Math.max(margin, newTop),
      window.innerHeight - rect.height - margin + window.scrollY
    );

    panel.style.left = `${Math.round(newLeft)}px`;
    panel.style.top = `${Math.round(newTop)}px`;
  };

  const onPointerUp = (ev) => {
    if (!dragging) return;
    dragging = false;
    header.releasePointerCapture && header.releasePointerCapture(ev.pointerId);
    // restore transition
    panel.style.transition = "";
  };

  header.addEventListener("pointerdown", onPointerDown);
  window.addEventListener("pointermove", onPointerMove);
  window.addEventListener("pointerup", onPointerUp);
  // pointercancel also
  window.addEventListener("pointercancel", onPointerUp);
}

// Attach drag enable when panel is initialized
const origSetup = setupMainPanel;
setupMainPanel = function (panel) {
  origSetup(panel);
  try {
    if (!panel) panel = document.getElementById("w2n-notion-panel");
    enablePanelDrag(panel);
  } catch (e) {
    // noop
  }
};

/**
 * Populate the database select dropdown
 * @param {HTMLElement} selectEl - The select element
 * @param {Array} databases - Array of database objects
 */
function populateDatabaseSelect(selectEl, databases) {
  if (!selectEl) return;

  selectEl.innerHTML = '<option value="">Select a database...</option>';

  databases.forEach((db) => {
    const option = document.createElement("option");
    option.value = db.id;
    option.textContent =
      db.title && db.title[0] ? db.title[0].plain_text : "Untitled Database";
    selectEl.appendChild(option);
  });
}

// AutoExtract functionality

async function startAutoExtraction() {
  const config = getConfig();
  if (!config.databaseId) {
    alert("Please select a database first.");
    return;
  }

  const nextPageSelector =
    typeof GM_getValue === "function"
      ? GM_getValue("w2n_next_page_selector", "div.zDocsNextTopicButton a")
      : "div.zDocsNextTopicButton a";

  if (!nextPageSelector) {
    alert(
      "Please select a 'Next Page' element first using the 'Select Next Page Element' button."
    );
    return;
  }

  // Get app instance
  if (
    !window.ServiceNowToNotion ||
    typeof window.ServiceNowToNotion.app !== "function"
  ) {
    alert("App instance not available. Please refresh the page.");
    return;
  }

  const app = window.ServiceNowToNotion.app();
  if (!app) {
    alert("App instance not available. Please refresh the page.");
    return;
  }

  debug(
    `Starting auto-extraction using selector: ${nextPageSelector}`
  );

  // Initialize auto-extract state
  const autoExtractState = {
    running: true,
    currentPage: 0,
    totalProcessed: 0,
    paused: false,
    reloadAttempts: 0, // Track page reload attempts (max 3)
    lastContentHash: null, // Track last page content hash to detect duplicates
    duplicateCount: 0, // Count consecutive duplicates
  };

  // Set up beforeunload handler to save state if page is reloaded manually
  const beforeUnloadHandler = (event) => {
    if (autoExtractState.running) {
      debug(`⚠️ Page unloading during AutoExtract - saving state...`);
      const stateToSave = {
        ...autoExtractState,
        reloadAttempts: (autoExtractState.reloadAttempts || 0) + 1
      };
      GM_setValue("w2n_autoExtractState", JSON.stringify(stateToSave));
    }
  };
  window.addEventListener('beforeunload', beforeUnloadHandler);

  try {
    // Clear any existing overlays before starting
    overlayModule.done({ success: true, autoCloseMs: 0 });

    // Store state globally so stop button can access it
    window.ServiceNowToNotion = window.ServiceNowToNotion || {};
    window.ServiceNowToNotion.autoExtractState = autoExtractState;

    // Start the extraction process
    overlayModule.start("Starting multi-page extraction...");

    await runAutoExtractLoop(autoExtractState, app, nextPageSelector);

    // Clean up
    window.removeEventListener('beforeunload', beforeUnloadHandler);
    delete window.ServiceNowToNotion.autoExtractState;
  } catch (error) {
    debug("❌ Auto-extraction failed:", error);
    overlayModule.error({
      message: `Auto-extraction failed: ${error.message}`,
    });
    // Clean up
    window.removeEventListener('beforeunload', beforeUnloadHandler);
    delete window.ServiceNowToNotion.autoExtractState;
  }
}

/**
 * Check if the current page is showing a 503 error
 * @returns {boolean} True if 503 error is detected
 */
function isPage503Error() {
  const errorHeader = document.querySelector(
    ".zDocsSubHeaderErrorPage h3.zDocsBreadcrumbsLastItem"
  );
  const errorTitle = document.querySelector(
    ".serverErrorPage.zDocsErrorPage h1"
  );

  if (errorHeader && errorHeader.textContent.includes("ERROR 503")) {
    debug("🚨 Detected 503 error page");
    return true;
  }

  if (errorTitle && errorTitle.textContent.includes("We'll be back soon")) {
    debug('🚨 Detected "We\'ll be back soon" error page');
    return true;
  }

  return false;
}

/**
 * Check if the current page is showing an "Access limited" error
 * @returns {boolean} True if access limited message is detected
 */
function isPageAccessLimited() {
  const pageTitle = document.title;
  const limitedMessage = "Access to this content is limited to authorized users.";

  if (pageTitle === limitedMessage || pageTitle.includes(limitedMessage)) {
    debug(`🔒 Detected access limited page: "${pageTitle}"`);
    return true;
  }

  // Also check for h1 with this message
  const h1Elements = document.querySelectorAll("h1");
  for (const h1 of h1Elements) {
    if (h1.textContent && h1.textContent.includes(limitedMessage)) {
      debug(`🔒 Detected access limited message in h1: "${h1.textContent}"`);
      return true;
    }
  }

  return false;
}

/**
 * Show a countdown alert and wait
 * @param {number} seconds - Number of seconds to wait
 * @param {string} message - Message to show in alert
 * @returns {Promise<void>}
 */
async function showCountdownAndWait(seconds, message) {
  return new Promise((resolve) => {
    let remaining = seconds;
    const alertDiv = document.createElement('div');
    alertDiv.style.cssText = `
      position: fixed;
      top: 50%;
      left: 50%;
      transform: translate(-50%, -50%);
      background: white;
      border: 2px solid #333;
      border-radius: 8px;
      padding: 20px 30px;
      z-index: 10001;
      box-shadow: 0 4px 12px rgba(0,0,0,0.3);
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
      min-width: 300px;
      text-align: center;
    `;
    
    const messageEl = document.createElement('div');
    messageEl.style.cssText = 'margin-bottom: 15px; font-size: 14px; color: #333;';
    messageEl.textContent = message;
    
    const countdownEl = document.createElement('div');
    countdownEl.style.cssText = 'font-size: 24px; font-weight: bold; color: #0066cc;';
    countdownEl.textContent = `${remaining}s`;
    
    alertDiv.appendChild(messageEl);
    alertDiv.appendChild(countdownEl);
    document.body.appendChild(alertDiv);
    
    const interval = setInterval(() => {
      remaining--;
      if (remaining > 0) {
        countdownEl.textContent = `${remaining}s`;
      } else {
        clearInterval(interval);
        document.body.removeChild(alertDiv);
        resolve();
      }
    }, 1000);
  });
}

/**
 * Reload the page and wait for it to load
 * @param {number} timeoutMs - Maximum time to wait for reload
 * @returns {Promise<boolean>} True if reload successful and no error page
 */
async function reloadAndWait(timeoutMs = 15000) {
  debug("🔄 Reloading page...");

  return new Promise((resolve) => {
    const startTime = Date.now();

    // Set up listener for load event
    const onLoad = () => {
      debug("✅ Page reloaded");
      window.removeEventListener("load", onLoad);

      // Wait longer for content to stabilize and fully render
      setTimeout(() => {
        const is503 = isPage503Error();
        if (is503) {
          debug("❌ Page still shows 503 error after reload");
          resolve(false);
        } else {
          debug("✅ Page loaded successfully without errors");
          resolve(true);
        }
      }, 5000);
    };

    // Set up timeout
    const timeout = setTimeout(() => {
      window.removeEventListener("load", onLoad);
      debug("⏱️ Reload timeout reached");
      resolve(false);
    }, timeoutMs);

    window.addEventListener("load", onLoad);

    // Trigger reload
    window.location.reload();
  });
}

async function runAutoExtractLoop(autoExtractState, app, nextPageSelector) {
  debug("🔄 Starting AutoExtract loop");

  // Get button reference for progress updates
  const button = document.getElementById("w2n-start-autoextract");

  while (autoExtractState.running && !autoExtractState.paused) {
    autoExtractState.currentPage++;
    const currentPageNum = autoExtractState.currentPage;
    debug(`📄 Processing page number: ${currentPageNum}`);

    overlayModule.setMessage(
      `Extracting page ${currentPageNum}...`
    );

    // Update button with progress
    if (button) {
      button.textContent = `Processing page ${currentPageNum}...`;
    }

    try {
      // STEP 0: Check for access limited message and reload if necessary
      let accessLimitedReloadAttempts = 0;
      const maxAccessLimitedReloadAttempts = 3;

      while (isPageAccessLimited() && accessLimitedReloadAttempts < maxAccessLimitedReloadAttempts) {
        accessLimitedReloadAttempts++;
        debug(
          `🔒 Access limited detected, attempting reload ${accessLimitedReloadAttempts}/${maxAccessLimitedReloadAttempts}...`
        );
        showToast(
          `⚠️ Page access limited, reloading (attempt ${accessLimitedReloadAttempts}/${maxAccessLimitedReloadAttempts})...`,
          5000
        );
        if (button) {
          button.textContent = `Reloading for access (${accessLimitedReloadAttempts}/${maxAccessLimitedReloadAttempts})...`;
        }

        const reloadSuccess = await reloadAndWait(15000);

        if (!reloadSuccess && accessLimitedReloadAttempts < maxAccessLimitedReloadAttempts) {
          debug(
            `⏳ Access limited reload ${accessLimitedReloadAttempts} failed, waiting 5s before retry...`
          );
          await showCountdownAndWait(5, `⏳ Reload failed. Retrying in...`);
        }
      }

      // If still access limited after reload attempts, skip this page and move to next
      if (isPageAccessLimited()) {
        debug(
          `🔒 Access limited persists after ${maxAccessLimitedReloadAttempts} reload attempts, skipping page ${currentPageNum}...`
        );
        showToast(
          `⊘ Skipped page ${currentPageNum}: Access limited (after ${maxAccessLimitedReloadAttempts} reloads)`,
          4000
        );
        if (button) {
          button.textContent = `Skipped page ${currentPageNum} (access limited)`;
        }

        // Navigate to next page after skip
        debug(`\n========================================`);
        debug(
          `⊘ Skipped page ${currentPageNum} due to persistent access limited`
        );
        debug(`🎯 Now navigating to page ${currentPageNum + 1}...`);
        debug(`========================================\n`);

        // STEP 0b: Find next page button
          debug(`🔍 Finding next page button after skip...`);
          overlayModule.setMessage(`Finding next page button...`);

          const nextButton = await findAndClickNextButton(
            nextPageSelector,
            autoExtractState,
            button
          );

          if (!nextButton) {
            const errorMessage = `❌ AutoExtract STOPPED: Next page button could not be found after skipping page ${currentPageNum}.\n\nTotal pages processed: ${autoExtractState.totalProcessed}`;
            alert(errorMessage);
            stopAutoExtract(autoExtractState);
            if (button) button.textContent = "Start AutoExtract";
            return;
          }

          // Check if stop was requested
          if (!autoExtractState.running) {
            debug(
              `⏹ AutoExtract stopped by user after skipping page ${currentPageNum}`
            );
            showToast(
              `⏹ AutoExtract stopped. Processed ${autoExtractState.totalProcessed} pages.`,
              4000
            );
            stopAutoExtract(autoExtractState);
            if (button) button.textContent = "Start AutoExtract";
            return;
          }

          // Click button to navigate
          debug(`🎯 Now navigating to page ${currentPageNum + 1}...`);
          overlayModule.setMessage(`Navigating to page ${currentPageNum + 1}...`);
          if (button) {
            button.textContent = `Navigating to page ${currentPageNum + 1}...`;
          }

          const currentUrl = window.location.href;
          const currentTitle = document.title;
          const currentPageId = getCurrentPageId();
          const mainContent = document.querySelector(
            'main, .main-content, [role="main"]'
          );
          const currentContentLength = mainContent
            ? mainContent.innerHTML.length
            : 0;

          await clickNextPageButton(nextButton);
          debug(`✅ Click executed, waiting for page to navigate...`);

          // Wait for navigation
          debug(
            `⏳ Waiting for navigation to page ${currentPageNum + 1}...`
          );
          const navigationSuccess = await waitForNavigationAdvanced(
            currentUrl,
            currentTitle,
            currentPageId,
            currentContentLength,
            15000
          );

          if (!navigationSuccess) {
            const navErrorMessage = `❌ AutoExtract STOPPED: Navigation to page ${currentPageNum + 1} failed.\n\nTotal pages processed: ${autoExtractState.totalProcessed}`;
            alert(navErrorMessage);
            stopAutoExtract(autoExtractState);
            if (button) button.textContent = `❌ Stopped: Navigation failed`;
            return;
          }

          debug(`✅ Navigation detected! Page ${currentPageNum + 1} URL loaded.`);

          // Wait for content to load
          debug(
            `⏳ Waiting for page ${currentPageNum + 1} content to load...`
          );
          overlayModule.setMessage(`Loading page ${currentPageNum + 1} content...`);
          if (button) {
            button.textContent = `Loading page ${currentPageNum + 1}...`;
          }
          await new Promise((resolve) => setTimeout(resolve, 3000));

          // Stabilization wait
          debug(`⏳ Stabilizing page ${currentPageNum + 1}...`);
          await new Promise((resolve) => setTimeout(resolve, 1000));

          debug(
            `✅ Page ${currentPageNum + 1} fully loaded and ready for capture!`
          );
          debug(`\n========================================`);
          debug(`🔄 Looping back to capture page ${currentPageNum + 1}...`);
          debug(`========================================\n`);

        // Continue to next iteration
        continue;
      }

      // STEP 1: Check for 503 error and reload if necessary
      let reloadAttempts = 0;
      const maxReloadAttempts = 3;

      while (isPage503Error() && reloadAttempts < maxReloadAttempts) {
        reloadAttempts++;
        debug(
          `🚨 503 error detected, attempting reload ${reloadAttempts}/${maxReloadAttempts}...`
        );
        showToast(
          `⚠️ 503 error detected, reloading page (attempt ${reloadAttempts}/${maxReloadAttempts})...`,
          5000
        );
        if (button) {
          button.textContent = `Reloading page (${reloadAttempts}/${maxReloadAttempts})...`;
        }

        const reloadSuccess = await reloadAndWait(15000);

        if (!reloadSuccess && reloadAttempts < maxReloadAttempts) {
          debug(
            `⏳ Reload ${reloadAttempts} failed, waiting 5s before retry...`
          );
          await showCountdownAndWait(5, `⏳ 503 error reload failed. Retrying in...`);
        }
      }

      // If still showing 503 after max reload attempts, stop
      if (isPage503Error()) {
        const errorMessage = `❌ AutoExtract STOPPED: Page ${currentPageNum} shows 503 error after ${maxReloadAttempts} reload attempts.\n\nTotal pages processed: ${autoExtractState.totalProcessed}`;
        alert(errorMessage);
        stopAutoExtract(autoExtractState);
        if (button) button.textContent = `❌ Stopped: 503 Error`;
        return;
      }

      // STEP 1: Extract and capture current page
      debug(`📄 Step 1: Extracting page ${currentPageNum}...`);
      let captureSuccess = false;
      let captureAttempts = 0;
      const maxCaptureAttempts = 3;

      while (captureAttempts < maxCaptureAttempts && !captureSuccess) {
        captureAttempts++;

        try {
          if (captureAttempts > 1) {
            showToast(
              `Retry ${
                captureAttempts - 1
              }/2: Extracting page ${currentPageNum}...`,
              3000
            );
            if (button) {
              button.textContent = `Retry ${
                captureAttempts - 1
              }/2: Extracting page ${currentPageNum}...`;
            }
            await new Promise((resolve) => setTimeout(resolve, 2000));
          }

          const extractedData = await app.extractCurrentPageData();

          // STEP 1.5: Check for duplicate content
          const contentHash = simpleHash(extractedData.html || extractedData.content || "");
          
          if (contentHash === autoExtractState.lastContentHash) {
            autoExtractState.duplicateCount++;
            debug(
              `⚠️ DUPLICATE CONTENT DETECTED (${autoExtractState.duplicateCount} consecutive)!`
            );
            debug(`Hash: ${contentHash}, Last Hash: ${autoExtractState.lastContentHash}`);
            
            if (autoExtractState.duplicateCount >= 3) {
              const errorMessage = `❌ AutoExtract STOPPED: Same page content detected ${autoExtractState.duplicateCount} times in a row.\n\nThis usually means:\n- ServiceNow navigation isn't working\n- You've reached the end of the section\n- There's a navigation loop\n\nTotal pages processed: ${autoExtractState.totalProcessed}\nLast successful page: ${currentPageNum - autoExtractState.duplicateCount}`;
              alert(errorMessage);
              stopAutoExtract(autoExtractState);
              if (button) button.textContent = `❌ Stopped: Duplicate content`;
              return;
            }
            
            // Skip this duplicate but continue (might be temporary navigation issue)
            debug(`⊘ Skipping duplicate content, will retry navigation...`);
            showToast(
              `⚠️ Duplicate content #${autoExtractState.duplicateCount}, retrying...`,
              3000
            );
            break; // Break from capture attempts loop to go to next page
          } else {
            // Content is different, reset duplicate counter
            autoExtractState.duplicateCount = 0;
            autoExtractState.lastContentHash = contentHash;
            debug(`✅ Content is unique (hash: ${contentHash})`);
          }

          // STEP 2: Create Notion page and wait for success
          debug(
            `💾 Step 2: Creating Notion page for page ${currentPageNum}...`
          );
          overlayModule.setMessage(`Creating Notion page ${currentPageNum}...`);
          await app.processWithProxy(extractedData);

          captureSuccess = true;
          autoExtractState.totalProcessed++;
          debug(
            `✅ Page ${currentPageNum} captured and saved to Notion successfully${
              captureAttempts > 1 ? ` (attempt ${captureAttempts})` : ""
            }`
          );

          // Brief wait to ensure API call fully completes
          await new Promise((resolve) => setTimeout(resolve, 2000));
        } catch (error) {
          debug(
            `❌ Capture attempt ${captureAttempts} failed for page ${currentPageNum}:`,
            error
          );
          if (captureAttempts < maxCaptureAttempts) {
            showToast(
              `⚠️ Page capture failed (attempt ${captureAttempts}/${maxCaptureAttempts}). Retrying...`,
              4000
            );
          }
        }
      }

      if (!captureSuccess) {
        const errorMessage = `❌ AutoExtract STOPPED: Page ${currentPageNum} failed to capture after ${maxCaptureAttempts} attempts.\n\nTotal pages processed: ${autoExtractState.totalProcessed}`;
        alert(errorMessage);
        stopAutoExtract(autoExtractState);
        if (button)
          button.textContent = `❌ Stopped: Page ${currentPageNum} failed`;
        return;
      }

      // Check if stop was requested before continuing to next page
      if (!autoExtractState.running) {
        debug(`⏹ AutoExtract stopped by user after page ${currentPageNum}`);
        showToast(
          `⏹ AutoExtract stopped. Processed ${autoExtractState.totalProcessed} pages.`,
          4000
        );
        stopAutoExtract(autoExtractState);
        if (button) button.textContent = "Start AutoExtract";
        return;
      }

      // Navigate to next page
      debug(`\n========================================`);
      debug(`📄 Completed page ${currentPageNum}`);
      debug(`🎯 Now navigating to page ${currentPageNum + 1}...`);
      debug(`========================================\n`);

      // STEP 3: Find next page button
        debug(`🔍 Step 3: Finding next page button...`);
        overlayModule.setMessage(`Finding next page button...`);

        const nextButton = await findAndClickNextButton(
          nextPageSelector,
          autoExtractState,
          button
        );

        if (!nextButton) {
          // Button not found after all retries
          const errorMessage = `❌ AutoExtract STOPPED: Next page button could not be found.\n\nTotal pages processed: ${autoExtractState.totalProcessed}`;
          alert(errorMessage);
          stopAutoExtract(autoExtractState);
          if (button) button.textContent = "Start AutoExtract";
          return;
        }

        // Check if stop was requested before clicking
        if (!autoExtractState.running) {
          debug(
            `⏹ AutoExtract stopped by user before navigating to page ${
              currentPageNum + 1
            }`
          );
          showToast(
            `⏹ AutoExtract stopped. Processed ${autoExtractState.totalProcessed} pages.`,
            4000
          );
          stopAutoExtract(autoExtractState);
          if (button) button.textContent = "Start AutoExtract";
          return;
        }

        // STEP 4: Click button and navigate to next page
        debug(`🎯 Now navigating to page ${currentPageNum + 1}...`);
        overlayModule.setMessage(`Navigating to page ${currentPageNum + 1}...`);
        if (button) {
          button.textContent = `Clicking next button for page ${currentPageNum + 1}...`;
        }

        const currentUrl = window.location.href;
        const currentTitle = document.title;
        const currentPageId = getCurrentPageId();
        const mainContent = document.querySelector(
          'main, .main-content, [role="main"]'
        );
        const currentContentLength = mainContent
          ? mainContent.innerHTML.length
          : 0;

        // Click the button
        await clickNextPageButton(nextButton);
        debug(`✅ Click executed, waiting for page to navigate...`);

        // STEP 5: Wait for navigation to complete (15 second timeout)
        debug(
          `⏳ Step 5: Waiting for navigation to page ${currentPageNum + 1}...`
        );
        const navigationSuccess = await waitForNavigationAdvanced(
          currentUrl,
          currentTitle,
          currentPageId,
          currentContentLength,
          15000
        );

        if (!navigationSuccess) {
          const navErrorMessage = `❌ AutoExtract STOPPED: Navigation to page ${
            currentPageNum + 1
          } failed.\n\nTotal pages processed: ${
            autoExtractState.totalProcessed
          }`;
          alert(navErrorMessage);
          stopAutoExtract(autoExtractState);
          if (button) button.textContent = `❌ Stopped: Navigation failed`;
          return;
        }

        debug(`✅ Navigation detected! Page ${currentPageNum + 1} URL loaded.`);

        // STEP 6: Wait for content to be fully loaded
        debug(
          `⏳ Step 6: Waiting for page ${currentPageNum + 1} content to load...`
        );
        overlayModule.setMessage(
          `Loading page ${currentPageNum + 1} content...`
        );
        if (button) {
          button.textContent = `Loading page ${currentPageNum + 1}...`;
        }
        await new Promise((resolve) => setTimeout(resolve, 3000));

        // Brief stabilization wait
        debug(`⏳ Step 7: Stabilizing page ${currentPageNum + 1}...`);
        await new Promise((resolve) => setTimeout(resolve, 1000));

        debug(
          `✅ Page ${currentPageNum + 1} fully loaded and ready for capture!`
        );
        debug(`\n========================================`);
        debug(`🔄 Looping back to capture page ${currentPageNum + 1}...`);
        debug(`========================================\n`);
    } catch (error) {
      debug(`❌ Error in AutoExtract loop:`, error);
      const errorMessage = `❌ AutoExtract ERROR: ${error.message}\n\nTotal pages processed: ${autoExtractState.totalProcessed}`;
      alert(errorMessage);
      stopAutoExtract(autoExtractState);
      if (button)
        button.textContent = `❌ Error: ${error.message.substring(0, 20)}...`;
      return;
    }
  }
}

/**
 * Resume auto-extraction after page reload
 */
async function resumeAutoExtraction(savedState) {
  debug(`▶️ Resuming auto-extraction with saved state:`, savedState);

  // Restore the autoExtractState
  const autoExtractState = {
    ...savedState,
    running: true,
    paused: false,
  };

  // Store state globally
  window.ServiceNowToNotion = window.ServiceNowToNotion || {};
  window.ServiceNowToNotion.autoExtractState = autoExtractState;

  // Update UI to show we're resuming
  const startBtn = document.querySelector("#w2n-start-autoextract");
  const stopBtn = document.querySelector("#w2n-stop-autoextract");
  if (startBtn) startBtn.style.display = "none";
  if (stopBtn) stopBtn.style.display = "block";

  showToast(
    `🔄 Resumed auto-extraction after page reload (page ${autoExtractState.currentPage + 1})`,
    5000
  );

  try {
    // Continue the extraction loop from where we left off
    await continueAutoExtractionLoop(autoExtractState);
  } catch (error) {
    debug(`❌ Error resuming auto-extraction:`, error);
    const errorMessage = `❌ Resume AutoExtract ERROR: ${error.message}\n\nTotal pages processed: ${autoExtractState.totalProcessed}`;
    alert(errorMessage);
    stopAutoExtract(autoExtractState);
  }
}

/**
 * Continue the auto-extraction loop from a specific state (used after page reload)
 */
async function continueAutoExtractionLoop(autoExtractState) {
  debug("🔄 Continuing AutoExtract loop from saved state");
  debug(
    `📊 Resumed state: currentPage=${autoExtractState.currentPage}, totalProcessed=${autoExtractState.totalProcessed}`
  );

  // Get references
  const app = window.ServiceNowToNotion?.app?.();
  const nextPageSelector =
    typeof GM_getValue === "function"
      ? GM_getValue("w2n_next_page_selector", "div.zDocsNextTopicButton a")
      : "div.zDocsNextTopicButton a";
  const button = document.getElementById("w2n-start-autoextract");

  // Add extra delay after page reload to ensure page is fully loaded and stabilized
  debug(
    `⏳ Waiting additional time after page reload for full stabilization...`
  );
  if (button) {
    button.textContent = "Waiting for page to load...";
  }
  await new Promise((resolve) => setTimeout(resolve, 3000));

  // Continue the main loop
  while (autoExtractState.running && !autoExtractState.paused) {
    debug(`\n🔄 Loop iteration: currentPage=${autoExtractState.currentPage}`);

    autoExtractState.currentPage++;
    const currentPageNum = autoExtractState.currentPage;
    debug(`📄 Processing page number: ${currentPageNum}`);

    overlayModule.setMessage(`Extracting page ${currentPageNum}...`);

    // Update button with progress
    if (button) {
      button.textContent = `Processing page ${currentPageNum}...`;
    }

    try {
      // Extract current page data using the app instance
      debug(`📝 Step 1: Extracting content from page ${currentPageNum}...`);
      overlayModule.setMessage(`Extracting content from page ${currentPageNum}...`);
      const extractedData = await app.extractCurrentPageData();

      if (!extractedData) {
        throw new Error("No content extracted from page");
      }

      // Send to Notion
      debug(`📤 Sending page ${currentPageNum} to Notion...`);
      overlayModule.setMessage(`Processing page ${currentPageNum}...`);
      
      // Process the content using the app's processWithProxy method
      // This will internally show more detailed messages like:
      // - "Checking proxy connection..."
      // - "Converting content to Notion blocks..."
      // - "Page created successfully!"
      await app.processWithProxy(extractedData);
      
      // If we get here without throwing, it succeeded
      const result = { success: true };

      autoExtractState.totalProcessed++;
      debug(`✅ Page ${currentPageNum} saved to Notion`);
      overlayModule.setMessage(`✓ Page ${currentPageNum} saved! Continuing...`);

      // Navigate to next page
      const nextButton = await findAndClickNextButton(
        nextPageSelector,
        autoExtractState,
        button
      );

      if (!nextButton) {
        debug(`❌ Could not find next page button after reload attempt`);
        overlayModule.done({
          success: false,
          pageUrl: null,
          autoCloseMs: 0,
        });
        showToast(
          `❌ Could not find next page button. AutoExtract stopped after ${autoExtractState.totalProcessed} page(s).`,
          5000
        );
        stopAutoExtract(autoExtractState);
        if (button) button.textContent = "Start AutoExtract";
        return;
      }

      // Wait for page navigation
      debug(`⏳ Step 4: Waiting for page navigation...`);
      if (button) {
        button.textContent = `Loading page ${currentPageNum + 1}...`;
      }
      await new Promise((resolve) => setTimeout(resolve, 3000));

      // Brief stabilization wait
      debug(`⏳ Step 5: Stabilizing page ${currentPageNum + 1}...`);
      await new Promise((resolve) => setTimeout(resolve, 1000));

      debug(
        `✅ Page ${currentPageNum + 1} fully loaded and ready for capture!`
      );
      debug(`\n========================================`);
      debug(`🔄 Looping back to capture page ${currentPageNum + 1}...`);
      debug(`========================================\n`);
    } catch (error) {
      debug(`❌ Error in AutoExtract loop:`, error);
      const errorMessage = `❌ AutoExtract ERROR: ${error.message}\n\nTotal pages processed: ${autoExtractState.totalProcessed}`;
      alert(errorMessage);
      stopAutoExtract(autoExtractState);
      if (button)
        button.textContent = `❌ Error: ${error.message.substring(0, 20)}...`;
      overlayModule.error({
        message: `AutoExtract failed: ${error.message}`,
      });
      return;
    }
  }
  
  // Loop completed successfully - show completion overlay
  debug(`🎉 AutoExtract completed! Total pages processed: ${autoExtractState.totalProcessed}`);
  overlayModule.done({
    success: true,
    pageUrl: null,
    autoCloseMs: 5000,
  });
  showToast(
    `✅ AutoExtract complete! Processed ${autoExtractState.totalProcessed} page(s)`,
    5000
  );
  stopAutoExtract(autoExtractState);
  if (button) button.textContent = "Start AutoExtract";
}

/**
 * Find and click the next page button with retry logic
 * Returns the button element if found, null if not found after all attempts
 */
async function findAndClickNextButton(
  nextPageSelector,
  autoExtractState,
  button
) {
  const maxFindAttempts = 3;
  let findAttempts = 0;
  let nextButton = null;

  // Try to find the button with reloads after each failed attempt
  while (!nextButton && findAttempts < maxFindAttempts) {
    findAttempts++;

    if (button) {
      button.textContent = `Looking for next button (${findAttempts}/${maxFindAttempts})...`;
    }

    nextButton = findNextPageElement(nextPageSelector);

    if (!nextButton && findAttempts < maxFindAttempts) {
      debug(`⚠️ Next page button not found, reloading and retrying...`);

      // Save autoExtractState to localStorage before reload
      if (autoExtractState) {
        // Increment reload attempts
        autoExtractState.reloadAttempts = (autoExtractState.reloadAttempts || 0) + 1;
        
        // Check if we've exceeded max reload attempts
        if (autoExtractState.reloadAttempts > 3) {
          debug(`❌ Maximum reload attempts (3) exceeded`);
          alert(
            `❌ AutoExtract stopped: Maximum reload attempts (3) exceeded.\n\nThe page failed to load properly after 3 reload attempts.\n\nTotal pages processed: ${autoExtractState.totalProcessed}`
          );
          stopAutoExtract(autoExtractState);
          return null;
        }

        debug(`💾 Saving autoExtractState before reload (attempt ${autoExtractState.reloadAttempts}/3):`, autoExtractState);
        const stateJson = JSON.stringify(autoExtractState);
        GM_setValue("w2n_autoExtractState", stateJson);
        
        // Verify save succeeded
        const verification = GM_getValue("w2n_autoExtractState");
        debug(`✅ State save verified: ${verification === stateJson ? 'SUCCESS' : 'FAILED'}`);
      }

      // Reload the page and wait for it to load
      debug(
        `🔄 Reloading page to refresh DOM elements (reload attempt ${autoExtractState.reloadAttempts}/3)...`
      );
      
      // Add small delay to ensure GM_setValue completes before reload
      await new Promise(resolve => setTimeout(resolve, 100));
      window.location.reload();

      // Wait for page reload (this code won't execute after reload)
      return null;
    }
  }

  if (!nextButton) {
    debug(
      `❌ Next page button not found after ${maxFindAttempts} attempts with reloads`
    );
    alert(
      `❌ Next page button could not be found after ${maxFindAttempts} attempts with page reloads.\n\nAutoExtract has been stopped.`
    );

    // Stop the auto-extraction process
    if (autoExtractState) {
      stopAutoExtract(autoExtractState);
    }

    return null;
  }

  // Return the found button (clicking will be done by clickNextPageButton)
  return nextButton;
}

/**
 * Get a unique identifier for the current page to detect navigation
 * even when URL doesn't change (for SPAs)
 */
function getCurrentPageId() {
  // Try to get page-specific identifiers that change with navigation
  const identifiers = [
    // URL hash/fragment
    window.location.hash,
    // URL search params
    window.location.search,
    // Page title
    document.title,
    // Any unique page content elements
    document.querySelector("h1")?.textContent?.trim(),
    // Current page number if visible in DOM
    document
      .querySelector('[class*="page"], [class*="chapter"]')
      ?.textContent?.trim(),
    // ServiceNow specific selectors
    document.querySelector("article[id]")?.getAttribute("id"),
    // Any data attributes that might indicate page state
    document
      .querySelector("[data-page], [data-chapter], [data-section]")
      ?.getAttribute("data-page") ||
      document
        .querySelector("[data-page], [data-chapter], [data-section]")
        ?.getAttribute("data-chapter") ||
      document
        .querySelector("[data-page], [data-chapter], [data-section]")
        ?.getAttribute("data-section"),
  ];

  // Combine non-null identifiers into a unique string
  const pageId =
    identifiers.filter((id) => id && id.length > 0).join("|") ||
    Date.now().toString(); // Fallback to timestamp

  return pageId;
}

function stopAutoExtract(autoExtractState) {
  autoExtractState.running = false;
  overlayModule.setProgress(100);
  overlayModule.done({
    success: true,
    autoCloseMs: 5000,
  });

  // Restore button visibility
  const startBtn = document.getElementById("w2n-start-autoextract");
  const stopBtn = document.getElementById("w2n-stop-autoextract");
  if (startBtn) startBtn.style.display = "block";
  if (stopBtn) stopBtn.style.display = "none";

  // Clean up global state
  if (window.ServiceNowToNotion && window.ServiceNowToNotion.autoExtractState) {
    delete window.ServiceNowToNotion.autoExtractState;
  }
}

// Helper function to wait for page navigation
async function waitForNavigation(timeoutMs = 10000) {
  const initialUrl = window.location.href;
  const startTime = Date.now();

  return new Promise((resolve, reject) => {
    const checkNavigation = () => {
      if (window.location.href !== initialUrl) {
        debug("Navigation detected - URL changed");
        resolve();
        return;
      }

      if (Date.now() - startTime > timeoutMs) {
        reject(new Error(`Navigation timeout after ${timeoutMs}ms`));
        return;
      }

      // Check again in a short interval
      setTimeout(checkNavigation, 100);
    };

    checkNavigation();
  });
}

// Advanced navigation detection with multiple checks including pageId
async function waitForNavigationAdvanced(
  originalUrl,
  originalTitle,
  originalPageId,
  originalContentLength,
  timeoutMs = 15000
) {
  const startTime = Date.now();
  let attempts = 0;
  const maxAttempts = Math.ceil(timeoutMs / 1000);

  return new Promise((resolve) => {
    const checkNavigation = () => {
      attempts++;

      const currentUrl = window.location.href;
      const currentTitle = document.title;
      const currentPageId = getCurrentPageId();

      // Check multiple indicators
      const urlChanged = currentUrl !== originalUrl;
      const titleChanged = currentTitle !== originalTitle;
      const pageIdChanged = currentPageId !== originalPageId;

      // Content-based check
      const mainContent = document.querySelector(
        'main, .main-content, [role="main"]'
      );
      const contentLength = mainContent ? mainContent.innerHTML.length : 0;
      const contentChanged =
        mainContent &&
        contentLength !== originalContentLength &&
        contentLength > 100;

      // Log detailed check every 3 seconds
      if (attempts % 3 === 0) {
        debug(`🔍 Navigation check ${attempts}/${maxAttempts}:`, {
          urlChanged,
          titleChanged,
          pageIdChanged,
          contentChanged,
        });
      }

      if (urlChanged || titleChanged || pageIdChanged || contentChanged) {
        const changeTypes = [];
        if (urlChanged) changeTypes.push("URL");
        if (titleChanged) changeTypes.push("Title");
        if (pageIdChanged) changeTypes.push("PageID");
        if (contentChanged) changeTypes.push("Content");

        debug(
          `✅ Navigation detected after ${attempts} seconds (${changeTypes.join(
            ", "
          )} changed)`
        );
        resolve(true);
        return;
      }

      if (attempts >= maxAttempts) {
        debug(`❌ Navigation timeout after ${maxAttempts} seconds`);
        debug(`Final state:`, {
          "Original URL": originalUrl,
          "Current URL": currentUrl,
          "Original PageID": originalPageId.substring(0, 50),
          "Current PageID": currentPageId.substring(0, 50),
        });
        resolve(false);
        return;
      }

      setTimeout(checkNavigation, 1000);
    };

    checkNavigation();
  });
}

// Wait for content to be ready on the page
async function waitForContentReady(timeoutMs = 10000) {
  const startTime = Date.now();

  return new Promise((resolve) => {
    const checkContent = () => {
      // Check if main content area exists and has meaningful content
      const contentSelectors = [
        "#zDocsContent .zDocsTopicPageBody",
        'main[role="main"]',
        "main",
        "article",
        ".main-content",
      ];

      for (const selector of contentSelectors) {
        try {
          const element = document.querySelector(selector);
          if (
            element &&
            element.innerHTML &&
            element.innerHTML.trim().length > 200
          ) {
            debug(
              `✅ Content ready: Found ${selector} with ${element.innerHTML.length} chars`
            );
            resolve(true);
            return;
          }
        } catch (e) {
          // Continue checking other selectors
        }
      }

      // Check timeout
      if (Date.now() - startTime > timeoutMs) {
        debug("⚠️ Content ready timeout - continuing anyway");
        resolve(false);
        return;
      }

      // Check again after a short delay
      setTimeout(checkContent, 500);
    };

    checkContent();
  });
}

// Check if element is visible and clickable
function isElementVisible(element) {
  if (!element || !document.contains(element)) return false;

  const style = window.getComputedStyle(element);
  if (
    style.display === "none" ||
    style.visibility === "hidden" ||
    style.opacity === "0"
  ) {
    return false;
  }

  const rect = element.getBoundingClientRect();
  if (rect.width === 0 && rect.height === 0) return false;

  if (element.disabled) return false;

  return true;
}

// Advanced click simulation for next page button
async function clickNextPageButton(button) {
  try {
    // Find the actual clickable element (anchor, button, or input)
    let clickableElement = button;

    // If the element is inside an SVG, find the parent anchor or button
    if (
      button.ownerSVGElement ||
      button.tagName.toLowerCase() === "use" ||
      button.tagName.toLowerCase() === "path" ||
      button.tagName.toLowerCase() === "svg"
    ) {
      debug(
        "🔍 Element is inside SVG, looking for parent clickable element..."
      );
      // Walk up the DOM to find a clickable element
      let current = button;
      while (current && current !== document.body) {
        if (
          current.tagName.toLowerCase() === "a" ||
          current.tagName.toLowerCase() === "button" ||
          current.getAttribute("role") === "button" ||
          current.onclick ||
          current.getAttribute("href")
        ) {
          clickableElement = current;
          debug(`✅ Found parent clickable: ${current.tagName}`);
          break;
        }
        current = current.parentElement;
      }
    }

    // Focus the element
    clickableElement.focus();
    await new Promise((resolve) => setTimeout(resolve, 100));

    // Primary click attempt
    // Dispatch mouse events for better compatibility
    clickableElement.dispatchEvent(
      new MouseEvent("mousedown", { bubbles: true, cancelable: true })
    );
    clickableElement.dispatchEvent(
      new MouseEvent("mouseup", { bubbles: true, cancelable: true })
    );

    // Primary click
    clickableElement.click();

    // Set up fallback click attempts if primary doesn't work
    // These will only fire if navigation hasn't occurred
    const currentUrl = window.location.href;
    const currentPageId = getCurrentPageId();
    
    setTimeout(() => {
      const newUrl = window.location.href;
      const newPageId = getCurrentPageId();
      const urlChanged = newUrl !== currentUrl;
      const pageIdChanged = newPageId !== currentPageId;

      if (!urlChanged && !pageIdChanged) {
        debug(
          "⚠️ Primary click didn't trigger navigation, trying fallback methods..."
        );

        // Fallback 1: Event dispatch
        try {
          clickableElement.dispatchEvent(
            new Event("click", { bubbles: true, cancelable: true })
          );
        } catch (e) {
          debug("❌ Fallback 1 failed:", e);
        }

        // Fallback 2: Keyboard activation (Enter key)
        try {
          clickableElement.dispatchEvent(
            new KeyboardEvent("keydown", {
              key: "Enter",
              keyCode: 13,
              bubbles: true,
              cancelable: true,
            })
          );
        } catch (e) {
          debug("❌ Fallback 2 failed:", e);
        }
      }
    }, 1000);
  } catch (error) {
    debug("Error clicking next page button:", error);
    // Provide more detailed error information
    const errorDetails = {
      message: error.message || "Unknown error",
      element: button
        ? `${button.tagName}${button.id ? "#" + button.id : ""}${
            button.className ? "." + button.className.split(" ").join(".") : ""
          }`
        : "null",
      clickableElement: clickableElement
        ? `${clickableElement.tagName}${
            clickableElement.id ? "#" + clickableElement.id : ""
          }${
            clickableElement.className
              ? "." + clickableElement.className.split(" ").join(".")
              : ""
          }`
        : "null",
      href: clickableElement?.href || "none",
      onclick: !!clickableElement?.onclick,
    };
    debug("Detailed click error info:", errorDetails);
    throw new Error(
      `Failed to click next page button: ${
        error.message || "Unknown error"
      } (Element: ${errorDetails.element}, Clickable: ${
        errorDetails.clickableElement
      })`
    );
  }
}

// Show end-of-book confirmation dialog
async function showEndOfBookConfirmation(autoExtractState) {
  return new Promise((resolve) => {
    const overlay = document.createElement("div");
    overlay.style.cssText = `
      position: fixed;
      top: 0;
      left: 0;
      width: 100%;
      height: 100%;
      background: rgba(0, 0, 0, 0.7);
      display: flex;
      justify-content: center;
      align-items: center;
      z-index: 10001;
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
    `;

    overlay.innerHTML = `
      <div style="
        background: white;
        padding: 30px;
        border-radius: 12px;
        max-width: 500px;
        width: 90%;
        box-shadow: 0 20px 60px rgba(0, 0, 0, 0.3);
        text-align: center;
      ">
        <div style="font-size: 24px; margin-bottom: 15px; color: #f59e0b;">⚠️</div>

        <h3 style="
          margin: 0 0 15px 0;
          font-size: 18px;
          font-weight: 600;
          color: #111827;
        ">AutoExtract: Next Page Not Found</h3>

        <p style="
          margin: 0 0 25px 0;
          color: #6b7280;
          line-height: 1.5;
          font-size: 14px;
        ">The "Next Page" button/element could not be found on this page. This typically means you've reached the end of the book.</p>

        <div style="
          background: #f3f4f6;
          padding: 15px;
          border-radius: 8px;
          margin-bottom: 25px;
          font-size: 13px;
          color: #374151;
          text-align: left;
        ">
          <strong>Processed so far:</strong> ${autoExtractState.totalProcessed} pages<br>
          <strong>Current page:</strong> ${autoExtractState.currentPage}
        </div>

        <p style="
          margin: 0 0 25px 0;
          color: #374151;
          line-height: 1.4;
          font-size: 14px;
          font-weight: 500;
        ">What would you like to do?</p>

        <div style="display: flex; gap: 10px; justify-content: center;">
          <button id="end-of-book-confirm" style="
            padding: 12px 20px;
            background: #dc2626;
            color: white;
            border: none;
            border-radius: 6px;
            cursor: pointer;
            font-weight: 500;
            font-size: 14px;
            flex: 1;
            max-width: 150px;
          ">End of Book</button>

          <button id="continue-autoextract" style="
            padding: 12px 20px;
            background: #2563eb;
            color: white;
            border: none;
            border-radius: 6px;
            cursor: pointer;
            font-weight: 500;
            font-size: 14px;
            flex: 1;
            max-width: 150px;
          ">Select New Element</button>
        </div>

        <p style="
          margin: 20px 0 0 0;
          color: #9ca3af;
          font-size: 12px;
          line-height: 1.4;
        ">Choose "End of Book" if this is the last page, or "Select New Element" if you want to continue with a different element.</p>
      </div>
    `;

    document.body.appendChild(overlay);

    const endButton = overlay.querySelector("#end-of-book-confirm");
    const continueButton = overlay.querySelector("#continue-autoextract");

    endButton.onclick = () => {
      overlay.remove();
      resolve(false);
    };

    continueButton.onclick = () => {
      overlay.remove();
      resolve(true);
    };

    // Auto-close after 60 seconds (defaults to end of book)
    setTimeout(() => {
      if (document.body.contains(overlay)) {
        overlay.remove();
        resolve(false);
      }
    }, 60000);
  });
}

function diagnoseAutoExtraction() {
  const nextPageSelector =
    typeof GM_getValue === "function"
      ? GM_getValue("w2n_next_page_selector", "div.zDocsNextTopicButton a")
      : "div.zDocsNextTopicButton a";

  let diagnosis = "AutoExtract Diagnosis:\n\n";
  diagnosis += `Next page selector: ${nextPageSelector || "Not set"}\n\n`;

  if (!nextPageSelector) {
    diagnosis +=
      "❌ No next page selector configured. Use 'Select Next Page Element' first.\n";
  } else {
    diagnosis += "✅ Next page selector configured.\n";
    // Test if selector exists on current page
    try {
      const element = document.querySelector(nextPageSelector);
      if (element) {
        diagnosis += `✅ Selector found on current page: ${
          element.textContent?.trim().substring(0, 50) || element.tagName
        }\n`;
      } else {
        diagnosis += "⚠️ Selector not found on current page.\n";
      }
    } catch (e) {
      diagnosis += `❌ Invalid selector: ${e.message}\n`;
    }
  }

  diagnosis +=
    "\nNote: Full auto-extraction functionality is not yet implemented.";

  alert(diagnosis);
}

// Advanced element discovery with multiple strategies
function findNextPageElement(savedSelector) {
  // Strategy 1: Try saved selector
  if (savedSelector) {
    try {
      const element = document.querySelector(savedSelector);
      if (element && isElementVisible(element)) {
        debug(
          `🎯 Found next page element with saved selector: ${savedSelector}`
        );
        return element;
      }
    } catch (e) {
      debug(`⚠️ Saved selector failed: ${savedSelector}`, e);
    }
  }

  // Strategy 2: Look for navigation-specific containers first
  // This helps avoid content links that happen to contain "next"
  const navContainerSelectors = [
    "nav",
    '[role="navigation"]',
    ".pagination",
    ".pager",
    ".navigation",
    "footer",
    ".topic-footer",
    ".page-navigation",
    ".doc-navigation",
    '[class*="navigation"]',
    '[class*="pager"]',
  ];

  // Try to find next button within navigation containers first
  for (const containerSelector of navContainerSelectors) {
    const containers = document.querySelectorAll(containerSelector);
    for (const container of containers) {
      // Look for SVG icons indicating next button
      const svgElements = container.querySelectorAll(
        'svg[class*="next" i], svg[class*="forward" i], use[xlink\\:href*="next" i], use[href*="next" i]'
      );
      for (const svg of svgElements) {
        // Find the parent clickable element (a, button)
        const clickable = svg.closest('a, button, [role="button"]');
        if (
          clickable &&
          !isCurrentPageElement(clickable) &&
          isElementVisible(clickable)
        ) {
          debug(
            `🎯 Found next page element with SVG icon in ${containerSelector}: ${svg.className}`
          );
          return clickable;
        }
      }

      // Look for elements with "next" in text within this container
      const links = container.querySelectorAll('a, button, [role="button"]');
      for (const link of links) {
        // Skip current page indicators
        if (isCurrentPageElement(link)) {
          continue;
        }

        // Check for SVG children with "next" class or href
        const hasSvgNext = link.querySelector(
          'svg[class*="next" i], svg[class*="forward" i], use[xlink\\:href*="next" i], use[href*="next" i]'
        );
        if (hasSvgNext && isElementVisible(link)) {
          debug(
            `🎯 Found next page element containing SVG in ${containerSelector}`
          );
          return link;
        }

        const text = link.textContent?.toLowerCase() || "";
        const ariaLabel = link.getAttribute("aria-label")?.toLowerCase() || "";
        const title = link.getAttribute("title")?.toLowerCase() || "";

        // Look for "next section" or just "next" with forward symbols
        if (
          text.includes("next section") ||
          ariaLabel.includes("next section") ||
          title.includes("next section") ||
          text.trim() === "next" ||
          (text.includes("next") && (text.includes(">") || text.includes("→")))
        ) {
          if (isElementVisible(link)) {
            debug(
              `🎯 Found next page element in ${containerSelector}: "${text.substring(
                0,
                50
              )}"`
            );
            return link;
          }
        }
      }
    }
  }

  // Strategy 3: Look for SVG-based next buttons (common pattern)
  const svgNextSelectors = [
    "svg.ico-next",
    'svg[class*="next"]',
    'svg[class*="forward"]',
    'use[xlink\\:href*="next"]',
    'use[href*="next"]',
  ];

  for (const selector of svgNextSelectors) {
    try {
      const svgElements = document.querySelectorAll(selector);
      for (const svg of svgElements) {
        const clickable = svg.closest('a, button, [role="button"]');
        if (
          clickable &&
          !isCurrentPageElement(clickable) &&
          isElementVisible(clickable)
        ) {
          debug(`🎯 Found next page element with SVG selector: ${selector}`);
          return clickable;
        }
      }
    } catch (e) {
      // Skip invalid selectors
    }
  }

  // Strategy 4: Look for common next page patterns (broader search)
  const nextPagePatterns = [
    // Text-based matching (prioritize specific patterns)
    'button:contains("Next Section")',
    'a:contains("Next Section")',
    'button:contains("Next")',
    'button:contains("Forward")',
    'button:contains(">")',
    'button:contains("→")',
    'a:contains("Next")',
    'a:contains("Forward")',
    'a:contains(">")',
    'a:contains("→")',
    // Attribute-based matching
    'button[aria-label*="next" i]',
    'button[aria-label*="forward" i]',
    'a[aria-label*="next" i]',
    'a[aria-label*="forward" i]',
    // Class-based matching
    "button.next",
    "button.forward",
    "a.next",
    "a.forward",
    ".pagination button:last-child",
    ".pagination a:last-child",
  ];

  for (const pattern of nextPagePatterns) {
    try {
      let elements;
      if (pattern.includes(":contains")) {
        // Handle jQuery-style :contains pseudo-selector
        const [tag, text] = pattern.split(':contains("');
        const searchText = text.slice(0, -2).toLowerCase();
        elements = Array.from(document.querySelectorAll(tag)).filter((el) =>
          el.textContent?.toLowerCase().includes(searchText)
        );
      } else {
        elements = document.querySelectorAll(pattern);
      }

      for (const element of elements) {
        // Filter out current page indicators
        if (isCurrentPageElement(element)) {
          debug(`⏭️ Skipping current page element: ${element.className}`);
          continue;
        }

        if (isElementVisible(element)) {
          debug(`🔍 Found next page element with pattern: ${pattern}`);
          return element;
        }
      }
    } catch (e) {
      // Skip invalid selectors
    }
  }

  // Strategy 5: Look for elements with navigation-related attributes (last resort, more selective)
  const navElements = document.querySelectorAll('button, a, [role="button"]');
  for (const element of navElements) {
    // Skip current page indicators
    if (isCurrentPageElement(element)) {
      continue;
    }

    // Check for SVG children indicating next button (even without specific class)
    const hasSvg = element.querySelector("svg, use");
    if (hasSvg) {
      const svgClass =
        hasSvg.className?.baseVal || hasSvg.getAttribute("class") || "";
      const useHref =
        hasSvg.getAttribute("xlink:href") || hasSvg.getAttribute("href") || "";
      if (
        svgClass.toLowerCase().includes("next") ||
        useHref.toLowerCase().includes("next")
      ) {
        if (isElementVisible(element)) {
          debug(`🎯 Found next page element with SVG child indicator`);
          return element;
        }
      }
    }

    // Skip elements that are clearly content links (have too much text or are in article content)
    const text = element.textContent?.trim() || "";
    if (text.length > 50) {
      // Navigation buttons are usually short
      continue;
    }

    // Check if element is inside main content area (likely a content link, not navigation)
    const isInMainContent = element.closest(
      'article, main, .content, [role="main"]'
    );
    const isInNavArea = element.closest(
      'nav, footer, .navigation, .pagination, [role="navigation"]'
    );

    // Prefer elements in navigation areas, avoid elements only in content
    if (isInMainContent && !isInNavArea) {
      continue;
    }

    const textLower = text.toLowerCase();
    const ariaLabel = element.getAttribute("aria-label")?.toLowerCase() || "";
    const title = element.getAttribute("title")?.toLowerCase() || "";

    if (
      textLower.includes("next section") ||
      ariaLabel.includes("next section") ||
      title.includes("next section") ||
      textLower === "next" ||
      (textLower.includes("next") &&
        (textLower.includes(">") || textLower.includes("→")))
    ) {
      if (isElementVisible(element)) {
        debug(
          `🔍 Found next page element by text/attribute analysis: "${text.substring(
            0,
            30
          )}"`
        );
        return element;
      }
    }
  }

  debug("❌ No next page element found with any strategy");
  return null;
}

// Helper function to check if an element is a current page indicator (not a navigation button)
function isCurrentPageElement(element) {
  if (!element) return false;

  const classList = element.classList || [];
  // Handle both string className and SVGAnimatedString (for SVG elements)
  const className = typeof element.className === 'string' 
    ? element.className 
    : (element.className?.baseVal || "");

  // Check for common "current page" class patterns
  const currentPagePatterns = [
    "current",
    "active",
    "selected",
    "currentTopic",
    "currentPage",
    "aria-current",
  ];

  // Check class list
  for (const pattern of currentPagePatterns) {
    if (
      Array.from(classList).some((c) =>
        c.toLowerCase().includes(pattern.toLowerCase())
      ) ||
      (className && className.toLowerCase().includes(pattern.toLowerCase()))
    ) {
      return true;
    }
  }

  // Check aria-current attribute
  if (
    element.getAttribute("aria-current") === "page" ||
    element.getAttribute("aria-current") === "true"
  ) {
    return true;
  }

  return false;
}
