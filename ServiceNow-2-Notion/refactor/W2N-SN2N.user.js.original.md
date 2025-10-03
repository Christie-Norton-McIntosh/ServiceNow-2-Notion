// ==UserScript==
// @name W2N-SN2N
// @namespace https://github.com/Christie-Norton-McIntosh/WEB-2-N0T10N
// @version 7.1.0
// @description ServiceNow content extractor for Universal Workflow - dynamic property mapping with direct name matching
// @author Christie Norton-McIntosh
// @match https://_.servicenow.com/_
// @match https://_.service-now.com/_
// @match https://_service-now_.com/*
// @match https://*servicenow*.com/*
// @match http://localhost:_/_
// @match https://localhost:_/_
// @grant GM_registerMenuCommand
// @grant GM_setValue
// @grant GM_getValue
// @grant GM_xmlhttpRequest
// @grant GM_setClipboard
// @grant GM_notification
// @grant unsafeWindow
// @require https://cdnjs.cloudflare.com/ajax/libs/turndown/7.1.1/turndown.min.js
// @connect localhost
// @connect 127.0.0.1
// @connect servicenow.com
// ==/UserScript==

// Quiet reference-mode console output
(function () {
try {
var REF_DEBUG = false;
if (typeof window !== 'undefined' && window.SN2N_REF_DEBUG) REF_DEBUG = true;
if (typeof process !== 'undefined' && process.env && process.env.SN2N_REF_DEBUG) REF_DEBUG = true;
if (!REF_DEBUG && typeof console !== 'undefined') {
console.log = function () {};
console.info = function () {};
console.warn = function () {};
console.error = function () {};
}
} catch (e) {}
})();

// W2NSavingProgress overlay module - self-contained progress UI
(function () {
"use strict";

const ID_ROOT = "w2n-saving-progress";
const PREFIX = "w2n-progress-";

// Helper function to create DOM elements
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

function createOverlay() {
const overlay = createEl("div", {
id: ID_ROOT,
style:
"position:fixed;inset:0;z-index:10000;background:rgba(0,0,0,0.5);display:flex;align-items:center;justify-content:center;",
});

    const panel = createEl("div", {
      class: PREFIX + "panel",
      style:
        "background:white;border-radius:8px;padding:20px;min-width:400px;max-width:90vw;box-shadow:0 10px 30px rgba(0,0,0,0.3);",
      role: "dialog",
      "aria-labelledby": PREFIX + "title",
    });

    const preview = createEl("div", {
      class: PREFIX + "preview",
      "aria-hidden": "true",
      style:
        "display:flex;align-items:center;gap:10px;margin:10px 0;padding:10px;border:1px solid #e5e7eb;border-radius:6px;background:#f9fafb;min-height:60px;",
    });
    const title = createEl(
      "h2",
      { id: PREFIX + "title", class: PREFIX + "title" },
      "Saving to Notion…"
    );
    const message = createEl("div", {
      class: PREFIX + "message",
      "aria-live": "polite",
    });
    const spinner = createEl("div", {
      class: PREFIX + "spinner",
      "aria-hidden": "true",
    });
    const bar = createEl("div", {
      class: PREFIX + "bar",
      "aria-hidden": "true",
    });
    const barFill = createEl("div", { class: PREFIX + "bar-fill" });
    bar.appendChild(barFill);
    const steps = createEl("ul", {
      class: PREFIX + "steps",
      "aria-hidden": "true",
    });

    const actions = createEl("div", { class: PREFIX + "actions" });
    const viewLink = createEl(
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
    const retryBtn = createEl(
      "button",
      { class: PREFIX + "retry", type: "button", hidden: "true" },
      "Retry"
    );
    const closeBtn = createEl(
      "button",
      { class: PREFIX + "close", type: "button" },
      "Close"
    );
    const configBtn = createEl(
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
    console.log(
      "[SN2N] createOverlay() - Added config button to actions:",
      !!configBtn
    );
    console.log(
      "[SN2N] createOverlay() - Actions children count:",
      actions.children.length
    );

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
      console.log("[SN2N] Configure Property Mapping button clicked!");
      overlayModule.close();
      injectPropertyMappingModal();
    });

    document.documentElement.appendChild(overlay);
    return overlay;

}

// --- Internal state ---
let state = {
opened: false,
onClose: null,
retryCallback: null,
autoCloseMs: null,
};

const overlayModule = {
// public API
start(opts = {}) {
console.log("[SN2N] overlayModule.start() called");
const overlay = createOverlay();
console.log(
"[SN2N] Created new overlay with config button:",
!!overlay.querySelector("." + PREFIX + "config")
);
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
      const li = createEl("li", {}, text);
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
      console.log(
        "[SN2N] setPreview - Existing overlay found:",
        !!existingOverlay
      );
      const overlay = existingOverlay || createOverlay();
      console.log(
        "[SN2N] setPreview - Using overlay with config button:",
        !!overlay.querySelector("." + PREFIX + "config")
      );
      const preview = overlay.querySelector("." + PREFIX + "preview");
      preview.innerHTML = "";
      if (icon) {
        const ico = createEl(
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
          const img = createEl("img", {
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

      /**
       * Debug helper: report matches for all CUSTOM_PROPERTY_SELECTORS
       * Usage (in page console): window.W2N_debugSelectors()
       */
      function W2N_debugSelectors() {
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
          console.table(report);
          return report;
        } catch (err) {
          console.warn("W2N_debugSelectors error:", err.message || err);
          return null;
        }
      }

      // expose to page for quick debugging
      try {
        window.W2N_debugSelectors = W2N_debugSelectors;
      } catch (e) {
        /* ignore */
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
        check = createEl("div", { class: PREFIX + "success-check" }, "✓");
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
          console.error("W2NSavingProgress onClose handler threw", e);
        }
      }
    },

    // internal: invoked by retry button
    _invokeRetry() {
      if (typeof state.retryCallback === "function") {
        try {
          state.retryCallback();
        } catch (e) {
          console.error("W2NSavingProgress retry callback error", e);
        }
      }
    },

};

// attach to window (read-only property)
try {
Object.defineProperty(window, "W2NSavingProgress", {
value: overlayModule,
configurable: false,
writable: false,
});
} catch (e) {
window.W2NSavingProgress = overlayModule;
}
})(); // End overlay module IIFE

// Global script loading indicator
console.log("🔄 W2N-SN2N Script Starting to Load...");
window.W2N_SN2N_LOADING = true;
window.W2N_SN2N_VERSION = "6.16.2";
// Global fallback for accidental global metadata references (prevents ReferenceError)
var metadata = typeof metadata !== "undefined" ? metadata : {};

// Add debugging for ServiceNow email error
console.log(
"🔍 W2N-SN2N: Checking for ServiceNow user object access errors..."
);
const originalConsoleError = console.error;
console.error = function (...args) {
const errorMessage = args.join(" ");
if (
errorMessage.includes(
"Cannot read properties of undefined (reading 'email')"
)
) {
console.log(
"⚠️ W2N-SN2N: Detected ServiceNow user.email error - this is likely a ServiceNow authentication issue, not related to W2N userscript"
);
console.log(
"💡 W2N-SN2N: Try refreshing the page or logging into ServiceNow again"
);
}
originalConsoleError.apply(console, args);
};

// Main script IIFE
(function () {
"use strict";

// =============================================================================
// CONSTANTS AND CONFIGURATION
// =============================================================================

const PROVIDER_VERSION = "7.0.0";
const PROVIDER_ID = "servicenow";
const PROVIDER_NAME = "ServiceNow";

// Default ServiceNow branding assets
const DEFAULT_SERVICENOW_ICON =
"data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAIAAAACACAYAAADDPmHLAAAAAXNSR0IArs4c6QAAAAERlWElmTU0AKgAAAAgAAYdpAAQAAAABAAAAGgAAAAAAA6ABAAMAAAABAAEAAKACAAQAAAABAAAAgKADAAQAAAABAAAAgAAAAABIjgR3AAAHH0lEQVR4Ae2dz27cVBTG70wyIUpJgIIQUUWQQIUkdEE2QUJqNnSF+kcVD1Bl1rwAT1AeALYZiTUsCH0CdrCBFRkeAFWipSCgUdKkY+5x46nHsT2+Puf63uv5LCVjX9vH55zv53OvPY7TUULT7q/XI9Xtqo6QPa6ZaGzgbG4UqcHmPV/cG3vneoadkN3hjajjjexm6YyUhmPGwWAB0D+4GQWqfS4pVCsG6/u0jpWXXOOeNs7X9as/1OK3bEqpno4t1dyygHU43Toh9Ye30gmqYyKkfSjW1sZbswK0Nh9lYKaDbk1VMK4Auwd6tI+JctCKPBgD0OkY79JmXIIHAWrK4BlsNQAAMgCQlSCrAQCQAyCxFFQ1AACJbLKfwVQDACArfNaa99UAAGQlk1/2uhoAAHnBiyx6WQ0AQJFcdtq9gwAA2BG6zKpXEACAMqnsrfMGAgBgT+Rplr2AAABMk8nueucQAAC7Alex7hQCAFBFIvvbOIMAANgXt+oRnEAAAKrK09LtAIBfwjZeBQCAXwCQN41CAAAyAPSWaz4nm7HDXGwMAgCQUeqFlYVMS7sXAUBG34vrK5kWZ4uNVAEAkNF3dfvVTIvTResQAICMvhc3Xsq0tHsRAGT0Xd1+TXkyEEw8s1oFAECS5tTnlTvvpJbaPQsAcvR9/87bOa1Om6xVAQCQo+vCck95CEGOp/wmAFCQw63P3puJsQAAKACAqsDO3a2Cte1pBgAlWr51bdW3rkB8LAAASgCgVR9+fkWtffzGlK3CXQ0AKmi388VWayEAABUAoPHAta+2FQ0MPZhEuwEAYKAoAXD17gfqxUtLBnv5vSkAMNTn8u019cnXH6nLt9803FN0c7EqYPy2qza+H7CuNP/9fqh+/vI3df+nPxXNNzwZa5fnn7ERAJCXRqUheKge/PJI3f/xUQzD4wdH6vTxaf7GMq3G2uUd1tgIAMhL42Tb0d9P1Mk/J+r435PJFYJL+5/+YKxd3uExBsjLCrNt8eUFtbx2Qb3y7ko8YOz25NN8/ZsdkXGAF09AMvPt7e5zWvg5DQMBcaK7A6oMT3RliPQbyrlTV+T8VwoAcJWouH/vwryiH3VJxSAc/6W7iUOrY4RKngGASmmS3YgqAv08PRkpAoEqw0jPu5gAgIusnx2Tuoil1xfjn6SLONYwNDnJj06a9L5Fx6LuYVnfYaSHUulOY29p+rl569ur7MHE9KO0KMkhhNLVo7t0F3H4x1E8gMzrIiL9z3q4EwDgZtDi/tRFUFWgia4e6L7CRBfB1x9XARb1EzW9sNJT9ENjhni88PBYnR4/ZR8DFYCdwmYNpO8tnB7xAcAgsFn9RI82vzjHtgcA2CkM2wAACFs/tvcAgJ3CsA0AgLD1Y3sPANgpDNsAAAhbP7b3AICdwrANAICw9WN7DwDYKQzbAAAIWz+29wCAncKwDQCAkPUT+DoYAAQMQBSxHwhSACBgANSIXwIAQMAAdPj6owIErL/a29hnI4AKEDIBAr4DAIEkOjHBPvefeQ0AnKjHP6jEFQB5AQD4Wjix0BH4mwAA4EQ6mYNKDAABgIwWQVtBFxCgfJHgPxYDAAECMFj/XugaAIPAAOWXdRkVQDaf1q1Jln9yFgBYl0z2AJLlHwDIahOkNVSAgGSLLLxGCAAEBMBgk//tXzZcAJDNiKfL/Gd/8gMDAPl58a51sC5/9lOQAMA7qc87ZOvsBwDnc+1lS8ciAXhHkJeSP3eKtB8IPPr13OLkHLqAyXx4t2Sr708CBQBJJjz8tFj5x9ECgHEq/JuxffZTxADAP93PPGri/AcA3sq/J/idf1mQqABl2XG1rpmTP44Ol4GuRC44ru3LvuxhUQGyGXG83MTALx0iAEhnw/H8nqX7/WVhAYCy7DS6Tuw5TyOvMQYwSpedjeN+f/07JwSgAtjRtLJVeslH0/1+2jkAkM6Gg3mbX/RUCQcAVMmSpW1cDPqyoQCAbEaaWm7wZk9ZSACgLDu21mnxpf66l+siAOBm0HR/j8Qn1wGAqYCc7T0THwBwxDTd10PxKQTcCDIVssb2Poz2i9wGAEWZEWjXJ73TmzxVQsAYoEqWamwTgvgUFgCoIe60XaLRyPszP4kBXUCSCYHP+L6+xWf4BVw8ZwIAnEtJvQZ6c8dgQ+7dPfW8MN8LAJjnbGKPEM/6dAAAIJ0Nw/m4r9+85+R7fENXCzcHAIWpKV4Rl/uGHtsu9kJmjTkAdH0TNPP1E9cm4ZMsGAMQ6b9V7swYAW0UvjYA8VuqZ6QCtFn4BIBaUvYPblIZaOUU93D6ly/f19tOcm0Z+0MNQUum+L+v6WhsvIXL9xQZjwHGAcWnyngpuBkq79SdzcqZXiRQ7QpABuOugGZYVsiA3ekZq1psR8/e242OZ11Mut3hDX1S6esDMYvVAkv3Q+OrE13TZ/3MrpY9pf4Hez9bmfMY8McAAAAASUVORK5CYII=";

// Cover image URL - using external URL to keep userscript size reasonable
const DEFAULT_SERVICENOW_COVER_URL =
"https://raw.githubusercontent.com/Christie-Norton-McIntosh/WEB-2-N0T10N/Web-2-Notion/W2N/img/ServiceNow%20Yokohama%20banner.png";

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

// cache TTL for database list (milliseconds) - default 10 minutes
const DB_CACHE_TTL = 10 _ 60 _ 1000;

let config = { ...defaultConfig, ...GM_getValue("notionConfig", {}) };
// If the saved config explicitly cleared the databaseId or name, fall back
// to the hardcoded defaults so the script defaults to the intended DB.
if (!config.databaseId) {
config.databaseId = defaultConfig.databaseId;
config.databaseName = defaultConfig.databaseName;
}

// Global state
const globalState = {
captureMode: null,
notionPanel: null,
currentDatabaseList: [],
autoExtractState: {
running: false,
paused: false,
currentPage: 0,
totalProcessed: 0,
nextPageElement: null,
maxPages: 500,
persistedCover: null, // Chosen Unsplash cover for all pages
persistedIcon: null, // Book cover icon for all pages
reloadAttempts: 0, // Track page reload attempts for error recovery
},
};

// =============================================================================
// SERVICENOW-SPECIFIC CSS SELECTORS AND CONTENT PATTERNS
// =============================================================================

// ServiceNow Content Selectors - Customize these for your ServiceNow instance
const SERVICENOW_SELECTORS = {
// Main content areas
mainContent: [
".zDocsTopicPageBody .zDocsTopicPageBodyContent article.dita .body.conbody", // ServiceNow docs main content body (precise content only)
"#zDocsContent > div.zDocsTopicPageBody > div.zDocsTopicPageBodyContent", // ServiceNow docs main content area (broader)
"div:nth-child(2) > div.zDocsLayout:nth-child(1) > main.zDocsMain.css-ettsdk > div > div.zDocsTopicPage.css-ettsdk:nth-child(3) > div.zDocsTopicPageTopicContainer:nth-child(2) > article > div.zDocsTopicPageBody:nth-child(2)", // Specific Notion topic page body
"#zDocsContent", // Priority: Notion page content area
".kb_article_content",
".article-content",
'[data-type="article_content"]',
".content-area",
".main-content",
],

    // Title selectors
    pageTitle: [
      "div:nth-child(2) > div.zDocsLayout:nth-child(1) > main.zDocsMain.css-ettsdk > div > div.zDocsTopicPage.css-ettsdk:nth-child(3) > div.zDocsTopicPageTopicContainer > article > header.zDocsTopicPageHead > h1.css-g931ng", // Notion page title (specific)
      ".zDocsTopicPageHead h1", // Notion page title (generic)
      "h1.css-g931ng", // Notion h1 title (fallback)
      ".kb_article_title",
      ".article-title",
      "h1.page-title",
      '.form-field[data-field="short_description"] input',
      ".title-field",
    ],

    // Metadata selectors
    author: [
      ".kb_author",
      ".article-author",
      '[data-field="author"]',
      ".created-by",
    ],

    category: [".kb_category", ".article-category", '[data-field="category"]'],

    tags: [".kb_tags", ".article-tags", '[data-field="tags"]', ".tag-list"],

    // Knowledge Base specific
    kbNumber: [".kb_number", '[data-field="number"]', ".article-number"],

    // Tables and lists
    tables: ["table.list_table", ".data-table", ".record-table"],

    // Forms and fields
    formFields: [".form-field", ".field-wrapper", "[data-field]"],

    // Navigation and pagination
    nextPageButton: [
      'button[aria-label="Next page"]',
      ".pagination-next",
      ".next-button",
    ],

    // Images and media
    images: [
      ".kb_article_content img",
      ".content-area img",
      ".attachment-image",
    ],

    // Notion-specific elements
    version: [
      "#zDocsContent > header > ul > li.zDocsTopicPageCluster > div > div > button > div > div > div", // Primary version selector
      "div:nth-child(2) > div.zDocsLayout:nth-child(1) > main.zDocsMain.css-ettsdk > div > div.zDocsTopicPage.css-ettsdk:nth-child(3) > div.zDocsTopicPageTopicContainer:nth-child(2) > article > header.zDocsTopicPageHead > ul.zDocsTopicPageDetails > li.zDocsTopicPageCluster:nth-child(1) > div.zDocsReusableSelect.undefined > div.dropdown.bootstrap-select.form-control > button.btn.dropdown-toggle.btn-light > div.filter-option > div.filter-option-inner > div.filter-option-inner-inner", // Fallback version selector
      ".zDocsTopicPageDetails .filter-option-inner-inner", // Generic version fallback
    ],

    breadcrumb: [
      "div:nth-child(2) > div.zDocsLayout:nth-child(1) > main.zDocsMain.css-ettsdk > div > div.zDocsTopicPage.css-ettsdk:nth-child(3) > div.zDocsTopicPageTopicContainer > div.zDocsTopicPageBreadcrumbsContainer > div.undefined.rc_breadcrumbs.zDocsBreadcrumbs", // Notion breadcrumb selector
      ".zDocsBreadcrumbs", // Generic breadcrumb fallback
      ".rc_breadcrumbs", // Alternative breadcrumb fallback
    ],

    // Date selectors
    updated: [
      "#zDocsContent > header > ul > li.zDocsTopicPageDate.css-cinqea > span", // Primary updated date selector
      "div:nth-child(2) > div.zDocsLayout:nth-child(1) > main.zDocsMain.css-ettsdk > div > div.zDocsTopicPage.css-ettsdk:nth-child(3) > div.zDocsTopicPageTopicContainer:nth-child(2) > article > header.zDocsTopicPageHead > ul.zDocsTopicPageDetails > li.zDocsTopicPageDate.css-cinqea:nth-child(3) > span.css-cinqea", // Fallback updated date selector
      ".zDocsTopicPageDate span", // Generic date fallback
      ".css-cinqea", // Alternative date fallback
    ],

};

// Custom selectors assigned interactively for specific properties
// Example: { version: '#zDocsContent > header > ul > li.zDocsTopicPageCluster > div > div > button > div > div > div' }
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

const CUSTOM_PROPERTY_SELECTORS = Object.assign(
{},
DEFAULT_CUSTOM_SELECTORS,
window.W2N_CUSTOM_SELECTORS || {}
);

// =============================================================================
// DYNAMIC PROPERTY MAPPING SYSTEM
// =============================================================================

// Dynamic property mapping system: properties are matched by name directly
// Users configure property mappings through the UI which get stored and applied at runtime

// =============================================================================
// UTILITY FUNCTIONS
// =============================================================================

function debug(...args) {
if (config.debugMode) {
console.log(`[${PROVIDER_NAME}]`, ...args);
}
}

// Migrate legacy saved config (`w2n_config`) to `notionConfig` for backward compatibility
function migrateOldConfig() {
try {
const legacy = GM_getValue && GM_getValue("w2n_config");
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

      // Refresh in-memory config so the UI picks up migrated values immediately
      try {
        if (typeof defaultConfig !== "undefined") {
          config = { ...defaultConfig, ...GM_getValue("notionConfig", {}) };
        }
      } catch (e) {
        console.warn("Failed to refresh in-memory config after migration:", e);
      }

      // Remove old key if supported by the environment
      try {
        GM_setValue("w2n_config", null);
      } catch (e) {
        // Some GM implementations don't support deleting; ignore
      }

      return true;
    } catch (error) {
      console.warn("Migration check failed:", error);
      return false;
    }

}

function showToast(message, duration = 3000) {
GM_notification({
text: message,
title: PROVIDER_NAME,
timeout: duration,
});
}

function showSuccessPanel(result) {
const message = result?.pageUrl
? `✅ Content saved to Notion!\n\nPage: ${result.pageUrl}`
: "✅ Content saved to Notion!";
showToast(message, 5000);

    // Removed auto-opening of Notion tabs to prevent browser clutter
    // Users can manually visit the page if needed from the success message

}

function showErrorPanel(error) {
const message = `❌ Error: ${error || "Unknown error occurred"}`;
showToast(message, 5000);
}

function debounce(func, wait = 250) {
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

// =============================================================================
// PROPERTY MAPPING SYSTEM
// =============================================================================

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
          <button id="w2n-close-property-mapping" style="background:none;border:none;font-size:18px;cursor:pointer">×</button>
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

function setupPropertyMappingModal(modal) {
if (!modal) return;
if (modal.dataset && modal.dataset.w2nInit) return; // already initialized
const closeBtn = modal.querySelector("#w2n-close-property-mapping");
const saveBtn = modal.querySelector("#w2n-save-property-mapping");
const resetBtn = modal.querySelector("#w2n-reset-property-mapping");
const cancelBtn = modal.querySelector("#w2n-cancel-property-mapping");
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

    // Click outside to close (remove)
    modal.onclick = (e) => {
      if (e.target === modal) closeModal();
    };

    saveBtn.addEventListener("click", async () => {
      try {
        const databaseId = config.databaseId;
        if (!databaseId) {
          alert("No database selected. Please select a database first.");
          return;
        }

        // Collect current mappings from the form
        const mappings = {};
        const selects = mappingsContainer.querySelectorAll("select");
        selects.forEach((select) => {
          const contentKey = select.dataset.contentKey;
          const selectedValue = select.value;
          if (selectedValue && selectedValue !== "") {
            mappings[contentKey] = selectedValue;
          }
        });

        savePropertyMappings(databaseId, mappings);
        alert("Property mappings saved successfully!");
        closeModal();
      } catch (error) {
        console.error("Error saving property mappings:", error);
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
        const databaseId = config.databaseId;
        if (databaseId) {
          resetPropertyMappings(databaseId);
          // Reload the properties to reflect the reset
          showPropertyMappingModal();
        }
      }
    });

    // Load database schema and populate mappings
    async function loadDatabaseMappings(databaseId, databaseName) {
      try {
        dbNameEl.textContent = databaseName || "Loading...";
        mappingsContainer.innerHTML =
          '<div style="text-align:center;padding:20px;color:#6b7280;">Loading database schema...</div>';

        // Fetch database schema
        currentDatabaseSchema = await fetchDatabaseSchema(databaseId);

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
      } catch (error) {
        debug("❌ Failed to load database schema:", error);
        mappingsContainer.innerHTML =
          '<div style="text-align:center;padding:20px;color:#ef4444;">Failed to load database schema. Please try again.</div>';
      }
    }

    // Expose loadDatabaseMappings function on modal for external calls
    modal.loadDatabaseMappings = loadDatabaseMappings;

    // Auto-load current database if available
    if (config.databaseId) {
      loadDatabaseMappings(
        config.databaseId,
        config.databaseName || "Selected Database"
      );
    }

    // Make modal accessible via global scope for debugging
    unsafeWindow.propertyMappingModal = modal;

}

function populatePropertyMappings(properties, mappings) {
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
key: "author",
label: "Author",
description: "Content author if available",
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
key: "kbNumber",
label: "KB Number",
description: "Knowledge base article number",
},
{
key: "status",
label: "Status",
description: "Article or content status",
},
{
key: "department",
label: "Department",
description: "Owning department or team",
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
key: "hasFigureImage",
label: "Has Images",
description: "Whether the page contains figures or images",
},
{
key: "hasVideos",
label: "Has Videos",
description: "Whether the page contains videos or video content",
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
      Object.entries(mappings).forEach(([contentKey, notionProperty]) => {
        const select = mappingsContainer.querySelector(
          `select[data-content-key="${contentKey}"]`
        );
        if (select) {
          select.value = notionProperty;
        }
      });
    }

}

// Property mapping storage functions
function savePropertyMappings(databaseId, mappings) {
const key = `w2n_property_mappings_${databaseId}`;
GM_setValue(key, JSON.stringify(mappings));
debug(`Property mappings saved for database ${databaseId}:`, mappings);
}

function loadPropertyMappings(databaseId) {
const key = `w2n_property_mappings_${databaseId}`;
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
GM_setValue(key, "{}");
debug(`Property mappings reset for database ${databaseId}`);
}

function showPropertyMappingModal() {
debug("🔗 Opening property mapping modal");
injectPropertyMappingModal();
const modal = document.getElementById("w2n-property-mapping-modal");
if (modal && modal.loadDatabaseMappings) {
modal.loadDatabaseMappings(config.databaseId, config.databaseName);
}
}

// =============================================================================
// COMPREHENSIVE UI COMPONENTS
// =============================================================================

// Shared Unsplash keyword list (used by multiple Unsplash UI modals)
const UNSPLASH_KEYWORDS = [
"abstract",
"geometric",
"background",
"pattern",
"gradient",
"texture",
];

// Compact Icon/Cover modal (Unsplash + emoji fallback)
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

function injectAdvancedSettingsModal() {
if (document.getElementById("w2n-advanced-settings-modal")) return;

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
              <input type="checkbox" id="w2n-modal-debug-mode" ${
                config.debugMode ? "checked" : ""
              } style="margin-right: 10px; transform: scale(1.1);">
              <span style="flex:1;">Debug mode</span>
            </label>
            <div style="font-size: 12px; color: #6b7280; margin-left: 24px; margin-top: -8px;">
              Show detailed logging in browser console for troubleshooting
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

    saveBtn.onclick = () => {
      // Get values from modal checkboxes
      const useMartian = modal.querySelector("#w2n-modal-use-martian").checked;
      const directSDKImages = modal.querySelector(
        "#w2n-modal-direct-images"
      ).checked;
      const debugMode = modal.querySelector("#w2n-modal-debug-mode").checked;
      const enableDuplicateDetection = modal.querySelector(
        "#w2n-modal-duplicate-detect"
      ).checked;

      // Update config
      config.useMartian = useMartian;
      config.directSDKImages = directSDKImages;
      config.debugMode = debugMode;
      config.enableDuplicateDetection = enableDuplicateDetection;

      // Save to storage
      try {
        GM_setValue("notionConfig", config);
        showToast("Settings saved successfully", 2000);
        debug("⚙️ Settings saved:", config);
        // Update visible UI immediately so user sees the selected database/name
        try {
          updateUIFromConfig();
        } catch (e) {
          console.warn("Failed updating UI after settings save:", e);
        }
      } catch (error) {
        showToast("Failed to save settings", 2000);
        console.error("Failed to save settings:", error);
      }

      closeModal();
    };

}

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

    close.onclick = () => {
      // No cleanup needed for data URLs (they don't need to be revoked like blob URLs)
      modal.remove();
    };
    cancel.onclick = () => {
      // No cleanup needed for data URLs (they don't need to be revoked like blob URLs)
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
        const res = await apiCall(
          "GET",
          `/api/unsplash/search?query=${encodeURIComponent(q)}`
        );
        debug(`🔍 Unsplash search response:`, res);

        if (!res || !res.success) {
          console.error(`❌ [P2N] API response indicates failure:`, res);
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
        console.error(`❌ [P2N] Unsplash search error:`, e);
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
          previewCover.style.backgroundImage = `url("${url}")`;
          debug(`🖼️ Selected cover: ${url?.substring(0, 50)}...`);
        };
        results.appendChild(el);
      });
    }

    // Load default images
    (async () => {
      debug(`🖼️ Loading default Unsplash images...`);
      results.innerHTML =
        '<div style="grid-column:1/-1;padding:18px;color:#666;text-align:center;">Loading defaults...</div>';
      try {
        const res = await apiCall("GET", "/api/unsplash/defaults");
        debug(`🖼️ Default images response:`, res);
        const photos = res?.photos || res?.images || [];
        debug(`🖼️ Found ${photos.length} default photos`);
        displayUnsplashImages(photos);
      } catch (e) {
        debug(`❌ Default images error:`, e);
        results.innerHTML =
          '<div style="grid-column:1/-1;padding:18px;color:#666;text-align:center;">Unable to load defaults</div>';
      }
    })();

    // Save functionality
    saveBtn.onclick = () => {
      let iconPref = null;
      let coverPref = null;

      // Prioritize file uploads over emoji/Unsplash selections
      if (selectedIconFileData) {
        iconPref = selectedIconFileData;
        debug("💾 Saving icon file upload preference:", iconPref);
      } else if (selectedIconEmoji) {
        iconPref = { type: "emoji", emoji: selectedIconEmoji };
        debug("💾 Saving icon emoji preference:", iconPref);
      }

      if (selectedCoverFileData) {
        coverPref = selectedCoverFileData;
        debug("💾 Saving cover file upload preference:", coverPref);
      } else if (selectedCoverUrl) {
        coverPref = { type: "external", url: selectedCoverUrl };
        debug("💾 Saving cover external URL preference:", coverPref);
      }

      const prefs = {
        icon: iconPref,
        cover: coverPref,
      };

      GM_setValue("w2n_icon_cover_prefs", prefs);
      showToast("Icon & Cover preferences saved!", 2000);
      debug("💾 Final preferences saved:", prefs);
      modal.remove();
    };

    // Reset to defaults functionality
    resetBtn.onclick = () => {
      if (
        confirm(
          "Reset icon and cover preferences to use defaults? This will clear any custom selections."
        )
      ) {
        // Reset all selections (no blob URL cleanup needed for data URLs)
        selectedIconEmoji = null;
        selectedIconFileData = null;
        selectedCoverUrl = null;
        selectedCoverFileData = null;

        // Clear file input values
        if (iconUpload) iconUpload.value = "";
        if (coverUpload) coverUpload.value = "";

        // Reset previews
        previewIcon.style.backgroundImage = "";
        previewIcon.textContent = "";
        previewCover.style.backgroundImage = "";

        // Save empty preferences
        GM_setValue("w2n_icon_cover_prefs", null);
        showToast("Icon & Cover preferences reset to defaults!", 2000);
        debug("🔄 All preferences and file uploads reset to defaults");
        modal.remove();
      }
    };

}

// =============================================================================
// DATABASE MANAGEMENT
// =============================================================================

async function loadDatabases(panel) {
debug("🎯 loadDatabases() called with panel:", !!panel);
const select = panel.querySelector("#w2n-database-select");
debug("✅ Found database select element");

    // Ensure variables used after the try/finally are declared in outer scope
    let contentHtml = "";
    let images = [];
    let videos = [];
    let metadata = {};
    let pageTitle = "";
    let pageIcon = null;
    let pageCover = null;

    try {
      // Use cached list if available and fresh
      if (
        globalState.currentDatabaseList &&
        globalState.currentDatabaseList.length > 0
      ) {
        debug("📋 Using cached database list");
        const filteredDatabases = filterDatabases(
          globalState.currentDatabaseList
        );
        populateDatabaseSelect(select, filteredDatabases);
        return;
      }

      debug("🔄 Loading databases in chunks of 100 (targeting 500 total)");

      const allDatabases = [];
      let nextCursor = null;
      let chunkNumber = 1;
      const maxChunks = 5; // 5 chunks × 100 = 500 databases

      do {
        debug(`📦 Loading chunk ${chunkNumber}/${maxChunks}...`);

        // Build API URL with pagination
        let endpoint = "/api/databases?page_size=100";
        if (nextCursor) {
          endpoint += `&start_cursor=${encodeURIComponent(nextCursor)}`;
        }

        const result = await apiCall("GET", endpoint);
        debug(`📡 Chunk ${chunkNumber} API response:`, {
          count: result?.databases?.length || result?.length || 0,
          has_more: result?.has_more,
          next_cursor: !!result?.next_cursor,
        });

        // Handle different API response formats
        let databases = null;
        if (result && result.databases && Array.isArray(result.databases)) {
          databases = result.databases;
          nextCursor = result.next_cursor;
          debug(
            `✅ Found ${databases.length} databases in chunk ${chunkNumber}`
          );
        } else if (result && Array.isArray(result)) {
          databases = result;
          nextCursor = null; // Direct array format doesn't include pagination
          debug(
            `✅ Found ${databases.length} databases in direct array format`
          );
        } else if (result && result.success && result.databases) {
          databases = result.databases;
          nextCursor = result.next_cursor;
          debug(
            `✅ Found ${databases.length} databases in success response format`
          );
        } else {
          debug(
            `❌ No databases found in chunk ${chunkNumber} response:`,
            result
          );
          break;
        }

        if (databases && databases.length > 0) {
          allDatabases.push(...databases);
          debug(`📊 Total databases collected so far: ${allDatabases.length}`);
        } else {
          debug(`⚠️ Chunk ${chunkNumber} returned no databases, stopping`);
          break;
        }

        // Stop if no more data or we've reached our target chunks
        if (!result?.has_more || !nextCursor || chunkNumber >= maxChunks) {
          debug(
            `🏁 Stopping pagination: has_more=${
              result?.has_more
            }, cursor=${!!nextCursor}, chunk=${chunkNumber}/${maxChunks}`
          );
          break;
        }

        chunkNumber++;

        // Small delay between requests to be nice to the API
        await new Promise((resolve) => setTimeout(resolve, 100));
      } while (chunkNumber <= maxChunks);

      if (allDatabases.length > 0) {
        debug(
          `✅ Database loading successful, collected ${allDatabases.length} total databases across ${chunkNumber} chunks`
        );

        // Filter databases to show only those with [DB] or [NexusDB]
        const filteredDatabases = filterDatabases(allDatabases);
        debug(
          `🔽 Filtered to ${filteredDatabases.length} databases with [DB] or [NexusDB] tags`
        );

        // Cache the full list (unfiltered) for future use
        globalState.currentDatabaseList = allDatabases;
        GM_setValue("w2n_db_list", {
          list: allDatabases,
          ts: Date.now(),
        });

        populateDatabaseSelect(select, filteredDatabases);
        debug("📥 Database loading completed successfully");
      } else {
        debug("❌ No databases found across all chunks");
        showToast("Could not load databases - no data returned", 3000);
      }
    } catch (error) {
      debug("❌ Database loading error:", error);
      showToast(`Database loading failed: ${error.message}`, 3000);
    }
    debug("📥 Database loading finished");

}

/\*\*

- Filter databases to show only those with [DB], [NexusDB], or API DB in their titles
  \*/
  function filterDatabases(databases) {
  const filtered = databases.filter((db) => {
  const displayTitle =
  db.extractedTitle ||
  db.title?.[0]?.text?.content ||
  db.title?.[0]?.plain_text ||
  db.title ||
  db.name ||
  "Untitled Database";

      const hasDBTag = displayTitle.includes("[DB]");
      const hasNexusDBTag = displayTitle.includes("[NexusDB]");
      const hasAPIDBTag = displayTitle.includes("API DB");

      return hasDBTag || hasNexusDBTag || hasAPIDBTag;

  });


    debug(
      `🔽 Database filtering: ${databases.length} total → ${filtered.length} with [DB], [NexusDB], or API DB tags`
    );

    return filtered;

}

function populateDatabaseSelect(select, databases) {
debug(
"🔧 populateDatabaseSelect() called with",
databases.length,
"databases"
);
debug("🔧 Select element:", !!select, select?.id);
debug("🔧 Looking for database ID:", config.databaseId);

    select.innerHTML = "";

    let foundTargetDatabase = false;

    databases.forEach((db, index) => {
      const option = document.createElement("option");
      option.value = db.id;
      const displayTitle =
        db.extractedTitle ||
        db.title?.[0]?.text?.content ||
        db.title?.[0]?.plain_text ||
        db.title ||
        db.name ||
        "Untitled Database";
      option.textContent = displayTitle;

      if (db.id === config.databaseId) {
        option.selected = true;
        foundTargetDatabase = true;
        debug(
          `✅ Found and selected target database: ${displayTitle} (${db.id})`
        );
      }

      // Debug first few databases
      if (index < 5) {
        debug(`📋 Database ${index + 1}: ${displayTitle} (${db.id})`);
      }

      select.appendChild(option);
    });

    if (!foundTargetDatabase) {
      debug(
        `⚠️ Target database not found in list. Available databases:`,
        databases.map((db) => ({
          id: db.id,
          title:
            db.extractedTitle ||
            db.title?.[0]?.text?.content ||
            db.title ||
            db.name,
        }))
      );
    } else {
      debug(`📊 Database selection complete. Selected: ${config.databaseName}`);
    }

    // Update config when selection changes
    select.onchange = () => {
      const selectedDb = databases.find((db) => db.id === select.value);
      if (selectedDb) {
        config.databaseId = selectedDb.id;
        config.databaseName =
          selectedDb.extractedTitle ||
          selectedDb.title?.[0]?.text?.content ||
          selectedDb.title ||
          selectedDb.name ||
          "Selected Database";
        GM_setValue("notionConfig", config);
        debug(
          `📝 Database updated: ${config.databaseName} (${config.databaseId})`
        );
      }
    };

    // Double-check that our target database is properly selected
    if (foundTargetDatabase) {
      setTimeout(() => {
        if (select.value !== config.databaseId) {
          debug(
            `⚠️ Selection mismatch detected. Correcting to: ${config.databaseId}`
          );
          select.value = config.databaseId;
        }
      }, 100);
    }

}

// Update visible UI elements from current `config` (e.g., show selected database name)
function updateUIFromConfig() {
try {
// Update main panel database label if present
const dbLabel = document.querySelector("#w2n-selected-database-label");
if (dbLabel) {
const dbName =
config.databaseName || config.defaultDatabaseId || "(no database)";
dbLabel.textContent = `Database: ${dbName}`;
}

      // Optionally update other visible toggles/indicators
      const martianIndicator = document.querySelector("#w2n-indicator-martian");
      if (martianIndicator) {
        martianIndicator.textContent = config.useMartian
          ? "Martian: on"
          : "Martian: off";
      }
    } catch (error) {
      console.warn("Failed to update UI from config:", error);
    }

}

// =============================================================================
// UNIVERSAL WORKFLOW COMMUNICATION
// =============================================================================

async function checkWorkflowAvailability() {
return new Promise((resolve) => {
const timeoutId = setTimeout(() => resolve(false), 2000);

      const handleWorkflowResponse = (event) => {
        if (event.detail?.type === "W2N_WORKFLOW_PONG") {
          clearTimeout(timeoutId);
          document.removeEventListener(
            "W2N_WORKFLOW_EVENT",
            handleWorkflowResponse
          );
          resolve(true);
        }
      };

      document.addEventListener("W2N_WORKFLOW_EVENT", handleWorkflowResponse);

      // Send ping
      document.dispatchEvent(
        new CustomEvent("W2N_WORKFLOW_EVENT", {
          detail: {
            type: "W2N_WORKFLOW_PING",
            source: "W2N-P2N",
            timestamp: Date.now(),
          },
        })
      );
    });

}

// =============================================================================
// UNIVERSAL WORKFLOW EVENT LISTENERS
// =============================================================================

// Listen for Universal Workflow readiness
document.addEventListener("W2N_WORKFLOW_READY", (event) => {
debug("🎉 Universal Workflow ready event received:", event.detail);
});

// Listen for all workflow events for debugging
document.addEventListener("W2N_WORKFLOW_EVENT", (event) => {
if (event.detail && event.detail.source !== "W2N-P2N") {
debug("📡 Universal Workflow event received:", {
type: event.detail.type,
source: event.detail.source,
requestId: event.detail.requestId,
});
}
});

async function callWorkflowMethod(methodName, ...args) {
debug(`🔧 callWorkflowMethod called with:`, {
methodName,
methodNameType: typeof methodName,
methodNameValue: JSON.stringify(methodName),
argsLength: args.length,
});

    // Check if Universal Workflow is available
    if (window.W2NWorkflow) {
      debug("✅ Universal Workflow detected via window.W2NWorkflow");
    } else {
      debug(
        "⚠️ Universal Workflow not found on window.W2NWorkflow - will try event communication"
      );
    }

    return new Promise((resolve, reject) => {
      const requestId =
        Date.now() + "_" + Math.random().toString(36).substring(7);

      let responseReceived = false;

      const timeoutId = setTimeout(() => {
        if (!responseReceived) {
          document.removeEventListener("W2N_WORKFLOW_EVENT", handleResponse);
          debug(
            `⏱️ Workflow method '${methodName}' timed out after 15 seconds - this suggests the Universal Workflow is not responding`
          );
          reject(
            new Error(
              `Universal Workflow timeout: method '${methodName}' did not respond within 15 seconds`
            )
          );
        }
      }, 15000); // Increased timeout to 15 seconds for better debugging

      const handleResponse = (event) => {
        if (event.detail?.requestId === requestId && !responseReceived) {
          responseReceived = true;
          clearTimeout(timeoutId);
          document.removeEventListener("W2N_WORKFLOW_EVENT", handleResponse);

          // Skip our own dispatched events
          if (event.detail.source === "W2N-P2N") {
            debug(`🔄 Ignoring our own dispatched event`);
            // Reset and wait for real response
            responseReceived = false;
            document.addEventListener("W2N_WORKFLOW_EVENT", handleResponse);
            return;
          }

          // Handle different response types
          if (
            event.detail.type === "W2N_WORKFLOW_RESPONSE" ||
            event.detail.type === "W2N_WORKFLOW_RESULT"
          ) {
            if (
              event.detail.success === true ||
              (event.detail.success === undefined && !event.detail.error)
            ) {
              debug(`✅ Workflow method '${methodName}' succeeded`);
              resolve(event.detail.result || { success: true });
            } else {
              debug(
                `❌ Workflow method '${methodName}' failed:`,
                event.detail.error
              );
              reject(
                new Error(
                  event.detail.error || `Workflow method '${methodName}' failed`
                )
              );
            }
          } else {
            // For any other response type, assume success unless there's an explicit error
            if (event.detail.error) {
              debug(
                `❌ Workflow method '${methodName}' failed:`,
                event.detail.error
              );
              reject(new Error(event.detail.error));
            } else {
              debug(
                `✅ Workflow method '${methodName}' succeeded (permissive handling)`
              );
              resolve(event.detail.result || { success: true });
            }
          }
        }
      };

      document.addEventListener("W2N_WORKFLOW_EVENT", handleResponse);

      // Send method call
      debug(`🔧 Dispatching workflow call:`, {
        methodName,
        requestId,
        argsLength: args.length,
      });

      const eventDetail = {
        type: "W2N_WORKFLOW_CALL",
        requestId,
        method: methodName, // Changed from methodName to method
        methodName, // Keep both for compatibility
        args,
        source: "W2N-P2N",
        timestamp: Date.now(),
      };

      document.dispatchEvent(
        new CustomEvent("W2N_WORKFLOW_EVENT", {
          detail: eventDetail,
        })
      );
    });

}

// =============================================================================
// PROXY API COMMUNICATION
// =============================================================================

async function apiCall(method, endpoint, data = null) {
return new Promise((resolve, reject) => {
const url = config.proxyUrl + endpoint;

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
          reject(
            new Error(`API call failed: ${error.error || "Network error"}`)
          );
        },
      });
    });

}

