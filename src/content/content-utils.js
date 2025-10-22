// Content Processing Utilities - Text processing and content manipulation

import { debug } from "../config.js";

/**
 * Wait for lazy-loaded content to appear on ServiceNow pages
 * Scrolls to bottom and waits for dynamic content to load
 * @param {number} maxWaitMs - Maximum time to wait in milliseconds
 * @returns {Promise<void>}
 */
export async function waitForLazyContent(maxWaitMs = 3000) {
  debug("🔄 Waiting for lazy-loaded content...");
  
  try {
    // Store original scroll position
    const originalScrollY = window.scrollY;
    
    // Get initial content length
    const contentElement = document.querySelector('.zDocsTopicPageBody, [role="main"], main, article');
    if (!contentElement) {
      debug("⚠️ No content element found for lazy-load detection");
      return;
    }
    
    let previousLength = contentElement.innerHTML.length;
    let stableCount = 0;
    const requiredStableChecks = 2; // Content must be stable for 2 checks
    const checkInterval = 500; // Check every 500ms
    const maxChecks = Math.floor(maxWaitMs / checkInterval);
    
    // Scroll to bottom to trigger lazy loading
    debug("📜 Scrolling to bottom to trigger lazy loading...");
    window.scrollTo(0, document.body.scrollHeight);
    
    // Wait for content to stabilize
    for (let i = 0; i < maxChecks; i++) {
      await new Promise(resolve => setTimeout(resolve, checkInterval));
      
      const currentLength = contentElement.innerHTML.length;
      
      if (currentLength === previousLength) {
        stableCount++;
        if (stableCount >= requiredStableChecks) {
          debug(`✅ Content stable at ${currentLength} chars after ${(i + 1) * checkInterval}ms`);
          break;
        }
      } else {
        debug(`🔄 Content changed: ${previousLength} → ${currentLength} chars`);
        stableCount = 0;
        previousLength = currentLength;
      }
    }
    
    // Restore original scroll position
    window.scrollTo(0, originalScrollY);
    debug("✅ Lazy content loading complete");
    
  } catch (error) {
    debug("⚠️ Error waiting for lazy content:", error);
    // Non-fatal, continue with extraction
  }
}

/**
 * Get all text nodes from a DOM node
 * @param {Node} node - DOM node to traverse
 * @returns {Text[]} Array of text nodes
 */
export function getTextNodes(node) {
  const textNodes = [];

  function traverse(currentNode) {
    if (currentNode.nodeType === Node.TEXT_NODE) {
      textNodes.push(currentNode);
    } else {
      for (const child of currentNode.childNodes) {
        traverse(child);
      }
    }
  }

  traverse(node);
  return textNodes;
}

/**
 * Normalize whitespace and clean up text content
 * @param {string} text - Text to normalize
 * @returns {string} Normalized text
 */
export function normalizeText(text) {
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
export function extractPlainText(content) {
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
export function countWords(text) {
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
export function estimateReadingTime(text, wordsPerMinute = 200) {
  const wordCount = countWords(text);
  return Math.ceil(wordCount / wordsPerMinute);
}

/**
 * Extract and clean table data
 * @param {HTMLElement} table - Table element
 * @returns {Object} Processed table data
 */
export function processTable(table) {
  if (!table || table.tagName !== "TABLE") {
    return null;
  }

  try {
    const rows = Array.from(table.querySelectorAll("tr"));
    const processedRows = rows.map((row) => {
      const cells = Array.from(row.querySelectorAll("td, th"));
      return cells.map((cell) => normalizeText(cell.textContent || ""));
    });

    // Separate header and body rows
    const headerRow = processedRows.length > 0 ? processedRows[0] : [];
    const bodyRows = processedRows.slice(1);

    return {
      headers: headerRow,
      rows: bodyRows,
      rowCount: bodyRows.length,
      columnCount: headerRow.length,
    };
  } catch (error) {
    debug("❌ Error processing table:", error);
    return null;
  }
}

/**
 * Extract and process list items
 * @param {HTMLElement} list - List element (ul, ol)
 * @returns {Object} Processed list data
 */
export function processList(list) {
  if (!list || !["UL", "OL"].includes(list.tagName)) {
    return null;
  }

  try {
    const items = Array.from(list.querySelectorAll("li"));
    const processedItems = items.map((item) => ({
      text: normalizeText(item.textContent || ""),
      hasNestedList: item.querySelector("ul, ol") !== null,
    }));

    return {
      type: list.tagName.toLowerCase(),
      items: processedItems,
      itemCount: processedItems.length,
    };
  } catch (error) {
    debug("❌ Error processing list:", error);
    return null;
  }
}

/**
 * Extract headings and create a content outline
 * @param {HTMLElement|string} content - Content element or HTML string
 * @returns {Array} Array of heading objects with hierarchy
 */
export function extractContentOutline(content) {
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
export function splitContentIntoSections(content) {
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
 * Remove duplicate content sections
 * @param {Array} sections - Array of content sections
 * @returns {Array} Deduplicated sections
 */
export function removeDuplicateSections(sections) {
  if (!Array.isArray(sections)) {
    return [];
  }

  const seen = new Set();
  return sections.filter((section) => {
    const key = section.heading?.text || section.content.substring(0, 100);
    const normalizedKey = normalizeText(key).toLowerCase();

    if (seen.has(normalizedKey)) {
      return false;
    }

    seen.add(normalizedKey);
    return true;
  });
}

/**
 * Extract links and their context
 * @param {HTMLElement|string} content - Content element or HTML string
 * @returns {Array} Array of link objects
 */
export function extractLinks(content) {
  try {
    let element = content;

    if (typeof content === "string") {
      const tempDiv = document.createElement("div");
      tempDiv.innerHTML = content;
      element = tempDiv;
    }

    const links = Array.from(element.querySelectorAll("a[href]"));

    return links.map((link) => ({
      href: link.href,
      text: normalizeText(link.textContent || ""),
      title: link.title || "",
      target: link.target || "",
      isExternal: link.hostname !== window.location.hostname,
      context: normalizeText(
        link.parentElement?.textContent?.substring(0, 100) || ""
      ),
    }));
  } catch (error) {
    debug("❌ Error extracting links:", error);
    return [];
  }
}

/**
 * Calculate content statistics
 * @param {string|HTMLElement} content - Content to analyze
 * @returns {Object} Content statistics
 */
export function analyzeContent(content) {
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
