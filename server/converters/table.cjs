/**
 * @fileoverview Table Converter for Notion blocks
 * 
 * This module provides utilities for converting HTML tables to Notion's table format,
 * handling complex table structures, captions, headers, and content processing.
 * 
 * Key Features:
 * - HTML table parsing with thead/tbody structure preservation
 * - Table caption extraction and conversion to heading blocks
 * - Rich text processing for table cell content
 * - Image extraction from table cells and placement as separate blocks
 * - Table deduplication to prevent duplicate content
 * - Support for nested lists within table cells
 * - Smart icon detection: converts yes/no/check/cross icons to emojis (✅/❌)
 * 
 * Dependencies:
 * - server/utils/notion-format.cjs (cleanHtmlText)
 * - server/converters/rich-text.cjs (convertRichTextBlock)
 * - server/utils/url.cjs (convertServiceNowUrl, isValidImageUrl)
 * 
 * @module converters/table
 * @since 8.2.5
 */

const { cleanHtmlText } = require("../utils/notion-format.cjs");
const { convertServiceNowUrl } = require("../utils/url.cjs");
const cheerio = require('cheerio');

/**
 * Converts HTML table content to Notion table block array.
 * 
 * This function processes HTML table markup and converts it to Notion's table format,
 * preserving structure, headers, and content formatting. It handles table captions,
 * thead/tbody sections, nested lists, images, and complex formatting within cells.
 * 
 * @async
 * @param {string} tableHtml - HTML string containing the table markup to convert
 * @param {object} [options={}] - Conversion options for customizing behavior
 * @param {boolean} [options.preserveImages=false] - Whether to preserve images (default: convert to bullets)
 * @param {boolean} [options.extractCaptions=true] - Whether to extract table captions as headings
 * @param {boolean} [options.processLists=true] - Whether to convert nested lists to bullet points
 * 
 * @returns {Promise<Array<object>|null>} Array of Notion blocks (heading + table), or null if no valid table found
 * 
 * @example
 * // Convert simple HTML table
 * const tableBlocks = await convertTableBlock(`
 *   <table>
 *     <thead><tr><th>Name</th><th>Value</th></tr></thead>
 *     <tbody><tr><td>Item 1</td><td>100</td></tr></tbody>
 *   </table>
 * `);
 * // Returns: [{ type: "table", table: { has_column_header: true, children: [...] } }]
 * 
 * @example
 * // Table with caption becomes heading + table
 * const tableBlocks = await convertTableBlock(`
 *   <table>
 *     <caption>Product Comparison</caption>
 *     <tr><td>Feature A</td><td>Available</td></tr>
 *   </table>
 * `);
 * // Returns: [
 * //   { type: "heading_3", heading_3: { rich_text: [...] } },
 * //   { type: "table", table: { children: [...] } }
 * // ]
 * 
 * @throws {Error} If table processing fails due to malformed HTML
 * @see {@link deduplicateTableBlocks} for removing duplicate tables from arrays
 */