async function fetchDatabaseSchema(databaseId) {
debug(`📊 Fetching database schema for: ${databaseId}`);
try {
const result = await apiCall("GET", `/api/databases/${databaseId}`);
if (result && result.database) {
debug(
`✅ Database schema retrieved:`,
result.database.properties
? Object.keys(result.database.properties)
: "No properties"
);
return result.database;
}
throw new Error("Invalid database schema response");
} catch (error) {
debug(`❌ Failed to fetch database schema:`, error);
throw error;
}
}

// =============================================================================
// SERVICENOW CONTENT COLLECTION FOR UNIVERSAL WORKFLOW
// =============================================================================

/\*\*

- Convert ServiceNow documentation URL to currentReleaseURL format
- @param {string} url - The original ServiceNow docs URL
- @returns {string} - The converted currentReleaseURL URL or original if conversion fails
  \*/
  function convertToServiceNowcurrentReleaseURL(url) {
  try {
  debug("🔗 convertToServiceNowcurrentReleaseURL called with:", url);
  if (!url || typeof url !== "string") {
  debug("🔗 Invalid URL input:", url);
  return url;
  }

      // Check if it's a ServiceNow docs URL that can be converted
      if (!url.includes("servicenow.com/docs/bundle/")) {
        debug("🔗 URL does not contain servicenow.com/docs/bundle/:", url);
        return url;
      }

      // Remove any hash fragment first
      const cleanUrl = url.split("#")[0];
      debug("🔗 Clean URL (no hash):", cleanUrl);

      // Extract the filename from the end of the URL path
      const urlParts = cleanUrl.split("/");
      const filename = urlParts[urlParts.length - 1];
      debug("🔗 Extracted filename:", filename);

      // Ensure we have a valid filename (should end with .html)
      if (!filename || !filename.endsWith(".html")) {
        debug("🔗 Invalid filename (no .html):", filename);
        return url;
      }

      // Build the currentReleaseURL URL in CSH format
      const currentReleaseURLUrl = `https://www.servicenow.com/docs/csh?topicname=${filename}&version=latest`;

      debug(`🔗 URL conversion: ${url} → ${currentReleaseURLUrl}`);
      return currentReleaseURLUrl;

  } catch (error) {
  debug("❌ Error converting URL to currentReleaseURL:", error);
  return url; // Return original URL if conversion fails
  }
  }

/\*\*

- Main entry point: Collect content from current ServiceNow page and send to Universal Workflow
- This function is triggered by "Save Current Page" button/menu command
  \*/
  async function captureCurrentPage() {
  debug("🎯 Starting ServiceNow content collection for Universal Workflow");
  globalState.captureMode = "w2n"; // Start the progress overlay


    // Only show progress dialog for manual captures, not during AutoExtract
    const isAutoExtract = globalState.autoExtractState?.running;
    if (window.W2NSavingProgress && !isAutoExtract) {
      window.W2NSavingProgress.start({
        title: "Saving to Notion",
        message: "Preparing content...",
        autoCloseMs: 0,
      });
    }

    try {
      // Step 1: Collect all page content and metadata
      if (window.W2NSavingProgress && !isAutoExtract) {
        window.W2NSavingProgress.setStep("Extracting page content");
        window.W2NSavingProgress.setMessage(
          "Analyzing page structure and content..."
        );
      }

      const collectedData = await collectServiceNowPageContent();

      debug("📊 Content collected:", {
        title: collectedData.title?.substring(0, 50) + "...",
        contentLength: collectedData.contentHtml?.length || 0,
        imageCount: collectedData.images?.length || 0,
        hasMetadata: !!collectedData.metadata,
      });

      // Update progress overlay with preview (icon and cover)
      if (
        window.W2NSavingProgress &&
        !isAutoExtract &&
        (collectedData.icon || collectedData.cover)
      ) {
        const previewData = {};
        if (collectedData.icon) {
          // Handle both emoji and URL icons
          previewData.icon =
            collectedData.icon.type === "emoji"
              ? collectedData.icon.emoji
              : collectedData.icon;
        }
        if (collectedData.cover) {
          // Handle cover URL
          previewData.cover =
            collectedData.cover.type === "external"
              ? collectedData.cover.url
              : collectedData.cover;
        }
        window.W2NSavingProgress.setPreview(previewData);
        debug("🎭 Set preview with:", previewData);
      }

      // Step 2: Validate essential content
      if (!collectedData.contentHtml?.trim()) {
        throw new Error("No content could be extracted from the page");
      }

      // Step 3: Check for duplicates before processing
      if (config.enableDuplicateDetection) {
        if (window.W2NSavingProgress && !isAutoExtract) {
          window.W2NSavingProgress.setStep("Checking for duplicates");
          window.W2NSavingProgress.setMessage(
            "Verifying this content hasn't been saved before..."
          );
        }

        const duplicates = await checkForDuplicates(
          config.databaseId,
          collectedData.title,
          collectedData.url
        );
        if (duplicates?.length > 0) {
          // Close the spinner to show duplicate dialog (only if not AutoExtract)
          if (window.W2NSavingProgress && !isAutoExtract)
            window.W2NSavingProgress.close();

          const proceed = await showDuplicateList(duplicates);
          if (!proceed) {
            showToast("Cancelled: duplicate detected", 3000);
            return;
          }

          // Restart spinner if user chose to proceed (only if not AutoExtract)
          if (window.W2NSavingProgress && !isAutoExtract) {
            window.W2NSavingProgress.start({
              title: "Saving to Notion",
              message: "Processing content...",
              autoCloseMs: 0,
            });
          }
        }
      }

      // Step 4: Send to Universal Workflow for processing
      if (window.W2NSavingProgress && !isAutoExtract) {
        window.W2NSavingProgress.setStep("Processing content");
        window.W2NSavingProgress.setMessage(
          "Converting content to Notion format..."
        );
      }

      const result = await sendToUniversalWorkflow(collectedData);

      // Check if the Universal Workflow returned a successful result
      // The result could be a success object with pageUrl, or just a truthy value
      if (result && (result.success || result.pageUrl || result === true)) {
        if (window.W2NSavingProgress && !isAutoExtract) {
          window.W2NSavingProgress.done({
            pageUrl: result.pageUrl || window.location.href,
            autoCloseMs: 4000,
          });
        }
        // Only show success panel for manual captures, not during AutoExtract
        if (!isAutoExtract) {
          showSuccessPanel(result);
        }
        debug("✅ Content successfully processed by Universal Workflow");
      } else {
        // Only throw error if result is explicitly false or has an error
        debug(
          "⚠️ [captureCurrentPage] Success condition not met, checking for explicit errors..."
        );
        debug("⚠️ [captureCurrentPage] Result value:", result);
        debug("⚠️ [captureCurrentPage] Result === false:", result === false);
        debug("⚠️ [captureCurrentPage] Result?.error:", result?.error);

        const errorMsg =
          result?.error || (result === false ? "Processing failed" : null);
        debug("⚠️ [captureCurrentPage] Determined errorMsg:", errorMsg);

        if (errorMsg) {
          debug(
            "❌ [captureCurrentPage] Throwing error due to explicit error:",
            errorMsg
          );
          throw new Error(errorMsg);
        } else {
          // If no explicit error but no success indicators, log warning but don't fail
          debug(
            "⚠️ Universal Workflow completed but result format unclear:",
            result
          );
          debug(
            "⚠️ This suggests the Universal Workflow method succeeded but content processing failed silently"
          );
          debug("⚠️ Check proxy server logs and Universal Workflow processing");
          debug("✅ Assuming success since no explicit error was reported");
          if (window.W2NSavingProgress && !isAutoExtract) {
            window.W2NSavingProgress.done({
              pageUrl: window.location.href,
              autoCloseMs: 4000,
            });
          }
          // Only show success panel for manual captures, not during AutoExtract
          if (!isAutoExtract) {
            showSuccessPanel(result || { success: true });
          }
        }
      }
    } catch (error) {
      debug("❌ ServiceNow content collection failed:", error);

      let errorMessage = error.message;
      let suggestions = "";

      if (error.message.includes("CORS-blocked iframe")) {
        suggestions =
          "\n\nSuggestions:\n• Try refreshing the page and capturing again\n• The content may be in a protected iframe that cannot be accessed\n• Contact support if this persists";
      } else if (error.message.includes("CSS styling")) {
        suggestions =
          "\n\nThe system detected CSS styling instead of book content. This usually means:\n• The book content is in a protected iframe\n• Try scrolling to ensure the content is fully loaded\n• Refresh the page and try again";
      }

      // During AutoExtract, don't show error UI - let retry logic handle it
      if (globalState.autoExtractState?.running) {
        // Close any progress dialog and re-throw error for AutoExtract retry logic
        if (window.W2NSavingProgress) {
          window.W2NSavingProgress.close();
        }
        throw error;
      }

      // Normal error handling for manual captures
      if (window.W2NSavingProgress) {
        window.W2NSavingProgress.error({
          message: `Content capture failed: ${errorMessage}${suggestions}`,
          retryCallback: () => {
            window.W2NSavingProgress.close();
            captureCurrentPage();
          },
        });
      } else {
        showErrorPanel(`Content capture failed: ${errorMessage}${suggestions}`);
      }

      // Re-throw the error so AutoExtract retry logic can catch it
      throw error;
    }

}

/\*\*

- Collect and bundle all content from the current ServiceNow page
- Returns structured data ready for Universal Workflow processing
  \*/
  async function collectServiceNowPageContent() {
  debug("📄 Collecting ServiceNow page content");


    // Hoisted variables used across multiple branches and returned at the end
    let contentHtml = "";
    let images = [];
    let videos = [];
    let metadata = {};
    let pageTitle = "";
    let pageIcon = null;
    let pageCover = null;

    // Debug: Log all iframe elements on the page
    const allIframes = document.querySelectorAll("iframe");
    debug(`🔍 Found ${allIframes.length} iframe(s) on page:`);
    allIframes.forEach((iframe, index) => {
      debug(
        `  Iframe ${index + 1}: id="${iframe.id}", src="${
          iframe.src
        }", class="${iframe.className}"`
      );
    });

    // Find main content container
    const contentElement = findServiceNowContentElement();
    if (!contentElement) {
      throw new Error("Could not locate main content on page");
    }

    // Temporarily hide header elements from the main document before content extraction
    // Previously we removed the header elements which caused them to disappear permanently
    // Hide instead and restore afterwards in a finally block so the page UI remains intact
    const headerElements = Array.from(
      document.querySelectorAll("#zDocsContent > header")
    );
    const __w2n_hiddenHeaders = [];
    headerElements.forEach((header) => {
      try {
        debug(
          "🗑️ Hiding header element from main document to prevent content capture"
        );
        __w2n_hiddenHeaders.push({
          el: header,
          originalDisplay: header.style.display || "",
        });
        header.style.display = "none";
        header.setAttribute("data-w2n-hidden", "true");
      } catch (e) {
        debug(
          "⚠️ Error hiding header element:",
          e && e.message ? e.message : e
        );
      }
    });

    try {
      debug(
        `✅ Content element found: ${contentElement.tagName}${
          contentElement.id ? "#" + contentElement.id : ""
        }`
      );
      debug(
        `📏 Content element dimensions: ${contentElement.offsetWidth}x${contentElement.offsetHeight}`
      );

      // If we found a non-iframe element, check if it contains iframes we should prioritize
      if (contentElement.tagName !== "IFRAME") {
        const innerIframes = contentElement.querySelectorAll(
          'iframe[id^="epubjs-view-"]'
        );
        if (innerIframes.length > 0) {
          debug(
            `🔄 Found epubjs-view iframe INSIDE content element, switching to iframe`
          );
          const iframe = innerIframes[0];
          debug(
            `🔄 Switching from ${contentElement.tagName}#${contentElement.id} to iframe#${iframe.id}`
          );

          // Extract directly from the iframe instead
          const iframeContentWithImages = await extractContentWithIframes(
            iframe
          );
          contentHtml = iframeContentWithImages.combinedHtml;
          images = iframeContentWithImages.combinedImages || [];

          debug(`📊 Iframe content length: ${contentHtml.length} characters`);

          if (contentHtml && contentHtml.trim().length > 50) {
            // Continue with iframe content
            metadata = extractServiceNowMetadata();
            const databaseProperties = extractDatabaseProperties();

            // Merge database properties into metadata
            Object.assign(metadata, databaseProperties);

            pageTitle = extractPageTitle();

            // 🎥 Extract videos from iframe content
            videos = detectVideosInContent(iframe);

            images = validateAndCleanImages(images);
            contentHtml = cleanInvalidImageReferences(contentHtml);
            contentHtml = convertItalicClassToItalicText(contentHtml);
            contentHtml = convertBoldClassToBoldText(contentHtml);
            contentHtml = filterTrademarkSymbols(contentHtml);
            contentHtml = replaceTableImagesWithEmojis(contentHtml);
            contentHtml = styleTableHeaders(contentHtml);
            contentHtml = removeTableSearchLabels(contentHtml);
            contentHtml = convertMarkdownItalicToHtml(contentHtml);
            contentHtml = cleanUrlsInHtml(contentHtml);

            // 🎥 Process and append videos to content
            contentHtml = appendVideosToContent(contentHtml, videos);

            return {
              title: pageTitle,
              contentHtml: contentHtml,
              url: cleanAndValidateUrl(window.location.href),
              images: images,
              videos: videos,
              metadata: metadata,
              databaseId: config.databaseId,
            };
          } else {
            debug(
              `❌ CRITICAL: Iframe content extraction failed - iframe is likely CORS-blocked`
            );
            debug(
              `❌ Refusing to fallback to container to avoid capturing page wrapper content`
            );
            throw new Error(
              "Cannot extract content from CORS-blocked iframe. The actual book content is in an iframe that cannot be accessed due to security restrictions."
            );
          }
        }
      }

      // Extract content with iframes if present
      const contentWithIframes = await extractContentWithIframes(
        contentElement
      );
      contentHtml = contentWithIframes.combinedHtml;
      images = contentWithIframes.combinedImages || [];

      debug(`📊 Extracted content length: ${contentHtml.length} characters`);
      debug(`🖼️ Extracted ${images.length} images`);

      // SPECIAL HANDLING: Look for span.title elements outside the main content area
      // These elements might be in headers, sidebars, or other areas not captured by the main selector
      const pageSpanTitles = document.querySelectorAll("span.title");
      debug(`🔍 Found ${pageSpanTitles.length} span.title elements on page`);

      if (pageSpanTitles.length > 0) {
        // Check if any span.title elements are missing from our captured content
        const parser = new DOMParser();
        const contentDoc = parser.parseFromString(contentHtml, "text/html");
        const capturedSpanTitles = contentDoc.querySelectorAll("span.title");

        // Page span.title analysis complete

        // Process ALL span.title elements to convert table captions to headings
        const allSpanTitlesToProcess = [];
        pageSpanTitles.forEach((spanTitle) => {
          const text = spanTitle.textContent.trim();

          // Check if this span.title is in a caption that appears before/in a table
          let isTableCaption = false;
          let captionElement = spanTitle.closest("caption");

          if (captionElement) {
            // Check if this caption is inside a table (standard HTML structure)
            let parentTable = captionElement.closest("table");

            // Also check if this caption appears before a table (alternative structure)
            let nextElement = captionElement.nextElementSibling;
            let parentNext = captionElement.parentElement?.nextElementSibling;

            if (
              parentTable ||
              (nextElement && nextElement.tagName === "TABLE") ||
              (parentNext && parentNext.tagName === "TABLE")
            ) {
              isTableCaption = true;
            }
          }

          // Check if this span.title is captured in content
          let capturedInContent = false;
          capturedSpanTitles.forEach((captured) => {
            if (captured.textContent.trim() === text) {
              capturedInContent = true;
            }
          });

          allSpanTitlesToProcess.push({
            element: spanTitle,
            text: text,
            isTableCaption: isTableCaption,
            capturedInContent: capturedInContent,
          });

          if (!capturedInContent) {
            debug(
              `📝 Missing span.title: "${text}" ${
                isTableCaption ? "(table caption)" : ""
              }`
            );
          }
        });

        // Convert table captions to headings in the existing content
        if (
          allSpanTitlesToProcess.some(
            (item) => item.isTableCaption && item.capturedInContent
          )
        ) {
          // Convert captured table captions to h3 headings in content

          const parser = new DOMParser();
          const contentDoc = parser.parseFromString(contentHtml, "text/html");

          allSpanTitlesToProcess.forEach((item) => {
            if (item.isTableCaption && item.capturedInContent) {
              // Find the span.title in content and replace with h3
              const spanInContent = Array.from(
                contentDoc.querySelectorAll("span.title")
              ).find((span) => span.textContent.trim() === item.text);

              if (spanInContent) {
                const h3Element = contentDoc.createElement("h3");
                h3Element.className = "table-caption-title";
                h3Element.textContent = item.text;

                // If the span is inside a <caption>, move the h3 before the related table
                const captionEl = spanInContent.closest("caption");
                if (captionEl) {
                  const parentTable = captionEl.closest("table");
                  if (parentTable && parentTable.parentNode) {
                    parentTable.parentNode.insertBefore(h3Element, parentTable);
                    // Remove the original caption (and span)
                    captionEl.parentNode.removeChild(captionEl);
                  } else {
                    // Fallback: replace the span with h3 in place
                    spanInContent.parentNode.replaceChild(
                      h3Element,
                      spanInContent
                    );
                  }
                } else {
                  // Not inside caption; just replace the span with h3
                  spanInContent.parentNode.replaceChild(
                    h3Element,
                    spanInContent
                  );
                }
              }
            }
          });

          contentHtml = contentDoc.body.innerHTML;
        }

        // Add any missing span.title elements to content
        const missingSpanTitles = allSpanTitlesToProcess.filter(
          (item) => !item.capturedInContent
        );
        if (missingSpanTitles.length > 0) {
          debug(
            `⚠️ Some span.title elements are missing from main content - attempting to include them`
          );

          // Prepend missing span.title elements to content
          const additionalContent = missingSpanTitles
            .map((missing) => {
              if (missing.isTableCaption) {
                // For table captions, create a proper heading that maps to Notion
                // Use h3 for table captions (Notion supports heading_1..heading_3)
                return `<h3 class="table-caption-title">${missing.text}</h3>`;
              } else {
                // For other span.title elements, preserve as strong with title class
                return `<div class="missing-title-recovered"><strong class="title">${missing.text}</strong></div>`;
              }
            })
            .join("\n");

          contentHtml = additionalContent + "\n\n" + contentHtml;
          debug(
            `✅ Added ${
              missingSpanTitles.length
            } missing span.title elements to content (${
              missingSpanTitles.filter((m) => m.isTableCaption).length
            } table captions as h3 headings)`
          );
        }
      }

      // 🎥 Extract videos from content
      videos = detectVideosInContent(contentElement);

      // Validate that we didn't capture CSS/wrapper content
      if (
        contentHtml.includes(":root {") ||
        contentHtml.includes("--spaceWidth:") ||
        contentHtml.includes("--fontFamily:")
      ) {
        debug(
          `❌ CRITICAL: Captured content appears to be CSS styling, not book content`
        );
        debug(`❌ First 200 chars: ${contentHtml.substring(0, 200)}...`);
        throw new Error(
          "Captured CSS styling instead of book content. The book content is likely in a CORS-blocked iframe that cannot be accessed."
        );
      }

      // Additional validation for empty or minimal content
      if (contentHtml.trim().length < 100) {
        debug(
          `❌ CRITICAL: Captured content is too short (${
            contentHtml.trim().length
          } chars)`
        );
        throw new Error(
          "Captured content is too short - likely failed to extract actual book content."
        );
      }

      // Extract page metadata
      metadata = extractServiceNowMetadata();
      const databaseProperties = extractDatabaseProperties();

      // Merge database properties into metadata
      Object.assign(metadata, databaseProperties);

      // Get page title - prefer extracted title over document.title
      pageTitle = extractPageTitle();

      // Extract page icon and cover
      pageIcon = extractPageIcon();
      pageCover = extractPageCover();

      // Validate and clean images
      images = validateAndCleanImages(images);

      // Clean content HTML of invalid image references
      contentHtml = cleanInvalidImageReferences(contentHtml);

      // Convert Italic class elements to proper italic formatting
      contentHtml = convertItalicClassToItalicText(contentHtml);

      // Convert Bold class elements to proper bold formatting
      contentHtml = convertBoldClassToBoldText(contentHtml);

      // Filter out trademark symbols before markdown conversion
      contentHtml = filterTrademarkSymbols(contentHtml);

      // Replace images in tables with emojis for better text separation
      contentHtml = replaceTableImagesWithEmojis(contentHtml);

      // Style table headers with blue background
      contentHtml = styleTableHeaders(contentHtml);

      // Remove table search labels (DataTables filter elements)
      contentHtml = removeTableSearchLabels(contentHtml);

      // Convert markdown-style italic formatting to HTML
      contentHtml = convertMarkdownItalicToHtml(contentHtml);

      // Clean URLs in HTML content to prevent Notion validation errors
      contentHtml = cleanUrlsInHtml(contentHtml);

      // 🎥 Process and append videos to content
      contentHtml = appendVideosToContent(contentHtml, videos);

      // Debug: Check if cleaning worked
      if (contentHtml.includes("[Invalid Image:")) {
        debug(
          `🚨 WARNING: HTML still contains [Invalid Image:] text after cleaning!`
        );
        const matches = contentHtml.match(/\[Invalid Image:[^\]]+\]/gi);
        if (matches) {
          debug(`🚨 Found ${matches.length} remaining invalid image patterns:`);
          matches.slice(0, 3).forEach((match, i) => {
            debug(`   ${i + 1}: "${match}"`);
          });
        }
      } else {
        debug(`✅ HTML content successfully cleaned of invalid image text`);
      }
    } finally {
      // Restore any temporarily hidden headers so the page UI is unchanged
      try {
        if (
          Array.isArray(__w2n_hiddenHeaders) &&
          __w2n_hiddenHeaders.length > 0
        ) {
          __w2n_hiddenHeaders.forEach((h) => {
            try {
              if (!h || !h.el) return;
              h.el.style.display = h.originalDisplay || "";
              h.el.removeAttribute("data-w2n-hidden");
            } catch (err) {
              // ignore individual restore errors
            }
          });
        }
      } catch (err) {
        debug(
          "⚠️ Error restoring header elements:",
          err && err.message ? err.message : err
        );
      }
    }

    // Ensure we have a sensible title: prefer extracted pageTitle, then metadata fields, then document.title
    try {
      if (
        !pageTitle ||
        (typeof pageTitle === "string" && pageTitle.trim() === "")
      ) {
        const metaTitle =
          metadata && (metadata.title || metadata.name || metadata.Name);
        pageTitle =
          metaTitle ||
          (document && document.title ? document.title : pageTitle);
      }
    } catch (e) {
      // If anything goes wrong reading document.title, silently continue with existing pageTitle
      debug(
        "⚠️ Error applying document.title fallback:",
        e && e.message ? e.message : e
      );
    }

    return {
      title: pageTitle,
      contentHtml: contentHtml,
      url: cleanAndValidateUrl(window.location.href),
      images: images,
      videos: videos,
      metadata: metadata,
      databaseId: config.databaseId,
      icon: pageIcon,
      cover: pageCover,
    };

}

/\*\*

- Find the main content element on the ServiceNow page
  \*/
  function findServiceNowContentElement() {
  debug("🔍 Searching for ServiceNow content element...");


    // PRIORITY 0: Check for Notion page content first
    const zDocsContent = document.querySelector("#zDocsContent");
    if (zDocsContent && zDocsContent.innerHTML?.trim().length > 0) {
      debug("✅ Found Notion page content: #zDocsContent");
      return zDocsContent;
    }

    // PRIORITY 1: Look for epubjs-view iframes first (ServiceNow book reader)
    let epubjsIframes = document.querySelectorAll('iframe[id^="epubjs-view-"]');

    // If not found at document level, look within common containers
    if (epubjsIframes.length === 0) {
      const containers = document.querySelectorAll(
        'main, [id*="epub"], [class*="epub"], [class*="reader"], [class*="book"]'
      );
      for (const container of containers) {
        epubjsIframes = container.querySelectorAll(
          'iframe[id^="epubjs-view-"]'
        );
        if (epubjsIframes.length > 0) {
          debug(
            `✅ Found epubjs-view iframe in container: ${container.tagName}${
              container.id ? "#" + container.id : ""
            }`
          );
          break;
        }
      }
    }

    if (epubjsIframes.length > 0) {
      debug(`✅ Found epubjs-view iframe: ${epubjsIframes[0].id}`);
      return epubjsIframes[0];
    }

    // PRIORITY 2: Look for epubjs-view elements (non-iframe)
    const epubjsElements = document.querySelectorAll('[id^="epubjs-view-"]');
    if (epubjsElements.length > 0) {
      debug(`✅ Found epubjs-view element: ${epubjsElements[0].id}`);
      return epubjsElements[0];
    }

    // PRIORITY 3: Look for other epub-related iframes
    const allIframes = document.querySelectorAll("iframe");
    for (const iframe of allIframes) {
      if (
        iframe.src &&
        (iframe.src.includes("epub") || iframe.id.includes("epub"))
      ) {
        debug(`✅ Found epub-related iframe: ${iframe.id || iframe.src}`);
        return iframe;
      }
    }

    // PRIORITY 4: Standard content selectors
    const contentSelectors = [
      ".zDocsTopicPageBody .zDocsTopicPageBodyContent article.dita", // ServiceNow docs broader content (includes captions before tables)
      ".zDocsTopicPageBody .zDocsTopicPageBodyContent article.dita .body.conbody", // ServiceNow docs precise content body
      "#zDocsContent", // Notion page content area
      "id=epubjs-view-*",
      ".ResponsiveBookReader---content---",
      ".book-content",
      ".lesson-content",
      ".page-content",
      "main",
      ".content",
      ".article-content",
      ".epub-container",
      ".reader-content",
      ".book-reader",
      "[class*='content']",
      "[class*='reader']",
      "[class*='book']",
    ];

    // Try primary selectors
    for (const selector of contentSelectors) {
      const element = document.querySelector(selector);
      if (element?.innerHTML?.trim().length > 0) {
        debug(`✅ Found content with selector: ${selector}`);
        return element;
      }
    }

    // Final fallback selectors
    const fallbackSelectors = ["body", "#content", ".main", '[role="main"]'];
    for (const selector of fallbackSelectors) {
      const element = document.querySelector(selector);
      if (element?.innerHTML?.trim().length > 100) {
        debug(`✅ Found content with fallback selector: ${selector}`);
        return element;
      }
    }

    debug("❌ No suitable content element found");
    return null;

}

/\*\*

