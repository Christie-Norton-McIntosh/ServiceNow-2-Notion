// Advanced Settings Modal - Configuration settings UI

import { debug, getConfig } from "../config.js";

/**
 * Inject the advanced settings modal into the DOM
 */
export function injectAdvancedSettingsModal() {
  if (document.getElementById("w2n-advanced-settings-modal")) return;

  const config = getConfig();

  const modal = document.createElement("div");
  modal.id = "w2n-advanced-settings-modal";
  modal.style.cssText = `
    position: fixed; inset: 0; display:flex; align-items:center; justify-content:center; z-index:11000;
    background: rgba(0,0,0,0.4);
  `;

  modal.innerHTML = `
    <div style="width:480px; max-width:95%; background:white; border-radius:8px; box-shadow:0 10px 30px rgba(0,0,0,0.2); overflow:hidden;">
      <div style="padding:16px 20px; border-bottom:1px solid #eee; display:flex; justify-content:space-between; align-items:center;">
        <strong>⚙️ Advanced Settings</strong>
        <button id="w2n-close-advanced-settings" style="background:none;border:none;font-size:18px;cursor:pointer">×</button>
      </div>
      <div style="padding:20px;">
        <div style="margin-bottom:16px;">
          <label style="display: flex; align-items: center; margin-bottom: 12px; font-size: 14px; cursor: pointer;">
            <input type="checkbox" id="w2n-modal-use-martian" ${
              config.useMartian ? "checked" : ""
            } style="margin-right: 10px; transform: scale(1.1);">
            <span style="flex:1;">Use Martian conversion</span>
          </label>
          <div style="font-size: 12px; color: #6b7280; margin-left: 24px; margin-top: -8px;">
            Enhanced content processing for better Notion formatting
          </div>
        </div>
        
        <div style="margin-bottom:16px;">
          <label style="display: flex; align-items: center; margin-bottom: 12px; font-size: 14px; cursor: pointer;">
            <input type="checkbox" id="w2n-modal-direct-images" ${
              config.directSDKImages ? "checked" : ""
            } style="margin-right: 10px; transform: scale(1.1);">
            <span style="flex:1;">Direct SDK image processing</span>
          </label>
          <div style="font-size: 12px; color: #6b7280; margin-left: 24px; margin-top: -8px;">
            Process images directly through Notion API (faster uploads)
          </div>
        </div>
        
        <div style="margin-bottom:16px;">
          <label style="display: flex; align-items: center; margin-bottom: 12px; font-size: 14px; cursor: pointer;">
            <input type="checkbox" id="w2n-modal-enable-debugging" style="margin-right: 10px; transform: scale(1.1);">
            <span style="flex:1;">Enable debugging (client & server)</span>
          </label>
          <div style="font-size: 12px; color: #6b7280; margin-left: 24px; margin-top: -8px;">
            Enable detailed logging in both client (console) and server (proxy logs)
          </div>
        </div>
        
  <div style="margin-bottom:20px;">
          <label style="display: flex; align-items: center; margin-bottom: 12px; font-size: 14px; cursor: pointer;">
            <input type="checkbox" id="w2n-modal-duplicate-detect" ${
              config.enableDuplicateDetection ? "checked" : ""
            } style="margin-right: 10px; transform: scale(1.1);">
            <span style="flex:1;">Search for duplicates</span>
          </label>
          <div style="font-size: 12px; color: #6b7280; margin-left: 24px; margin-top: -8px;">
            Check for existing pages with same title before creating new ones
          </div>
        </div>
        
        <div style="display:flex; gap:10px; padding-top:16px; border-top:1px solid #eee;">
          <button id="w2n-save-advanced-settings" style="flex:1;padding:10px;border-radius:6px;background:#10b981;color:white;border:none;cursor:pointer;font-size:14px;">
            Save Settings
          </button>
          <button id="w2n-cancel-advanced-settings" style="flex:1;padding:10px;border-radius:6px;background:#6b7280;color:white;border:none;cursor:pointer;font-size:14px;">
            Cancel
          </button>
        </div>
      </div>
    </div>
  `;

  document.body.appendChild(modal);
  setupAdvancedSettingsModal(modal);
}

