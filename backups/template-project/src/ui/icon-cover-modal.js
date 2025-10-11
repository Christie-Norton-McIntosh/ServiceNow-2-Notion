// Icon and Cover Selection Modal - Image selection UI

import { debug } from "../config.js";
import {
  searchUnsplashImages,
  getDefaultUnsplashImages,
} from "../api/proxy-api.js";

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
export function injectIconCoverModal() {
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
export function setupIconCoverModal(modal) {
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