- Extract comprehensive metadata from the ServiceNow page using specific CSS selectors
  \*/
  function extractServiceNowMetadata() {
  debug("🔍 Extracting ServiceNow metadata...");


    const metadata = { capturedAt: new Date().toISOString() };

    // Default source for ServiceNow captures
    try {
      metadata.source = "ServiceNow Documentation";
    } catch (e) {
      // ignore
    }

    // Helper to return the first non-empty match for a list of selectors
    const firstMatchText = (selectors = []) => {
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
    };

    try {
      // Populate common fields (use selectors where available)
      // Helper to prefer an interactively provided custom selector, then fall back
      const getPrefixedMatch = (propName, fallbackSelectorsOrArray) => {
        let val = "";
        try {
          if (
            CUSTOM_PROPERTY_SELECTORS &&
            CUSTOM_PROPERTY_SELECTORS[propName]
          ) {
            val = firstMatchText([CUSTOM_PROPERTY_SELECTORS[propName]]) || "";
          }
        } catch (e) {
          // ignore invalid custom selector
        }
        if (val) return val;
        // fallbackSelectorsOrArray may be a single selector array or a nested array
        return Array.isArray(fallbackSelectorsOrArray)
          ? firstMatchText(fallbackSelectorsOrArray)
          : firstMatchText([fallbackSelectorsOrArray]);
      };

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
        const breadcrumbSelector =
          (CUSTOM_PROPERTY_SELECTORS && CUSTOM_PROPERTY_SELECTORS.breadcrumb) ||
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
      const authorText = getPrefixedMatch(
        "author",
        SERVICENOW_SELECTORS.author
      );

      // KB number and category
      const kbNumberText = getPrefixedMatch(
        "kbNumber",
        SERVICENOW_SELECTORS.kbNumber
      );
      const categoryText = getPrefixedMatch(
        "category",
        SERVICENOW_SELECTORS.category
      );

      // Section - extract from breadcrumb 4th span with "Current page" filtering
      let sectionText = "";
      try {
        const sectionSelector =
          (CUSTOM_PROPERTY_SELECTORS && CUSTOM_PROPERTY_SELECTORS.section) ||
          "#zDocsTopicPage > div.zDocsTopicPageTopicContainer > div.zDocsTopicPageBreadcrumbsContainer > div > span:nth-child(4) > a";
        let sectionEl = document.querySelector(sectionSelector);

        // If anchor not found, try without the "> a" part
        if (!sectionEl) {
          const fallbackSelector = sectionSelector.replace(" > a", "");
          sectionEl = document.querySelector(fallbackSelector);
        }

        if (sectionEl) {
          const normalizeSectionText = (s) => {
            if (!s) return "";
            // remove screen-reader markers like 'Current page' (various forms)
            s = s.replace(/\bCurrent page\b/gi, "").trim();
            s = s.replace(/\bcurrent\s*page\b/gi, "").trim();
            s = s.replace(/\(current\s*page\)/gi, "").trim();
            s = s.replace(/\[current\s*page\]/gi, "").trim();
            // remove the word Home entirely
            s = s.replace(/\bHome\b/gi, "").trim();
            // remove common navigation indicators
            s = s.replace(/\(current\)/gi, "").trim();
            s = s.replace(/\[current\]/gi, "").trim();
            // collapse whitespace and trim separators
            s = s.replace(/\s{2,}/g, " ").replace(/^[>\-–\s]+|[>\-–\s]+$/g, "");
            // remove empty parentheses and brackets
            s = s
              .replace(/\(\s*\)/g, "")
              .replace(/\[\s*\]/g, "")
              .trim();
            return s;
          };

          sectionText = normalizeSectionText(sectionEl.textContent || "");

          // Double-check: if result still contains "current page" patterns, try to clean further
          if (/current\s*page/gi.test(sectionText)) {
            sectionText = sectionText.replace(/current\s*page/gi, "").trim();
            sectionText = sectionText.replace(/\s{2,}/g, " ").trim();
          }
        }
      } catch (e) {
        // fallback to getPrefixedMatch if custom logic fails
        sectionText = getPrefixedMatch("section", []);
      }

      // Tags - prefer custom selector, otherwise use first tags selector and join children
      let tagsText = "";
      try {
        const tagSelector =
          (CUSTOM_PROPERTY_SELECTORS && CUSTOM_PROPERTY_SELECTORS.tags) ||
          SERVICENOW_SELECTORS.tags[0];
        const tagEl = document.querySelector(tagSelector);
        if (tagEl) {
          tagsText = Array.from(tagEl.querySelectorAll("li,span,a"))
            .map((t) => (t.textContent || "").trim())
            .filter(Boolean)
            .join(", ");
        }
      } catch (e) {
        // ignore
      }

      // Build normalized entries (use lowercase field names consistently)
      if (versionText) {
        metadata.version = versionText;
      }
      if (updatedText) {
        metadata.updated = updatedText;
      }
      if (breadcrumbText) {
        metadata.breadcrumb = breadcrumbText;
      }
      if (authorText) {
        metadata.author = authorText;
      }
      if (kbNumberText) {
        metadata.kbNumber = kbNumberText;
      }
      if (categoryText) {
        metadata.category = categoryText;
      }
      if (sectionText) {
        metadata.section = sectionText;
      }
      if (tagsText) {
        metadata.tags = tagsText;
      }

      // URL
      try {
        const url = window.location.href;
        metadata.url = url;
      } catch (e) {
        /* ignore */
      }

      // Title / Name - prefer custom selector if provided, otherwise extract from content
      try {
        let pageTitle = "";
        try {
          if (CUSTOM_PROPERTY_SELECTORS && CUSTOM_PROPERTY_SELECTORS.title) {
            const el = document.querySelector(CUSTOM_PROPERTY_SELECTORS.title);
            if (el && el.textContent && el.textContent.trim()) {
              pageTitle = el.textContent.trim();
            }
          }
        } catch (e) {
          /* ignore invalid selector */
        }

        if (!pageTitle) {
          pageTitle = extractPageTitle();
        }

        if (pageTitle) {
          metadata.title = pageTitle;
        }
      } catch (e) {
        /* ignore */
      }

      // Figure/Image presence
      try {
        const imgs = document.querySelectorAll("img, figure, svg, canvas");
        const hasFigure = imgs && imgs.length > 0;
        metadata.hasFigureImage = hasFigure;
      } catch (e) {
        metadata.hasFigureImage = false;
      }

      // Video presence (boolean) - use detectVideosInContent when available
      try {
        let videos = [];
        try {
          const contentElement = findServiceNowContentElement();
          if (typeof detectVideosInContent === "function" && contentElement) {
            videos = detectVideosInContent(contentElement);
          }
        } catch (innerErr) {
          debug(
            "🎥 Error running video detection:",
            innerErr.message || innerErr
          );
        }

        const hasVideo = Array.isArray(videos) && videos.length > 0;
        metadata.hasVideos = hasVideo;
        // also include the detected video objects for downstream use
        if (hasVideo) metadata.videos = videos;
      } catch (e) {
        metadata.hasVideos = false;
      }

      // Provide safe fallbacks
      if (!metadata.source && metadata.url) metadata.source = metadata.url;

      // Also provide a properties object (userscript convenience) with canonical names
      metadata.properties = metadata.properties || {};
      const propertyMappings = loadPropertyMappings(config.databaseId);

      const propMap = {};
      // Convert property mappings to old format for compatibility
      if (propertyMappings && Object.keys(propertyMappings).length > 0) {
        debug("🔧 Found property mappings, using them for field mapping");
        // Handle direct mapping format: {contentField: "NotionPropertyName"}
        Object.entries(propertyMappings).forEach(
          ([contentField, notionPropertyName]) => {
            if (typeof notionPropertyName === "string") {
              propMap[contentField] = notionPropertyName;
            } else if (
              notionPropertyName &&
              notionPropertyName.enabled &&
              notionPropertyName.contentField
            ) {
              // Handle complex mapping format: {notionProp: {enabled: true, contentField: "field"}}
              propMap[notionPropertyName.contentField] = contentField;
            }
          }
        );
      } else {
        // No property mappings exist - remove problematic fields from metadata
        // to prevent Universal Workflow from trying to map them to non-existent properties
        debug(
          "⚠️ No property mappings found - removing hasFigureImage and hasVideos from metadata to prevent mapping errors"
        );
        debug(
          "🔧 Before deletion - hasFigureImage:",
          metadata.hasFigureImage,
          "hasVideos:",
          metadata.hasVideos
        );
        delete metadata.hasFigureImage;
        delete metadata.hasVideos;
        debug(
          "🔧 After deletion - hasFigureImage:",
          metadata.hasFigureImage,
          "hasVideos:",
          metadata.hasVideos
        );

        // Fallback: use direct mapping for critical fields when no mappings exist
        propMap["currentReleaseURL"] = "CurrentReleaseURL";
        propMap["url"] = "url";
        propMap["title"] = "title";
        propMap["version"] = "version";
        propMap["updated"] = "updated";
        propMap["breadcrumb"] = "breadcrumb";
        propMap["author"] = "author";
        // Note: Do NOT include hasVideos or hasFigureImage in fallback since we deleted them
      }
      // copy known fields into metadata.properties using mapped Notion property names
      const safeCopy = (fieldName, value) => {
        if (!value) return;
        const mapped = propMap[fieldName] || fieldName;
        metadata.properties[mapped] = value;
      };

      safeCopy("version", versionText);
      safeCopy("updated", updatedText);
      safeCopy("breadcrumb", breadcrumbText);
      safeCopy("author", authorText);
      safeCopy("kbNumber", kbNumberText);
      safeCopy("category", categoryText);
      safeCopy("section", sectionText);
      safeCopy("tags", tagsText);
      safeCopy("url", metadata.url || "");
      safeCopy("title", metadata.title || "");

      // Only copy video/image booleans if they exist in metadata (when mappings are configured)
      if (metadata.hasOwnProperty("hasVideos")) {
        safeCopy("hasVideos", metadata.hasVideos === true ? true : false);
      }
      if (metadata.hasOwnProperty("hasFigureImage")) {
        safeCopy(
          "hasFigureImage",
          metadata.hasFigureImage === true ? true : false
        );
      }
      // Latest version URL: generate currentReleaseURL from current page URL
      try {
        const currentUrl = window.location.href;
        const convertedcurrentReleaseURL =
          convertToServiceNowcurrentReleaseURL(currentUrl);

        if (
          convertedcurrentReleaseURL &&
          convertedcurrentReleaseURL !== currentUrl
        ) {
          metadata.currentReleaseURL = convertedcurrentReleaseURL;

          safeCopy("currentReleaseURL", convertedcurrentReleaseURL);
        }
      } catch (err) {
        debug("❌ Error generating currentReleaseURL:", err.message || err);
      }
    } catch (err) {
      debug("⚠️ Error extracting ServiceNow metadata:", err.message || err);
    }

    debug("✅ ServiceNow metadata extraction completed", metadata);
    return metadata;

}

/\*\*

- Extract page title - now prioritizes first line of content
  \*/
  function extractPageTitle() {
  // NEW: First try to get title from the first line of content
  try {
  const contentElement = findServiceNowContentElement();

      // Temporarily hide header elements to prevent them from interfering with title extraction
      const headerElements = Array.from(
        document.querySelectorAll("#zDocsContent > header")
      );
      const __w2n_tmpHidden = [];
      headerElements.forEach((header) => {
        try {
          __w2n_tmpHidden.push({
            el: header,
            originalDisplay: header.style.display || "",
          });
          header.style.display = "none";
          header.setAttribute("data-w2n-hidden", "true");
        } catch (e) {
          /* ignore */
        }
      });

      debug(`🔍 Content element found: ${!!contentElement}`);
      if (contentElement) {
        debug(
          `🔍 Content element tag: ${contentElement.tagName}, class: ${contentElement.className}`
        );

        // If it's an iframe, try to access its content document
        let searchElement = contentElement;
        if (contentElement.tagName === "IFRAME") {
          try {
            const iframeDoc =
              contentElement.contentDocument ||
              contentElement.contentWindow?.document;
            if (iframeDoc && iframeDoc.body) {
              debug(`🔍 Accessing iframe content document`);
              searchElement = iframeDoc.body;
            } else {
              debug(`⚠️ Cannot access iframe content document (CORS issue)`);
              // Fallback to iframe itself for now
            }
          } catch (corsError) {
            debug(`⚠️ CORS error accessing iframe: ${corsError.message}`);
            // Continue with iframe element itself
          }
        }

        // Look for headings first (prioritize them over paragraphs)
        const headingElements = searchElement.querySelectorAll(
          "h1, h2, h3, h4, h5, h6, .title, .chapter-title, .lesson-title"
        );

        debug(
          `🔍 Found ${headingElements.length} potential heading elements in ${searchElement.tagName}`
        );

        // Check headings first - they should be prioritized as titles
        for (const element of headingElements) {
          const text = element.textContent?.trim() || "";
          debug(
            `🔍 Checking heading ${element.tagName}.${element.className}: "${text}" (length: ${text.length})`
          );
          // Use headings with more relaxed length requirements
          if (text && text.length > 3 && text.length < 300) {
            debug(`📝 ✅ Found suitable heading title: "${text}"`);
            return text;
          } else {
            debug(
              `📝 ❌ Heading rejected - length: ${
                text.length
              }, text: "${text.substring(0, 30)}..."`
            );
          }
        }

        // If no suitable heading found, check paragraphs as fallback
        const paragraphElements = searchElement.querySelectorAll("p");
        debug(
          `🔍 No suitable headings found, checking ${paragraphElements.length} paragraphs as fallback`
        );

        for (const element of paragraphElements) {
          const text = element.textContent?.trim() || "";
          debug(
            `🔍 Checking paragraph: "${text.substring(0, 50)}..." (length: ${
              text.length
            })`
          );
          // Use more strict requirements for paragraphs since they're not ideal titles
          if (text && text.length > 10 && text.length < 100) {
            debug(`📝 Using paragraph as title fallback: "${text}"`);
            return text;
          }
        }

        // If no suitable heading or paragraph found, try the very first text node as last resort
        debug(
          `🔍 No suitable elements found, trying text walker as final fallback`
        );
        const walker = document.createTreeWalker(
          searchElement,
          NodeFilter.SHOW_TEXT,
          {
            acceptNode: function (node) {
              const text = node.textContent?.trim() || "";
              // Skip empty text nodes and very short text
              if (text.length < 10) return NodeFilter.FILTER_REJECT;
              return NodeFilter.FILTER_ACCEPT;
            },
          }
        );

        const firstTextNode = walker.nextNode();
        if (firstTextNode) {
          const text = firstTextNode.textContent?.trim() || "";
          debug(
            `🔍 First text node: "${text.substring(0, 50)}..." (length: ${
              text.length
            })`
          );
          if (text.length > 10 && text.length < 200) {
            debug(`📝 Using first text node as title: "${text}"`);
            return text;
          }
        }
      }

  } catch (error) {
  debug(`⚠️ Error extracting title from content: ${error.message}`);
  }


    // restore temporarily hidden headers from title extraction
    try {
      if (Array.isArray(__w2n_tmpHidden)) {
        __w2n_tmpHidden.forEach((h) => {
          try {
            h.el.style.display = h.originalDisplay || "";
            h.el.removeAttribute("data-w2n-hidden");
          } catch (e) {
            /* ignore individual restore errors */
          }
        });
      }
    } catch (e) {
      /* ignore */
    }

    // FALLBACK: Try to extract title from page elements (original logic)
    const titleSelectors = [
      'meta[property="og:title"]',
      'meta[name="title"]',
      "h1",
      ".title",
      ".page-title",
      ".chapter-title",
      ".lesson-title",
    ];

    for (const selector of titleSelectors) {
      const element = document.querySelector(selector);
      let title = "";

      if (selector.startsWith("meta")) {
        title = element?.content?.trim() || "";
      } else {
        title = element?.textContent?.trim() || "";
      }

      if (title && title.length > 0 && title !== "Untitled") {
        debug(`📝 Extracted title from ${selector}: "${title}"`);
        return title;
      }
    }

    // Fallback to document.title, but clean it up
    let title = document.title || "Untitled";
    if (title.startsWith("ServiceNow Book ")) {
      title = title.replace(/^ServiceNow Book /, "").trim();
    }

    return title || "Untitled";

}

/\*\*

- Extract page icon from favicon and meta tags
  \*/
  function extractPageIcon() {
  try {
  // First check for user-selected icon preferences
  const savedPrefs = GM_getValue("w2n_icon_cover_prefs", null);
  if (savedPrefs && savedPrefs.icon) {
  debug(
  `🎭 Using user-selected icon: ${
          savedPrefs.icon.type === "emoji"
            ? savedPrefs.icon.emoji
            : savedPrefs.icon.url
        }`
  );
  return savedPrefs.icon;
  }

      // Use default ServiceNow product documentation icon
      const defaultIcon = {
        type: "file_upload",
        url: DEFAULT_SERVICENOW_ICON,
        name: "sn-product-documentation-icon.png",
        size: 1973,
        mimeType: "image/png",
      };
      debug(`🎭 Using default ServiceNow product documentation icon`);
      console.log("🎭 [W2N-SN2N] Default icon object:", defaultIcon);
      return defaultIcon;

  } catch (error) {
  debug(`⚠️ Error extracting icon: ${error.message}`);
  return null;
  }
  }

/\*\*

- Extract page cover from meta tags and images
  \*/
  function extractPageCover() {
  try {
  // First check for user-selected cover preferences
  const savedPrefs = GM_getValue("w2n_icon_cover_prefs", null);
  if (savedPrefs && savedPrefs.cover) {
  debug(`🖼️ Using user-selected cover: ${savedPrefs.cover.url}`);
  return savedPrefs.cover;
  }

      // Use default ServiceNow Yokohama banner cover
      const defaultCover = {
        type: "external",
        url: DEFAULT_SERVICENOW_COVER_URL,
      };
      debug(`🖼️ Using default ServiceNow Yokohama banner cover`);
      console.log("🖼️ [W2N-SN2N] Default cover object:", defaultCover);
      return defaultCover;

  } catch (error) {
  debug(`⚠️ Error extracting cover: ${error.message}`);
  // Fallback to simple ServiceNow color
  return {
  type: "external",
  url:
  "data:image/svg+xml;base64," +
  btoa(`        <svg width="1200" height="600" xmlns="http://www.w3.org/2000/svg">
          <rect width="100%" height="100%" fill="#62d84e"/>
          <text x="50%" y="50%" text-anchor="middle" dy="0.35em" 
                font-family="Arial, sans-serif" font-size="72" font-weight="bold" 
                fill="white">ServiceNow</text>
        </svg>
     `),
  };
  }
  }

/\*\*

- Extract author information from various sources
  \*/
  function extractAuthorInfo() {
  const authorSelectors = [
  'meta[name="author"]',
  'meta[property="article:author"]',
  'meta[property="book:author"]',
  ".author",
  ".book-author",
  ".by-author",
  ".author-name",
  "[data-author]",
  ".metadata .author",
  ".book-info .author",
  ];


    // Try DOM selectors first
    for (const selector of authorSelectors) {
      const element = document.querySelector(selector);
      if (element) {
        let author = "";

        if (selector.startsWith("meta")) {
          author = element.content || element.getAttribute("content") || "";
        } else if (element.hasAttribute("data-author")) {
          author = element.getAttribute("data-author") || "";
        } else {
          author = element.textContent || element.innerText || "";
        }

        // Clean up author text
        author = author
          .trim()
          .replace(/^(by|author:?|written by)\s+/i, "")
          .replace(/\s+/g, " ");

        if (author?.length > 0 && isValidAuthor(author)) {
          debug(`📝 Extracted author: "${author}" from selector: ${selector}`);
          return author;
        }
      }
    }

    // Try text content patterns as fallback
    return extractAuthorFromText();

}

/\*\*

- Extract author from page text content using patterns
  \*/
  function extractAuthorFromText() {
  try {
  let searchArea =
  document.querySelector(
  ".epub-container, .book-content, .content-area"
  ) || document.body;

      const bodyText = searchArea.textContent || searchArea.innerText || "";

      const authorPatterns = [
        /(?:by|author:?|written by)\s+([A-Z][a-zA-Z\s.,-]{5,50})(?:\s|$|\.|,)/i,
        /author:\s*([A-Z][a-zA-Z\s.,-]{5,50})(?:\s|$|\.|,)/i,
        /written by\s+([A-Z][a-zA-Z\s.,-]{5,50})(?:\s|$|\.|,)/i,
      ];

      for (const pattern of authorPatterns) {
        const authorMatch = bodyText.match(pattern);
        if (authorMatch?.[1]) {
          const candidateAuthor = authorMatch[1].trim();

          if (isValidAuthor(candidateAuthor)) {
            debug(
              `📝 Extracted author from text pattern: "${candidateAuthor}"`
            );
            return candidateAuthor;
          }
        }
      }

  } catch (e) {
  debug(`⚠️ Author text extraction failed: ${e.message}`);
  }


    return null;

}

/\*\*

- Validate that extracted author text is legitimate (not UI text)
  \*/
  function isValidAuthor(author) {
  if (!author || author.length < 5 || author.length > 50) {
  return false;
  }


    // Filter out common UI text and invalid authors
    const invalidAuthorPhrases = [
      /^(id|clear|cache|button|click|here|more|info|login|logout|home|menu|nav)/i,
      /^(back|next|previous|continue|submit|save|delete|edit|update)/i,
      /^(search|filter|sort|view|show|hide|toggle|expand|collapse)/i,
      /^(close|open|cancel|confirm|ok|yes|no|settings|options)/i,
      /^(loading|error|success|warning|message|alert|notification)/i,
    ];

    return !invalidAuthorPhrases.some((phrase) => phrase.test(author));

}

/\*\*

- Validate and clean image array, removing invalid URLs
  \*/
  function validateAndCleanImages(images) {
  debug(
  `🔧 validateAndCleanImages called with ${images?.length || 0} images`
  );


    if (!Array.isArray(images)) {
      debug(`⚠️ Images parameter is not an array: ${typeof images}`);
      return [];
    }

    debug(
      `🔧 Processing images: ${images
        .map(
          (img) =>
            `${img?.url || "no-url"} (base: ${img?.baseUrl || "no-base"})`
        )
        .join(", ")}`
    );

    const validImages = images.filter((img) => {
      if (!img?.url) return false;

      // Allow data URIs
      if (img.url.startsWith("data:")) return true;

      // Normalize relative URLs to absolute URLs
      let normalizedUrl = img.url;
      if (!img.url.startsWith("http://") && !img.url.startsWith("https://")) {
        try {
          // Use the image's baseUrl if available, otherwise fall back to current page
          const baseUrl = img.baseUrl || window.location.href;
          const originalUrl = img.url; // Store original before modification
          normalizedUrl = new URL(img.url, baseUrl).href;
          img.url = normalizedUrl; // Update the image URL in place
          debug(`🔧 Normalized relative URL using base ${baseUrl}:`);
          debug(`    Original: ${originalUrl}`);
          debug(`    Resolved: ${normalizedUrl}`);
        } catch (e) {
          debug(`⚠️ Failed to normalize URL: ${img.url} - ${e.message}`);
          return false;
        }
      }

      // Validate the (now normalized) HTTP(S) URLs
      if (
        normalizedUrl.startsWith("http://") ||
        normalizedUrl.startsWith("https://")
      ) {
        try {
          new URL(normalizedUrl);
          return true;
        } catch (e) {
          debug(`⚠️ Removing invalid image URL: ${normalizedUrl}`);
          return false;
        }
      }

      debug(`⚠️ Removing unsupported image URL: ${normalizedUrl}`);
      return false;
    });

    if (validImages.length !== images.length) {
      debug(`🔧 Filtered images: ${images.length} → ${validImages.length}`);
    }

    return validImages;

}

/\*\*

- Clean ServiceNow-specific UI elements from HTML content
  \*/
  function cleanServiceNowUIElements(htmlContent) {
  if (!htmlContent) return htmlContent;


    debug("🧹 Cleaning ServiceNow-specific UI elements");

    // Create a document fragment for DOM manipulation
    const parser = new DOMParser();
    const doc = parser.parseFromString(htmlContent, "text/html");

    // Remove "Larger View" buttons with pattern imgbutton# (ServiceNow-specific)
    const imgButtons = doc.querySelectorAll('button[id^="imgbutton"]');
    debug(`🔍 Found ${imgButtons.length} imgbutton elements to check`);

    imgButtons.forEach((button) => {
      const buttonText = button.textContent?.trim() || "";
      const buttonId = button.id || "";

      debug(`🔍 Checking ServiceNow button ${buttonId}: "${buttonText}"`);

      // Check if this is a "Larger View" type button
      const largerViewPatterns = [
        /larger\s*view/gi,
        /view\s*larger/gi,
        /larger\s*image/gi,
        /view\s*full\s*size/gi,
        /click\s*to\s*enlarge/gi,
      ];

      const isLargerViewButton = largerViewPatterns.some((pattern) =>
        pattern.test(buttonText)
      );

      if (
        isLargerViewButton ||
        buttonText.toLowerCase().includes("larger") ||
        buttonText.toLowerCase().includes("enlarge")
      ) {
        debug(
          `🗑️ Removing ServiceNow "Larger View" button: ${buttonId} with text "${buttonText}"`
        );
        button.remove();
      }
    });

    // Remove other ServiceNow-specific UI elements that shouldn't be in content
    const elementsToRemove = [
      "#zDocsContent > header", // Header info captured as database properties instead
      "#zDocsContent > div.bottomFeedback > div", // "Was this topic helpful? Yes No" feedback section
      ".bottomFeedback", // Alternative feedback section selector
      '[class*="feedback"]', // Any element with "feedback" in class name
      'button[class*="zoom"]',
      'button[class*="enlarge"]',
      'button[class*="larger"]',
      ".image-controls",
      ".zoom-controls",
      ".zDocsTopicPageTableExportButton", // Table export button
      ".zDocsTopicPageTableExportMenu", // Table export dropdown menu
      ".zDocsDropdownMenu", // General dropdown menus
      'button[aria-label*="Export"]', // Any export buttons
      'button[data-toggle="dropdown"][aria-label*="Export"]', // Export dropdown triggers
    ];

    elementsToRemove.forEach((selector) => {
      const elements = doc.querySelectorAll(selector);
      elements.forEach((el) => {
        debug(`🗑️ Removing ServiceNow UI element: ${selector}`);
        el.remove();
      });
    });

    // Additional cleanup for table export button structures
    const tableExportContainers = doc.querySelectorAll("div");
    tableExportContainers.forEach((div) => {
      // Check if this div contains the table export button structure
      const hasExportButton = div.querySelector(
        'button[data-toggle="dropdown"][aria-label*="Export"]'
      );
      const hasExportMenu = div.querySelector(".zDocsTopicPageTableExportMenu");

      if (hasExportButton || hasExportMenu) {
        debug(`🗑️ Removing table export container div`);
        div.remove();
      }
    });

    // Remove "Larger View" text patterns from general elements
    const allElements = Array.from(doc.querySelectorAll("*"));
    for (const el of allElements) {
      if (el.nodeType === Node.ELEMENT_NODE && el.textContent) {
        const text = el.textContent.trim();
        const originalText = text;

        // Check for "Larger View" patterns
        const largerViewPatterns = [
          /larger\s*view/gi,
          /view\s*larger/gi,
          /larger\s*image/gi,
          /view\s*full\s*size/gi,
          /click\s*to\s*enlarge/gi,
        ];

        let hasLargerViewText = largerViewPatterns.some((pattern) =>
          pattern.test(text)
        );

        if (hasLargerViewText) {
          // Check if there's an image nearby (this is ServiceNow content, so be more aggressive)
          let foundImage = false;

          // Check current element and nearby elements for images
          if (
            el.tagName === "IMG" ||
            el.querySelector("img") ||
            (el.parentElement && el.parentElement.querySelector("img")) ||
            (el.nextElementSibling &&
              (el.nextElementSibling.tagName === "IMG" ||
                el.nextElementSibling.querySelector("img")))
          ) {
            foundImage = true;
          }

          if (foundImage) {
            // Clean the text
            let cleanedText = text;
            largerViewPatterns.forEach((pattern) => {
              cleanedText = cleanedText.replace(pattern, "");
            });

            // Clean up extra whitespace and punctuation
            cleanedText = cleanedText
              .replace(/^\s*[•\-\|,;:]\s*/, "")
              .replace(/\s*[•\-\|,;:]\s*$/, "")
              .trim();

            if (cleanedText.length === 0 || cleanedText.length < 3) {
              debug(
                `🗑️ Removing entire element with "Larger View" text: "${originalText}"`
              );
              el.remove();
            } else {
              debug(
                `🧹 Cleaning "Larger View" text: "${originalText}" -> "${cleanedText}"`
              );
              if (el.children.length === 0) {
                el.textContent = cleanedText;
              }
            }
          }
        }
      }
    }

    // Clean up "[Invalid Image: ...]" text patterns that come from failed iframe image loads
    const invalidImagePattern = /\[Invalid Image:\s*([^\]]+)\]/gi;
    const allTextNodes = [];

    // Get all text nodes in the document
    function getTextNodes(node) {
      if (node.nodeType === Node.TEXT_NODE) {
        allTextNodes.push(node);
      } else {
        for (let child of node.childNodes) {
          getTextNodes(child);
        }
      }
    }

    getTextNodes(doc.body);

    // Process text nodes to remove invalid image text
    allTextNodes.forEach((textNode) => {
      const originalText = textNode.textContent;
      if (invalidImagePattern.test(originalText)) {
        const cleanedText = originalText.replace(
          invalidImagePattern,
          (match, imagePath) => {
            debug(`🧹 Removing invalid image text: "${match}"`);
            // Convert to a simple text reference instead of removing completely
            const filename = imagePath.split("/").pop();
            return `_[Image: ${filename}]_`;
          }
        );
        textNode.textContent = cleanedText;
      }
    });

    return doc.body.innerHTML;

}

/\*\*

- Clean invalid image references from HTML content
  \*/
  function cleanInvalidImageReferences(htmlContent) {
  if (!htmlContent) return htmlContent;


    // First clean ServiceNow-specific UI elements
    htmlContent = cleanServiceNowUIElements(htmlContent);

    // CRITICAL: Clean up "[Invalid Image: ...]" text patterns in HTML content
    const invalidImagePattern = /\[Invalid Image:\s*([^\]]+)\]/gi;
    if (invalidImagePattern.test(htmlContent)) {
      debug(
        `🚨 Found [Invalid Image: ...] patterns in HTML content - cleaning...`
      );
      htmlContent = htmlContent.replace(
        invalidImagePattern,
        (match, imagePath) => {
          debug(`🧹 Removing invalid image text from HTML: "${match}"`);
          const filename = imagePath.split("/").pop();
          return `<em>[Image: ${filename}]</em>`;
        }
      );
    }

    // Then clean invalid image markdown patterns
    // Since we're using imageProcessingMode: "notion-sdk", preserve relative URLs for proxy processing
    return htmlContent.replace(
      /!\[([^\]]*)\]\(([^)]+)\)/g,
      (match, alt, url) => {
        // Keep valid data URIs
        if (url.startsWith("data:")) return match;

        // Keep valid HTTP(S) URLs
        if (url.startsWith("http://") || url.startsWith("https://")) {
          try {
            new URL(url);
            return match;
          } catch (e) {
            debug(`⚠️ Removing invalid absolute image reference: ${url}`);
            return `_[Image: ${alt || "image"}]_`;
          }
        }

        // Keep relative URLs that could be ServiceNow images (let proxy handle them)
        if (url.includes("../") || url.includes("images/")) {
          debug(`✅ Preserving relative image URL for SDK processing: ${url}`);
          return match; // Keep the markdown intact for proxy processing
        }

        // Remove other invalid schemes or malformed URLs
        debug(`⚠️ Removing unsupported image reference: ${url}`);
        return `_[Image: ${alt || "image"}]_`;
      }
    );

}

/\*\*

- Convert elements with "Italic" class to proper italic formatting
  \*/
  function convertItalicClassToItalicText(htmlContent) {
  if (!htmlContent) return htmlContent;


    debug("✏️ Converting 'Italic' class elements to italic text");

    // Create a document fragment for DOM manipulation
    const parser = new DOMParser();
    const doc = parser.parseFromString(htmlContent, "text/html");

    // Find all elements with class containing "Italic" (case-insensitive)
    const italicElements = doc.querySelectorAll(
      '[class*="italic" i], [class*="Italic"]'
    );

    debug(`🔍 Found ${italicElements.length} elements with Italic class`);

    italicElements.forEach((element, index) => {
      const className = element.className || "";
      debug(
        `📝 Processing italic element ${index + 1}: ${
          element.tagName
        } with class "${className}"`
      );

      // Create new <em> element with the same content
      const emElement = doc.createElement("em");

      // Copy all child nodes (text and elements) to the new em element
      while (element.firstChild) {
        emElement.appendChild(element.firstChild);
      }

      // Copy any other non-class attributes (except class)
      for (let i = 0; i < element.attributes.length; i++) {
        const attr = element.attributes[i];
        if (attr.name !== "class") {
          emElement.setAttribute(attr.name, attr.value);
        }
      }

      // If there were other classes besides italic, preserve them on the em element
      const otherClasses = className
        .split(/\s+/)
        .filter((cls) => !cls.match(/italic/i))
        .join(" ");

      if (otherClasses) {
        emElement.className = otherClasses;
      }

      // Replace the original element with the em element
      element.parentNode.replaceChild(emElement, element);

      debug(`✅ Converted ${element.tagName}.${className} to <em>`);
    });

    // Return the processed HTML
    const processedHtml = doc.body.innerHTML;
    debug(`✏️ Italic class conversion completed`);

    return processedHtml;

}

/\*\*

- Convert elements with "Bold" class, ServiceNow title/section classes, and existing <strong> tags to proper bold formatting
- Specifically handles: class="sectiontitle tasklabel", caption class="title", caption > span.title, class="ph uicontrol", and span class="title"
  \*/
  function convertBoldClassToBoldText(htmlContent) {
  if (!htmlContent) return htmlContent;


    debug(
      "🔠 Converting 'Bold' class elements, ServiceNow title/UI control classes, and <strong> tags to proper bold text"
    );

    // Create a document fragment for DOM manipulation
    const parser = new DOMParser();
    const doc = parser.parseFromString(htmlContent, "text/html");

    // Find all elements with class containing "Bold" (case-insensitive) plus specific ServiceNow classes that should be bold
    const boldElements = doc.querySelectorAll(
      '[class*="bold" i], [class*="Bold"], .sectiontitle.tasklabel, caption.title, caption > span.title, caption span.title, .ph.uicontrol, span.title'
    );

    debug(
      `🔍 Found ${boldElements.length} elements with Bold class or ServiceNow title/UI control classes`
    );

    boldElements.forEach((element, index) => {
      const className = element.className || "";
      debug(
        `📝 Processing bold element ${index + 1}: ${
          element.tagName
        } with class "${className}"`
      );

      // Skip span.title elements that are inside table captions - preserve them for caption detection
      if (element.tagName === "SPAN" && element.classList.contains("title")) {
        const captionParent = element.closest("caption");
        if (captionParent) {
          return;
        }
      }

      // Create new <strong> element with the same content
      const strongElement = doc.createElement("strong");

      // Copy all child nodes (text and elements) to the new strong element
      while (element.firstChild) {
        strongElement.appendChild(element.firstChild);
      }

      // Copy any other non-class attributes (except class)
      for (let i = 0; i < element.attributes.length; i++) {
        const attr = element.attributes[i];
        if (attr.name !== "class") {
          strongElement.setAttribute(attr.name, attr.value);
        }
      }

      // Handle class preservation - filter out bold classes but preserve ServiceNow title classes
      const otherClasses = className
        .split(/\s+/)
        .filter((cls) => {
          // Remove bold classes but keep important ServiceNow classes
          if (cls.match(/bold/i)) return false;
          // Keep important ServiceNow title/section/UI control classes for styling preservation
          if (
            cls === "sectiontitle" ||
            cls === "tasklabel" ||
            cls === "title" ||
            cls === "ph" ||
            cls === "uicontrol"
          )
            return true;
          return true; // Keep other classes
        })
        .join(" ");

      if (otherClasses) {
        strongElement.className = otherClasses;
      }

      // Replace the original element with the strong element
      element.parentNode.replaceChild(strongElement, element);

      debug(`✅ Converted ${element.tagName}.${className} to <strong>`);
    });

    // Also ensure existing <strong> tags are preserved and properly formatted
    const existingStrong = doc.querySelectorAll("strong");
    debug(
      `🔍 Found ${existingStrong.length} existing <strong> elements (preserving)`
    );

    // Return the processed HTML
    const processedHtml = doc.body.innerHTML;
    debug(`🔠 Bold class conversion completed`);

    return processedHtml;

}

/\*\*

- Filter out trademark symbols (®, ™, ©) from HTML content
  \*/
  function filterTrademarkSymbols(htmlContent) {
  if (!htmlContent) return htmlContent;


    debug("🔤 Filtering out trademark symbols (®, ™, ©)");

    let filteredContent = htmlContent;
    let removedCount = 0;

    // Remove trademark symbols but preserve the text they were attached to
    const trademarkPattern = /[®™©]/g;

    filteredContent = filteredContent.replace(trademarkPattern, (match) => {
      removedCount++;
      debug(`✂️ Removing trademark symbol: ${match}`);
      return "";
    });

    debug(`🔤 Removed ${removedCount} trademark symbols`);

    return filteredContent;

}

// ====================================
// 🎥 VIDEO DETECTION FUNCTIONALITY (v6.16.0)
// ====================================

/\*\*

