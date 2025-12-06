// ==UserScript==
// @name         ServiceNow-2-Notion
// @namespace    https://github.com/Christie-Norton-McIntosh/ServiceNow-2-Notion
// @version      11.0.158
// @description  Extract ServiceNow content and save to Notion via proxy server
// @author       Norton-McIntosh
// @match        https://*.service-now.com/*
// @match        https://*.servicenow.com/*
// @grant        GM_setValue
// @grant        GM_getValue
// @grant        GM_xmlhttpRequest
// @grant        GM_addStyle
// @grant        GM_getResourceText
// @grant        GM_notification
// @run-at       document-idle
// @connect      localhost
// @connect      127.0.0.1
// @updateURL    https://raw.githubusercontent.com/Christie-Norton-McIntosh/ServiceNow-2-Notion/main/dist/ServiceNow-2-Notion.user.js
// @downloadURL  https://raw.githubusercontent.com/Christie-Norton-McIntosh/ServiceNow-2-Notion/main/dist/ServiceNow-2-Notion.user.js
// ==/UserScript==

/* jshint esversion: 8 */
/* global GM_setValue, GM_getValue, GM_xmlhttpRequest, GM_addStyle, GM_getResourceText, GM_notification */

(function() {
    'use strict';
    // Inject runtime version from build process
    window.BUILD_VERSION = "11.0.158";
(function () {

  // Configuration constants and default settings

  // =============================================================================
  // PROVIDER CONSTANTS
  // =============================================================================

  // Use build-injected version if available, otherwise fallback
  const PROVIDER_VERSION = (typeof window !== "undefined" && window.BUILD_VERSION) || "9.0.0";
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
    proxyUrl: "http://127.0.0.1:3004",
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

  // Inject CSS styles once
  let stylesInjected = false;
  function injectStyles() {
    if (stylesInjected) return;
    stylesInjected = true;

    const style = document.createElement("style");
    style.textContent = `
    .${PREFIX}spinner {
      display: block;
      width: 40px;
      height: 40px;
      border: 4px solid #e5e7eb;
      border-top-color: #3b82f6;
      border-radius: 50%;
      animation: ${PREFIX}spin 1s linear infinite;
      margin: 20px auto;
    }

    @keyframes ${PREFIX}spin {
      to { transform: rotate(360deg); }
    }

    .${PREFIX}bar {
      display: block;
      width: 100%;
      height: 8px;
      background: #e5e7eb;
      border-radius: 4px;
      overflow: hidden;
      margin: 20px 0;
    }

    .${PREFIX}bar-fill {
      display: block;
      height: 100%;
      background: linear-gradient(90deg, #3b82f6, #10b981);
      transition: width 0.3s ease;
      border-radius: 4px;
    }

    .${PREFIX}steps {
      list-style: none;
      padding: 0;
      margin: 15px 0;
      max-height: 150px;
      overflow-y: auto;
      font-size: 13px;
      color: #6b7280;
    }

    .${PREFIX}steps li {
      padding: 4px 0;
    }

    .${PREFIX}actions {
      display: flex;
      gap: 10px;
      margin-top: 20px;
      justify-content: flex-end;
      flex-wrap: wrap;
    }

    .${PREFIX}view,
    .${PREFIX}retry,
    .${PREFIX}close,
    .${PREFIX}config {
      padding: 8px 16px;
      border-radius: 4px;
      border: none;
      cursor: pointer;
      font-size: 14px;
      text-decoration: none;
    }

    .${PREFIX}view {
      background: #10b981;
      color: white;
    }

    .${PREFIX}retry {
      background: #f59e0b;
      color: white;
    }

    .${PREFIX}close {
      background: #6b7280;
      color: white;
    }

    .${PREFIX}success-check {
      width: 60px;
      height: 60px;
      border-radius: 50%;
      background: #10b981;
      color: white;
      display: flex;
      align-items: center;
      justify-content: center;
      font-size: 36px;
      font-weight: bold;
      margin: 20px auto;
      animation: ${PREFIX}scale-in 0.3s ease;
    }

    @keyframes ${PREFIX}scale-in {
      from { transform: scale(0); }
      to { transform: scale(1); }
    }

    .${PREFIX}title {
      margin: 0 0 10px 0;
      font-size: 20px;
      font-weight: 600;
      color: #1f2937;
    }

    .${PREFIX}message {
      margin: 10px 0;
      font-size: 14px;
      color: #4b5563;
      min-height: 20px;
    }
  `;
    document.head.appendChild(style);
  }

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
    // Ensure styles are injected
    injectStyles();
    
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

  var overlayProgress = /*#__PURE__*/Object.freeze({
    __proto__: null,
    overlayModule: overlayModule,
    setPropertyMappingModalInjector: setPropertyMappingModalInjector
  });

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
        
        <div style="padding-top:16px; border-top:1px solid #eee; margin-bottom:16px;">
          <button id="w2n-configure-property-mapping" style="width:100%;padding:10px;border-radius:6px;background:#8b5cf6;color:white;border:none;cursor:pointer;font-size:14px;">
            🗺️ Configure Property Mapping
          </button>
        </div>
        
        <div style="display:flex; gap:10px;">
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
    const propertyMappingBtn = modal.querySelector("#w2n-configure-property-mapping");

    function closeModal() {
      if (modal.parentNode) {
        modal.parentNode.removeChild(modal);
      }
    }

    closeBtn.onclick = closeModal;
    cancelBtn.onclick = closeModal;
    
    // Property mapping button handler
    if (propertyMappingBtn) {
      propertyMappingBtn.onclick = () => {
        closeModal();
        // Import and show property mapping modal
        Promise.resolve().then(function () { return propertyMappingModal; }).then(module => {
          module.showPropertyMappingModal();
        }).catch(e => {
          debug("Failed to open property mapping modal:", e);
        });
      };
    }

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
        
        // Log payload size in MB
        const sizeInMB = (stringifiedData.length / (1024 * 1024)).toFixed(2);
        console.log(`📦 apiCall - Payload size: ${sizeInMB} MB`);
        
        // Warn if payload is very large
        if (stringifiedData.length > 10 * 1024 * 1024) { // 10 MB
          console.warn(`⚠️ Large payload detected (${sizeInMB} MB) - this may cause timeout or memory issues`);
        }
      }
      
      console.log(`🌐 apiCall - Sending ${method} request to ${url} with timeout: 300s`);

      GM_xmlhttpRequest({
        method: method,
        url: url,
        headers: {
          "Content-Type": "application/json",
        },
        data: stringifiedData,
        timeout: 300000, // 5 minutes (300 seconds) - matches server-side timeout
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
          // Log full error object for debugging
          console.error("[NETWORK-ERROR] Full error object:", JSON.stringify(error, null, 2));
          console.error("[NETWORK-ERROR] Error keys:", Object.keys(error));
          console.error("[NETWORK-ERROR] Error type:", typeof error);
          console.error("[NETWORK-ERROR] Status code:", error.status);
          console.error("[NETWORK-ERROR] URL attempted:", url);
          
          // Extract meaningful error message
          let errorMsg = "Network error";
          if (error) {
            // Check for specific status codes
            if (error.status === 408) {
              errorMsg = "Request timeout - Server did not respond in time. The page may be too large or the proxy server may be busy.";
            } else if (error.status === 0) {
              errorMsg = "Cannot connect to proxy server. Please ensure:\n1. The proxy server is running (npm start in server/)\n2. Tampermonkey has permission to access localhost\n3. No firewall is blocking the connection";
            } else if (typeof error === 'string') {
              errorMsg = error;
            } else if (error.error) {
              errorMsg = error.error;
            } else if (error.statusText) {
              errorMsg = error.statusText;
            } else if (error.message) {
              errorMsg = error.message;
            }
          }
          
          reject(new Error(`API call failed: ${errorMsg}`));
        },
        ontimeout: function () {
          debug("❌ API call timed out after 5 minutes");
          reject(new Error(`Request timed out after 5 minutes. The page may be too large or processing is taking too long. Try a smaller page or contact support.`));
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
      // Create AbortController for timeout handling
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 300000); // 5 minutes

      const options = {
        method: method,
        headers: {
          "Content-Type": "application/json",
        },
        signal: controller.signal,
      };

      if (data) {
        options.body = JSON.stringify(data);
      }

      const response = await fetch(url, options);
      clearTimeout(timeoutId);

      if (!response.ok) {
        throw new Error(`HTTP error! status: ${response.status}`);
      }

      const result = await response.json();
      return result;
    } catch (error) {
      if (error.name === 'AbortError') {
        debug("❌ Fallback API call timed out after 5 minutes");
        throw new Error(`Request timed out after 5 minutes. The page may be too large or processing is taking too long. Try a smaller page or contact support.`);
      }
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
   * Fetch list of available databases
   * @param {Object} options - Query options
   * @returns {Promise<Array>} List of databases
   */
  async function fetchDatabases(options = {}) {
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
  async function queryDatabase(databaseId, body = {}) {
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
   * Test proxy connection with a simple ping
   * @returns {Promise<boolean>} Whether proxy is reachable
   */
  async function pingProxy() {
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
  async function sendProcessedContentToProxy(processedData) {
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
    const { overlayModule } = await Promise.resolve().then(function () { return overlayProgress; });
    
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
   * Get all available databases with caching
   * @param {Object} options - Query options
   * @returns {Promise<Array>} Array of databases
   */
  async function getAllDatabases(options = {}) {
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

    // Auto-map hardcoded properties (Page URL, Content Source, CurrentReleaseURL)
    // These are automatically extracted and should always be included if the properties exist
    const autoMappings = {
      'Page URL': window.location.href,
      'Content Source': 'ServiceNow Technical Documentation',
      'CurrentReleaseURL': extractedData.CurrentReleaseURL || window.location.href,
    };

    // Debug: Log what CurrentReleaseURL value we have
    debug(`🔍 [CurrentReleaseURL DEBUG] extractedData.CurrentReleaseURL = ${extractedData.CurrentReleaseURL}`);
    debug(`🔍 [CurrentReleaseURL DEBUG] Database has "CurrentReleaseURL" property: ${!!dbProperties['CurrentReleaseURL']}`);
    debug(`🔍 [CurrentReleaseURL DEBUG] Available database properties: ${Object.keys(dbProperties).join(', ')}`);

    Object.entries(autoMappings).forEach(([notionProperty, value]) => {
      if (dbProperties[notionProperty] && value) {
        const propConfig = dbProperties[notionProperty];
        const mappedValue = mapValueToNotionProperty(value, propConfig);
        if (mappedValue !== null) {
          properties[notionProperty] = mappedValue;
          debug(`✅ Auto-mapped: "${notionProperty}" = "${value}"`);
        }
      } else {
        // Debug: Log why auto-mapping failed
        if (!dbProperties[notionProperty]) {
          debug(`⚠️ [AUTO-MAP] Property "${notionProperty}" not found in database`);
        } else if (!value) {
          debug(`⚠️ [AUTO-MAP] Property "${notionProperty}" has no value`);
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

  /**
   * Generate default property mappings based on common ServiceNow fields
   * Maps common content types to Notion properties that might exist
   * @param {Object} schema - Database schema with property definitions
   * @returns {Object} Default property mappings
   */
  function generateDefaultPropertyMappings(schema) {
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

  function showPropertyMappingModal() {
    debug("🔗 Opening property mapping modal");
    injectPropertyMappingModal();
    const modal = document.getElementById("w2n-property-mapping-modal");
    const config = getConfig();
    if (modal && modal.loadDatabaseMappings) {
      modal.loadDatabaseMappings(config.databaseId, config.databaseName);
    }
  }

  var propertyMappingModal = /*#__PURE__*/Object.freeze({
    __proto__: null,
    generateDefaultPropertyMappings: generateDefaultPropertyMappings,
    injectPropertyMappingModal: injectPropertyMappingModal,
    loadPropertyMappings: loadPropertyMappings,
    populatePropertyMappings: populatePropertyMappings,
    resetPropertyMappings: resetPropertyMappings,
    savePropertyMappings: savePropertyMappings,
    setupPropertyMappingModal: setupPropertyMappingModal,
    showPropertyMappingModal: showPropertyMappingModal
  });

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

  // Main floating panel (ported from original createUI())


  // Simple hash function for content comparison
  function simpleHash(str) {
    if (!str || str.length === 0) return 0;
    
    let hash = 0;
    for (let i = 0; i < str.length; i++) {
      const char = str.charCodeAt(i);
      hash = ((hash << 5) - hash) + char;
      hash |= 0; // Convert to 32bit signed integer
    }
    return hash;
  }

  /**
   * Search Notion database for a page with matching title
   * @param {string} databaseId - Database ID to search
   * @param {string} title - Title to search for
   * @returns {Promise<Object|null>} Matching page or null if not found
   */
  async function searchNotionPageByTitle(databaseId, title) {
    if (!databaseId || !title) {
      debug("[AUTOEXTRACT-UPDATE] ⚠️ Missing databaseId or title for search");
      return null;
    }

    try {
      debug(`[AUTOEXTRACT-UPDATE] 🔍 Searching for page with title: "${title}"`);
      
      // Query database with title filter
      const queryBody = {
        filter: {
          property: "title",
          rich_text: {
            equals: title
          }
        },
        page_size: 1
      };

      const response = await queryDatabase(databaseId, queryBody);
      const results = Array.isArray(response?.results) ? response.results : [];

      if (results.length > 0) {
        const page = results[0];
        debug(`[AUTOEXTRACT-UPDATE] ✅ Found existing page: ${page.id}`);
        return page;
      }

      debug(`[AUTOEXTRACT-UPDATE] ⊘ No existing page found with title: "${title}"`);
      return null;
    } catch (error) {
      debug(`[AUTOEXTRACT-UPDATE] ❌ Error searching for page: ${error.message}`);
      return null;
    }
  }

  /**
   * Update existing Notion page via PATCH endpoint
   * @param {string} pageId - Page ID to update
   * @param {Object} extractedData - Extracted page data
   * @returns {Promise<Object>} Update result
   */
  async function updateNotionPage(pageId, extractedData) {
    debug(`[AUTOEXTRACT-UPDATE] 📝 Updating page ${pageId}...`);
    
    try {
      // Prepare PATCH payload (similar to POST but with pageId in URL)
      // Extract the HTML content from the nested structure
      const contentHtml = extractedData.content?.combinedHtml || extractedData.contentHtml || extractedData.content;
      
      if (!contentHtml) {
        debug(`[AUTOEXTRACT-UPDATE] ❌ No content HTML found`);
        debug(`[AUTOEXTRACT-UPDATE]    extractedData.content:`, extractedData.content);
        debug(`[AUTOEXTRACT-UPDATE]    extractedData.contentHtml:`, extractedData.contentHtml);
        throw new Error("No content HTML found in extracted data");
      }
      
      debug(`[AUTOEXTRACT-UPDATE] ✅ Content HTML extracted: ${contentHtml.length} characters`);
      
      // Get database and mappings (same as POST/manual PATCH)
      const config = await getConfig();
      const database = await getDatabase(config.databaseId);
      const mappings = await getPropertyMappings(config.databaseId);
      
      // Apply property mappings (includes CurrentReleaseURL)
      const properties = applyPropertyMappings(extractedData, database, mappings);
      debug(`[AUTOEXTRACT-UPDATE] ✅ Applied ${Object.keys(properties).length} property mappings`);
      
      const patchData = {
        title: extractedData.title,
        contentHtml: contentHtml,
        url: extractedData.url,
        properties: properties, // Include property mappings for AutoExtract PATCH
      };

      debug(`[AUTOEXTRACT-UPDATE] 📦 PATCH payload prepared:`);
      debug(`[AUTOEXTRACT-UPDATE]    title: "${patchData.title}"`);
      debug(`[AUTOEXTRACT-UPDATE]    contentHtml: ${contentHtml.length} chars`);
      debug(`[AUTOEXTRACT-UPDATE]    url: "${patchData.url}"`);
      debug(`[AUTOEXTRACT-UPDATE]    properties: ${Object.keys(properties).join(', ')}`);
      debug(`[AUTOEXTRACT-UPDATE]    pageId: ${pageId}`);

      // Call PATCH endpoint and wait for completion
      debug(`[AUTOEXTRACT-UPDATE] ⏳ Sending PATCH request to /api/W2N/${pageId}...`);
      const result = await apiCall("PATCH", `/api/W2N/${pageId}`, patchData);
      
      debug(`[AUTOEXTRACT-UPDATE] 📬 Received response from server:`, result);

      if (!result || !result.success) {
        throw new Error(result?.error || "PATCH request failed");
      }

      // Log PATCH completion details
      debug(`[AUTOEXTRACT-UPDATE] ✅ PATCH completed in ${result.patchTimeSeconds || 'N/A'}s`);
      debug(`[AUTOEXTRACT-UPDATE]    Blocks deleted: ${result.blocksDeleted || 0}`);
      debug(`[AUTOEXTRACT-UPDATE]    Blocks added: ${result.blocksAdded || 0}`);
      
      // Check validation result if present
      if (result.validation) {
        const validation = result.validation;
        if (validation.hasErrors) {
          debug(`[AUTOEXTRACT-UPDATE] ⚠️ Validation completed with errors`);
          debug(`[AUTOEXTRACT-UPDATE]    Issues: ${validation.issues?.length || 0}`);
          debug(`[AUTOEXTRACT-UPDATE]    Summary: ${validation.summary}`);
        } else {
          debug(`[AUTOEXTRACT-UPDATE] ✅ Validation passed`);
          if (validation.stats) {
            debug(`[AUTOEXTRACT-UPDATE]    Similarity: ${validation.stats.similarity || 'N/A'}%`);
          }
        }
      } else {
        debug(`[AUTOEXTRACT-UPDATE] ℹ️ No validation result (validation may be disabled)`);
      }

      debug(`[AUTOEXTRACT-UPDATE] ✅ Page update and validation complete`);
      return result;
    } catch (error) {
      debug(`[AUTOEXTRACT-UPDATE] ❌ Failed to update page: ${error.message}`);
      throw error;
    }
  }

  function injectMainPanel() {
    if (document.getElementById("w2n-notion-panel")) return;

    const config = getConfig();

    // Helper function to format database ID with hyphens (8-4-4-4-12)
    const formatDatabaseId = (id) => {
      if (!id) return "(no database)";
      // Remove any existing hyphens first
      const cleanId = id.replace(/-/g, '');
      // Format as 8-4-4-4-12
      return cleanId.replace(/^(.{8})(.{4})(.{4})(.{4})(.{12})$/, '$1-$2-$3-$4-$5');
    };

    const panel = document.createElement("div");
    panel.id = "w2n-notion-panel";
    
    // Set base CSS styles
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
    
    // Try to restore saved position from localStorage
    let savedPosition = null;
    try {
      const saved = localStorage.getItem('w2n-panel-position');
      if (saved) {
        savedPosition = JSON.parse(saved);
        // Validate saved position is still on-screen
        const margin = 8;
        const panelWidth = 320;
        const panelHeight = 200; // Estimated minimum height
        
        if (savedPosition.left < margin || 
            savedPosition.top < margin ||
            savedPosition.left + panelWidth > window.innerWidth - margin ||
            savedPosition.top + panelHeight > window.innerHeight - margin) {
          // Saved position is off-screen, reset it
          savedPosition = null;
          localStorage.removeItem('w2n-panel-position');
        } else {
          // Apply saved position
          panel.style.left = `${savedPosition.left}px`;
          panel.style.top = `${savedPosition.top}px`;
          panel.style.right = 'auto'; // Override default right positioning
        }
      }
    } catch (e) {
      debug("Failed to restore panel position from localStorage:", e);
    }

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
        <div>
          <h3 style="margin:0 0 4px 0; font-size:16px; color:#1f2937; display:flex; align-items:center; gap:8px;">
            📚 ServiceNow to Notion
            <span style="font-size:12px; color:#6b7280; font-weight:normal;">⇄ drag to move</span>
          </h3>
          <div style="font-size:11px; color:#9ca3af;">v${window.BUILD_VERSION || "11.0.84"}</div>
        </div>
        <div style="display:flex; align-items:center; gap:8px;">
          <button id="w2n-reset-position-btn" title="Reset panel position to top-right corner" style="background:none;border:none;font-size:16px;cursor:pointer;color:#6b7280;padding:4px;line-height:1;">↗️</button>
          <button id="w2n-advanced-settings-btn" title="Advanced Settings" style="background:none;border:none;font-size:16px;cursor:pointer;color:#6b7280;padding:4px;line-height:1;">⚙️</button>
          <button id="w2n-close" style="background:none;border:none;font-size:18px;cursor:pointer;color:#6b7280;padding:4px;line-height:1;">×</button>
        </div>
      </div>
    </div>

    <div style="padding:16px;">
      <div style="margin-bottom:16px;">
        <label style="display:block;margin-bottom:5px;font-weight:500;">Database:</label>
        <select id="w2n-database-select" style="width:100%;padding:8px;border:1px solid #d1d5db;border-radius:4px;">
          <option value="${config.databaseId || ""}">${config.databaseName || "(no database)"}</option>
        </select>
        <div id="w2n-selected-database-label" style="margin-top:8px;font-size:11px;color:#6b7280;font-family:monospace;">${formatDatabaseId(config.databaseId)}</div>
        <div style="margin-top:8px; display:flex; gap:6px; align-items:center; flex-wrap:wrap;">
          <button id="w2n-search-dbs" style="flex:1; font-size:11px;padding:6px 8px;border:1px solid #10b981;border-radius:4px;background:#10b981;color:white;cursor:pointer;min-width:120px;">🔍 Search (Name/URL/ID)</button>
        </div>
        <div id="w2n-db-spinner" style="display:none; margin-top:8px; font-size:12px; color:#6b7280; align-items:center;">
          <span style="display:inline-block; width:12px; height:12px; border:2px solid #d1d5db; border-top:2px solid #10b981; border-radius:50%; animation:spin 1s linear infinite; margin-right:8px;"></span>
          Fetching databases...
        </div>
      </div>

      <div style="display:grid; gap:8px; margin-bottom:16px;">
        <button id="w2n-capture-page" style="width:100%; padding:12px; background:#8b5cf6; color:white; border:none; border-radius:6px; cursor:pointer; font-weight:500;">📄 Save Current Page</button>
        <button id="w2n-update-page" style="width:100%; padding:12px; background:#3b82f6; color:white; border:none; border-radius:6px; cursor:pointer; font-weight:500;">🔄 Update Current Page</button>
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
          <div style="margin-top:10px; padding:8px; background:#f3f4f6; border-radius:6px;">
            <label style="display:flex; align-items:center; cursor:pointer; font-size:13px;">
              <input type="checkbox" id="w2n-autoextract-update-mode" style="margin-right:8px; cursor:pointer;">
              <span>🔄 Update existing pages (search by title)</span>
            </label>
            <div style="font-size:11px; color:#6b7280; margin-top:4px; margin-left:24px;">
              Updates matching pages, creates new ones with 🆕 if not found
            </div>
          </div>
          <div style="display:flex; gap:8px; margin-top:8px;">
            <button id="w2n-open-icon-cover" style="flex:1; padding:8px; background:#6b7280; color:white; border:none; border-radius:6px; cursor:pointer; font-size:13px;">Icon & Cover</button>
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
    const resetPositionBtn = panel.querySelector("#w2n-reset-position-btn");
    const advancedBtn = panel.querySelector("#w2n-advanced-settings-btn");
    const captureBtn = panel.querySelector("#w2n-capture-page");
    const updateBtn = panel.querySelector("#w2n-update-page");
    const iconCoverBtn = panel.querySelector("#w2n-open-icon-cover");

    closeBtn.onclick = () => panel.remove();
    
    if (resetPositionBtn) {
      resetPositionBtn.onclick = (event) => {
        event.stopPropagation();
        try {
          // Reset to default top-right position
          panel.style.left = 'auto';
          panel.style.right = '20px';
          panel.style.top = '20px';
          // Clear saved position
          localStorage.removeItem('w2n-panel-position');
          showToast("Panel position reset to top-right corner", "success");
        } catch (e) {
          debug("Failed to reset panel position:", e);
        }
      };
    }

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

    if (updateBtn) {
      updateBtn.onclick = async () => {
        try {
          if (
            window.ServiceNowToNotion &&
            typeof window.ServiceNowToNotion.app === "function"
          ) {
            const app = window.ServiceNowToNotion.app();
            if (app && typeof app.handleUpdateExistingPage === "function") {
              await app.handleUpdateExistingPage();
            }
          }
        } catch (e) {
          debug("Failed to execute update action:", e);
        }
      };
    }

    iconCoverBtn.onclick = () => {
      try {
        injectIconCoverModal();
      } catch (e) {
        debug("Failed to open icon cover modal:", e);
      }
    };

    // Database button handlers
    const searchBtn = panel.querySelector("#w2n-search-dbs");
    const databaseSelect = panel.querySelector("#w2n-database-select");
    const databaseLabel = panel.querySelector("#w2n-selected-database-label");


    if (searchBtn) {
      searchBtn.onclick = async () => {
        try {
          const input = prompt("Enter database name, URL, or ID:");
          if (!input || input.trim() === "") return;

          debug(`[DATABASE] 🔍 Searching for database: ${input}`);
          showSpinner();

          const trimmedInput = input.trim();
          let cleanDbId = null;
          let searchByName = true;
          
          // Check if input is a URL and extract the database ID
          if (trimmedInput.includes('notion.so/') || trimmedInput.includes('notion.site/')) {
            debug(`[DATABASE] 🔗 Detected URL input, extracting database ID`);
            
            // Extract ID from URL patterns:
            // https://www.notion.so/username/abc123...
            // https://notion.so/abc123...
            // https://username.notion.site/abc123...
            const urlMatch = trimmedInput.match(/([a-f0-9]{32})|([a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12})/i);
            
            if (urlMatch) {
              cleanDbId = urlMatch[0].replace(/-/g, '');
              searchByName = false;
              debug(`[DATABASE] ✅ Extracted database ID from URL: ${cleanDbId}`);
            } else {
              // URL detected but no valid ID found
              alert(`Could not extract a valid database ID from the URL.\n\nMake sure the URL is a valid Notion database sharing link.`);
              return;
            }
          }
          // Check if input looks like a database ID (32 hex chars with optional hyphens)
          else if (/^[a-f0-9-]{32,36}$/i.test(trimmedInput)) {
            cleanDbId = trimmedInput.replace(/-/g, '');
            searchByName = false;
            debug(`[DATABASE] 🆔 Detected database ID format`);
          }

          // Try to get database by ID first if we extracted/detected one
          if (cleanDbId) {
            try {
              debug(`[DATABASE] 🔍 Getting database by ID: ${cleanDbId}`);
              const dbDetails = await getDatabase(cleanDbId);

              // Update config with validated database
              const config = getConfig();
              config.databaseId = cleanDbId;
              config.databaseName = dbDetails.title || "Database by ID";

              if (typeof GM_setValue === "function") {
                GM_setValue("notionConfig", config);
              }

              // Generate and save default property mappings based on schema
              if (dbDetails.properties) {
                const defaultMappings = generateDefaultPropertyMappings(dbDetails.properties);
                if (Object.keys(defaultMappings).length > 0) {
                  savePropertyMappings(cleanDbId, defaultMappings);
                  debug(`[DATABASE] ✅ Applied ${Object.keys(defaultMappings).length} default property mappings`);
                  showToast(`✅ Applied ${Object.keys(defaultMappings).length} default mappings`, 2000);
                }
              }

              // Update UI
              databaseSelect.innerHTML = `<option value="${cleanDbId}">${config.databaseName}</option>`;
              databaseLabel.textContent = formatDatabaseId(cleanDbId);

              debug(`✅ Set target database to: ${config.databaseName} (${cleanDbId})`);
              showToast(`✅ Found database: ${config.databaseName}`, 2000);
              return;
            } catch (e) {
              const errorMsg = e?.message || e?.toString() || "Unknown error";
              const isNotAccessible = errorMsg.includes("not found") || errorMsg.includes("not shared") || errorMsg.includes("403") || errorMsg.includes("404");
              debug(`[DATABASE] ⚠️ Failed to get database by ID: ${cleanDbId} (${errorMsg})`);
              
              if (isNotAccessible) {
                // Show a helpful message about sharing the database
                alert(
                  `Database ID: ${cleanDbId}\n\n` +
                  `This database is not accessible to your Notion integration.\n\n` +
                  `Make sure:\n` +
                  `1. The database exists in your Notion workspace\n` +
                  `2. You have access to it\n` +
                  `3. It's shared with your Notion integration\n\n` +
                  `How to share a database:\n` +
                  `1. Open the database in Notion\n` +
                  `2. Click "Share" button (top right)\n` +
                  `3. Find your integration/bot in the access list\n` +
                  `4. If not there, add it using "Invite" button\n` +
                  `5. Try again here`
                );
                return;
              }
              
              searchByName = true;
            }
          }

          // Search by name if no ID or ID lookup failed
          if (searchByName) {
            // Query all databases fresh (no cache)
            const databases = await getAllDatabases({ forceRefresh: true });

            debug(
              `📋 Available databases: ${databases
              .map((db) => `${db.id.slice(-8)}: ${db.title || "Untitled"}`)
              .join(", ")}`
            );

            // Find matching database by name
            let matchingDb = databases.find(
              (db) =>
                db.title &&
                typeof db.title === "string" &&
                db.title.toLowerCase().includes(trimmedInput.toLowerCase())
            );

            // If not found by name, try partial ID match (last 8 chars)
            if (!matchingDb && trimmedInput.length >= 8) {
              const partialId = trimmedInput.slice(-8);
              matchingDb = databases.find((db) => db.id.endsWith(partialId));
              if (matchingDb) {
                debug(`[DATABASE] ✅ Found database by partial ID match: ${partialId}`);
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

              // Generate and save default property mappings based on schema
              try {
                const dbDetails = await getDatabase(matchingDb.id);
                if (dbDetails.properties) {
                  const defaultMappings = generateDefaultPropertyMappings(dbDetails.properties);
                  if (Object.keys(defaultMappings).length > 0) {
                    savePropertyMappings(matchingDb.id, defaultMappings);
                    debug(`[DATABASE] ✅ Applied ${Object.keys(defaultMappings).length} default property mappings`);
                  }
                }
              } catch (e) {
                debug(`[DATABASE] ⚠️ Could not fetch schema for default mappings: ${e.message}`);
              }

              // Update UI
              databaseSelect.innerHTML = `<option value="${matchingDb.id}">${config.databaseName}</option>`;
              databaseLabel.textContent = formatDatabaseId(matchingDb.id);

              debug(
                `✅ Set target database to: ${config.databaseName} (${matchingDb.id})`
              );
              showToast(`✅ Found database: ${config.databaseName}`, 2000);
            } else {
              // Provide detailed guidance when database is not found
              const isIdFormat = /^[a-f0-9-]{32,36}$/i.test(trimmedInput);
              let errorMessage = `Database "${trimmedInput}" not found.`;
              
              if (isIdFormat) {
                errorMessage += `\n\nMake sure:\n1. The database ID is correct\n2. You have access to it\n3. It's shared with your Notion integration`;
              } else if (databases.length === 0) {
                errorMessage += `\n\nNo accessible databases found. Make sure at least one database is shared with your Notion integration.`;
              } else {
                errorMessage += `\n\nAvailable databases:\n${databases.slice(0, 5).map(db => `• ${db.title || "Untitled"}`).join("\n")}${databases.length > 5 ? `\n... and ${databases.length - 5} more` : ""}`;
              }
              
              alert(errorMessage);
              debug(`[DATABASE] ❌ Database "${trimmedInput}" not found`);
            }
          }
        } catch (e) {
          const errorMsg = e?.message || e?.toString() || "Unknown error";
          debug("Failed to search database:", errorMsg);
          alert(`Error searching for database: ${errorMsg}\n\nCheck console for details.`);
        } finally {
          hideSpinner();
        }
      };
    }

    // Check for saved autoExtractState from page reload and resume if found
    const savedAutoExtractState = GM_getValue("w2n_autoExtractState");
    debug(`[STATE-MANAGEMENT] 🔍 Checking for saved autoExtractState: ${savedAutoExtractState ? 'FOUND' : 'NOT FOUND'}`);
    if (savedAutoExtractState) {
      try {
        const parsedState = JSON.parse(savedAutoExtractState);
        debug(`[STATE-MANAGEMENT] 🔄 Found saved autoExtractState from page reload:`, parsedState);

        // Check if we've exceeded max reload attempts
        const reloadAttempts = parsedState.reloadAttempts || 0;
        if (reloadAttempts > 3) {
          debug(`[STATE-MANAGEMENT] ❌ Maximum reload attempts (3) exceeded - not resuming`);
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
          debug(`[STATE-MANAGEMENT] ▶️ Resuming auto-extraction after page reload (attempt ${reloadAttempts}/3)...`);
          await resumeAutoExtraction(parsedState);
        }, 2000);
      } catch (e) {
        debug(`[STATE-MANAGEMENT] ❌ Error parsing saved autoExtractState:`, e);
        GM_setValue("w2n_autoExtractState", null);
      }
    }

    // AutoExtract button handlers
    const startAutoExtractBtn = panel.querySelector("#w2n-start-autoextract");
    const stopAutoExtractBtn = panel.querySelector("#w2n-stop-autoextract");

    if (startAutoExtractBtn) {
      startAutoExtractBtn.onclick = async () => {
        console.log(`[AUTO-EXTRACT-DEBUG] 🔵 AutoExtract button onclick handler FIRED`);
        debug(`[AUTO-EXTRACT-DEBUG] 🔵 AutoExtract button onclick handler FIRED`);
        try {
          // Show stop button, hide start button
          startAutoExtractBtn.style.display = "none";
          if (stopAutoExtractBtn) stopAutoExtractBtn.style.display = "block";

          console.log(`[AUTO-EXTRACT-DEBUG] 🔵 Calling startAutoExtraction()...`);
          debug(`[AUTO-EXTRACT-DEBUG] 🔵 Calling startAutoExtraction()...`);
          await startAutoExtraction();
          console.log(`[AUTO-EXTRACT-DEBUG] 🔵 startAutoExtraction() returned`);
          debug(`[AUTO-EXTRACT-DEBUG] 🔵 startAutoExtraction() returned`);

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
        debug("🛑 Stop button clicked - initiating immediate stop");
        
        // Stop the extraction by setting running to false
        if (
          window.ServiceNowToNotion &&
          window.ServiceNowToNotion.autoExtractState
        ) {
          window.ServiceNowToNotion.autoExtractState.running = false;
          
          // Clear saved state to prevent resume on page reload
          GM_setValue("w2n_autoExtractState", null);
          debug("🗑️ Cleared saved autoExtractState");
          
          showToast("⏹ Stopping AutoExtract immediately...", 3000);
          
          // Update overlay to show stopping message
          try {
            if (window.W2NSavingProgress && window.W2NSavingProgress.setMessage) {
              window.W2NSavingProgress.setMessage("⏹ Stopping...");
            }
          } catch (e) {
            debug("Warning: Could not update overlay message:", e);
          }
          
          // Update button text to show it's stopping
          if (startAutoExtractBtn) {
            startAutoExtractBtn.textContent = "⏹ Stopping...";
            startAutoExtractBtn.style.background = "#dc2626"; // Red color
          }
        }
        // Restore buttons
        startAutoExtractBtn.style.display = "block";
        stopAutoExtractBtn.style.display = "none";
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
      
      // Save position to localStorage
      try {
        const rect = panel.getBoundingClientRect();
        const position = {
          left: rect.left,
          top: rect.top
        };
        localStorage.setItem('w2n-panel-position', JSON.stringify(position));
      } catch (e) {
        console.warn('[W2N] Failed to save panel position:', e);
      }
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

  // AutoExtract functionality

  /**
   * Poll validation status endpoint until validation completes
   * @param {string} pageId - Notion page ID (with or without hyphens)
   * @param {number} maxWaitMs - Maximum wait time in milliseconds (default 30s)
   * @returns {Promise<object>} Validation status result
   */
  async function waitForValidation(pageId, maxWaitMs = 30000) {
    const config = getConfig();
    const proxyUrl = config.proxyUrl || 'http://localhost:3004';
    const pollInterval = 2000; // Poll every 2 seconds
    const startTime = Date.now();
    
    debug(`[VALIDATION-POLL] Waiting for validation to complete for page ${pageId}`);
    
    while (Date.now() - startTime < maxWaitMs) {
      try {
        // Poll validation status endpoint
        const response = await fetch(`${proxyUrl}/api/W2N/${pageId}/validation`);
        const statusData = await response.json();
        
        debug(`[VALIDATION-POLL] Status: ${statusData.status}`);
        
        // Check if validation is complete
        if (statusData.status === 'complete') {
          const duration = statusData.duration || (Date.now() - startTime);
          debug(`[VALIDATION-POLL] ✅ Validation complete after ${duration}ms`);
          return statusData;
        }
        
        // Check if validation errored
        if (statusData.status === 'error') {
          debug(`[VALIDATION-POLL] ❌ Validation failed: ${statusData.error || 'Unknown error'}`);
          return statusData;
        }
        
        // Check if status not found (validation may not be enabled)
        if (statusData.status === 'not_found') {
          debug(`[VALIDATION-POLL] ℹ️ No validation status found - validation may not be enabled`);
          return statusData;
        }
        
        // Still pending or running - wait and poll again
        await new Promise(resolve => setTimeout(resolve, pollInterval));
        
      } catch (error) {
        debug(`[VALIDATION-POLL] ⚠️ Error checking validation status: ${error.message}`);
        // If fetch fails, assume validation not enabled and continue
        return { status: 'not_found', error: error.message };
      }
    }
    
    // Timeout reached
    debug(`[VALIDATION-POLL] ⏱️ Timeout after ${maxWaitMs}ms - continuing anyway`);
    return { status: 'timeout', message: 'Validation check timed out' };
  }

  async function startAutoExtraction() {
    console.log(`[AUTO-EXTRACT-DEBUG] 🚀🚀🚀 startAutoExtraction() CALLED - AutoExtract button clicked`);
    debug(`[AUTO-EXTRACT-DEBUG] 🚀🚀🚀 startAutoExtraction() CALLED - AutoExtract button clicked`);
    
    const config = getConfig();
    console.log(`[AUTO-EXTRACT-DEBUG] 📋 Config retrieved: databaseId=${config.databaseId || '(missing)'}`);
    debug(`[AUTO-EXTRACT-DEBUG] 📋 Config retrieved: databaseId=${config.databaseId || '(missing)'}`);
    
    if (!config.databaseId) {
      console.log(`[AUTO-EXTRACT-DEBUG] ❌ BLOCKED: No database ID configured`);
      debug(`[AUTO-EXTRACT-DEBUG] ❌ BLOCKED: No database ID configured`);
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
      processedUrls: new Set(), // Track all processed URLs to prevent duplicates
      lastPageId: null, // Track last page ID to verify navigation
      failedPages: [], // Track pages that failed due to rate limiting or other errors for manual retry
      rateLimitHits: 0, // Track how many times we've hit rate limits
      navigationFailures: 0, // Track consecutive navigation failures
    };

    // Set up beforeunload handler to save state if page is reloaded manually
    const beforeUnloadHandler = (event) => {
      if (autoExtractState.running) {
        debug(`[STATE-MANAGEMENT] ⚠️ Page unloading during AutoExtract - saving state...`);
        const stateToSave = {
          ...autoExtractState,
          reloadAttempts: (autoExtractState.reloadAttempts || 0) + 1,
          // Convert Set to Array for JSON serialization
          processedUrls: Array.from(autoExtractState.processedUrls || []),
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

      await runAutoExtractLoop(autoExtractState, app, nextPageSelector, config);

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
      debug(`[ACCESS-LIMITED] 🔒 Detected access limited page: "${pageTitle}"`);
      return true;
    }

    // Also check for h1 with this message
    const h1Elements = document.querySelectorAll("h1");
    for (const h1 of h1Elements) {
      if (h1.textContent && h1.textContent.includes(limitedMessage)) {
        debug(`[ACCESS-LIMITED] 🔒 Detected access limited message in h1: "${h1.textContent}"`);
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
      setTimeout(() => {
        window.removeEventListener("load", onLoad);
        debug("⏱️ Reload timeout reached");
        resolve(false);
      }, timeoutMs);

      window.addEventListener("load", onLoad);

      // Trigger reload
      window.location.reload();
    });
  }

  async function runAutoExtractLoop(autoExtractState, app, nextPageSelector, config) {
    console.log("[AUTO-EXTRACT-DEBUG] 🔄🔄🔄 runAutoExtractLoop() ENTERED");
    console.log(`[AUTO-EXTRACT-DEBUG]    - autoExtractState.running: ${autoExtractState.running}`);
    console.log(`[AUTO-EXTRACT-DEBUG]    - autoExtractState.paused: ${autoExtractState.paused}`);
    console.log(`[AUTO-EXTRACT-DEBUG]    - nextPageSelector: ${nextPageSelector}`);
    console.log(`[AUTO-EXTRACT-DEBUG]    - config.databaseId: ${config?.databaseId || '(missing)'}`);
    debug("[AUTO-EXTRACT-DEBUG] 🔄🔄🔄 runAutoExtractLoop() ENTERED");
    debug(`[AUTO-EXTRACT-DEBUG]    - autoExtractState.running: ${autoExtractState.running}`);
    debug(`[AUTO-EXTRACT-DEBUG]    - autoExtractState.paused: ${autoExtractState.paused}`);
    debug(`[AUTO-EXTRACT-DEBUG]    - nextPageSelector: ${nextPageSelector}`);
    debug(`[AUTO-EXTRACT-DEBUG]    - config.databaseId: ${config?.databaseId || '(missing)'}`);
    console.log("🔄 Starting AutoExtract loop");
    debug("🔄 Starting AutoExtract loop");

    // Get button reference for progress updates
    const button = document.getElementById("w2n-start-autoextract");

    console.log("[AUTO-EXTRACT-DEBUG] 🔁 Entering while loop...");
    debug("[AUTO-EXTRACT-DEBUG] 🔁 Entering while loop...");
    while (autoExtractState.running && !autoExtractState.paused) {
      console.log(`[AUTO-EXTRACT-DEBUG] ➰ While loop iteration started`);
      debug(`[AUTO-EXTRACT-DEBUG] ➰ While loop iteration started`);
      // Check running state at the very beginning of each iteration
      if (!autoExtractState.running) {
        debug(`[AUTO-EXTRACT] ⏹ AutoExtract stopped at beginning of loop iteration`);
        stopAutoExtract(autoExtractState);
        if (button) button.textContent = "Start AutoExtract";
        return;
      }
      
      autoExtractState.currentPage++;
      const currentPageNum = autoExtractState.currentPage;
      debug(`[AUTO-EXTRACT] 📄 Processing page number: ${currentPageNum}`);

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

        // If access-limited was detected and resolved, give the page extra time to stabilize
        if (accessLimitedReloadAttempts > 0 && !isPageAccessLimited()) {
          debug(`[ACCESS-LIMITED] ✅ Access-limited resolved after ${accessLimitedReloadAttempts} reload(s), stabilizing page...`);
          overlayModule.setMessage(`Page access restored, stabilizing...`);
          await new Promise((resolve) => setTimeout(resolve, 3000));
        }

        // If still access limited after reload attempts, skip this page and move to next
        if (isPageAccessLimited()) {
          debug(
            `[ACCESS-LIMITED] 🔒 Access limited persists after ${maxAccessLimitedReloadAttempts} reload attempts, skipping page ${currentPageNum}...`
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
                `[AUTO-EXTRACT] ⏹ AutoExtract stopped by user after skipping page ${currentPageNum}`
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
          `[AUTO-EXTRACT] ✅ Page ${currentPageNum + 1} fully loaded and ready for capture!`
        );
        debug(`[AUTO-EXTRACT] \n========================================`);
        debug(`[AUTO-EXTRACT] 🔄 Looping back to capture page ${currentPageNum + 1}...`);
        debug(`[AUTO-EXTRACT] ========================================\n`);        // Continue to next iteration
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
        debug(`[AUTO-EXTRACT] 📄 Step 1: Extracting page ${currentPageNum}...`);
        let captureSuccess = false;
        let captureAttempts = 0;
        const maxCaptureAttempts = 3;
        let isDuplicate = false; // Track if this is a duplicate skip (declared outside loop)

        while (captureAttempts < maxCaptureAttempts && !captureSuccess) {
          captureAttempts++;

          try {
            if (captureAttempts > 1) {
              // Check if stop was requested before retry delay
              if (!autoExtractState.running) {
                debug(`[AUTO-EXTRACT] ⏹ AutoExtract stopped before retry delay for page ${currentPageNum}`);
                showToast(
                  `⏹ AutoExtract stopped. Processed ${autoExtractState.totalProcessed} pages.`,
                  4000
                );
                stopAutoExtract(autoExtractState);
                if (button) button.textContent = "Start AutoExtract";
                return;
              }
              
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
              
              // Check again after delay
              if (!autoExtractState.running) {
                debug(`[AUTO-EXTRACT] ⏹ AutoExtract stopped after retry delay for page ${currentPageNum}`);
                showToast(
                  `⏹ AutoExtract stopped. Processed ${autoExtractState.totalProcessed} pages.`,
                  4000
                );
                stopAutoExtract(autoExtractState);
                if (button) button.textContent = "Start AutoExtract";
                return;
              }
            }

        console.log(`[AUTO-EXTRACT-DEBUG] 🚀 Calling app.extractCurrentPageData() for page ${currentPageNum}...`);
        debug(`[AUTO-EXTRACT-DEBUG] 🚀 Calling app.extractCurrentPageData() for page ${currentPageNum}...`);
        const extractedData = await app.extractCurrentPageData();
        console.log(`[AUTO-EXTRACT-DEBUG] ✅ Extraction completed successfully`);
        debug(`[AUTO-EXTRACT-DEBUG] ✅ Extraction completed successfully`);
        
          // DEBUG: Log extracted data structure
          debug(`[AUTO-EXTRACT-DEBUG] 📦 Extracted data for page ${currentPageNum}:`);
          debug(`[AUTO-EXTRACT-DEBUG]    - title: "${extractedData.title || '(missing)'}"`);
          debug(`[AUTO-EXTRACT-DEBUG]    - contentHtml length: ${extractedData.contentHtml?.length || 0}`);
          debug(`[AUTO-EXTRACT-DEBUG]    - content.combinedHtml length: ${extractedData.content?.combinedHtml?.length || 0}`);
          debug(`[AUTO-EXTRACT-DEBUG]    - databaseId: ${extractedData.databaseId || '(missing)'}`);
          debug(`[AUTO-EXTRACT-DEBUG]    - url: ${extractedData.url || '(missing)'}`);

          // STEP 1.5: Check for duplicate content
          // NOTE: Only check duplicates in CREATE mode, not UPDATE mode
          // In UPDATE mode, we want to update the page even if content is the same
          const contentToHash = extractedData.content?.combinedHtml || "";
          const contentHash = simpleHash(contentToHash);

          // Check if we're in update mode - will be checked again later but need it here for duplicate logic
          let updateModeCheckbox2 = document.getElementById('w2n-autoextract-update-mode');
          const isUpdateMode = updateModeCheckbox2?.checked || false;

          debug(`[CONTENT-HASH] 🔍 Content to hash length: ${contentToHash.length} characters`);
          debug(`[CONTENT-HASH] 🔍 Calculated hash: ${contentHash}, Previous hash: ${autoExtractState.lastContentHash}`);
          debug(`[CONTENT-HASH] 🔍 Mode: ${isUpdateMode ? 'UPDATE' : 'CREATE'}`);
          
          // Only check for duplicates in CREATE mode
          if (!isUpdateMode && contentHash === autoExtractState.lastContentHash) {
              autoExtractState.duplicateCount++;
              debug(
                `[CONTENT-HASH] ⚠️ DUPLICATE CONTENT DETECTED in CREATE mode (${autoExtractState.duplicateCount} consecutive)!`
              );
              debug(`[CONTENT-HASH] Hash: ${contentHash}, Last Hash: ${autoExtractState.lastContentHash}`);
              
              if (autoExtractState.duplicateCount >= 3) {
                const errorMessage = `❌ AutoExtract STOPPED: Same page content detected ${autoExtractState.duplicateCount} times in a row.\n\nThis usually means:\n- ServiceNow navigation isn't working\n- You've reached the end of the section\n- There's a navigation loop\n\nTotal pages processed: ${autoExtractState.totalProcessed}\nLast successful page: ${currentPageNum - autoExtractState.duplicateCount}`;
                alert(errorMessage);
                stopAutoExtract(autoExtractState);
                if (button) button.textContent = `❌ Stopped: Duplicate content`;
                return;
              }
              
              // Skip this duplicate and go straight to navigation (don't create page)
              debug(`[CONTENT-HASH] ⊘ Skipping duplicate content in CREATE mode, will retry navigation without creating page...`);
              showToast(
                `⚠️ Duplicate content #${autoExtractState.duplicateCount}, skipping to navigation...`,
                3000
              );
              isDuplicate = true; // Flag this as a duplicate skip
              break; // Break from capture attempts loop to go to navigation
            } else {
              // Content is different, reset duplicate counter
              autoExtractState.duplicateCount = 0;
              autoExtractState.lastContentHash = contentHash;
              debug(`[CONTENT-HASH] ✅ Content is unique (hash: ${contentHash}) or in UPDATE mode - proceeding`);
            }          // Check if stop was requested before creating the page
            if (!autoExtractState.running) {
              debug(`[AUTO-EXTRACT] ⏹ AutoExtract stop requested before creating page ${currentPageNum}`);
              showToast(
                `⏹ AutoExtract stopped before page ${currentPageNum}. Processed ${autoExtractState.totalProcessed} pages.`,
                4000
              );
              stopAutoExtract(autoExtractState);
              if (button) button.textContent = "Start AutoExtract";
              return;
            }

            // STEP 2: Create or Update Notion page based on mode
            const updateModeCheckbox = document.getElementById('w2n-autoextract-update-mode');
            const updateMode = updateModeCheckbox?.checked || false;
            
            debug(`[AUTO-EXTRACT-DEBUG] 🔀 Mode detection:`);
            debug(`[AUTO-EXTRACT-DEBUG]    - updateModeCheckbox element: ${updateModeCheckbox ? 'found' : 'NOT FOUND'}`);
            debug(`[AUTO-EXTRACT-DEBUG]    - updateModeCheckbox.checked: ${updateModeCheckbox?.checked}`);
            debug(`[AUTO-EXTRACT-DEBUG]    - updateMode final value: ${updateMode}`);
            debug(`[AUTO-EXTRACT-DEBUG]    - config.databaseId: ${config.databaseId || '(missing)'}`);

            if (updateMode) {
              // UPDATE MODE: Search for existing page and update
              debug(
                `[AUTO-EXTRACT] 🔄 Step 2: Searching for existing page "${extractedData.title}"...`
              );
              debug(`[AUTO-EXTRACT]    Database ID: ${config.databaseId}`);
              overlayModule.setMessage(`Searching for page "${extractedData.title}"...`);
              
              let existingPage = null;
              try {
                existingPage = await searchNotionPageByTitle(config.databaseId, extractedData.title);
                debug(`[AUTO-EXTRACT] 🔍 Search result:`, existingPage ? `Found page ${existingPage.id}` : 'No page found');
              } catch (searchError) {
                debug(`[AUTO-EXTRACT] ❌ Search failed:`, searchError);
                throw new Error(`Failed to search for page: ${searchError.message}`);
              }
              
              if (existingPage) {
                // Page found, update it
                debug(`[AUTO-EXTRACT] 📝 Updating existing page ${existingPage.id}...`);
                debug(`[AUTO-EXTRACT]    Page title: "${extractedData.title}"`);
                debug(`[AUTO-EXTRACT]    Content length: ${extractedData.content?.combinedHtml?.length || 0} chars`);
                overlayModule.setMessage(`Updating page ${currentPageNum}...`);
                
                let updateResult = null;
                try {
                  // Wait for update to complete (including validation)
                  debug(`[AUTO-EXTRACT] 🚀 Calling updateNotionPage()...`);
                  updateResult = await updateNotionPage(existingPage.id, extractedData);
                  debug(`[AUTO-EXTRACT] ✅ updateNotionPage() completed successfully`);
                } catch (updateError) {
                  debug(`[AUTO-EXTRACT] ❌ updateNotionPage() failed:`, updateError);
                  throw new Error(`Failed to update page: ${updateError.message}`);
                }
                
                // Additional wait after update completes to ensure Notion properties are fully committed
                debug(`[AUTO-EXTRACT] ⏳ Waiting 2s for Notion to commit all changes...`);
                overlayModule.setMessage(`Finalizing update for page ${currentPageNum}...`);
                await new Promise((resolve) => setTimeout(resolve, 2000));
                
                captureSuccess = true;
                autoExtractState.totalProcessed++;
                autoExtractState.totalUpdated = (autoExtractState.totalUpdated || 0) + 1;
                
                // Show validation status in success message
                let statusEmoji = '✅';
                if (updateResult?.validation?.hasErrors) {
                  statusEmoji = '⚠️';
                }
                
                debug(
                  `${statusEmoji} Page ${currentPageNum} updated successfully${
                  captureAttempts > 1 ? ` (attempt ${captureAttempts})` : ""
                }${updateResult?.validation ? ` (validation: ${updateResult.validation.hasErrors ? 'has issues' : 'passed'})` : ''}`
                );
                showToast(`${statusEmoji} Updated: ${extractedData.title}`, 2000);
              } else {
                // Page not found, create new with 🆕 prefix
                debug(`[AUTO-EXTRACT] 🆕 Page "${extractedData.title}" not found, creating new page with 🆕 prefix...`);
                overlayModule.setMessage(`Creating new page ${currentPageNum} with 🆕...`);
                
                // Add 🆕 emoji to title
                const originalTitle = extractedData.title;
                extractedData.title = `🆕 ${originalTitle}`;
                
                await app.processWithProxy(extractedData);
                
                captureSuccess = true;
                autoExtractState.totalProcessed++;
                autoExtractState.totalCreated = (autoExtractState.totalCreated || 0) + 1;
                debug(
                  `✅ Page ${currentPageNum} created with 🆕 prefix successfully${
                  captureAttempts > 1 ? ` (attempt ${captureAttempts})` : ""
                }`
                );
                showToast(`🆕 Created: ${originalTitle}`, 2000);
              }
            } else {
              // CREATE MODE: Normal creation
              debug(
                `[AUTO-EXTRACT] 💾 Step 2: Creating Notion page for page ${currentPageNum}...`
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
            }

            // Brief wait to ensure API call fully completes
            await new Promise((resolve) => setTimeout(resolve, 2000));
          } catch (error) {
            console.log(
              `❌ Capture attempt ${captureAttempts} failed for page ${currentPageNum}:`,
              error
            );
            console.log(`[AUTO-EXTRACT-DEBUG] 🔴 ERROR DETAILS:`);
            console.log(`[AUTO-EXTRACT-DEBUG]    - error.name: ${error.name}`);
            console.log(`[AUTO-EXTRACT-DEBUG]    - error.message: ${error.message}`);
            console.log(`[AUTO-EXTRACT-DEBUG]    - error.stack: ${error.stack?.substring(0, 500)}`);
            console.log(`[AUTO-EXTRACT-DEBUG]    - typeof error: ${typeof error}`);
            debug(
              `❌ Capture attempt ${captureAttempts} failed for page ${currentPageNum}:`,
              error
            );
            debug(`[AUTO-EXTRACT-DEBUG] 🔴 ERROR DETAILS:`);
            debug(`[AUTO-EXTRACT-DEBUG]    - error.name: ${error.name}`);
            debug(`[AUTO-EXTRACT-DEBUG]    - error.message: ${error.message}`);
            debug(`[AUTO-EXTRACT-DEBUG]    - error.stack: ${error.stack?.substring(0, 500)}`);
            debug(`[AUTO-EXTRACT-DEBUG]    - typeof error: ${typeof error}`);
            
            // Check if stop was requested during error handling
            if (!autoExtractState.running) {
              debug(`[AUTO-EXTRACT] ⏹ AutoExtract stopped during error handling for page ${currentPageNum}`);
              showToast(
                `⏹ AutoExtract stopped. Processed ${autoExtractState.totalProcessed} pages.`,
                4000
              );
              stopAutoExtract(autoExtractState);
              if (button) button.textContent = "Start AutoExtract";
              return;
            }
            
            // Check if this is a rate limit error
            const isRateLimited = error.message && (
              error.message.toLowerCase().includes('rate limit') ||
              error.message.includes('429') ||
              error.message.includes('too many requests')
            );
            
            if (isRateLimited) {
              autoExtractState.rateLimitHits++;
              
              // Save the failed page info for manual retry if needed
              const failedPageInfo = {
                pageNumber: currentPageNum,
                url: window.location.href,
                title: document.title,
                timestamp: new Date().toISOString(),
                reason: 'rate_limit',
                errorMessage: error.message
              };
              autoExtractState.failedPages.push(failedPageInfo);
              
              const waitSeconds = 60; // Default to 60 seconds if not specified in error
              debug(`🚦 RATE LIMIT HIT during AutoExtract on page ${currentPageNum}`);
              debug(`   Total rate limit hits this session: ${autoExtractState.rateLimitHits}`);
              debug(`   Pausing AutoExtract for ${waitSeconds} seconds...`);
              debug(`   Failed page saved for retry: ${failedPageInfo.title}`);
              
              showToast(
                `⏸️ Rate limit hit! Pausing for ${waitSeconds}s before retrying...`,
                5000
              );
              
              if (button) {
                button.textContent = `⏸️ Paused: Rate limit (${waitSeconds}s)...`;
              }
              
              overlayModule.setMessage(`⏸️ Rate limit - waiting ${waitSeconds}s...`);
              
              // Wait for cooldown
              await new Promise(resolve => setTimeout(resolve, waitSeconds * 1000));
              
              debug(`✅ Rate limit cooldown complete, retrying page ${currentPageNum}...`);
              showToast(
                `✅ Cooldown complete, retrying page ${currentPageNum}...`,
                3000
              );
              
              // Remove from failed pages list since we're going to retry immediately
              autoExtractState.failedPages.pop();
              
              // Retry the same page (don't increment page counter)
              // Set captureAttempts to maxCaptureAttempts - 1 to allow one final retry
              captureAttempts = maxCaptureAttempts - 1;
              continue; // Continue capture loop to retry
            }
            
            // Check if this is a server offline error (connection refused, network error, etc.)
            const isServerOffline = error.message && (
              error.message.includes('Proxy server is not available') ||
              error.message.includes('fetch failed') ||
              error.message.includes('Failed to fetch') ||
              error.message.includes('Network request failed') ||
              error.message.includes('ECONNREFUSED') ||
              error.message.toLowerCase().includes('connection')
            );
            
            if (isServerOffline) {
              const errorMessage = `❌ AutoExtract STOPPED: Server appears to be offline.\n\nError: ${error.message}\n\nPlease check that the proxy server is running and try again.\n\nTotal pages processed: ${autoExtractState.totalProcessed}`;
              alert(errorMessage);
              stopAutoExtract(autoExtractState);
              if (button) button.textContent = "❌ Stopped: Server offline";
              return;
            }
            
            if (captureAttempts < maxCaptureAttempts) {
              showToast(
                `⚠️ Page capture failed (attempt ${captureAttempts}/${maxCaptureAttempts}). Retrying...`,
                4000
              );
            }
          }
        }

        // Check if stop was requested after capture attempts
        if (!autoExtractState.running) {
          debug(`[AUTO-EXTRACT] ⏹ AutoExtract stopped after capture attempts for page ${currentPageNum}`);
          showToast(
            `⏹ AutoExtract stopped. Processed ${autoExtractState.totalProcessed} pages.`,
            4000
          );
          stopAutoExtract(autoExtractState);
          if (button) button.textContent = "Start AutoExtract";
          return;
        }

        // Check if capture failed (but allow duplicate skip to proceed to navigation)
        if (!captureSuccess && !isDuplicate) {
          const errorMessage = `❌ AutoExtract STOPPED: Page ${currentPageNum} failed to capture after ${maxCaptureAttempts} attempts.\n\nTotal pages processed: ${autoExtractState.totalProcessed}`;
          alert(errorMessage);
          stopAutoExtract(autoExtractState);
          if (button)
            button.textContent = `❌ Stopped: Page ${currentPageNum} failed`;
          return;
        }
        
        // If this was a duplicate skip, don't increment the page number counter
        // (we'll retry the same page after navigation)
        if (isDuplicate) {
          debug(`⊘ Duplicate detected - will navigate and retry extraction on next page`);
          overlayModule.setMessage(`Skipping duplicate, navigating to next...`);
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
    debug(`[AUTO-EXTRACT] ▶️ Resuming auto-extraction with saved state:`, savedState);

    // Restore the autoExtractState
    const autoExtractState = {
      ...savedState,
      running: true,
      paused: false,
      // Restore processedUrls Set from array (JSON doesn't support Set)
      processedUrls: new Set(savedState.processedUrls || []),
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
      debug(`[AUTO-EXTRACT] ❌ Error resuming auto-extraction:`, error);
      const errorMessage = `❌ Resume AutoExtract ERROR: ${error.message}\n\nTotal pages processed: ${autoExtractState.totalProcessed}`;
      alert(errorMessage);
      stopAutoExtract(autoExtractState);
    }
  }

  /**
   * Continue the auto-extraction loop from a specific state (used after page reload)
   */
  async function continueAutoExtractionLoop(autoExtractState) {
    debug("[AUTO-EXTRACT] 🔄 Continuing AutoExtract loop from saved state");
    debug(
      `[AUTO-EXTRACT] 📊 Resumed state: currentPage=${autoExtractState.currentPage}, totalProcessed=${autoExtractState.totalProcessed}`
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
      debug(`[AUTO-EXTRACT] \n🔄 Loop iteration: currentPage=${autoExtractState.currentPage}`);

      autoExtractState.currentPage++;
      const currentPageNum = autoExtractState.currentPage;
      debug(`[AUTO-EXTRACT] 📄 Processing page number: ${currentPageNum}`);

      overlayModule.setMessage(`Extracting page ${currentPageNum}...`);

      // Update button with progress
      if (button) {
        button.textContent = `Processing page ${currentPageNum}...`;
      }

      try {
        // Get current page identifiers for duplicate detection
        const currentUrl = window.location.href;
        const currentPageId = getCurrentPageId();
        
        // Check for duplicate URL (same page being processed again)
        // BUT: If we just had a navigation failure, this is expected (we're retrying navigation)
        const isExpectedDuplicate = autoExtractState.navigationFailures > 0;
        
        // Flag to skip extraction and go straight to navigation
        let skipExtraction = false;
        
        if (autoExtractState.processedUrls.has(currentUrl)) {
          if (isExpectedDuplicate) {
            debug(`[NAV-RETRY] ⚠️ DUPLICATE URL DETECTED (Expected due to navigation failure): ${currentUrl}`);
            debug(`[NAV-RETRY]    Navigation failures: ${autoExtractState.navigationFailures}`);
            debug(`[NAV-RETRY]    Skipping extraction and going straight to navigation retry`);
            // Skip all extraction and processing, go straight to navigation
            skipExtraction = true;
          } else {
            debug(`⚠️ DUPLICATE URL DETECTED (Unexpected): ${currentUrl}`);
            debug(`❌ This URL was already processed in this session!`);
            
            // Increment duplicate counter ONLY for unexpected duplicates
            autoExtractState.duplicateCount = (autoExtractState.duplicateCount || 0) + 1;
            
            if (autoExtractState.duplicateCount >= 3) {
              const errorMsg = `AutoExtract stopped: Same page detected ${autoExtractState.duplicateCount} times in a row.\n\nURL: ${currentUrl}\n\nThis usually means the "Next Page" button is not working correctly or you've reached a loop in the navigation.\n\nTotal pages processed: ${autoExtractState.totalProcessed}`;
              alert(errorMsg);
              stopAutoExtract(autoExtractState);
              if (button) button.textContent = "Start AutoExtract";
              return;
            }
            
            // Skip processing this duplicate and try to navigate
            debug(`⏭️ Skipping duplicate page (count: ${autoExtractState.duplicateCount})...`);
            skipExtraction = true;
          }
        } else {
          // Reset duplicate counter for new pages
          autoExtractState.duplicateCount = 0;
        }
        
        // Only extract if this is not a duplicate that we're skipping
        let extractedData = null;
        if (!skipExtraction) {
          // Extract current page data using the app instance
          debug(`[AUTO-EXTRACT] 📝 Step 1: Extracting content from page ${currentPageNum}...`);
          overlayModule.setMessage(`Extracting content from page ${currentPageNum}...`);
          extractedData = await app.extractCurrentPageData();

          if (!extractedData) {
            throw new Error("No content extracted from page");
          }

          // Skip processing if this is a duplicate URL
          if (autoExtractState.processedUrls.has(currentUrl)) {
            debug(`⏭️ Skipping Notion processing for duplicate URL`);
          } else {
            // Add URL to processed set
            autoExtractState.processedUrls.add(currentUrl);
            autoExtractState.lastPageId = currentPageId;
            
            // Process and save to Notion with rate limit retry
            debug(`[AUTO-EXTRACT] 📤 Saving page ${currentPageNum} to Notion...`);
            overlayModule.setMessage(`Processing page ${currentPageNum}...`);
          
            // Retry logic for rate limits
            const maxRateLimitRetries = 3;
            let rateLimitRetryCount = 0;
            let processingSuccess = false;
            
            while (rateLimitRetryCount <= maxRateLimitRetries && !processingSuccess) {
              try {
                // Process the content using the app's processWithProxy method
                // This will internally show more detailed messages like:
                // - "Checking proxy connection..."
                // - "Converting content to Notion blocks..."
                // - "Page created successfully!"
                const result = await app.processWithProxy(extractedData);
                
                // If we get here without throwing, it succeeded
                processingSuccess = true;
                
                autoExtractState.totalProcessed++;
                debug(`[AUTO-EXTRACT] ✅ Page ${currentPageNum} saved to Notion`);
                
                // Wait for validation to complete if page ID is available
                if (result && result.data && result.data.page && result.data.page.id) {
                  const pageId = result.data.page.id;
                  debug(`[AUTO-EXTRACT] ⏳ Waiting for validation to complete for page ${pageId}...`);
                  overlayModule.setMessage(`✓ Page ${currentPageNum} saved! Waiting for validation...`);
                  
                  try {
                    const validationStatus = await waitForValidation(pageId, 30000); // 30 second timeout
                    
                    if (validationStatus.status === 'complete') {
                      const duration = validationStatus.duration ? `${(validationStatus.duration / 1000).toFixed(1)}s` : 'unknown time';
                      debug(`[AUTO-EXTRACT] ✅ Validation complete after ${duration}`);
                      overlayModule.setMessage(`✓ Page ${currentPageNum} validated! Continuing...`);
                    } else if (validationStatus.status === 'error') {
                      debug(`[AUTO-EXTRACT] ⚠️ Validation failed but continuing anyway`);
                      overlayModule.setMessage(`✓ Page ${currentPageNum} saved (validation failed). Continuing...`);
                    } else if (validationStatus.status === 'not_found' || validationStatus.status === 'timeout') {
                      debug(`[AUTO-EXTRACT] ℹ️ Validation status: ${validationStatus.status} - continuing`);
                      overlayModule.setMessage(`✓ Page ${currentPageNum} saved! Continuing...`);
                    }
                  } catch (validationError) {
                    debug(`[AUTO-EXTRACT] ⚠️ Error waiting for validation: ${validationError.message}`);
                    // Non-fatal - continue with AutoExtract
                    overlayModule.setMessage(`✓ Page ${currentPageNum} saved! Continuing...`);
                  }
                } else {
                  // No page ID available - skip validation check
                  debug(`[AUTO-EXTRACT] ℹ️ No page ID available - skipping validation check`);
                  overlayModule.setMessage(`✓ Page ${currentPageNum} saved! Continuing...`);
                }
              } catch (processingError) {
                // Check if this is a rate limit error
                const errorMessage = processingError.message || '';
                const isRateLimit = errorMessage.includes('Rate limit') || 
                                   errorMessage.includes('rate limited') ||
                                   errorMessage.includes('429');
                
                if (isRateLimit && rateLimitRetryCount < maxRateLimitRetries) {
                  rateLimitRetryCount++;
                  const waitTime = Math.min(30 * Math.pow(2, rateLimitRetryCount - 1), 120); // 30s, 60s, 120s
                  
                  debug(`⚠️ [RATE-LIMIT] Hit rate limit on page ${currentPageNum}, waiting ${waitTime}s before retry ${rateLimitRetryCount}/${maxRateLimitRetries}...`);
                  
                  if (button) {
                    button.textContent = `⏳ Rate limit - waiting ${waitTime}s...`;
                  }
                  
                  showToast(
                    `⚠️ Rate limit hit. Waiting ${waitTime} seconds before retry ${rateLimitRetryCount}/${maxRateLimitRetries}...`,
                    waitTime * 1000
                  );
                  
                  overlayModule.setMessage(`⏳ Rate limit - waiting ${waitTime}s...`);
                  
                  // Wait with countdown
                  for (let i = waitTime; i > 0; i -= 5) {
                    await new Promise(resolve => setTimeout(resolve, 5000));
                    if (button) {
                      button.textContent = `⏳ Retry in ${i}s...`;
                    }
                  }
                  
                  debug(`🔄 [RATE-LIMIT] Retrying page ${currentPageNum} after cooldown...`);
                } else {
                  // Check if this is a timeout error (v11.0.6)
                  const isTimeout = errorMessage.includes('timeout') || 
                                   errorMessage.includes('Timeout') ||
                                   errorMessage.includes('timed out');
                  
                  if (isTimeout) {
                    debug(`⚠️ [TIMEOUT-RECOVERY] Request timed out for page ${currentPageNum}`);
                    debug(`⚠️ [TIMEOUT-RECOVERY] Server may still be processing. Waiting 60s to check if page was created...`);
                    
                    overlayModule.setMessage(`⏳ Timeout - checking if page was created...`);
                    
                    // Wait 60 seconds for server to finish processing
                    await new Promise(resolve => setTimeout(resolve, 60000));
                    
                    // TODO: Query Notion to check if page exists and trigger validation
                    // For now, log warning and continue (page may have been created with unresolved markers)
                    debug(`⚠️ [TIMEOUT-RECOVERY] Unable to verify page creation. It may exist with unresolved markers.`);
                    debug(`⚠️ [TIMEOUT-RECOVERY] Run marker sweep script manually on database if needed.`);
                    
                    showToast(
                      `⚠️ Timeout on page ${currentPageNum}. Page may exist but need marker cleanup.`,
                      8000
                    );
                    
                    // Count as processed (even though we can't confirm)
                    autoExtractState.totalProcessed++;
                    processingSuccess = true; // Continue to next page
                  } else {
                    // Not a rate limit or timeout error, or we've exhausted retries - rethrow
                    throw processingError;
                  }
                }
              }
            }
            
            if (!processingSuccess) {
              throw new Error(`Failed to process page ${currentPageNum} after ${maxRateLimitRetries} rate limit retries`);
            }
          }
        } else {
          debug(`[NAV-RETRY] ⏩ Skipped extraction for expected duplicate, proceeding to navigation...`);
        }

        // Navigate to next page
        const beforeNavUrl = window.location.href;
        const beforeNavPageId = currentPageId;
        
        // Save autoExtractState before navigation in case of browser reload
        debug(`[STATE-MANAGEMENT] 💾 Saving autoExtractState before navigation (page ${currentPageNum + 1})`);
        const stateToSave = {
          ...autoExtractState,
          // Convert Set to Array for JSON serialization
          processedUrls: Array.from(autoExtractState.processedUrls || []),
        };
        const stateJson = JSON.stringify(stateToSave);
        GM_setValue("w2n_autoExtractState", stateJson);
        
        const nextButton = await findAndClickNextButton(
          nextPageSelector,
          autoExtractState,
          button
        );

        if (!nextButton) {
          debug(`[NEXT-BUTTON] ❌ Could not find next page button after reload attempt`);
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

        // Actually click the next button
        debug(`[NEXT-BUTTON] 🖱️ Clicking next button...`);
        await clickNextPageButton(nextButton);

        // Wait for page navigation
        debug(`[AUTO-EXTRACT] ⏳ Step 4: Waiting for page navigation...`);
        if (button) {
          button.textContent = `Loading page ${currentPageNum + 1}...`;
        }
        await new Promise((resolve) => setTimeout(resolve, 3000));

        // Brief stabilization wait
        debug(`[AUTO-EXTRACT] ⏳ Step 5: Stabilizing page ${currentPageNum + 1}...`);
        await new Promise((resolve) => setTimeout(resolve, 1000));
        
        // Verify that navigation actually occurred
        const afterNavUrl = window.location.href;
        const afterNavPageId = getCurrentPageId();
        
        if (afterNavUrl === beforeNavUrl && afterNavPageId === beforeNavPageId) {
          debug(`⚠️ WARNING: URL and Page ID did not change after clicking next button!`);
          debug(`   Before: ${beforeNavUrl} | ${beforeNavPageId}`);
          debug(`   After:  ${afterNavUrl} | ${afterNavPageId}`);
          
          // Increment navigation failure counter
          autoExtractState.navigationFailures = (autoExtractState.navigationFailures || 0) + 1;
          debug(`[NAV-RETRY] 🔢 Navigation failure count: ${autoExtractState.navigationFailures}`);
          
          // Navigation failed - retry a few times before giving up
          const maxNavigationRetries = 2;
          let navigationRetryCount = 0;
          let navigationSucceeded = false;
          
          while (navigationRetryCount < maxNavigationRetries && !navigationSucceeded) {
            navigationRetryCount++;
            debug(`[NAV-RETRY] 🔄 Navigation failed, retrying ${navigationRetryCount}/${maxNavigationRetries}...`);
            
            showToast(
              `⚠️ Navigation failed, retrying (${navigationRetryCount}/${maxNavigationRetries})...`,
              3000
            );
            
            if (button) {
              button.textContent = `⚠️ Nav retry ${navigationRetryCount}/${maxNavigationRetries}...`;
            }
            
            // Wait a bit before retrying
            await new Promise((resolve) => setTimeout(resolve, 2000));
            
            // Find and click next button again
            const retryNextButton = await findAndClickNextButton(
              nextPageSelector,
              autoExtractState,
              button
            );
            
            if (!retryNextButton) {
              debug(`[NAV-RETRY] ❌ Could not find next button on retry ${navigationRetryCount}`);
              break;
            }
            
            // Actually click the button on retry
            debug(`[NAV-RETRY] 🖱️ Clicking next button (retry ${navigationRetryCount})...`);
            await clickNextPageButton(retryNextButton);
            
            // Wait for navigation
            debug(`[NAV-RETRY] ⏳ Waiting for navigation (retry ${navigationRetryCount})...`);
            await new Promise((resolve) => setTimeout(resolve, 3000));
            await new Promise((resolve) => setTimeout(resolve, 1000));
            
            // Check if navigation succeeded this time
            const retryAfterUrl = window.location.href;
            const retryAfterPageId = getCurrentPageId();
            
            if (retryAfterUrl !== beforeNavUrl || retryAfterPageId !== beforeNavPageId) {
              debug(`[NAV-RETRY] ✅ Navigation succeeded on retry ${navigationRetryCount}!`);
              debug(`[NAV-RETRY]    New URL: ${retryAfterUrl}`);
              navigationSucceeded = true;
              
              // Reset navigation failure counter on success
              autoExtractState.navigationFailures = 0;
              
              showToast(
                `✅ Navigation successful on retry ${navigationRetryCount}`,
                2000
              );
            } else {
              debug(`[NAV-RETRY] ❌ Navigation still failed on retry ${navigationRetryCount}`);
              debug(`[NAV-RETRY]    URL still: ${retryAfterUrl}`);
            }
          }
          
          // If all retries failed, this might be end of book
          if (!navigationSucceeded) {
            debug(`[NAV-RETRY] ❌ Navigation failed after ${maxNavigationRetries} retries`);
            debug(`[NAV-RETRY] 🤔 This might be the end of the book or a navigation issue`);
            
            // Show end-of-book confirmation dialog
            const continueExtraction = await showEndOfBookConfirmation(autoExtractState);
            
            if (!continueExtraction) {
              debug(`[NAV-RETRY] ⏹ User confirmed end of extraction`);
              stopAutoExtract(autoExtractState);
              if (button) button.textContent = "Start AutoExtract";
              return;
            }
            
            debug(`[NAV-RETRY] ▶️ User wants to continue - will try again next iteration`);
          }
        } else {
          debug(`✅ Navigation verified: Page changed successfully`);
          debug(`   New URL: ${afterNavUrl}`);
          debug(`   New Page ID: ${afterNavPageId}`);
          
          // Reset navigation failure counter on successful navigation
          autoExtractState.navigationFailures = 0;
        }

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
    debug(`[AUTO-EXTRACT] 🎉 AutoExtract completed! Total pages processed: ${autoExtractState.totalProcessed}`);
    
    // Prepare stats summary
    const totalUpdated = autoExtractState.totalUpdated || 0;
    const totalCreated = autoExtractState.totalCreated || 0;
    const totalNormalCreated = autoExtractState.totalProcessed - totalUpdated - totalCreated;
    
    if (totalUpdated > 0 || totalCreated > 0) {
      debug(`[AUTO-EXTRACT] 📊 Stats: ${totalNormalCreated + totalCreated} created (${totalCreated} with 🆕), ${totalUpdated} updated`);
    }
    
    // Show summary of any failed pages
    if (autoExtractState.failedPages && autoExtractState.failedPages.length > 0) {
      debug(`⚠️ ${autoExtractState.failedPages.length} page(s) failed during AutoExtract:`);
      autoExtractState.failedPages.forEach((failedPage, index) => {
        debug(`  ${index + 1}. Page ${failedPage.pageNumber}: "${failedPage.title}"`);
        debug(`     URL: ${failedPage.url}`);
        debug(`     Reason: ${failedPage.reason}`);
        debug(`     Time: ${failedPage.timestamp}`);
      });
      
      // Save failed pages list to localStorage for manual retry
      if (typeof GM_setValue === 'function') {
        GM_setValue('w2n_failed_pages', JSON.stringify(autoExtractState.failedPages));
        debug(`💾 Failed pages saved to storage for manual retry`);
      }
      
      // Build stats summary for alert
      let statsLine = `✅ Successfully processed: ${autoExtractState.totalProcessed} pages`;
      if (totalUpdated > 0 || totalCreated > 0) {
        const allCreated = totalNormalCreated + totalCreated;
        const parts = [];
        if (allCreated > 0) {
          if (totalCreated > 0) {
            parts.push(`${allCreated} created (${totalCreated} with 🆕)`);
          } else {
            parts.push(`${allCreated} created`);
          }
        }
        if (totalUpdated > 0) parts.push(`${totalUpdated} updated`);
        statsLine += ` (${parts.join(', ')})`;
      }
      
      // Show warning to user
      const failedPagesMessage = `⚠️ AutoExtract completed with warnings!\n\n` +
        `${statsLine}\n` +
        `❌ Failed/Skipped: ${autoExtractState.failedPages.length} pages\n` +
        `🚦 Rate limit hits: ${autoExtractState.rateLimitHits}\n\n` +
        `Failed pages list:\n` +
        autoExtractState.failedPages.map((fp, i) => 
          `${i + 1}. ${fp.title || 'Untitled'} (page ${fp.pageNumber})\n   Reason: ${fp.reason}`
        ).join('\n') +
        `\n\nFailed pages have been saved. You can manually retry them later.`;
      
      alert(failedPagesMessage);
      
      showToast(
        `⚠️ Completed with ${autoExtractState.failedPages.length} failed pages. See console for details.`,
        7000
      );
    } else {
      // Build success message
      let successMsg = `✅ AutoExtract complete! Processed ${autoExtractState.totalProcessed} page(s)`;
      if (totalUpdated > 0 || totalCreated > 0) {
        const allCreated = totalNormalCreated + totalCreated;
        const parts = [];
        if (allCreated > 0) {
          if (totalCreated > 0) {
            parts.push(`${allCreated} created (${totalCreated} with 🆕)`);
          } else {
            parts.push(`${allCreated} created`);
          }
        }
        if (totalUpdated > 0) parts.push(`${totalUpdated} updated`);
        successMsg += ` (${parts.join(', ')})`;
      }
      
      showToast(successMsg, 5000);
    }
    
    overlayModule.done({
      success: true,
      pageUrl: null,
      autoCloseMs: 5000,
    });
    
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
        debug(`[NEXT-BUTTON] ⚠️ Next page button not found, reloading and retrying...`);

        // Save autoExtractState to localStorage before reload
        if (autoExtractState) {
          // Increment reload attempts
          autoExtractState.reloadAttempts = (autoExtractState.reloadAttempts || 0) + 1;
          
          // Check if we've exceeded max reload attempts
          if (autoExtractState.reloadAttempts > 3) {
            debug(`[STATE-MANAGEMENT] ❌ Maximum reload attempts (3) exceeded`);
            alert(
              `❌ AutoExtract stopped: Maximum reload attempts (3) exceeded.\n\nThe page failed to load properly after 3 reload attempts.\n\nTotal pages processed: ${autoExtractState.totalProcessed}`
            );
            stopAutoExtract(autoExtractState);
            return null;
          }

          debug(`[STATE-MANAGEMENT] 💾 Saving autoExtractState before reload (attempt ${autoExtractState.reloadAttempts}/3):`, autoExtractState);
          const stateToSave = {
            ...autoExtractState,
            // Convert Set to Array for JSON serialization
            processedUrls: Array.from(autoExtractState.processedUrls || []),
          };
          const stateJson = JSON.stringify(stateToSave);
          GM_setValue("w2n_autoExtractState", stateJson);
          
          // Verify save succeeded
          const verification = GM_getValue("w2n_autoExtractState");
          debug(`[STATE-MANAGEMENT] ✅ State save verified: ${verification === stateJson ? 'SUCCESS' : 'FAILED'}`);
        }

        // Reload the page and wait for it to load
        debug(
          `[STATE-MANAGEMENT] 🔄 Reloading page to refresh DOM elements (reload attempt ${autoExtractState.reloadAttempts}/3)...`
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
    debug("[AUTO-EXTRACT] 🛑 stopAutoExtract called - cleaning up");
    
    autoExtractState.running = false;
    overlayModule.setProgress(100);
    overlayModule.done({
      success: true,
      autoCloseMs: 5000,
    });

    // Restore button visibility and appearance
    const startBtn = document.getElementById("w2n-start-autoextract");
    const stopBtn = document.getElementById("w2n-stop-autoextract");
    
    if (startBtn) {
      startBtn.style.display = "block";
      startBtn.textContent = "Start AutoExtract";
      startBtn.style.background = "#f59e0b"; // Restore orange color
    }
    if (stopBtn) {
      stopBtn.style.display = "none";
    }

    // Clear saved state to prevent resume on page reload
    GM_setValue("w2n_autoExtractState", null);
    debug("[STATE-MANAGEMENT] 🗑️ Cleared saved autoExtractState in stopAutoExtract");

    // Clean up global state
    if (window.ServiceNowToNotion && window.ServiceNowToNotion.autoExtractState) {
      delete window.ServiceNowToNotion.autoExtractState;
    }
  }

  // Advanced navigation detection with multiple checks including pageId
  async function waitForNavigationAdvanced(
    originalUrl,
    originalTitle,
    originalPageId,
    originalContentLength,
    timeoutMs = 15000
  ) {
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
          debug(`[NAV-VERIFICATION] 🔍 Navigation check ${attempts}/${maxAttempts}:`, {
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
          debug(`[NAV-VERIFICATION] ❌ Navigation timeout after ${maxAttempts} seconds`);
          debug(`[NAV-VERIFICATION] Final state:`, {
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
            debug(`[NEXT-BUTTON] ✅ Found parent clickable: ${current.tagName}`);
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
        debug(`[NEXT-BUTTON] ⚠️ Saved selector failed: ${savedSelector}`, e);
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
            debug(`[NEXT-BUTTON] 🎯 Found next page element with SVG selector: ${selector}`);
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
            debug(`[NEXT-BUTTON] ⏭️ Skipping current page element: ${element.className}`);
            continue;
          }

          if (isElementVisible(element)) {
            debug(`[NEXT-BUTTON] 🔍 Found next page element with pattern: ${pattern}`);
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
            debug(`[NEXT-BUTTON] 🎯 Found next page element with SVG child indicator`);
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
      let versionText = getPrefixedMatch("version", SERVICENOW_SELECTORS.version);

      // Fallback: Try to extract version from URL if not found in page
      if (!versionText) {
        const urlMatch = window.location.href.match(/\/bundle\/([^\/]+)/);
        if (urlMatch && urlMatch[1]) {
          // Extract version name from bundle URL (e.g., "yokohama-platform-user-interface" -> "Yokohama")
          const bundleName = urlMatch[1];
          const versionMatch = bundleName.match(/^([a-z]+)-/i);
          if (versionMatch) {
            // Capitalize first letter
            versionText =
              versionMatch[1].charAt(0).toUpperCase() + versionMatch[1].slice(1);
            debug(`📦 Extracted version from URL bundle: "${versionText}"`);
          }
        }
      }

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
      // Fallback: Use title as category if no category found
      if (!categoryText && titleText) {
        categoryText = titleText;
        debug(`📝 Category fallback: using title as category: "${categoryText}"`);
      }

      // Section extraction with special handling - use title if specific anchor not found
      let sectionText = "";
      const sectionAnchorSelector =
        "#zDocsTopicPage > div.zDocsTopicPageTopicContainer > div.zDocsTopicPageBreadcrumbsContainer > div > span:nth-child(4) > a";
      const sectionAnchor = document.querySelector(sectionAnchorSelector);
      debug(
        `🔍 Section anchor check: selector="${sectionAnchorSelector}", found=${!!sectionAnchor}`
      );
      if (sectionAnchor) {
        debug(
          `✅ Section anchor found, text: "${sectionAnchor.textContent?.trim()}"`
        );
        // If the specific anchor exists, extract text from it
        sectionText = getPrefixedMatch("section", SERVICENOW_SELECTORS.section);
        if (!sectionText) {
          sectionText = getPrefixedMatch("Section", SERVICENOW_SELECTORS.section);
        }
        // If still no text but anchor exists, try getting text directly from anchor
        if (!sectionText) {
          sectionText = sectionAnchor.textContent?.trim() || "";
        }
        debug(`📝 Final sectionText from anchor: "${sectionText}"`);
      } else {
        debug(`❌ Section anchor not found, using title as section`);
        // Use the title as the section when the anchor is not found
        sectionText = titleText;
        debug(`📝 Section set to title: "${sectionText}"`);
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
    console.log("🚀🚀🚀 EXTRACTION STARTED - extractContentWithIframes called");
    console.log("   - contentElement tagName:", contentElement?.tagName);
    console.log("   - contentElement id:", contentElement?.id);
    console.log("   - contentElement class:", contentElement?.className);
    
    let combinedHtml = "";
    let combinedImages = [];

    // Handle case where no content element is found
    if (!contentElement) {
      console.log("⚠️⚠️⚠️ No content element provided!");
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
          console.log("✅✅✅ iframeDoc successfully accessed");
          console.log("   - iframeDoc.body exists:", !!iframeDoc.body);
          console.log("   - iframeDoc.body innerHTML length:", iframeDoc.body?.innerHTML?.length || 0);
          
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
          console.log("🔎🔎🔎 Starting Strategy 1: Checking bookContentSelectors");
          const bookContentSelectors = [
            ".zDocsTopicPageBody", // ServiceNow docs - capture page body including article AND contentPlaceholder (Related Content)
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
            console.log(`   🔍 Testing selector: "${selector}"`);
            const container = iframeDoc.querySelector(selector);
            console.log(`      - Element found:`, !!container);
            console.log(`      - innerHTML length:`, container?.innerHTML?.trim().length || 0);
            
            if (container?.innerHTML?.trim().length > 200) {
              console.log(`   ✅ Selector matched! Using: "${selector}"`);
              iframeContent = container.innerHTML;
              
              // 🔍 DIAGNOSTIC: Count articles and nav elements in extracted content
              const articleCount = (iframeContent.match(/<article[^>]*>/g) || []).length;
              const h2Count = (iframeContent.match(/<h2[^>]*>/g) || []).length;
              const navCount = (iframeContent.match(/<nav[^>]*>/g) || []).length;
              console.log(`🔍🔍🔍 EXTRACTION DIAGNOSTIC (${selector}):`);
              console.log(`   - Content length: ${iframeContent.length} chars`);
              console.log(`   - Article tags found: ${articleCount}`);
              console.log(`   - H2 headings found: ${h2Count}`);
              console.log(`   - Nav tags found: ${navCount}`);
              console.log(`   - First 500 chars:`, iframeContent.substring(0, 500));
              
              debug(`📄 Strategy 1 (${selector}): ${iframeContent.length} chars, ${articleCount} articles, ${h2Count} h2 headings, ${navCount} nav elements`);
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
              // BUT: Keep nav elements that are inside article/section tags (these are "Related Links" content)
              // Note: Can't use descendant selectors in :not(), so we'll remove manually
              const navElements = mainClone.querySelectorAll(
                "nav, [role='navigation'], .navigation, .breadcrumb, .menu, header, footer"
              );
              navElements.forEach((el) => {
                // Keep nav elements that are inside article or section tags
                const isInsideArticleOrSection = el.closest('article, section');
                if (!isInsideArticleOrSection) {
                  el.remove();
                }
              });

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

                // DON'T replace img tags - let the server handle images in tables
                // The server will extract images from <figure> elements and create separate image blocks
                // Replace img tags with bullet symbol
                // if (imgMatches) {
                //   result = result.replace(/<img[^>]*>/gi, " • ");
                //   replacedCount += imgCount;
                //   debug(`✅ Replaced ${imgCount} img tags with bullets`);
                // }

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
      console.log("📄📄📄 Regular content processing - cloning and filtering nav elements");

      // Clone the content element to avoid modifying the original DOM
      const contentClone = contentElement.cloneNode(true);

      // Apply nav filtering - remove navigation elements that are NOT inside article/section
      const navElements = contentClone.querySelectorAll(
        "nav, [role='navigation'], .navigation, .breadcrumb, .menu, header, footer"
      );
      console.log(`📄 Found ${navElements.length} navigation elements in regular content`);
      console.log(`📄 contentClone tagName: ${contentClone.tagName}, id: ${contentClone.id}, class: ${contentClone.className}`);
      
      let removedCount = 0;
      navElements.forEach((el, index) => {
        const parentArticle = el.closest('article');
        const parentSection = el.closest('section');
        const isInsideArticleOrSection = el.closest('article, section');
        const elPreview = el.outerHTML?.substring(0, 200) || '';
        
        console.log(`📄 Nav ${index + 1}: tagName=${el.tagName}, role=${el.getAttribute('role')}, class=${el.className}`);
        console.log(`   - parentArticle: ${parentArticle ? parentArticle.tagName + '#' + (parentArticle.id || 'no-id') : 'none'}`);
        console.log(`   - parentSection: ${parentSection ? parentSection.tagName + '#' + (parentSection.id || 'no-id') : 'none'}`);
        console.log(`   - Preview: ${elPreview}`);
        
        if (!isInsideArticleOrSection) {
          console.log(`   ❌ Removing nav: ${el.tagName} (not inside article/section)`);
          el.remove();
          removedCount++;
        } else {
          console.log(`   ✅ Keeping nav: ${el.tagName} (inside article/section)`);
        }
      });
      console.log(`📄 Removed ${removedCount} navigation elements, kept ${navElements.length - removedCount}`);

      // Look for nested iframes and extract their content
      const nestedIframes = contentClone.querySelectorAll("iframe");
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

      // If no iframe content found, use the filtered element content
      if (!combinedHtml) {
        combinedHtml = contentClone.outerHTML || contentClone.innerHTML;
        const navCount = (combinedHtml.match(/<nav[^>]*>/g) || []).length;
        console.log(`📄 Using filtered content: ${combinedHtml.length} chars, ${navCount} nav tags`);
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

        // DON'T replace img tags - let the server handle images in tables
        // The server will extract images from <figure> elements and create separate image blocks
        // Replace img tags with bullet symbol
        // if (imgMatches) {
        //   result = result.replace(/<img[^>]*>/gi, " • ");
        //   replacedCount += imgCount;
        //   debug(`✅ Replaced ${imgCount} img tags with bullets`);
        // }

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

    // Clean the HTML content (removes unwanted elements, processes code-toolbar, etc.)
    combinedHtml = cleanHtmlContent(combinedHtml);

    // Filter out "Related Content" sections before sending to server
    // This prevents AUDIT validation from showing them as "extra" content
    // Server-side filtering also exists, but userscript filtering ensures cleaner AUDIT results
    const tempDiv = document.createElement('div');
    tempDiv.innerHTML = combinedHtml;
    
    // Remove contentPlaceholder elements that contain "Related Content"
    const contentPlaceholders = tempDiv.querySelectorAll('.contentPlaceholder');
    let removedCount = 0;
    contentPlaceholders.forEach(cp => {
      const text = cp.textContent.trim().toLowerCase();
      const headings = cp.querySelectorAll('h1, h2, h3, h4, h5, h6');
      const hasRelatedContentHeading = Array.from(headings).some(h => 
        h.textContent.trim().toLowerCase().includes('related content')
      );
      
      if (text.includes('related content') || hasRelatedContentHeading) {
        debug(`🗑️ Filtering out Related Content section from userscript extraction`);
        cp.remove();
        removedCount++;
      }
    });
    
    if (removedCount > 0) {
      combinedHtml = tempDiv.innerHTML;
      debug(`✅ Filtered out ${removedCount} Related Content section(s) in userscript`);
    }

    return { combinedHtml, combinedImages };
  }

  /**
   * Find the best content selector for the current page
   * @returns {HTMLElement|null} The content element or null if not found
   */
  function findContentElement() {
    console.log("🚀 ServiceNow-2-Notion - Finding content element (prioritizing .zDocsTopicPageBody, excluding header)");
    debug("🔍 Searching for content element...");

    // Priority order of content selectors (most specific first)
    const contentSelectors = [
      // ServiceNow docs specific - MOST SPECIFIC: capture only the body, not the header
      // This selector targets the actual page content and excludes navigation breadcrumbs
      "#zDocsContent > div.zDocsTopicPageBody",  // Direct child selector - most accurate
      ".zDocsTopicPageBody",                      // Fallback class-only selector
      "#zDocsContent .zDocsTopicPageBody",        // Fallback descendant selector
      
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
          
          // If we found a ServiceNow-specific selector, verify we're excluding the header
          if (selector.includes('zDocsTopicPageBody')) {
            // Verify this element doesn't contain the zDocsContent > header
            const parentZDocs = element.closest('#zDocsContent');
            if (parentZDocs) {
              const header = parentZDocs.querySelector(':scope > header');
              if (header && element.contains(header)) {
                debug(`⚠️ Element contains header, this shouldn't happen with direct child selector`);
              } else {
                debug(`✅ Confirmed: Element excludes #zDocsContent > header (as expected)`);
              }
            }
          }
          
          return element;
        }
      } catch (e) {
        debug(`❌ Invalid selector: ${selector}`);
      }
    }

    // If no main content found, look for sections with specific IDs that might contain content
    const sectionSelectors = [
      "[id*='customize-script-includes']", // ServiceNow script includes sections
      "section[id]", // Any section with an ID
      "div[id]", // Any div with an ID
    ];

    for (const selector of sectionSelectors) {
      try {
        const elements = document.querySelectorAll(selector);
        for (const element of elements) {
          if (
            element &&
            element.innerHTML &&
            element.innerHTML.trim().length > 100
          ) {
            debug(
              `✅ Found content section using selector: ${selector} (id: ${element.id})`
            );
            debug(
              `📏 Section content length: ${element.innerHTML.length} characters`
            );
            return element;
          }
        }
      } catch (e) {
        debug(`❌ Invalid section selector: ${selector}`);
      }
    }

    debug("❌ No suitable content element found");
    return null;
  }

  /**
   * Clean HTML content by removing unwanted elements and fixing common issues
   * @param {string} htmlContent - Raw HTML content
   * @returns {string} Cleaned HTML content
   */
  function cleanHtmlContent(htmlContent) {
    if (!htmlContent || typeof htmlContent !== "string") {
      return "";
    }

    try {
      // Create a temporary document to manipulate HTML safely
      const doc = new DOMParser().parseFromString(htmlContent, "text/html");
      const navCountBefore = doc.querySelectorAll('nav, [role="navigation"]').length;
      console.log(`🧹 cleanHtmlContent START: ${htmlContent.length} chars, ${navCountBefore} nav elements`);

      // Remove unwanted elements
      const unwantedSelectors = [
        "script",
        "style",
        "meta",
        'link[rel="stylesheet"]',
        ".advertisement",
        ".ads",
        ".sidebar",
        // Note: .navigation and .breadcrumb removed from here - handled separately below
        ".search",
        '[class*="search"]',
        // Note: button, input, form removed - they might contain or wrap content
        ".skip-link",
      ];

      unwantedSelectors.forEach((selector) => {
        const elements = doc.querySelectorAll(selector);
        if (elements.length > 0) {
          console.log(`🧹 Checking ${elements.length} elements matching "${selector}"`);
        }
        elements.forEach((el) => {
          // Check if element is inside a nav that's inside article/section
          const insideNav = el.closest('nav, [role="navigation"]');
          const insideArticle = el.closest('article, section');
          
          const elHtmlLength = el.outerHTML?.length || 0;
          
          // Log what we're checking for large elements
          if (elHtmlLength > 200) {
            console.log(`🔍 Large ${el.tagName} (${elHtmlLength} chars): insideNav=${!!insideNav}, insideArticle=${!!insideArticle}`);
          }
          
          // Don't remove if inside content nav
          if (insideNav && insideArticle) {
            console.log(`✅ Preserving ${el.tagName} (${elHtmlLength} chars) inside content nav (selector: ${selector})`);
            return; // Skip removal
          }
          
          // Log removals
          if (elHtmlLength > 200) {
            console.log(`🧹 Removing large ${el.tagName} (${elHtmlLength} chars) matching "${selector}"`);
          }
          
          el.remove();
        });
      });

      // Check length after removing unwanted elements
      const afterUnwantedHtml = doc.body.innerHTML;
      const navCountAfterUnwanted = (afterUnwantedHtml.match(/<nav[^>]*>/g) || []).length;
      console.log(`🧹 After removing unwanted: ${afterUnwantedHtml.length} chars, ${navCountAfterUnwanted} nav elements`);

      // Remove navigation elements that are NOT inside article/section
      // (Keep content-related navigation like "Related Links")
      const navElements = doc.querySelectorAll(".navigation, .breadcrumb, nav, [role='navigation']");
      navElements.forEach((el) => {
        const isInsideArticleOrSection = el.closest('article, section');
        if (!isInsideArticleOrSection) {
          console.log(`🧹 cleanHtmlContent: Removing ${el.tagName}.${el.className} (not inside article/section)`);
          el.remove();
        } else {
          console.log(`🧹 cleanHtmlContent: Keeping ${el.tagName}.${el.className} (inside article/section)`);
        }
      });

      // Remove empty paragraphs and divs (but preserve pre/code elements)
      const emptyElements = doc.querySelectorAll(
        "p:empty, div:empty, span:empty"
      );
      console.log(`🧹 cleanHtmlContent: Found ${emptyElements.length} empty elements to remove`);
      emptyElements.forEach((el) => el.remove());

      // Remove elements with only whitespace (but preserve pre/code elements)
      const textNodes = doc.querySelectorAll("p, div, span");
      let whitespaceRemoved = 0;
      textNodes.forEach((el) => {
        // Don't remove code blocks or their parents
        if (
          el.tagName === "PRE" ||
          el.tagName === "CODE" ||
          el.querySelector("pre, code")
        ) {
          return;
        }
        if (el.textContent.trim() === "" && el.children.length === 0) {
          whitespaceRemoved++;
          el.remove();
        }
      });
      console.log(`🧹 cleanHtmlContent: Removed ${whitespaceRemoved} whitespace-only elements`);

      // Clean up image references
      const images = doc.querySelectorAll("img");
      images.forEach((img) => {
        // Don't remove images that are inside <figure> elements (tables need these)
        const isInFigure = img.closest('figure');
        if (isInFigure) {
          console.log('🔍 Skipping image inside figure:', img.outerHTML.substring(0, 150));
          return; // Keep images in figures
        }
        
        // Remove broken image references
        const src = img.getAttribute("src");
        if (
          !src ||
          src.includes("data:image/svg+xml") ||
          src.includes("[Invalid Image:")
        ) {
          img.remove();
        }
      });

      // Remove table search labels (ServiceNow specific)
      removeTableSearchLabels(doc);

      // Process code-toolbar elements as code blocks
      processCodeToolbarElements(doc);

      const cleanedHtml = doc.body.innerHTML;
      const navCountAfter = (cleanedHtml.match(/<nav[^>]*>/g) || []).length;
      console.log(`🧹 cleanHtmlContent END: ${cleanedHtml.length} chars, ${navCountAfter} nav elements`);
      
      debug(`✅ HTML content cleaned successfully`);
      return cleanedHtml;
    } catch (error) {
      debug("❌ Error cleaning HTML content:", error);
      return htmlContent; // Return original if cleaning fails
    }
  }

  /**
   * Process code-toolbar elements and format as code blocks
   * @param {Document} doc - Document object to process
   */
  function processCodeToolbarElements(doc) {
    try {
      let processedCount = 0;

      // Find all elements with code-toolbar class (more inclusive selector)
      const codeToolbarElements = doc.querySelectorAll(
        '.code-toolbar, [class*="code-toolbar"], div[class*="code"], pre[class*="code"]'
      );

      debug(`🔍 Found ${codeToolbarElements.length} potential code elements`);

      codeToolbarElements.forEach((element, index) => {
        debug(
          `🔍 Processing potential code element ${index + 1} (${
          element.tagName
        }.${element.className || "no-class"}):`,
          element.outerHTML.substring(0, 300)
        );

        // Look for pre > code structure within the element
        const preElement = element.querySelector("pre");
        const codeElement = element.querySelector("code");

        debug(
          `🔍 Element ${
          index + 1
        } - Pre element found: ${!!preElement}, Code element found: ${!!codeElement}`
        );

        // Check if this element itself is a pre or code element
        const isPreElement = element.tagName === "PRE";
        const isCodeElement = element.tagName === "CODE";

        if (isPreElement || isCodeElement) {
          debug(
            `🔍 Element ${index + 1} is already a ${
            element.tagName
          }, checking language`
          );
          // Ensure it has proper language class
          if (!element.className || !element.className.includes("language-")) {
            // Try to detect language from content
            const content = element.textContent || element.innerText || "";
            if (
              content.includes("var ") ||
              content.includes("function ") ||
              content.includes("Class.create") ||
              content.includes("Object.extendsObject") ||
              content.includes("prototype =") ||
              content.includes("= Class.create") ||
              content.includes(".prototype")
            ) {
              element.className = "language-javascript";
              element.setAttribute("data-language", "javascript");
              debug(
                `✅ Added language-javascript class to existing ${
                element.tagName
              } element ${index + 1}`
              );
            }
          }

          // If this pre element is nested inside a block element, move it to be a sibling
          const parent = element.parentNode;
          if (
            parent &&
            ["DIV", "P", "SECTION", "ARTICLE"].includes(parent.tagName)
          ) {
            debug(`🔍 Moving nested pre element ${index + 1} to top level`);
            // Insert the pre element after the parent element
            parent.parentNode.insertBefore(element, parent.nextSibling);
          }

          processedCount++;
          return;
        }

        if (preElement && codeElement) {
          // Extract the code content
          const codeContent =
            codeElement.textContent || codeElement.innerText || "";

          // Get language from class if available (e.g., language-javascript)
          let language = "";
          const codeClasses = codeElement.className || "";
          const languageMatch = codeClasses.match(/language-(\w+)/);
          if (languageMatch) {
            language = languageMatch[1];
          }

          // Detect JavaScript-like code and override language if needed
          if (!language || language === "plaintext" || language === "text") {
            if (
              codeContent.includes("var ") ||
              codeContent.includes("function ") ||
              codeContent.includes("Class.create") ||
              codeContent.includes("Object.extendsObject") ||
              codeContent.includes("prototype =") ||
              codeContent.includes("= Class.create") ||
              codeContent.includes(".prototype")
            ) {
              language = "javascript";
              debug(
                `🔍 Detected JavaScript-like code, overriding language to: ${language}`
              );
            }
          }

          // Create a new pre element with proper formatting for Notion
          const newPre = doc.createElement("pre");

          if (language) {
            newPre.className = `language-${language}`;
            newPre.setAttribute("data-language", language);
          }

          newPre.textContent = codeContent;

          // Replace the code-toolbar element with the cleaned pre element
          // If the parent is a block element, insert the pre as a sibling instead of replacing
          const parent = element.parentNode;
          if (
            parent &&
            ["DIV", "P", "SECTION", "ARTICLE"].includes(parent.tagName)
          ) {
            // Insert the pre element after the parent element
            parent.parentNode.insertBefore(newPre, parent.nextSibling);
            // Remove the original code-toolbar element
            element.remove();
          } else {
            // Safe to replace directly
            parent.replaceChild(newPre, element);
          }
          processedCount++;

          debug(
            `✅ Processed code-toolbar element with ${
            language || "no"
          } language, ${codeContent.length} chars: ${codeContent.substring(
            0,
            100
          )}`
          );
        } else if (preElement) {
          // Just a pre element without code wrapper - still process it
          debug(`🔍 Found pre element without code wrapper, processing anyway`);
          const codeContent =
            preElement.textContent || preElement.innerText || "";

          let language = "";
          const preClasses = preElement.className || "";
          const languageMatch = preClasses.match(/language-(\w+)/);
          if (languageMatch) {
            language = languageMatch[1];
          }

          // Detect JavaScript-like code and override language if needed
          if (!language || language === "plaintext" || language === "text") {
            if (
              codeContent.includes("var ") ||
              codeContent.includes("function ") ||
              codeContent.includes("Class.create") ||
              codeContent.includes("Object.extendsObject") ||
              codeContent.includes("prototype =") ||
              codeContent.includes("= Class.create") ||
              codeContent.includes(".prototype")
            ) {
              language = "javascript";
              debug(
                `🔍 Detected JavaScript-like code in pre element, overriding language to: ${language}`
              );
            }
          }

          // Create a new pre element with proper formatting
          const newPre = doc.createElement("pre");

          if (language) {
            newPre.className = `language-${language}`;
            newPre.setAttribute("data-language", language);
          }

          newPre.textContent = codeContent;

          // Replace the container element with the cleaned pre element
          // If the parent is a block element, insert the pre as a sibling instead of replacing
          const parent = element.parentNode;
          if (
            parent &&
            ["DIV", "P", "SECTION", "ARTICLE"].includes(parent.tagName)
          ) {
            // Insert the pre element after the parent element
            parent.parentNode.insertBefore(newPre, parent.nextSibling);
            // Remove the original container element
            element.remove();
          } else {
            // Safe to replace directly
            parent.replaceChild(newPre, element);
          }
          processedCount++;

          debug(
            `✅ Processed pre element with ${language || "no"} language, ${
            codeContent.length
          } chars`
          );
        } else {
          debug(
            `❌ Code element ${index + 1} missing pre or code child elements`
          );
        }
      });

      // Also look for any pre elements that might not be in code-toolbar containers
      const allPreElements = doc.querySelectorAll("pre");
      debug(`🔍 Found ${allPreElements.length} total pre elements in document`);

      allPreElements.forEach((pre, index) => {
        const parent = pre.parentElement;
        const isInCodeToolbar =
          parent &&
          (parent.classList.contains("code-toolbar") ||
            parent.matches('[class*="code-toolbar"]'));
        debug(
          `🔍 Pre element ${index + 1} ${
          isInCodeToolbar ? "(in code-toolbar)" : "(not in code-toolbar)"
        }:`,
          pre.outerHTML.substring(0, 200)
        );

        // Don't check parent anymore - just ensure proper formatting
        if (true) {
          // Check if this pre element contains JavaScript-like code
          const preContent = pre.textContent || pre.innerText || "";
          if (
            preContent.includes("var ") ||
            preContent.includes("function ") ||
            preContent.includes("Class.create") ||
            preContent.includes("Object.extendsObject") ||
            preContent.includes("prototype =") ||
            preContent.includes("= Class.create") ||
            preContent.includes(".prototype")
          ) {
            debug(
              `🔍 Pre element ${
              index + 1
            } contains JavaScript-like code, ensuring it's properly formatted`
            );

            // Ensure it has language class if it contains JS code
            if (
              !pre.className ||
              !pre.className.includes("language-") ||
              pre.className.includes("language-plaintext")
            ) {
              pre.className = "language-javascript";
              pre.setAttribute("data-language", "javascript");
              debug(
                `✅ Added language-javascript class to pre element ${index + 1}`
              );
            }
          }
        }
      });

      if (processedCount > 0) {
        debug(`✅ Processed ${processedCount} code element(s) as code blocks`);
      } else {
        debug(`⚠️ No code elements were processed`);
      }
    } catch (error) {
      debug("❌ Error processing code elements:", error);
    }
  }

  /**
   * Remove table search labels (ServiceNow specific cleanup)
   * @param {Document} doc - Document object to clean
   */
  function removeTableSearchLabels(doc) {
    try {
      let removedCount = 0;

      // Find all table containers
      const tableContainers = doc.querySelectorAll(
        "table, .table, [class*='table']"
      );

      tableContainers.forEach((table) => {
        // Find labels with "Search:" text
        const searchLabels = Array.from(
          table.querySelectorAll("label, .label, [class*='label']")
        ).filter(
          (label) => label.textContent && label.textContent.includes("Search:")
        );

        searchLabels.forEach((label) => {
          if (label.textContent.trim() === "Search:") {
            // Remove the entire label if it only contains "Search:"
            label.remove();
            removedCount++;
          } else {
            // Remove only the "Search:" text if the label contains other content
            const textNodes = Array.from(label.childNodes).filter(
              (node) =>
                node.nodeType === Node.TEXT_NODE &&
                node.textContent.includes("Search:")
            );
            textNodes.forEach((textNode) => textNode.remove());
            removedCount++;
          }
        });
      });

      debug(`✅ Removed ${removedCount} search label(s) from table content`);
    } catch (error) {
      debug("❌ Error removing table search labels:", error);
    }
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
      // Avoid creating duplicate "Save to Notion" UI: if the floating panel
      // is present, we already provide a "Save Current Page" button there.
      // Skip creating the main action button to prevent duplicates.
      if (document.getElementById("w2n-notion-panel")) {
        debug("ℹ️ Floating panel detected, skipping main action button creation");
        return;
      }

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
      // If the floating panel exists, it already includes an Advanced Settings
      // gear; skip creating a duplicate settings button in the page header.
      if (document.getElementById("w2n-notion-panel")) {
        debug("ℹ️ Floating panel detected, skipping settings button creation");
        return;
      }

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
      // Try different selectors for different ServiceNow layouts (old and new)
      const selectors = [
        // Modern ServiceNow Polaris UI
        ".sn-polaris-nav .sn-action-buttons",
        ".sn-polaris-header .action-bar",
        ".sn-polaris-toolbar",
        ".sn-polaris-nav",

        // General header/action areas
        ".header-actions",
        ".action-bar",
        ".button-bar",
        ".nav-actions",

        // Legacy selectors (still used in some instances)
        ".navbar-right",
        ".toolbar",
        "#gsft_main",

        // Content header areas
        ".content-header",
        ".page-header .actions",
        ".main-header",

        // Component navigation wrappers (docs pages)
        ".cmp-nav__wrapper",
        "nav.cmp-nav",
        
        // Generic fallbacks
        "header .actions",
        ".navbar .actions",
        "nav",
        "header",
      ];

      for (const selector of selectors) {
        const container = document.querySelector(selector);
        if (container) {
          debug(`✅ Found button container: ${selector}`);
          return container;
        }
      }

      // Debug: Show what containers ARE available
      debug("🔍 No matching container found. Available page structure:");
      debug("  - Header elements:", document.querySelectorAll("header").length);
      debug("  - Nav elements:", document.querySelectorAll("nav").length);
      debug("  - Toolbar elements:", document.querySelectorAll('[class*="toolbar"]').length);
      debug("  - Action elements:", document.querySelectorAll('[class*="action"]').length);
      debug("  - Polaris elements:", document.querySelectorAll('[class*="polaris"]').length);
      
      // Log first few class names of major containers to help identify structure
      const mainContainers = document.querySelectorAll("body > *");
      if (mainContainers.length > 0) {
        debug("  - Top-level containers:", Array.from(mainContainers).slice(0, 5).map(el => el.className || el.tagName).join(", "));
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
        overlayModule.start("Starting extraction...");

        // Extract data from current page
        overlayModule.setMessage("Extracting page metadata...");
        const extractedData = await this.extractCurrentPageData();
        this.currentExtractedData = extractedData;

        overlayModule.setMessage("Preparing content for Notion...");

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
     * Handle update existing page button click
     */
    async handleUpdateExistingPage() {
      if (this.isProcessing) {
        debug("⚠️ Already processing, ignoring click");
        return;
      }

      this.isProcessing = true;

      try {
        // Prompt for page ID or URL
        const input = prompt("Enter the Notion Page ID or URL to update:");
        if (!input || input.trim() === "") {
          overlayModule.close();
          this.isProcessing = false;
          return;
        }

        const trimmedInput = input.trim();
        let cleanPageId = null;
        
        // Check if input is a URL and extract the page ID
        if (trimmedInput.includes('notion.so/') || trimmedInput.includes('notion.site/')) {
          debug(`[UPDATE-PAGE] 🔗 Detected URL input, extracting page ID`);
          
          // Extract ID from URL patterns:
          // https://www.notion.so/username/Page-Title-abc123...
          // https://notion.so/abc123...
          // https://username.notion.site/abc123...
          const urlMatch = trimmedInput.match(/([a-f0-9]{32})|([a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12})/i);
          
          if (urlMatch) {
            cleanPageId = urlMatch[0].replace(/-/g, '');
            debug(`[UPDATE-PAGE] ✅ Extracted page ID from URL: ${cleanPageId}`);
          } else {
            alert("Could not extract a valid page ID from the URL. Please check the URL and try again.");
            overlayModule.close();
            this.isProcessing = false;
            return;
          }
        } else if (/^[a-f0-9-]{32,36}$/i.test(trimmedInput)) {
          // Input looks like a page ID (32 hex chars with optional hyphens)
          cleanPageId = trimmedInput.replace(/-/g, '');
          debug(`[UPDATE-PAGE] ✅ Using page ID: ${cleanPageId}`);
        } else {
          alert("Invalid input. Please enter a valid Notion page URL or page ID (32 hexadecimal characters).");
          overlayModule.close();
          this.isProcessing = false;
          return;
        }

        // Validate final page ID format
        if (!/^[a-f0-9]{32}$/i.test(cleanPageId)) {
          alert("Invalid Page ID format. Must be 32 hexadecimal characters.");
          overlayModule.close();
          this.isProcessing = false;
          return;
        }

        // Show progress overlay
        overlayModule.start("Starting extraction...");

        // Extract data from current page
        overlayModule.setMessage("Extracting page metadata...");
        const extractedData = await this.extractCurrentPageData();
        this.currentExtractedData = extractedData;

        overlayModule.setMessage("Updating Notion page...");

        // Call PATCH endpoint
        await this.updateExistingPage(cleanPageId, extractedData);
      } catch (error) {
        debug("❌ Update existing page failed:", error);
        try {
          overlayModule.error({
            message: `Failed to update Notion page: ${error.message}`,
          });
        } catch (e) {
          try {
            overlayModule.close && overlayModule.close();
          } catch (err) {}
        }
        showErrorPanel("Failed to update Notion page: " + error.message);
      } finally {
        this.isProcessing = false;
      }
    }

    /**
     * Update existing Notion page via PATCH endpoint
     */
    async updateExistingPage(pageId, extractedData) {
      debug(`📝 Updating existing page ${pageId}...`);

      try {
        // Extract HTML content from the nested content object
        const htmlContent = extractedData.content?.combinedHtml || extractedData.content?.html || extractedData.contentHtml || '';
        
        if (!htmlContent) {
          throw new Error("No content found in extractedData");
        }
        
        // Get database and mappings (same as POST operation)
        const config = await getConfig();
        overlayModule.setMessage("Fetching database schema...");
        const database = await getDatabase(config.databaseId);
        
        overlayModule.setMessage("Loading property mappings...");
        const mappings = await getPropertyMappings(config.databaseId);

        // Apply mappings to extracted data (same as POST operation)
        overlayModule.setMessage("Mapping properties to Notion format...");
        const properties = applyPropertyMappings(
          extractedData,
          database,
          mappings
        );
        
        const patchData = {
          title: extractedData.title,
          contentHtml: htmlContent,
          url: extractedData.url,
          properties: properties, // Include property mappings for PATCH (same as POST)
        };

        const result = await apiCall("PATCH", `/api/W2N/${pageId}`, patchData);

        if (result && result.success) {
          debug(`✅ Page updated successfully`);
          const pageUrl = result.data?.pageUrl || result.pageUrl || `https://www.notion.so/${pageId.replace(/-/g, '')}`;
          
          overlayModule.done({
            success: true,
            pageUrl: pageUrl,
            autoCloseMs: 5000
          });

          return result;
        }

        throw new Error(result?.error || "Failed to update page");
      } catch (error) {
        debug(`❌ Failed to update page: ${error.message}`);
        throw error;
      }
    }

    /**
     * Extract data from current page
     */
    async extractCurrentPageData() {
      debug("📝 Extracting current page data");

      try {
        // Extract metadata
        overlayModule.setMessage("Reading page title and properties...");
        const metadata = extractServiceNowMetadata();

        // Find and extract content
        overlayModule.setMessage("Locating content elements...");
        const contentElement = findContentElement();
        
        overlayModule.setMessage("Extracting content from page...");
        const content = await extractContentWithIframes(contentElement);
        
        // DEBUG: Check content right after extraction
        const navInCombined = (content.combinedHtml?.match(/<nav[^>]*>/g) || []).length;
        const olCount = (content.combinedHtml?.match(/<ol[^>]*>/g) || []).length;
        const liCount = (content.combinedHtml?.match(/<li[^>]*>/g) || []).length;
        const olStepsMatch = content.combinedHtml?.match(/<ol[^>]*class="[^"]*ol steps[^"]*"[^>]*>/);
        console.log(`🔍 AFTER EXTRACTION: combinedHtml=${content.combinedHtml?.length} chars, ${navInCombined} nav tags`);
        console.log(`🔍 EXTRACTION CONTENT CHECK: ${olCount} OL tags, ${liCount} LI tags`);
        console.log(`🔍 Main steps OL found: ${!!olStepsMatch}`);
        if (olStepsMatch) {
          // Count LIs in the main steps OL
          const olStartIdx = content.combinedHtml.indexOf(olStepsMatch[0]);
          const olEndIdx = content.combinedHtml.indexOf('</ol>', olStartIdx);
          const olHtml = content.combinedHtml.substring(olStartIdx, olEndIdx + 5);
          const directLiCount = (olHtml.match(/<li[^>]*class="[^"]*li step[^"]*"[^>]*>/g) || []).length;
          console.log(`🔍 Main steps OL: ${directLiCount} direct LI children (should be 6)`);
        }

        // Analyze and process content (with null safety)
        overlayModule.setMessage("Analyzing content structure...");
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
        overlayModule.setMessage("Fetching database schema...");
        const database = await getDatabase(config.databaseId);
        
        overlayModule.setMessage("Loading property mappings...");
        const mappings = await getPropertyMappings(config.databaseId);

        // Apply mappings to extracted data
        overlayModule.setMessage("Mapping properties to Notion format...");
        const properties = applyPropertyMappings(
          extractedData,
          database,
          mappings
        );

        // Prepare page data for proxy
        // Extract HTML content from the nested content structure
        // extractedData.content has: { combinedHtml, combinedImages, ...analyzed }
        overlayModule.setMessage("Formatting page content...");
        const htmlContent =
          extractedData.content?.combinedHtml || extractedData.contentHtml || "";

        // DEBUG: Log HTML length and section count BEFORE creating pageData
        console.log('🔍🔍🔍 MAIN.JS - HTML content length:', htmlContent.length);
        const sectionCount = (htmlContent.match(/<section[^>]*id="predictive-intelligence-for-incident__section_/g) || []).length;
        console.log('🔍🔍🔍 MAIN.JS - Sections in HTML:', sectionCount);
        console.log('🔍🔍🔍 MAIN.JS - First 500 chars:', htmlContent.substring(0, 500));
        console.log('🔍🔍🔍 MAIN.JS - Last 500 chars:', htmlContent.substring(htmlContent.length - 500));
        
        // DEBUG: Count OL and LI tags in htmlContent being sent to server
        const olCountInHtml = (htmlContent.match(/<ol[^>]*>/g) || []).length;
        const liCountInHtml = (htmlContent.match(/<li[^>]*>/g) || []).length;
        const mainStepsOlMatch = htmlContent.match(/<ol[^>]*class="[^"]*ol steps[^"]*"[^>]*>/);
        console.log(`🔍🔍🔍 MAIN.JS - About to send to server: ${olCountInHtml} OL tags, ${liCountInHtml} LI tags`);
        if (mainStepsOlMatch) {
          const olStartIdx = htmlContent.indexOf(mainStepsOlMatch[0]);
          // Find matching closing tag by counting nested OLs
          let openCount = 1;
          let searchIdx = olStartIdx + mainStepsOlMatch[0].length;
          while (openCount > 0 && searchIdx < htmlContent.length) {
            const nextOpen = htmlContent.indexOf('<ol', searchIdx);
            const nextClose = htmlContent.indexOf('</ol>', searchIdx);
            if (nextClose === -1) break;
            if (nextOpen !== -1 && nextOpen < nextClose) {
              openCount++;
              searchIdx = nextOpen + 3;
            } else {
              openCount--;
              searchIdx = nextClose + 5;
            }
          }
          const olHtml = htmlContent.substring(olStartIdx, searchIdx);
          const directLiInHtml = (olHtml.match(/<li[^>]*class="[^"]*li step[^"]*"[^>]*>/g) || []).length;
          console.log(`🔍🔍🔍 MAIN.JS - Main steps OL being sent has ${directLiInHtml} direct LI children (should be 6)`);
        }

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

        let duplicateCheckResult = null;
        if (config.enableDuplicateDetection) {
          const shouldAttemptDuplicateCheck =
            (pageData.title && pageData.title.trim().length > 0) ||
            (pageData.url && pageData.url.trim().length > 0);

          if (shouldAttemptDuplicateCheck) {
            overlayModule.setMessage("Checking for duplicates...");
            try {
              duplicateCheckResult = await this.findDuplicatePages(
                database,
                pageData
              );
            } catch (duplicateError) {
              debug("Duplicate detection failed:", duplicateError);
              showToast(
                "Duplicate check failed. Continuing with Notion save.",
                4000
              );
            }
          }
        }

        if (
          duplicateCheckResult &&
          duplicateCheckResult.duplicates &&
          duplicateCheckResult.duplicates.length > 0
        ) {
          const summaryText = buildDuplicateSummary(
            duplicateCheckResult.duplicates,
            duplicateCheckResult.titlePropertyName
          );
          const reasonSummary = buildReasonSummary(
            duplicateCheckResult.reasonLabels
          );
          const promptMessage =
            `Found ${duplicateCheckResult.duplicates.length} Notion page${
            duplicateCheckResult.duplicates.length > 1 ? "s" : ""
          } matching by ${reasonSummary}.` +
            (summaryText ? `\n\n${summaryText}` : "") +
            "\n\nPress OK to create a new page anyway, or Cancel to open the first match.";

          const proceed = window.confirm(promptMessage);
          if (!proceed) {
            overlayModule.close && overlayModule.close();
            const firstDuplicateWithUrl = duplicateCheckResult.duplicates.find(
              (entry) => entry.page && entry.page.url
            );
            if (firstDuplicateWithUrl && firstDuplicateWithUrl.page.url) {
              window.open(firstDuplicateWithUrl.page.url, "_blank");
            }
            showToast(
              "Skipped creating a new Notion page because a duplicate exists.",
              5000
            );
            return;
          }

          showToast(
            "Duplicate detected. Creating a new Notion page anyway.",
            4000
          );
        }

        overlayModule.setMessage("Saving to Notion...");

        // DEBUG: ALWAYS save HTML and log for diagnostic purposes
        console.log('🔍 [CLIENT-DEBUG] pageData.contentHtml exists?', !!pageData.contentHtml);
        console.log('🔍 [CLIENT-DEBUG] pageData.contentHtml length:', pageData.contentHtml ? pageData.contentHtml.length : 0);
        
        // Check for target OL by ID
        const hasTargetOl = pageData.contentHtml && pageData.contentHtml.includes('devops-software-quality-sub-category__ol_bpk_gfk_xpb');
        console.log('🔍 [CLIENT-DEBUG] Has target OL ID?', hasTargetOl);
        
        // ALWAYS save for inspection (not just when condition matches)
        if (pageData.contentHtml) {
          window.DEBUG_LAST_EXPORT_HTML = pageData.contentHtml;
          console.log('💾 [CLIENT-DEBUG] Saved full export HTML to window.DEBUG_LAST_EXPORT_HTML');
          console.log('💾 [CLIENT-DEBUG] HTML length:', pageData.contentHtml.length);
          
          // Try to extract target OL if it exists
          const olMatch = pageData.contentHtml.match(/<ol[^>]*id="devops-software-quality-sub-category__ol_bpk_gfk_xpb"[^>]*>[\s\S]*?<\/ol>/);
          if (olMatch) {
            window.DEBUG_TARGET_OL = olMatch[0];
            console.log('💾 [CLIENT-DEBUG] ✅ Extracted target OL to window.DEBUG_TARGET_OL');
            console.log('💾 [CLIENT-DEBUG] OL length:', window.DEBUG_TARGET_OL.length);
            console.log('💾 [CLIENT-DEBUG] Contains Submit span:', window.DEBUG_TARGET_OL.includes('<span class="ph uicontrol">Submit</span>'));
            
            // Count <li> tags
            const liCount = (window.DEBUG_TARGET_OL.match(/<li/g) || []).length;
            console.log('💾 [CLIENT-DEBUG] Total <li> tags in OL:', liCount);
            
            // Parse and extract the 4th LI to show in logs
            try {
              const tempDiv = document.createElement('div');
              tempDiv.innerHTML = window.DEBUG_TARGET_OL;
              const ol = tempDiv.querySelector('ol');
              if (ol) {
                const lis = Array.from(ol.children).filter(el => el.tagName === 'LI');
                console.log('💾 [CLIENT-DEBUG] Parsed', lis.length, 'direct <li> children from OL');
                if (lis.length >= 4) {
                  const fourthLi = lis[3];
                  console.log('💾 [CLIENT-DEBUG] 4th LI text:', fourthLi.textContent.substring(0, 100).trim());
                  console.log('💾 [CLIENT-DEBUG] 4th LI HTML:', fourthLi.outerHTML.substring(0, 300));
                } else {
                  console.log('⚠️ [CLIENT-DEBUG] Only found', lis.length, 'direct LI children (expected 4)');
                }
              }
            } catch (e) {
              console.log('⚠️ [CLIENT-DEBUG] Failed to parse OL:', e.message);
            }
          } else {
            console.log('⚠️ [CLIENT-DEBUG] Target OL not found in extracted HTML');
            // Show what OL IDs we do have
            const allOlIds = pageData.contentHtml.match(/<ol[^>]*id="([^"]*)"[^>]*>/g);
            if (allOlIds) {
              console.log('⚠️ [CLIENT-DEBUG] Found these OL IDs:', allOlIds.map(m => m.match(/id="([^"]*)"/)[1]).join(', '));
            }
          }
        } else {
          console.log('❌ [CLIENT-DEBUG] pageData.contentHtml is empty or undefined!');
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

        // DEBUG: Count articles in pageData before sending
        if (pageData.contentHtml) {
          const articlesInPayload = (pageData.contentHtml.match(/class="topic task nested1"/g) || []).length;
          console.log("🚨🚨🚨 CLIENT SENDING:", articlesInPayload, "article.nested1 elements");
          console.log("   pageData.contentHtml length:", pageData.contentHtml.length);
          console.log("   pageData.content length:", pageData.content ? pageData.content.length : 0);
          console.log("   Are they the same?", pageData.contentHtml === pageData.content);
          
          // DEBUG: Check for missing 4th list item
          console.log("🔍 [CLIENT-DEBUG] Checking for 4th list item in contentHtml:");
          console.log("   Contains 'Click Submit':", pageData.contentHtml.includes('Click Submit'));
          console.log("   Contains 'successfully created':", pageData.contentHtml.includes('successfully created'));
          console.log("   Number of <li tags:", (pageData.contentHtml.match(/<li/g) || []).length);
          
          // Find the specific OL if it exists
          if (pageData.contentHtml.includes('Software Quality Sub Categories')) {
            const olMatch = pageData.contentHtml.match(/<ol[^>]*id="devops-software-quality-sub-category__ol_bpk_gfk_xpb"[^>]*>[\s\S]*?<\/ol>/);
            if (olMatch) {
              const olHtml = olMatch[0];
              const liCount = (olHtml.match(/<li/g) || []).length;
              console.log("   Found target <ol>, contains", liCount, "<li> tags");
              console.log("   OL contains 'Click Submit':", olHtml.includes('Click Submit'));
            } else {
              console.log("   ❌ Target <ol> not found in contentHtml!");
            }
          }
        }

        // DEBUG: Log full HTML content being sent to proxy
        if (pageData.contentHtml) {
          debug("🔍 DEBUG: Full HTML content being sent to proxy:");
          debug(pageData.contentHtml);
        }
        debug("🔍 DEBUG: Full extractedData structure:", extractedData);

        // Send to proxy
        overlayModule.setMessage("Saving to Notion...");
        const result = await sendProcessedContentToProxy(pageData);

        if (result.success) {
          // Check if we're in autoextract mode (global state exists)
          const isAutoExtracting = window.ServiceNowToNotion?.autoExtractState?.running;
          
          if (!isAutoExtracting) {
            // Single page save: show success state and auto-close the overlay after a short delay
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
          }
          // For AutoExtract: keep overlay open, just update message
          // The AutoExtract loop manages the overlay lifecycle
        } else {
          throw new Error(result.error || "Proxy processing failed");
        }
      } catch (error) {
        debug("❌ Proxy processing failed:", error);
        throw error;
      }
    }

    async findDuplicatePages(database, pageData) {
      const databaseId = database?.id || database?.database_id;
      if (!databaseId) {
        debug("Duplicate detection skipped: database id missing");
        return null;
      }

      const titlePropertyName = this.getTitlePropertyName(database);
      const filters = [];
      const reasonLabels = new Set();

      const titleText = (pageData.title || "").trim();
      if (titlePropertyName && titleText) {
        filters.push({
          property: titlePropertyName,
          title: { equals: titleText },
        });
        reasonLabels.add("Title");
      }

      const urlCandidates = [];
      Object.entries(pageData.properties || {}).forEach(
        ([propertyName, propertyValue]) => {
          if (
            propertyValue &&
            typeof propertyValue === "object" &&
            typeof propertyValue.url === "string" &&
            propertyValue.url.trim()
          ) {
            const trimmed = propertyValue.url.trim();
            urlCandidates.push({
              property: propertyName,
              value: trimmed,
              label: propertyName,
            });
          }
        }
      );

      const uniqueUrlCandidates = [];
      const seenUrlKeys = new Set();
      urlCandidates.forEach((candidate) => {
        const key = `${candidate.property}::${candidate.value}`;
        if (!seenUrlKeys.has(key)) {
          seenUrlKeys.add(key);
          uniqueUrlCandidates.push(candidate);
        }
      });

      uniqueUrlCandidates.forEach((candidate) => {
        filters.push({
          property: candidate.property,
          url: { equals: candidate.value },
        });
        reasonLabels.add(candidate.label || candidate.property);
      });

      if (filters.length === 0) {
        debug("Duplicate detection skipped: no filters available");
        return null;
      }

      const filterClause = filters.length === 1 ? filters[0] : { or: filters };

      debug("🔎 Checking for duplicates with filters:", filterClause);

      const queryBody = {
        filter: filterClause,
        page_size: 5,
        sorts: [
          {
            timestamp: "last_edited_time",
            direction: "descending",
          },
        ],
      };

      const response = await queryDatabase(databaseId, queryBody);
      const results = Array.isArray(response?.results) ? response.results : [];

      if (results.length === 0) {
        return {
          duplicates: [],
          reasonLabels: Array.from(reasonLabels),
          titlePropertyName,
        };
      }

      const duplicates = results.map((page) => {
        const pageTitle = this.extractPageTitle(page, titlePropertyName);
        const pageUrl = page?.url || null;
        const entryReasons = new Set();

        if (
          titlePropertyName &&
          titleText &&
          this.areStringsEquivalent(pageTitle, titleText)
        ) {
          entryReasons.add("Title match");
        }

        uniqueUrlCandidates.forEach((candidate) => {
          const pageProp = page?.properties?.[candidate.property];
          const candidateUrl = this.extractUrlFromProperty(pageProp);
          if (
            candidateUrl &&
            this.areStringsEquivalent(candidateUrl, candidate.value)
          ) {
            entryReasons.add(`${candidate.property} match`);
          }
        });

        return {
          id: page.id,
          page: {
            id: page.id,
            title: pageTitle,
            url: pageUrl,
          },
          reasons: Array.from(entryReasons),
        };
      });

      return {
        duplicates,
        reasonLabels: Array.from(reasonLabels),
        titlePropertyName,
      };
    }

    getTitlePropertyName(database) {
      const properties = database?.properties || {};
      return (
        Object.keys(properties).find(
          (name) => properties[name]?.type === "title"
        ) || null
      );
    }

    extractPageTitle(page, titlePropertyName) {
      let effectiveTitleProperty = titlePropertyName;
      if (!effectiveTitleProperty) {
        effectiveTitleProperty = this.getTitlePropertyName({
          properties: page?.properties || {},
        });
      }

      if (!effectiveTitleProperty) {
        return "";
      }

      const titleProp = page?.properties?.[effectiveTitleProperty];
      if (!titleProp || !Array.isArray(titleProp.title)) {
        return "";
      }

      return titleProp.title
        .map((rich) => rich.plain_text || "")
        .join("")
        .trim();
    }

    extractUrlFromProperty(propertyValue) {
      if (!propertyValue || typeof propertyValue !== "object") return null;
      if (typeof propertyValue.url === "string") {
        return propertyValue.url.trim();
      }

      if (Array.isArray(propertyValue.rich_text)) {
        return propertyValue.rich_text
          .map((rich) => rich.plain_text || "")
          .join("")
          .trim();
      }

      return null;
    }

    areStringsEquivalent(a, b) {
      if (!a || !b) return false;
      return a.trim().toLowerCase() === b.trim().toLowerCase();
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

  function buildDuplicateSummary(duplicates) {
    if (!Array.isArray(duplicates) || duplicates.length === 0) {
      return "";
    }

    return duplicates
      .map((entry, index) => {
        const title = entry?.page?.title || "Untitled";
        const pageUrl = entry?.page?.url;
        const reasons = Array.isArray(entry?.reasons)
          ? entry.reasons.filter(Boolean)
          : [];
        const reasonSuffix = reasons.length > 0 ? ` — ${reasons.join(", ")}` : "";
        const urlSuffix = pageUrl ? `\n   ${pageUrl}` : "";
        return `${index + 1}. ${title}${reasonSuffix}${urlSuffix}`;
      })
      .join("\n");
  }

  function buildReasonSummary(reasonLabels) {
    if (!Array.isArray(reasonLabels) || reasonLabels.length === 0) {
      return "Title";
    }

    const normalized = reasonLabels
      .map((label) => (typeof label === "string" ? label.trim() : ""))
      .filter(Boolean);

    if (normalized.length === 0) {
      return "Title";
    }

    if (normalized.length === 1) {
      return normalized[0];
    }

    if (normalized.length === 2) {
      return `${normalized[0]} or ${normalized[1]}`;
    }

    const last = normalized.pop();
    return `${normalized.join(", ")}, or ${last}`;
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
