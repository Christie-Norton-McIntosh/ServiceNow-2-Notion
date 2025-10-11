// W2NSavingProgress overlay module - self-contained progress UI

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

// --- Internal state ---
let state = {
  opened: false,
  onClose: null,
  retryCallback: null,
  autoCloseMs: null,
};

// Forward declaration for modal injection
let injectPropertyMappingModal = null;

export function setPropertyMappingModalInjector(injector) {
  injectPropertyMappingModal = injector;
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
    if (injectPropertyMappingModal) {
      injectPropertyMappingModal();
    }
  });

  document.documentElement.appendChild(overlay);
  return overlay;
}

export const overlayModule = {
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

// Expose to window for compatibility
export function attachToWindow() {
  try {
    Object.defineProperty(window, "W2NSavingProgress", {
      value: overlayModule,
      configurable: false,
      writable: false,
    });
  } catch (e) {
    window.W2NSavingProgress = overlayModule;
  }
}