async function convertTableBlock(tableHtml, options = {}) {
  // Remove table dropdown/filter elements
  let cleanedTableHtml = tableHtml.replace(
    /<div[^>]*class="[^\"]*zDocsFilterTableDiv[^\"]*"[^>]*>[\s\S]*?<\/div>/gi,
    ""
  );
  cleanedTableHtml = cleanedTableHtml.replace(
    /<div[^>]*class="[^\"]*smartTable[^\"]*"[^>]*>[\s\S]*?<\/div>/gi,
    ""
  );
  
  // Remove table export buttons (Export to Excel/CSV dropdowns)
  cleanedTableHtml = cleanedTableHtml.replace(
    /<button[^>]*class="[^\"]*(?:zDocsTopicPageTableExportButton|zDocsTopicPageTableExportMenu|dropdown-item)[^\"]*"[^>]*>[\s\S]*?<\/button>/gi,
    ""
  );

  // Images in tables will be extracted and placed as separate blocks after the table
  // (removed the global image-to-bullet replacement)
  
  // Array to collect all images found in table cells
  const extractedImages = [];

  // Extract table caption if present
  const captionRegex = /<caption[^>]*>([\s\S]*?)<\/caption>/i;
  const captionMatch = cleanedTableHtml.match(captionRegex);
  const blocks = [];
  if (captionMatch) {
    let captionContent = captionMatch[1];
    // Preserve the table title label (e.g., "Table 1.") instead of stripping it
    // so that validation expects like "Table 1. Empty state..." match exactly.
    let titleLabel = '';
    captionContent = captionContent.replace(
      /<span[^>]*class="[^"]*table--title-label[^"]*"[^>]*>([\s\S]*?)<\/span>/gi,
      (m, p1) => {
        titleLabel = cleanHtmlText(p1 || '');
        return '';
      }
    );
    const captionBody = cleanHtmlText(captionContent);
    const captionText = (titleLabel ? `${titleLabel} ` : '') + (captionBody || '');
    if (captionText && captionText.trim()) {
      blocks.push({
        object: "block",
        type: "heading_3",
        heading_3: {
          rich_text: [{ type: "text", text: { content: captionText } }],
        },
      });
    }
  }

  // Extract thead and tbody sections separately
  // Helper to process table cell content
  async function processTableCellContent(html) {
    if (!html) return [{ type: "text", text: { content: "" } }];
    
    // Debug: Log if cell contains span tags
    if (html.includes('<span') && html.includes('ph')) {
      console.log(`📊 Table cell contains <span class="ph"> tag: "${html.substring(0, 100)}..."`);
    }
    
    // Load HTML into Cheerio for better parsing
    const $ = cheerio.load(html, { decodeEntities: true });
    
    // Extract images - check both standalone img tags and figures with figcaption
    // Use non-global regex and match() instead of exec() to avoid regex state issues
    const figures = html.match(/<figure[^>]*>[\s\S]*?<\/figure>/gi) || [];
    
    // Track which images will actually be included in Notion upload
    const validImageUrls = new Set();
    
    // Process each figure
    for (const figureHtml of figures) {
      // Extract img src from within figure
      const imgMatch = /<img[^>]*src=["']([^"']*)["'][^>]*>/i.exec(figureHtml);
      if (imgMatch) {
        let src = imgMatch[1];
        const originalSrc = src; // Track original URL to match against HTML
        
        // Extract figcaption text
        const captionMatch = /<figcaption[^>]*>([\s\S]*?)<\/figcaption>/i.exec(figureHtml);
        const caption = captionMatch ? cleanHtmlText(captionMatch[1]) : '';
        
        // Convert ServiceNow URLs to proper format
        src = convertServiceNowUrl(src);

        // Determine if we should include this image:
        // - Prefer including all ServiceNow-hosted images (we'll upload them)
        // - Otherwise, include if a global URL validator approves
        const isServiceNowImage = /servicenow\.(com|net)/i.test(src);
        let include = false;
        try {
          if (isServiceNowImage) {
            include = true;
          } else if (typeof isValidImageUrl === 'function') {
            include = !!isValidImageUrl(src);
          } else {
            // Fallback: basic check for absolute http(s)
            include = /^https?:\/\//i.test(src);
          }
        } catch (_) {
          include = false;
        }

        if (src && include) {
          extractedImages.push({ src, alt: caption });
          validImageUrls.add(originalSrc); // Track original URL for matching
        }
      }
    }
    
    // Check for standalone img tags (not in figures)
    const standaloneImages = html.match(/<img[^>]*src=["']([^"']*)["'][^>]*>/gi) || [];
    const figureImgCount = figures.length;
    
    // Only process standalone images that are not already in figures
    if (standaloneImages.length > figureImgCount) {
      // Process standalone images...
    }
    
    // Replace figures/images with appropriate placeholders
    // Use "See [caption]" or "See image below" only if the image is being included in Notion
    // Otherwise use bullet placeholder
    let processedHtml = html;
    
    // Replace entire figure elements with appropriate placeholder
    processedHtml = processedHtml.replace(/<figure[^>]*>([\s\S]*?)<\/figure>/gi, (match) => {
      // Check if this figure's image is valid and will be included
      const imgMatch = /<img[^>]*src=["']([^"']*)["'][^>]*>/i.exec(match);
      const isValidImage = imgMatch && validImageUrls.has(imgMatch[1]);
      
      if (isValidImage) {
        // Image will be included - use descriptive placeholder
        const captionMatch = /<figcaption[^>]*>([\s\S]*?)<\/figcaption>/i.exec(match);
        if (captionMatch) {
          const caption = cleanHtmlText(captionMatch[1]);
          return ` See "${caption}" `;
        }
        return ' See image below ';
      } else {
        // Image won't be included - use bullet placeholder
        return ' • ';
      }
    });
    
    // Replace any remaining standalone img tags
    // First, detect yes/no icons and replace with emojis
    // Then use bullet placeholder for other images
    if (/<img[^>]*>/i.test(processedHtml)) {
      processedHtml = processedHtml.replace(/<img([^>]*)>/gi, (match, attrs) => {
        // Extract alt text and src for pattern matching
        const altMatch = /alt=["']([^"']*)["']/i.exec(attrs);
        const srcMatch = /src=["']([^"']*)["']/i.exec(attrs);
        const widthMatch = /width=["']?(\d+)["']?/i.exec(attrs);
        const heightMatch = /height=["']?(\d+)["']?/i.exec(attrs);
        
        const alt = altMatch ? altMatch[1].toLowerCase() : '';
        const src = srcMatch ? srcMatch[1].toLowerCase() : '';
        const width = widthMatch ? parseInt(widthMatch[1]) : 0;
        const height = heightMatch ? parseInt(heightMatch[1]) : 0;
        
        // Check if this is a small icon (typical icons are <= 32px)
        const isSmallIcon = (width > 0 && width <= 32) || (height > 0 && height <= 32);
        
        // Icon pattern definitions: [patterns, emoji, label]
        const iconTypes = [
          // YES/CHECK/AVAILABLE - Priority 1
          {
            patterns: [
              /\b(yes|check|tick|available|enabled|true|success|valid|confirmed?|approved?|active)\b/i,
              /\b(green.*check|checkmark|check.*mark)\b/i,
              /\/(?:yes|check|tick|available|enabled|success|valid|ok|active)\.[a-z]{3,4}$/i
            ],
            emoji: '✅',
            label: 'YES/CHECK'
          },
          // NO/CROSS/UNAVAILABLE - Priority 1
          {
            patterns: [
              /\b(no|cross|unavailable|disabled|false|error|invalid|denied|rejected|inactive)\b/i,
              /\b(red.*cross|x.*mark|cross.*mark)\b/i,
              /\/(?:no|cross|error|invalid|disabled|unavailable|inactive)\.[a-z]{3,4}$/i
            ],
            emoji: '❌',
            label: 'NO/CROSS'
          },
          // WARNING/CAUTION - Priority 2
          {
            patterns: [
              /\b(warning|caution|alert|attention|important)\b/i,
              /\b(yellow.*triangle|warning.*triangle|exclamation.*triangle)\b/i,
              /\/(?:warning|caution|alert|important)\.[a-z]{3,4}$/i
            ],
            emoji: '⚠️',
            label: 'WARNING'
          },
          // INFO/NOTE - Priority 2
          {
            patterns: [
              /\b(info|information|note|notice|fyi)\b/i,
              /\b(blue.*circle|info.*circle|information.*icon)\b/i,
              /\/(?:info|information|note|notice)\.[a-z]{3,4}$/i
            ],
            emoji: 'ℹ️',
            label: 'INFO'
          },
          // TIP/LIGHTBULB - Priority 2
          {
            patterns: [
              /\b(tip|hint|suggestion|lightbulb|idea|best.*practice)\b/i,
              /\/(?:tip|hint|lightbulb|idea)\.[a-z]{3,4}$/i
            ],
            emoji: '💡',
            label: 'TIP'
          },
          // HELP/QUESTION - Priority 2
          {
            patterns: [
              /\b(help|question|\?|support|assistance)\b/i,
              /\/(?:help|question|support)\.[a-z]{3,4}$/i
            ],
            emoji: '❓',
            label: 'HELP'
          },
          // SECURITY/LOCK - Priority 3
          {
            patterns: [
              /\b(lock|locked|security|secure|protected|private|encrypted?)\b/i,
              /\/(?:lock|security|secure|private)\.[a-z]{3,4}$/i
            ],
            emoji: '🔒',
            label: 'SECURITY'
          },
          // UNLOCK/OPEN - Priority 3
          {
            patterns: [
              /\b(unlock|unlocked|open|public|unprotected)\b/i,
              /\/(?:unlock|open|public)\.[a-z]{3,4}$/i
            ],
            emoji: '🔓',
            label: 'UNLOCK'
          },
          // SETTINGS/GEAR - Priority 3
          {
            patterns: [
              /\b(settings?|config|configuration|gear|preferences?|options?)\b/i,
              /\/(?:settings?|config|gear|preferences?)\.[a-z]{3,4}$/i
            ],
            emoji: '⚙️',
            label: 'SETTINGS'
          },
          // EDIT/PENCIL - Priority 3
          {
            patterns: [
              /\b(edit|pencil|modify|change|update)\b/i,
              /\/(?:edit|pencil|modify)\.[a-z]{3,4}$/i
            ],
            emoji: '✏️',
            label: 'EDIT'
          },
          // DELETE/TRASH - Priority 3
          {
            patterns: [
              /\b(delete|trash|remove|discard|bin)\b/i,
              /\/(?:delete|trash|remove|bin)\.[a-z]{3,4}$/i
            ],
            emoji: '🗑️',
            label: 'DELETE'
          },
          // SEARCH/FIND - Priority 3
          {
            patterns: [
              /\b(search|find|lookup|magnif|glass)\b/i,
              /\/(?:search|find|lookup)\.[a-z]{3,4}$/i
            ],
            emoji: '🔍',
            label: 'SEARCH'
          },
          // DOWNLOAD - Priority 3
          {
            patterns: [
              /\b(download|down.*arrow|save)\b/i,
              /\/(?:download|down.*arrow)\.[a-z]{3,4}$/i
            ],
            emoji: '⬇️',
            label: 'DOWNLOAD'
          },
          // UPLOAD - Priority 3
          {
            patterns: [
              /\b(upload|up.*arrow)\b/i,
              /\/(?:upload|up.*arrow)\.[a-z]{3,4}$/i
            ],
            emoji: '⬆️',
            label: 'UPLOAD'
          },
          // LINK/CHAIN - Priority 3
          {
            patterns: [
              /\b(link|chain|url|hyperlink|connection)\b/i,
              /\/(?:link|chain|url)\.[a-z]{3,4}$/i
            ],
            emoji: '🔗',
            label: 'LINK'
          },
          // USER/PERSON - Priority 3
          {
            patterns: [
              /\b(user|person|profile|account|individual)\b/i,
              /\/(?:user|person|profile|account)\.[a-z]{3,4}$/i
            ],
            emoji: '👤',
            label: 'USER'
          },
          // GROUP/PEOPLE - Priority 3
          {
            patterns: [
              /\b(group|people|team|users|members)\b/i,
              /\/(?:group|people|team|users)\.[a-z]{3,4}$/i
            ],
            emoji: '👥',
            label: 'GROUP'
          },
          // STAR/FAVORITE - Priority 3
          {
            patterns: [
              /\b(star|favorite|favourite|bookmark|featured)\b/i,
              /\/(?:star|favorite|favourite|bookmark)\.[a-z]{3,4}$/i
            ],
            emoji: '⭐',
            label: 'STAR'
          },
          // FLAG - Priority 3
          {
            patterns: [
              /\b(flag|marker|marked)\b/i,
              /\/(?:flag|marker)\.[a-z]{3,4}$/i
            ],
            emoji: '🚩',
            label: 'FLAG'
          },
          // CALENDAR/DATE - Priority 3
          {
            patterns: [
              /\b(calendar|date|schedule|appointment)\b/i,
              /\/(?:calendar|date|schedule)\.[a-z]{3,4}$/i
            ],
            emoji: '📅',
            label: 'CALENDAR'
          },
          // CLOCK/TIME - Priority 3
          {
            patterns: [
              /\b(clock|time|timer|hour|minute)\b/i,
              /\/(?:clock|time|timer)\.[a-z]{3,4}$/i
            ],
            emoji: '⏰',
            label: 'CLOCK'
          },
          // FILE/DOCUMENT - Priority 3
          {
            patterns: [
              /\b(file|document|doc|page|paper)\b/i,
              /\/(?:file|document|doc|page)\.[a-z]{3,4}$/i
            ],
            emoji: '📄',
            label: 'FILE'
          },
          // FOLDER/DIRECTORY - Priority 3
          {
            patterns: [
              /\b(folder|directory|dir)\b/i,
              /\/(?:folder|directory|dir)\.[a-z]{3,4}$/i
            ],
            emoji: '📁',
            label: 'FOLDER'
          },
          // EMAIL/MAIL - Priority 3
          {
            patterns: [
              /\b(email|mail|message|envelope)\b/i,
              /\/(?:email|mail|message|envelope)\.[a-z]{3,4}$/i
            ],
            emoji: '📧',
            label: 'EMAIL'
          },
          // PHONE - Priority 3
          {
            patterns: [
              /\b(phone|telephone|call|mobile)\b/i,
              /\/(?:phone|telephone|call|mobile)\.[a-z]{3,4}$/i
            ],
            emoji: '📞',
            label: 'PHONE'
          },
          // HOME - Priority 3
          {
            patterns: [
              /\b(home|house|main|dashboard)\b/i,
              /\/(?:home|house|main|dashboard)\.[a-z]{3,4}$/i
            ],
            emoji: '🏠',
            label: 'HOME'
          }
        ];
        
        // Try to match icon type by checking patterns (prioritize src over alt)
        // First pass: check if src (filename) matches any pattern
        let detectedIcon = null;
        for (const iconType of iconTypes) {
          const srcMatches = iconType.patterns.some(pattern => pattern.test(src));
          if (srcMatches) {
            detectedIcon = iconType;
            break; // Use first src match
          }
        }
        
        // Second pass: if no src match, check alt text
        if (!detectedIcon) {
          for (const iconType of iconTypes) {
            const altMatches = iconType.patterns.some(pattern => pattern.test(alt));
            if (altMatches) {
              detectedIcon = iconType;
              break; // Use first alt match
            }
          }
        }
        
        // If detected, use the emoji
        if (detectedIcon) {
          const filename = src.substring(src.lastIndexOf('/') + 1, src.length);
          console.log(`✨ Detected ${detectedIcon.label} icon (alt="${alt}", src="${filename}", ${width}x${height}px) → replacing with ${detectedIcon.emoji}`);
          return ` ${detectedIcon.emoji} `;
        }
        
        // Fallback: if small icon without specific pattern, assume positive/yes
        if (isSmallIcon) {
          console.log(`✨ Detected small icon (alt="${alt}", src="${src.substring(src.lastIndexOf('/') + 1)}", ${width}x${height}px) → defaulting to ✅`);
          return ' ✅ ';
        }
        
        // Generic image - use bullet placeholder
        return ' • ';
      });
    }
    
    // Handle note callouts in table cells - strip the wrapper and keep only the content
    // Pattern: <div class="note note note_note">...</div>
    // Do NOT create a callout block - just extract the text content as a new paragraph
    if (/<div[^>]*class=["'][^"']*note[^"']*["'][^>]*>/i.test(processedHtml)) {
      processedHtml = processedHtml.replace(
        /<div[^>]*class=["'][^"']*note[^"']*["'][^>]*>([\s\S]*?)<\/div>/gi,
        (match, content, offset, fullString) => {
          // Load the note content with Cheerio to process it
          const $note = cheerio.load(content, { decodeEntities: true });
          
          // Extract the note title (e.g., "Note:", "Warning:", etc.) but keep it
          const noteTitle = $note('.note__title').text().trim();
          $note('.note__title').remove();
          
          // Get the remaining content - use html() to preserve formatting tags
          // but Cheerio with decodeEntities:true will decode HTML entities
          let noteContent = $note('body').html() || '';
          noteContent = noteContent.replace(/\s+/g, ' ').trim();
          
          // Check if there's text before this note (not just tags)
          const beforeNote = fullString.substring(0, offset);
          const textBeforeNote = beforeNote.replace(/<[^>]+>/g, '').trim();
          
          // If there's text before, add newline + bullet marker to make it a new list item
          // Add newline before if there's text before the note
          const prefix = textBeforeNote ? '__NEWLINE__• ' : '';
          
          // Prepend the note title (e.g., "Note:") to the content
          const contentWithTitle = noteTitle ? `${noteTitle} ${noteContent}` : noteContent;
          
          // Return content without the note wrapper, adding newline after
          return `${prefix}${contentWithTitle}__NEWLINE__`;
        }
      );
    }
    
    // Handle code blocks in table cells - replace <pre> with inline code markers
    // Code blocks can't be nested in table cells, so we convert them to inline code
    if (/<pre[^>]*>/i.test(processedHtml)) {
      processedHtml = processedHtml.replace(
        /<pre[^>]*>([\s\S]*?)<\/pre>/gi,
        (match, content) => {
          // Extract code content and wrap in inline code markers
          const $code = cheerio.load(content, { decodeEntities: true });
          const codeText = $code.text().replace(/\s+/g, ' ').trim();
          return `<code>${codeText}</code>`;
        }
      );
    }
    
    // Strip any remaining placeholders (from preprocessing)
    processedHtml = processedHtml.replace(/___PRE_PLACEHOLDER_\d+___/g, '');
    processedHtml = processedHtml.replace(/__CODE_PLACEHOLDER__/g, '');
    processedHtml = processedHtml.replace(/___\w+_PLACEHOLDER_*\w*___/gi, '');
    
    // Separate consecutive inline code elements with newlines
    // This handles cases like: <code>role1</code> <code>role2</code> <code>role3</code>
    processedHtml = processedHtml.replace(/(<\/code>)(\s*)(<code>)/gi, '$1__NEWLINE__$3');
    
    // Reload Cheerio with processed HTML (after figure/image replacement)
    // Strategy: For cells with multiple <p> tags, we need to:
    // 1. Preserve the HTML tags inside paragraphs (for uicontrol formatting)
    // 2. Add newlines between paragraphs (for soft returns)
    // 3. Pass the HTML to rich-text converter which handles formatting
    
    let textContent = '';
    
    // Check if cell has paragraph tags
    const paragraphMatches = processedHtml.match(/<p[^>]*>[\s\S]*?<\/p>/gi);
    
    if (paragraphMatches && paragraphMatches.length > 1) {
      // Multiple paragraphs - split on </p> and add newlines between them
      // This preserves the HTML inside each <p> tag
      textContent = processedHtml
        .replace(/<\/p>\s*<p[^>]*>/gi, '</p>__NEWLINE__<p>')  // Mark newlines with placeholder
        .replace(/<\/?p[^>]*>/gi, '');  // Remove <p> tags but keep content
    } else if (paragraphMatches && paragraphMatches.length === 1) {
      // Single paragraph - check if there's text before it (mixed content)
      const textBeforeP = /^([^<]+)<p/i.exec(processedHtml);
      if (textBeforeP) {
        // Mixed content: text followed by <p>
        textContent = processedHtml.replace(/<p[^>]*>/gi, '__NEWLINE__').replace(/<\/p>/gi, '');
      } else {
        // Just a single <p> wrapper
        textContent = processedHtml.replace(/<\/?p[^>]*>/gi, '');
      }
    } else {
      // No paragraph tags
      textContent = processedHtml;
    }
    
    // Normalize whitespace in the HTML (collapse formatting whitespace but preserve tags)
    // This removes indentation from source HTML without stripping tags
    textContent = textContent
      .replace(/\s*\n\s*/g, ' ')  // Replace newlines (with surrounding whitespace) with single space
      .replace(/\s{2,}/g, ' ')    // Collapse multiple spaces to single space
      .trim();
    
    // DON'T restore intentional newlines yet - keep as __NEWLINE__ markers
    // They will be restored later in list processing (line 330) or at the end for non-lists
    // textContent = textContent.replace(/__NEWLINE__/g, '\n');
    
    // Remove lists, replace <li> with bullets
    if (/<[uo]l[^>]*>/i.test(textContent)) {
      textContent = textContent.replace(/<\/?[uo]l[^>]*>/gi, "");
      // CRITICAL: Add newline marker BEFORE bullet to ensure each item is on its own line
      // First <li> shouldn't have newline before it (at start of cell)
      textContent = textContent.replace(/^\s*<li[^>]*>/gi, "• ");  // First item, no newline
      textContent = textContent.replace(/<li[^>]*>/gi, "__NEWLINE__• ");  // Subsequent items
      textContent = textContent.replace(/<\/li>/gi, "");
      
      // For list content, preserve HTML tags (for uicontrol, links, etc.) and normalize whitespace
      const $list = cheerio.load(textContent, { decodeEntities: true });
      const listParagraphs = [];
      $list('p, div.p').each((i, elem) => {
        // Use .html() instead of .text() to preserve formatting tags like <span class="uicontrol">
        let html = $list(elem).html();
        if (html && html.trim()) {
          // Normalize whitespace but keep HTML tags
          html = html.replace(/\s+/g, ' ').trim();
          listParagraphs.push(html);
        }
      });
      
      textContent = listParagraphs.length > 0
        ? listParagraphs.join('__NEWLINE__')
        : $list('body').html().replace(/\s+/g, ' ').trim();
      
      // CRITICAL: Normalize whitespace BEFORE restoring newlines
      // This preserves intentional __NEWLINE__ markers while removing formatting whitespace
      textContent = textContent
        .replace(/\s*\n\s*/g, ' ')  // Remove actual newlines from HTML formatting
        .replace(/\s{2,}/g, ' ')     // Collapse multiple spaces
        .trim();
      
      // Now restore intentional newlines from markers
      textContent = textContent.replace(/__NEWLINE__/g, '\n');
      
      // DEBUG: Log result structure for bullets
      if (textContent.includes('•')) {
        console.log(`🔍 [table.cjs LIST PATH] About to convert list text with bullets:`);
        console.log(`   Text (first 300 chars): "${textContent.substring(0, 300)}"`);
        console.log(`   Newline count: ${(textContent.match(/\n/g) || []).length}`);
        console.log(`   Bullet count: ${(textContent.match(/•/g) || []).length}`);
      }
      
      // Use rich text block conversion for list items
      const { convertRichTextBlock } = require("./rich-text.cjs");
      const result = convertRichTextBlock(textContent, { skipSoftBreaks: true });
      
      // DEBUG: Log result structure for bullets
      if (textContent.includes('•')) {
        console.log(`🔍 [table.cjs LIST PATH] After conversion:`);
        console.log(`   Rich text elements: ${result.length}`);
        const hasNewlines = result.some(rt => rt.text.content === '\n');
        console.log(`   Contains newline elements: ${hasNewlines}`);
        console.log(`   First 5 elements: ${JSON.stringify(result.slice(0, 5).map(r => r.text.content))}`);
      }
      
      // DEBUG: Log result after conversion
      if (textContent.includes('<span')) {
        const resultText = result.map(r => r.text.content).join('');
        console.log(`🔍 [table.cjs LIST PATH] After conversion:`);
        console.log(`   Result: "${resultText.substring(0, 200)}..."`);
        if (resultText.includes('<') || resultText.includes('>')) {
          console.log(`   ❌ WARNING: HTML tags still in result!`);
        } else {
          console.log(`   ✅ All HTML tags successfully stripped`);
        }
      }
      
      return result;
    }
    
    // For cells with multiple bullet items (not from HTML lists), add soft returns between them
    // Match pattern: bullet followed by space and text, then another bullet
    // Example: "• Item 1 • Item 2" becomes "• Item 1\n• Item 2"
    if (/•[^•]+•/.test(textContent)) {
      // Add newline before each bullet that's not at the start
      textContent = textContent.replace(/([^\n])(\s*•\s*)/g, '$1__NEWLINE__$2');
      textContent = textContent.replace(/^\s+/, ""); // Clean leading whitespace
      textContent = textContent.replace(/__NEWLINE__/g, '\n'); // Restore newlines
    } else {
      // For non-list content, restore intentional newlines from markers
      textContent = textContent.replace(/__NEWLINE__/g, '\n');
    }
    
    // Use rich text block conversion for all other cell content
    const { convertRichTextBlock } = require("./rich-text.cjs");
    
    // DEBUG: Log text content before conversion
    if (textContent.includes('<span')) {
      console.log(`🔍 [table.cjs] About to convert text with span tags: "${textContent.substring(0, 150)}..."`);
    }
    
    const result = convertRichTextBlock(textContent, { skipSoftBreaks: true });
    
    // DEBUG: Log result after conversion
    if (textContent.includes('<span')) {
      const resultText = result.map(r => r.text.content).join('');
      console.log(`🔍 [table.cjs] After conversion: "${resultText.substring(0, 150)}..."`);
      if (resultText.includes('<') || resultText.includes('>')) {
        console.log(`❌ [table.cjs] WARNING: HTML tags still in result!`);
      } else {
        console.log(`✅ [table.cjs] All HTML tags successfully stripped`);
      }
    }
    
    return result;
  }

  // Extract rows using Cheerio to preserve DOM order (avoids regex misalignment)
  const $tableDoc = cheerio.load(cleanedTableHtml, { decodeEntities: true });
  const $tableElement = $tableDoc('table').first();

  const collectRows = async (rowElements) => {
    const collected = [];
    for (const rowElement of rowElements) {
      const $row = $tableDoc(rowElement);
      const cellElements = $row.children('th, td').toArray();
      const rowCells = [];
      for (const cellElement of cellElements) {
        const cellHtml = $tableDoc(cellElement).html() || '';
        rowCells.push(await processTableCellContent(cellHtml));
      }
      if (rowCells.length > 0) {
        collected.push(rowCells);
      }
    }
    return collected;
  };

  let theadRows = [];
  let tbodyRows = [];
  let rows = [];

  if ($tableElement.length > 0) {
    console.log(`📊 [table.cjs] Found <table> element. Extracting rows with Cheerio...`);
    theadRows = await collectRows($tableElement.find('thead > tr').toArray());
    tbodyRows = await collectRows($tableElement.find('tbody > tr').toArray());

    if (theadRows.length > 0 || tbodyRows.length > 0) {
      rows = [...theadRows, ...tbodyRows];
    } else {
      console.log(`📊 [table.cjs] No thead/tbody rows detected; falling back to all <tr>`);
      rows = await collectRows($tableElement.find('tr').toArray());
    }
    console.log(`📊 [table.cjs] Row summary: thead=${theadRows.length}, tbody=${tbodyRows.length}, total=${rows.length}`);
  }

  // Fallback to legacy regex parsing if Cheerio did not yield rows (defensive)
  if (rows.length === 0) {
    console.warn(`⚠️ [table.cjs] No rows found via Cheerio. Falling back to regex parsing.`);
    const rowRegex = /<tr[^>]*>([\s\S]*?)<\/tr>/gi;
    let rowMatch;
    while ((rowMatch = rowRegex.exec(cleanedTableHtml)) !== null) {
      const rowContent = rowMatch[1];
      const cellRegex = /<t[dh][^>]*>([\s\S]*?)<\/t[dh]>/gi;
      const cells = [];
      let cellMatch;
      while ((cellMatch = cellRegex.exec(rowContent)) !== null) {
        const cellContent = cellMatch[1];
        cells.push(await processTableCellContent(cellContent));
      }
      if (cells.length > 0) {
        rows.push(cells);
      }
    }
    console.warn(`⚠️ [table.cjs] Regex parsing produced ${rows.length} row(s).`);
  }

  const tableWidth = Math.max(...rows.map((row) => row.length), 0);
  console.log(`📊 [table.cjs] Final table metrics: rows=${rows.length}, width=${tableWidth}`);
  if (tableWidth === 0) return blocks.length > 0 ? blocks : null;

  // Notion API limit: tables can have max 100 rows
  const MAX_TABLE_ROWS = 100;
  const originalRowCount = rows.length;
  
  // Split large tables into multiple 100-row chunks
  if (rows.length > MAX_TABLE_ROWS) {
    console.warn(`⚠️ [table.cjs] Table exceeds Notion's 100-row limit (${rows.length} rows). Splitting into ${Math.ceil(rows.length / MAX_TABLE_ROWS)} tables.`);
    
    const numChunks = Math.ceil(rows.length / MAX_TABLE_ROWS);
    
    for (let chunkIndex = 0; chunkIndex < numChunks; chunkIndex++) {
      const startRow = chunkIndex * MAX_TABLE_ROWS;
      const endRow = Math.min(startRow + MAX_TABLE_ROWS, rows.length);
      const chunkRows = rows.slice(startRow, endRow);
      
      // Add a heading before each chunk (except the first one)
      if (chunkIndex > 0) {
        blocks.push({
          object: "block",
          type: "heading_3",
          heading_3: {
            rich_text: [
              {
                type: "text",
                text: {
                  content: `(continued - rows ${startRow + 1}-${endRow})`
                }
              }
            ],
            color: "default",
            is_toggleable: false
          }
        });
      }
      
      // Create table chunk with header row if this is the first chunk
      const tableBlock = {
        object: "block",
        type: "table",
        table: {
          table_width: tableWidth,
          has_column_header: (chunkIndex === 0 && theadRows.length > 0),
          has_row_header: false,
          children: [],
        },
      };
      
      chunkRows.forEach((row) => {
        const tableRow = {
          object: "block",
          type: "table_row",
          table_row: { cells: [] },
        };
        for (let i = 0; i < tableWidth; i++) {
          tableRow.table_row.cells.push(row[i] || [{ type: "text", text: { content: "" } }]);
        }
        tableBlock.table.children.push(tableRow);
      });

      // Attach internal row summaries to the table block to aid downstream
      // post-processing (dedupe) without relying on emitting validation-only
      // plain-text paragraphs. These summaries are used as an internal
      // metadata hint and are not emitted to the Notion page output.
      try {
        tableBlock._sn2n_row_summaries = tableBlock.table.children.map(r => {
          try {
            const cells = (r.table_row && r.table_row.cells) || [];
            const cellTexts = cells.map(cellArr => {
              if (!Array.isArray(cellArr)) return '';
              return cellArr.map(rt => (rt && rt.text && rt.text.content) ? String(rt.text.content).trim() : '').join(' ');
            }).filter(Boolean);
            return cellTexts.join(' ').trim();
          } catch (e) { return ''; }
        }).filter(Boolean);
      } catch (e) {
        // noop - row summaries are optional metadata
        console.log(`⚠️ Failed to attach _sn2n_row_summaries: ${e && e.message}`);
      }
      
      blocks.push(tableBlock);
    }
    
    // Add informational callout after all chunks
    blocks.push({
      object: "block",
      type: "callout",
      callout: {
        icon: { type: "emoji", emoji: "ℹ️" },
        color: "blue_background",
        rich_text: [
          {
            type: "text",
            text: {
              content: `Note: This table had ${originalRowCount} rows and was split into ${numChunks} tables above due to Notion's 100-row table limit.`
            }
          }
        ]
      }
    });
  } else {
    // Single table fits within limit
    const tableBlock = {
      object: "block",
      type: "table",
      table: {
        table_width: tableWidth,
        has_column_header: theadRows.length > 0,
        has_row_header: false,
        children: [],
      },
    };
    
    rows.forEach((row) => {
      const tableRow = {
        object: "block",
        type: "table_row",
        table_row: { cells: [] },
      };
      for (let i = 0; i < tableWidth; i++) {
        tableRow.table_row.cells.push(row[i] || [{ type: "text", text: { content: "" } }]);
      }
      tableBlock.table.children.push(tableRow);
    });
    
    // Attach internal row summaries to the table block so downstream
    // post-processing (dedupe) can match paragraph/heading blocks against
    // table row content even when validation-only summary paragraphs are
    // not emitted. This is non-destructive metadata (not sent to Notion).
    try {
      tableBlock._sn2n_row_summaries = tableBlock.table.children.map(r => {
        try {
          const cells = (r.table_row && r.table_row.cells) || [];
          const cellTexts = cells.map(cellArr => {
            if (!Array.isArray(cellArr)) return '';
            return cellArr.map(rt => (rt && rt.text && rt.text.content) ? String(rt.text.content).trim() : '').join(' ');
          }).filter(Boolean);
          return cellTexts.join(' ').trim();
        } catch (e) { return ''; }
      }).filter(Boolean);
    } catch (e) {
      // Best-effort: failure to attach metadata is non-fatal
      console.log(`⚠️ Failed to attach _sn2n_row_summaries: ${e && e.message}`);
    }
    blocks.push(tableBlock);
  }
  
  // Add extracted images as separate image blocks after the table
  // Only append images when explicitly requested (options.preserveImages)
  // or when the image has a non-empty caption. This avoids promoting
  // decorative/thumbnail images out of tables and changing visual order
  // in the document for consumers that don't expect table images as blocks.
  const imagesToAppend = extractedImages.filter(img => {
    const hasCaption = img.alt && String(img.alt).trim().length > 0;
    return !!(options.preserveImages || hasCaption);
  });

  if (imagesToAppend.length > 0) {
    console.log(`📸 Will append ${imagesToAppend.length} of ${extractedImages.length} extracted images from table cells`);
    for (const image of imagesToAppend) {
      const isServiceNowImage = /servicenow\.(com|net)/i.test(image.src);
      let imageBlock = null;

      // Prefer uploading ServiceNow images so they render outside an authenticated session
      if (typeof downloadAndUploadImage === 'function') {
        try {
          const uploadId = await downloadAndUploadImage(image.src, image.alt || 'image');
          if (uploadId) {
            imageBlock = {
              object: 'block',
              type: 'image',
              image: {
                type: 'file_upload',
                file_upload: { id: uploadId },
                caption: image.alt
                  ? [{ type: 'text', text: { content: image.alt } }]
                  : [],
              },
            };
          }
        } catch (e) {
          console.log(`❌ [table.cjs] Image upload failed: ${e.message || e}`);
        }
      }

      // Fallback: for non-ServiceNow images, allow external URL if available
      if (!imageBlock && !isServiceNowImage) {
        imageBlock = {
          object: 'block',
          type: 'image',
          image: {
            type: 'external',
            external: { url: image.src },
            caption: image.alt
              ? [{ type: 'text', text: { content: image.alt } }]
              : [],
          },
        };
      }

      if (imageBlock) {
        blocks.push(imageBlock);
        console.log(`📸 Added image block: ${image.src.substring(0, 80)}...`);
      } else {
        console.log(`⚠️ [table.cjs] Skipped image (no upload and external not allowed): ${image.src.substring(0, 80)}...`);
      }
    }
  } else if (extractedImages.length > 0) {
    // Log that we found images but intentionally did not append any
    console.log(`📸 Found ${extractedImages.length} image(s) in table cells, but none met the criteria to be appended as separate blocks (preserveImages=${!!options.preserveImages}).`);
  }
  
  return blocks;
}

/**
 * Removes duplicate table blocks from an array by comparing cell content.
 * 
 * This function identifies and removes duplicate table blocks by comparing their
 * cell content. Two tables are considered duplicates if they have identical
 * cell content structure, regardless of block metadata or IDs.
 * 
 * @param {Array<object>} blocks - Array of Notion blocks that may contain table blocks
 * 
 * @returns {Array<object>} Filtered array with duplicate table blocks removed
 * 
 * @example
 * const blocks = [
 *   { type: "paragraph", paragraph: { rich_text: [...] } },
 *   { type: "table", table: { children: [{ table_row: { cells: [["A"], ["B"]] } }] } },
 *   { type: "table", table: { children: [{ table_row: { cells: [["A"], ["B"]] } }] } }, // Duplicate
 *   { type: "table", table: { children: [{ table_row: { cells: [["C"], ["D"]] } }] } }
 * ];
 * const unique = deduplicateTableBlocks(blocks);
 * // Returns: [paragraph, first table, different table] (duplicate table removed)
 * 
 * @see {@link convertTableBlock} for creating table blocks from HTML
 */
function deduplicateTableBlocks(blocks) {
  if (!Array.isArray(blocks)) return blocks;
  
  // Only remove CONSECUTIVE/ADJACENT duplicate tables
  // Preserve identical tables that appear in different parts of the document
  // (e.g., repeated steps in a process with the same table structure)
  const result = [];
  let prevTableKey = null;
  
  for (const block of blocks) {
    if (block.type !== "table") {
      result.push(block);
      prevTableKey = null; // Reset when we see a non-table block
      continue;
    }
    
    // FIX v11.0.71: Check if table.children exists (may be stripped by enforceNestingDepthLimit at depth 2+)
    if (!block.table.children || !Array.isArray(block.table.children)) {
      // Table without children (deferred for orchestration) - can't deduplicate, keep it
      result.push(block);
      prevTableKey = null;
      continue;
    }
    
    // Generate key based on table content
    const key = JSON.stringify(block.table.children.map(row => row.table_row.cells));
    
    // Only skip if this table is identical to the IMMEDIATELY PREVIOUS block
    if (key === prevTableKey) {
      console.log(`🧹 Removing consecutive duplicate table`);
      continue; // Skip this duplicate
    }
    
    result.push(block);
    prevTableKey = key;
  }
  
  return result;
}

/**
 * @typedef {object} NotionTableBlock
 * @property {string} object - Always "block"
 * @property {string} type - Always "table"
 * @property {object} table - Table configuration and content
 * @property {number} table.table_width - Number of columns in the table
 * @property {boolean} table.has_column_header - Whether first row is treated as header
 * @property {boolean} table.has_row_header - Whether first column is treated as header
 * @property {Array<object>} table.children - Array of table_row blocks
 */

/**
 * @typedef {object} NotionTableRow
 * @property {string} object - Always "block"
 * @property {string} type - Always "table_row"
 * @property {object} table_row - Row content
 * @property {Array<Array<object>>} table_row.cells - Array of cell content (rich_text arrays)
 */

/**
 * @typedef {object} TableConversionOptions
 * @property {boolean} [preserveImages=false] - Whether to preserve images (default: convert to bullets)
 * @property {boolean} [extractCaptions=true] - Whether to extract table captions as headings
 * @property {boolean} [processLists=true] - Whether to convert nested lists to bullet points
 */

// Export table conversion utilities
module.exports = {
  /** @type {function(string, TableConversionOptions=): Promise<Array<object>|null>} */
  convertTableBlock,
  /** @type {function(Array<object>): Array<object>} */
  deduplicateTableBlocks
};
