// ==UserScript==
// @name         ServiceNow-2-Notion
// @namespace    https://github.com/nortonglitz/ServiceNow-2-Notion
// @version      8.0.0
// @description  Extract ServiceNow content and send to Notion via Universal Workflow or proxy
// @author       Norton Glitz
// @match        https://*.service-now.com/*
// @match        https://*.servicenow.com/*
// @grant        GM_setValue
// @grant        GM_getValue
// @grant        GM_xmlhttpRequest
// @grant        GM_addStyle
// @grant        GM_getResourceText
// @grant        GM_notification
// @run-at       document-idle
// @downloadURL  https://github.com/nortonglitz/ServiceNow-2-Notion/raw/main/dist/ServiceNow-2-Notion.user.js
// @updateURL    https://github.com/nortonglitz/ServiceNow-2-Notion/raw/main/dist/ServiceNow-2-Notion.user.js
// @homepage     https://github.com/nortonglitz/ServiceNow-2-Notion
// @supportURL   https://github.com/nortonglitz/ServiceNow-2-Notion/issues
// @connect      localhost
// @connect      127.0.0.1
// ==/UserScript==

/* jshint esversion: 8 */
/* global GM_setValue, GM_getValue, GM_xmlhttpRequest, GM_addStyle, GM_getResourceText, GM_notification */