/**
 * Setup the advanced settings modal with event listeners
 * @param {HTMLElement} modal - The modal element
 */
export function setupAdvancedSettingsModal(modal) {
  const closeBtn = modal.querySelector("#w2n-close-advanced-settings");
  const saveBtn = modal.querySelector("#w2n-save-advanced-settings");
  const cancelBtn = modal.querySelector("#w2n-cancel-advanced-settings");

  function closeModal() {
    if (modal.parentNode) {
      modal.parentNode.removeChild(modal);
    }
  }

  closeBtn.onclick = closeModal;
  cancelBtn.onclick = closeModal;

  // Click outside to close
  modal.onclick = (e) => {
    if (e.target === modal) {
      closeModal();
    }
  };

  // Populate combined debugging checkbox from both client and server settings
  (async () => {
    const combinedCheckbox = modal.querySelector("#w2n-modal-enable-debugging");
    if (!combinedCheckbox) return;
    const config = getConfig();
    let serverVerbose = false;
    try {
      const resp = await fetch("/api/logging");
      if (resp.ok) {
        const body = await resp.json();
        serverVerbose = !!(body && body.verbose);
        // Treat extraDebug as the indicator that a deep debug session is active
        if (body && typeof body.extraDebug !== "undefined") {
          combinedCheckbox.checked = !!body.extraDebug;
        }
      }
    } catch (e) {
      debug("Could not fetch /api/logging for combined checkbox:", e);
    }
    if (typeof combinedCheckbox.checked === "undefined") {
      combinedCheckbox.checked = config.debugMode && serverVerbose;
    }
    debug("Populated combined debugging checkbox:", combinedCheckbox.checked);
  })();

  saveBtn.onclick = () => {
    // Get values from modal checkboxes
    const useMartian = modal.querySelector("#w2n-modal-use-martian").checked;
    const directSDKImages = modal.querySelector(
      "#w2n-modal-direct-images"
    ).checked;
    const enableDuplicateDetection = modal.querySelector(
      "#w2n-modal-duplicate-detect"
    ).checked;

    // Combined debugging checkbox
    const enableDebugging = modal.querySelector(
      "#w2n-modal-enable-debugging"
    ).checked;

    // Update config
    const config = getConfig();
    config.useMartian = useMartian;
    config.directSDKImages = directSDKImages;
    config.debugMode = enableDebugging;
    config.enableDuplicateDetection = enableDuplicateDetection;

    // Save to storage
    try {
      if (typeof GM_setValue !== "undefined") {
        GM_setValue("notionConfig", config);
      }

      // Show toast notification
      if (typeof GM_notification !== "undefined") {
        GM_notification({
          text: "Settings saved successfully",
          title: "ServiceNow",
          timeout: 2000,
        });
      }

      debug("⚙️ Settings saved:", config);

      // Update visible UI immediately so user sees the selected database/name
      try {
        if (typeof window.updateUIFromConfig === "function") {
          window.updateUIFromConfig();
        }
      } catch (e) {
        debug("Failed updating UI after settings save:", e);
      }
      // Update server runtime logging setting
      (async () => {
        try {
          await fetch("/api/logging", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              verbose: !!enableDebugging,
              extraDebug: !!enableDebugging,
            }),
          });
          debug("Updated server logging flags:", enableDebugging);
        } catch (err) {
          debug("Failed to update server logging setting:", err);
        }
      })();
    } catch (error) {
      if (typeof GM_notification !== "undefined") {
        GM_notification({
          text: "Failed to save settings",
          title: "ServiceNow",
          timeout: 2000,
        });
      }
      debug("Failed to save settings:", error);
    }

    closeModal();
  };
}
