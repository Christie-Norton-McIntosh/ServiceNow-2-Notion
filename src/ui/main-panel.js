// Main floating panel (ported from original createUI())

import { debug, getConfig } from "../config.js";
import { showPropertyMappingModal } from "./property-mapping-modal.js";
import { injectAdvancedSettingsModal } from "./advanced-settings-modal.js";
import { injectIconCoverModal } from "./icon-cover-modal.js";
import { getAllDatabases, getDatabase } from "../api/database-api.js";
import { overlayModule } from "./overlay-progress.js";

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
          <div style="flex:1; min-width:180px;">
            <button id="w2n-select-next-element" style="width:100%; padding:6px; background:#2563eb; color:white; border:none; border-radius:4px; cursor:pointer; font-size:12px;">Select "Next Page" Element</button>
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

  // Create overlay message
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
  `;
  overlay.innerHTML = `
    <div>
      <div style="font-size: 24px; margin-bottom: 10px;">🎯</div>
      <div>Click on the "Next Page" element</div>
      <div style="font-size: 14px; margin-top: 10px; opacity: 0.8;">Press ESC to cancel</div>
    </div>
  `;
  document.body.appendChild(overlay);

  // Handle element selection
  const handleClick = (e) => {
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

  document.addEventListener("click", handleClick, true);
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
      ? GM_getValue("w2n_next_page_selector", "")
      : "";

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

  try {
    // Start the extraction process
    overlayModule.start("Starting multi-page extraction...");

    let pageCount = 0;
    let hasNextPage = true;

    while (pageCount < maxPages && hasNextPage) {
      pageCount++;
      const currentPageNum = pageCount;

      overlayModule.setMessage(`Extracting page ${currentPageNum} of ${maxPages}...`);
      overlayModule.setProgress((pageCount - 1) / maxPages * 100);

      try {
        // Extract current page data
        const extractedData = await app.extractCurrentPageData();

        // Process with proxy (save to Notion)
        await app.processWithProxy(extractedData);

        debug(`✅ Page ${currentPageNum} processed successfully`);

        // Check if we should continue (only if not the last page)
        if (pageCount < maxPages) {
          // Find and click next page button
          const nextButton = document.querySelector(nextPageSelector);
          if (!nextButton) {
            debug(`⚠️ Next page button not found with selector: ${nextPageSelector}`);
            hasNextPage = false;
            break;
          }

          // Check if button is disabled or not clickable
          if (nextButton.disabled || nextButton.getAttribute('aria-disabled') === 'true' ||
              nextButton.classList.contains('disabled') || !nextButton.offsetParent) {
            debug(`⚠️ Next page button is disabled or hidden`);
            hasNextPage = false;
            break;
          }

          overlayModule.setMessage(`Navigating to page ${currentPageNum + 1}...`);

          // Click the next button
          nextButton.click();

          // Wait for navigation to complete
          await waitForNavigation();

          // Small delay to ensure page is fully loaded
          await new Promise(resolve => setTimeout(resolve, 1000));
        }

      } catch (pageError) {
        debug(`❌ Failed to process page ${currentPageNum}:`, pageError);
        // Continue to next page or stop?
        // For now, let's stop on first error to be safe
        throw new Error(`Failed to process page ${currentPageNum}: ${pageError.message}`);
      }
    }

    // Complete successfully
    overlayModule.setProgress(100);
    overlayModule.done({
      success: true,
      autoCloseMs: 5000,
    });

    alert(`Auto-extraction completed! Processed ${pageCount} page${pageCount !== 1 ? 's' : ''}.`);

  } catch (error) {
    debug("❌ Auto-extraction failed:", error);
    overlayModule.error({
      message: `Auto-extraction failed: ${error.message}`,
    });
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

function diagnoseAutoExtraction() {
  const nextPageSelector =
    typeof GM_getValue === "function"
      ? GM_getValue("w2n_next_page_selector", "")
      : "";
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