- Detects videos in content for inclusion in Notion pages
- @param {Element} contentElement - The element to scan for videos
- @returns {Array} - Array of video objects with metadata
  \*/
  function detectVideosInContent(contentElement) {
  const videos = [];


    // Debug: Check for any video-related elements
    const allVideoElements = contentElement.querySelectorAll(
      'video, video-js, [class*="video"], [data-account], iframe[src*="video"]'
    );

    try {
      // 1. Detect Vimeo embedded players
      const vimeoPlayers = contentElement.querySelectorAll(
        'div[id="player"].player, .vp-video-wrapper, iframe[src*="vimeo"]'
      );

      vimeoPlayers.forEach((player, index) => {
        try {
          let videoData = { type: "embed", platform: "vimeo" };

          // Try to find the parent player container if we're in a sub-element
          let playerContainer =
            player.closest('div[id="player"].player') || player;

          // Extract title from the title link
          const titleLink = playerContainer.querySelector(
            '.Title_module_titleLink__2159b884, a[href*="vimeo.com"]'
          );
          if (titleLink) {
            videoData.url = titleLink.href;
            videoData.title =
              titleLink
                .querySelector(".Title_module_titleText__2159b884, #title-text")
                ?.textContent?.trim() || "Untitled Video";
          }

          // Extract thumbnail from preview element
          const previewElement = playerContainer.querySelector(
            ".vp-preview, [data-thumb]"
          );
          if (previewElement) {
            const thumbUrl =
              previewElement.getAttribute("data-thumb") ||
              previewElement.style.backgroundImage?.match(
                /url\("?([^"]*)"?\)/
              )?.[1];
            if (thumbUrl) {
              videoData.thumbnail = thumbUrl;
            }
          }

          // Extract duration from progress bar or timecode
          const durationElement = playerContainer.querySelector(
            "[data-progress-bar-timecode], .ThumbnailPreview_module_time__0cb46f3c"
          );
          if (durationElement) {
            videoData.duration = durationElement.textContent?.trim();
          }

          // Extract chapters if available
          const chapterElements = playerContainer.querySelectorAll(
            ".ChaptersPanelMenuOption_module_chapterTitleText__22a198a7"
          );
          if (chapterElements.length > 0) {
            videoData.chapters = Array.from(chapterElements)
              .map((el) => el.textContent?.trim())
              .filter(Boolean);
          }

          // Only add if we have at least a URL
          if (videoData.url) {
            videos.push(videoData);
          }
        } catch (error) {
          debug(`❌ Error processing Vimeo player ${index + 1}:`, error);
        }
      });

      // 2. Detect Brightcove video players
      const brightcoveElements = contentElement.querySelectorAll(
        'video-js, video-js[data-account], .video-js, .video-js[data-account], video.video-js, [class*="video-js"]'
      );

      brightcoveElements.forEach((player, index) => {
        try {
          let videoData = { type: "embed", platform: "brightcove" };

          // Extract account and player info
          const account = player.getAttribute("data-account");
          const playerId = player.getAttribute("data-player");
          const videoId = player.getAttribute("data-video-id");

          // Try to get the video title from various sources
          const titleElement =
            player.querySelector(".vjs-title-bar-title") ||
            player.querySelector("[aria-label*='Video']") ||
            player.closest("div").querySelector("h1, h2, h3, h4, h5, h6");

          videoData.title =
            titleElement?.textContent?.trim() ||
            player.getAttribute("aria-label") ||
            player.getAttribute("title") ||
            `Brightcove Video ${index + 1}`;

          // Extract poster/thumbnail
          const poster =
            player.getAttribute("poster") ||
            player.querySelector(".vjs-poster img")?.src;
          if (poster) {
            videoData.thumbnail = poster;
          }

          // Extract duration from duration display
          const durationElement = player.querySelector(
            ".vjs-duration-display, .vjs-remaining-time-display"
          );
          if (durationElement) {
            videoData.duration = durationElement.textContent?.trim();
          }

          // Extract source URL if available (might be blob or stream URL)
          const videoElement = player.querySelector("video");
          if (
            videoElement &&
            videoElement.src &&
            !videoElement.src.startsWith("blob:")
          ) {
            videoData.src = videoElement.src;
          }

          // Build a Brightcove share URL if we have the necessary data
          if (account && playerId && videoId) {
            videoData.url = `https://players.brightcove.net/${account}/${playerId}_default/index.html?videoId=${videoId}`;
          }

          // If we can't embed, provide text with available info
          if (!videoData.url && !videoData.src) {
            const videoInfo = [];
            if (account) videoInfo.push(`Account: ${account}`);
            if (playerId) videoInfo.push(`Player: ${playerId}`);
            if (videoId) videoInfo.push(`Video ID: ${videoId}`);

            videoData.fallbackText = `**Brightcove Video: ${
              videoData.title
            }**\n\n${
              videoInfo.length > 0
                ? videoInfo.join(" | ")
                : "Video player detected but no source URL available"
            }`;
          }

          videos.push(videoData);
        } catch (error) {
          debug(`❌ Error processing Brightcove player ${index + 1}:`, error);
        }
      });

      // 2b. Detect Brightcove iframe embeds (common in ServiceNow docs)
      const brightcoveIframes = contentElement.querySelectorAll(
        'iframe[src*="players.brightcove.net"]'
      );

      brightcoveIframes.forEach((iframe, index) => {
        try {
          debug(`🎥 Processing Brightcove iframe ${index + 1}:`, iframe);
          debug(`🎥 Iframe src: ${iframe.src}`);

          let videoData = { type: "embed", platform: "brightcove" };

          // Extract info from iframe src URL
          const srcUrl = iframe.src;
          const urlParts = srcUrl.match(
            /players\.brightcove\.net\/(\d+)\/([^\/]+).*videoId=([^&]+)/
          );

          if (urlParts) {
            const [, account, playerId, videoId] = urlParts;
            debug(
              `🎥 Extracted from iframe - Account: ${account}, Player: ${playerId}, Video: ${videoId}`
            );

            videoData.url = srcUrl;
            videoData.account = account;
            videoData.playerId = playerId;
            videoData.videoId = videoId;
          } else {
            // Fallback - just use the iframe src as the URL
            videoData.url = srcUrl;
          }

          // Try to get title from iframe attributes or surrounding content
          videoData.title =
            iframe.getAttribute("title") ||
            iframe.getAttribute("aria-label") ||
            iframe
              .closest("div")
              .querySelector("h1, h2, h3, h4, h5, h6")
              ?.textContent?.trim() ||
            `Brightcove Video ${index + 1}`;

          videos.push(videoData);
        } catch (error) {
          debug(`❌ Error processing Brightcove iframe ${index + 1}:`, error);
        }
      });

      // 3. Detect direct video elements
      const videoElements = contentElement.querySelectorAll("video");
      videoElements.forEach((video, index) => {
        try {
          const videoData = {
            type: "video",
            platform: "direct",
            src: video.src || video.querySelector("source")?.src,
            poster: video.poster,
            title:
              video.getAttribute("title") ||
              video.getAttribute("alt") ||
              `Video ${index + 1}`,
            duration: video.duration ? Math.floor(video.duration) + "s" : null,
          };

          if (videoData.src) {
            videos.push(videoData);
          }
        } catch (error) {
          debug(`❌ Error processing direct video ${index + 1}:`, error);
        }
      });

      // 3. Detect YouTube embeds
      const youtubeIframes = contentElement.querySelectorAll(
        'iframe[src*="youtube.com"], iframe[src*="youtu.be"]'
      );
      youtubeIframes.forEach((iframe, index) => {
        try {
          const videoData = {
            type: "embed",
            platform: "youtube",
            url: iframe.src,
            title: iframe.getAttribute("title") || `YouTube Video ${index + 1}`,
          };

          videos.push(videoData);
        } catch (error) {
          debug(`❌ Error processing YouTube iframe ${index + 1}:`, error);
        }
      });

      // 5. Detect video links
      const videoLinks = contentElement.querySelectorAll(
        'a[href*=".mp4"], a[href*=".webm"], a[href*=".mov"], a[href*="youtube.com"], a[href*="youtu.be"], a[href*="vimeo.com"]'
      );
      videoLinks.forEach((link, index) => {
        try {
          // Skip if we already found this as an embedded player
          if (videos.some((v) => v.url === link.href)) return;

          const videoData = {
            type: "bookmark",
            platform: link.href.includes("youtube")
              ? "youtube"
              : link.href.includes("vimeo")
              ? "vimeo"
              : "direct",
            url: link.href,
            title:
              link.textContent?.trim() ||
              link.getAttribute("title") ||
              `Video Link ${index + 1}`,
          };

          videos.push(videoData);
        } catch (error) {
          debug(`❌ Error processing video link ${index + 1}:`, error);
        }
      });
    } catch (error) {
      debug("❌ Error during video detection:", error);
    }

    return videos;

}

/\*\*

- Apply blue background styling to table header rows for better visual distinction
  \*/
  function styleTableHeaders(htmlContent) {
  if (!htmlContent) return htmlContent;


    debug("📊 Applying blue background styling to table headers");

    // Create a document fragment for DOM manipulation
    const parser = new DOMParser();
    const doc = parser.parseFromString(htmlContent, "text/html");

    // Find all tables in the content
    const tables = doc.querySelectorAll(
      "table, .table, .data-table, .record-table"
    );

    debug(`🔍 Found ${tables.length} table(s) to style headers`);

    tables.forEach((table, tableIndex) => {
      // Recover caption-like spans that appear immediately before the table
      // Convert <span class="title">Caption...</span> into
      // <h3 class="table-caption-title">Caption...</h3> inserted before the table
      try {
        const prev = table.previousElementSibling;
        if (prev && prev.tagName && prev.tagName.toLowerCase() === "span") {
          const cls = prev.getAttribute("class") || "";
          if (cls.split(/\s+/).includes("title")) {
            debug(
              `🔁 Recovering caption span before table ${
                tableIndex + 1
              }: ${prev.textContent.trim()}`
            );
            const h3 = doc.createElement("h3");
            h3.className = "table-caption-title";
            h3.textContent = prev.textContent;
            table.parentNode.insertBefore(h3, table);
            // Remove the old span
            prev.remove();
          }
        }
      } catch (e) {
        debug("⚠️ Caption recovery failed:", e);
      }

      // Check if this table contains SVG elements (which we skip header treatment for)
      const containsSvgs =
        table.querySelectorAll(
          "svg.image.svg.decorative, svg.image, svg.decorative, svg[class*='image'], svg[class*='decorative']"
        ).length > 0;

      if (containsSvgs) {
        debug(
          `📊 Table ${tableIndex + 1}: Skipping header styling (contains SVGs)`
        );
        return; // Skip header styling for tables with SVG elements
      }

      // Find header elements (th tags or first row of td tags if no th elements exist)
      let headerElements = table.querySelectorAll(
        "thead tr th, tr:first-child th"
      );

      // If no th elements found, treat first row as headers
      if (headerElements.length === 0) {
        const firstRow = table.querySelector("tr:first-child");
        if (firstRow) {
          headerElements = firstRow.querySelectorAll("td");
          debug(
            `📊 Table ${
              tableIndex + 1
            }: Using first row td elements as headers (${
              headerElements.length
            } cells)`
          );
        }
      } else {
        debug(
          `📊 Table ${tableIndex + 1}: Found ${
            headerElements.length
          } th header elements`
        );
      }

      // Apply blue background styling to header elements
      headerElements.forEach((header, headerIndex) => {
        const currentStyle = header.getAttribute("style") || "";
        const blueBackground =
          "background-color: #4a90e2; color: white; font-weight: bold; padding: 8px;";

        // Combine existing style with blue background (blue background takes precedence)
        header.setAttribute("style", `${blueBackground} ${currentStyle}`);

        debug(
          `📊 Table ${tableIndex + 1}, Header ${
            headerIndex + 1
          }: Applied blue background styling`
        );
      });

      if (headerElements.length > 0) {
        debug(
          `✅ Table ${tableIndex + 1}: Styled ${
            headerElements.length
          } header cells with blue background`
        );
      }
    });

    // Return the processed HTML
    const processedHtml = doc.body.innerHTML;
    debug("📊 Table header styling completed");

    return processedHtml;

}

/\*\*

- Append detected videos to the content HTML
- Since videos often can't be embedded directly, provide fallback information
  \*/
  function appendVideosToContent(htmlContent, videos) {
  if (
  !htmlContent ||
  !videos ||
  !Array.isArray(videos) ||
  videos.length === 0
  ) {
  return htmlContent;
  }


    // Parse the HTML content
    const parser = new DOMParser();
    const doc = parser.parseFromString(htmlContent, "text/html");

    // Find all Brightcove iframes and replace them with video information
    const brightcoveIframes = doc.querySelectorAll(
      'iframe[src*="players.brightcove.net"]'
    );

    brightcoveIframes.forEach((iframe, index) => {
      try {
        // Find the corresponding video data for this iframe
        const iframeSrc = iframe.src;
        const matchingVideo = videos.find(
          (video) =>
            video.platform === "brightcove" &&
            (video.url === iframeSrc ||
              (video.url && iframeSrc.includes(video.videoId)))
        );

        if (matchingVideo) {
          // Create replacement div with video information
          const videoDiv = doc.createElement("div");
          videoDiv.className = "video-replacement";

          let videoHTML = `<div class="video-item" style="border: 1px solid #ddd; padding: 15px; margin: 10px 0; border-radius: 5px; background-color: #f9f9f9;">

  <h4>🎥 ${matchingVideo.title || "Video"}</h4>`;

          if (matchingVideo.url) {
            videoHTML += `

  <p><strong>📺 Watch Video:</strong> <a href="${matchingVideo.url}" target="_blank">${matchingVideo.url}</a></p>`;
          }

          if (matchingVideo.platform) {
            videoHTML += `

  <p><strong>🎬 Platform:</strong> ${matchingVideo.platform}</p>`;
          }

          if (matchingVideo.duration) {
            videoHTML += `

  <p><strong>⏱️ Duration:</strong> ${matchingVideo.duration}</p>`;
          }

          if (matchingVideo.thumbnail) {
            videoHTML += `

  <p><strong>🖼️ Preview:</strong><br><img src="${matchingVideo.thumbnail}" alt="Video thumbnail" style="max-width: 300px; height: auto; border-radius: 3px;"></p>`;
          }

          if (matchingVideo.chapters && matchingVideo.chapters.length > 0) {
            videoHTML += `

  <p><strong>📋 Chapters:</strong> ${matchingVideo.chapters.join(", ")}</p>`;
          }

          if (matchingVideo.fallbackText) {
            videoHTML += `

  <div class="video-fallback" style="background-color: #fff3cd; padding: 10px; border-radius: 3px; margin: 10px 0;">
    ${matchingVideo.fallbackText}
  </div>`;
          }

          videoHTML += `

</div>`;

          videoDiv.innerHTML = videoHTML;

          // Replace the iframe with the video information
          iframe.parentNode.replaceChild(videoDiv, iframe);
        } else {
        }
      } catch (error) {
        debug(`❌ Error replacing iframe ${index + 1}:`, error);
      }
    });

    // Also handle other video elements (Vimeo, YouTube, direct videos)
    videos.forEach((video, index) => {
      if (video.platform !== "brightcove") {
        // For non-Brightcove videos, find and replace them too
        let selector = "";
        if (video.platform === "vimeo") {
          selector = 'iframe[src*="vimeo"], .vp-video-wrapper';
        } else if (video.platform === "youtube") {
          selector = 'iframe[src*="youtube"]';
        } else if (video.platform === "direct") {
          selector = "video";
        }

        if (selector) {
          const elements = doc.querySelectorAll(selector);
          elements.forEach((element, elemIndex) => {
            // Simple replacement for non-Brightcove videos
            if (video.url && element.src === video.url) {
              const videoDiv = doc.createElement("div");
              videoDiv.className = "video-replacement";
              videoDiv.innerHTML = `<div class="video-item" style="border: 1px solid #ddd; padding: 15px; margin: 10px 0; border-radius: 5px; background-color: #f9f9f9;">

  <h4>🎥 ${video.title || "Video"}</h4>
  <p><strong>📺 Watch Video:</strong> <a href="${video.url}" target="_blank">${
                video.url
              }</a></p>
  <p><strong>🎬 Platform:</strong> ${video.platform}</p>
</div>`;
              element.parentNode.replaceChild(videoDiv, element);
            }
          });
        }
      }
    });

    // Return the modified HTML
    const updatedContent = doc.body.innerHTML;
    return updatedContent;

}

/\*\*

- Replace images in tables with emojis to separate text lines and improve readability
  \*/
  function replaceTableImagesWithEmojis(htmlContent) {
  if (!htmlContent) return htmlContent;


    debug(
      "📊 Replacing images in tables with emojis for better text separation"
    );

    // Create a document fragment for DOM manipulation
    const parser = new DOMParser();
    const doc = parser.parseFromString(htmlContent, "text/html");

    // Find all tables in the content
    const tables = doc.querySelectorAll(
      "table, .table, .data-table, .record-table"
    );
    let totalReplacements = 0;

    debug(`🔍 Found ${tables.length} table(s) to process`);

    tables.forEach((table, tableIndex) => {
      // Find all images AND SVGs within this table
      const images = table.querySelectorAll("img");
      const svgs = table.querySelectorAll(
        "svg.image.svg.decorative, svg.image, svg.decorative, svg[class*='image'], svg[class*='decorative']"
      );

      const totalElements = images.length + svgs.length;
      debug(
        `📊 Table ${tableIndex + 1}: Found ${images.length} image(s) and ${
          svgs.length
        } SVG(s) (${totalElements} total)`
      );

      // Process regular images
      images.forEach((img, imgIndex) => {
        const result = processImageElement(
          img,
          tableIndex,
          imgIndex,
          "img",
          doc
        );
        if (result.replaced) totalReplacements++;
      });

      // Process SVG elements
      svgs.forEach((svg, svgIndex) => {
        const result = processImageElement(
          svg,
          tableIndex,
          svgIndex + images.length,
          "svg",
          doc
        );
        if (result.replaced) totalReplacements++;
      });
    });

    debug(`📊 Total images replaced with emojis: ${totalReplacements}`);

    // Return the processed HTML
    const processedHtml = doc.body.innerHTML;
    return processedHtml;

}

/\*\*

- Process individual image or SVG element for emoji replacement
  \*/
  function processImageElement(
  element,
  tableIndex,
  elementIndex,
  elementType,
  doc
  ) {
  // Get element context to choose appropriate emoji
  const elementAlt = element.alt || element.getAttribute("alt") || "";
  const elementSrc = element.src || element.getAttribute("src") || "";
  const elementTitle = element.title || element.getAttribute("title") || "";
  const elementClass = element.className || "";


    // For SVGs, also check for text content and data attributes
    const elementText = elementType === "svg" ? element.textContent || "" : "";
    const elementData = Array.from(element.attributes)
      .filter((attr) => attr.name.startsWith("data-"))
      .map((attr) => attr.value)
      .join(" ");

    // Determine appropriate emoji based on element context
    let emoji = elementType === "svg" ? "�" : "�📄"; // Use 👉 for SVGs, 📄 for images

    // Check for common element types and assign appropriate emojis
    const contextText = (
      elementAlt +
      " " +
      elementSrc +
      " " +
      elementTitle +
      " " +
      elementClass +
      " " +
      elementText +
      " " +
      elementData
    ).toLowerCase();

    // For SVG elements, use 👉 as default but allow specific overrides
    if (elementType === "svg") {
      emoji = "👉"; // Default for all SVGs

      // Specific overrides for SVGs with clear context
      if (
        contextText.includes("arrow") ||
        contextText.includes("next") ||
        contextText.includes("right")
      ) {
        emoji = "👉"; // Keep pointing finger for arrows (already default)
      } else if (
        contextText.includes("check") ||
        contextText.includes("success") ||
        contextText.includes("valid")
      ) {
        emoji = "✅"; // Checkmark
      } else if (
        contextText.includes("error") ||
        contextText.includes("fail") ||
        contextText.includes("invalid")
      ) {
        emoji = "❌"; // Cross mark
      } else if (
        contextText.includes("warning") ||
        contextText.includes("alert")
      ) {
        emoji = "⚠️"; // Warning
      }
    } else {
      // For IMG elements, use the original logic
      if (contextText.includes("icon") || contextText.includes("bullet")) {
        emoji = "•"; // Bullet point for icons/bullets
      } else if (
        contextText.includes("arrow") ||
        contextText.includes("next") ||
        contextText.includes("right")
      ) {
        emoji = "→"; // Right arrow
      } else if (
        contextText.includes("prev") ||
        contextText.includes("left") ||
        contextText.includes("back")
      ) {
        emoji = "←"; // Left arrow
      } else if (contextText.includes("up")) {
        emoji = "↑"; // Up arrow
      } else if (contextText.includes("down")) {
        emoji = "↓"; // Down arrow
      } else if (
        contextText.includes("check") ||
        contextText.includes("success") ||
        contextText.includes("valid")
      ) {
        emoji = "✅"; // Checkmark
      } else if (
        contextText.includes("error") ||
        contextText.includes("fail") ||
        contextText.includes("invalid")
      ) {
        emoji = "❌"; // Cross mark
      } else if (
        contextText.includes("warning") ||
        contextText.includes("alert")
      ) {
        emoji = "⚠️"; // Warning
      } else if (
        contextText.includes("info") ||
        contextText.includes("information")
      ) {
        emoji = "ℹ️"; // Information
      } else if (
        contextText.includes("star") ||
        contextText.includes("favorite")
      ) {
        emoji = "⭐"; // Star
      } else if (
        contextText.includes("folder") ||
        contextText.includes("directory")
      ) {
        emoji = "📁"; // Folder
      } else if (
        contextText.includes("file") ||
        contextText.includes("document")
      ) {
        emoji = "📄"; // Document
      } else if (
        contextText.includes("image") ||
        contextText.includes("photo") ||
        contextText.includes("picture")
      ) {
        emoji = "🖼️"; // Picture
      } else if (contextText.includes("link") || contextText.includes("url")) {
        emoji = "🔗"; // Link
      } else if (
        contextText.includes("email") ||
        contextText.includes("mail")
      ) {
        emoji = "📧"; // Email
      } else if (
        contextText.includes("phone") ||
        contextText.includes("call")
      ) {
        emoji = "📞"; // Phone
      } else if (
        contextText.includes("calendar") ||
        contextText.includes("date")
      ) {
        emoji = "📅"; // Calendar
      } else if (
        contextText.includes("clock") ||
        contextText.includes("time")
      ) {
        emoji = "⏰"; // Clock
      } else if (
        contextText.includes("user") ||
        contextText.includes("person") ||
        contextText.includes("profile")
      ) {
        emoji = "👤"; // User
      } else if (
        contextText.includes("group") ||
        contextText.includes("team")
      ) {
        emoji = "👥"; // Group
      } else if (
        contextText.includes("setting") ||
        contextText.includes("config") ||
        contextText.includes("gear")
      ) {
        emoji = "⚙️"; // Settings
      } else if (
        contextText.includes("edit") ||
        contextText.includes("pencil")
      ) {
        emoji = "✏️"; // Pencil
      } else if (
        contextText.includes("delete") ||
        contextText.includes("trash") ||
        contextText.includes("remove")
      ) {
        emoji = "🗑️"; // Trash
      } else if (contextText.includes("save") || contextText.includes("disk")) {
        emoji = "💾"; // Save
      } else if (
        contextText.includes("search") ||
        contextText.includes("magnify")
      ) {
        emoji = "🔍"; // Search
      } else if (
        contextText.includes("home") ||
        contextText.includes("house")
      ) {
        emoji = "🏠"; // Home
      } else if (contextText.includes("decorative") && elementType === "svg") {
        emoji = "👉"; // Pointing finger for decorative SVGs
      }
    } // Close the IMG elements section

    // Override: Use 👉 for all SVG elements unless they have specific context overrides
    if (elementType === "svg") {
      emoji = "👉"; // Default SVG emoji
    }

    // Create a span element with the emoji
    const emojiSpan = doc.createElement("span");
    emojiSpan.textContent = emoji;
    emojiSpan.style.cssText =
      "margin: 0 4px; font-size: 1em; display: inline-block;";
    emojiSpan.setAttribute("data-original-element", elementType);
    emojiSpan.setAttribute("data-original-src", elementSrc);
    emojiSpan.setAttribute("data-original-alt", elementAlt);
    emojiSpan.setAttribute("data-original-class", elementClass);
    emojiSpan.title = `Original ${elementType}: ${
      elementAlt || elementClass || "Untitled element"
    }`;

    // Replace the element with the emoji span
    element.parentNode.replaceChild(emojiSpan, element);

    debug(
      `📊 Table ${tableIndex + 1}, ${elementType.toUpperCase()} ${
        elementIndex + 1
      }: Replaced "${elementAlt || elementClass || elementSrc}" with "${emoji}"`
    );

    return { replaced: true, emoji: emoji };

}

// Helper function to continue the original function flow
function completeTableImageReplacement(totalReplacements, doc) {
debug(`📊 Total images replaced with emojis: ${totalReplacements}`);

    // Return the processed HTML
    const processedHtml = doc.body.innerHTML;
    return processedHtml;

}

/\*\*

