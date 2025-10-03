// ServiceNow Metadata Extraction Module

import { debug, getCustomSelectors } from "../config.js";

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
export function extractServiceNowMetadata() {
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
 * Extract author information from various text patterns
 * @returns {string} Author name if found
 */
export function extractAuthorFromText() {
  debug("👤 Extracting author from text patterns...");

  try {
    // Look for common author patterns in text
    const textContent = document.body.textContent || "";

    // Pattern 1: "By [Name]" or "Author: [Name]"
    const byPattern = /(?:By|Author):\s*([A-Z][a-z]+(?:\s+[A-Z][a-z]+)*)/i;
    let match = textContent.match(byPattern);
    if (match) {
      debug("✅ Found author via 'By/Author' pattern:", match[1]);
      return match[1].trim();
    }

    // Pattern 2: "Written by [Name]" or "Created by [Name]"
    const writtenPattern =
      /(?:Written|Created)\s+by\s+([A-Z][a-z]+(?:\s+[A-Z][a-z]+)*)/i;
    match = textContent.match(writtenPattern);
    if (match) {
      debug("✅ Found author via 'Written/Created by' pattern:", match[1]);
      return match[1].trim();
    }

    // Pattern 3: Look in meta tags
    const authorMeta = document.querySelector('meta[name="author"]');
    if (authorMeta && authorMeta.content) {
      debug("✅ Found author in meta tag:", authorMeta.content);
      return authorMeta.content.trim();
    }

    debug("❌ No author found via text patterns");
    return "";
  } catch (error) {
    debug("❌ Error extracting author from text:", error);
    return "";
  }
}

/**
 * Construct ServiceNow base URL for relative paths
 * @returns {string} Base URL
 */
export function constructServiceNowBaseUrl() {
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
