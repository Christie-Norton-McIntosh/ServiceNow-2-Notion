// Content Extraction Module - HTML content extraction and processing

import { debug, getConfig } from "../config.js";
import { constructServiceNowBaseUrl } from "./metadata-extractor.js";

/**
 * Extract content with iframe processing
 * @param {HTMLElement} contentElement - Main content element or iframe
 * @returns {Object} Object with combinedHtml and combinedImages
 */
export async function extractContentWithIframes(contentElement) {
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
  
  // Historically we filtered out 'Related Content' here in the userscript to reduce AUDIT noise.
  // That caused legitimate Related Content to be dropped before server-side processing.
  // New behavior (v11.0.231+): only strip the *Mini TOC* ("On this page") from userscript extraction.
  // Keep actual "Related Content" sections so the server can decide how to render them.
  const contentPlaceholders = tempDiv.querySelectorAll('.contentPlaceholder');
  let removedCount = 0;
  contentPlaceholders.forEach(cp => {
    const headings = cp.querySelectorAll('h1, h2, h3, h4, h5, h6');
    const hasOnThisPage = Array.from(headings).some(h => {
      const t = h.textContent.trim().toLowerCase();
      return t === 'on this page';
    });

    if (hasOnThisPage) {
      debug(`🗑️ Filtering out Mini TOC (On this page) from userscript extraction`);
      cp.remove();
      removedCount++;
    }
  });

  if (removedCount > 0) {
    combinedHtml = tempDiv.innerHTML;
    debug(`✅ Filtered out ${removedCount} Mini TOC contentPlaceholder(s) in userscript`);
  }

  return { combinedHtml, combinedImages };
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
 * Find all content sections and combine them
 * @returns {HTMLElement|null} Combined content element or null if not found
 */
export function findAllContentElements() {
  debug("🔍 Searching for all content elements...");

  const allContentElements = [];
  let mainContent = null;

  // First, try to find the main content element
  mainContent = findContentElement();
  if (mainContent) {
    allContentElements.push(mainContent);
  }

  // Then look for additional sections that might contain code blocks
  const additionalSelectors = [
    "[id*='customize-script-includes']", // ServiceNow script includes sections
    "section[id]", // Any section with an ID
    ".code-toolbar", // Code toolbar elements
    "pre", // Pre elements
  ];

  for (const selector of additionalSelectors) {
    try {
      const elements = document.querySelectorAll(selector);
      for (const element of elements) {
        if (
          element &&
          element.innerHTML &&
          element.innerHTML.trim().length > 10 &&
          !allContentElements.includes(element) &&
          !allContentElements.some((parent) => parent.contains(element)) &&
          // Filter out UI elements that are unlikely to contain documentation
          !element.id?.includes("nav") &&
          !element.id?.includes("header") &&
          !element.id?.includes("modal") &&
          !element.id?.includes("feedback") &&
          !element.id?.includes("walkme") &&
          !element.id?.includes("ZN_") &&
          !element.className?.includes("nav") &&
          !element.className?.includes("header") &&
          !element.className?.includes("modal") &&
          !element.className?.includes("feedback")
        ) {
          debug(
            `✅ Found additional content element: ${selector} (id: ${
              element.id || "no-id"
            })`
          );
          allContentElements.push(element);
        }
      }
    } catch (e) {
      debug(`❌ Invalid additional selector: ${selector}`);
    }
  }

  if (allContentElements.length === 0) {
    debug("❌ No content elements found");
    return null;
  }

  if (allContentElements.length === 1) {
    return allContentElements[0];
  }

  // Combine multiple elements into a single container
  debug(`🔄 Combining ${allContentElements.length} content elements`);
  const combinedContainer = document.createElement("div");
  combinedContainer.className = "combined-content";

  allContentElements.forEach((element, index) => {
    const sectionWrapper = document.createElement("div");
    sectionWrapper.className = `content-section-${index}`;
    sectionWrapper.innerHTML = element.innerHTML;
    combinedContainer.appendChild(sectionWrapper);
  });

  debug(
    `✅ Combined content length: ${combinedContainer.innerHTML.length} characters`
  );
  return combinedContainer;
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