- Clean and validate URLs to ensure they're acceptable to Notion
  \*/
  function cleanAndValidateUrl(url) {
  if (!url || typeof url !== "string") {
  debug("⚠️ Invalid URL provided for cleaning:", url);
  return null;
  }


    // Trim and decode HTML entities first
    let cleanUrl = url
      .toString()
      .trim()
      .replace(/&amp;/g, "&")
      .replace(/&lt;/g, "<")
      .replace(/&gt;/g, ">")
      .replace(/&quot;/g, '"')
      .replace(/&#39;/g, "'");

    // Remove any null characters or control characters
    cleanUrl = cleanUrl.replace(/[\x00-\x1F\x7F]/g, "");

    // Handle hash-only URLs (preserve as-is for internal anchors)
    if (cleanUrl.startsWith("#")) {
      debug("🔗 Hash fragment URL preserved:", cleanUrl);
      return cleanUrl;
    }

    // Handle relative URLs (preserve as-is, don't add invalid protocol)
    if (
      cleanUrl.startsWith("/") ||
      cleanUrl.startsWith("./") ||
      cleanUrl.startsWith("../")
    ) {
      debug("🔗 Relative URL preserved:", cleanUrl);

      // Validate length (Notion has limits)
      if (cleanUrl.length > 2000) {
        debug("⚠️ Relative URL too long, truncating:", cleanUrl.length);
        cleanUrl = cleanUrl.substring(0, 2000);
      }

      // Filter out URLs containing .xhtml
      if (cleanUrl.toLowerCase().includes(".xhtml")) {
        debug("🚫 Filtering out xhtml relative URL:", cleanUrl);
        return null;
      }

      return cleanUrl;
    }

    // Try to parse as a complete URL
    try {
      const urlObj = new URL(cleanUrl);

      // Reconstruct clean URL
      let validatedUrl = `${urlObj.protocol}//${urlObj.host}${urlObj.pathname}`;

      // Add search params if they exist
      if (urlObj.search) {
        validatedUrl += urlObj.search;
      }

      // Add hash if it exists and is reasonable length
      if (urlObj.hash && urlObj.hash.length < 100) {
        validatedUrl += urlObj.hash;
      }

      // Validate URL length (Notion has limits)
      if (validatedUrl.length > 2000) {
        debug("⚠️ URL too long, truncating:", validatedUrl.length);
        validatedUrl = validatedUrl.substring(0, 2000);
      }

      // Filter out URLs containing .xhtml
      if (validatedUrl.toLowerCase().includes(".xhtml")) {
        debug("🚫 Filtering out xhtml URL:", validatedUrl);
        return null;
      }

      debug("✅ URL cleaned and validated:", validatedUrl);
      return validatedUrl;
    } catch (error) {
      debug("❌ URL validation failed:", error.message, "for URL:", cleanUrl);

      // For invalid URLs that aren't relative paths, attempt to fix with base URL
      if (
        !cleanUrl.match(/^https?:\/\//) &&
        !cleanUrl.startsWith("/") &&
        !cleanUrl.startsWith("#")
      ) {
        debug("🔧 Attempting to create absolute URL for:", cleanUrl);

        // Try to construct with servicenow.com as base (common case)
        const baseUrl = "https://www.servicenow.com";
        try {
          const absoluteUrl = new URL(cleanUrl, baseUrl).href;
          debug("✅ Created absolute URL:", absoluteUrl);
          return absoluteUrl;
        } catch (finalError) {
          debug("❌ Failed to create absolute URL:", finalError.message);
          return null;
        }
      }

      // If all else fails, return null instead of creating invalid URLs
      debug("� Could not clean URL, returning null:", cleanUrl);
      return null;
    }

}

/\*\*

- Clean URLs in HTML content to prevent Notion validation errors
  \*/
  function cleanUrlsInHtml(htmlContent) {
  if (!htmlContent) return htmlContent;


    debug("🔗 Cleaning URLs in HTML content for Notion compatibility");

    let cleanedContent = htmlContent;
    let urlsProcessed = 0;

    // Find all href attributes and clean them
    cleanedContent = cleanedContent.replace(
      /href=["']([^"']+)["']/gi,
      (match, url) => {
        urlsProcessed++;
        const cleanedUrl = cleanAndValidateUrl(url);

        if (cleanedUrl) {
          debug(`🔗 Cleaned URL ${urlsProcessed}: ${url} → ${cleanedUrl}`);
          return `href="${cleanedUrl}"`;
        } else {
          debug(`❌ Removing invalid URL: ${url}`);
          return 'href="#"'; // Replace with safe placeholder
        }
      }
    );

    // Find all src attributes in images/iframes and clean them
    cleanedContent = cleanedContent.replace(
      /src=["']([^"']+)["']/gi,
      (match, url) => {
        // Only process if it looks like a URL (not data: URLs or relative paths)
        if (url.startsWith("http://") || url.startsWith("https://")) {
          urlsProcessed++;
          const cleanedUrl = cleanAndValidateUrl(url);

          if (cleanedUrl) {
            debug(
              `🖼️ Cleaned image URL ${urlsProcessed}: ${url} → ${cleanedUrl}`
            );
            return `src="${cleanedUrl}"`;
          } else {
            debug(`❌ Removing invalid image URL: ${url}`);
            return 'src=""'; // Remove invalid URLs
          }
        }
        return match; // Keep as-is for relative paths, data URLs, etc.
      }
    );

    if (urlsProcessed > 0) {
      debug(`✅ Processed ${urlsProcessed} URLs in HTML content`);
    }

    return cleanedContent;

}

/\*\*

- Convert markdown-style italic formatting (_text_) to proper HTML italic tags
  \*/
  function convertMarkdownItalicToHtml(htmlContent) {
  if (!htmlContent) return htmlContent;


    debug(
      "📝 Converting markdown-style italic formatting (_text_) to <em> tags"
    );

    let convertedCount = 0;
    let convertedContent = htmlContent;

    // Handle complex patterns that may contain nested underscores
    // First, let's identify and fix common problematic patterns manually

    // Pattern 1: Handle the specific PMBOK Guide pattern
    const pmbokPattern =
      /\b_([^<>]*?PMBOK[^<>]*?)_([®™©]?)([^<>]*?\bGuide\)?)/gi;
    convertedContent = convertedContent.replace(
      pmbokPattern,
      (match, beforePmbok, trademark, afterPmbok) => {
        // Skip if this looks like it might be inside an HTML tag
        const matchIndex = convertedContent.indexOf(match);
        const beforeMatch = convertedContent.substring(0, matchIndex);
        const openTagIndex = beforeMatch.lastIndexOf("<");
        const closeTagIndex = beforeMatch.lastIndexOf(">");

        if (openTagIndex > closeTagIndex) {
          debug(`⏭️ Skipping ${match} - appears to be inside HTML tag`);
          return match;
        }

        const fullText = beforePmbok + "PMBOK" + trademark + afterPmbok;
        convertedCount++;
        debug(`✅ Converting PMBOK pattern: ${match} → <em>${fullText}</em>`);
        return `<em>${fullText}</em>`;
      }
    );

    // Pattern 2: Handle standard markdown italics (for simpler cases)
    const standardPattern = /\b_([^_<>]+?)_([®™©]?)(?!\w)/g;
    convertedContent = convertedContent.replace(
      standardPattern,
      (match, innerText, suffix = "") => {
        // Skip if already converted
        if (match.includes("<em>") || match.includes("</em>")) {
          return match;
        }

        // Skip if this looks like it might be inside an HTML tag
        const matchIndex = convertedContent.indexOf(match);
        const beforeMatch = convertedContent.substring(0, matchIndex);
        const openTagIndex = beforeMatch.lastIndexOf("<");
        const closeTagIndex = beforeMatch.lastIndexOf(">");

        if (openTagIndex > closeTagIndex) {
          debug(`⏭️ Skipping ${match} - appears to be inside HTML tag`);
          return match;
        }

        // Don't convert if this looks like a URL or path
        if (match.includes("://") || match.includes("/")) {
          debug(`⏭️ Skipping ${match} - appears to be URL or path`);
          return match;
        }

        convertedCount++;
        debug(
          `✅ Converting italic: ${match} → <em>${innerText}</em>${suffix}`
        );
        return `<em>${innerText}</em>${suffix}`;
      }
    );

    debug(
      `📝 Converted ${convertedCount} markdown italic patterns to <em> tags`
    );

    return convertedContent;

}

/\*\*

- Send collected content to Universal Workflow for processing
  \*/
  async function sendToUniversalWorkflow(collectedData) {
  debug("🚀 Sending content to Universal Workflow"); // Wait for Universal Workflow to be available first
  if (window.W2NSavingProgress) {
  window.W2NSavingProgress.setStep("Loading Universal Workflow");
  window.W2NSavingProgress.setMessage(
  "Waiting for Universal Workflow to be ready..."
  );
  }


    debug("⏳ Waiting for Universal Workflow ready signals...");
    let readyEventReceived = false;
    let checkAttempts = 0;
    const maxCheckAttempts = 10; // Reduce to 5 seconds since events are working

    // Listen for ready events
    const readyHandler = (event) => {
      if (event.detail && event.detail.available) {
        debug(
          "🎉 Universal Workflow ready event received, proceeding immediately"
        );
        readyEventReceived = true;
      }
    };

    document.addEventListener("W2N_WORKFLOW_READY", readyHandler);

    // Check if we're already receiving ready events (they start immediately)
    while (checkAttempts < maxCheckAttempts && !readyEventReceived) {
      // Skip direct window access checks - use event system
      debug(
        `🔍 Attempt ${
          checkAttempts + 1
        }/${maxCheckAttempts} - Waiting for ready events...`
      );

      // If we've received ready events, we can proceed
      if (readyEventReceived) {
        debug("✅ Universal Workflow available via events");
        break;
      }

      debug(
        `⏳ Universal Workflow not ready yet (attempt ${
          checkAttempts + 1
        }/${maxCheckAttempts})`
      );
      await new Promise((resolve) => setTimeout(resolve, 500));
      checkAttempts++;
    }

    // Clean up event listener
    document.removeEventListener("W2N_WORKFLOW_READY", readyHandler);

    // If we haven't received ready events, still try to proceed with cross-context communication
    if (!readyEventReceived) {
      debug(
        "⚠️ No ready events received, but proceeding with cross-context communication"
      );
    }

    debug(
      "✅ Universal Workflow is ready, proceeding with content processing..."
    );

    // Test proxy connectivity
    if (window.W2NSavingProgress) {
      window.W2NSavingProgress.setStep("Connecting to proxy server");
      window.W2NSavingProgress.setMessage(
        "Testing connection to local proxy..."
      );
    }

    try {
      const healthCheck = await apiCall("GET", "/health");
      if (!healthCheck?.status === "ok" && !healthCheck?.success) {
        throw new Error(`Proxy server not responding at ${config.proxyUrl}`);
      }
    } catch (error) {
      debug("❌ Proxy connectivity test failed:", error);
      throw new Error(`Cannot reach proxy server: ${error.message}`);
    }

    // Check if Universal Workflow is available (skip if we already received ready events)
    let workflowAvailable = readyEventReceived;

    if (!workflowAvailable) {
      if (window.W2NSavingProgress) {
        window.W2NSavingProgress.setStep("Initializing Universal Workflow");
        window.W2NSavingProgress.setMessage(
          "Checking workflow module availability..."
        );
      }

      workflowAvailable = await checkWorkflowAvailability();
    } else {
      debug("✅ Skipping workflow check since ready events already received");
    }

    if (!workflowAvailable) {
      throw new Error("Universal Workflow module is not available");
    }

    try {
      // Test Universal Workflow availability first with a quick configure test
      debug("🏓 Testing Universal Workflow availability...");
      try {
        await callWorkflowMethod("configure", {
          proxyUrl: config.proxyUrl,
          debugMode: true,
        });
        debug("✅ Universal Workflow configure test successful");
      } catch (testError) {
        debug("❌ Universal Workflow test failed:", testError);
        throw new Error(
          `Universal Workflow is not responding: ${testError.message}`
        );
      }

      // Configure workflow (already done above, but with full config)
      if (window.W2NSavingProgress) {
        window.W2NSavingProgress.setStep("Configuring workflow");
        window.W2NSavingProgress.setMessage(
          "Setting up content processing pipeline..."
        );
      }

      debug("🔧 Configuring Universal Workflow with full settings...");
      await callWorkflowMethod("configure", {
        proxyUrl: config.proxyUrl,
        contentFormat: "html", // Use html format so proxy can properly convert to Notion blocks
        debugMode: config.debugMode,
        // Force direct Notion SDK image processing (bypass Martian for images)
        imageProcessingMode: "notion-sdk", // Direct to Notion SDK
        preserveImagePositions: true,
        maxImageCount: 50,
      });
      debug("✅ Universal Workflow configured successfully");

      // Send to Universal Workflow using processContent
      if (window.W2NSavingProgress) {
        window.W2NSavingProgress.setStep("Creating Notion page");
        window.W2NSavingProgress.setMessage(
          "Converting and uploading content to Notion..."
        );
      }

      debug(
        "📤 Sending content to Universal Workflow processContent method..."
      );

      // Debug: dump collected metadata so we can verify fields before sending
      try {
        debug(
          "🧾 Collected metadata to send:",
          JSON.stringify(collectedData.metadata || {}, null, 2)
        );
      } catch (e) {
        debug(
          "🧾 Collected metadata (non-serializable):",
          collectedData.metadata
        );
      }

      // Debug: Show exactly what image URLs are being sent to Universal Workflow
      if (collectedData.images && collectedData.images.length > 0) {
        debug(
          `📤 Sending ${collectedData.images.length} images to Universal Workflow:`
        );
        collectedData.images.forEach((img, index) => {
          debug(
            `    Image ${index + 1}: url="${img.url}", baseUrl="${
              img.baseUrl || "none"
            }"`
          );
        });
      }

      // Use persisted cover/icon during AutoExtract, otherwise use page-specific values
      const finalCover = globalState.autoExtractState.running
        ? globalState.autoExtractState.persistedCover || collectedData.cover
        : collectedData.cover;
      const finalIcon = globalState.autoExtractState.running
        ? globalState.autoExtractState.persistedIcon || collectedData.icon
        : collectedData.icon;

      console.log(
        "🖼️ [AutoExtract] Using persisted cover:",
        !!finalCover,
        "running:",
        globalState.autoExtractState.running
      );
      console.log(
        "🖼️ [AutoExtract] Using persisted icon:",
        !!finalIcon,
        "running:",
        globalState.autoExtractState.running
      );

      // Debug: Log the actual icon and cover objects being sent
      console.log(
        "🎭 [W2N-SN2N] Final icon being sent to Universal Workflow:",
        finalIcon
      );
      console.log(
        "🖼️ [W2N-SN2N] Final cover being sent to Universal Workflow:",
        finalCover
      );

      // 🔍 Enhanced debugging: Show final content before sending to Universal Workflow
      debug("📋 Final content before Universal Workflow processing:");
      debug(`   Title: ${collectedData.title}`);
      debug(
        `   Content length: ${collectedData.contentHtml?.length || 0} chars`
      );
      debug(`   Images: ${collectedData.images?.length || 0}`);
      debug(`   Database ID: ${collectedData.databaseId}`);

      // Show first 500 chars of content to verify captions are included
      if (collectedData.contentHtml) {
        const preview = collectedData.contentHtml.substring(0, 500);
        debug(
          `   Content preview: ${preview}${
            collectedData.contentHtml.length > 500 ? "..." : ""
          }`
        );

        // Specifically check for recovered captions (h3 or h4)
        const captionMatches = collectedData.contentHtml.match(
          /<h(?:3|4) class="table-caption-title">/g
        );
        const titleMatches = collectedData.contentHtml.match(
          /<strong class="title">/g
        );
        debug(
          `   Recovered table captions (h4): ${captionMatches?.length || 0}`
        );
        debug(
          `   Recovered title elements (strong): ${titleMatches?.length || 0}`
        );
      }

      const result = await callWorkflowMethod("processContent", {
        title: collectedData.title,
        contentHtml: collectedData.contentHtml,
        url: collectedData.url,
        images: collectedData.images,
        metadata: collectedData.metadata,
        databaseId: collectedData.databaseId,
        icon: finalIcon,
        cover: finalCover,
        overrides: {
          directSDKImages: config.directSDKImages,
          useMartian: config.useMartian,
        },
      });

      return result;
    } catch (error) {
      debug("❌ Universal Workflow processing failed:", error);
      throw error;
    }

}

// =============================================================================
// ESSENTIAL UTILITY FUNCTIONS (from original P2N)
// =============================================================================

/\*\*

- Extract database properties for Notion page creation using dynamic property mapping
  \*/
  function extractDatabaseProperties(databaseId = null) {
  const properties = {};


    try {
      // Get database ID if not provided
      if (!databaseId) {
        const databaseSelect = document.querySelector(".w2n-database-select");
        databaseId = databaseSelect ? databaseSelect.value : null;
      }

      // Load user-defined property mappings
      const propertyMappings = loadPropertyMappings(databaseId);

      // If no mappings exist, return empty properties
      if (!propertyMappings || Object.keys(propertyMappings).length === 0) {
        console.log(
          "⚠️ [Database Properties] No property mappings found, returning empty properties"
        );
        return properties;
      }

      console.log(
        `🔧 [Database Properties] Loaded ${
          Object.keys(propertyMappings).length
        } property mappings:`,
        propertyMappings
      );

      // Get current database schema to validate property existence
      let currentDatabaseSchema = null;
      try {
        const databaseSelect = document.querySelector(".w2n-database-select");
        if (databaseSelect && databaseSelect.value) {
          const option = databaseSelect.querySelector(
            `option[value="${databaseSelect.value}"]`
          );
          if (option) {
            currentDatabaseSchema = JSON.parse(option.dataset.schema || "{}");
          }
        }
      } catch (e) {
        console.log(
          "⚠️ [Database Properties] Could not load database schema for validation"
        );
      }

      // Extract properties based on user mappings
      for (const [contentKey, notionPropertyKey] of Object.entries(
        propertyMappings
      )) {
        if (!notionPropertyKey || notionPropertyKey === "") {
          console.log(
            `⏭️ [Database Properties] Skipping empty mapping for: ${contentKey}`
          );
          continue;
        }

        // Check if the Notion property actually exists in the database
        if (currentDatabaseSchema && currentDatabaseSchema.properties) {
          if (!currentDatabaseSchema.properties[notionPropertyKey]) {
            console.log(
              `⚠️ [Database Properties] Skipping "${contentKey}" -> "${notionPropertyKey}" - property does not exist in database`
            );
            continue;
          }
        }

        let extractedValue = null;

        // Handle special content fields
        switch (contentKey) {
          case "hasFigureImage":
            try {
              const contentElement = findServiceNowContentElement();
              if (contentElement) {
                const images = contentElement.querySelectorAll("img, figure");
                const hasImages = images.length > 0;
                extractedValue = hasImages;
                console.log(
                  `✅ [Database Properties] ${contentKey} -> ${notionPropertyKey}: ${hasImages} (${images.length} images found)`
                );
              }
            } catch (error) {
              console.error(
                `❌ [Database Properties] Error checking for images:`,
                error
              );
            }
            break;

          case "hasVideos":
            try {
              const contentElement = findServiceNowContentElement();
              if (contentElement) {
                const videos = contentElement.querySelectorAll(
                  "video, iframe[src*='youtube'], iframe[src*='vimeo']"
                );
                const hasVideos = videos.length > 0;
                extractedValue = hasVideos;
                console.log(
                  `✅ [Database Properties] ${contentKey} -> ${notionPropertyKey}: ${hasVideos} (${videos.length} videos found)`
                );
              }
            } catch (error) {
              console.error(
                `❌ [Database Properties] Error checking for videos:`,
                error
              );
            }
            break;

          case "currentReleaseURL":
          case "CurrentReleaseURL":
            try {
              const currentUrl = window.location.href;
              const convertedURL =
                convertToServiceNowcurrentReleaseURL(currentUrl);
              if (convertedURL && convertedURL !== currentUrl) {
                extractedValue = convertedURL;
                console.log(
                  `✅ [Database Properties] ${contentKey} -> ${notionPropertyKey}: "${convertedURL}"`
                );
              } else {
                console.log(
                  `⚠️ [Database Properties] Could not convert current URL to currentReleaseURL format`
                );
              }
            } catch (error) {
              console.error(
                `❌ [Database Properties] Error generating currentReleaseURL:`,
                error
              );
            }
            break;

          default:
            // Try to extract using ServiceNow selectors
            const selectors = SERVICENOW_SELECTORS[contentKey] || [];
            for (const selector of selectors) {
              try {
                const element = document.querySelector(selector);
                if (element && element.textContent.trim()) {
                  extractedValue = element.textContent.trim();
                  console.log(
                    `✅ [Database Properties] ${contentKey} -> ${notionPropertyKey}: "${extractedValue}" (selector: ${selector.substring(
                      0,
                      50
                    )}...)`
                  );
                  break;
                }
              } catch (e) {
                console.log(
                  `❌ [Database Properties] Error with selector "${selector}" for "${contentKey}":`,
                  e.message
                );
              }
            }
            break;
        }

        // Apply extracted value to properties using the Notion property key
        if (extractedValue !== null) {
          properties[notionPropertyKey] = extractedValue;
          console.log(
            `🎯 [Database Properties] Successfully mapped "${contentKey}" -> "${notionPropertyKey}": ${extractedValue}`
          );
        } else {
          console.log(
            `⚠️ [Database Properties] No value found for "${contentKey}" -> "${notionPropertyKey}"`
          );
        }
      }

      console.log(
        "🎯 [Database Properties] Final extracted properties:",
        properties
      );
      return properties;
    } catch (error) {
      console.error(
        "❌ [Database Properties] Error during dynamic property extraction:",
        error
      );
      return {};
    }

}

/\*\*

- Simple debug function to test property extraction on current page
  \*/
  unsafeWindow.simpleDebug = function () {
  console.log("🔍 SIMPLE DEBUG - Current URL:", window.location.href);
  console.log(
  "🔍 SIMPLE DEBUG - Images on page:",
  document.querySelectorAll("img, figure, svg, canvas").length
  );


    // Test version selector
    const versionElement = document.querySelector(
      "div:nth-child(2) > div.zDocsLayout:nth-child(1) > main.zDocsMain.css-ettsdk > div > div.zDocsTopicPage.css-ettsdk:nth-child(3) > div.zDocsTopicPageTopicContainer:nth-child(2) > article > header.zDocsTopicPageHead > ul.zDocsTopicPageDetails > li.zDocsTopicPageCluster:nth-child(1) > div.zDocsReusableSelect.undefined > div.dropdown.bootstrap-select.form-control > button.btn.dropdown-toggle.btn-light > div.filter-option > div.filter-option-inner > div.filter-option-inner-inner"
    );
    console.log("🔍 SIMPLE DEBUG - Version element found:", !!versionElement);
    if (versionElement) {
      console.log(
        "🔍 SIMPLE DEBUG - Version text:",
        versionElement.textContent.trim()
      );
    }

    // Test updated selector
    const updatedElement = document.querySelector(
      "div:nth-child(2) > div.zDocsLayout:nth-child(1) > main.zDocsMain.css-ettsdk > div > div.zDocsTopicPage.css-ettsdk:nth-child(3) > div.zDocsTopicPageTopicContainer:nth-child(2) > article > header.zDocsTopicPageHead > ul.zDocsTopicPageDetails > li.zDocsTopicPageDate.css-cinqea:nth-child(3) > span.css-cinqea"
    );
    console.log("🔍 SIMPLE DEBUG - Updated element found:", !!updatedElement);
    if (updatedElement) {
      console.log(
        "🔍 SIMPLE DEBUG - Updated text:",
        updatedElement.textContent.trim()
      );
    }

    // Test basic property extraction
    const properties = extractDatabaseProperties();
    console.log("🔍 SIMPLE DEBUG - Extracted properties:", properties);

    return {
      url: window.location.href,
      images: document.querySelectorAll("img, figure, svg, canvas").length,
      versionFound: !!versionElement,
      updatedFound: !!updatedElement,
      properties: properties,
    };

};

// Also expose as global variable for easier access
unsafeWindow.debugProps = unsafeWindow.simpleDebug;

/\*\*

- Test function for debugging database property extraction (available in console)
  \*/
  unsafeWindow.testDatabaseProperties = function () {
  console.log("🧪 [TEST] Testing database property extraction...");
  console.log("🧪 [TEST] Current URL:", window.location.href);
  console.log("🧪 [TEST] Document ready state:", document.readyState);


    // Test each selector individually
    console.log("🧪 [TEST] Testing image count...");
    const contentElement = findServiceNowContentElement();
    const allImages = contentElement
      ? contentElement.querySelectorAll("img, figure, svg, canvas")
      : [];

    // Apply same filtering as main detection
    const contentImages = contentElement
      ? Array.from(allImages).filter((img) => {
          // Skip very small images (likely icons)
          if (img.naturalWidth && img.naturalWidth < 50) return false;
          if (img.naturalHeight && img.naturalHeight < 50) return false;

          // Skip images with icon-like classes or attributes
          const classList = img.className.toLowerCase();
          const src = img.src?.toLowerCase() || "";

          if (
            classList.includes("icon") ||
            classList.includes("logo") ||
            classList.includes("button") ||
            classList.includes("ui-") ||
            src.includes("icon") ||
            src.includes("logo") ||
            src.includes("button")
          ) {
            return false;
          }

          // Skip SVGs that are likely decorative
          if (img.tagName === "SVG") {
            const svgWidth = img.width?.baseVal?.value || img.clientWidth;
            const svgHeight = img.height?.baseVal?.value || img.clientHeight;

            if (svgWidth && svgWidth < 100) return false;
            if (svgHeight && svgHeight < 100) return false;
            if (img.closest("nav, .nav, .navigation, .menu, .header, .footer"))
              return false;
          }

          // Skip small canvas elements
          if (img.tagName === "CANVAS") {
            const canvasWidth = img.width || img.clientWidth;
            const canvasHeight = img.height || img.clientHeight;
            if (canvasWidth < 200 || canvasHeight < 100) return false;
          }

          return true;
        })
      : [];

    console.log(
      "🧪 [TEST] Images found in content area:",
      `${contentImages.length} content images of ${allImages.length} total elements`
    );

    // Test version selectors
    console.log("🧪 [TEST] Testing version selectors...");
    SERVICENOW_SELECTORS.version.forEach((selector, index) => {
      console.log(
        `🧪 [TEST] Version selector ${index + 1}: ${selector.substring(
          0,
          100
        )}...`
      );
      const element = document.querySelector(selector);
      console.log(`🧪 [TEST] Element found:`, element);
      if (element) {
        console.log(`🧪 [TEST] Element text:`, element.textContent.trim());
      }
    });

    // Test updated selectors
    console.log("🧪 [TEST] Testing updated selectors...");
    SERVICENOW_SELECTORS.updated.forEach((selector, index) => {
      console.log(
        `🧪 [TEST] Updated selector ${index + 1}: ${selector.substring(
          0,
          100
        )}...`
      );
      const element = document.querySelector(selector);
      console.log(`🧪 [TEST] Element found:`, element);
      if (element) {
        console.log(`🧪 [TEST] Element text:`, element.textContent.trim());
      }
    });

    console.log("🧪 [TEST] Running full extraction...");
    const properties = extractDatabaseProperties();
    console.log("🧪 [TEST] Final result:", properties);

    return properties;

};

/\*\*

- Debug function to test the complete property flow
  \*/
  unsafeWindow.debugPropertyFlow = function () {
  console.log("🔬 [DEBUG FLOW] Testing complete property pipeline...");


    // Step 1: Test property extraction
    console.log("🔬 [STEP 1] Testing property extraction...");
    const extractedProps = extractDatabaseProperties();
    console.log("🔬 [STEP 1] Extracted properties:", extractedProps);

    // Step 2: Test metadata creation
    console.log("🔬 [STEP 2] Testing metadata creation...");
    const baseMetadata = extractServiceNowMetadata();
    console.log("🔬 [STEP 2] Base metadata:", baseMetadata);

    // Step 3: Test property assignment
    console.log("🔬 [STEP 3] Testing property assignment...");
    const finalMetadata = {
      ...baseMetadata,
      hasFigureImage: extractedProps.hasFigureImage || false,
      Video: extractedProps.hasVideos || false,
      Source: "ServiceNow.com/docs",
      Version: extractedProps.version || "",
      Updated: extractedProps.updated || "",
      currentReleaseURL: extractedProps.currentReleaseURL || "",
    };
    console.log("🔬 [STEP 3] Final metadata:", finalMetadata);

    // Step 4: Test Universal Workflow availability
    console.log("🔬 [STEP 4] Testing Universal Workflow availability...");
    console.log("🔬 [STEP 4] window.W2NWorkflow exists:", !!window.W2NWorkflow);
    if (window.W2NWorkflow) {
      console.log(
        "🔬 [STEP 4] W2NWorkflow methods:",
        Object.keys(window.W2NWorkflow)
      );
    }

    return {
      extractedProperties: extractedProps,
      baseMetadata: baseMetadata,
      finalMetadata: finalMetadata,
      workflowAvailable: !!window.W2NWorkflow,
      url: window.location.href,
    };

};

/\*\*

- Construct ServiceNow CDN base URL for images from page context
  \*/
  function constructServiceNowBaseUrl() {
  const currentUrl = window.location.href;
  debug(`🔍 Starting ServiceNow base URL construction from: ${currentUrl}`);


    // Generic fallback: we don't have site-specific CDN patterns here.
    // Use the page origin as a safe base URL for resolving relative resources.
    try {
      const origin = new URL(window.location.href).origin;
      debug(`🔍 Using page origin as base URL: ${origin}`);
      return origin;
    } catch (e) {
      debug(
        `⚠️ Could not determine origin, falling back to href: ${e.message}`
      );
      return window.location.href;
    }

}

/\*\*

- Extract content with iframe support (simplified version)
  \*/
  /\*\*
- Remove zDocsTopicPageDetails content from HTML to exclude metadata/navigation elements
  \*/
  function removeZDocsTopicPageDetails(htmlContent) {
  if (!htmlContent) return htmlContent;


    try {
      debug("🔍 Starting zDocsTopicPageDetails removal...");
      // Create a document fragment for DOM manipulation
      const parser = new DOMParser();
      const doc = parser.parseFromString(htmlContent, "text/html");

      // Debug: Log all h1 elements found in the content
      const allH1s = doc.querySelectorAll("h1");
      debug(`🔍 Found ${allH1s.length} h1 elements in content:`);
      allH1s.forEach((h1, index) => {
        debug(
          `🔍 H1 ${index + 1}: class="${
            h1.className
          }", text="${h1.textContent?.trim()}"`
        );
      });

      // Remove all zDocsTopicPageDetails elements (version selectors, metadata, navigation)
      const topicPageDetailsElements = doc.querySelectorAll(
        ".zDocsTopicPageDetails, ul.zDocsTopicPageDetails, .zDocsTopicPageHead, header.zDocsTopicPageHead"
      );

      debug(
        `🔍 Found ${topicPageDetailsElements.length} zDocsTopicPageDetails elements to remove`
      );
      topicPageDetailsElements.forEach((element) => {
        debug(
          `🗑️ Removing zDocsTopicPageDetails element: ${element.className}`
        );
        element.remove();
      });

      // Remove the main page title header (#zDocsContent > header > h1)
      const zDocsContentHeaders = doc.querySelectorAll(
        "#zDocsContent > header, #zDocsContent header"
      );
      zDocsContentHeaders.forEach((header) => {
        const h1Element = header.querySelector("h1");
        if (h1Element) {
          debug(
            `🗑️ Removing zDocsContent header h1: ${h1Element.textContent?.trim()}`
          );
          h1Element.remove();
        }
        // If the header is now empty, remove the entire header
        if (header.children.length === 0 || header.textContent.trim() === "") {
          debug(`🗑️ Removing empty zDocsContent header`);
          header.remove();
        }
      });

      // Remove specific page title elements (h1.css-g931ng and similar)
      const titleElements = doc.querySelectorAll(
        "h1.css-g931ng, .zDocsTopicPageHead h1"
      );
      debug(`🔍 Found ${titleElements.length} title elements to remove`);
      titleElements.forEach((h1Element) => {
        debug(
          `🗑️ Removing page title h1: "${h1Element.textContent?.trim()}" (class: ${
            h1Element.className
          })`
        );
        h1Element.remove();
      });

      // Additional broad title removal for any remaining h1s that might be page titles
      const remainingH1s = doc.querySelectorAll("h1");
      debug(
        `🔍 After targeted removal, ${remainingH1s.length} h1 elements remain`
      );
      remainingH1s.forEach((h1, index) => {
        const text = h1.textContent?.trim();
        const className = h1.className;
        debug(
          `🔍 Remaining H1 ${index + 1}: class="${className}", text="${text}"`
        );

        // Remove h1s that look like page titles (have css-g931ng class or are clearly titles)
        if (
          className.includes("css-g931ng") ||
          (text &&
            text.length > 10 &&
            text.length < 200 &&
            !h1.closest("table") &&
            !h1.closest(".code-block"))
        ) {
          debug(`🗑️ Removing suspected page title h1: "${text}"`);
          h1.remove();
        }
      });

      // Also remove specific elements that might contain version selectors and metadata
      const metadataSelectors = [
        ".zDocsTopicPageCluster", // Version selector cluster
        ".zDocsTopicPageDate", // Date metadata
        ".zDocsReusableSelect", // Version dropdown
        ".filter-option", // Bootstrap select options
        "[data-toggle='dropdown']", // Dropdown toggles
        ".dropdown-toggle", // Dropdown buttons
      ];

      metadataSelectors.forEach((selector) => {
        const elements = doc.querySelectorAll(selector);
        elements.forEach((element) => {
          // Only remove if it's within a topic page details context
          if (
            element.closest(".zDocsTopicPageDetails") ||
            element.closest(".zDocsTopicPageHead")
          ) {
            debug(`🗑️ Removing metadata element: ${selector}`);
            element.remove();
          }
        });
      });

      // Return the cleaned HTML
      const cleanedHtml = doc.body.innerHTML;
      debug(`✅ Cleaned zDocsTopicPageDetails from content`);
      return cleanedHtml;
    } catch (error) {
      debug("❌ Error removing zDocsTopicPageDetails:", error);
      return htmlContent; // Return original if cleaning fails
    }

}

/\*\*

- Remove table search labels from DataTables wrapper elements
  \*/
  function removeTableSearchLabels(htmlContent) {
  if (!htmlContent) return htmlContent;


    try {
      debug("🔍 Starting table search label removal...");
      // Create a document fragment for DOM manipulation
      const parser = new DOMParser();
      const doc = parser.parseFromString(htmlContent, "text/html");

      // Remove search labels from DataTables filter elements within table-wrap containers
      const tableWrappers = doc.querySelectorAll(".table-wrap");
      let removedCount = 0;

      tableWrappers.forEach((wrapper) => {
        // Find DataTables filter elements that contain search labels
        const filterElements = wrapper.querySelectorAll(
          ".dataTables_filter, [id*='_filter']"
        );

        filterElements.forEach((filterElement) => {
          // Find labels containing "Search:" text
          const searchLabels = filterElement.querySelectorAll("label");

          searchLabels.forEach((label) => {
            const labelText = label.textContent?.trim() || "";

            // Check if this label contains "Search:" text
            if (labelText.toLowerCase().includes("search:")) {
              debug(`🗑️ Removing search label: "${labelText}"`);

              // If the label only contains "Search:" and an input, remove the text but keep the input
              const input = label.querySelector("input");
              if (input && labelText.startsWith("Search:")) {
                // Remove just the "Search:" text content, keep the input
                const textNodes = Array.from(label.childNodes).filter(
                  (node) =>
                    node.nodeType === Node.TEXT_NODE &&
                    node.textContent.includes("Search:")
                );
                textNodes.forEach((textNode) => textNode.remove());
                removedCount++;
              } else {
                // Remove the entire label if it's just search text
                label.remove();
                removedCount++;
              }
            }
          });
        });
      });

      debug(`✅ Removed ${removedCount} search label(s) from table content`);

      // Return the cleaned HTML
      const cleanedHtml = doc.body.innerHTML;
      return cleanedHtml;
    } catch (error) {
      debug("❌ Error removing table search labels:", error);
      return htmlContent; // Return original if cleaning fails
    }

}

async function extractContentWithIframes(contentElement) {
let combinedHtml = "";
let combinedImages = [];

    // If the content element itself is an iframe, extract from it
    if (contentElement.tagName === "IFRAME") {
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
        // Try to extract base URL from page content or use ServiceNow pattern
        iframeBaseUrl = constructServiceNowBaseUrl();
        debug(`📍 Constructed ServiceNow base URL: ${iframeBaseUrl}`);
      }

      try {
        // Wait a moment for iframe to load if needed
        await new Promise((resolve) => setTimeout(resolve, 500));

        // Try multiple methods to access iframe content
        let iframeDoc =
          contentElement.contentDocument ||
          contentElement.contentWindow?.document;

        // Alternative access method for some browsers
        if (!iframeDoc && contentElement.contentWindow) {
          try {
            iframeDoc = contentElement.contentWindow.document;
          } catch (e) {
            debug(`⚠️ Alternative iframe access also blocked: ${e.message}`);
          }
        }

        // Initialize iframeContent variable in the outer scope
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

          // Initialize iframeContent variable in the outer scope
          let iframeContent = "";

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
              debug(
                `📄 Strategy 1 (${selector}): ${iframeContent.length} chars`
              );
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
                  baseUrl: iframeBaseUrl, // Use constructed or actual iframe base URL
                };
              })
              .filter((img) => img.url);

            debug(
              `🖼️ Found ${iframeImages.length} images in iframe (base: ${iframeBaseUrl})`
            );
            combinedImages.push(...iframeImages);
          } else {
            debug();
          }
        } else {
          debug(`⚠️ Cannot access iframe document - likely CORS blocked`);
        }
      } catch (e) {
        debug(`❌ Error accessing iframe content: ${e.message}`);
      }

      // If iframe extraction failed completely, return empty to prevent fallback to container
      if (!combinedHtml || combinedHtml.trim().length < 50) {
        debug(
          `❌ CRITICAL: Iframe content extraction failed completely - iframe is CORS-blocked`
        );
        // Return empty content to signal complete failure
        return { combinedHtml: "", combinedImages: [] };
      }
    } else {
      // Standard element - get its HTML content
      combinedHtml = contentElement.innerHTML || "";

      // Remove zDocsTopicPageDetails content to exclude version selector, metadata, etc.
      if (combinedHtml) {
        combinedHtml = removeZDocsTopicPageDetails(combinedHtml);
      }

      // Look for additional iframes within this element
      const iframes = contentElement.querySelectorAll("iframe");
      for (const iframe of iframes) {
        try {
          const iframeResult = await extractContentWithIframes(iframe);
          if (
            iframeResult.combinedHtml &&
            iframeResult.combinedHtml.length > 50
          ) {
            combinedHtml += `\n${iframeResult.combinedHtml}`;
            combinedImages.push(...(iframeResult.combinedImages || []));
          }
        } catch (e) {
          debug(`⚠️ Error processing nested iframe: ${e.message}`);
        }
      }

      // Extract images from the element itself
      const elementImages = Array.from(contentElement.querySelectorAll("img"))
        .map((img) => ({
          url: img.src || img.getAttribute("data-src"),
          alt: img.alt || img.getAttribute("alt") || "",
          width: img.width,
          height: img.height,
          baseUrl: window.location.href, // Use current page as base for regular elements
        }))
        .filter((img) => img.url);

      combinedImages.push(...elementImages);
    }

    return { combinedHtml, combinedImages };

}

/\*\*

- Basic duplicate detection
  \*/
  async function checkForDuplicates(databaseId, title, url) {
  try {
  const result = await apiCall("POST", "/api/check-duplicates", {
  databaseId,
  title,
  url,
  });
  return result.duplicates || [];
  } catch (error) {
  debug("⚠️ Duplicate check failed:", error);
  return []; // Continue without duplicate detection
  }
  }

/\*\*

- Show duplicate list for user decision
  \*/
  async function showDuplicateList(duplicates) {
  const message = `Found ${
    duplicates.length
  } potential duplicate(s):\n\n${duplicates
    .map((d) => `• ${d.title}`)
    .join("\n")}\n\nProceed anyway?`;
  return confirm(message);
  }

// =============================================================================
// DRAG AND DROP FUNCTIONALITY
// =============================================================================

function makePanelDraggable(panel) {
const header = panel.querySelector("#w2n-header");
if (!header) return;

    let isDragging = false;
    let startX, startY, startLeft, startTop;

    header.addEventListener("mousedown", (e) => {
      // Don't start dragging if clicking on the close button
      if (e.target.id === "w2n-close") return;

      isDragging = true;
      header.style.cursor = "grabbing";

      // Get starting positions
      startX = e.clientX;
      startY = e.clientY;
      startLeft =
        parseInt(panel.style.left) ||
        window.innerWidth - panel.offsetWidth - 20;
      startTop = parseInt(panel.style.top) || 20;

      // Prevent text selection during drag
      e.preventDefault();

      // Change panel appearance during drag
      panel.style.transition = "none";
      panel.style.opacity = "0.9";
      panel.style.boxShadow = "0 15px 35px rgba(0, 0, 0, 0.2)";
    });

    document.addEventListener("mousemove", (e) => {
      if (!isDragging) return;

      e.preventDefault();

      // Calculate new position
      const deltaX = e.clientX - startX;
      const deltaY = e.clientY - startY;
      let newLeft = startLeft + deltaX;
      let newTop = startTop + deltaY;

      // Keep panel within viewport bounds
      const maxLeft = window.innerWidth - panel.offsetWidth;
      const maxTop = window.innerHeight - panel.offsetHeight;

      newLeft = Math.max(0, Math.min(newLeft, maxLeft));
      newTop = Math.max(0, Math.min(newTop, maxTop));

      // Apply new position
      panel.style.left = newLeft + "px";
      panel.style.top = newTop + "px";
      panel.style.right = "auto"; // Remove right positioning
    });

    document.addEventListener("mouseup", () => {
      if (!isDragging) return;

      isDragging = false;
      header.style.cursor = "move";

      // Restore panel appearance
      panel.style.transition = "opacity 0.2s ease, box-shadow 0.2s ease";
      panel.style.opacity = "0.95";
      panel.style.boxShadow = "0 10px 25px rgba(0, 0, 0, 0.15)";

      // Save position to localStorage for persistence
      const rect = panel.getBoundingClientRect();
      localStorage.setItem(
        "w2n-panel-position",
        JSON.stringify({
          left: rect.left,
          top: rect.top,
        })
      );
    });

    // Restore saved position if available
    const savedPosition = localStorage.getItem("w2n-panel-position");
    if (savedPosition) {
      try {
        const pos = JSON.parse(savedPosition);
        // Ensure position is still within current viewport
        const maxLeft = window.innerWidth - panel.offsetWidth;
        const maxTop = window.innerHeight - panel.offsetHeight;

        const left = Math.max(0, Math.min(pos.left, maxLeft));
        const top = Math.max(0, Math.min(pos.top, maxTop));

        panel.style.left = left + "px";
        panel.style.top = top + "px";
        panel.style.right = "auto";
      } catch (e) {
        // If saved position is invalid, keep default
      }
    }

}

// =============================================================================
// AUTO-EXTRACTION STATE RESTORATION
// =============================================================================

function restoreAutoExtractState() {
try {
const savedState = localStorage.getItem("W2N_autoExtractState");
if (!savedState) {
return; // No saved state to restore
}

      const restoredState = JSON.parse(savedState);
      console.log(
        "🔄 [AutoExtract] Found saved state after page reload:",
        restoredState
      );

      // Clear the saved state to prevent duplicate restorations
      localStorage.removeItem("W2N_autoExtractState");

      // Validate that this is a valid restoration scenario
      if (!restoredState.running || restoredState.paused) {
        console.log(
          "🔄 [AutoExtract] Saved state indicates auto-extraction was not active, skipping restoration"
        );
        return;
      }

      // Restore the auto-extraction state
      globalState.autoExtractState = {
        running: restoredState.running,
        paused: false, // Always unpause after reload
        currentPage: restoredState.currentPage,
        totalProcessed: restoredState.totalProcessed,
        maxPages: restoredState.maxPages,
        reloadAttempts: restoredState.reloadAttempts || 0,
      };

      // Show status message
      showToast(
        `🔄 AutoExtract resumed after page reload\nProcessing page ${restoredState.currentPage}/${restoredState.maxPages}`,
        5000
      );

      console.log(
        "✅ [AutoExtract] State restored successfully, resuming auto-extraction..."
      );

      // Resume auto-extraction after a brief delay to let the page settle
      setTimeout(() => {
        if (globalState.autoExtractState.running) {
          console.log(
            "🔄 [AutoExtract] Resuming auto-extraction loop after page reload"
          );
          autoExtractLoop();
        }
      }, 2000);
    } catch (error) {
      console.error(
        "❌ [AutoExtract] Error restoring auto-extraction state:",
        error
      );
      localStorage.removeItem("W2N_autoExtractState"); // Clean up invalid state
    }

}

// =============================================================================
// MAIN USER INTERFACE PANEL
// =============================================================================

