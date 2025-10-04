// Main floating panel (ported from original createUI())

import { debug, getConfig } from "../config.js";
import { showPropertyMappingModal } from "./property-mapping-modal.js";
import { injectAdvancedSettingsModal } from "./advanced-settings-modal.js";
import { injectIconCoverModal } from "./icon-cover-modal.js";
import { getAllDatabases, getDatabase } from "../api/database-api.js";
import { overlayModule } from "./overlay-progress.js";
import { showToast } from "./utils.js";

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
        <div style="margin-bottom:12px; display:flex; gap:8px; align-items:center; flex-wrap:wrap;">
          <div style="display:flex; align-items:center; gap:8px;">
            <label style="display:block; margin-bottom:0; font-size:12px;">Max Pages:</label>
            <input type="number" id="w2n-max-pages" value="500" min="1" max="500" style="width:60px; padding:4px; border:1px solid #d1d5db; border-radius:4px;">
          </div>
          <div style="flex:1; min-width:120px;">
            <button id="w2n-select-next-element" style="width:100%; padding:6px; background:#2563eb; color:white; border:none; border-radius:4px; cursor:pointer; font-size:12px;">Select "Next Page"</button>
          </div>
          <div style="flex:1; min-width:80px;">
            <button id="w2n-reset-next-selector" style="width:100%; padding:6px; background:#dc2626; color:white; border:none; border-radius:4px; cursor:pointer; font-size:12px;">Reset</button>
          </div>
        </div>

        <div id="w2n-autoextract-controls">
          <button id="w2n-start-autoextract" style="width:100%; padding:10px; background:#f59e0b; color:white; border:none; border-radius:6px; cursor:pointer; font-weight:500;">Start AutoExtract</button>
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

  // AutoExtract button handlers
  const selectNextBtn = panel.querySelector("#w2n-select-next-element");
  const resetNextBtn = panel.querySelector("#w2n-reset-next-selector");
  const startAutoExtractBtn = panel.querySelector("#w2n-start-autoextract");
  const diagnoseAutoExtractBtn = panel.querySelector(
    "#w2n-diagnose-autoextract"
  );

  if (selectNextBtn) {
    selectNextBtn.onclick = () => {
      try {
        startElementSelection();
      } catch (e) {
        debug("Failed to start element selection:", e);
        alert("Error starting element selection. Check console for details.");
      }
    };
  }

  if (resetNextBtn) {
    resetNextBtn.onclick = () => {
      try {
        if (typeof GM_setValue === "function") {
          GM_setValue("w2n_next_page_selector", "#zDocsContent > header > div.zDocsTopicActions > div.zDocsBundlePagination > div.zDocsNextTopicButton.zDocsNextTopicButton > span > a > svg > use");
        }
        alert("Next Page selector reset to default ServiceNow documentation selector.");
      } catch (e) {
        debug("Failed to reset selector:", e);
        alert("Error resetting selector. Check console for details.");
      }
    };
  }

  if (startAutoExtractBtn) {
    startAutoExtractBtn.onclick = async () => {
      try {
        await startAutoExtraction();
      } catch (e) {
        debug("Failed to start auto extraction:", e);
        alert("Error starting auto extraction. Check console for details.");
      }
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
let elementSelectionActive = false;
let selectedElement = null;

function startElementSelection() {
  if (elementSelectionActive) {
    stopElementSelection();
    return;
  }

  elementSelectionActive = true;
  selectedElement = null;

  // Add visual feedback
  document.body.style.cursor = "crosshair";

  // Create overlay message (non-blocking)
  const overlay = document.createElement("div");
  overlay.id = "w2n-element-selection-overlay";
  overlay.style.cssText = `
    position: fixed;
    top: 0;
    left: 0;
    right: 0;
    bottom: 0;
    background: rgba(0, 0, 0, 0.7);
    z-index: 9999;
    display: flex;
    align-items: center;
    justify-content: center;
    color: white;
    font-family: Arial, sans-serif;
    font-size: 18px;
    text-align: center;
    pointer-events: none;
  `;
  overlay.innerHTML = `
    <div style="pointer-events: auto;">
      <div style="font-size: 24px; margin-bottom: 10px;">🎯</div>
      <div>Click on the "Next Page" element</div>
      <div style="font-size: 14px; margin-top: 10px; opacity: 0.8;">Press ESC to cancel</div>
    </div>
  `;
  document.body.appendChild(overlay);

  // Handle element selection (use bubbling phase so clicks pass through overlay)
  const handleClick = (e) => {
    // Only handle clicks if element selection is active
    if (!elementSelectionActive) return;

    e.preventDefault();
    e.stopPropagation();

    selectedElement = e.target;
    stopElementSelection();

    // Generate selector for the selected element
    const selector = generateSelector(selectedElement);
    debug("Selected element selector:", selector);

    // Store the selector
    if (typeof GM_setValue === "function") {
      GM_setValue("w2n_next_page_selector", selector);
    }

    alert(
      `Selected element: ${selector}\n\nThis selector will be used to find the "Next Page" button during auto-extraction.`
    );
  };

  const handleKeyDown = (e) => {
    if (e.key === "Escape") {
      stopElementSelection();
    }
  };

  // Use bubbling phase (false) instead of capture phase (true)
  document.addEventListener("click", handleClick, false);
  document.addEventListener("keydown", handleKeyDown);

  function stopElementSelection() {
    elementSelectionActive = false;
    document.body.style.cursor = "";
    document.removeEventListener("click", handleClick, true);
    document.removeEventListener("keydown", handleKeyDown);

    const overlay = document.getElementById("w2n-element-selection-overlay");
    if (overlay) {
      overlay.remove();
    }
  }
}

function generateSelector(element) {
  if (!element) return "";

  // Try to generate a unique selector
  const id = element.id;
  if (id) return `#${id}`;

  const className = element.className;
  if (className && typeof className === "string") {
    const classes = className
      .trim()
      .split(/\s+/)
      .filter((c) => c);
    if (classes.length > 0) {
      return `${element.tagName.toLowerCase()}.${classes.join(".")}`;
    }
  }

  // Generate path-based selector
  const path = [];
  let current = element;
  while (current && current.nodeType === Node.ELEMENT_NODE) {
    let selector = current.tagName.toLowerCase();

    if (current.id) {
      selector = `#${current.id}`;
      path.unshift(selector);
      break;
    } else if (current.className && typeof current.className === "string") {
      const classes = current.className
        .trim()
        .split(/\s+/)
        .filter((c) => c);
      if (classes.length > 0) {
        selector += `.${classes[0]}`;
      }
    }

    // Add nth-child if needed
    const siblings = Array.from(current.parentNode?.children || []);
    const index = siblings.indexOf(current);
    if (siblings.length > 1) {
      selector += `:nth-child(${index + 1})`;
    }

    path.unshift(selector);
    current = current.parentNode;

    if (path.length > 5) break; // Limit depth
  }

  return path.join(" > ");
}

async function startAutoExtraction() {
  const config = getConfig();
  if (!config.databaseId) {
    alert("Please select a database first.");
    return;
  }

  const maxPages =
    parseInt(document.getElementById("w2n-max-pages")?.value) || 500;
  const nextPageSelector =
    typeof GM_getValue === "function"
      ? GM_getValue("w2n_next_page_selector", "#zDocsContent > header > div.zDocsTopicActions > div.zDocsBundlePagination > div.zDocsNextTopicButton.zDocsNextTopicButton > span > a > svg > use")
      : "#zDocsContent > header > div.zDocsTopicActions > div.zDocsBundlePagination > div.zDocsNextTopicButton.zDocsNextTopicButton > span > a > svg > use";

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
    `Starting auto-extraction with max ${maxPages} pages using selector: ${nextPageSelector}`
  );

  // Initialize auto-extract state
  const autoExtractState = {
    running: true,
    currentPage: 0,
    totalProcessed: 0,
    maxPages: maxPages,
    reloadAttempts: 0,
    paused: false,
  };

  // Check if we're resuming from a page reload
  const savedState = localStorage.getItem("W2N_autoExtractState");
  if (savedState) {
    try {
      const restoredState = JSON.parse(savedState);
      if (restoredState.running && !restoredState.paused) {
        Object.assign(autoExtractState, restoredState);
        localStorage.removeItem("W2N_autoExtractState");
        debug("Resumed AutoExtract state from page reload:", autoExtractState);
        showToast(
          `🔄 AutoExtract resumed after page reload\nProcessing page ${autoExtractState.currentPage}/${autoExtractState.maxPages}`,
          5000
        );
      }
    } catch (error) {
      debug("Error restoring AutoExtract state:", error);
      localStorage.removeItem("W2N_autoExtractState");
    }
  }

  try {
    // Start the extraction process
    overlayModule.start("Starting multi-page extraction...");

    await runAutoExtractLoop(autoExtractState, app, nextPageSelector);
  } catch (error) {
    debug("❌ Auto-extraction failed:", error);
    overlayModule.error({
      message: `Auto-extraction failed: ${error.message}`,
    });
  }
}

async function runAutoExtractLoop(autoExtractState, app, nextPageSelector) {
  debug("🔄 Starting AutoExtract loop");

  // Get button reference for progress updates
  const button = document.getElementById("w2n-start-autoextract");

  while (autoExtractState.running && !autoExtractState.paused) {
    // Check if we've reached max pages
    if (autoExtractState.currentPage >= autoExtractState.maxPages) {
      showToast(
        `AutoExtract complete: Reached max pages (${autoExtractState.maxPages})`,
        4000
      );
      stopAutoExtract(autoExtractState);
      if (button) button.textContent = "Start AutoExtract";
      return;
    }

    autoExtractState.currentPage++;
    const currentPageNum = autoExtractState.currentPage;

    overlayModule.setMessage(
      `Extracting page ${currentPageNum} of ${autoExtractState.maxPages}...`
    );
    overlayModule.setProgress(
      ((currentPageNum - 1) / autoExtractState.maxPages) * 100
    );

    // Update button with progress
    if (button) {
      button.textContent = `Processing ${currentPageNum}/${autoExtractState.maxPages}...`;
    }

    try {
      // Extract current page data with retry logic
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
              }/2: Processing page ${currentPageNum}...`,
              3000
            );
            if (button) {
              button.textContent = `Retry ${
                captureAttempts - 1
              }/2: Processing ${currentPageNum}/${
                autoExtractState.maxPages
              }...`;
            }
            await new Promise((resolve) => setTimeout(resolve, 2000));
          }

          const extractedData = await app.extractCurrentPageData();
          await app.processWithProxy(extractedData);
          captureSuccess = true;
          autoExtractState.totalProcessed++;
          debug(
            `✅ Page ${currentPageNum} captured successfully${
              captureAttempts > 1 ? ` (attempt ${captureAttempts})` : ""
            }`
          );
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

      // Wait for save to complete
      await new Promise((resolve) => setTimeout(resolve, 2000));

      // Check if we should continue to next page
      if (currentPageNum < autoExtractState.maxPages) {
        // Try to find next page element with multiple strategies
        let nextButton = findNextPageElement(nextPageSelector);

        if (!nextButton) {
          debug(`⚠️ Next page element not found or not visible`);

          // Try page reload first (max 2 attempts)
          if (autoExtractState.reloadAttempts < 2) {
            autoExtractState.reloadAttempts++;
            debug(`🔄 Reload attempt ${autoExtractState.reloadAttempts}/2`);

            showToast(
              `Page reload attempt ${autoExtractState.reloadAttempts}/2 - trying to refresh content...`,
              3000
            );
            if (button) {
              button.textContent = `Reloading... (${autoExtractState.reloadAttempts}/2)`;
            }

            // Save state before reload
            const stateToSave = {
              running: autoExtractState.running,
              currentPage: autoExtractState.currentPage,
              totalProcessed: autoExtractState.totalProcessed,
              maxPages: autoExtractState.maxPages,
              reloadAttempts: autoExtractState.reloadAttempts,
              paused: false,
            };
            localStorage.setItem(
              "W2N_autoExtractState",
              JSON.stringify(stateToSave)
            );

            // Wait then reload
            await new Promise((resolve) => setTimeout(resolve, 2500));
            window.location.reload();
            return; // Exit - will resume after reload
          }

          // Max reloads reached - show end of book confirmation
          const shouldContinue = await showEndOfBookConfirmation(
            autoExtractState
          );
          if (!shouldContinue) {
            showToast(
              `AutoExtract complete: User confirmed end of book\nProcessed ${autoExtractState.totalProcessed} pages`,
              4000
            );
            stopAutoExtract(autoExtractState);
            if (button) button.textContent = "Start AutoExtract";
            return;
          } else {
            showToast(
              "Please select a new 'Next Page' element to continue AutoExtract",
              5000
            );
            autoExtractState.paused = true;
            if (button) button.textContent = "Paused - Select New Element";
            return;
          }
        }

        // Navigate to next page
        overlayModule.setMessage(`Navigating to page ${currentPageNum + 1}...`);
        if (button) {
          button.textContent = `Going to next page...`;
        }

        const currentUrl = window.location.href;
        const currentTitle = document.title;

        // Click next button with advanced methods
        await clickNextPageButton(nextButton);

        // Wait for navigation
        const navigationSuccess = await waitForNavigationAdvanced(
          currentUrl,
          currentTitle
        );

        if (!navigationSuccess) {
          const navErrorMessage = `❌ AutoExtract STOPPED: Page navigation failed.\n\nTotal pages processed: ${autoExtractState.totalProcessed}`;
          alert(navErrorMessage);
          stopAutoExtract(autoExtractState);
          if (button) button.textContent = `❌ Stopped: Navigation failed`;
          return;
        }

        // Wait for content to load
        await new Promise((resolve) => setTimeout(resolve, 3000));
      }
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

function stopAutoExtract(autoExtractState) {
  autoExtractState.running = false;
  overlayModule.setProgress(100);
  overlayModule.done({
    success: true,
    autoCloseMs: 5000,
  });
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

// Advanced navigation detection with multiple checks
async function waitForNavigationAdvanced(
  originalUrl,
  originalTitle,
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

      // Check multiple indicators
      const urlChanged = currentUrl !== originalUrl;
      const titleChanged = currentTitle !== originalTitle;

      // Content-based check
      const mainContent = document.querySelector(
        'main, .main-content, [role="main"]'
      );
      const contentLength = mainContent ? mainContent.innerHTML.length : 0;

      if (urlChanged || titleChanged || contentLength > 100) {
        debug(
          `✅ Navigation detected after ${attempts} seconds (${
            urlChanged ? "URL" : titleChanged ? "Title" : "Content"
          } changed)`
        );
        resolve(true);
        return;
      }

      if (attempts >= maxAttempts) {
        debug(`❌ Navigation timeout after ${maxAttempts} seconds`);
        resolve(false);
        return;
      }

      setTimeout(checkNavigation, 1000);
    };

    checkNavigation();
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
    // Focus the element
    button.focus();
    await new Promise((resolve) => setTimeout(resolve, 100));

    // Method 1: Mouse events
    button.dispatchEvent(
      new MouseEvent("mousedown", { bubbles: true, cancelable: true })
    );
    button.dispatchEvent(
      new MouseEvent("mouseup", { bubbles: true, cancelable: true })
    );
    button.click();

    // Method 2: Programmatic click after delay
    setTimeout(() => {
      if (window.location.href === window.location.href) {
        // Still on same page
        try {
          button.dispatchEvent(
            new Event("click", { bubbles: true, cancelable: true })
          );
        } catch (e) {
          debug("Programmatic click failed:", e);
        }

        // Method 3: href navigation if available
        if (button.href) {
          setTimeout(() => {
            if (window.location.href === window.location.href) {
              // Still on same page
              window.location.href = button.href;
            }
          }, 500);
        }
      }
    }, 1000);
  } catch (error) {
    debug("Error clicking next page button:", error);
    throw error;
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
          <strong>Current page:</strong> ${autoExtractState.currentPage} of ${autoExtractState.maxPages}
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
      ? GM_getValue("w2n_next_page_selector", "#zDocsContent > header > div.zDocsTopicActions > div.zDocsBundlePagination > div.zDocsNextTopicButton.zDocsNextTopicButton > span > a > svg > use")
      : "#zDocsContent > header > div.zDocsTopicActions > div.zDocsBundlePagination > div.zDocsNextTopicButton.zDocsNextTopicButton > span > a > svg > use";
  const maxPages =
    parseInt(document.getElementById("w2n-max-pages")?.value) || 500;

  let diagnosis = "AutoExtract Diagnosis:\n\n";
  diagnosis += `Max pages: ${maxPages}\n`;
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

  // Strategy 2: Look for common next page patterns
  const nextPagePatterns = [
    // Text-based matching
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
        if (isElementVisible(element)) {
          debug(`🔍 Found next page element with pattern: ${pattern}`);
          return element;
        }
      }
    } catch (e) {
      // Skip invalid selectors
    }
  }

  // Strategy 3: Look for elements with navigation-related attributes
  const navElements = document.querySelectorAll('button, a, [role="button"]');
  for (const element of navElements) {
    const text = element.textContent?.toLowerCase() || "";
    const ariaLabel = element.getAttribute("aria-label")?.toLowerCase() || "";
    const title = element.getAttribute("title")?.toLowerCase() || "";

    if (
      text.includes("next") ||
      text.includes("forward") ||
      text.includes(">") ||
      text.includes("→") ||
      ariaLabel.includes("next") ||
      ariaLabel.includes("forward") ||
      title.includes("next") ||
      title.includes("forward")
    ) {
      if (isElementVisible(element)) {
        debug(
          `🔍 Found next page element by text/attribute analysis: ${element.tagName}`
        );
        return element;
      }
    }
  }

  debug("❌ No next page element found with any strategy");
  return null;
}
