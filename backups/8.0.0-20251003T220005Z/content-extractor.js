// Content Extraction Module - HTML content extraction and processing

import { debug, getConfig } from "../config.js";
import { constructServiceNowBaseUrl } from "./metadata-extractor.js";

/**
 * Extract content with iframe processing
 * @param {HTMLElement} contentElement - Main content element or iframe
 * @returns {Object} Object with combinedHtml and combinedImages
 */
export async function extractContentWithIframes(contentElement) {
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
 * Extract readable content from iframe srcdoc attributes
 * @param {HTMLElement} containerElement - Container to search for iframes
 * @returns {string} Extracted content HTML
 */
export function extractContentFromIframes(containerElement) {
  if (!containerElement) return "";

  const iframes = containerElement.querySelectorAll("iframe[srcdoc]");
  let extractedContent = "";

  debug(`📄 Found ${iframes.length} iframes with srcdoc content`);

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
        debug(
          `📄 Extracted content from iframe ${index + 1}, length: ${
            textContent.length
          }`
        );
      }
    }
  });

  // If no iframe content found, return the original HTML
  if (!extractedContent.trim()) {
    debug("📄 No iframe content extracted, using original HTML");
    return containerElement.outerHTML;
  }

  return extractedContent;
}

/**
 * Find the best content selector for the current page
 * @returns {HTMLElement|null} The content element or null if not found
 */
export function findContentElement() {
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

/**
 * Clean HTML content by removing unwanted elements and fixing common issues
 * @param {string} htmlContent - Raw HTML content
 * @returns {string} Cleaned HTML content
 */
export function cleanHtmlContent(htmlContent) {
  if (!htmlContent || typeof htmlContent !== "string") {
    return "";
  }

  try {
    // Create a temporary document to manipulate HTML safely
    const doc = new DOMParser().parseFromString(htmlContent, "text/html");

    // Remove unwanted elements
    const unwantedSelectors = [
      "script",
      "style",
      "meta",
      'link[rel="stylesheet"]',
      ".advertisement",
      ".ads",
      ".sidebar",
      ".navigation",
      ".breadcrumb",
      ".search",
      '[class*="search"]',
      "button",
      "input",
      "form",
      ".skip-link",
    ];

    unwantedSelectors.forEach((selector) => {
      const elements = doc.querySelectorAll(selector);
      elements.forEach((el) => el.remove());
    });

    // Remove empty paragraphs and divs
    const emptyElements = doc.querySelectorAll(
      "p:empty, div:empty, span:empty"
    );
    emptyElements.forEach((el) => el.remove());

    // Remove elements with only whitespace
    const textNodes = doc.querySelectorAll("p, div, span");
    textNodes.forEach((el) => {
      if (el.textContent.trim() === "" && el.children.length === 0) {
        el.remove();
      }
    });

    // Clean up image references
    const images = doc.querySelectorAll("img");
    images.forEach((img) => {
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

    debug(`✅ HTML content cleaned successfully`);
    return doc.body.innerHTML;
  } catch (error) {
    debug("❌ Error cleaning HTML content:", error);
    return htmlContent; // Return original if cleaning fails
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

/**
 * Process and normalize image elements within content
 * @param {HTMLElement} imgElement - Image element to process
 * @param {string} baseUrl - Base URL for resolving relative paths
 * @returns {Object} Processed image data
 */
export function processImageElement(imgElement, baseUrl = null) {
  if (!imgElement || imgElement.tagName !== "IMG") {
    return null;
  }

  try {
    const src =
      imgElement.src ||
      imgElement.getAttribute("data-src") ||
      imgElement.getAttribute("src");
    const alt = imgElement.alt || imgElement.getAttribute("alt") || "";
    const width = imgElement.width || imgElement.getAttribute("width");
    const height = imgElement.height || imgElement.getAttribute("height");

    // Skip invalid or placeholder images
    if (
      !src ||
      src.includes("data:image/svg+xml") ||
      src.includes("[Invalid Image:")
    ) {
      debug(`🚫 Skipping invalid image: ${src}`);
      return null;
    }

    // Normalize the URL
    let normalizedUrl = src;
    if (baseUrl && src.startsWith("../")) {
      // Handle relative paths
      normalizedUrl = new URL(src, baseUrl).href;
    } else if (baseUrl && !src.startsWith("http")) {
      // Handle absolute paths without protocol
      normalizedUrl = new URL(src, baseUrl).href;
    }

    debug(`🖼️ Processed image: ${normalizedUrl}`);

    return {
      url: normalizedUrl,
      originalUrl: src,
      alt: alt,
      width: width ? parseInt(width) : null,
      height: height ? parseInt(height) : null,
      baseUrl: baseUrl,
    };
  } catch (error) {
    debug(`❌ Error processing image element: ${error.message}`);
    return null;
  }
}

/**
 * Extract all images from content with processing
 * @param {HTMLElement|string} content - Content element or HTML string
 * @param {string} baseUrl - Base URL for resolving relative paths
 * @returns {Array} Array of processed image objects
 */
export function extractImages(content, baseUrl = null) {
  try {
    let element = content;

    // If content is a string, parse it
    if (typeof content === "string") {
      const tempDiv = document.createElement("div");
      tempDiv.innerHTML = content;
      element = tempDiv;
    }

    const images = Array.from(element.querySelectorAll("img"));
    const processedImages = images
      .map((img) => processImageElement(img, baseUrl))
      .filter(Boolean); // Remove null results

    debug(`🖼️ Extracted ${processedImages.length} valid images from content`);
    return processedImages;
  } catch (error) {
    debug(`❌ Error extracting images: ${error.message}`);
    return [];
  }
}