function createUI() {
if (globalState.notionPanel) {
console.log("🎨 UI already exists, skipping creation");
return;
}

    console.log("🎨 Creating UI...");
    debug("🎨 Creating UI");

    try {
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
      box-shadow: 0 10px 25px rgba(0, 0, 0, 0.15);
      z-index: 10000;
      font-family: system-ui, -apple-system, sans-serif;
      font-size: 14px;
      user-select: none;
      opacity: 0.95;
      transition: opacity 0.2s ease;
    `;

      // Add hover effect for better interaction
      panel.addEventListener("mouseenter", () => {
        panel.style.opacity = "1";
      });

      panel.addEventListener("mouseleave", () => {
        panel.style.opacity = "0.95";
      });

      panel.innerHTML = `
      <div id="w2n-header" style="padding: 16px; border-bottom: 1px solid #e5e7eb; background: #f9fafb; border-radius: 8px 8px 0 0; cursor: move; position: relative;">
        <div style="display: flex; justify-content: space-between; align-items: center;">
          <h3 style="margin: 0; font-size: 16px; color: #1f2937; display: flex; align-items: center; gap: 8px;">
            📚 ServiceNow to Notion
            <span style="font-size: 12px; color: #6b7280; font-weight: normal;">⇄ drag to move</span>
          </h3>
          <button id="w2n-close" style="background: none; border: none; font-size: 18px; cursor: pointer; color: #6b7280; padding: 4px; line-height: 1;">×</button>
        </div>
      </div>

      <div style="padding: 16px;">
        <!-- Database Selection -->
        <div style="margin-bottom: 16px;">
          <label style="display: block; margin-bottom: 5px; font-weight: 500;">Database:</label>
          <select id="w2n-database-select" style="width: 100%; padding: 8px; border: 1px solid #d1d5db; border-radius: 4px;">
            <option value="${config.databaseId}">${config.databaseName}</option>
          </select>
          <div id="w2n-selected-database-label" style="margin-top:8px;font-size:12px;color:#6b7280;">Database: ${
            config.databaseName || "(no database)"
          }</div>
          <div style="margin-top:8px; display:flex; gap:6px; align-items:center; flex-wrap:wrap;">
              <button id="w2n-refresh-dbs" style="font-size:11px; padding:4px 6px; border:1px solid #d1d5db; border-radius:4px; background:white; cursor:pointer;">Refresh</button>
              <button id="w2n-search-dbs" style="font-size:11px; padding:4px 6px; border:1px solid #d1d5db; border-radius:4px; background:white; cursor:pointer;">Search</button>
              <button id="w2n-get-db" style="font-size:11px; padding:4px 6px; border:1px solid #d1d5db; border-radius:4px; background:white; cursor:pointer;">By ID</button>
              <button id="w2n-configure-mapping" style="font-size:11px; padding:6px 8px; border:1px solid #10b981; border-radius:4px; background:#10b981; color:white; cursor:pointer;">Configure Property Mapping</button>
            </div>
        </div>

        <!-- Capture Modes -->
        <div style="display: grid; gap: 8px; margin-bottom: 16px;">
          <button id="w2n-capture-page" style="width: 100%; padding: 12px; background: #10b981; color: white; border: none; border-radius: 6px; cursor: pointer; font-weight: 500;">
            📄 Save Current Page
          </button>

          <button id="w2n-capture-description" style="width: 100%; padding: 12px; background: #3b82f6; color: white; border: none; border-radius: 6px; cursor: pointer; font-weight: 500;">
            📖 Download PDF
          </button>
        </div>

        <!-- AutoExtract Section -->
        <div style="border-top: 1px solid #e5e7eb; padding-top: 16px;">
          <div style="display: flex; align-items: center; margin-bottom: 12px;">
            <span style="font-size: 16px; margin-right: 8px;">🤖</span>
            <h4 style="margin: 0; font-size: 14px; font-weight: 500;">AutoExtract Multi-Page</h4>
          </div>

          <div style="margin-bottom: 12px; display:flex; gap:8px; align-items:center; flex-wrap:wrap;">
            <div style="display:flex; align-items:center; gap:8px;">
              <label style="display: block; margin-bottom: 0; font-size: 12px;">Max Pages:</label>
              <input type="number" id="w2n-max-pages" value="500" min="1" max="500"
                     style="width: 60px; padding: 4px; border: 1px solid #d1d5db; border-radius: 4px;">
            </div>
            <div style="flex:1; min-width:180px;">
              <button id="w2n-select-next-element" style="width:100%; padding:6px; background:#2563eb; color:white; border:none; border-radius:4px; cursor:pointer; font-size:12px;">Select "Next Page" Element</button>
            </div>
          </div>

          <div id="w2n-autoextract-controls">
            <button id="w2n-start-autoextract" style="width: 100%; padding: 10px; background: #f59e0b; color: white; border: none; border-radius: 6px; cursor: pointer; font-weight: 500;">
              Start AutoExtract
            </button>
            <div style="display: flex; gap: 8px; margin-top: 8px;">
              <button id="w2n-open-icon-cover" style="flex: 1; padding: 8px; background: #6b7280; color: white; border: none; border-radius: 6px; cursor: pointer; font-size: 13px;">Icon & Cover</button>
              <button id="w2n-diagnose-autoextract" style="flex: 1; padding: 8px; background: #0ea5e9; color: white; border: none; border-radius: 6px; cursor: pointer; font-size: 13px;">🔍 Diagnose</button>
            </div>
          </div>
        </div>

        <!-- Settings Toggle -->
        <div style="border-top: 1px solid #e5e7eb; padding-top: 16px; margin-top: 16px;">
          <button id="w2n-toggle-settings" style="background: none; border: none; cursor: pointer; color: #6b7280; font-size: 12px;">
            ⚙️ Advanced Settings
          </button>
        </div>
      </div>
    `;

      document.body.appendChild(panel);
      globalState.notionPanel = panel;

      // Add drag functionality
      makePanelDraggable(panel);

      // Bind UI events immediately after creating panel
      bindUIEvents();

      // Check for and restore auto-extraction state after page reload
      restoreAutoExtractState();

      // Populate databases separately (non-blocking)
      loadDatabases(panel)
        .then(() => {
          debug("📥 Database loading finished");
        })
        .catch((error) => {
          debug("❌ Database loading failed:", error);
          showToast("Database loading failed - UI still functional", 3000);
        });
    } catch (error) {
      console.error("❌ Error in createUI():", error);
      showToast("Failed to create UI panel", 3000);
    }

}

function bindUIEvents() {
const panel = globalState.notionPanel;
if (!panel) {
debug("❌ bindUIEvents: No panel found");
return;
}

    debug("🔗 Binding UI events...");

    // Close button
    const closeBtn = panel.querySelector("#w2n-close");
    if (closeBtn) {
      closeBtn.onclick = () => {
        debug("🔲 Close button clicked");
        panel.remove();
        globalState.notionPanel = null;
      };
    } else {
      debug("❌ Close button not found");
    }

    // Capture modes
    const capturePageBtn = panel.querySelector("#w2n-capture-page");
    if (capturePageBtn) {
      capturePageBtn.onclick = debounce(() => {
        debug("📄 Capture page button clicked");
        captureCurrentPage();
      });
    } else {
      debug("❌ Capture page button not found");
    }

    const captureDescBtn = panel.querySelector("#w2n-capture-description");
    if (captureDescBtn) {
      captureDescBtn.onclick = debounce(() => {
        console.log("📖 [ServiceNow] Download PDF button clicked");
        debug("📖 Download PDF button clicked");
        // Trigger ServiceNow's PDF export - default to 'Save topic'
        triggerPdfExport("singlePdf");
      });
    } else {
      debug("❌ Capture description button not found");
    }

    // Database management buttons
    const refreshBtn = panel.querySelector("#w2n-refresh-dbs");
    if (refreshBtn) {
      refreshBtn.onclick = () => {
        debug("🔄 Refresh databases button clicked");
        refreshDatabases();
      };
    } else {
      debug("❌ Refresh databases button not found");
    }

    const searchBtn = panel.querySelector("#w2n-search-dbs");
    if (searchBtn) {
      searchBtn.onclick = () => {
        debug("🔍 Search databases button clicked");
        searchDatabases();
      };
    } else {
      debug("❌ Search databases button not found");
    }

    // Configure Property Mapping button in main panel
    const mappingBtn = panel.querySelector("#w2n-configure-mapping");
    if (mappingBtn) {
      mappingBtn.onclick = () => {
        debug("⚙️ Configure Property Mapping (panel) clicked");
        try {
          showPropertyMappingModal();
        } catch (e) {
          console.error("❌ Failed to open property mapping modal:", e);
          showToast("Failed to open Property Mapping", 3000);
        }
      };
    } else {
      debug("❌ Configure Property Mapping button not found in panel");
    }

    const getDbBtn = panel.querySelector("#w2n-get-db");
    if (getDbBtn) {
      getDbBtn.onclick = () => {
        debug("🆔 Get database by ID button clicked");
        getDatabaseById();
      };
    } else {
      debug("❌ Get database by ID button not found");
    }

    // AutoExtract controls
    const autoExtractBtn = panel.querySelector("#w2n-start-autoextract");
    if (autoExtractBtn) {
      console.log("✅ AutoExtract button found:", autoExtractBtn);

      // Check if button is actually clickable
      const isClickable =
        autoExtractBtn.offsetParent !== null &&
        !autoExtractBtn.disabled &&
        getComputedStyle(autoExtractBtn).pointerEvents !== "none";
      console.log("🖱️ Button is clickable:", isClickable);

      // Remove any existing event handlers
      autoExtractBtn.onclick = null;

      // Use addEventListener for better compatibility
      autoExtractBtn.addEventListener(
        "click",
        function (event) {
          console.log("🤖 W2N-SN2N: AutoExtract button clicked!", event);
          console.log("🤖 Event target:", event.target);
          console.log("🤖 Current target:", event.currentTarget);

          // Prevent any potential event conflicts
          event.preventDefault();
          event.stopPropagation();

          // Add immediate visual feedback
          this.style.backgroundColor = "#dc2626"; // Red feedback
          setTimeout(() => {
            this.style.backgroundColor = "#f59e0b"; // Back to orange
          }, 200);

          try {
            debug("🤖 AutoExtract toggle button clicked");
            console.log("🤖 About to call toggleAutoExtract()");
            toggleAutoExtract();
            console.log("🤖 toggleAutoExtract() completed");
          } catch (error) {
            console.error("❌ Error in toggleAutoExtract:", error);
            showToast(`AutoExtract error: ${error.message}`, 5000);
          }
        },
        true
      ); // Use capture phase

      console.log("✅ AutoExtract button event handler attached");
    } else {
      console.error(
        "❌ AutoExtract button not found! Available buttons:",
        Array.from(panel.querySelectorAll("button")).map((btn) => ({
          id: btn.id,
          text: btn.textContent?.trim(),
        }))
      );
      debug("❌ AutoExtract button not found");
    }

    const selectNextBtn = panel.querySelector("#w2n-select-next-element");
    if (selectNextBtn) {
      selectNextBtn.onclick = () => {
        debug("🎯 Select next page element button clicked");
        selectNextPageElement();
      };
    } else {
      debug("❌ Select next page element button not found");
    }

    // Settings toggle
    const settingsToggle = panel.querySelector("#w2n-toggle-settings");
    if (settingsToggle) {
      settingsToggle.onclick = () => {
        debug("⚙️ Settings toggle clicked - opening modal");
        injectAdvancedSettingsModal();
      };
    } else {
      debug("❌ Settings toggle button not found");
    }

    // Icon & Cover launcher
    const iconCoverBtn = panel.querySelector("#w2n-open-icon-cover");
    if (iconCoverBtn) {
      iconCoverBtn.onclick = () => {
        debug("🎨 Icon & Cover button clicked");
        injectIconCoverModal();
      };
    } else {
      debug("❌ Icon & Cover button not found");
    }

    // AutoExtract Diagnose button
    const diagnoseBtn = panel.querySelector("#w2n-diagnose-autoextract");
    if (diagnoseBtn) {
      diagnoseBtn.onclick = () => {
        debug("🔍 AutoExtract diagnose button clicked");
        const diagnostics = runAutoExtractDiagnostics();
        console.log("🔍 AutoExtract Diagnostics:", diagnostics);

        const message = `AutoExtract Diagnostics:


• Status: ${diagnostics.reason}
• Saved Selector: ${diagnostics.savedSelector}
• Default ServiceNow Selector: ${diagnostics.defaultSelector}
• Final Selector Used: ${diagnostics.finalSelector}
• Has Stored Element: ${diagnostics.hasStoredElement}
• Element Valid: ${diagnostics.hasValidStoredElement}
• Element Visible: ${diagnostics.elementIsVisible}

${
!diagnostics.canStart
? '\n⚠️ To fix: The system will automatically use the ServiceNow next page selector if you\'re on a ServiceNow docs page, or click "Select Next Page Element" to choose manually.'
: "✅ Ready to start AutoExtract!"
}`;

        alert(message);
      };
    } else {
      debug("❌ AutoExtract diagnose button not found");
    }

    debug("✅ UI events binding complete");

}

// =============================================================================
// UI ACTION HANDLERS
// =============================================================================

function refreshDatabases() {
globalState.currentDatabaseList = [];
GM_setValue("w2n_db_list", null);
if (globalState.notionPanel) {
loadDatabases(globalState.notionPanel);
}
showToast("Refreshing databases...", 2000);
}

function searchDatabases() {
const query = prompt("Enter search query for databases:");
if (query?.trim()) {
showToast("Database search not implemented yet", 2000);
// TODO: Implement database search
}
}

function getDatabaseById() {
const dbId = prompt("Enter Database ID:");
if (dbId?.trim()) {
config.databaseId = dbId.trim();
config.databaseName = "Custom Database";
GM_setValue("notionConfig", config);
showToast("Database ID updated", 2000);

      if (globalState.notionPanel) {
        const select = globalState.notionPanel.querySelector(
          "#w2n-database-select"
        );
        if (select) {
          select.innerHTML = `<option value="${config.databaseId}" selected>${config.databaseName}</option>`;
        }
      }
    }

}

// Helper function to extract readable content from iframe srcdoc attributes
function extractContentFromIframes(containerElement) {
if (!containerElement) return "";

    const iframes = containerElement.querySelectorAll("iframe[srcdoc]");
    let extractedContent = "";

    console.log(
      `📄 [ServiceNow] Found ${iframes.length} iframes with srcdoc content`
    );

    iframes.forEach((iframe, index) => {
      const srcdoc = iframe.getAttribute("srcdoc");
      if (srcdoc) {
        // Decode HTML entities in srcdoc
        const tempDiv = document.createElement("div");
        tempDiv.innerHTML = srcdoc;

        // Extract text content from the decoded HTML
        const iframeDoc = tempDiv.innerHTML;
        const tempContainer = document.createElement("div");
        tempContainer.innerHTML = iframeDoc;

        // Remove script tags and other unwanted elements
        const scripts = tempContainer.querySelectorAll(
          "script, style, meta, link"
        );
        scripts.forEach((el) => el.remove());

        // Extract meaningful content - look for body or main content areas
        const body = tempContainer.querySelector("body") || tempContainer;
        const textContent = body.innerHTML || body.textContent;

        if (textContent && textContent.trim().length > 50) {
          extractedContent += `<div class="iframe-content-${
            index + 1
          }">\n${textContent}\n</div>\n\n`;
          console.log(
            `📄 [ServiceNow] Extracted content from iframe ${
              index + 1
            }, length: ${textContent.length}`
          );
        }
      }
    });

    // If no iframe content found, return the original HTML
    if (!extractedContent.trim()) {
      console.log(
        "📄 [ServiceNow] No iframe content extracted, using original HTML"
      );
      return containerElement.outerHTML;
    }

    return extractedContent;

}

async function captureDescription(skipAutoExtractPopup = false) {
console.log("🚀 [ServiceNow] captureDescription() function started");
try {
debug("📖 Starting book description capture...");
console.log("📖 [ServiceNow] Starting book description capture...");
showToast("Starting book description capture...", 3000);

      // Wait for workflow to be available
      console.log("⏳ [ServiceNow] Checking for Universal Workflow...");
      if (!(await checkWorkflowAvailability())) {
        console.error("❌ [ServiceNow] Universal Workflow not available");
        showToast("❌ Universal Workflow not available", 5000);
        return;
      }
      console.log("✅ [ServiceNow] Universal Workflow is available");

      // Configure workflow
      console.log("⚙️ [ServiceNow] Configuring workflow...");
      const workflowConfig = {
        proxyUrl: config.proxyUrl,
        contentFormat: "html",
        debugMode: config.debugMode,
      };
      console.log("⚙️ [ServiceNow] Workflow config:", workflowConfig);

      await callWorkflowMethod("configure", workflowConfig);
      debug("✅ Workflow configured for book capture");
      console.log("✅ [ServiceNow] Workflow configured for book capture");

      // Extract book cover image
      const coverSelector =
        "#maincontentid > div > div:nth-child(2) > div.Paper---root---MCcnW > div > div.Book---displayBlock---gGkwz > section > img";
      const coverElement = document.querySelector(coverSelector);
      let bookCoverHtml = "";
      let coverImageData = null;

      if (coverElement) {
        const coverSrc = coverElement.src || coverElement.getAttribute("src");
        if (coverSrc) {
          // Prepare cover image for download and upload
          coverImageData = {
            url: coverSrc,
            alt: "Book Cover",
            filename: "book-cover.jpg",
          };

          // Create placeholder HTML that will be replaced with uploaded image
          bookCoverHtml = `<img src="${coverSrc}" alt="Book Cover" style="max-width: 300px; height: auto;">`;
          debug("🖼️ Book Cover found:", coverSrc);
          console.log(
            "🖼️ [ServiceNow] Book cover prepared for upload:",
            coverImageData.filename
          );
        }
      }

      // Extract formatted book info
      const bookInfoSelector =
        "#maincontentid > div > div:nth-child(2) > div.Paper---root---MCcnW > div > div.Book---displayBlock---gGkwz > section > div > div.BookHeader---extrasInfos---DJcvw > div:nth-child(1)";
      const bookInfoElement = document.querySelector(bookInfoSelector);
      let bookInfoHtml = "<p>Book information not found</p>";

      if (bookInfoElement) {
        // Get the raw HTML and clean up duplicate time information
        let rawBookInfo = bookInfoElement.outerHTML;

        // Remove duplicate time patterns like "4h 15m4hours 15minutes"
        // Pattern: digit(h) digit(m) followed by same digits + "hours" + digit + "minutes"
        rawBookInfo = rawBookInfo.replace(
          /(\d+h\s*\d+m)\d+hours\s*\d+minutes/gi,
          "$1"
        );

        // Remove patterns like "4h 15m4hours 15minutes" (no space)
        rawBookInfo = rawBookInfo.replace(
          /(\d+h\s*\d+m)(\d+)hours\s*(\d+)minutes/gi,
          "$1"
        );

        // Remove "By: Author - 4h 15m4hours 15minutes" type duplicates
        rawBookInfo = rawBookInfo.replace(
          /(By:\s*[^-]+-\s*)(\d+h\s*\d+m)\d+hours\s*\d+minutes/gi,
          "$1$2"
        );

        // Also clean up other duplicate patterns
        rawBookInfo = rawBookInfo.replace(/(\d+h\s*\d+m)\s*\1/gi, "$1"); // Remove exact duplicates
        rawBookInfo = rawBookInfo.replace(
          /(\d+\s*hours?\s*\d+\s*minutes?)\s*\1/gi,
          "$1"
        ); // Remove "X hours Y minutes" duplicates

        // Remove any remaining time format duplications
        rawBookInfo = rawBookInfo.replace(
          /(\d+h\s*\d+m)[^\d]*(\d+hours?\s*\d+minutes?)/gi,
          "$1"
        );

        // Additional step: Remove specific duplicate in span:nth-child(2) within the paragraph
        // Create a DOM parser to manipulate the HTML structure
        const tempDiv = document.createElement("div");
        tempDiv.innerHTML = rawBookInfo;

        // Target the specific span:nth-child(2) within p:nth-child(1)
        const duplicateSpan = tempDiv.querySelector(
          "div:nth-child(1) > p:nth-child(1) > span:nth-child(2)"
        );
        if (duplicateSpan) {
          console.log(
            "🗑️ [ServiceNow] Found duplicate span, removing:",
            duplicateSpan.textContent
          );
          duplicateSpan.remove();
          rawBookInfo = tempDiv.innerHTML;
          debug("🗑️ Removed duplicate span:nth-child(2) from book info");
        }

        bookInfoHtml = rawBookInfo;
        debug("ℹ️ Book Info captured and cleaned");
        console.log("ℹ️ [ServiceNow] Book info cleaned for duplicates");
      } else {
        debug("⚠️ Book Info element not found");
      }

      // Extract table of contents
      const tocSelector = "#panel\\:r7\\:0 > div > div > nav > ul";
      let tocElement = document.querySelector(tocSelector);
      let tocHtml = "<p>Table of contents not available</p>";

      // If first selector doesn't work, try alternative selectors
      if (!tocElement) {
        const altSelectors = [
          '[id^="panel:"][id$=":0"] ul',
          "nav ul",
          ".toc ul",
          '[role="navigation"] ul',
        ];

        for (const altSelector of altSelectors) {
          tocElement = document.querySelector(altSelector);
          if (tocElement) {
            debug("📋 Found TOC with alternative selector:", altSelector);
            break;
          }
        }
      }

      if (tocElement) {
        tocHtml = tocElement.outerHTML;
        debug("📋 Table of Contents captured");
      } else {
        debug("⚠️ Table of Contents not found with any selector");
      }

      // Extract overview content from epubjs-view elements
      const overviewSelectors = [
        ".epubjs-view-0",
        '[class^="epubjs-view-"]',
        ".epubjs-view",
        '[class*="epubjs"]',
        ".epub-view",
        '[class*="epub"]',
      ];

      let overviewHtml = "<p>Overview content not found</p>";

      for (const selector of overviewSelectors) {
        const overviewElements = document.querySelectorAll(selector);
        if (overviewElements.length > 0) {
          console.log(
            "📄 [ServiceNow] Found overview with selector:",
            selector,
            "elements:",
            overviewElements.length
          );
          const overviewParts = Array.from(overviewElements).map(
            (el) => extractContentFromIframes(el) || el.outerHTML
          );
          overviewHtml = overviewParts.join("\n");
          console.log("📄 [ServiceNow] Overview content processed");
          break;
        }
      }

      if (overviewHtml === "<p>Overview content not found</p>") {
        console.log(
          "⚠️ [ServiceNow] No overview content found with any selector"
        );
      }

      // Click Overview button and wait for content
      const overviewButtonSelector = "#tab\\:ra\\:1 > span";
      let overviewButton = document.querySelector(overviewButtonSelector);

      // Try alternative selectors if the primary one fails
      if (!overviewButton) {
        const altButtonSelectors = [
          '[id^="tab:"][id$=":1"] span',
          'button[role="tab"]:contains("Overview")',
          '[aria-label*="Overview"]',
          'span:contains("Overview")',
        ];

        for (const altSelector of altButtonSelectors) {
          if (altSelector.includes(":contains")) {
            // Handle :contains manually
            const elements = document.querySelectorAll("span");
            overviewButton = Array.from(elements).find((el) =>
              el.textContent.toLowerCase().includes("overview")
            );
            if (overviewButton) {
              debug("🔘 Found Overview button with text search");
              break;
            }
          } else {
            overviewButton = document.querySelector(altSelector);
            if (overviewButton) {
              debug("🔘 Found Overview button with selector:", altSelector);
              break;
            }
          }
        }
      }

      if (overviewButton) {
        debug("🔘 Clicking Overview button...");
        console.log(
          "🔘 [ServiceNow] Clicking Overview button and waiting for content..."
        );
        overviewButton.click();
        await new Promise((resolve) => setTimeout(resolve, 3000)); // Wait longer for content to load
        console.log(
          "🔘 [ServiceNow] Wait complete, attempting to capture description and main content"
        );

        // Capture description text that appears after Overview tab is clicked
        const descriptionSelector =
          "#panel\\:r1\\:1 > span:nth-child(1) > span";
        const descriptionElement = document.querySelector(descriptionSelector);
        let descriptionText = "";

        if (descriptionElement) {
          descriptionText =
            descriptionElement.textContent ||
            descriptionElement.innerText ||
            "";
          console.log(
            "📄 [ServiceNow] Found description text:",
            descriptionText.substring(0, 100) + "..."
          );
          debug("📄 Description text captured from Overview panel");
        } else {
          console.log(
            "⚠️ [ServiceNow] Description text not found at selector:",
            descriptionSelector
          );
          debug("⚠️ Description text element not found");
        }

        // Add description text to overview content if found
        if (descriptionText.trim()) {
          overviewHtml = `<p><strong>Description:</strong> ${descriptionText}</p>\n${overviewHtml}`;
          console.log(
            "📄 [ServiceNow] Description text added to overview content"
          );
        }
      } else {
        debug("⚠️ Overview button not found, proceeding without clicking");
        console.log(
          "⚠️ [ServiceNow] Overview button not found, proceeding without clicking"
        );
      }

      // Extract main book content (full content that appears after clicking Overview)
      // This should capture the detailed book content that loads after the Overview button is clicked
      const mainContentSelector =
        'main[role="main"]#epubmain[tabindex="0"][aria-label="Book Content"]';
      let mainContentElement = document.querySelector(mainContentSelector);
      let mainContentHtml = "<p>Main book content not available</p>";

      // Try alternative selectors specifically for full book content
      if (!mainContentElement) {
        const altMainSelectors = [
          "main#epubmain",
          'main[role="main"]',
          "#epubmain",
          '[aria-label="Book Content"]',
          '[class^="epubjs-view-"]', // epub.js viewer content
          ".epubjs-view",
          '[class*="epub"]',
          '[id*="epub"]',
          "main",
          ".epub-content",
          ".book-content",
        ];

        for (const altSelector of altMainSelectors) {
          mainContentElement = document.querySelector(altSelector);
          if (mainContentElement) {
            debug(
              "📖 Found main content with alternative selector:",
              altSelector
            );
            console.log(
              "📖 [ServiceNow] Found main content with selector:",
              altSelector
            );
            break;
          }
        }
      }

      if (mainContentElement) {
        // Extract content from iframes first, fall back to outer HTML
        console.log(
          "📖 [ServiceNow] Processing full book content with iframe extraction"
        );

        // Prioritize iframe content extraction for Full Content section
        const iframeContent = extractContentFromIframes(mainContentElement);
        if (iframeContent) {
          mainContentHtml = iframeContent;
          console.log(
            "📖 [ServiceNow] Successfully extracted iframe content for Full Content section"
          );
        } else {
          mainContentHtml = mainContentElement.outerHTML;
          console.log(
            "📖 [ServiceNow] No iframe content found, using element HTML"
          );
        }

        // Convert Italic class elements to proper italic formatting
        mainContentHtml = convertItalicClassToItalicText(mainContentHtml);

        // Convert Bold class elements to proper bold formatting
        mainContentHtml = convertBoldClassToBoldText(mainContentHtml);

        // Filter out trademark symbols before markdown conversion
        mainContentHtml = filterTrademarkSymbols(mainContentHtml);

        // Replace images in tables with emojis for better text separation
        mainContentHtml = replaceTableImagesWithEmojis(mainContentHtml);

        // Style table headers with blue background
        mainContentHtml = styleTableHeaders(mainContentHtml);

        // Remove table search labels (DataTables filter elements)
        mainContentHtml = removeTableSearchLabels(mainContentHtml);

        // Convert markdown-style italic formatting to HTML
        mainContentHtml = convertMarkdownItalicToHtml(mainContentHtml);
        debug("📖 Main book content captured");
        console.log(
          "📖 [ServiceNow] Full book content processed, length:",
          mainContentHtml.length
        );
        console.log(
          "📖 [ServiceNow] Full content preview:",
          mainContentHtml.substring(0, 300) + "..."
        );
      } else {
        debug("⚠️ Main book content not found with any selector");
        console.log(
          "⚠️ [ServiceNow] Full book content not found with any selector"
        );
      }

      // Apply italic class conversion to all content parts
      tocHtml = convertItalicClassToItalicText(tocHtml);
      overviewHtml = convertItalicClassToItalicText(overviewHtml);
      bookInfoHtml = convertItalicClassToItalicText(bookInfoHtml);

      // Apply bold class conversion to all content parts
      tocHtml = convertBoldClassToBoldText(tocHtml);
      overviewHtml = convertBoldClassToBoldText(overviewHtml);
      bookInfoHtml = convertBoldClassToBoldText(bookInfoHtml);

      // Filter out trademark symbols before markdown conversion
      tocHtml = filterTrademarkSymbols(tocHtml);
      overviewHtml = filterTrademarkSymbols(overviewHtml);
      bookInfoHtml = filterTrademarkSymbols(bookInfoHtml);

      // Replace images in tables with emojis for better text separation
      tocHtml = replaceTableImagesWithEmojis(tocHtml);
      overviewHtml = replaceTableImagesWithEmojis(overviewHtml);
      bookInfoHtml = replaceTableImagesWithEmojis(bookInfoHtml);

      // Style table headers with blue background
      tocHtml = styleTableHeaders(tocHtml);
      overviewHtml = styleTableHeaders(overviewHtml);
      bookInfoHtml = styleTableHeaders(bookInfoHtml);

      // Remove table search labels (DataTables filter elements)
      tocHtml = removeTableSearchLabels(tocHtml);
      overviewHtml = removeTableSearchLabels(overviewHtml);
      bookInfoHtml = removeTableSearchLabels(bookInfoHtml);

      // Apply markdown italic conversion to all content parts
      tocHtml = convertMarkdownItalicToHtml(tocHtml);
      overviewHtml = convertMarkdownItalicToHtml(overviewHtml);
      bookInfoHtml = convertMarkdownItalicToHtml(bookInfoHtml);

      // Build complete page content with proper structure
      const contentParts = [
        bookCoverHtml,
        bookInfoHtml,
        "<h3>📚 Contents</h3>",
        tocHtml,
        "<h3>📓 Overview</h3>",
        overviewHtml,
        mainContentHtml,
      ];

      console.log("📋 [ServiceNow] Content parts breakdown:");
      console.log("  📖 Book Cover HTML length:", bookCoverHtml.length);
      console.log("  ℹ️ Book Info HTML length:", bookInfoHtml.length);
      console.log("  📚 TOC HTML length:", tocHtml.length);
      console.log("  📓 Overview HTML length:", overviewHtml.length);
      console.log("  📖 Main Content HTML length:", mainContentHtml.length);

      const fullContentHtml = contentParts.join("\n\n");
      console.log(
        "📋 [ServiceNow] Total content HTML length:",
        fullContentHtml.length
      );

      // Create metadata for properties using extractServiceNowMetadata() as base
      const metadata = extractServiceNowMetadata();

      // Override with description-specific properties

      // Extract additional database properties
      const databaseProperties = extractDatabaseProperties();

      // Update metadata with extracted properties (prefer extracted values over defaults)

      // Add hasFigureImage property
      metadata.hasFigureImage = databaseProperties.hasFigureImage || false;
      console.log(
        `🖼️ [ServiceNow] Setting hasFigureImage: ${metadata.hasFigureImage}`
      );

      // Add hasVideos property
      metadata.hasVideos = databaseProperties.hasVideos || false;

      // Add source property
      metadata.source = "ServiceNow.com/docs";
      console.log(`📍 [ServiceNow] Setting source: ${metadata.source}`);

      // Add version property
      metadata.version = databaseProperties.version || "";
      console.log(`📋 [ServiceNow] Setting version: "${metadata.version}"`);

      // Add updated property
      metadata.updated = databaseProperties.updated || "";
      console.log(`📅 [ServiceNow] Setting updated: "${metadata.updated}"`);

      // Add currentReleaseURL property
      metadata.currentReleaseURL = databaseProperties.currentReleaseURL || "";
      console.log(
        `🔗 [ServiceNow] Setting currentReleaseURL: "${metadata.currentReleaseURL}"`
      );

      debug("🎯 Properties to set:", metadata);
      console.log("🎯 [ServiceNow] Final Properties to set:", metadata);

      // Process content through workflow
      console.log("🔄 [ServiceNow] Processing content through workflow...");
      console.log(
        "🔄 [ServiceNow] Content length:",
        fullContentHtml.length,
        "characters"
      );

      // Prepare images array with book cover
      const images = coverImageData ? [coverImageData] : [];
      console.log("🖼️ [ServiceNow] Images to upload:", images.length);
      if (coverImageData) {
        console.log("🖼️ [ServiceNow] Cover image:", coverImageData.filename);
      }

      // Allow user to choose Unsplash cover (optional)
      let selectedUnsplashCover = null;
      const showUnsplashModal = confirm(
        "Would you like to select a custom Unsplash cover for this book? (Click Cancel to use the book cover)"
      );

      if (showUnsplashModal) {
        console.log("🖼️ [ServiceNow] Opening Unsplash cover selection...");
        try {
          selectedUnsplashCover = await new Promise((resolve) => {
            // Create a simple modal for Unsplash cover selection
            const modal = document.createElement("div");
            modal.style.cssText = `
              position: fixed; top: 0; left: 0; width: 100%; height: 100%;
              background: rgba(0,0,0,0.8); z-index: 10000; display: flex;
              align-items: center; justify-content: center;
            `;

            const content = document.createElement("div");
            content.style.cssText = `
              background: white; padding: 24px; border-radius: 12px;
              max-width: 800px; max-height: 80vh; overflow: auto;
              box-shadow: 0 20px 60px rgba(0,0,0,0.4);
            `;

            content.innerHTML = `
              <h2 style="margin: 0 0 16px 0; color: #333;">Select Unsplash Cover</h2>
              <div style="margin-bottom: 16px;">
                <input id="unsplash-search-input" placeholder="Search for images..."
                       style="width: 100%; padding: 12px; border: 1px solid #ddd; border-radius: 8px; font-size: 16px;">
              </div>
              <div id="unsplash-cat-container" style="display: flex; gap: 8px; margin-bottom: 16px; flex-wrap: wrap;"></div>
              <div id="unsplash-images" style="display: grid; grid-template-columns: repeat(auto-fill, minmax(150px, 1fr)); gap: 12px; margin-bottom: 20px; min-height: 300px;"></div>
              <div style="display: flex; gap: 12px; justify-content: flex-end;">
                <button id="cancel-btn" style="padding: 12px 20px; background: #6b7280; color: white; border: none; border-radius: 8px; cursor: pointer;">Cancel</button>
                <button id="select-btn" disabled style="padding: 12px 20px; background: #3b82f6; color: white; border: none; border-radius: 8px; cursor: pointer;">Select Cover</button>
              </div>
            `;

            // Add styles for category buttons
            content.querySelectorAll(".unsplash-cat").forEach((btn) => {
              btn.style.cssText =
                "padding: 8px 12px; border: 1px solid #ddd; background: #f9f9f9; border-radius: 6px; cursor: pointer;";
            });

            modal.appendChild(content);
            document.body.appendChild(modal);

            let selectedImageUrl = null;
            const selectBtn = content.querySelector("#select-btn");
            const cancelBtn = content.querySelector("#cancel-btn");
            const searchInput = content.querySelector("#unsplash-search-input");
            const imagesContainer = content.querySelector("#unsplash-images");

            // Populate category buttons from shared keywords
            const catContainer = content.querySelector(
              "#unsplash-cat-container"
            );
            if (catContainer) {
              UNSPLASH_KEYWORDS.forEach((term) => {
                const btn = document.createElement("button");
                btn.className = "unsplash-cat";
                btn.dataset.term = term;
                btn.textContent = term.charAt(0).toUpperCase() + term.slice(1);
                btn.style.cssText =
                  "padding: 8px 12px; border: 1px solid #ddd; background: #f9f9f9; border-radius: 6px; cursor: pointer;";
                btn.onclick = () => searchImages(term);
                catContainer.appendChild(btn);
              });
            }

            // Handle image selection
            function selectImage(url, imgElement) {
              // Remove previous selection
              imagesContainer.querySelectorAll("img").forEach((img) => {
                img.style.border = "3px solid transparent";
              });

              // Highlight selected image
              imgElement.style.border = "3px solid #3b82f6";
              selectedImageUrl = url;
              selectBtn.disabled = false;
              selectBtn.style.background = "#3b82f6";

              console.log("🖼️ [ServiceNow] Image selected:", url);
            }

            // Handle search
            async function searchImages(query) {
              imagesContainer.innerHTML =
                '<div style="grid-column: 1/-1; text-align: center; padding: 40px; color: #666;">Searching...</div>';

              try {
                const response = await apiCall(
                  "GET",
                  `/api/unsplash/search?query=${encodeURIComponent(query)}`
                );

                if (!response || !response.success) {
                  console.error(
                    "❌ [ServiceNow] API returned failure:",
                    response
                  );
                  imagesContainer.innerHTML =
                    '<div style="grid-column: 1/-1; text-align: center; padding: 40px; color: #666;">API error</div>';
                  return;
                }

                const photos = response?.photos || response?.images || [];

                if (photos.length === 0) {
                  imagesContainer.innerHTML =
                    '<div style="grid-column: 1/-1; text-align: center; padding: 40px; color: #666;">No images found</div>';
                  return;
                }

                imagesContainer.innerHTML = "";
                photos.forEach((photo, index) => {
                  const imgWrapper = document.createElement("div");
                  imgWrapper.style.cssText =
                    "cursor: pointer; border-radius: 8px; overflow: hidden; aspect-ratio: 1; position: relative;";

                  const img = document.createElement("img");
                  // Use the simplified proxy format: photo.thumb instead of photo.urls.small
                  img.src = photo.thumb || photo.urls?.small || photo.url;
                  img.style.cssText =
                    "width: 100%; height: 100%; object-fit: cover; border: 3px solid transparent; transition: all 0.2s;";
                  // Use photo.url (regular) instead of photo.urls.regular
                  img.dataset.url =
                    photo.url || photo.urls?.regular || photo.full;

                  img.onclick = () =>
                    selectImage(
                      photo.url || photo.urls?.regular || photo.full,
                      img
                    );

                  imgWrapper.appendChild(img);
                  imagesContainer.appendChild(imgWrapper);
                });

                console.log("🖼️ [ServiceNow] Loaded", photos.length, "images");
              } catch (error) {
                console.error("🖼️ [ServiceNow] Search error:", error);
                imagesContainer.innerHTML =
                  '<div style="grid-column: 1/-1; text-align: center; padding: 40px; color: #666;">Search failed</div>';
              }
            }

            // Event listeners
            cancelBtn.onclick = () => {
              modal.remove();
              resolve(null);
            };

            selectBtn.onclick = () => {
              modal.remove();
              resolve(selectedImageUrl);
            };

            searchInput.addEventListener("keypress", (e) => {
              if (e.key === "Enter") {
                searchImages(e.target.value);
              }
            });

            content.querySelectorAll(".unsplash-cat").forEach((btn) => {
              btn.onclick = () => searchImages(btn.dataset.term);
            });

            // Auto-search on load
            setTimeout(() => {
              searchImages("book education");
            }, 500);
          });

          console.log(
            "🖼️ [ServiceNow] Promise resolved with:",
            selectedUnsplashCover
          );

          if (selectedUnsplashCover) {
            console.log(
              "🖼️ [ServiceNow] User selected Unsplash cover:",
              selectedUnsplashCover
            );
          } else {
            console.log(
              "🖼️ [ServiceNow] User cancelled Unsplash selection, using book cover"
            );
          }
        } catch (error) {
          console.error(
            "🖼️ [ServiceNow] Error with Unsplash selection:",
            error
          );
          selectedUnsplashCover = null;
        }
      } else {
        console.log(
          "🖼️ [ServiceNow] User declined Unsplash selection, using book cover"
        );
      }

      console.log(
        "🖼️ [ServiceNow] Final cover decision - Unsplash:",
        !!selectedUnsplashCover
      );

      // Prepare cover for Notion page cover (Unsplash or book cover)
      const pageCover = selectedUnsplashCover
        ? {
            type: "external",
            url: selectedUnsplashCover,
            alt: "Custom Cover",
          }
        : coverImageData
        ? {
            type: "external",
            url: coverImageData.url,
            alt: coverImageData.alt,
          }
        : null;

      // Always use book cover as page icon (even if Unsplash cover is selected for page cover)
      const pageIcon = coverImageData
        ? {
            type: "external",
            url: coverImageData.url,
            alt: coverImageData.alt,
          }
        : null;

      // Store cover and icon for AutoExtract persistence
      if (!skipAutoExtractPopup) {
        // Only store on first capture, not during AutoExtract
        console.log(
          "💾 [ServiceNow] Storing cover/icon for AutoExtract persistence"
        );
        globalState.autoExtractState.persistedCover = pageCover;
        globalState.autoExtractState.persistedIcon = pageIcon;
        debug("💾 Stored persisted cover:", !!pageCover);
        debug("💾 Stored persisted icon:", !!pageIcon);
      } else {
        // During AutoExtract, use the persisted values
        console.log(
          "🔄 [ServiceNow] Using persisted cover/icon from first capture"
        );
        const finalCover =
          globalState.autoExtractState.persistedCover || pageCover;
        const finalIcon =
          globalState.autoExtractState.persistedIcon || pageIcon;
        debug("🔄 Using persisted cover:", !!finalCover);
        debug("🔄 Using persisted icon:", !!finalIcon);
      }

      console.log(
        "🖼️ [ServiceNow] Page cover:",
        !!pageCover,
        selectedUnsplashCover ? "(Unsplash)" : "(Book Cover)"
      );
      console.log("🖼️ [ServiceNow] Page icon:", !!pageIcon, "(Book Cover)");
      if (selectedUnsplashCover) {
        console.log(
          "🖼️ [ServiceNow] Using Unsplash cover:",
          selectedUnsplashCover
        );
      }

      // Determine final cover and icon to use
      const finalCover = skipAutoExtractPopup
        ? globalState.autoExtractState.persistedCover || pageCover
        : pageCover;
      const finalIcon = skipAutoExtractPopup
        ? globalState.autoExtractState.persistedIcon || pageIcon
        : pageIcon;

      console.log("🖼️ [ServiceNow] Final cover being used:", !!finalCover);
      console.log("🖼️ [ServiceNow] Final icon being used:", !!finalIcon);

      const result = await callWorkflowMethod("processContent", {
        title: extractPageTitle(),
        contentHtml: fullContentHtml,
        url: window.location.href,
        images: images, // Include book cover image for download/upload
        metadata: metadata,
        databaseId: config.databaseId,
        cover: finalCover, // Page cover image (persisted or current)
        icon: finalIcon, // Page icon image (persisted or current)
      });
      console.log("📋 [ServiceNow] Workflow result:", result);

      if (result && result.pageUrl) {
        debug("✅ Book description page created successfully:", result.pageUrl);
        console.log(
          "✅ [ServiceNow] Book description page created successfully:",
          result.pageUrl
        );
        showToast(`✅ Content captured successfully!`, 5000);

        // Show AutoExtract popup after successful capture (only if not called from AutoExtract)
        if (!skipAutoExtractPopup) {
          showAutoExtractPopup();
        }
      } else {
        debug("❌ Failed to create book description page");
        console.log(
          "❌ [ServiceNow] Failed to create book description page, result:",
          result
        );
        showToast("❌ Failed to create book description page", 5000);
      }
    } catch (error) {
      console.error("❌ [ServiceNow] Error in captureDescription():", error);
      console.error("❌ [ServiceNow] Error stack:", error.stack);
      debug("❌ Book capture failed:", error.message);
      showToast(`❌ Book capture failed: ${error.message}`, 5000);
    }
    console.log("🏁 [ServiceNow] captureDescription() function completed");

}

