// Main floating panel (ported from original createUI())

import { debug, getConfig } from "../config.js";
import { showPropertyMappingModal } from "./property-mapping-modal.js";
import { injectAdvancedSettingsModal } from "./advanced-settings-modal.js";
import { injectIconCoverModal } from "./icon-cover-modal.js";
import { getAllDatabases } from "../api/database-api.js";

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
        const databases = await getAllDatabases({ forceRefresh: true });
        populateDatabaseSelect(databaseSelect, databases);
        debug(`✅ Refreshed ${databases.length} databases`);
      } catch (e) {
        debug("Failed to refresh databases:", e);
      }
    };
  }

  if (searchBtn) {
    searchBtn.onclick = async () => {
      try {
        const searchTerm = prompt("Enter database name or ID to search:");
        if (!searchTerm || searchTerm.trim() === "") return;

        debug(`🔍 Searching for database: ${searchTerm}`);
        
        // Query all databases fresh (no cache)
        const databases = await getAllDatabases({ forceRefresh: true });
        
        // Find matching database
        const matchingDb = databases.find(db => 
          db.id === searchTerm.trim() || 
          (db.title && db.title.some(t => t.plain_text && t.plain_text.toLowerCase().includes(searchTerm.toLowerCase())))
        );

        if (matchingDb) {
          // Update config with new database
          const config = getConfig();
          config.databaseId = matchingDb.id;
          config.databaseName = matchingDb.title ? matchingDb.title[0].plain_text : "Unknown Database";
          
          // Save to storage
          if (typeof GM_setValue === "function") {
            GM_setValue("notionConfig", config);
          }
          
          // Update UI
          databaseSelect.innerHTML = `<option value="${matchingDb.id}">${config.databaseName}</option>`;
          databaseLabel.textContent = `Database: ${config.databaseName}`;
          
          debug(`✅ Set target database to: ${config.databaseName} (${matchingDb.id})`);
        } else {
          alert(`Database "${searchTerm}" not found.`);
          debug(`❌ Database "${searchTerm}" not found`);
        }
      } catch (e) {
        debug("Failed to search database:", e);
        alert("Error searching for database. Check console for details.");
      }
    };
  }

  if (getByIdBtn) {
    getByIdBtn.onclick = async () => {
      try {
        const dbId = prompt("Enter database ID:");
        if (!dbId || dbId.trim() === "") return;

        debug(`🔍 Getting database by ID: ${dbId}`);
        
        // This would need to be implemented - perhaps call getDatabase with force refresh
        // For now, just set the config
        const config = getConfig();
        config.databaseId = dbId.trim();
        config.databaseName = "Database by ID";
        
        if (typeof GM_setValue === "function") {
          GM_setValue("notionConfig", config);
        }
        
        databaseSelect.innerHTML = `<option value="${dbId}">${config.databaseName}</option>`;
        databaseLabel.textContent = `Database: ${config.databaseName}`;
        
        debug(`✅ Set target database to ID: ${dbId}`);
      } catch (e) {
        debug("Failed to get database by ID:", e);
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
  
  databases.forEach(db => {
    const option = document.createElement("option");
    option.value = db.id;
    option.textContent = db.title && db.title[0] ? db.title[0].plain_text : "Untitled Database";
    selectEl.appendChild(option);
  });
}
