// UI Utilities and Common Functions

import { PROVIDER_NAME, debug } from "../config.js";

/**
 * Show a toast notification to the user
 * @param {string} message - Message to display
 * @param {number} duration - Duration in milliseconds
 */
export function showToast(message, duration = 3000) {
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
export function showSuccessPanel(result) {
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
export function showErrorPanel(error) {
  const message = `❌ Error: ${error || "Unknown error occurred"}`;
  showToast(message, 5000);
}

/**
 * Debounce utility function
 * @param {Function} func - Function to debounce
 * @param {number} wait - Wait time in milliseconds
 * @returns {Function} Debounced function
 */
export function debounce(func, wait = 250) {
  let timeout;
  return function executedFunction(...args) {
    const later = () => {
      clearTimeout(timeout);
      func(...args);
    };
    clearTimeout(timeout);
    timeout = setTimeout(later, wait);
  };
}

/**
 * Create DOM element with attributes and content
 * @param {string} tag - HTML tag name
 * @param {Object} attrs - Attributes object
 * @param {string} content - Text content
 * @returns {HTMLElement} Created element
 */
export function createEl(tag, attrs = {}, content = "") {
  const el = document.createElement(tag);
  Object.entries(attrs).forEach(([key, value]) => {
    if (key === "class") el.className = value;
    else if (key === "style") el.style.cssText = value;
    else el.setAttribute(key, value);
  });
  if (content) el.textContent = content;
  return el;
}

/**
 * Debug helper: report matches for all CUSTOM_PROPERTY_SELECTORS
 * Usage (in page console): window.W2N_debugSelectors()
 */
export function createDebugSelectorFunction(CUSTOM_PROPERTY_SELECTORS) {
  return function W2N_debugSelectors() {
    try {
      const report = {};
      for (const key of Object.keys(CUSTOM_PROPERTY_SELECTORS || {})) {
        const sel = CUSTOM_PROPERTY_SELECTORS[key];
        try {
          const el = document.querySelector(sel);
          if (el) {
            let value = "";
            if (key === "breadcrumb") {
              // reuse breadcrumb logic: extract anchors
              const anchors = Array.from(el.querySelectorAll("a"))
                .map((a) => (a.textContent || "").trim())
                .filter(Boolean);
              value = anchors.length
                ? anchors.join(" > ")
                : (el.textContent || "").trim();
            } else if (key === "tags") {
              value = Array.from(el.querySelectorAll("li,span,a"))
                .map((t) => (t.textContent || "").trim())
                .filter(Boolean)
                .join(", ");
            } else {
              value = (el.textContent || "").trim();
            }
            report[key] = { selector: sel, matched: true, value };
          } else {
            report[key] = { selector: sel, matched: false, value: null };
          }
        } catch (e) {
          report[key] = { selector: sel, matched: false, error: e.message };
        }
      }
      if (typeof debug === "function") debug("Debug selectors:", report);
      else if (typeof console.table === "function") console.table(report);
      return report;
    } catch (err) {
      if (typeof debug === "function")
        debug("W2N_debugSelectors error:", err.message || err);
      else if (typeof console.warn === "function")
        console.warn("W2N_debugSelectors error:", err.message || err);
      return null;
    }
  };
}

/**
 * Expose debug selector function to window for debugging
 * @param {Object} selectors - Custom property selectors object
 */
export function exposeDebugFunction(selectors) {
  try {
    window.W2N_debugSelectors = createDebugSelectorFunction(selectors);
  } catch (e) {
    debug("Failed to expose debug function:", e);
  }
}

/**
 * Common modal close handler
 * @param {HTMLElement} modal - Modal element to close
 */
export function closeModal(modal) {
  if (modal && modal.parentNode) {
    modal.parentNode.removeChild(modal);
  }
}

/**
 * Setup common modal event handlers
 * @param {HTMLElement} modal - Modal element
 * @param {Object} options - Configuration options
 */
export function setupCommonModalHandlers(modal, options = {}) {
  const { closeSelector = ".close-btn", backdropClose = true } = options;

  // Close button handler
  const closeBtn = modal.querySelector(closeSelector);
  if (closeBtn) {
    closeBtn.onclick = () => closeModal(modal);
  }

  // Backdrop click handler
  if (backdropClose) {
    modal.onclick = (e) => {
      if (e.target === modal) {
        closeModal(modal);
      }
    };
  }
}

/**
 * Simple loading spinner HTML
 * @param {string} message - Loading message
 * @returns {string} HTML string
 */
export function createLoadingHTML(message = "Loading...") {
  return `
    <div style="display:flex; flex-direction:column; align-items:center; justify-content:center; padding:40px; color:#6b7280;">
      <div style="width:24px; height:24px; border:2px solid #e5e7eb; border-top:2px solid #3b82f6; border-radius:50%; animation:spin 1s linear infinite; margin-bottom:16px;"></div>
      <div>${message}</div>
    </div>
  `;
}

/**
 * Simple error display HTML
 * @param {string} message - Error message
 * @returns {string} HTML string
 */
export function createErrorHTML(message = "An error occurred") {
  return `
    <div style="text-align:center; padding:40px; color:#ef4444;">
      <div style="font-size:24px; margin-bottom:12px;">⚠️</div>
      <div>${message}</div>
    </div>
  `;
}

/**
 * Simple success display HTML
 * @param {string} message - Success message
 * @returns {string} HTML string
 */
export function createSuccessHTML(message = "Success!") {
  return `
    <div style="text-align:center; padding:40px; color:#10b981;">
      <div style="font-size:24px; margin-bottom:12px;">✅</div>
      <div>${message}</div>
    </div>
  `;
}