// Helper: Trigger ServiceNow PDF export menu and select option
// option: 'singlePdf' | 'pdfWithChildren' | 'wholeBundlePdf'
function triggerPdfExport(option = "singlePdf") {
try {
debug(`🔧 triggerPdfExport called with option: ${option}`);

      // Find the export menu container
      const exportMenu = document.querySelector(".zDocsExportPdfMenu");
      if (!exportMenu) {
        debug("❌ triggerPdfExport: export menu not found");
        showToast("Export menu not found on this page", 3000);
        return false;
      }

      // Open the dropdown if present (simulate click on the toggle)
      const toggle = exportMenu.querySelector('[data-toggle="dropdown"]');
      if (toggle) {
        try {
          toggle.click();
        } catch (e) {
          // ignore
        }
      }

      // Wait briefly for menu to be present
      setTimeout(() => {
        // Map option to id
        const idMap = {
          singlePdf: "singlePdf",
          pdfWithChildren: "pdfWithChildren",
          wholeBundlePdf: "wholeBundlePdf",
        };

        const targetId = idMap[option] || idMap.singlePdf;
        const menuItem = exportMenu.querySelector(`#${targetId}`);
        if (menuItem) {
          try {
            menuItem.click();
            showToast(
              "Triggered PDF export: " + menuItem.textContent.trim(),
              3000
            );
            debug("✅ triggerPdfExport: clicked menu item", targetId);
          } catch (e) {
            console.error("❌ triggerPdfExport: click failed", e);
            showToast("Failed to trigger PDF export", 3000);
          }
        } else {
          debug("❌ triggerPdfExport: menu item not found for id " + targetId);
          showToast("PDF export option not available", 3000);
        }
      }, 300);

      return true;
    } catch (error) {
      console.error("❌ triggerPdfExport error:", error);
      return false;
    }

}

// =============================================================================
// AUTOEXTRACT POPUP AFTER SUCCESSFUL CAPTURE
// =============================================================================

function showAutoExtractPopup() {
console.log("🤖 [ServiceNow] Showing AutoExtract popup");

    // Check if popup already exists
    if (document.getElementById("w2n-autoextract-popup")) {
      console.log("🤖 [ServiceNow] AutoExtract popup already exists");
      return;
    }

    // Create popup overlay
    const overlay = document.createElement("div");
    overlay.id = "w2n-autoextract-popup";
    overlay.style.cssText = `
      position: fixed;
      top: 0;
      left: 0;
      width: 100%;
      height: 100%;
      background: rgba(0, 0, 0, 0.6);
      z-index: 15000;
      display: flex;
      align-items: center;
      justify-content: center;
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
    `;

    // Create popup panel
    const panel = document.createElement("div");
    panel.style.cssText = `
      background: white;
      border-radius: 12px;
      padding: 24px;
      max-width: 400px;
      width: 90%;
      box-shadow: 0 20px 60px rgba(0, 0, 0, 0.3);
      text-align: center;
    `;

    panel.innerHTML = `
      <div style="margin-bottom: 16px;">
        <div style="font-size: 48px; margin-bottom: 12px;">🤖</div>
        <h3 style="margin: 0 0 8px 0; font-size: 20px; font-weight: 600; color: #1f2937;">
          Continue with AutoExtract?
        </h3>
        <p style="margin: 0; font-size: 14px; color: #6b7280; line-height: 1.4;">
          The current page was captured successfully.<br>
          Would you like to automatically extract the next pages?
        </p>
      </div>

      <div style="margin-bottom: 20px; padding: 12px; background: #f3f4f6; border-radius: 8px; text-align: left;">
        <div style="font-size: 12px; font-weight: 500; color: #374151; margin-bottom: 8px;">
          ⚡ AutoExtract will:
        </div>
        <ul style="margin: 0; padding-left: 16px; font-size: 12px; color: #6b7280; line-height: 1.4;">
          <li>Click the selected "Next Page" button</li>
          <li>Wait for the new page to load</li>
          <li>Capture the content automatically</li>
          <li>Repeat until completion</li>
        </ul>
      </div>

      <div style="display: flex; gap: 12px;">
        <button id="w2n-autoextract-cancel" style="
          flex: 1;
          padding: 12px;
          background: #f3f4f6;
          color: #374151;
          border: none;
          border-radius: 8px;
          font-weight: 500;
          cursor: pointer;
          transition: all 0.2s;
        ">
          Not Now
        </button>
        <button id="w2n-autoextract-start" style="
          flex: 1;
          padding: 12px;
          background: #f59e0b;
          color: white;
          border: none;
          border-radius: 8px;
          font-weight: 500;
          cursor: pointer;
          transition: all 0.2s;
        ">
          Start AutoExtract
        </button>
      </div>
    `;

    overlay.appendChild(panel);
    document.body.appendChild(overlay);

    // Add hover effects
    const cancelBtn = panel.querySelector("#w2n-autoextract-cancel");
    const startBtn = panel.querySelector("#w2n-autoextract-start");

    cancelBtn.onmouseover = () => {
      cancelBtn.style.background = "#e5e7eb";
    };
    cancelBtn.onmouseout = () => {
      cancelBtn.style.background = "#f3f4f6";
    };

    startBtn.onmouseover = () => {
      startBtn.style.background = "#d97706";
    };
    startBtn.onmouseout = () => {
      startBtn.style.background = "#f59e0b";
    };

    // Handle cancel - just close popup
    cancelBtn.onclick = () => {
      console.log("🚫 [ServiceNow] AutoExtract cancelled by user");
      overlay.remove();
    };

    // Handle start AutoExtract
    startBtn.onclick = async () => {
      console.log("🤖 [ServiceNow] AutoExtract selected by user");
      overlay.remove();

      // Check if next page element is already selected
      const savedSelector = getCurrentSelectorForHost();
      const nextPageElement = savedSelector
        ? document.querySelector(savedSelector)
        : globalState.autoExtractState.nextPageElement;

      if (!nextPageElement && !savedSelector) {
        console.log(
          "🎯 [ServiceNow] No next page element selected, showing selector modal"
        );
        showToast("Please select a 'Next Page' element first", 3000);

        // Open the next page selector modal
        openNextPageSelectorModal();

        // Set up a listener to start AutoExtract once element is selected
        const checkForSelection = setInterval(() => {
          const newSavedSelector = getCurrentSelectorForHost();
          const newNextPageElement = newSavedSelector
            ? document.querySelector(newSavedSelector)
            : globalState.autoExtractState.nextPageElement;

          if (newNextPageElement || newSavedSelector) {
            console.log(
              "✅ [ServiceNow] Next page element selected, starting AutoExtract"
            );
            clearInterval(checkForSelection);
            startAutoExtract();
          }
        }, 500);

        // Stop checking after 30 seconds
        setTimeout(() => {
          clearInterval(checkForSelection);
          console.log("⏰ [ServiceNow] AutoExtract selection timeout");
        }, 30000);
      } else {
        console.log(
          "✅ [ServiceNow] Next page element already available, starting AutoExtract"
        );
        startAutoExtract();
      }
    };

    // Close popup when clicking outside
    overlay.onclick = (e) => {
      if (e.target === overlay) {
        console.log(
          "🚫 [ServiceNow] AutoExtract popup closed by clicking outside"
        );
        overlay.remove();
      }
    };

}

/\*\*