(function() {
    'use strict';
(function () {

  // Configuration constants and default settings

  // =============================================================================
  // PROVIDER CONSTANTS
  // =============================================================================

  const PROVIDER_VERSION = "8.0.0";
  const PROVIDER_NAME = "ServiceNow";

  // =============================================================================
  // DEFAULT BRANDING ASSETS
  // =============================================================================

  // Default ServiceNow branding assets
  const BRANDING = {
    primaryColor: "#0066cc",
    hoverColor: "#004499",
    dangerColor: "#dc3545",
    successColor: "#28a745",
    warningColor: "#ffc107",
  };

  // =============================================================================
  // DEFAULT CONFIGURATION
  // =============================================================================

  const defaultConfig = {
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
  // CUSTOM SELECTORS
  // =============================================================================

  // Custom selectors assigned interactively for specific properties
  const DEFAULT_CUSTOM_SELECTORS = {
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
  function getConfig() {
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
  function getCustomSelectors() {
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
  function debug(...args) {
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
  async function initializeConfig() {
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
  function migrateOldConfig() {
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

  // W2NSavingProgress overlay module - self-contained progress UI

  const ID_ROOT = "w2n-saving-progress";
  const PREFIX = "w2n-progress-";

  // Helper function to create DOM elements
  function createEl$1(tag, attrs = {}, content = "") {
    const el = document.createElement(tag);
    Object.entries(attrs).forEach(([key, value]) => {
      if (key === "class") el.className = value;
      else if (key === "style") el.style.cssText = value;
      else el.setAttribute(key, value);
    });
    if (content) el.textContent = content;
    return el;
  }

  // --- Internal state ---
  let state = {
    opened: false,
    onClose: null,
    retryCallback: null,
    autoCloseMs: null,
  };

  // Forward declaration for modal injection
  let injectPropertyMappingModal$1 = null;

  function setPropertyMappingModalInjector(injector) {
    injectPropertyMappingModal$1 = injector;
  }

  function createOverlay() {
    const overlay = createEl$1("div", {
      id: ID_ROOT,
      style:
        "position:fixed;inset:0;z-index:10000;background:rgba(0,0,0,0.5);display:flex;align-items:center;justify-content:center;",
    });

    const panel = createEl$1("div", {
      class: PREFIX + "panel",
      style:
        "background:white;border-radius:8px;padding:20px;min-width:400px;max-width:90vw;box-shadow:0 10px 30px rgba(0,0,0,0.3);",
      role: "dialog",
      "aria-labelledby": PREFIX + "title",
    });

    const preview = createEl$1("div", {
      class: PREFIX + "preview",
      "aria-hidden": "true",
      style:
        "display:flex;align-items:center;gap:10px;margin:10px 0;padding:10px;border:1px solid #e5e7eb;border-radius:6px;background:#f9fafb;min-height:60px;",
    });

    const title = createEl$1(
      "h2",
      { id: PREFIX + "title", class: PREFIX + "title" },
      "Saving to Notion…"
    );

    const message = createEl$1("div", {
      class: PREFIX + "message",
      "aria-live": "polite",
    });

    const spinner = createEl$1("div", {
      class: PREFIX + "spinner",
      "aria-hidden": "true",
    });

    const bar = createEl$1("div", {
      class: PREFIX + "bar",
      "aria-hidden": "true",
    });

    const barFill = createEl$1("div", { class: PREFIX + "bar-fill" });
    bar.appendChild(barFill);

    const steps = createEl$1("ul", {
      class: PREFIX + "steps",
      "aria-hidden": "true",
    });

    const actions = createEl$1("div", { class: PREFIX + "actions" });

    const viewLink = createEl$1(
      "a",
      {
        class: PREFIX + "view",
        target: "_blank",
        rel: "noopener noreferrer",
        href: "#",
        hidden: "true",
      },
      "View in Notion"
    );

    const retryBtn = createEl$1(
      "button",
      { class: PREFIX + "retry", type: "button", hidden: "true" },
      "Retry"
    );

    const closeBtn = createEl$1(
      "button",
      { class: PREFIX + "close", type: "button" },
      "Close"
    );

    const configBtn = createEl$1(
      "button",
      {
        class: PREFIX + "config",
        type: "button",
        style:
          "padding: 8px 12px; background: #3b82f6; color: white; border: none; border-radius: 4px; cursor: pointer; font-size: 12px; margin-left: 8px;",
      },
      "Configure Property Mapping"
    );

    actions.appendChild(viewLink);
    actions.appendChild(retryBtn);
    actions.appendChild(closeBtn);
    actions.appendChild(configBtn);

    try {
      if (typeof window !== "undefined" && window.debug)
        window.debug("createOverlay initialized", {
          hasConfigButton: !!configBtn,
          actionsCount: actions.children.length,
        });
    } catch (e) {}

    panel.appendChild(preview);
    panel.appendChild(title);
    panel.appendChild(message);
    panel.appendChild(spinner);
    panel.appendChild(bar);
    panel.appendChild(steps);
    panel.appendChild(actions);
    overlay.appendChild(panel);

    // event wiring
    closeBtn.addEventListener("click", () => overlayModule.close());
    retryBtn.addEventListener("click", () => overlayModule._invokeRetry());
    configBtn.addEventListener("click", () => {
      if (typeof window !== "undefined" && window.debug)
        window.debug("Configure Property Mapping button clicked");
      overlayModule.close();
      if (injectPropertyMappingModal$1) {
        injectPropertyMappingModal$1();
      }
    });

    document.documentElement.appendChild(overlay);
    return overlay;
  }

  const overlayModule = {
    // public API
    start(opts = {}) {
      const overlay = createOverlay();
      try {
        if (typeof window !== "undefined" && window.debug)
          window.debug("overlayModule.start", {
            hasConfig: !!overlay.querySelector("." + PREFIX + "config"),
          });
      } catch (e) {}
      state.opened = true;
      state.onClose = typeof opts.onClose === "function" ? opts.onClose : null;
      state.retryCallback = null;
      state.autoCloseMs = opts.autoCloseMs || null;

      const titleEl = overlay.querySelector("." + PREFIX + "title");
      const messageEl = overlay.querySelector("." + PREFIX + "message");
      const spinnerEl = overlay.querySelector("." + PREFIX + "spinner");
      const barEl = overlay.querySelector("." + PREFIX + "bar");
      const stepsEl = overlay.querySelector("." + PREFIX + "steps");
      const viewLink = overlay.querySelector("." + PREFIX + "view");
      const retryBtn = overlay.querySelector("." + PREFIX + "retry");

      // reset UI
      viewLink.hidden = true;
      viewLink.removeAttribute("href");
      retryBtn.hidden = true;
      spinnerEl.style.display = "";
      barEl.style.display = "none";
      stepsEl.style.display = "none";

      titleEl.textContent = opts.title || "Saving to Notion…";
      messageEl.textContent = opts.message || "";

      // preview
      if (opts.preview) overlayModule.setPreview(opts.preview);

      overlay.style.display = "flex";
      // accessibility focus
      setTimeout(() => {
        const btn = overlay.querySelector("button");
        if (btn) btn.focus();
      }, 80);
      return overlayModule;
    },

    setMessage(text) {
      const overlay = document.getElementById(ID_ROOT);
      if (!overlay) return;
      const msg = overlay.querySelector("." + PREFIX + "message");
      if (msg) msg.textContent = text || "";
    },

    setStep(text) {
      const overlay = document.getElementById(ID_ROOT);
      if (!overlay) return;
      const stepsEl = overlay.querySelector("." + PREFIX + "steps");
      if (!stepsEl) return;
      stepsEl.style.display = "";
      const li = createEl$1("li", {}, text);
      stepsEl.appendChild(li);
      // keep scroll at bottom
      stepsEl.scrollTop = stepsEl.scrollHeight;
    },

    setProgress(percent) {
      const overlay = document.getElementById(ID_ROOT);
      if (!overlay) return;
      const spinnerEl = overlay.querySelector("." + PREFIX + "spinner");
      const barEl = overlay.querySelector("." + PREFIX + "bar");
      const fill = overlay.querySelector("." + PREFIX + "bar-fill");
      if (!fill) return;
      const p = Math.max(0, Math.min(100, Number(percent) || 0));
      spinnerEl.style.display = "none";
      barEl.style.display = "";
      fill.style.width = p + "%";
    },

    setPreview({ icon, cover } = {}) {
      const existingOverlay = document.getElementById(ID_ROOT);
      const overlay = existingOverlay || createOverlay();
      try {
        if (typeof window !== "undefined" && window.debug)
          window.debug("setPreview", {
            existingOverlay: !!existingOverlay,
            hasConfig: !!overlay.querySelector("." + PREFIX + "config"),
          });
      } catch (e) {}
      const preview = overlay.querySelector("." + PREFIX + "preview");
      preview.innerHTML = "";
      if (icon) {
        const ico = createEl$1(
          "div",
          {
            class: PREFIX + "icon",
            style:
              "font-size:32px;width:40px;height:40px;display:flex;align-items:center;justify-content:center;flex-shrink:0;",
          },
          icon
        );
        preview.appendChild(ico);
      }
      if (cover) {
        try {
          const img = createEl$1("img", {
            src: cover,
            alt: "cover preview",
            style:
              "width:80px;height:60px;object-fit:cover;border-radius:4px;flex-shrink:0;",
          });
          preview.appendChild(img);
        } catch (e) {
          // Failed to load cover preview - silently ignore
        }
      }
    },

    done({ success = true, pageUrl = null, autoCloseMs = null } = {}) {
      const overlay = document.getElementById(ID_ROOT);
      if (!overlay) return;
      const spinnerEl = overlay.querySelector("." + PREFIX + "spinner");
      const barEl = overlay.querySelector("." + PREFIX + "bar");
      const stepsEl = overlay.querySelector("." + PREFIX + "steps");
      const viewLink = overlay.querySelector("." + PREFIX + "view");

      // hide progress elements
      spinnerEl.style.display = "none";
      barEl.style.display = "none";
      if (stepsEl) stepsEl.style.display = "none";

      // show success check
      let check = overlay.querySelector("." + PREFIX + "success-check");
      if (!check) {
        check = createEl$1("div", { class: PREFIX + "success-check" }, "✓");
        const panel = overlay.querySelector("." + PREFIX + "panel");
        panel.insertBefore(
          check,
          panel.querySelector("." + PREFIX + "message").nextSibling
        );
      }

      if (pageUrl) {
        viewLink.hidden = false;
        viewLink.href = pageUrl;
        viewLink.textContent = "View in Notion";
      }

      // optionally auto-close
      const closeMs = autoCloseMs || state.autoCloseMs;
      if (closeMs && Number(closeMs) > 0) {
        setTimeout(() => overlayModule.close(), Number(closeMs));
      }
    },

    error({ message = "An error occurred", retryCallback = null } = {}) {
      const overlay = document.getElementById(ID_ROOT);
      if (!overlay) return;
      const msg = overlay.querySelector("." + PREFIX + "message");
      if (msg) msg.textContent = message || "";
      const retryBtn = overlay.querySelector("." + PREFIX + "retry");
      if (typeof retryCallback === "function") {
        retryBtn.hidden = false;
        state.retryCallback = retryCallback;
      } else {
        retryBtn.hidden = true;
        state.retryCallback = null;
      }
    },

    close() {
      const overlay = document.getElementById(ID_ROOT);
      if (!overlay) return;
      overlay.remove();
      state.opened = false;
      if (typeof state.onClose === "function") {
        try {
          state.onClose();
        } catch (e) {
          try {
            if (typeof window !== "undefined" && window.debug)
              window.debug("W2NSavingProgress onClose handler threw", e);
          } catch (err) {}
        }
      }
    },

    // internal: invoked by retry button
    _invokeRetry() {
      if (typeof state.retryCallback === "function") {
        try {
          state.retryCallback();
        } catch (e) {
          try {
            if (typeof window !== "undefined" && window.debug)
              window.debug("W2NSavingProgress retry callback error", e);
          } catch (err) {}
        }
      }
    },
  };

  // Advanced Settings Modal - Configuration settings UI


  /**
   * Inject the advanced settings modal into the DOM
   */
  function injectAdvancedSettingsModal() {
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
  function setupAdvancedSettingsModal(modal) {
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
          serverVerbose = body && body.verbose;
        }
      } catch (e) {
        debug("Could not fetch /api/logging for combined checkbox:", e);
      }
      combinedCheckbox.checked = config.debugMode && serverVerbose;
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
              body: JSON.stringify({ verbose: !!enableDebugging }),
            });
            debug("Updated server verbose logging:", enableDebugging);
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

  // Proxy API Communication - Direct communication with M2N proxy server


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
  async function apiCall(method, endpoint, data = null) {
    return new Promise((resolve, reject) => {
      const config = getConfig();
      const url = config.proxyUrl + endpoint;

      if (typeof GM_xmlhttpRequest === "undefined") {
        // Fallback to fetch if GM_xmlhttpRequest is not available
        fallbackFetchCall(method, url, data).then(resolve).catch(reject);
        return;
      }

      GM_xmlhttpRequest({
        method: method,
        url: url,
        headers: {
          "Content-Type": "application/json",
        },
        data: data ? JSON.stringify(data) : undefined,
        onload: function (response) {
          try {
            const result = JSON.parse(response.responseText);
            resolve(result);
          } catch (e) {
            debug("❌ Failed to parse API response:", response.responseText);
            resolve({ success: false, error: "Invalid API response" });
          }
        },
        onerror: function (error) {
          debug("❌ API call failed:", error);
          reject(new Error(`API call failed: ${error.error || "Network error"}`));
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
  async function fetchDatabaseSchema(databaseId) {
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
   * Search for Unsplash images via proxy
   * @param {string} query - Search query
   * @param {Object} options - Search options
   * @returns {Promise<Object>} Unsplash search results
   */
  async function searchUnsplashImages(query, options = {}) {
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
  async function getDefaultUnsplashImages() {
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
   * Check proxy server health and availability
   * @returns {Promise<Object>} Health check result
   */
  async function checkProxyHealth() {
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
   * Send processed content to proxy for final Notion upload
   * @param {Object} processedData - Processed content data
   * @returns {Promise<Object>} Upload result
   */
  async function sendProcessedContentToProxy(processedData) {
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

  // Icon and Cover Selection Modal - Image selection UI


  // Shared Unsplash keyword list
  const UNSPLASH_KEYWORDS = [
    "abstract",
    "geometric",
    "background",
    "pattern",
    "gradient",
    "texture",
  ];

  /**
   * Inject the icon and cover selection modal
   */
  function injectIconCoverModal() {
    if (document.getElementById("w2n-icon-cover-modal")) return;

    const modal = document.createElement("div");
    modal.id = "w2n-icon-cover-modal";
    modal.style.cssText = `
    position: fixed; inset: 0; display:flex; align-items:center; justify-content:center; z-index:11000;
    background: rgba(0,0,0,0.4);
  `;

    modal.innerHTML = `
    <div style="width:980px; max-width:95%; background:white; border-radius:8px; box-shadow:0 10px 30px rgba(0,0,0,0.2); overflow:hidden;">
      <div style="padding:12px 16px; border-bottom:1px solid #eee; display:flex; justify-content:space-between; align-items:center;">
        <strong>Icon & Cover Selector</strong>
        <button id="w2n-close-icon-cover" style="background:none;border:none;font-size:18px;cursor:pointer">×</button>
      </div>
      <div style="display:flex; gap:12px; padding:12px;">
        <div style="flex:1 1 60%; min-width:540px;">
          <div id="w2n-selector-tabs" style="display:flex; gap:8px; margin-bottom:10px;">
            <button id="w2n-tab-icons" style="padding:8px 10px; border-radius:6px; border:1px solid #e5e7eb; background:#f3f4f6; cursor:pointer;">Icons</button>
            <button id="w2n-tab-covers" style="padding:8px 10px; border-radius:6px; border:1px solid #e5e7eb; background:white; cursor:pointer;">Covers</button>
          </div>

          <div id="w2n-selector-content">
            <div id="w2n-icons-panel">
                <label style="font-size:12px; color:#444">Search Emoji</label>
                <div id="w2n-emoji-results" style="display:block; gap:6px; max-height:220px; overflow:auto; padding:8px; margin-top:8px; border:1px solid #f1f1f1; border-radius:6px; background:#fbfbfb;"></div>
                <div style="margin-top:8px;font-size:12px;color:#666;">Or upload an icon image:</div>
                <input type="file" id="w2n-icon-upload" accept="image/*" style="margin-top:6px;" />
              </div>

            <div id="w2n-covers-panel" style="display:none;">
              <label style="font-size:12px; color:#444">Search Unsplash</label>
              <div style="display:flex; gap:8px; margin-top:6px;">
                <input id="w2n-unsplash-input" placeholder="nature, abstract, pattern" style="flex:1;padding:8px;border:1px solid #ddd;border-radius:6px;">
                <button id="w2n-unsplash-search-btn" style="padding:8px 10px;border-radius:6px;background:#3b82f6;color:white;border:none;">Search</button>
              </div>
              <div id="w2n-unsplash-cats" style="margin-top:10px; display:flex; gap:6px; flex-wrap:wrap;"></div>
              <div id="w2n-unsplash-results" style="margin-top:12px; display:grid; grid-template-columns: repeat(auto-fit, minmax(120px, 1fr)); gap:8px; max-height:420px; overflow:auto; padding:4px;"></div>
              <div style="margin-top:8px;font-size:12px;color:#666;">Or upload a cover image:</div>
              <input type="file" id="w2n-cover-upload" accept="image/*" style="margin-top:6px;" />
            </div>
          </div>
        </div>
        <div style="width:360px; flex-shrink:0;">
          <label style="font-size:12px; color:#444">Preview</label>
          <div id="w2n-icon-preview" style="height:120px; margin-top:8px; border:1px solid #eee; border-radius:6px; display:flex; align-items:center; justify-content:center; font-size:40px;"></div>
          <label style="font-size:12px; color:#444; margin-top:8px; display:block;">Selected cover</label>
          <div id="w2n-cover-preview" style="height:140px; margin-top:8px; border:1px solid #eee; border-radius:6px; background-size:cover; background-position:center;"></div>
          <div style="margin-top:10px; display:flex; gap:8px;">
            <button id="w2n-save-icon-cover" style="flex:1;padding:8px;border-radius:6px;background:#10b981;color:white;border:none;">Save</button>
            <button id="w2n-reset-icon-cover" style="flex:1;padding:8px;border-radius:6px;background:#f59e0b;color:white;border:none;">Reset to Defaults</button>
            <button id="w2n-cancel-icon-cover" style="flex:1;padding:8px;border-radius:6px;background:#6b7280;color:white;border:none;">Cancel</button>
          </div>
        </div>
      </div>
    </div>
  `;

    document.body.appendChild(modal);
    setupIconCoverModal(modal);
  }

  /**
   * Setup the icon and cover modal with all functionality
   * @param {HTMLElement} modal - The modal element
   */
  function setupIconCoverModal(modal) {
    const close = modal.querySelector("#w2n-close-icon-cover");
    const cancel = modal.querySelector("#w2n-cancel-icon-cover");
    const saveBtn = modal.querySelector("#w2n-save-icon-cover");
    const resetBtn = modal.querySelector("#w2n-reset-icon-cover");
    const results = modal.querySelector("#w2n-unsplash-results");
    const input = modal.querySelector("#w2n-unsplash-input");
    const previewCover = modal.querySelector("#w2n-cover-preview");
    const previewIcon = modal.querySelector("#w2n-icon-preview");

    let selectedCoverUrl = null;
    let selectedIconEmoji = null;
    let selectedIconFileData = null;
    let selectedCoverFileData = null;

    // Populate compact modal category buttons from shared keywords
    const catsContainer = modal.querySelector("#w2n-unsplash-cats");
    if (catsContainer) {
      UNSPLASH_KEYWORDS.forEach((term) => {
        const btn = document.createElement("button");
        btn.className = "w2n-unsplash-cat";
        btn.dataset.term = term;
        btn.textContent = term;
        btn.style.cssText =
          "padding:6px;border:1px solid #e5e7eb;border-radius:6px;background:#f9fafb;cursor:pointer;";
        btn.onclick = () => runUnsplashSearch && runUnsplashSearch(term);
        catsContainer.appendChild(btn);
      });
    }

    // Basic emoji list for fallback
    function renderEmojiPicker() {
      const container = modal.querySelector("#w2n-emoji-results");
      container.innerHTML = "";
      const emojis = [
        "📝",
        "📄",
        "📋",
        "📊",
        "🚀",
        "💡",
        "🔧",
        "⚙️",
        "📁",
        "🎯",
        "✅",
        "❌",
        "⭐",
        "🔥",
        "💎",
        "🎨",
        "🔍",
        "📌",
      ];

      emojis.forEach((emoji) => {
        const b = document.createElement("button");
        b.type = "button";
        b.textContent = emoji;
        b.style.cssText =
          "padding:6px;border-radius:6px;border:1px solid #eee;background:white;cursor:pointer;font-size:18px;";
        b.onclick = () => {
          selectedIconEmoji = emoji;
          previewIcon.textContent = emoji;
          selectedIconFileData = null; // Clear file selection
          previewIcon.style.backgroundImage = ""; // Clear background image
        };
        container.appendChild(b);
      });
    }

    renderEmojiPicker();

    // File upload handling for icon
    const iconUpload = modal.querySelector("#w2n-icon-upload");
    if (iconUpload) {
      iconUpload.onchange = (e) => {
        const file = e.target.files[0];
        if (file) {
          handleIconFileUpload(file);
        }
      };
    }

    // File upload handling for cover
    const coverUpload = modal.querySelector("#w2n-cover-upload");
    if (coverUpload) {
      coverUpload.onchange = (e) => {
        const file = e.target.files[0];
        if (file) {
          handleCoverFileUpload(file);
        }
      };
    }

    function handleIconFileUpload(file) {
      if (!file.type.startsWith("image/")) {
        showToast("Please select an image file for icon", 3000);
        return;
      }

      // Convert file to data URL for proxy server compatibility
      const reader = new FileReader();
      reader.onload = function (e) {
        const dataUrl = e.target.result;

        // Store file data for later use
        selectedIconFileData = {
          type: "file_upload",
          url: dataUrl, // Use data URL instead of blob URL
          name: file.name,
          size: file.size,
          mimeType: file.type,
        };

        selectedIconEmoji = null; // Clear emoji selection when file is uploaded

        // Update preview with uploaded image
        previewIcon.style.backgroundImage = `url("${dataUrl}")`;
        previewIcon.style.backgroundSize = "cover";
        previewIcon.style.backgroundPosition = "center";
        previewIcon.textContent = ""; // Clear emoji text

        debug("📁 Icon file uploaded and converted to data URL:", {
          name: file.name,
          size: file.size,
          type: file.type,
          dataUrlLength: dataUrl.length,
        });

        showToast(`Icon file "${file.name}" loaded`, 2000);
      };

      reader.onerror = function () {
        showToast("Failed to read icon file", 3000);
        debug("❌ Error reading icon file:", reader.error);
      };

      reader.readAsDataURL(file);
    }

    function handleCoverFileUpload(file) {
      if (!file.type.startsWith("image/")) {
        showToast("Please select an image file for cover", 3000);
        return;
      }

      // Convert file to data URL for proxy server compatibility
      const reader = new FileReader();
      reader.onload = function (e) {
        const dataUrl = e.target.result;

        // Store file data for later use
        selectedCoverFileData = {
          type: "file_upload",
          url: dataUrl, // Use data URL instead of blob URL
          name: file.name,
          size: file.size,
          mimeType: file.type,
        };

        selectedCoverUrl = null; // Clear Unsplash selection when file is uploaded

        // Update preview with uploaded image
        previewCover.style.backgroundImage = `url("${dataUrl}")`;
        previewCover.style.backgroundSize = "cover";
        previewCover.style.backgroundPosition = "center";

        debug("🖼️ Cover file uploaded and converted to data URL:", {
          name: file.name,
          size: file.size,
          type: file.type,
          dataUrlLength: dataUrl.length,
        });

        showToast(`Cover file "${file.name}" loaded`, 2000);
      };

      reader.onerror = function () {
        showToast("Failed to read cover file", 3000);
        debug("❌ Error reading cover file:", reader.error);
      };

      reader.readAsDataURL(file);
    }

    function showToast(message, duration = 3000) {
      if (typeof GM_notification !== "undefined") {
        GM_notification({
          text: message,
          title: "ServiceNow",
          timeout: duration,
        });
      } else {
        debug(`[Toast] ${message}`);
      }
    }

    close.onclick = () => {
      modal.remove();
    };

    cancel.onclick = () => {
      modal.remove();
    };

    // Tab switching
    const tabIcons = modal.querySelector("#w2n-tab-icons");
    const tabCovers = modal.querySelector("#w2n-tab-covers");
    const iconsPanel = modal.querySelector("#w2n-icons-panel");
    const coversPanel = modal.querySelector("#w2n-covers-panel");

    function setActiveTab(tab) {
      if (tab === "icons") {
        iconsPanel.style.display = "block";
        coversPanel.style.display = "none";
        tabIcons.style.background = "#f3f4f6";
        tabCovers.style.background = "white";
      } else {
        iconsPanel.style.display = "none";
        coversPanel.style.display = "block";
        tabIcons.style.background = "white";
        tabCovers.style.background = "#f3f4f6";
      }
    }

    tabIcons.onclick = () => setActiveTab("icons");
    tabCovers.onclick = () => setActiveTab("covers");
    setActiveTab("icons");

    // Unsplash functionality
    modal.querySelectorAll(".w2n-unsplash-cat").forEach((b) => {
      b.onclick = () => {
        const term = b.dataset.term;
        input.value = term;
        runUnsplashSearch(term);
      };
    });

    modal.querySelector("#w2n-unsplash-search-btn").onclick = () => {
      runUnsplashSearch(input.value);
    };

    async function runUnsplashSearch(q) {
      debug(`🔍 Running Unsplash search for: "${q}"`);
      results.innerHTML =
        '<div style="grid-column:1/-1;padding:18px;color:#666;text-align:center;">Searching...</div>';
      try {
        // Use imported API function
        const res = await searchUnsplashImages(q);
        debug(`🔍 Unsplash search response:`, res);

        if (!res || !res.success) {
          debug(`❌ API response indicates failure:`, res);
          results.innerHTML =
            '<div style="grid-column:1/-1;padding:18px;color:#666;text-align:center;">API returned error</div>';
          return;
        }

        const photos = res?.photos || res?.images || [];
        debug(`🔍 Found ${photos.length} photos`);

        if (photos.length === 0) {
          results.innerHTML =
            '<div style="grid-column:1/-1;padding:18px;color:#666;text-align:center;">No images found for this search</div>';
          return;
        }

        displayUnsplashImages(photos);
      } catch (e) {
        debug(`❌ Unsplash search error:`, e);
        results.innerHTML =
          '<div style="grid-column:1/-1;padding:18px;color:#666;text-align:center;">Search failed: ' +
          (e.message || "Unknown error") +
          "</div>";
      }
    }

    function displayUnsplashImages(images) {
      debug(`🖼️ Displaying ${images?.length || 0} Unsplash images`);
      results.innerHTML = "";
      if (!images || images.length === 0) {
        debug(`❌ No images to display`);
        results.innerHTML =
          '<div style="grid-column:1/-1;padding:18px;color:#666;text-align:center;">No images</div>';
        return;
      }

      images.forEach((img, index) => {
        const url =
          img.url ||
          img.full ||
          img.urls?.regular ||
          img.urls?.full ||
          img.src ||
          img.thumb ||
          "";
        const thumb =
          img.thumb ||
          img.urls?.thumb ||
          (url ? `${url}&w=300&h=200&fit=crop` : "");
        debug(
          `🖼️ Image ${index + 1}: url=${url?.substring(
          0,
          50
        )}..., thumb=${thumb?.substring(0, 50)}...`
        );

        const el = document.createElement("div");
        el.style.cssText = `width:100%; aspect-ratio:16/9; border-radius:6px; background-image:url("${thumb}"); background-size:cover; background-position:center; cursor:pointer;`;
        el.title = img.alt_description || img.alt || "";
        el.onclick = () => {
          selectedCoverUrl = url;
          selectedCoverFileData = null; // Clear file selection
          previewCover.style.backgroundImage = `url("${url}")`;
          debug(`🖼️ Selected cover: ${url?.substring(0, 50)}...`);
        };
        results.appendChild(el);
      });
    }

    // Save functionality
    saveBtn.onclick = () => {
      const iconData =
        selectedIconFileData ||
        (selectedIconEmoji ? { type: "emoji", emoji: selectedIconEmoji } : null);
      const coverData =
        selectedCoverFileData ||
        (selectedCoverUrl ? { type: "url", url: selectedCoverUrl } : null);

      // Trigger save callback if provided
      if (modal.onSave && typeof modal.onSave === "function") {
        modal.onSave({ icon: iconData, cover: coverData });
      }

      modal.remove();
    };

    // Reset functionality
    resetBtn.onclick = () => {
      selectedCoverUrl = null;
      selectedIconEmoji = null;
      selectedIconFileData = null;
      selectedCoverFileData = null;

      previewIcon.textContent = "";
      previewIcon.style.backgroundImage = "";
      previewCover.style.backgroundImage = "";

      showToast("Selection reset", 1500);
    };

    // Load default images
    (async () => {
      debug(`🖼️ Loading default Unsplash images...`);
      results.innerHTML =
        '<div style="grid-column:1/-1;padding:18px;color:#666;text-align:center;">Loading defaults...</div>';
      try {
        const res = await getDefaultUnsplashImages();
        debug(`🖼️ Default images response:`, res);
        const photos = res?.photos || res?.images || [];
        debug(`🖼️ Found ${photos.length} default photos`);
        displayUnsplashImages(photos);
      } catch (e) {
        debug(`❌ Default images error:`, e);
        results.innerHTML =
          '<div style="grid-column:1/-1;padding:18px;color:#666;text-align:center;">No default images available</div>';
      }
    })();

    // Expose modal functionality
    modal.getSelections = () => ({
      icon:
        selectedIconFileData ||
        (selectedIconEmoji ? { type: "emoji", emoji: selectedIconEmoji } : null),
      cover:
        selectedCoverFileData ||
        (selectedCoverUrl ? { type: "url", url: selectedCoverUrl } : null),
    });
  }

  // Database API - Notion database operations and property mapping


  /**
   * Fetch database from cache or API
   * @param {string} databaseId - The database ID to fetch
   * @returns {Promise<Object>} Database object
   */
  async function getDatabase(databaseId) {
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
  function clearDatabaseCache(databaseId) {
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
  async function refreshDatabase(databaseId) {
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
   * Get property mappings for a database
   * @param {string} databaseId - Database ID
   * @returns {Promise<Object>} Property mappings
   */
  async function getPropertyMappings(databaseId) {
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
   * Apply property mappings to extracted data
   * @param {Object} extractedData - Data extracted from the page
   * @param {Object} database - Database schema
   * @param {Object} mappings - Property mappings
   * @returns {Object} Mapped properties for Notion page
   */
  function applyPropertyMappings(extractedData, database, mappings) {
    debug("🔧 Applying property mappings");

    const properties = {};
    const dbProperties = database.properties || {};

    // Apply each mapping
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

    debug(`✅ Applied ${Object.keys(properties).length} property mappings`);
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

  // Property Mapping Modal - Dynamic property mapping system


  /**
   * Inject the property mapping modal into the DOM
   */
  function injectPropertyMappingModal() {
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
  function setupPropertyMappingModal(modal) {
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
  function populatePropertyMappings(properties, mappings) {
    debug("Populating property mappings with properties:", properties);
    const contentProperties = [
      {
        key: "title",
        label: "Page Title",
        description: "The main title of the captured page",
      },
      {
        key: "url",
        label: "Page URL",
        description: "The URL of the captured page",
      },
      {
        key: "source",
        label: "Content Source",
        description: 'The source platform (e.g., "ServiceNow")',
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
        key: "CurrentReleaseURL",
        label: "Current Release URL",
        description: "The latest version URL or permanent link to the content",
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
        mappings[content.key] || "";
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
  function savePropertyMappings(databaseId, mappings) {
    const key = `w2n_property_mappings_${databaseId}`;
    if (typeof GM_setValue !== "undefined") {
      GM_setValue(key, JSON.stringify(mappings));
    }
    debug(`Property mappings saved for database ${databaseId}:`, mappings);
  }

  function loadPropertyMappings(databaseId) {
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

  function resetPropertyMappings(databaseId) {
    const key = `w2n_property_mappings_${databaseId}`;
    if (typeof GM_setValue !== "undefined") {
      GM_setValue(key, "{}");
    }
    debug(`Property mappings reset for database ${databaseId}`);
  }

  function showPropertyMappingModal() {
    debug("🔗 Opening property mapping modal");
    injectPropertyMappingModal();
    const modal = document.getElementById("w2n-property-mapping-modal");
    const config = getConfig();
    if (modal && modal.loadDatabaseMappings) {
      modal.loadDatabaseMappings(config.databaseId, config.databaseName);
    }
  }

  // Main floating panel (ported from original createUI())


  function injectMainPanel() {
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

  function setupMainPanel(panel) {
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

  // UI Utilities and Common Functions


  /**
   * Show a toast notification to the user
   * @param {string} message - Message to display
   * @param {number} duration - Duration in milliseconds
   */
  function showToast(message, duration = 3000) {
    if (typeof GM_notification !== "undefined") {
      GM_notification({
        text: message,
        title: PROVIDER_NAME,
        timeout: duration,
      });
    } else {
      // fallback to debug so it respects debugMode
      try {
        if (typeof debug === "function") debug(`[${PROVIDER_NAME}] ${message}`);
        else console.info(`[${PROVIDER_NAME}] ${message}`);
      } catch (e) {
        console.info(`[${PROVIDER_NAME}] ${message}`);
      }
    }
  }

  /**
   * Show success panel with result information
   * @param {Object} result - Result object with pageUrl
   */
  function showSuccessPanel(result) {
    const message = result?.pageUrl
      ? `✅ Content saved to Notion!\n\nPage: ${result.pageUrl}`
      : "✅ Content saved to Notion!";
    showToast(message, 5000);

    // Removed auto-opening of Notion tabs to prevent browser clutter
    // Users can manually visit the page if needed from the success message
  }

  /**
   * Show error panel with error message
   * @param {string|Error} error - Error message or error object
   */
  function showErrorPanel(error) {
    const message = `❌ Error: ${error || "Unknown error occurred"}`;
    showToast(message, 5000);
  }

  /**
   * Create DOM element with attributes and content
   * @param {string} tag - HTML tag name
   * @param {Object} attrs - Attributes object
   * @param {string} content - Text content
   * @returns {HTMLElement} Created element
   */
  function createEl(tag, attrs = {}, content = "") {
    const el = document.createElement(tag);
    Object.entries(attrs).forEach(([key, value]) => {
      if (key === "class") el.className = value;
      else if (key === "style") el.style.cssText = value;
      else el.setAttribute(key, value);
    });
    if (content) el.textContent = content;
    return el;
  }

  // ServiceNow Metadata Extraction Module


  // ServiceNow-specific selectors for metadata extraction
  const SERVICENOW_SELECTORS = {
    title: [
      "h1",
      ".title",
      "#zDocsContent > header > h1",
      ".page-title",
      ".article-title",
    ],
    version: [
      "[class*='version']",
      ".version-info",
      "#zDocsContent > header > ul > li.zDocsTopicPageCluster > div > div > button > div > div > div",
    ],
    updated: [
      "[class*='updated'], [class*='date']",
      ".last-updated",
      "#zDocsContent > header > ul > li.zDocsTopicPageDate.css-cinqea > span",
    ],
    breadcrumb: [
      ".breadcrumb, [class*='breadcrumb']",
      "nav[aria-label='breadcrumb']",
      "#zDocsTopicPage > div.zDocsTopicPageTopicContainer > div.zDocsTopicPageBreadcrumbsContainer > div",
    ],
    author: ["[class*='author']", ".byline", ".created-by", ".author-name"],
    kbNumber: [
      "[class*='kb'], [class*='number']",
      ".kb-number",
      ".article-number",
    ],
    category: [
      "[class*='category']",
      ".category",
      "#zDocsTopicPage > div.zDocsTopicPageTopicContainer > div.zDocsTopicPageBreadcrumbsContainer > div > span:nth-child(3) > a",
    ],
    section: [
      "[class*='section']",
      ".section",
      "#zDocsTopicPage > div.zDocsTopicPageTopicContainer > div.zDocsTopicPageBreadcrumbsContainer > div > span:nth-child(4) > a",
    ],
    status: ["[class*='status']", ".status", ".article-status"],
    department: [
      "[class*='department'], [class*='team']",
      ".department",
      ".team",
    ],
  };

  /**
   * Helper to return the first non-empty match for a list of selectors
   * @param {string[]} selectors - Array of CSS selectors
   * @returns {string} First matched text content
   */
  function firstMatchText(selectors = []) {
    for (const sel of selectors) {
      try {
        const el = document.querySelector(sel);
        if (el && el.textContent && el.textContent.trim()) {
          return el.textContent.trim();
        }
      } catch (e) {
        // ignore invalid selectors
      }
    }
    return "";
  }

  /**
   * Get value using custom selector first, then fallback selectors
   * @param {string} propName - Property name
   * @param {string|string[]} fallbackSelectors - Fallback selectors
   * @returns {string} Extracted value
   */
  function getPrefixedMatch(propName, fallbackSelectors) {
    const customSelectors = getCustomSelectors();

    let val = "";
    try {
      if (customSelectors && customSelectors[propName]) {
        val = firstMatchText([customSelectors[propName]]) || "";
      }
    } catch (e) {
      // ignore invalid custom selector
    }
    if (val) return val;

    // fallbackSelectors may be a single selector array or a nested array
    return Array.isArray(fallbackSelectors)
      ? firstMatchText(fallbackSelectors)
      : firstMatchText([fallbackSelectors]);
  }

  /**
   * Extract comprehensive metadata from the ServiceNow page using specific CSS selectors
   * @returns {Object} Extracted metadata object
   */
  function extractServiceNowMetadata() {
    debug("🔍 Extracting ServiceNow metadata...");

    const metadata = { capturedAt: new Date().toISOString() };

    // Default source for ServiceNow captures
    try {
      metadata.source = "ServiceNow Technical Documentation";
    } catch (e) {
      // ignore
    }

    try {
      // Extract basic metadata fields
      const titleText = getPrefixedMatch("title", SERVICENOW_SELECTORS.title);
      const versionText = getPrefixedMatch(
        "version",
        SERVICENOW_SELECTORS.version
      );
      const updatedText = getPrefixedMatch(
        "updated",
        SERVICENOW_SELECTORS.updated
      );

      // Breadcrumb: prefer custom selector; if an element found, extract anchor texts and join with ' > '
      let breadcrumbText = "";
      try {
        const customSelectors = getCustomSelectors();
        const breadcrumbSelector =
          (customSelectors && customSelectors.breadcrumb) ||
          SERVICENOW_SELECTORS.breadcrumb[0];
        const breadcrumbEl = document.querySelector(breadcrumbSelector);

        if (breadcrumbEl) {
          const normalizeSegment = (s) => {
            if (!s) return "";
            // remove screen-reader markers like 'Current page'
            s = s.replace(/\bCurrent page\b/gi, "").trim();
            // remove the word Home entirely
            s = s.replace(/\bHome\b/gi, "").trim();
            // collapse whitespace and trim separators
            s = s.replace(/\s{2,}/g, " ").replace(/^[>\-–\s]+|[>\-–\s]+$/g, "");
            return s;
          };

          const anchors = Array.from(breadcrumbEl.querySelectorAll("a"))
            .map((a) => normalizeSegment(a.textContent || ""))
            .filter(Boolean);

          // Remove consecutive duplicate segments (case-insensitive)
          const dedupedAnchors = anchors.filter((s, i) => {
            if (i === 0) return true;
            return s.toLowerCase() !== anchors[i - 1].toLowerCase();
          });

          if (dedupedAnchors.length > 0) {
            breadcrumbText = dedupedAnchors.join(" > ");
          } else {
            // fallback to element text content if no anchors; normalize it
            breadcrumbText = normalizeSegment(breadcrumbEl.textContent || "");
          }
        } else {
          // fallback to general matching
          breadcrumbText = getPrefixedMatch(
            "breadcrumb",
            SERVICENOW_SELECTORS.breadcrumb
          );
        }
      } catch (e) {
        breadcrumbText = getPrefixedMatch(
          "breadcrumb",
          SERVICENOW_SELECTORS.breadcrumb
        );
      }

      const authorText = getPrefixedMatch("author", SERVICENOW_SELECTORS.author);
      const kbNumberText = getPrefixedMatch(
        "kbNumber",
        SERVICENOW_SELECTORS.kbNumber
      );

      // Category extraction with special handling for mixed case properties
      let categoryText = getPrefixedMatch(
        "category",
        SERVICENOW_SELECTORS.category
      );
      if (!categoryText) {
        categoryText = getPrefixedMatch(
          "Catagory",
          SERVICENOW_SELECTORS.category
        ); // Handle misspelling
      }

      // Section extraction with special handling
      let sectionText = getPrefixedMatch("section", SERVICENOW_SELECTORS.section);
      if (!sectionText) {
        sectionText = getPrefixedMatch("Section", SERVICENOW_SELECTORS.section);
      }

      const statusText = getPrefixedMatch("status", SERVICENOW_SELECTORS.status);
      const departmentText = getPrefixedMatch(
        "department",
        SERVICENOW_SELECTORS.department
      );

      // Populate metadata object
      if (titleText) metadata.title = titleText;
      if (versionText) metadata.version = versionText;
      if (updatedText) metadata.updated = updatedText;
      if (breadcrumbText) metadata.breadcrumb = breadcrumbText;
      if (authorText) metadata.author = authorText;
      if (kbNumberText) metadata.kbNumber = kbNumberText;
      if (categoryText) metadata.category = categoryText;
      if (sectionText) metadata.section = sectionText;
      if (statusText) metadata.status = statusText;
      if (departmentText) metadata.department = departmentText;

      // Extract additional metadata
      extractPageStructureMetadata(metadata);
      extractContentTypeMetadata(metadata);

      debug("✅ ServiceNow metadata extracted:", metadata);
      return metadata;
    } catch (error) {
      debug("❌ Error extracting ServiceNow metadata:", error);
      return metadata;
    }
  }

  /**
   * Extract metadata about page structure (images, videos, etc.)
   * @param {Object} metadata - Metadata object to populate
   */
  function extractPageStructureMetadata(metadata) {
    try {
      // Check for images - filter out emojis, icons, and other decorative images
      const allImages = document.querySelectorAll("img");
      const contentImages = Array.from(allImages).filter((img) => {
        // Filter out images in header, navigation, footer, and marketing sections
        const excludedContainers = [
          "header",
          "nav",
          "footer",
          ".cmp-header",
          ".cmp-navigation",
          ".cmp-footer",
          ".cmp-banner",
          ".cmp-card",
          ".navbar",
          ".topnav",
          ".sidenav",
          ".breadcrumb",
          '[class*="header"]',
          '[class*="navigation"]',
          '[class*="footer"]',
          '[class*="banner"]',
          '[class*="promo"]',
          '[class*="marketing"]',
          '[role="banner"]',
          '[role="navigation"]',
        ];

        for (const selector of excludedContainers) {
          if (img.closest(selector)) {
            return false;
          }
        }

        // Filter out logo images by class, alt text, or filename
        const className = img.className || "";
        const alt = (img.alt || "").toLowerCase();
        const src = img.getAttribute("src") || "";

        if (
          className.includes("logo") ||
          alt.includes("logo") ||
          src.includes("logo") ||
          src.includes("snow-logo")
        ) {
          return false;
        }

        // Filter out emojis by class or data attribute
        if (
          className.includes("emoji") ||
          className.includes("icon") ||
          className.includes("sprite")
        ) {
          return false;
        }

        // Filter out emoji data attributes
        if (
          img.hasAttribute("data-emoji") ||
          img.getAttribute("role") === "img"
        ) {
          return false;
        }

        // Filter out data URIs and empty/placeholder sources
        if (
          !src ||
          src.startsWith("data:") ||
          src.includes("about:blank") ||
          src.includes("spacer.gif") ||
          src.includes("pixel.gif")
        ) {
          return false;
        }

        // Filter out very small images (likely icons or spacers)
        // Use natural dimensions if available, otherwise actual dimensions
        const width = img.naturalWidth || img.width || 0;
        const height = img.naturalHeight || img.height || 0;
        if (width > 0 && width < 32 && height > 0 && height < 32) {
          return false;
        }

        return true;
      });

      // Check for figures that contain actual content images
      const allFigures = document.querySelectorAll("figure");
      const figuresWithImages = Array.from(allFigures).filter((figure) => {
        // Filter out figures in excluded sections (header, nav, footer, marketing)
        const excludedContainers = [
          "header",
          "nav",
          "footer",
          ".cmp-header",
          ".cmp-navigation",
          ".cmp-footer",
          ".cmp-banner",
          ".cmp-card",
          ".navbar",
          ".topnav",
          ".sidenav",
          ".breadcrumb",
          '[class*="header"]',
          '[class*="navigation"]',
          '[class*="footer"]',
          '[class*="banner"]',
          '[class*="promo"]',
          '[class*="marketing"]',
          '[role="banner"]',
          '[role="navigation"]',
        ];

        for (const selector of excludedContainers) {
          if (figure.closest(selector)) {
            return false;
          }
        }

        // Check if this figure contains at least one img tag
        const figureImages = figure.querySelectorAll("img");
        if (figureImages.length === 0) {
          return false;
        }

        // Check if any of the images in this figure are content images (not emojis/icons/logos)
        return Array.from(figureImages).some((img) => {
          const className = img.className || "";
          const alt = (img.alt || "").toLowerCase();
          const src = img.getAttribute("src") || "";

          // Filter out logos
          if (
            className.includes("logo") ||
            alt.includes("logo") ||
            src.includes("logo") ||
            src.includes("snow-logo")
          ) {
            return false;
          }

          // Filter out emojis/icons
          if (
            className.includes("emoji") ||
            className.includes("icon") ||
            className.includes("sprite")
          ) {
            return false;
          }

          if (
            img.hasAttribute("data-emoji") ||
            img.getAttribute("role") === "img"
          ) {
            return false;
          }

          if (
            !src ||
            src.startsWith("data:") ||
            src.includes("about:blank") ||
            src.includes("spacer.gif") ||
            src.includes("pixel.gif")
          ) {
            return false;
          }

          const width = img.naturalWidth || img.width || 0;
          const height = img.naturalHeight || img.height || 0;
          if (width > 0 && width < 32 && height > 0 && height < 32) {
            return false;
          }

          return true;
        });
      });

      // Debug logging to help identify false positives
      if (contentImages.length > 0) {
        console.log("🖼️ [W2N] Detected content images:", contentImages.length);
        contentImages.forEach((img, idx) => {
          console.log(`  Image ${idx + 1}:`, {
            src: img.src?.substring(0, 100),
            width: img.naturalWidth || img.width,
            height: img.naturalHeight || img.height,
            className: img.className,
            alt: img.alt,
          });
        });
      }
      if (figuresWithImages.length > 0) {
        console.log(
          "🖼️ [W2N] Detected figures with images:",
          figuresWithImages.length
        );
        figuresWithImages.forEach((fig, idx) => {
          const imgs = fig.querySelectorAll("img");
          console.log(`  Figure ${idx + 1} contains ${imgs.length} image(s)`);
        });
      }

      metadata.hasFigureImage =
        contentImages.length > 0 || figuresWithImages.length > 0;

      // Check for videos - look for video tags and video platform iframes only
      const videoTags = document.querySelectorAll("video");
      const iframes = document.querySelectorAll("iframe");

      // Check if iframe is from a known video platform
      const isVideoIframe = (iframe) => {
        const src = iframe.getAttribute("src") || "";
        const videoPatterns = [
          /youtube\.com\/embed\//i,
          /youtube-nocookie\.com\/embed\//i,
          /player\.vimeo\.com\//i,
          /vimeo\.com\/video\//i,
          /wistia\.(com|net)/i,
          /fast\.wistia\.(com|net)/i,
          /loom\.com\/embed\//i,
          /vidyard\.com\/embed\//i,
          /brightcove\.(com|net)/i,
        ];
        return videoPatterns.some((pattern) => pattern.test(src));
      };

      const videoIframes = Array.from(iframes).filter(isVideoIframe);
      metadata.hasVideos = videoTags.length > 0 || videoIframes.length > 0;

      // Generate current release URL from page URL pattern
      // Convert: https://www.servicenow.com/docs/bundle/yokohama-servicenow-platform/page/product/configuration-management/concept/sgc-cmdb-integration-wiz.html
      // To: https://www.servicenow.com/docs/csh?topicname=sgc-cmdb-integration-wiz.html&version=latest
      try {
        const currentUrl = window.location.href;
        const urlMatch = currentUrl.match(
          /\/docs\/bundle\/[^\/]+\/page\/.*\/(.*\.html)/
        );
        if (urlMatch && urlMatch[1]) {
          const topicName = urlMatch[1];
          metadata.CurrentReleaseURL = `https://www.servicenow.com/docs/csh?topicname=${topicName}&version=latest`;
        } else {
          // Fallback to canonical or current URL
          const canonicalLink = document.querySelector('link[rel="canonical"]');
          metadata.CurrentReleaseURL = canonicalLink
            ? canonicalLink.href
            : currentUrl;
        }
      } catch (e) {
        metadata.CurrentReleaseURL = window.location.href;
      }

      debug("📊 Page structure metadata extracted");
    } catch (error) {
      debug("❌ Error extracting page structure metadata:", error);
    }
  }

  /**
   * Extract metadata about content type and classification
   * @param {Object} metadata - Metadata object to populate
   */
  function extractContentTypeMetadata(metadata) {
    try {
      // Determine content type based on URL patterns and page elements
      const url = window.location.href;

      if (url.includes("/kb/") || url.includes("/knowledge/")) {
        metadata.contentType = "Knowledge Base Article";
      } else if (url.includes("/docs/") || url.includes("/documentation/")) {
        metadata.contentType = "Documentation";
      } else if (url.includes("/community/") || url.includes("/forum/")) {
        metadata.contentType = "Community Post";
      } else {
        metadata.contentType = "ServiceNow Page";
      }

      // Extract priority or importance indicators
      const priorityIndicators = document.querySelectorAll(
        '[class*="priority"], [class*="important"], [class*="urgent"]'
      );
      if (priorityIndicators.length > 0) {
        metadata.priority = "High";
      }

      debug("🏷️ Content type metadata extracted");
    } catch (error) {
      debug("❌ Error extracting content type metadata:", error);
    }
  }

  /**
   * Construct ServiceNow base URL for relative paths
   * @returns {string} Base URL
   */
  function constructServiceNowBaseUrl() {
    try {
      const currentUrl = window.location.href;

      // Extract base ServiceNow instance URL
      const match = currentUrl.match(/(https?:\/\/[^\/]+\.servicenow\.com)/);
      if (match) {
        return match[1];
      }

      // Fallback to current origin
      return window.location.origin;
    } catch (error) {
      debug("❌ Error constructing ServiceNow base URL:", error);
      return window.location.origin;
    }
  }

  // Content Extraction Module - HTML content extraction and processing


  /**
   * Extract content with iframe processing
   * @param {HTMLElement} contentElement - Main content element or iframe
   * @returns {Object} Object with combinedHtml and combinedImages
   */
  async function extractContentWithIframes(contentElement) {
    let combinedHtml = "";
    let combinedImages = [];

    // Handle case where no content element is found
    if (!contentElement) {
      debug("⚠️ No content element provided, using document.body as fallback");
      contentElement = document.body;
    }

    // If the content element itself is an iframe, extract from it
    if (contentElement && contentElement.tagName === "IFRAME") {
      debug(
        `📚 Extracting content from iframe: ${contentElement.id || "unnamed"}`
      );

      // Determine the base URL for this iframe's images
      let iframeBaseUrl = contentElement.src;

      // If iframe has no src (common in dynamic ServiceNow content), construct base URL
      if (
        !iframeBaseUrl ||
        iframeBaseUrl === "" ||
        iframeBaseUrl === "about:srcdoc"
      ) {
        iframeBaseUrl = constructServiceNowBaseUrl();
        debug(`📍 Constructed ServiceNow base URL: ${iframeBaseUrl}`);
      }

      try {
        // Wait a moment for iframe to load if needed
        await new Promise((resolve) => setTimeout(resolve, 500));

        // Try multiple methods to access iframe content
        let iframeDoc = null;

        // Wrap in try-catch to handle cross-origin restrictions
        try {
          iframeDoc = contentElement.contentDocument;
        } catch (e) {
          debug(
            `⚠️ contentDocument access blocked (likely cross-origin): ${e.message}`
          );
        }

        // Try contentWindow.document if contentDocument failed
        if (!iframeDoc && contentElement.contentWindow) {
          try {
            iframeDoc = contentElement.contentWindow.document;
          } catch (e) {
            debug(`⚠️ contentWindow.document access also blocked: ${e.message}`);
          }
        }

        // If still no access, check if iframe is cross-origin
        if (!iframeDoc) {
          const iframeSrc =
            contentElement.src || contentElement.getAttribute("src");
          if (
            iframeSrc &&
            (iframeSrc.startsWith("http://") || iframeSrc.startsWith("https://"))
          ) {
            const currentOrigin = window.location.origin;
            try {
              const iframeUrl = new URL(iframeSrc, currentOrigin);
              if (iframeUrl.origin !== currentOrigin) {
                debug(
                  `🚫 Cross-origin iframe detected: ${iframeUrl.origin} (current: ${currentOrigin})`
                );
                debug(
                  `ℹ️ Skipping iframe content extraction due to browser security restrictions`
                );
                // Return empty content gracefully
                return { combinedHtml, combinedImages };
              }
            } catch (urlError) {
              debug(`⚠️ Could not parse iframe URL: ${iframeSrc}`);
            }
          }
        }

        let iframeContent = "";

        if (iframeDoc) {
          // Check if the iframe document itself has a useful URL
          if (
            iframeDoc.location &&
            iframeDoc.location.href &&
            iframeDoc.location.href !== "about:srcdoc"
          ) {
            const docUrl = iframeDoc.location.href;
            // If iframe document URL points to a known books resource, use its base path
            if (docUrl.includes("/eod/books/")) {
              iframeBaseUrl = docUrl.substring(0, docUrl.lastIndexOf("/"));
              debug(`📍 Found iframe document URL base: ${iframeBaseUrl}`);
            }
          }

          // Strategy 1: Look for specific book content containers FIRST
          const bookContentSelectors = [
            ".zDocsTopicPageBody .zDocsTopicPageBodyContent article.dita .body.conbody", // ServiceNow docs precise content body
            "[role='main'] section",
            "[role='main'] article",
            "main section",
            "main article",
            ".book-text",
            ".chapter-content",
            ".page-content",
            ".content-body",
            "[class*='text'] section",
            "[class*='content'] section",
            "section[class*='text']",
            "article[class*='text']",
          ];

          for (const selector of bookContentSelectors) {
            const container = iframeDoc.querySelector(selector);
            if (container?.innerHTML?.trim().length > 200) {
              iframeContent = container.innerHTML;
              debug(`📄 Strategy 1 (${selector}): ${iframeContent.length} chars`);
              break;
            }
          }

          // Strategy 2: Look for main content area but exclude navigation
          if (!iframeContent) {
            const mainElement = iframeDoc.querySelector("main, [role='main']");
            if (mainElement) {
              // Clone the main element to modify it without affecting the page
              const mainClone = mainElement.cloneNode(true);

              // Remove navigation elements from the clone
              const navElements = mainClone.querySelectorAll(
                "nav, [role='navigation'], .navigation, .nav, .breadcrumb, .menu, header, footer"
              );
              navElements.forEach((el) => el.remove());

              if (mainClone.innerHTML?.trim().length > 200) {
                iframeContent = mainClone.innerHTML;
                debug(
                  `📄 Strategy 2 (main without nav): ${iframeContent.length} chars`
                );
              }
            }
          }

          // Strategy 3: Body innerHTML (fallback)
          if (!iframeContent) {
            const iframeBody = iframeDoc.body;
            if (iframeBody) {
              iframeContent = iframeBody.innerHTML || "";
              debug(
                `📄 Strategy 3 (body.innerHTML fallback): ${iframeContent.length} chars`
              );
            }
          }

          // Strategy 4: DocumentElement innerHTML (if body failed)
          if (!iframeContent && iframeDoc.documentElement) {
            iframeContent = iframeDoc.documentElement.innerHTML || "";
            debug(
              `📄 Strategy 4 (documentElement.innerHTML): ${iframeContent.length} chars`
            );
          }

          // Extract images from iframe if we have content
          if (iframeContent && iframeContent.trim().length > 50) {
            // Replace images inside tables with bullet symbols
            // Notion doesn't support images in tables, so we use bullets as placeholders

            // Use regex to find table elements and replace img tags within them
            const tableRegex = /<table[^>]*>[\s\S]*?<\/table>/gi;
            const tableMatches = iframeContent.match(tableRegex);
            debug(
              `🔍 Found ${
              tableMatches ? tableMatches.length : 0
            } table(s) in content`
            );

            let replacedCount = 0;

            iframeContent = iframeContent.replace(
              tableRegex,
              (tableMatch, offset) => {
                // Count images and SVGs before replacement
                const imgMatches = tableMatch.match(/<img[^>]*>/gi);
                const svgMatches = tableMatch.match(
                  /<svg[^>]*>[\s\S]*?<\/svg>/gi
                );
                const imgCount = imgMatches ? imgMatches.length : 0;
                const svgCount = svgMatches ? svgMatches.length : 0;

                debug(
                  `📋 Table at offset ${offset}: contains ${imgCount} img tag(s) and ${svgCount} svg element(s)`
                );

                let result = tableMatch;

                // Replace img tags with bullet symbol
                if (imgMatches) {
                  result = result.replace(/<img[^>]*>/gi, " • ");
                  replacedCount += imgCount;
                  debug(`✅ Replaced ${imgCount} img tags with bullets`);
                }

                // Replace svg elements with bullet symbol
                if (svgMatches) {
                  result = result.replace(/<svg[^>]*>[\s\S]*?<\/svg>/gi, " • ");
                  replacedCount += svgCount;
                  debug(`✅ Replaced ${svgCount} svg elements with bullets`);
                }

                return result;
              }
            );

            debug(`📊 Total images/svgs replaced in tables: ${replacedCount}`);
            if (replacedCount > 0) {
              debug(
                `🔄 Replaced ${replacedCount} images/svgs in tables with bullet symbols (•)`
              );
            } else {
              debug(`⚠️ No images or svgs found in tables to replace`);
            }

            combinedHtml = iframeContent;
            debug(
              `✅ Successfully extracted iframe content (${iframeContent.length} chars)`
            );

            // Debug: Show a sample of the extracted HTML to see the invalid image text
            const htmlSample = iframeContent.substring(0, 500);
            if (
              htmlSample.includes("[Invalid Image:") ||
              htmlSample.includes("../images/")
            ) {
              debug(`📄 HTML Sample (showing invalid image issue):`);
              debug(`${htmlSample}...`);
            }

            const iframeImages = Array.from(iframeDoc.querySelectorAll("img"))
              .map((img) => {
                const imgUrl = img.src || img.getAttribute("data-src");
                debug(`🖼️ Raw img src from iframe: "${imgUrl}"`);
                return {
                  url: imgUrl,
                  alt: img.alt || img.getAttribute("alt") || "",
                  width: img.width,
                  height: img.height,
                  baseUrl: iframeBaseUrl,
                };
              })
              .filter((img) => img.url);

            debug(
              `🖼️ Found ${iframeImages.length} images in iframe (base: ${iframeBaseUrl})`
            );
            combinedImages.push(...iframeImages);
          } else {
            debug(`⚠️ No meaningful content extracted from iframe`);
          }
        } else {
          debug(`⚠️ Cannot access iframe document - likely CORS blocked`);
        }
      } catch (e) {
        debug(`❌ Error extracting iframe content: ${e.message}`);
      }
    } else {
      // Regular content element processing
      debug("📄 Processing regular content element");

      // Look for nested iframes and extract their content
      const nestedIframes = contentElement.querySelectorAll("iframe");
      if (nestedIframes.length > 0) {
        debug(`🔍 Found ${nestedIframes.length} nested iframes to process`);

        for (const iframe of nestedIframes) {
          const iframeResult = await extractContentWithIframes(iframe);
          if (iframeResult.combinedHtml) {
            combinedHtml += iframeResult.combinedHtml;
            combinedImages.push(...iframeResult.combinedImages);
          }
        }
      }

      // If no iframe content found, use the regular element content
      if (!combinedHtml) {
        combinedHtml = contentElement.innerHTML || contentElement.outerHTML;
      }

      // Replace images/SVGs inside tables with bullet symbols
      // Notion doesn't support images in tables, so we use bullets as placeholders
      const tableRegex = /<table[^>]*>[\s\S]*?<\/table>/gi;
      const tableMatches = combinedHtml.match(tableRegex);
      debug(
        `🔍 Found ${tableMatches ? tableMatches.length : 0} table(s) in content`
      );

      let replacedCount = 0;

      combinedHtml = combinedHtml.replace(tableRegex, (tableMatch, offset) => {
        // Count images and SVGs before replacement
        const imgMatches = tableMatch.match(/<img[^>]*>/gi);
        const svgMatches = tableMatch.match(/<svg[^>]*>[\s\S]*?<\/svg>/gi);
        const imgCount = imgMatches ? imgMatches.length : 0;
        const svgCount = svgMatches ? svgMatches.length : 0;

        debug(
          `📋 Table at offset ${offset}: contains ${imgCount} img tag(s) and ${svgCount} svg element(s)`
        );

        let result = tableMatch;

        // Replace img tags with bullet symbol
        if (imgMatches) {
          result = result.replace(/<img[^>]*>/gi, " • ");
          replacedCount += imgCount;
          debug(`✅ Replaced ${imgCount} img tags with bullets`);
        }

        // Replace svg elements with bullet symbol
        if (svgMatches) {
          result = result.replace(/<svg[^>]*>[\s\S]*?<\/svg>/gi, " • ");
          replacedCount += svgCount;
          debug(`✅ Replaced ${svgCount} svg elements with bullets`);
        }

        return result;
      });

      debug(`📊 Total images/svgs replaced in tables: ${replacedCount}`);
      if (replacedCount > 0) {
        debug(
          `🔄 Replaced ${replacedCount} images/svgs in tables with bullet symbols (•)`
        );
      } else {
        debug(`⚠️ No images or svgs found in tables to replace`);
      }

      // Extract images from the main content element
      const mainImages = Array.from(contentElement.querySelectorAll("img"))
        .map((img) => {
          const imgUrl = img.src || img.getAttribute("data-src");
          return {
            url: imgUrl,
            alt: img.alt || img.getAttribute("alt") || "",
            width: img.width,
            height: img.height,
            baseUrl: constructServiceNowBaseUrl(),
          };
        })
        .filter((img) => img.url);

      combinedImages.push(...mainImages);
    }

    // Extract and append Related Content section if it exists
    const relatedContentHtml = extractRelatedContent();
    if (relatedContentHtml) {
      combinedHtml += relatedContentHtml;
    }

    return { combinedHtml, combinedImages };
  }

  /**
   * Extract Related Content section and format as callout
   * @returns {string} HTML for related content callout, or empty string if not found
   */
  function extractRelatedContent() {
    try {
      // Look for Related Content section
      // Try multiple selectors to find the heading
      const relatedHeadingSelectors = [
        'h5:contains("Related Content")',
        'h5[class*="css-"]:has-text("Related Content")',
        '.css-g931ng:has-text("Related Content")',
      ];

      let relatedSection = null;

      // Find by heading text content
      const headings = document.querySelectorAll("h5");
      for (const heading of headings) {
        if (heading.textContent.trim() === "Related Content") {
          relatedSection = heading.parentElement;
          break;
        }
      }

      if (!relatedSection) {
        debug("ℹ️ No Related Content section found");
        return "";
      }

      // Extract the list items
      const listItems = relatedSection.querySelectorAll("li");
      if (listItems.length === 0) {
        debug("ℹ️ Related Content section found but has no items");
        return "";
      }

      // Build the callout HTML
      let calloutHtml = '<div class="note related note_related">';
      calloutHtml += '<span class="note__title">Related Content</span><br>';
      calloutHtml += "<ul>";

      listItems.forEach((li) => {
        const link = li.querySelector("a");
        const description = li.querySelector("p");

        if (link) {
          const href = link.getAttribute("href");
          const linkText = link.textContent.trim();

          calloutHtml += "<li>";
          if (href) {
            calloutHtml += `<a href="${href}">${linkText}</a>`;
          } else {
            calloutHtml += linkText;
          }

          if (description && description.textContent.trim()) {
            calloutHtml += ` - ${description.textContent.trim()}`;
          }
          calloutHtml += "</li>";
        }
      });

      calloutHtml += "</ul>";
      calloutHtml += "</div>";

      debug(
        `✅ Extracted Related Content section with ${listItems.length} items`
      );
      return calloutHtml;
    } catch (error) {
      debug("❌ Error extracting Related Content:", error);
      return "";
    }
  }

  /**
   * Find the best content selector for the current page
   * @returns {HTMLElement|null} The content element or null if not found
   */
  function findContentElement() {
    debug("🔍 Searching for content element...");

    // Priority order of content selectors (most specific first)
    const contentSelectors = [
      // ServiceNow docs specific
      ".zDocsTopicPageBody .zDocsTopicPageBodyContent article.dita .body.conbody",
      "#zDocsContent .zDocsTopicPageBody",

      // Generic main content areas
      "main[role='main']",
      "main",
      "[role='main']",
      ".main-content",
      ".content-main",
      "#main-content",
      "#content",
      ".content",

      // Article and text content
      "article",
      ".article-body",
      ".article-content",
      ".post-content",
      ".entry-content",

      // Book/documentation specific
      ".book-content",
      ".documentation",
      ".docs-content",

      // Generic containers
      ".container-main",
      "#container",
      ".wrapper-main",
    ];

    for (const selector of contentSelectors) {
      try {
        const element = document.querySelector(selector);
        if (
          element &&
          element.innerHTML &&
          element.innerHTML.trim().length > 100
        ) {
          debug(`✅ Found content element using selector: ${selector}`);
          debug(`📏 Content length: ${element.innerHTML.length} characters`);
          return element;
        }
      } catch (e) {
        debug(`❌ Invalid selector: ${selector}`);
      }
    }

    debug("❌ No suitable content element found");
    return null;
  }

  // Content Processing Utilities - Text processing and content manipulation


  /**
   * Normalize whitespace and clean up text content
   * @param {string} text - Text to normalize
   * @returns {string} Normalized text
   */
  function normalizeText(text) {
    if (!text || typeof text !== "string") {
      return "";
    }

    return text
      .replace(/\s+/g, " ") // Collapse whitespace
      .replace(/^\s+|\s+$/g, "") // Trim
      .replace(/\n\s*\n/g, "\n") // Remove empty lines
      .trim();
  }

  /**
   * Extract plain text content from HTML
   * @param {string|HTMLElement} content - HTML content or element
   * @returns {string} Plain text content
   */
  function extractPlainText(content) {
    try {
      if (!content) {
        return "";
      }

      let element = content;

      if (typeof content === "string") {
        const tempDiv = document.createElement("div");
        tempDiv.innerHTML = content;
        element = tempDiv;
      }

      // Ensure we have a valid element with querySelectorAll method
      if (!element || typeof element.querySelectorAll !== "function") {
        return "";
      }

      // Remove script and style elements
      const unwanted = element.querySelectorAll("script, style, meta, link");
      unwanted.forEach((el) => el.remove());

      return normalizeText(element.textContent || element.innerText || "");
    } catch (error) {
      debug("❌ Error extracting plain text:", error);
      return "";
    }
  }

  /**
   * Count words in text content
   * @param {string} text - Text to count
   * @returns {number} Word count
   */
  function countWords(text) {
    if (!text || typeof text !== "string") {
      return 0;
    }

    return text
      .trim()
      .split(/\s+/)
      .filter((word) => word.length > 0).length;
  }

  /**
   * Estimate reading time based on word count
   * @param {string} text - Text content
   * @param {number} wordsPerMinute - Average reading speed (default: 200)
   * @returns {number} Estimated reading time in minutes
   */
  function estimateReadingTime(text, wordsPerMinute = 200) {
    const wordCount = countWords(text);
    return Math.ceil(wordCount / wordsPerMinute);
  }

  /**
   * Extract headings and create a content outline
   * @param {HTMLElement|string} content - Content element or HTML string
   * @returns {Array} Array of heading objects with hierarchy
   */
  function extractContentOutline(content) {
    try {
      let element = content;

      if (typeof content === "string") {
        const tempDiv = document.createElement("div");
        tempDiv.innerHTML = content;
        element = tempDiv;
      }

      const headings = Array.from(
        element.querySelectorAll("h1, h2, h3, h4, h5, h6")
      );

      return headings.map((heading, index) => ({
        level: parseInt(heading.tagName.substring(1)),
        text: normalizeText(heading.textContent || ""),
        id: heading.id || `heading-${index}`,
        tagName: heading.tagName.toLowerCase(),
      }));
    } catch (error) {
      debug("❌ Error extracting content outline:", error);
      return [];
    }
  }

  /**
   * Split content into sections based on headings
   * @param {HTMLElement|string} content - Content element or HTML string
   * @returns {Array} Array of content sections
   */
  function splitContentIntoSections(content) {
    try {
      if (!content) {
        return [];
      }

      let element = content;

      if (typeof content === "string") {
        const tempDiv = document.createElement("div");
        tempDiv.innerHTML = content;
        element = tempDiv;
      }

      // Ensure we have a valid element with children property
      if (!element || !element.children) {
        return [];
      }

      const sections = [];
      const children = Array.from(element.children);
      let currentSection = null;

      children.forEach((child) => {
        if (["H1", "H2", "H3", "H4", "H5", "H6"].includes(child.tagName)) {
          // Start a new section
          if (currentSection) {
            sections.push(currentSection);
          }

          currentSection = {
            heading: {
              level: parseInt(child.tagName.substring(1)),
              text: normalizeText(child.textContent || ""),
              tagName: child.tagName.toLowerCase(),
            },
            content: [],
          };
        } else if (currentSection) {
          // Add to current section
          currentSection.content.push(child.outerHTML);
        } else {
          // Content before first heading
          if (!sections.length || sections[0].heading) {
            sections.unshift({
              heading: null,
              content: [],
            });
          }
          sections[0].content.push(child.outerHTML);
        }
      });

      // Add the last section
      if (currentSection) {
        sections.push(currentSection);
      }

      return sections.map((section) => ({
        ...section,
        content: section.content.join("\n"),
        wordCount: countWords(extractPlainText(section.content.join("\n"))),
      }));
    } catch (error) {
      debug("❌ Error splitting content into sections:", error);
      return [];
    }
  }

  /**
   * Calculate content statistics
   * @param {string|HTMLElement} content - Content to analyze
   * @returns {Object} Content statistics
   */
  function analyzeContent(content) {
    try {
      if (!content) {
        return {
          wordCount: 0,
          readingTime: 0,
          characterCount: 0,
          headingCount: 0,
          imageCount: 0,
          linkCount: 0,
          tableCount: 0,
          listCount: 0,
          text: "",
          outline: [],
        };
      }

      const plainText = extractPlainText(content);
      const wordCount = countWords(plainText);
      const readingTime = estimateReadingTime(plainText);
      const outline = extractContentOutline(content);

      let element = content;
      if (typeof content === "string") {
        const tempDiv = document.createElement("div");
        tempDiv.innerHTML = content;
        element = tempDiv;
      }

      // Ensure we have a valid element with querySelectorAll method
      if (!element || typeof element.querySelectorAll !== "function") {
        return {
          wordCount,
          readingTime,
          characterCount: plainText.length,
          headingCount: outline.length,
          imageCount: 0,
          linkCount: 0,
          tableCount: 0,
          listCount: 0,
          text: plainText,
          outline,
        };
      }

      const images = element.querySelectorAll("img").length;
      const links = element.querySelectorAll("a[href]").length;
      const tables = element.querySelectorAll("table").length;
      const lists = element.querySelectorAll("ul, ol").length;

      return {
        wordCount,
        readingTime,
        characterCount: plainText.length,
        headingCount: outline.length,
        imageCount: images,
        linkCount: links,
        tableCount: tables,
        listCount: lists,
        outline,
      };
    } catch (error) {
      debug("❌ Error analyzing content:", error);
      return {
        wordCount: 0,
        readingTime: 0,
        characterCount: 0,
        headingCount: 0,
        imageCount: 0,
        linkCount: 0,
        tableCount: 0,
        listCount: 0,
        outline: [],
      };
    }
  }

  // Main Entry Point - ServiceNow-2-Notion Userscript


  /**
   * Main Application Class - Coordinates all modules
   */
  class ServiceNowToNotionApp {
    constructor() {
      this.config = null;
      this.isProcessing = false;
      this.currentExtractedData = null;
      this.workflowAvailable = false;
    }

    /**
     * Initialize the application
     */
    async initialize() {
      debug(`🚀 ServiceNow-2-Notion v${PROVIDER_VERSION} initializing...`);

      try {
        // Initialize configuration
        this.config = await initializeConfig();

        // Universal Workflow removed — always use proxy path.
        this.workflowAvailable = false;

        // Initialize UI components
        await this.initializeUI();

        debug("✅ Application initialized successfully");
      } catch (error) {
        debug("❌ Failed to initialize application:", error);
        throw error;
      }
    }

    /**
     * Initialize UI components and inject buttons
     */
    async initializeUI() {
      debug("🎨 Initializing UI components");

      try {
        // Cleanup any leftover UI elements from previous runs or older builds
        try {
          // Whitelist of known-good ids that current code may create
          const keepIds = new Set([
            // main panel / panel internals
            "w2n-notion-panel",
            "w2n-header",
            "w2n-close",
            "w2n-database-select",
            "w2n-selected-database-label",
            "w2n-refresh-dbs",
            "w2n-search-dbs",
            "w2n-get-db",
            "w2n-configure-mapping",
            "w2n-capture-page",
            "w2n-capture-description",
            "w2n-max-pages",
            "w2n-select-next-element",
            "w2n-autoextract-controls",
            "w2n-start-autoextract",
            "w2n-open-icon-cover",
            "w2n-diagnose-autoextract",
            // modals (created on-demand)
            "w2n-advanced-settings-modal",
            "w2n-icon-cover-modal",
            "w2n-property-mapping-modal",
            // overlay/progress
            "w2n-saving-progress",
            // modal internal ids that are referenced elsewhere
            "w2n-mapping-db-name",
            "w2n-property-mappings",
            "w2n-modal-use-martian",
            "w2n-modal-direct-images",
            "w2n-modal-debug-mode",
            "w2n-modal-duplicate-detect",
          ]);

          // Allow-list of id prefixes that are safe to keep (e.g. progress bars)
          const safePrefixes = ["w2n-progress-", "w2n-unsplash-"];

          // Remove legacy uppercase IDs (old userscript) aggressively
          [
            "W2N-save-button",
            "W2N-settings-button",
            "W2N-button-container",
          ].forEach((id) => {
            const el = document.getElementById(id);
            if (el && el.remove) el.remove();
          });

          // Remove any leftover elements with w2n- prefix that are not in the whitelist
          Array.from(document.querySelectorAll("[id^='w2n-']")).forEach((el) => {
            const id = el.id;
            if (keepIds.has(id)) return; // keep known ids
            if (safePrefixes.some((p) => id.startsWith(p))) return; // keep safe prefixes
            // If the element appears to be a dynamically-created overlay/modal we still remove it
            debug(`Removing stale DOM element with id=${id}`);
            if (el && el.remove) el.remove();
          });

          // Also clean up any uppercase legacy markers like w2n-indicator-martian (mixed case)
          const mixedLegacy = ["w2n-indicator-martian"];
          mixedLegacy.forEach((id) => {
            const el = document.getElementById(id);
            if (el && el.remove) el.remove();
          });
        } catch (e) {
          debug("Failed to cleanup old UI elements:", e);
        }
        // Do not inject modals on startup; inject when the user requests them via buttons

        // Wire overlay's "Configure Property Mapping" button to show the property mapping modal
        try {
          setPropertyMappingModalInjector(showPropertyMappingModal);
        } catch (e) {
          debug("Failed to set overlay property mapping injector:", e);
        }

        // Modal functionality is setup within inject functions

        // Inject the main floating panel (port of original createUI)
        try {
          injectMainPanel();
        } catch (e) {
          debug("Failed to inject main panel:", e);
        }

        // Create main action button
        this.createMainActionButton();

        // Create settings button
        this.createSettingsButton();

        debug("✅ UI components initialized");
      } catch (error) {
        debug("❌ Failed to initialize UI:", error);
        throw error;
      }
    }

    /**
     * Create the main "Save to Notion" button
     */
    createMainActionButton() {
      const container = this.findButtonContainer();
      if (!container) {
        debug("⚠️ Could not find suitable container for main button");
        return;
      }

      const button = createEl(
        "button",
        {
          id: "W2N-save-button",
          title: `ServiceNow-2-Notion v${PROVIDER_VERSION} - Save current page to Notion`,
          style: `
        background-color: ${BRANDING.primaryColor};
        color: white;
        border: none;
        border-radius: 6px;
        padding: 8px 16px;
        font-size: 14px;
        font-weight: bold;
        cursor: pointer;
        margin-left: 10px;
        display: inline-flex;
        align-items: center;
        gap: 6px;
        transition: all 0.2s ease;
      `,
        },
        "💾 Save to Notion"
      );

      // Add click handler
      button.addEventListener("click", () => this.handleMainAction());

      // Add hover effects
      button.addEventListener("mouseenter", () => {
        button.style.backgroundColor = BRANDING.hoverColor;
        button.style.transform = "translateY(-1px)";
      });

      button.addEventListener("mouseleave", () => {
        button.style.backgroundColor = BRANDING.primaryColor;
        button.style.transform = "translateY(0)";
      });

      container.appendChild(button);
      debug("✅ Main action button created");
    }

    /**
     * Create the settings button
     */
    createSettingsButton() {
      const container = this.findButtonContainer();
      if (!container) return;

      const settingsButton = createEl(
        "button",
        {
          id: "W2N-settings-button",
          title: "ServiceNow-2-Notion Settings",
          style: `
        background-color: #6b7280;
        color: white;
        border: none;
        border-radius: 6px;
        padding: 8px 12px;
        font-size: 14px;
        cursor: pointer;
        margin-left: 5px;
        display: inline-flex;
        align-items: center;
        transition: all 0.2s ease;
      `,
        },
        "⚙️"
      );

      // Add click handler
      settingsButton.addEventListener("click", () => this.showSettingsModal());

      settingsButton.addEventListener("mouseenter", () => {
        settingsButton.style.backgroundColor = "#4b5563";
      });

      settingsButton.addEventListener("mouseleave", () => {
        settingsButton.style.backgroundColor = "#6b7280";
      });

      container.appendChild(settingsButton);
      debug("✅ Settings button created");
    }

    /**
     * Find suitable container for buttons
     */
    findButtonContainer() {
      // Try different selectors for different ServiceNow layouts
      const selectors = [
        ".navbar-right",
        ".header-actions",
        ".toolbar",
        "#gsft_main",
      ];

      for (const selector of selectors) {
        const container = document.querySelector(selector);
        if (container) {
          debug(`✅ Found button container: ${selector}`);
          return container;
        }
      }

      // If no container found, do not create a fallback UI on page load.
      // Returning null prevents auto-adding buttons that clutter the page.
      return null;
    }

    // ...existing code...

    /**
     * Handle main action button click
     */
    async handleMainAction() {
      if (this.isProcessing) {
        debug("⚠️ Already processing, ignoring click");
        return;
      }

      this.isProcessing = true;

      try {
        // Show progress overlay
        overlayModule.start("Extracting content...");

        // Extract data from current page
        const extractedData = await this.extractCurrentPageData();
        this.currentExtractedData = extractedData;

        overlayModule.setMessage("Processing content...");

        // Universal Workflow is deprecated — always use proxy processing
        await this.processWithProxy(extractedData);
      } catch (error) {
        debug("❌ Main action failed:", error);
        // Use overlayModule.error to display failures (overlayModule.done expects an object)
        try {
          overlayModule.error({
            message: `Failed to save to Notion: ${error.message}`,
          });
        } catch (e) {
          // Fallback: ensure overlay is closed if the overlay API is in an unexpected state
          try {
            overlayModule.close && overlayModule.close();
          } catch (err) {}
        }
        showErrorPanel("Failed to save to Notion: " + error.message);
      } finally {
        this.isProcessing = false;
      }
    }

    /**
     * Extract data from current page
     */
    async extractCurrentPageData() {
      debug("📝 Extracting current page data");

      try {
        // Extract metadata
        const metadata = extractServiceNowMetadata();

        // Find and extract content
        const contentElement = findContentElement();
        const content = await extractContentWithIframes(contentElement);

        // Analyze and process content (with null safety)
        const analyzed = content.html ? analyzeContent(content.html) : {};

        const extractedData = {
          ...metadata,
          content: {
            ...content,
            ...analyzed,
            sections: content.html ? splitContentIntoSections(content.html) : [],
          },
          timestamp: new Date().toISOString(),
          // Don't overwrite source and version from metadata
          // source and version come from extractServiceNowMetadata()
        };

        debug("✅ Page data extracted successfully");
        return extractedData;
      } catch (error) {
        debug("❌ Failed to extract page data:", error);
        throw error;
      }
    }

    /**
     * Process using Universal Workflow Module
     */
    async processWithWorkflow(extractedData) {
      debug("processWithWorkflow is deprecated; redirecting to proxy processing");
      // Redirect to proxy to preserve backward compatibility
      return this.processWithProxy(extractedData);
    }

    /**
     * Process using proxy server
     */
    async processWithProxy(extractedData) {
      debug("🔄 Processing with proxy server");

      try {
        // Check proxy health first
        overlayModule.setMessage("Checking proxy connection...");
        const cfg = this.config || getConfig();

        // If GM_xmlhttpRequest is not available and fetch will be subject to CORS,
        // warn the user early with actionable steps.
        const hasGM = typeof GM_xmlhttpRequest !== "undefined";
        if (!hasGM) {
          overlayModule.error({
            message:
              "This userscript is running without privileged XHR (GM_xmlhttpRequest).\n" +
              "Browser fetch will be blocked by CORS for the proxy.\n" +
              "Please run the userscript in Tampermonkey (grant GM_xmlhttpRequest),\n" +
              "or configure the proxy to allow CORS from this origin.",
            retryCallback: async () => {
              // On retry, attempt a ping + health check again
              overlayModule.setMessage("Re-checking proxy connection...");
              try {
                const pingOk = await pingProxy();
                if (pingOk) {
                  overlayModule.setMessage("Proxy reachable — continuing...");
                  // try normal health flow below
                } else {
                  overlayModule.error({
                    message:
                      "Proxy still unreachable from this context.\n" +
                      "Either enable GM_xmlhttpRequest or run from a browser extension that allows cross-origin requests.",
                  });
                  throw new Error("Proxy unreachable");
                }
              } catch (e) {
                overlayModule.error({
                  message: "Error while re-checking proxy: " + (e.message || e),
                });
                throw e;
              }
            },
          });
        }

        const health = await checkProxyHealth();

        if (!health.healthy) {
          // Show friendly overlay error with retry option
          overlayModule.error({
            message: `Proxy server is not available (${
            cfg.proxyUrl || "unknown"
          })`,
            retryCallback: async () => {
              try {
                overlayModule.setMessage("Re-checking proxy connection...");
                const retryHealth = await checkProxyHealth();
                if (retryHealth.healthy) {
                  overlayModule.setMessage("Proxy available — continuing...");
                  // resume processing
                  try {
                    await this.processWithProxy(extractedData);
                  } catch (e) {
                    debug("Retry processing failed:", e);
                    overlayModule.error({
                      message: "Processing failed after proxy became available",
                    });
                  }
                } else {
                  overlayModule.error({
                    message:
                      "Proxy still unavailable. Check proxy server and network settings.",
                  });
                }
              } catch (e) {
                overlayModule.error({
                  message: "Error while re-checking proxy: " + (e.message || e),
                });
              }
            },
          });
          throw new Error("Proxy server is not available");
        }

        // Get database if configured
        const config = getConfig();
        if (!config.databaseId) {
          // Show database selection modal
          await this.showDatabaseSelection();
          return; // Will continue after database is selected
        }

        // Get database and mappings
        overlayModule.setMessage("Preparing database mappings...");
        const database = await getDatabase(config.databaseId);
        const mappings = await getPropertyMappings(config.databaseId);

        // Apply mappings to extracted data
        const properties = applyPropertyMappings(
          extractedData,
          database,
          mappings
        );

        // Prepare page data for proxy
        // Extract HTML content from the nested content structure
        // extractedData.content has: { combinedHtml, combinedImages, ...analyzed }
        const htmlContent =
          extractedData.content?.combinedHtml || extractedData.contentHtml || "";

        const pageData = {
          title: extractedData.title || document.title || "Untitled Page",
          content: htmlContent, // Proxy expects content field with HTML
          contentHtml: htmlContent, // Also provide contentHtml for compatibility
          databaseId: config.databaseId,
          url: window.location.href,
          properties: properties,
        }; // Add icon and cover if available
        if (extractedData.icon) {
          pageData.icon = extractedData.icon;
        }
        if (extractedData.cover) {
          pageData.cover = extractedData.cover;
        }

        // DEBUG: Log payload structure before sending to proxy
        debug("🔍 DEBUG: pageData structure being sent to proxy:", {
          title: pageData.title,
          contentLength: pageData.content ? pageData.content.length : 0,
          contentHtmlLength: pageData.contentHtml
            ? pageData.contentHtml.length
            : 0,
          hasContent: !!pageData.content,
          hasContentHtml: !!pageData.contentHtml,
          contentPreview: pageData.content
            ? pageData.content.substring(0, 100)
            : "EMPTY",
          contentHtmlPreview: pageData.contentHtml
            ? pageData.contentHtml.substring(0, 100)
            : "EMPTY",
        });
        debug("🔍 DEBUG: Full extractedData structure:", extractedData);

        // Send to proxy
        overlayModule.setMessage("Saving to Notion...");
        const result = await sendProcessedContentToProxy(pageData);

        if (result.success) {
          // Show success state and auto-close the overlay after a short delay
          try {
            overlayModule.done({
              success: true,
              pageUrl: result.pageUrl || null,
              autoCloseMs: 3000,
            });
          } catch (e) {
            // If overlay.done isn't available for some reason, close the overlay to avoid leaving it open
            try {
              overlayModule.close && overlayModule.close();
            } catch (err) {}
          }

          showSuccessPanel(result);

          if (result.pageUrl) {
            setTimeout(() => {
              if (confirm("Would you like to open the created Notion page?")) {
                window.open(result.pageUrl, "_blank");
              }
            }, 1000);
          }
        } else {
          throw new Error(result.error || "Proxy processing failed");
        }
      } catch (error) {
        debug("❌ Proxy processing failed:", error);
        throw error;
      }
    }

    /**
     * Convert content to Notion blocks
     */
    createNotionBlocks(content) {
      const blocks = [];

      if (content.sections && content.sections.length > 0) {
        content.sections.forEach((section) => {
          if (section.title) {
            blocks.push({
              object: "block",
              type: "heading_2",
              heading_2: {
                rich_text: [
                  {
                    type: "text",
                    text: { content: section.title },
                  },
                ],
              },
            });
          }

          if (section.content) {
            blocks.push({
              object: "block",
              type: "paragraph",
              paragraph: {
                rich_text: [
                  {
                    type: "text",
                    text: { content: section.content.slice(0, 2000) },
                  },
                ],
              },
            });
          }
        });
      } else if (content.text) {
        // Fallback to plain text
        const paragraphs = content.text.split("\n\n").filter((p) => p.trim());
        paragraphs.forEach((paragraph) => {
          blocks.push({
            object: "block",
            type: "paragraph",
            paragraph: {
              rich_text: [
                {
                  type: "text",
                  text: { content: paragraph.trim().slice(0, 2000) },
                },
              ],
            },
          });
        });
      }

      return blocks;
    }

    /**
     * Show database selection modal
     */
    async showDatabaseSelection() {
      // Show the property mapping modal (injects it if necessary)
      try {
        showPropertyMappingModal();
      } catch (e) {
        debug("Failed to show database selection modal:", e);
      }
    }

    /**
     * Show settings modal
     */
    showSettingsModal() {
      // Inject (if needed) and show the advanced settings modal
      try {
        injectAdvancedSettingsModal();
      } catch (e) {
        debug("Failed to inject/show advanced settings modal:", e);
      }
    }

    /**
     * Show icon/cover modal on demand
     */
    showIconCoverModal() {
      try {
        injectIconCoverModal();
      } catch (e) {
        debug("Failed to inject/show icon cover modal:", e);
      }
    }
  }

  // Global app instance
  let app = null;

  /**
   * Main initialization function
   */
  async function initializeApp() {
    try {
      // Wait for DOM to be ready
      if (document.readyState === "loading") {
        await new Promise((resolve) => {
          document.addEventListener("DOMContentLoaded", resolve);
        });
      }

      // Additional wait to ensure ServiceNow UI is loaded
      await new Promise((resolve) => setTimeout(resolve, 2000));

      // Create and initialize app
      app = new ServiceNowToNotionApp();
      await app.initialize();

      debug("🎉 ServiceNow-2-Notion application ready!");
    } catch (error) {
      debug("💥 Failed to initialize application:", error);
      // Also log to console unconditionally as a last resort for critical failures
      console.error("ServiceNow-2-Notion initialization failed:", error);
    }
  }

  // Export for potential external access
  window.ServiceNowToNotion = {
    app: () => app,
    version: PROVIDER_VERSION,
    debug: debug,
  };

  // Auto-initialize when script loads
  initializeApp();

  // Expose a UI update function used by settings modal to refresh visible labels
  function updateUIFromConfig() {
    try {
      const config = getConfig();
      const dbLabelEl = document.getElementById("w2n-selected-database-label");
      const martianEl = document.getElementById("w2n-indicator-martian");
      if (dbLabelEl) {
        dbLabelEl.textContent = config.databaseName
          ? `Database: ${config.databaseName}`
          : "Database: (none)";
      }
      if (martianEl) {
        martianEl.textContent = config.useMartian
          ? "Martian: on"
          : "Martian: off";
      }
    } catch (e) {
      debug("Failed to update UI from config:", e);
    }
  }

  window.updateUIFromConfig = updateUIFromConfig;

})();
})();
