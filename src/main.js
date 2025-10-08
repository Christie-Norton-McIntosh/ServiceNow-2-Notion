// Main Entry Point - ServiceNow-2-Notion Userscript

import {
  PROVIDER_VERSION,
  debug,
  getConfig,
  initializeConfig,
  DEFAULT_CUSTOM_SELECTORS,
  BRANDING,
} from "./config.js";

// UI Components
import {
  overlayModule,
  setPropertyMappingModalInjector,
} from "./ui/overlay-progress.js";
import { injectAdvancedSettingsModal } from "./ui/advanced-settings-modal.js";
import { injectIconCoverModal } from "./ui/icon-cover-modal.js";
import { showPropertyMappingModal } from "./ui/property-mapping-modal.js";
import { injectMainPanel } from "./ui/main-panel.js";
import {
  createEl,
  showToast,
  showSuccessPanel,
  showErrorPanel,
} from "./ui/utils.js";

// Content Processing
import { extractServiceNowMetadata } from "./content/metadata-extractor.js";
import {
  extractContentWithIframes,
  findContentElement,
} from "./content/content-extractor.js";
import {
  normalizeText,
  analyzeContent,
  splitContentIntoSections,
} from "./content/content-utils.js";

// API Modules
// Universal Workflow removed; no import required.
import {
  checkProxyHealth,
  createNotionPage,
  sendProcessedContentToProxy,
} from "./api/proxy-api.js";
import {
  getDatabase,
  getAllDatabases,
  getPropertyMappings,
  applyPropertyMappings,
  createDefaultMappings,
} from "./api/database-api.js";

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

      // Generic fallbacks
      "header .actions",
      ".navbar .actions",
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