- Show confirmation dialog when next page element can't be found
- Returns: Promise<boolean> - true if user wants to continue, false if end of book
  \*/
  async function showEndOfBookConfirmation() {
  return new Promise((resolve) => {
  debug("🤔 Showing end-of-book confirmation dialog");

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
          <div style="
            font-size: 24px;
            margin-bottom: 15px;
            color: #f59e0b;
          ">⚠️</div>

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
          ">The "Next Page" button/element could not be found on this page. This typically means you've reached the end of the book or the page structure has changed.</p>

          <div style="
            background: #f3f4f6;
            padding: 15px;
            border-radius: 8px;
            margin-bottom: 25px;
            font-size: 13px;
            color: #374151;
            text-align: left;
          ">
            <strong>Processed so far:</strong> ${globalState.autoExtractState.totalProcessed} pages<br>
            <strong>Current page:</strong> ${globalState.autoExtractState.currentPage} of ${globalState.autoExtractState.maxPages}
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
          ">Choose "End of Book" if this is the last page, or "Select New Element" if the Next button has changed or you want to continue with a different element.</p>
        </div>
      `;

      document.body.appendChild(overlay);

      // Handle button clicks
      const endButton = overlay.querySelector("#end-of-book-confirm");
      const continueButton = overlay.querySelector("#continue-autoextract");

      endButton.onclick = () => {
        debug("🏁 User confirmed end of book");
        overlay.remove();
        resolve(false); // Don't continue
      };

      continueButton.onclick = () => {
        debug("▶️ User chose to select new element");
        overlay.remove();
        resolve(true); // Continue with new element selection
      };

      // Close on overlay click (defaults to end of book)
      overlay.onclick = (e) => {
        if (e.target === overlay) {
          debug(
            "🚫 End-of-book dialog closed by clicking outside (defaulting to end)"
          );
          overlay.remove();
          resolve(false);
        }
      };

      // Auto-close after 60 seconds (defaults to end of book)
      setTimeout(() => {
        if (document.body.contains(overlay)) {
          debug("⏰ End-of-book dialog timeout (defaulting to end)");
          overlay.remove();
          resolve(false);
        }
      }, 60000);

  });
  }

function toggleAutoExtract() {
console.log(
"🔘 toggleAutoExtract called, current state:",
globalState.autoExtractState.running
);
debug(
"🔘 toggleAutoExtract called, current state:",
globalState.autoExtractState.running
);

    const panel = globalState.notionPanel;
    const btn = panel?.querySelector("#w2n-start-autoextract");
    console.log("🔘 Found panel:", !!panel);
    console.log("🔘 Found button:", !!btn);

    if (globalState.autoExtractState.running) {
      console.log("⏹️ Stopping AutoExtract...");
      debug("⏹️ Stopping AutoExtract...");
      stopAutoExtract();
      if (btn) {
        btn.textContent = "Start AutoExtract";
        btn.style.background = "#f59e0b";
      }
    } else {
      console.log("▶️ Starting AutoExtract...");
      debug("▶️ Starting AutoExtract...");

      console.log("🔍 Running diagnostics...");
      // Run diagnostics first
      const diagnostics = runAutoExtractDiagnostics();
      console.log("🔍 AutoExtract Diagnostics:", diagnostics);

      if (!diagnostics.canStart) {
        console.log("❌ AutoExtract cannot start:", diagnostics.reason);
        showToast(`AutoExtract cannot start: ${diagnostics.reason}`, 5000);
        return;
      }

      console.log("✅ Diagnostics passed, calling startAutoExtract()...");
      startAutoExtract();
      console.log("✅ startAutoExtract() called");

      if (btn) {
        btn.textContent = "Stop AutoExtract";
        btn.style.background = "#ef4444";
        console.log("✅ Button updated to Stop AutoExtract");
      }
    }
    console.log("🔘 toggleAutoExtract() finished");

}

function runAutoExtractDiagnostics() {
const savedSelector = getCurrentSelectorForHost();

    // Set default ServiceNow next page selector if none exists
    const defaultServiceNowSelector = ".zDocsNextTopicButton a[href*='/docs/']";
    let finalSelector = savedSelector;
    let foundElement = null;

    // First, try the saved selector if it exists
    if (savedSelector) {
      try {
        foundElement = document.querySelector(savedSelector);
        console.log(
          "🔍 Testing saved selector:",
          savedSelector,
          "Found:",
          !!foundElement
        );
      } catch (e) {
        console.log("❌ Saved selector invalid:", savedSelector, e);
      }
    }

    // If saved selector doesn't work, try the default ServiceNow selector
    if (
      !foundElement &&
      (window.location.hostname.includes("docs.servicenow.com") ||
        document.querySelector(defaultServiceNowSelector))
    ) {
      try {
        foundElement = document.querySelector(defaultServiceNowSelector);
        if (foundElement) {
          finalSelector = defaultServiceNowSelector;
          // Replace the bad saved selector with the working default
          saveSelectorForHost(defaultServiceNowSelector);
          console.log(
            "🎯 Replaced bad selector with default ServiceNow selector:",
            defaultServiceNowSelector
          );
        }
      } catch (e) {
        console.log("❌ Default ServiceNow selector failed:", e);
      }
    }

    const hasStoredElement = !!globalState.autoExtractState.nextPageElement;
    const hasValidStoredElement =
      hasStoredElement &&
      document.contains(globalState.autoExtractState.nextPageElement);

    const diagnostics = {
      savedSelector: savedSelector || "None",
      defaultSelector: defaultServiceNowSelector,
      finalSelector: finalSelector || "None",
      hasStoredElement,
      hasValidStoredElement,
      foundElementFromSelector: !!foundElement,
      elementIsVisible: foundElement ? isElementVisible(foundElement) : false,
      canStart: false,
      reason: "",
    };

    if (!finalSelector && !hasValidStoredElement) {
      diagnostics.reason =
        "No next page element selected. Click 'Select Next Page Element' first.";
    } else if (finalSelector && !foundElement) {
      diagnostics.reason = `Selector '${finalSelector}' doesn't match any elements on current page.`;
    } else if (foundElement && !isElementVisible(foundElement)) {
      // For ServiceNow next buttons, try a more lenient visibility check
      const isServiceNowNext = finalSelector === defaultServiceNowSelector;
      if (isServiceNowNext && foundElement && document.contains(foundElement)) {
        // For ServiceNow buttons, just check if they exist and are in DOM
        diagnostics.canStart = true;
        diagnostics.reason = `Ready to start AutoExtract using ServiceNow next button (lenient check)`;
      } else {
        diagnostics.reason =
          "Next page element found but not visible/clickable.";
      }
    } else if (
      hasValidStoredElement ||
      (foundElement && isElementVisible(foundElement))
    ) {
      diagnostics.canStart = true;
      diagnostics.reason = foundElement
        ? `Ready to start AutoExtract using: ${finalSelector}`
        : "Ready to start AutoExtract using stored element";
    } else {
      diagnostics.reason = "Unknown issue - check console for errors";
    }

    return diagnostics;

}

function selectNextPageElement() {
openNextPageSelectorModal();
}

// =============================================================================
// COMPREHENSIVE NEXT PAGE ELEMENT SELECTOR MODAL
// =============================================================================

// Alternative modal for selecting the next-page element (keeps separate ID/UX)
function openNextPageSelectorModal() {
if (document.getElementById("w2n-nextpage-selector-modal")) return;
const overlay = document.createElement("div");
overlay.id = "w2n-nextpage-selector-modal";
overlay.style.cssText =
"position:fixed;inset:0;z-index:12000;background:rgba(0,0,0,0.25);display:flex;align-items:flex-start;justify-content:center;padding-top:40px;pointer-events:none;";

    const panel = document.createElement("div");
    panel.style.cssText =
      "width:760px;max-width:95%;background:white;border-radius:8px;padding:12px;box-shadow:0 10px 30px rgba(0,0,0,0.2);max-height:80vh;overflow:auto;pointer-events:auto;";
    panel.innerHTML = `
      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:8px;">
        <strong>Select "Next Page" Element</strong>
        <button id="w2n-close-nextpage-selector" style="background:none;border:none;font-size:18px;cursor:pointer">×</button>
      </div>
      <div style="font-size:13px;color:#444;margin-bottom:8px;">Hover elements on the page to highlight them, then click the element that advances to the next page. The captured selector will be saved and used by AutoExtract.</div>

      <!-- Current Saved Selector Display -->
      <div style="margin-bottom:12px;padding:10px;border:1px solid #e5e7eb;border-radius:6px;background:#f9fafb;">
        <div style="font-weight:500;font-size:12px;color:#374151;margin-bottom:4px;">Currently Saved Selector:</div>
        <div id="w2n-nextpage-saved-display" style="font-family:monospace;font-size:11px;color:#6b7280;word-break:break-all;min-height:16px;margin-bottom:6px;">(loading...)</div>
        <div style="display:flex;gap:6px;">
          <button id="w2n-nextpage-saved-test" style="padding:4px 8px;border-radius:4px;border:1px solid #d1d5db;background:#fff;cursor:pointer;font-size:11px;">Test Saved</button>
          <button id="w2n-nextpage-saved-clear" style="padding:4px 8px;border-radius:4px;border:1px solid #d1d5db;background:#fff;cursor:pointer;font-size:11px;">Clear Saved</button>
        </div>
      </div>
    `;

    overlay.appendChild(panel);
    document.body.appendChild(overlay);

    // Update saved selector display
    const updateSavedDisplay = () => {
      try {
        const savedDisplay = panel.querySelector("#w2n-nextpage-saved-display");
        const testBtn = panel.querySelector("#w2n-nextpage-saved-test");
        const clearBtn = panel.querySelector("#w2n-nextpage-saved-clear");
        const val = getCurrentSelectorForHost();

        if (val && typeof val === "string" && val.trim().length) {
          savedDisplay.textContent = val;
          testBtn.disabled = false;
          clearBtn.disabled = false;
        } else {
          savedDisplay.textContent = "(no selector saved)";
          testBtn.disabled = true;
          clearBtn.disabled = true;
        }
      } catch (e) {
        const savedDisplay = panel.querySelector("#w2n-nextpage-saved-display");
        if (savedDisplay) savedDisplay.textContent = "(error reading selector)";
      }
    };

    // Initial update of saved display
    updateSavedDisplay();

    // Saved selector button handlers
    panel.querySelector("#w2n-nextpage-saved-test").onclick = () => {
      try {
        const saved = getCurrentSelectorForHost();
        if (!saved) {
          showToast("No selector to test");
          return;
        }
        const found = document.querySelector(saved);
        if (found) {
          const r = found.getBoundingClientRect();
          const temp = document.createElement("div");
          temp.style.cssText = `position:absolute;left:${
            r.left + window.scrollX
          }px;top:${r.top + window.scrollY}px;width:${r.width}px;height:${
            r.height
          }px;pointer-events:none;border:2px solid #10b981;box-shadow:0 0 8px rgba(16,185,129,0.3);z-index:12001;border-radius:6px;`;
          document.body.appendChild(temp);
          found.scrollIntoView({ behavior: "smooth", block: "center" });
          showToast("Saved selector matched an element (highlighted)");
          setTimeout(() => {
            if (temp.parentNode) temp.parentNode.removeChild(temp);
          }, 2500);
        } else {
          showToast("Saved selector did not match any element on this page");
        }
      } catch (err) {
        showToast("Test failed");
      }
    };

    panel.querySelector("#w2n-nextpage-saved-clear").onclick = () => {
      try {
        clearSelectorForHost();
        updateSavedDisplay();
        showToast("Saved selector cleared");
      } catch (e) {
        showToast("Failed to clear selector");
      }
    };

    const highlight = document.createElement("div");
    highlight.id = "w2n-nextpage-highlight";
    highlight.style.cssText =
      "position:absolute;pointer-events:none;border:2px dashed #2563eb;background:rgba(37,99,235,0.06);z-index:11999;border-radius:6px;";
    document.body.appendChild(highlight);

    let lastEl = null;

    function onMove(e) {
      const el = document.elementFromPoint(e.clientX, e.clientY);
      // Debug trace
      debug("nextpage.onMove", el);
      // Ignore when over our modal panel or overlay UI (so UI interactions aren't blocked)
      if (
        !el ||
        el === overlay ||
        (panel && panel.contains(el)) ||
        el.id === highlight.id
      ) {
        debug("nextpage.onMove - ignored (overlay/panel)", el);
        return;
      }
      if (el !== lastEl) {
        lastEl = el;
        const r = el.getBoundingClientRect();
        highlight.style.left = `${r.left + window.scrollX}px`;
        highlight.style.top = `${r.top + window.scrollY}px`;
        highlight.style.width = `${r.width}px`;
        highlight.style.height = `${r.height}px`;
      }
    }

    function onCapture(ev) {
      const el = document.elementFromPoint(ev.clientX, ev.clientY);
      // Debug trace
      debug("nextpage.onCapture", el);

      // Allow modal button clicks to proceed normally
      if (
        el &&
        (el.tagName === "BUTTON" || el.closest("button")) &&
        panel.contains(el)
      ) {
        debug("nextpage.onCapture - allowing button click", el);
        return; // Let the button's onclick handler run
      }

      // Ignore clicks inside our overlay/panel UI
      if (
        !el ||
        el === overlay ||
        (panel && panel.contains(el)) ||
        el.id === highlight.id
      ) {
        debug("nextpage.onCapture - ignored (overlay/panel)", el);
        return;
      }
      // Only prevent and stop when capturing a page element
      ev.preventDefault();
      ev.stopPropagation();
      const selector = cssPathForElement(el) || null;
      try {
        saveSelectorForHost(selector);
        updateSavedDisplay(); // Update the saved selector display
        showToast("Next-page selector saved");
        // Update the global state for AutoExtract
        globalState.autoExtractState.nextPageElement = el;

        // Check if AutoExtract is paused and resume it with the new selector
        if (
          globalState.autoExtractState.paused &&
          globalState.autoExtractState.running
        ) {
          debug(
            "🔄 AutoExtract was paused, resuming with new selector:",
            selector
          );
          globalState.autoExtractState.paused = false;
          showToast("AutoExtract resumed with new selector", 3000);
          // Resume the loop after a short delay
          setTimeout(() => {
            autoExtractLoop();
          }, 1000);
        }
      } catch (err) {
        showToast("Failed to save selector");
      }
      cleanup();
    }

    function cleanup() {
      document.removeEventListener("mousemove", onMove, true);
      document.removeEventListener("click", onCapture, true);
      const closeBtn = document.getElementById("w2n-close-nextpage-selector");
      if (closeBtn) closeBtn.onclick = null;
      if (highlight && highlight.parentNode)
        highlight.parentNode.removeChild(highlight);
      if (overlay && overlay.parentNode)
        overlay.parentNode.removeChild(overlay);
      document.body.style.overflow = "";
    }

    document.addEventListener("mousemove", onMove, true);
    document.addEventListener("click", onCapture, true);

    panel.querySelector("#w2n-close-nextpage-selector").onclick = cleanup;
    document.body.style.overflow = "hidden";

}

// =============================================================================
// SELECTOR HELPER FUNCTIONS
// =============================================================================

// Compute a simple, robust CSS path for an element (best-effort)
function cssPathForElement(el) {
if (!el) return null;
const parts = [];
let node = el;
while (node && node.nodeType === 1 && node !== document.body) {
let part = node.tagName.toLowerCase();
if (node.id) {
part += `#${node.id}`;
parts.unshift(part);
break;
} else {
const cls =
node.className && typeof node.className === "string"
? node.className.split(/\s+/).filter(Boolean)[0]
: null;
if (cls) part += `.${cls}`;
const parent = node.parentElement;
if (parent) {
const siblings = Array.from(parent.children).filter(
(c) => c.tagName === node.tagName
);
if (siblings.length > 1) {
const idx = siblings.indexOf(node) + 1;
part += `:nth-of-type(${idx})`;
}
}
}
parts.unshift(part);
node = node.parentElement;
}
return parts.join(" > ");
}

// --- Selector history helpers (per-host MRU) ---
const SELECTOR_HISTORY_KEY = "w2n_selector_history";
const SELECTOR_HISTORY_MAX = 8;

function \_hostKey() {
try {
return window.location.hostname || "global";
} catch (e) {
return "global";
}
}

function loadSelectorStore() {
try {
const s = GM_getValue(SELECTOR_HISTORY_KEY, null);
return s && typeof s === "object" ? s : {};
} catch (e) {
return {};
}
}

function saveSelectorStore(store) {
try {
GM_setValue(SELECTOR_HISTORY_KEY, store);
} catch (e) {
// ignore
}
}

function saveSelectorForHost(selector) {
const host = \_hostKey();
const store = loadSelectorStore();
if (!store[host]) store[host] = { current: null, history: [] };
if (selector) {
// normalize
const s = selector.trim();
// push to front if different
const hist = store[host].history || [];
// remove duplicates
const filtered = hist.filter((x) => x !== s);
filtered.unshift(s);
store[host].history = filtered.slice(0, SELECTOR_HISTORY_MAX);
store[host].current = s;
// Also set legacy single-key for backward compat
try {
GM_setValue("w2n_next_page_selector", s);
} catch (e) {}
} else {
// clear current but keep history
store[host].current = null;
try {
GM_setValue("w2n_next_page_selector", null);
} catch (e) {}
}
saveSelectorStore(store);
return store[host];
}

function getCurrentSelectorForHost() {
const host = \_hostKey();
const store = loadSelectorStore();
if (store[host] && store[host].current) return store[host].current;
// fallback to legacy key
try {
return GM_getValue("w2n_next_page_selector", null);
} catch (e) {
return null;
}
}

function clearSelectorForHost() {
return saveSelectorForHost(null);
}

function getSelectorHistoryForHost() {
const host = \_hostKey();
const store = loadSelectorStore();
return (
(store[host] &&
Array.isArray(store[host].history) &&
store[host].history.slice()) ||
[]
);
}

function startAutoExtract() {
debug("🤖 Starting AutoExtract...");

    // Check for saved selector first, then fallback to previously selected element
    const savedSelector = getCurrentSelectorForHost();
    debug("📍 Saved selector:", savedSelector);

    let nextPageElement = null;

    if (savedSelector) {
      try {
        nextPageElement = document.querySelector(savedSelector);
        debug("🎯 Found element with saved selector:", nextPageElement);
        if (nextPageElement) {
          globalState.autoExtractState.nextPageElement = nextPageElement;
        }
      } catch (e) {
        debug("⚠️ Saved selector invalid:", savedSelector, e);
      }
    }

    if (!nextPageElement && !globalState.autoExtractState.nextPageElement) {
      debug("❌ No next page element available");
      showToast("Please select a 'Next Page' element first", 3000);
      return;
    }

    debug(
      "✅ Next page element ready:",
      nextPageElement || globalState.autoExtractState.nextPageElement
    );

    globalState.autoExtractState.running = true;
    globalState.autoExtractState.currentPage = 0;
    globalState.autoExtractState.totalProcessed = 0;

    const maxPages =
      parseInt(
        globalState.notionPanel?.querySelector("#w2n-max-pages")?.value
      ) || 500;
    globalState.autoExtractState.maxPages = maxPages;
    debug("📊 Max pages set to:", maxPages);

    const elementInfo =
      savedSelector ||
      `${globalState.autoExtractState.nextPageElement?.tagName}${
        globalState.autoExtractState.nextPageElement?.id
          ? "#" + globalState.autoExtractState.nextPageElement.id
          : ""
      }`;

    debug("🚀 Starting AutoExtract with element:", elementInfo);
    showToast(
      `Starting AutoExtract (max ${maxPages} pages)\nUsing: ${elementInfo}`,
      4000
    );

    // Start the auto-extract loop
    debug("⏰ Setting timeout to start autoExtractLoop...");
    setTimeout(() => {
      debug("🔄 Calling autoExtractLoop...");
      autoExtractLoop();
    }, 1000); // Give UI time to update

}

async function autoExtractLoop() {
debug(
"🔄 AutoExtractLoop started, running state:",
globalState.autoExtractState.running
);

    if (!globalState.autoExtractState.running) {
      debug("❌ AutoExtract stopped by user");
      return;
    }

    const savedSelector = getCurrentSelectorForHost();
    let nextPageElement = null;

    // Try to find the next page element with multiple strategies
    if (savedSelector) {
      try {
        nextPageElement = document.querySelector(savedSelector);
        console.log(
          `🎯 [AutoExtract] Found element with saved selector: ${savedSelector}`
        );
        debug("🔍 Loop check - found with savedSelector:", !!nextPageElement);
      } catch (e) {
        console.warn(
          `⚠️ [AutoExtract] Saved selector failed: ${savedSelector}`,
          e
        );
      }
    }

    // Fallback to stored element if selector didn't work
    if (!nextPageElement && globalState.autoExtractState.nextPageElement) {
      // Check if stored element is still valid
      if (document.contains(globalState.autoExtractState.nextPageElement)) {
        nextPageElement = globalState.autoExtractState.nextPageElement;
        console.log(`🎯 [AutoExtract] Using stored element (still in DOM)`);
      } else {
        console.warn(
          `⚠️ [AutoExtract] Stored element no longer in DOM, trying to re-find`
        );
        // Try to find a similar element if the stored one is gone
        const similarElements = document.querySelectorAll(
          'button, a, [role="button"]'
        );
        for (const elem of similarElements) {
          const text = elem.textContent?.toLowerCase() || "";
          if (
            text.includes("next") ||
            text.includes("forward") ||
            text.includes(">") ||
            text.includes("→")
          ) {
            nextPageElement = elem;
            console.log(
              `🔍 [AutoExtract] Found similar next page element: ${elem.tagName} with text: ${text}`
            );
            break;
          }
        }
      }
    }

    debug("🔍 Loop check - savedSelector:", savedSelector);
    debug("🎯 Loop check - nextPageElement:", !!nextPageElement);

    if (nextPageElement) {
      console.log(`✅ [AutoExtract] Next page element found:`, {
        tagName: nextPageElement.tagName,
        className: nextPageElement.className,
        id: nextPageElement.id,
        text: nextPageElement.textContent?.substring(0, 50),
        visible: isElementVisible(nextPageElement),
      });
    }

    // Update button with progress
    const panel = globalState.notionPanel;
    const btn = panel?.querySelector("#w2n-start-autoextract");

    // Check if we've reached max pages
    if (
      globalState.autoExtractState.currentPage >=
      globalState.autoExtractState.maxPages
    ) {
      showToast(
        `AutoExtract complete: Reached max pages (${globalState.autoExtractState.maxPages})`,
        4000
      );
      stopAutoExtract();
      return;
    }

    // Re-query for next page element to handle DOM changes after navigation
    const refreshedNextPageElement = document.querySelector(savedSelector);

    // Check if next page element is still visible and clickable
    if (
      !refreshedNextPageElement ||
      !isElementVisibleForAutoExtract(refreshedNextPageElement, savedSelector)
    ) {
      debug(
        "⚠️ Next page element not found or not visible, checking if page reload can help"
      );

      // Initialize reload attempt counter if not exists
      if (!globalState.autoExtractState.reloadAttempts) {
        globalState.autoExtractState.reloadAttempts = 0;
      }

      // Try page reload first (max 2 attempts) before showing confirmation dialog
      if (globalState.autoExtractState.reloadAttempts < 2) {
        globalState.autoExtractState.reloadAttempts++;

        console.log(
          `🔄 [AutoExtract] Reload attempt ${globalState.autoExtractState.reloadAttempts}/2 - page may need refresh`
        );

        showToast(
          `Page reload attempt ${globalState.autoExtractState.reloadAttempts}/2 - trying to refresh content...`,
          3000
        );

        // Pause briefly then reload (longer delay to allow dynamic content to settle)
        await new Promise((resolve) => setTimeout(resolve, 2500));

        // Store current extraction state before reload
        const currentExtractionData = {
          currentPage: globalState.autoExtractState.currentPage,
          totalProcessed: globalState.autoExtractState.totalProcessed,
          maxPages: globalState.autoExtractState.maxPages,
          reloadAttempts: globalState.autoExtractState.reloadAttempts,
          running: globalState.autoExtractState.running,
          paused: false,
        };

        // Save state to localStorage to survive page reload
        localStorage.setItem(
          "W2N_autoExtractState",
          JSON.stringify(currentExtractionData)
        );

        // Reload the page
        window.location.reload();
        return;
      }

      // Reset reload attempts counter after max attempts reached
      globalState.autoExtractState.reloadAttempts = 0;

      debug(
        "⚠️ Next page element not found or not visible after reload attempts, pausing AutoExtract for user decision"
      );

      // Pause the AutoExtract process but don't stop it completely
      globalState.autoExtractState.paused = true;

      // Show a confirmation dialog to the user
      const shouldContinue = await showEndOfBookConfirmation();

      if (!shouldContinue) {
        // User confirmed this is the end of the book or chose to stop
        showToast(
          `AutoExtract complete: User confirmed end of book\nProcessed ${globalState.autoExtractState.totalProcessed} pages`,
          4000
        );
        stopAutoExtract();
        return;
      } else {
        // User wants to select a new element or continue
        debug("📍 User chose to continue - resuming element selection");
        showToast(
          "Please select a new 'Next Page' element to continue AutoExtract",
          5000
        );

        // Reset the paused state but keep running state
        globalState.autoExtractState.paused = false;

        // Stop current iteration and wait for user to select new element
        // The process will resume when user selects a new element
        return;
      }
    }

    try {
      // Step 1: Save current page
      globalState.autoExtractState.currentPage++;

      // Update button text with progress
      if (btn) {
        btn.textContent = `Processing ${globalState.autoExtractState.currentPage}/${globalState.autoExtractState.maxPages}...`;
      }

      showToast(
        `AutoExtract: Processing page ${globalState.autoExtractState.currentPage}/${globalState.autoExtractState.maxPages}...`,
        3000
      );

      // Attempt to capture current page with retry logic
      let captureSuccess = false;
      let captureAttempts = 0;
      const maxCaptureAttempts = 3; // Original attempt + 2 retries
      let lastError = null;

      while (captureAttempts < maxCaptureAttempts && !captureSuccess) {
        captureAttempts++;

        try {
          if (captureAttempts > 1) {
            // This is a retry attempt
            console.log(
              `🔄 [AutoExtract] Retry attempt ${
                captureAttempts - 1
              }/2 for page ${globalState.autoExtractState.currentPage}`
            );
            showToast(
              `Retry ${captureAttempts - 1}/2: Processing page ${
                globalState.autoExtractState.currentPage
              }...`,
              3000
            );

            // Update button text with retry info
            if (btn) {
              btn.textContent = `Retry ${captureAttempts - 1}/2: Processing ${
                globalState.autoExtractState.currentPage
              }/${globalState.autoExtractState.maxPages}...`;
            }

            // Wait a moment before retry
            await new Promise((resolve) => setTimeout(resolve, 2000));
          }

          await captureCurrentPage();
          captureSuccess = true;
          globalState.autoExtractState.totalProcessed++;
          console.log(
            `✅ [AutoExtract] Page ${
              globalState.autoExtractState.currentPage
            } captured successfully${
              captureAttempts > 1 ? ` (on attempt ${captureAttempts})` : ""
            }`
          );
        } catch (error) {
          lastError = error;
          console.error(
            `❌ [AutoExtract] Capture attempt ${captureAttempts} failed for page ${globalState.autoExtractState.currentPage}:`,
            error.message
          );

          if (captureAttempts < maxCaptureAttempts) {
            // More attempts remain - show retry message
            showToast(
              `⚠️ Page capture failed (attempt ${captureAttempts}/${maxCaptureAttempts}). Retrying...`,
              4000
            );
          }
        }
      }

      // Check if all capture attempts failed
      if (!captureSuccess) {
        console.error(
          `❌ [AutoExtract] All ${maxCaptureAttempts} capture attempts failed for page ${globalState.autoExtractState.currentPage}`
        );

        const errorMessage = `❌ AutoExtract STOPPED: Page ${
          globalState.autoExtractState.currentPage
        } failed to capture after ${maxCaptureAttempts} attempts.\n\nAll pages must be captured successfully.\n\nError: ${
          lastError?.message || "Unknown error"
        }\n\nTotal pages processed: ${
          globalState.autoExtractState.currentPage - 1
        }`;

        // Show prominent alert popup
        alert(errorMessage);

        // Also show browser notification
        if (typeof GM_notification !== "undefined") {
          GM_notification({
            title: "🚨 AutoExtract Failed",
            text: `Page ${globalState.autoExtractState.currentPage} failed after ${maxCaptureAttempts} retry attempts`,
            timeout: 10000,
            onclick: function () {
              window.focus();
            },
          });
        }

        // Show persistent toast as backup
        showToast(errorMessage, 8000);

        // Update button to show failure
        if (btn) {
          btn.textContent = `❌ Stopped: Page ${globalState.autoExtractState.currentPage} failed`;
        }

        stopAutoExtract();
        return; // Stop AutoExtract immediately - do not advance to next page
      }

      // Wait a moment for the save to complete
      await new Promise((resolve) => setTimeout(resolve, 2000));

      // Step 2: Click the next page element
      if (globalState.autoExtractState.running) {
        // Check if still running after save
        console.log(
          `🖱️ [AutoExtract] Clicking next page element: ${
            savedSelector || "stored element"
          }`
        );
        debug(
          `Clicking next page element: ${savedSelector || "stored element"}`
        );

        // Update button to show navigation
        if (btn) {
          btn.textContent = `Going to next page...`;
        }

        // Get current URL and page identifier for change detection
        const currentUrl = window.location.href;
        const currentPageId = getCurrentPageId();
        const currentPageTitle = document.title;
        const mainContent = document.querySelector(
          'main, .main-content, [role="main"]'
        );
        const originalContentLength = mainContent
          ? mainContent.innerHTML.length
          : 0;

        // Verify element is still clickable (use refreshed element)
        if (
          !refreshedNextPageElement ||
          !isElementVisibleForAutoExtract(
            refreshedNextPageElement,
            savedSelector
          )
        ) {
          console.error(
            `❌ [AutoExtract] Next page element is no longer clickable`
          );
          showToast("Next page element is no longer available", 4000);
          stopAutoExtract();
          return;
        }

        // Thoroughly analyze the element before clicking
        const isClickable = analyzeElement(
          refreshedNextPageElement,
          "Next Page Element"
        );
        if (!isClickable) {
          console.error(
            `❌ [AutoExtract] Element analysis indicates it's not clickable`
          );
          showToast("Next page element appears to be unclickable", 4000);
          stopAutoExtract();
          return;
        }

        // Click the next page element
        console.log(`🖱️ [AutoExtract] Clicking next page element`);

        try {
          // Focus and trigger click events
          refreshedNextPageElement.focus();
          await new Promise((resolve) => setTimeout(resolve, 100));

          // Execute click with mouse events
          refreshedNextPageElement.dispatchEvent(
            new MouseEvent("mousedown", { bubbles: true, cancelable: true })
          );
          refreshedNextPageElement.dispatchEvent(
            new MouseEvent("mouseup", { bubbles: true, cancelable: true })
          );
          refreshedNextPageElement.click();

          // Alternative click approaches after short delay
          setTimeout(() => {
            if (
              window.location.href === currentUrl &&
              getCurrentPageId() === currentPageId
            ) {
              // Try programmatic click
              try {
                refreshedNextPageElement.dispatchEvent(
                  new Event("click", { bubbles: true, cancelable: true })
                );
              } catch (e) {
                console.error(`❌ [AutoExtract] Event dispatch failed:`, e);
              }

              // Try triggering any href navigation
              if (refreshedNextPageElement.href) {
                window.location.href = refreshedNextPageElement.href;
              }

              // Try simulating keyboard activation (Enter key)
              refreshedNextPageElement.dispatchEvent(
                new KeyboardEvent("keydown", {
                  key: "Enter",
                  keyCode: 13,
                  bubbles: true,
                  cancelable: true,
                })
              );
            }
          }, 1000);
        } catch (clickError) {
          console.error(`❌ [AutoExtract] Click error:`, clickError);
          showToast(`Click failed: ${clickError.message}`, 4000);
          stopAutoExtract();
          return;
        }

        // Wait for page navigation/loading with comprehensive detection
        let navigationDetected = false;
        let attempts = 0;
        const maxAttempts = 15; // 15 seconds total
        const checkInterval = 1000; // Check every second

        while (attempts < maxAttempts && globalState.autoExtractState.running) {
          await new Promise((resolve) => setTimeout(resolve, checkInterval));
          attempts++;

          const newUrl = window.location.href;
          const newPageId = getCurrentPageId();

          // More detailed logging of what we're checking
          if (attempts % 3 === 0) {
            // Log every 3 seconds to avoid spam
            console.log(`🔍 [AutoExtract] Check ${attempts}/${maxAttempts}:`, {
              "URL changed": newUrl !== currentUrl,
              "PageID changed": newPageId !== currentPageId,
              "Current URL": newUrl,
              "Current PageID": newPageId.substring(0, 100),
            });
          }

          // Check multiple indicators of page change
          const urlChanged = newUrl !== currentUrl;
          const pageIdChanged = newPageId !== currentPageId;
          const titleChanged =
            document.title !== (currentPageTitle || document.title);

          // Additional content-based checks
          const mainContent = document.querySelector(
            'main, .main-content, [role="main"]'
          );
          const contentChanged =
            mainContent &&
            mainContent.innerHTML.length !==
              (originalContentLength || mainContent.innerHTML.length);

          if (urlChanged || pageIdChanged || titleChanged || contentChanged) {
            const changeTypes = [];
            if (urlChanged) changeTypes.push("URL");
            if (pageIdChanged) changeTypes.push("PageID");
            if (titleChanged) changeTypes.push("Title");
            if (contentChanged) changeTypes.push("Content");

            console.log(
              `✅ [AutoExtract] Navigation detected after ${attempts} seconds!`
            );
            console.log(
              `✅ [AutoExtract] Changes detected: ${changeTypes.join(", ")}`
            );
            console.log(`🌍 [AutoExtract] New URL: ${newUrl}`);
            console.log(
              `📖 [AutoExtract] New PageID: ${newPageId.substring(0, 100)}...`
            );
            navigationDetected = true;
            break;
          }

          // Update progress feedback
          if (btn) {
            btn.textContent = `Waiting for navigation... (${attempts}/${maxAttempts}s)`;
          }

          // Show periodic toast updates
          if (attempts === 5) {
            showToast(
              `Still waiting for page to change... (${attempts}s)`,
              2000
            );
          } else if (attempts === 10) {
            showToast(
              `Page navigation taking longer than expected... (${attempts}s)`,
              2000
            );
          }
        }

        if (!navigationDetected) {
          console.error(
            `❌ [AutoExtract] No navigation detected after ${maxAttempts} seconds - stopping AutoExtract`
          );
          console.error(`❌ [AutoExtract] Final state check:`, {
            "Original URL": currentUrl,
            "Final URL": window.location.href,
            "Original PageID": currentPageId.substring(0, 50),
            "Final PageID": getCurrentPageId().substring(0, 50),
            "URLs match": window.location.href === currentUrl,
            "PageIDs match": getCurrentPageId() === currentPageId,
          });

          // Stop AutoExtract instead of continuing - navigation failure indicates broken next page element
          const navErrorMessage = `❌ AutoExtract STOPPED: Page navigation failed after ${maxAttempts} seconds.\n\nThe 'Next Page' element may not be working properly. All pages must be captured successfully.\n\nTotal pages processed: ${
            globalState.autoExtractState.currentPage - 1
          }\n\nPlease check the next page element and restart AutoExtract if needed.`;

          // Show prominent alert popup
          alert(navErrorMessage);

          // Also show browser notification
          if (typeof GM_notification !== "undefined") {
            GM_notification({
              title: "🚨 AutoExtract Navigation Failed",
              text: `Page navigation timeout after ${maxAttempts} seconds`,
              timeout: 10000,
              onclick: function () {
                window.focus();
              },
            });
          }

          // Show persistent toast as backup
          showToast(navErrorMessage, 8000);

          // Update button to show navigation failure
          if (btn) {
            btn.textContent = `❌ Stopped: Navigation failed`;
          }

          stopAutoExtract();
          return; // Stop AutoExtract immediately - do not continue the loop
        } else {
          // Navigation detected, give content time to fully load
          console.log(
            `⏳ [AutoExtract] Navigation successful, waiting for content to load...`
          );
          await new Promise((resolve) => setTimeout(resolve, 3000));
        }

        // Continue the loop
        if (globalState.autoExtractState.running) {
          console.log(`🔄 [AutoExtract] Continuing to next iteration`);
          setTimeout(() => autoExtractLoop(), 1000);
        }
      }
    } catch (error) {
      debug("Error in autoExtractLoop:", error);

      const errorMessage = `❌ AutoExtract ERROR: ${
        error.message
      }\n\nAutoExtract has been stopped due to an unexpected error.\n\nTotal pages processed: ${
        globalState.autoExtractState.currentPage - 1
      }`;

      // Show prominent alert popup
      alert(errorMessage);

      // Also show browser notification
      if (typeof GM_notification !== "undefined") {
        GM_notification({
          title: "🚨 AutoExtract Error",
          text: `Unexpected error: ${error.message}`,
          timeout: 10000,
          onclick: function () {
            window.focus();
          },
        });
      }

      // Show persistent toast as backup
      showToast(errorMessage, 4000);

      stopAutoExtract();
    }

}

// Helper function for ServiceNow-specific lenient visibility check
function isElementVisibleForAutoExtract(element, selector) {
if (!element) return false;

    // For ServiceNow next buttons, use lenient check
    const defaultServiceNowSelector = ".zDocsNextTopicButton a[href*='/docs/']";
    const isServiceNowNext = selector === defaultServiceNowSelector;

    if (isServiceNowNext && element && document.contains(element)) {
      return true;
    }

    // For other elements, use standard visibility check
    return isElementVisible(element);

}

function isElementVisible(element) {
if (!element) return false;

    // Check if element exists in DOM
    if (!document.contains(element)) return false;

    // Check computed styles
    const style = window.getComputedStyle(element);
    if (
      style.display === "none" ||
      style.visibility === "hidden" ||
      style.opacity === "0"
    ) {
      return false;
    }

    // Check if element has dimensions
    const rect = element.getBoundingClientRect();
    if (rect.width === 0 && rect.height === 0) return false;

    // Check if element is disabled (for buttons/inputs)
    if (element.disabled) return false;

    return true;

}

// Helper function to get a unique identifier for the current page
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
// EPUB viewer specific selectors
document.querySelector(".epubjs-view")?.innerHTML?.substring(0, 100),
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

// Helper function to thoroughly analyze an element for debugging
function analyzeElement(element, elementName = "element") {
if (!element) {
console.log(`❌ [AutoExtract] ${elementName} is null or undefined`);
return false;
}

    // Check if this is a ServiceNow next button (use lenient check)
    const isServiceNowNext =
      element.matches &&
      element.matches('.zDocsNextTopicButton a[href*="/docs/"]');

    if (isServiceNowNext) {
      const isClickable =
        document.contains(element) && element.href && !element.disabled;
      return isClickable;
    }

    // For non-ServiceNow elements, use standard strict checks
    const style = getComputedStyle(element);
    const isClickable =
      document.contains(element) &&
      element.offsetParent &&
      style.display !== "none" &&
      style.visibility !== "hidden" &&
      style.opacity !== "0" &&
      !element.disabled;

    return isClickable;

}

function stopAutoExtract() {
const wasRunning = globalState.autoExtractState.running;
const totalProcessed = globalState.autoExtractState.totalProcessed;

    globalState.autoExtractState.running = false;
    globalState.autoExtractState.currentPage = 0;
    globalState.autoExtractState.totalProcessed = 0;
    globalState.autoExtractState.reloadAttempts = 0; // Reset reload attempts

    // Clean up any saved auto-extraction state
    localStorage.removeItem("W2N_autoExtractState");

    // Reset button appearance
    const panel = globalState.notionPanel;
    const btn = panel?.querySelector("#w2n-start-autoextract");
    if (btn) {
      btn.textContent = "Start AutoExtract";
      btn.style.background = "#f59e0b";
    }

    if (wasRunning && totalProcessed > 0) {
      showToast(
        `AutoExtract stopped - Processed ${totalProcessed} pages`,
        3000
      );
    } else if (wasRunning) {
      showToast("AutoExtract stopped", 2000);
    }

}

// =============================================================================
// MENU REGISTRATION
// =============================================================================

function registerMenuCommands() {
GM_registerMenuCommand("📋 Open ServiceNow Panel", () => {
if (!globalState.notionPanel) {
createUI();
} else {
globalState.notionPanel.style.display =
globalState.notionPanel.style.display === "none" ? "block" : "none";
}
});
GM_registerMenuCommand("📄 Save Current Page", captureCurrentPage);
GM_registerMenuCommand("⚙️ Configure Database", showConfigPanel);
GM_registerMenuCommand("🎨 Icon & Cover Selector", injectIconCoverModal);
}

function showConfigPanel() {
const newDatabaseId = prompt(
"Enter Notion Database ID:",
config.databaseId
);
if (newDatabaseId !== null) {
config.databaseId = newDatabaseId.trim();
GM_setValue("notionConfig", config);
showToast("Configuration saved!", 2000);
}
}

// =============================================================================
// INITIALIZATION
// =============================================================================

function init() {
// Add safety checks to prevent interference with ServiceNow initialization
try {
// Check if we're in an error state or ServiceNow is still initializing
if (
document.querySelector('div[data-testid="error-page"]') ||
document.querySelector(".error-page") ||
(document.querySelector('[class*="error"]') &&
window.location.href.includes("error"))
) {
console.log(
"⚠️ Error page detected, skipping W2N initialization to avoid interference"
);
return;
}

      // Check for critical ServiceNow authentication issues
      if (
        window.location.href.includes("auth") ||
        window.location.href.includes("login") ||
        window.location.href.includes("signin")
      ) {
        console.log(
          "⚠️ Authentication page detected, skipping W2N initialization"
        );
        return;
      }

      // Wait for ServiceNow's critical objects to be available before proceeding
      if (
        typeof window.angular === "undefined" &&
        typeof window.React === "undefined" &&
        !document.querySelector("#zDocsContent") &&
        !window.location.href.includes("localhost")
      ) {
        console.log(
          "⚠️ ServiceNow framework not ready, delaying W2N initialization"
        );
        setTimeout(() => {
          try {
            init();
          } catch (retryError) {
            console.error("❌ W2N initialization retry failed:", retryError);
          }
        }, 2000);
        return;
      }

      console.log(
        `🚀 ${PROVIDER_NAME} v${PROVIDER_VERSION} starting initialization...`
      );
      debug(`🚀 ${PROVIDER_NAME} v${PROVIDER_VERSION} initialized`);

      // Wrap all function exposures in try-catch to prevent errors
      try {
        // Expose version check function globally
        unsafeWindow.checkW2NVersion = function () {
          console.log("🔍 W2N-SN2N Version Check:");
          console.log(`📦 Provider Version: ${PROVIDER_VERSION}`);
          console.log(`🏷️ Provider Name: ${PROVIDER_NAME}`);
          console.log(`🌐 Current URL: ${window.location.href}`);

          // Check if key functions exist
          const functions = {
            extractDatabaseProperties:
              typeof extractDatabaseProperties === "function",
            replaceTableImagesWithEmojis:
              typeof replaceTableImagesWithEmojis === "function",
            styleTableHeaders: typeof styleTableHeaders === "function",
            detectVideosInContent: typeof detectVideosInContent === "function",
            captureCurrentPage: typeof captureCurrentPage === "function",
            testProps: typeof unsafeWindow.testProps === "function",
            testTableImages: typeof unsafeWindow.testTableImages === "function",
            testVideoDetection:
              typeof unsafeWindow.testVideoDetection === "function",
            testSpanTitle: typeof unsafeWindow.testSpanTitle === "function",
            debugContent: typeof unsafeWindow.debugContent === "function",
          };

          console.log("🔧 Function Availability:");
          Object.entries(functions).forEach(([name, available]) => {
            console.log(
              `  ${available ? "✅" : "❌"} ${name}: ${
                available ? "Available" : "Missing"
              }`
            );
          });

          const allFunctionsAvailable = Object.values(functions).every(
            (f) => f
          );
          console.log(
            `🎯 All functions available: ${
              allFunctionsAvailable ? "✅ YES" : "❌ NO"
            }`
          );

          if (!allFunctionsAvailable) {
            console.log("⚠️ Some functions are missing. You may need to:");
            console.log("   1. Refresh/reload the userscript in Tampermonkey");
            console.log("   2. Reload the page");
            console.log("   3. Check for userscript syntax errors");
          }

          return {
            version: PROVIDER_VERSION,
            name: PROVIDER_NAME,
            url: window.location.href,
            functions: functions,
            allFunctionsAvailable: allFunctionsAvailable,
          };
        };

        console.log(
          "✅ Debug function 'checkW2NVersion()' is now available in console"
        );

        // Expose debug functions globally immediately
        unsafeWindow.testProps = function () {
          console.log("🔍 Testing property extraction on current page...");
          console.log("🔍 Current URL:", window.location.href);

          // Test version selector
          const versionElement = document.querySelector(
            "#zDocsContent > header > ul > li.zDocsTopicPageCluster > div > div > button > div > div > div"
          );
          console.log("🔍 Version element found:", !!versionElement);
          if (versionElement) {
            console.log("🔍 Version text:", versionElement.textContent.trim());
          }

          // Test updated selector
          const updatedElement = document.querySelector(
            "#zDocsContent > header > ul > li.zDocsTopicPageDate.css-cinqea > span"
          );
          console.log("🔍 Updated element found:", !!updatedElement);
          if (updatedElement) {
            console.log("🔍 Updated text:", updatedElement.textContent.trim());
          }

          // Test image detection
          const images = document.querySelectorAll("img, figure, svg, canvas");
          console.log("🔍 Images found:", images.length);

          // Test main content
          const mainContent = document.querySelector(
            SERVICENOW_SELECTORS.mainContent
          );
          console.log("🔍 Main content found:", !!mainContent);

          return {
            url: window.location.href,
            versionFound: !!versionElement,
            versionText: versionElement
              ? versionElement.textContent.trim()
              : null,
            updatedFound: !!updatedElement,
            updatedText: updatedElement
              ? updatedElement.textContent.trim()
              : null,
            imagesCount: images.length,
            mainContentFound: !!mainContent,
          };
        };

        console.log(
          "✅ Debug function 'testProps()' is now available in console"
        );

        // Test function for table image replacement
        unsafeWindow.testTableImages = function () {
          console.log("📊 Testing table image replacement...");

          // Find all tables on the page
          const tables = document.querySelectorAll(
            "table, .table, .data-table, .record-table"
          );
          console.log(`📊 Found ${tables.length} table(s) on page`);

          let totalImages = 0;
          tables.forEach((table, index) => {
            const images = table.querySelectorAll("img");
            totalImages += images.length;

            console.log(`📊 Table ${index + 1}:`, {
              tagName: table.tagName,
              className: table.className,
              imageCount: images.length,
              tableText: table.textContent.substring(0, 100) + "...",
            });

            // Show details of each image in the table
            images.forEach((img, imgIndex) => {
              console.log(`  🖼️ Image ${imgIndex + 1}:`, {
                src: img.src.substring(0, 50) + "...",
                alt: img.alt,
                className: img.className,
                title: img.title,
              });
            });
          });

          console.log(`📊 Total images in tables: ${totalImages}`);

          // Test the replacement function if there are tables with images
          if (totalImages > 0) {
            console.log("🧪 Testing replacement function...");
            const testHtml = document.body.innerHTML;
            const processedHtml = replaceTableImagesWithEmojis(testHtml);
            console.log("✅ Replacement function completed successfully");
            console.log(
              "📊 You can inspect the console logs above to see what would be replaced"
            );
          } else {
            console.log("ℹ️ No images found in tables to test replacement");
          }

          return {
            tablesFound: tables.length,
            totalImages: totalImages,
            tableDetails: Array.from(tables).map((table, index) => ({
              index: index + 1,
              imageCount: table.querySelectorAll("img").length,
              className: table.className,
              hasImages: table.querySelectorAll("img").length > 0,
            })),
          };
        };

        console.log(
          "✅ Debug function 'testTableImages()' is now available in console"
        );

        // Test function for video detection
        unsafeWindow.testVideoDetection = function () {
          console.log("Testing video detection...");

          // Get main content element
          const mainContent = document.querySelector(
            SERVICENOW_SELECTORS.mainContent
          );

          if (!mainContent) {
            console.log("❌ Main content element not found");
            return;
          }

          console.log("Scanning for videos in main content...");
          const videos = detectVideosInContent(mainContent);

          console.log(`Found ${videos.length} video(s):`);
          videos.forEach((video, index) => {
            console.log(`  Video ${index + 1}:`);
            console.log(`    Type: ${video.type}`);
            console.log(`    Platform: ${video.platform}`);
            console.log(`    Title: ${video.title}`);
            console.log(`    URL: ${video.url || video.src}`);
            if (video.thumbnail)
              console.log(`    Thumbnail: ${video.thumbnail}`);
            if (video.duration) console.log(`    Duration: ${video.duration}`);
            if (video.chapters && video.chapters.length > 0) {
              console.log(`    Chapters: ${video.chapters.join(", ")}`);
            }
            console.log("    Raw data:", video);
          });

          // Also test direct document scanning
          console.log("🔍 Scanning entire document for video elements...");
          const allVideos = detectVideosInContent(document.body);
          console.log(
            `🎥 Found ${allVideos.length} video(s) in entire document`
          );

          return {
            mainContentVideos: videos,
            allVideos: allVideos,
            mainContentFound: !!mainContent,
          };
        };

        console.log(
          "✅ Debug function 'testVideoDetection()' is now available in console"
        );

        // Comprehensive test function
        unsafeWindow.testCompleteFlow = function () {
          console.log("🧪 Testing complete W2N-SN2N flow...");

          try {
            // Test 1: Property extraction
            console.log("🔍 Step 1: Testing property extraction...");
            const properties = extractDatabaseProperties();
            console.log("✅ Properties extracted:", properties);

            // Test 2: Content extraction
            console.log("🔍 Step 2: Testing content extraction...");
            const contentElement = document.querySelector(
              SERVICENOW_SELECTORS.mainContent
            );
            if (!contentElement) {
              console.log("❌ Main content element not found");
              return false;
            }

            let contentHtml = contentElement.innerHTML;
            console.log(
              `✅ Content extracted: ${contentHtml.length} characters`
            );

            // Test 3: Table image replacement
            console.log("🔍 Step 3: Testing table image replacement...");
            const originalLength = contentHtml.length;
            contentHtml = replaceTableImagesWithEmojis(contentHtml);
            contentHtml = styleTableHeaders(contentHtml);
            contentHtml = removeTableSearchLabels(contentHtml);
            console.log(
              `✅ Table images processed, length: ${originalLength} → ${contentHtml.length}`
            );

            // Test 4: Video detection
            console.log("Step 4: Testing video detection...");
            const videos = detectVideosInContent(contentElement);
            console.log(`✅ Videos detected: ${videos.length}`);

            // Test 5: Image extraction
            console.log("🔍 Step 5: Testing image extraction...");
            const images = Array.from(
              contentElement.querySelectorAll("img")
            ).map((img) => ({
              src: img.src,
              alt: img.alt || "",
              title: img.title || "",
            }));
            console.log(`✅ Images found: ${images.length}`);

            console.log("🎉 Complete flow test successful!");

            return {
              success: true,
              properties: properties,
              contentLength: contentHtml.length,
              videoCount: videos.length,
              imageCount: images.length,
              mainContentFound: !!contentElement,
            };
          } catch (error) {
            console.error("❌ Complete flow test failed:", error);
            return {
              success: false,
              error: error.message,
            };
          }
        };

        // Debug function to help diagnose content conversion issues
        unsafeWindow.debugContent = function () {
          const pageSpanTitles = document.querySelectorAll("span.title");
          console.log(
            `📊 Found ${pageSpanTitles.length} span.title elements on page`
          );

          // Analyze each span.title for caption relationship
          pageSpanTitles.forEach((span, index) => {
            const text = span.textContent.trim();
            const captionElement = span.closest("caption");
            let isTableCaption = false;
            let captionInfo = "";

            if (captionElement) {
              // Check if this caption is inside a table (standard HTML structure)
              let parentTable = captionElement.closest("table");
              let nextElement = captionElement.nextElementSibling;
              let parentNext = captionElement.parentElement?.nextElementSibling;

              if (parentTable) {
                isTableCaption = true;
                captionInfo = " → TABLE (inside table)";
              } else if (nextElement && nextElement.tagName === "TABLE") {
                isTableCaption = true;
                captionInfo = " → TABLE (next sibling)";
              } else if (parentNext && parentNext.tagName === "TABLE") {
                isTableCaption = true;
                captionInfo = " → TABLE (parent's next sibling)";
              } else {
                captionInfo = " (no adjacent table found)";
              }
            }

            console.log(`${index + 1}. "${text}"${captionInfo}`);
            console.log(
              `   In caption: ${!!captionElement}, Is table caption: ${isTableCaption}`
            );
          });

          // Test content selectors
          const contentSelectors = [
            ".zDocsTopicPageBody .zDocsTopicPageBodyContent article.dita",
            ".body.conbody",
          ];

          contentSelectors.forEach((selector, index) => {
            const element = document.querySelector(selector);
            if (element) {
              const spanTitlesInSelector =
                element.querySelectorAll("span.title");
              console.log(
                `📍 Selector ${index + 1}: ${
                  spanTitlesInSelector.length
                } span.title elements captured`
              );

              // Show which specific span.title elements are captured
              spanTitlesInSelector.forEach((span, spanIndex) => {
                console.log(
                  `   ${spanIndex + 1}. "${span.textContent.trim()}"`
                );
              });
            } else {
              console.log(`❌ Selector ${index + 1}: Element not found`);
            }
          });

          return {
            totalSpanTitles: pageSpanTitles.length,
            selectorResults: contentSelectors.map((selector) => ({
              selector,
              found: !!document.querySelector(selector),
              spanTitleCount:
                document.querySelector(selector)?.querySelectorAll("span.title")
                  .length || 0,
            })),
          };
        };

        // Test function for debugging span.title elements specifically
        unsafeWindow.testSpanTitle = function () {
          console.log(
            "🔍 [SPAN TITLE TEST] Starting span.title and caption span.title element debugging..."
          );

          // 1. Check if any span.title elements exist on the page
          const spanTitleElements = document.querySelectorAll("span.title");
          console.log(
            `🔍 [SPAN TITLE] Found ${spanTitleElements.length} span.title elements on page`
          );

          // 1a. Specifically check for caption > span.title elements
          const captionSpanTitleElements = document.querySelectorAll(
            "caption > span.title, caption span.title"
          );
          console.log(
            `🔍 [CAPTION SPAN TITLE] Found ${captionSpanTitleElements.length} caption > span.title elements on page`
          );

          spanTitleElements.forEach((element, index) => {
            console.log(
              `🔍 [SPAN TITLE ${
                index + 1
              }] Text: "${element.textContent.trim()}"`
            );
            console.log(
              `🔍 [SPAN TITLE ${index + 1}] Classes: "${element.className}"`
            );
            console.log(
              `🔍 [SPAN TITLE ${index + 1}] Parent: ${
                element.parentElement?.tagName
              }.${element.parentElement?.className}`
            );
          });

          captionSpanTitleElements.forEach((element, index) => {
            console.log(
              `🔍 [CAPTION SPAN TITLE ${
                index + 1
              }] Text: "${element.textContent.trim()}"`
            );
            console.log(
              `🔍 [CAPTION SPAN TITLE ${index + 1}] Classes: "${
                element.className
              }"`
            );
            console.log(
              `🔍 [CAPTION SPAN TITLE ${index + 1}] Parent: ${
                element.parentElement?.tagName
              }.${element.parentElement?.className}`
            );
          });

          // 2. Check if content extraction captures them
          const contentElement = findServiceNowContentElement();
          if (contentElement) {
            console.log(
              "🔍 [SPAN TITLE] Content element found:",
              contentElement.tagName
            );
            const contentSpanTitles =
              contentElement.querySelectorAll("span.title");
            console.log(
              `🔍 [SPAN TITLE] ${contentSpanTitles.length} span.title elements in content area`
            );

            const contentCaptionSpanTitles = contentElement.querySelectorAll(
              "caption > span.title, caption span.title"
            );
            console.log(
              `🔍 [CAPTION SPAN TITLE] ${contentCaptionSpanTitles.length} caption > span.title elements in content area`
            );

            // 3. Test bold conversion function specifically
            if (
              contentSpanTitles.length > 0 ||
              contentCaptionSpanTitles.length > 0
            ) {
              console.log("🔍 [SPAN TITLE] Testing bold conversion...");
              let testHtml = contentElement.innerHTML;
              const originalLength = testHtml.length;

              // Test the conversion
              testHtml = convertBoldClassToBoldText(testHtml);

              console.log(
                `🔍 [SPAN TITLE] HTML processed: ${originalLength} → ${testHtml.length} chars`
              );

              // Check if span.title was converted to strong
              const parser = new DOMParser();
              const doc = parser.parseFromString(testHtml, "text/html");
              const strongElements = doc.querySelectorAll(
                'strong.title, strong[class*="title"]'
              );
              console.log(
                `🔍 [SPAN TITLE] Found ${strongElements.length} strong.title elements after conversion`
              );

              strongElements.forEach((strong, index) => {
                console.log(
                  `🔍 [STRONG TITLE ${
                    index + 1
                  }] Text: "${strong.textContent.trim()}"`
                );
                console.log(
                  `🔍 [STRONG TITLE ${index + 1}] Classes: "${
                    strong.className
                  }"`
                );
              });
            }

            // 4. Test the recovery logic for missing span.title elements
            console.log("🔍 [SPAN TITLE] Testing recovery logic...");
            const pageSpanTitles = document.querySelectorAll("span.title");
            const contentSpanTitlesForRecovery =
              contentElement.querySelectorAll("span.title");

            console.log(
              `🔍 [RECOVERY] Page has ${pageSpanTitles.length} total span.title elements`
            );
            console.log(
              `🔍 [RECOVERY] Content area has ${contentSpanTitlesForRecovery.length} span.title elements`
            );

            if (contentSpanTitlesForRecovery.length < pageSpanTitles.length) {
              console.log(
                "⚠️ [RECOVERY] Some span.title elements would be missing from capture"
              );

              const missingSpanTitles = [];
              pageSpanTitles.forEach((spanTitle) => {
                const text = spanTitle.textContent.trim();
                let found = false;

                contentSpanTitlesForRecovery.forEach((captured) => {
                  if (captured.textContent.trim() === text) {
                    found = true;
                  }
                });

                if (!found) {
                  // Check if this span.title is in a caption that appears before a table
                  let isTableCaption = false;
                  let captionElement = spanTitle.closest("caption");

                  if (captionElement) {
                    // Check if this caption is inside a table (standard HTML structure)
                    let parentTable = captionElement.closest("table");
                    let nextElement = captionElement.nextElementSibling;
                    let parentNext =
                      captionElement.parentElement?.nextElementSibling;

                    if (
                      parentTable ||
                      (nextElement && nextElement.tagName === "TABLE") ||
                      (parentNext && parentNext.tagName === "TABLE")
                    ) {
                      isTableCaption = true;
                      console.log(
                        `📊 [RECOVERY] Table caption span.title: "${text}"`
                      );
                    }
                  }

                  missingSpanTitles.push({
                    element: spanTitle,
                    text: text,
                    isTableCaption: isTableCaption,
                  });
                  console.log(
                    `📝 [RECOVERY] Would recover: "${text}" ${
                      isTableCaption ? "(as h4 heading)" : "(as regular title)"
                    }`
                  );
                }
              });

              console.log(
                `✅ [RECOVERY] Would recover ${
                  missingSpanTitles.length
                } missing span.title elements (${
                  missingSpanTitles.filter((m) => m.isTableCaption).length
                } table captions)`
              );
            } else {
              console.log(
                "✅ [RECOVERY] All span.title elements are already captured"
              );
            }
          } else {
            console.log("❌ [SPAN TITLE] No content element found");
          }

          return {
            totalSpanTitles: spanTitleElements.length,
            totalCaptionSpanTitles: captionSpanTitleElements.length,
            contentSpanTitles: contentElement
              ? contentElement.querySelectorAll("span.title").length
              : 0,
            contentCaptionSpanTitles: contentElement
              ? contentElement.querySelectorAll(
                  "caption > span.title, caption span.title"
                ).length
              : 0,
            contentElementFound: !!contentElement,
            wouldNeedRecovery: contentElement
              ? document.querySelectorAll("span.title").length >
                contentElement.querySelectorAll("span.title").length
              : false,
            potentialMissingCount: contentElement
              ? document.querySelectorAll("span.title").length -
                contentElement.querySelectorAll("span.title").length
              : 0,
          };
        };

        console.log(
          "✅ Debug function 'debugContent()' is now available in console"
        );
        console.log(
          "✅ Debug function 'testCompleteFlow()' is now available in console"
        );

        try {
          registerMenuCommands();
          console.log(`✅ Menu commands registered successfully`);
        } catch (error) {
          console.error(`❌ Error registering menu commands:`, error);
        }

        // Add a simple indicator that the script is loaded and create UI
        if (
          window.location.hostname.includes("servicenow.com") ||
          window.location.hostname.includes("service-now.com") ||
          window.location.hostname.includes("service-now") ||
          window.location.hostname.includes("servicenow") ||
          window.location.hostname.includes("localhost")
        ) {
          debug(
            "✅ Ready to capture ServiceNow content for Universal Workflow"
          );
          console.log(
            "✅ ServiceNow/Test domain detected, ready for content capture"
          );

          // Auto-create UI panel for immediate access
          setTimeout(() => {
            try {
              console.log("🎨 Attempting to create UI...");
              // Migrate any old config values first so UI reflects migrated settings
              try {
                migrateOldConfig();
              } catch (e) {
                console.warn("Config migration check failed at startup:", e);
              }

              createUI();
              // Immediately update UI labels from config
              try {
                updateUIFromConfig();
              } catch (e) {
                console.warn("Failed to update UI after createUI:", e);
              }
              console.log("✅ UI created successfully");
            } catch (error) {
              console.error("❌ Error creating UI:", error);
            }
          }, 1000);
        } else {
          console.log(
            `ℹ️ Not on ServiceNow/Test domain (current: ${window.location.hostname}), skipping UI creation`
          );
        }
      } catch (functionError) {
        console.error("❌ Error exposing W2N functions:", functionError);
      }
    } catch (initError) {
      console.error("❌ Critical error during W2N initialization:", initError);
      console.log(
        "🔄 W2N will not interfere with page operation due to initialization error"
      );
    }

}

// Initialize when DOM is ready - with enhanced error protection
try {
console.log("🔄 W2N-SN2N Script Loading...");

    // Add a small delay to ensure ServiceNow has a chance to initialize first
    const initializeW2N = () => {
      try {
        if (document.readyState === "loading") {
          console.log("🔄 DOM still loading, waiting for DOMContentLoaded...");
          document.addEventListener("DOMContentLoaded", init);
        } else {
          console.log("🔄 DOM already loaded, initializing immediately...");
          init();
        }
      } catch (error) {
        console.error(
          "❌ Error during W2N initialization, will not interfere with page:",
          error
        );
      }
    };

    // Use a small timeout to let ServiceNow's critical scripts run first
    if (
      window.location.href.includes("servicenow.com") ||
      window.location.href.includes("service-now.com")
    ) {
      setTimeout(initializeW2N, 500);
    } else {
      // For localhost and other domains, initialize immediately
      initializeW2N();
    }

} catch (error) {
console.error(
"❌ Critical error during script initialization - W2N will not interfere:",
error
);
}

// Mark script as successfully loaded
window.W2N_SN2N_LOADED = true;
console.log("✅ W2N-SN2N Script Fully Loaded v6.16.2");
})();
