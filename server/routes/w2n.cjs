
/**
 * @file Express route for ServiceNow-2-Notion W2N (Web-to-Notion) endpoint.
 * @module routes/w2n
 * 
 * VALIDATION ARCHITECTURE (v11.0.40):
 * ===================================
 * This route creates Notion pages with FULL FORMATTING while using PLAIN-TEXT for validation.
 * 
 * Flow:
 * 1. HTML → Formatted Notion blocks (with bold, italic, code, colors, etc.)
 * 2. Create plain-text copy using createPlainTextBlocksForValidation() (coalesces rich_text)
 * 3. Send FORMATTED blocks to Notion (users see formatting)
 * 4. Use PLAIN-TEXT blocks for validation statistics (Audit & ContentComparison properties)
 * 5. Discard plain-text copy after validation
 * 
 * Why separate copies?
 * - User Experience: Notion pages have full formatting (bold, colors, etc.)
 * - Validation Accuracy: Plain-text comparison avoids false negatives from formatting variations
 * - ContentComparison Property: Block counts based on plain-text (consistent with source HTML plain-text)
 * 
 * Key Variables:
 * - children: Formatted blocks sent to Notion (preserves bold, italic, code, colors)
 * - plainTextChildren: Coalesced blocks for validation (single rich_text per block, no formatting)
 * - sourceBlocksForCounting: Uses plainTextChildren if available, else children
 */

const express = require('express');
const router = express.Router();
const fs = require('fs');
const path = require('path');
const cheerio = require('cheerio');

// FORCE RELOAD TIMESTAMP: 2025-12-07T00:20:00.000Z - v11.0.158 MENU CASCADE FIX
console.log('🔥🔥🔥 W2N.CJS MODULE LOADED AT:', new Date().toISOString());
console.log('🔥🔥🔥 MODULE VERSION: v11.0.158 - MENU CASCADE PREPROCESSING BEFORE AUDIT');

// Import services
const notionService = require('../services/notion.cjs');
const servicenowService = require('../services/servicenow.cjs');
const dedupeUtil = require('../utils/dedupe.cjs');
const { getAndClearPlaceholderWarnings } = require('../converters/rich-text.cjs');
const { deduplicateTableBlocks } = require('../converters/table.cjs');
const { logPlaceholderStripped, logUnprocessedContent, logImageUploadFailed, logCheerioParsingIssue } = require('../utils/verification-log.cjs');
const { validateNotionPage } = require('../utils/validate-notion-page.cjs');
const { diagnoseAndFixAudit, saveDiagnosisToFile } = require('../utils/audit-auto-remediate.cjs');

/**
 * Validation status tracker for async validation monitoring
 * Maps pageId -> { status: 'pending'|'running'|'complete'|'error', startTime, endTime, result }
 */
const validationStatus = new Map();

/**
 * Clean up old validation status entries (older than 10 minutes)
 */
function cleanupValidationStatus() {
  const now = Date.now();
  const maxAge = 10 * 60 * 1000; // 10 minutes
  
  for (const [pageId, data] of validationStatus.entries()) {
    if (data.endTime && (now - data.endTime) > maxAge) {
      validationStatus.delete(pageId);
    }
  }
}

// Clean up validation status every 5 minutes
setInterval(cleanupValidationStatus, 5 * 60 * 1000);

/**
 * Returns runtime global context for Notion and ServiceNow operations.
 * @returns {Object} Global context object
 */
function getGlobals() {
  return {
    notion: global.notion,
    log: global.log,
    sendSuccess: global.sendSuccess,
    sendError: global.sendError,
    htmlToNotionBlocks: global.htmlToNotionBlocks,
    ensureFileUploadAvailable: global.ensureFileUploadAvailable,
    collectAndStripMarkers: global.collectAndStripMarkers,
    removeCollectedBlocks: global.removeCollectedBlocks,
    deepStripPrivateKeys: global.deepStripPrivateKeys,
    orchestrateDeepNesting: global.orchestrateDeepNesting,
    sweepAndRemoveMarkersFromPage: global.sweepAndRemoveMarkersFromPage,
    getExtraDebug: global.getExtraDebug,
    normalizeAnnotations: global.normalizeAnnotations,
    normalizeUrl: global.normalizeUrl,
    isValidImageUrl: global.isValidImageUrl,
    cleanInvalidBlocks: global.cleanInvalidBlocks
  };
}

router.post('/W2N', async (req, res) => {
  const { notion, log, sendSuccess, sendError, htmlToNotionBlocks, ensureFileUploadAvailable, 
          collectAndStripMarkers, removeCollectedBlocks, deepStripPrivateKeys, 
          orchestrateDeepNesting, getExtraDebug, normalizeAnnotations, normalizeUrl, cleanInvalidBlocks, 
          isValidImageUrl } = getGlobals();
  
  console.log('🔥🔥🔥🔥🔥 W2N ROUTE HANDLER ENTRY - FILE VERSION 07:20:00 - WITH CONSOLE.LOG NAV DIAGNOSTIC 🔥🔥🔥🔥🔥');
  log('🔥🔥🔥 W2N ROUTE HANDLER ENTRY - FILE VERSION 07:20:00 - WITH CONSOLE.LOG NAV DIAGNOSTIC');
  
  // Clear paragraph tracker for new request to detect duplicates within this conversion
  if (global._sn2n_paragraph_tracker) {
    console.log(`🔄 [DUPLICATE-DETECT] Clearing paragraph tracker (had ${global._sn2n_paragraph_tracker.length} entries)`);
  }
  global._sn2n_paragraph_tracker = [];
  
  // Clear callout tracker for new request to detect duplicate callouts within this conversion
  if (global._sn2n_callout_tracker) {
    console.log(`🔄 [CALLOUT-DUPLICATE] Clearing callout tracker (had ${global._sn2n_callout_tracker.size} entries)`);
  }
  global._sn2n_callout_tracker = new Set();
  
  try {
    const payload = req.body;
    let savedToUpdateFolder = false; // FIX v11.0.33: Track if page was auto-saved (moved to function scope)
    log("📝 Processing W2N request for:", payload.title);
    
    // CRITICAL DEBUG: Log payload structure
    log(`🚨 PAYLOAD KEYS: ${Object.keys(payload).join(', ')}`);
    log(`🚨 payload.contentHtml exists: ${!!payload.contentHtml}`);
    log(`🚨 payload.content exists: ${!!payload.content}`);
    if (payload.contentHtml) {
      log(`🚨 payload.contentHtml length: ${payload.contentHtml.length}`);
    }
    if (payload.content) {
      log(`🚨 payload.content length: ${payload.content.length}`);
    }

    // DEBUG: Check target OL at server entry point
    if (payload.contentHtml || payload.content) {
      const html = payload.contentHtml || payload.content;
      const hasTargetOl = html.includes('devops-software-quality-sub-category__ol_bpk_gfk_xpb');
      console.log(`🔍 [SERVER-ENTRY] Has target OL ID: ${hasTargetOl}`);
      console.log(`🔍 [SERVER-ENTRY] Total HTML length: ${html.length} characters`);
      
      if (hasTargetOl) {
        // Extract the OL and count its <li> tags
        const olMatch = html.match(/<ol[^>]*id="devops-software-quality-sub-category__ol_bpk_gfk_xpb"[^>]*>[\s\S]*?<\/ol>/);
        if (olMatch) {
          const olHtml = olMatch[0];
          const liCount = (olHtml.match(/<li/g) || []).length;
          console.log(`🔍 [SERVER-ENTRY] Target OL found, length: ${olHtml.length} characters`);
          console.log(`🔍 [SERVER-ENTRY] Contains ${liCount} <li> tags`);
          console.log(`🔍 [SERVER-ENTRY] Contains Submit span: ${olHtml.includes('<span class="ph uicontrol">Submit</span>')}`);
          console.log(`🔍 [SERVER-ENTRY] Contains "successfully created": ${olHtml.includes('successfully created')}`);
          
          // Save target OL to file for inspection
          const fs = require('fs');
          const path = require('path');
          const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
          const logDir = path.join(__dirname, '../logs');
          const logFile = path.join(logDir, `target-ol-${timestamp}.html`);
          try {
            fs.writeFileSync(logFile, olHtml, 'utf8');
            console.log(`🔍 [SERVER-ENTRY] Saved target OL to: ${logFile}`);
          } catch (err) {
            console.log(`🔍 [SERVER-ENTRY] ⚠️ Could not save OL to file: ${err.message}`);
          }
        }
      }
      
      const hasPreTags = html.includes("<pre");
      const hasClosingPreTags = html.includes("</pre>");
      console.log(
        `🔍 DEBUG API: contentHtml has <pre>: ${hasPreTags}, has </pre>: ${hasClosingPreTags}`
      );
      
      // Check for nav tags
      if (payload.contentHtml) {
        const navCount = (payload.contentHtml.match(/<nav[^>]*>/g) || []).length;
        console.log(`🔍 DEBUG API: Found ${navCount} <nav> tags in received HTML`);
        
        // COUNT ARTICLE.NESTED1 ELEMENTS AT API ENTRY
        const nested1Matches = payload.contentHtml.match(/class="topic task nested1"/g);
        const nested1Count = nested1Matches ? nested1Matches.length : 0;
        console.log(`🚨🚨🚨 API ENTRY POINT: Found ${nested1Count} article.nested1 elements in received HTML`);
        
        // Check for nested0
        const nested0Matches = payload.contentHtml.match(/class="[^"]*nested0[^"]*"/g);
        const nested0Count = nested0Matches ? nested0Matches.length : 0;
        console.log(`🚨🚨🚨 API ENTRY POINT: Found ${nested0Count} article.nested0 elements in received HTML`);
      }
      console.log('🔥🔥🔥 INSIDE DIAGNOSTIC BLOCK - LAST LINE BEFORE CLOSING BRACE');
    }
    
    log('🔥🔥🔥 AFTER DIAGNOSTIC BLOCK - THIS LINE SHOULD ALWAYS EXECUTE');

    // FIX v11.0.39: Define shouldValidate early for use throughout POST handler
    const shouldValidate = process.env.SN2N_VALIDATE_OUTPUT === '1' || process.env.SN2N_VALIDATE_OUTPUT === 'true';

    if (!payload.title || (!payload.content && !payload.contentHtml)) {
      return sendError(
        res,
        "MISSING_FIELDS",
        "Missing required fields: title and (content or contentHtml)",
        null,
        400
      );
    }

    // Allow a dry-run mode for testing conversions without creating a Notion page
  if (payload.dryRun) {
    // Dry-run mode is only supported for PATCH, not POST. For POST, skip dry-run logic.
    return sendError(
      res,
      "DRYRUN_NOT_SUPPORTED",
      "Dry-run mode is not supported for POST. Use PATCH for dry-run validation.",
      null,
      400
    );
  }

    if (!payload.databaseId) {
      return sendError(
        res,
        "MISSING_DATABASE_ID",
        "Missing databaseId",
        null,
        400
      );
    }

    if (!ensureFileUploadAvailable()) {
      return sendError(
        res,
        "NOTION_NOT_AVAILABLE",
        "Notion API not available (NOTION_TOKEN missing)",
        null,
        500
      );
    }

    // Create page properties using Notion service
    let properties = {};

    // Set default title property
    properties["Name"] = {
      title: [{ text: { content: String(payload.title || "") } }],
    };

    // Set URL if provided
    if (payload.url) {
      properties["URL"] = {
        url: payload.url,
      };
    }

    // Apply property mappings from payload (from userscript) using Notion service
    if (payload.properties) {
      log("🔍 Received properties from userscript:");
      log(JSON.stringify(payload.properties, null, 2));
      
      // Merge with existing properties, but preserve server-set URL property
      // Userscript property mappings should not override the explicit URL from payload.url
      const userProperties = { ...payload.properties };
      if (properties["URL"] && userProperties["URL"]) {
        log("⚠️ Userscript property mappings include URL property - preserving server-set URL");
        delete userProperties["URL"];
      }
      
      Object.assign(properties, userProperties);
      log("🔍 Properties after merge:");
      log(JSON.stringify(properties, null, 2));
    } else {
      log("⚠️ No properties received from userscript");
    }

    // Create children blocks from content
    let children = [];
    let hasVideos = false;
    let extractionResult = null; // Store extraction result for validation

    // Prefer HTML content with conversion to Notion blocks
    let extractionWarnings = [];
    if (payload.contentHtml) {
      log("🔄 Converting HTML content to Notion blocks");
      
      // DEBUG: Check for "Role required" callout in raw HTML
      if (payload.contentHtml.includes('Role required')) {
        console.log('\n🔍 [CALLOUT-DEBUG] Found "Role required" in raw HTML from userscript');
        const roleIndex = payload.contentHtml.indexOf('Role required');
        const roleContext = payload.contentHtml.substring(roleIndex - 200, roleIndex + 500);
        console.log('🔍 [CALLOUT-DEBUG] Raw HTML context around "Role required":');
        console.log(roleContext);
        console.log('🔍 [CALLOUT-DEBUG] ========================================\n');
      }
      
      // DEBUG: Check for CSS class corruption in raw HTML
      if (payload.contentHtml.includes('t_CreateAContract__ul_s5w_qvm_m1c')) {
        console.log('\n🔍 [CORRUPTION-DEBUG] Found corrupted CSS class in raw HTML from userscript!');
        const corruptionIndex = payload.contentHtml.indexOf('t_CreateAContract__ul_s5w_qvm_m1c');
        const corruptionContext = payload.contentHtml.substring(corruptionIndex - 100, corruptionIndex + 200);
        console.log('🔍 [CORRUPTION-DEBUG] Raw HTML context around corruption:');
        console.log(corruptionContext);
        console.log('🔍 [CORRUPTION-DEBUG] ========================================');
        
        // Log the entire HTML structure to see what element types contain this
        console.log('🔍 [CORRUPTION-DEBUG] Full HTML structure:');
        console.log(payload.contentHtml);
        console.log('🔍 [CORRUPTION-DEBUG] ========================================\n');
      }
      
      extractionResult = await htmlToNotionBlocks(payload.contentHtml);
      children = extractionResult.blocks;
      hasVideos = extractionResult.hasVideos;
      extractionWarnings = extractionResult.warnings || [];
      log(`✅ Converted HTML to ${children.length} Notion blocks`);
      
      // Deduplicate consecutive identical tables
      const beforeDedupe = children.length;
      const tablesBefore = children.filter(b => b.type === 'table').length;
      log(`📊 Before dedupe: ${children.length} blocks (${tablesBefore} tables)`);
      children = deduplicateTableBlocks(children);
      const tablesAfter = children.filter(b => b.type === 'table').length;
      if (children.length < beforeDedupe) {
        log(`🧹 Removed ${beforeDedupe - children.length} duplicate block(s) (tables: ${tablesBefore} → ${tablesAfter})`);
      }
      
      if (hasVideos) {
        log(`🎥 Video content detected - will set hasVideos property`);
      }
      if (extractionWarnings.length > 0) {
        log(`⚠️ ${extractionWarnings.length} warnings collected during extraction (will log after page creation)`);
      }
    } else if (payload.content) {
      log("📝 Using plain text content");
      children = [
        {
          object: "block",
          type: "paragraph",
          paragraph: {
            rich_text: [{ type: "text", text: { content: payload.content } }],
          },
        },
      ];
    }

    // Note: Video detection is handled by userscript's property mappings
    // The server detects videos during HTML conversion and logs it,
    // but the userscript is responsible for setting the appropriate property
    // based on its property mappings configuration
    if (hasVideos) {
      log("🎥 Videos detected in content during HTML conversion");
    }

    // v11.0.27 FIX: DO NOT strip private keys yet - we need _sn2n_marker for collectAndStripMarkers
    // Private keys will be stripped after marker collection (see below, after removeCollectedBlocks)

    // Compute expected callout count from source HTML so dedupe can be conditional.
    // Use Cheerio to robustly detect callout-like elements (class contains 'note' or 'callout',
    // role="note", or text starting with 'Note:'). Deduplicate matches by outer HTML
    // to avoid double-counting the same element.
    let expectedCallouts = null;
    try {
      if (payload.contentHtml) {
        try {
          const $ = cheerio.load(payload.contentHtml || '');
          const matched = new Set();

          let calloutIndex = 0;
          $('*').each((i, el) => {
            try {
              const $el = $(el);
              const cls = ($el.attr('class') || '').toString();
              const tag = el.tagName ? el.tagName.toLowerCase() : '';
              const role = ($el.attr('role') || '').toString();

              // Match servicenow.cjs conversion logic EXACTLY:
              // 1. div.note (line 1257 in servicenow.cjs)
              // 2. section.prereq or div.section.prereq (line 3380 in servicenow.cjs)
              // 3. role="note"
              const isDivNote = (tag === 'div' && /note/i.test(cls));
              const isPrereq = ((tag === 'section' || (tag === 'div' && /section/i.test(cls))) && /prereq/i.test(cls));
              const hasNoteRole = /note/i.test(role);

              if (isDivNote || isPrereq || hasNoteRole) {
                // CRITICAL: Skip callouts inside tables - they can't be rendered as callouts in Notion
                // Notion table cells can only contain text and other limited types, not callout blocks
                // This matches the extraction pipeline which removes callouts from tables (servicenow.cjs line 287)
                let isInTable = false;
                const parents = $el.parents().toArray();
                for (const parent of parents) {
                  const parentTag = parent.tagName ? parent.tagName.toLowerCase() : '';
                  if (parentTag === 'table' || parentTag === 'thead' || parentTag === 'tbody' || parentTag === 'tr' || parentTag === 'td' || parentTag === 'th') {
                    // Found a table ancestor - this callout is inside a table
                    isInTable = true;
                    break;
                  }
                }
                
                if (isInTable) {
                  // Skip - this callout is inside a table and won't be converted to a callout block
                  return;
                }

                // CRITICAL: Also skip nested callouts to avoid double-counting
                // A callout is nested if it's INSIDE another callout's content area
                let isNested = false;
                
                for (const parent of parents) {
                  const $parent = $(parent);
                  const parentCls = ($parent.attr('class') || '').toString();
                  const parentTag = parent.tagName ? parent.tagName.toLowerCase() : '';
                  const parentRole = ($parent.attr('role') || '').toString();
                  
                  const parentIsDivNote = (parentTag === 'div' && /note/i.test(parentCls));
                  const parentIsPrereq = ((parentTag === 'section' || (parentTag === 'div' && /section/i.test(parentCls))) && /prereq/i.test(parentCls));
                  const parentHasNoteRole = /note/i.test(parentRole);
                  
                  if (parentIsDivNote || parentIsPrereq || parentHasNoteRole) {
                    // Found a parent callout - this element is nested
                    isNested = true;
                    break;
                  }
                }
                
                if (isNested) {
                  // Skip - this is a nested callout (will be a child block, not a top-level callout)
                  return;
                }
                
                // Count this as a unique callout (don't use HTML as dedupe key - multiple callouts can have identical content)
                // Example: Two separate "Before you begin" sections with same role requirements are BOTH valid callouts
                calloutIndex++;
                matched.add(`callout-${calloutIndex}`);
              }
            } catch (innerE) {
              // ignore element-level parse errors
            }
          });

          expectedCallouts = matched.size;
          log(`🔍 [DEDUPE-WIRE] expectedCallouts from HTML (cheerio): ${expectedCallouts}`);
        } catch (cheerioErr) {
          log(`⚠️ [DEDUPE-WIRE] Cheerio parsing failed: ${cheerioErr.message}`);
          expectedCallouts = null;
        }
      }
    } catch (e) {
      expectedCallouts = null;
    }

    // Remove unwanted callouts (info) and dedupe identical blocks to avoid
    // duplicate callouts/tables introduced by nested-extraction logic.
    const computeBlockKey = (blk) => {
      const plainTextFromRich = (richArr) => {
        if (!Array.isArray(richArr)) return "";
        return richArr.map((rt) => rt.text?.content || "").join("").replace(/\s+/g, " ").trim();
      };

      if (!blk || typeof blk !== "object") return JSON.stringify(blk);
      try {
        if (blk.type === "callout" && blk.callout) {
          const txt = plainTextFromRich(blk.callout.rich_text || []);
          const emoji = blk.callout.icon?.type === "emoji" ? blk.callout.icon.emoji : "";
          const color = blk.callout.color || "";
          return `callout:${txt}|${emoji}|${color}`;
        }
          if (blk.type === "image" && blk.image) {
            // Deduplicate images by uploaded file id or external URL
            try {
              const fileId = blk.image.file_upload && blk.image.file_upload.id;
              const externalUrl = blk.image.external && blk.image.external.url;
              const key = fileId ? `image:file:${String(fileId)}` : `image:external:${String(externalUrl || '')}`;
              return key;
            } catch (e) {
              return 'image:unknown';
            }
          }
        if (blk.type === "table" && blk.table) {
          const w = blk.table.table_width || 0;
          const rows = Array.isArray(blk.table.children) ? blk.table.children.length : 0;
          const normalizeCellText = (txt) =>
            String(txt || "")
              .replace(/\(sn2n:[a-z0-9\-]+\)/gi, "")
              .replace(/\s+/g, " ")
              .trim()
              .toLowerCase()
              .substring(0, 200);

          // Include first 3 rows to better distinguish tables with same headers
          let rowSamples = [];
          if (Array.isArray(blk.table.children)) {
            for (let i = 0; i < Math.min(3, blk.table.children.length); i++) {
              const cells = blk.table.children[i]?.table_row?.cells || [];
              const rowText = cells
                .map((c) => {
                  if (Array.isArray(c)) {
                    return c.map((rt) => normalizeCellText(rt?.text?.content || "")).join("|");
                  }
                  return normalizeCellText(c);
                })
                .join("|");
              rowSamples.push(rowText);
            }
          }
          return `table:${w}x${rows}:${rowSamples.join("||")}`;
        }
        if (blk.type === "numbered_list_item" || blk.type === "bulleted_list_item") {
          const txt = plainTextFromRich(blk[blk.type]?.rich_text || []);
          return `${blk.type}:${txt.substring(0, 200)}`;
        }
        if (blk.type === "paragraph") {
          const txt = plainTextFromRich(blk.paragraph?.rich_text || []);
          return `paragraph:${txt.substring(0, 200)}`;
        }
        if (blk.type === "code") {
          const codeTxt = blk.code?.rich_text?.map((r) => r.text?.content || "").join("") || "";
          const lang = blk.code?.language || "";
          return `code:${lang}:${codeTxt.substring(0, 200)}`;
        }
        return JSON.stringify(blk);
      } catch (e) {
        return JSON.stringify(blk);
      }
    };

    function dedupeAndFilterBlocks(blockArray) {
      if (!Array.isArray(blockArray)) return blockArray;
      const seen = new Set();
      const out = [];
      let removed = 0;
      let duplicates = 0;
      
      for (const blk of blockArray) {
        try {
          // Special-case image dedupe by file_upload id or external URL
          if (blk && blk.type === 'image' && blk.image) {
            const fileId = blk.image.file_upload && blk.image.file_upload.id;
            const externalUrl = blk.image.external && blk.image.external.url;
            const imageKey = fileId ? `image:file:${String(fileId)}` : `image:external:${String(externalUrl || '')}`;
            if (seen.has(imageKey)) {
              removed++;
              duplicates++;
              continue;
            }
            seen.add(imageKey);
            out.push(blk);
            continue;
          }

          const key = computeBlockKey(blk);
          if (seen.has(key)) {
            removed++;
            duplicates++;
            continue;
          }
          seen.add(key);
          out.push(blk);
        } catch (e) {
          out.push(blk);
        }
      }

      if (removed > 0) {
        log(`🔧 dedupeAndFilterBlocks: removed ${removed} duplicate(s)`);
      }

      return out;
    }

    // Use central dedupe utility so unit tests can target it
    const beforeDedupeCount = children.length;
    const calloutsBefore = children.filter(c => c.type === 'callout').length;
    log(`🔍 [DEDUPE-DEBUG] Before deduplication: ${beforeDedupeCount} blocks (${calloutsBefore} callouts)`);
  children = dedupeUtil.dedupeAndFilterBlocks(children, { log, expectedCallouts });
    const afterDedupeCount = children.length;
    const calloutsAfter = children.filter(c => c.type === 'callout').length;
    log(`🔍 [DEDUPE-DEBUG] After deduplication: ${afterDedupeCount} blocks (${calloutsAfter} callouts), removed ${beforeDedupeCount - afterDedupeCount} blocks`);
    
    // CRITICAL: Also dedupe children nested inside list items
    // Callouts can appear as children of list items and need deduplication too
    function dedupeNestedChildren(blocks, depth = 0) {
      const indent = '  '.repeat(depth);
      return blocks.map((block, idx) => {
        if (block.type === 'numbered_list_item' && block.numbered_list_item?.children) {
          const beforeCount = block.numbered_list_item.children.length;
          log(`${indent}🔍 [NESTED-DEDUPE] numbered_list_item[${idx}] has ${beforeCount} children`);
          
          block.numbered_list_item.children = dedupeUtil.dedupeAndFilterBlocks(
            block.numbered_list_item.children, 
            { log, expectedCallouts }
          );
          
          const afterCount = block.numbered_list_item.children.length;
          if (beforeCount !== afterCount) {
            log(`${indent}  🚫 Removed ${beforeCount - afterCount} duplicate(s) from numbered_list_item[${idx}]`);
          }
          
          // Recursively dedupe nested list items
          block.numbered_list_item.children = dedupeNestedChildren(block.numbered_list_item.children, depth + 1);
        } else if (block.type === 'bulleted_list_item' && block.bulleted_list_item?.children) {
          const beforeCount = block.bulleted_list_item.children.length;
          log(`${indent}🔍 [NESTED-DEDUPE] bulleted_list_item[${idx}] has ${beforeCount} children`);
          
          block.bulleted_list_item.children = dedupeUtil.dedupeAndFilterBlocks(
            block.bulleted_list_item.children, 
            { log, expectedCallouts }
          );
          
          const afterCount = block.bulleted_list_item.children.length;
          if (beforeCount !== afterCount) {
            log(`${indent}  🚫 Removed ${beforeCount - afterCount} duplicate(s) from bulleted_list_item[${idx}]`);
          }
          
          // Recursively dedupe nested list items
          block.bulleted_list_item.children = dedupeNestedChildren(block.bulleted_list_item.children, depth + 1);
        } else if (block.type === 'toggle' && block.toggle?.children) {
          const beforeCount = block.toggle.children.length;
          log(`${indent}🔍 [NESTED-DEDUPE] toggle[${idx}] has ${beforeCount} children`);
          block.toggle.children = dedupeUtil.dedupeAndFilterBlocks(block.toggle.children, { log, expectedCallouts });
          const afterCount = block.toggle.children.length;
          if (beforeCount !== afterCount) {
            log(`${indent}  🚫 Removed ${beforeCount - afterCount} duplicate(s) from toggle[${idx}]`);
          }
          block.toggle.children = dedupeNestedChildren(block.toggle.children, depth + 1);
        } else if (block.type === 'callout' && block.callout?.children) {
          const beforeCount = block.callout.children.length;
          log(`${indent}🔍 [NESTED-DEDUPE] callout[${idx}] has ${beforeCount} children`);
          block.callout.children = dedupeUtil.dedupeAndFilterBlocks(block.callout.children, { log, expectedCallouts });
          const afterCount = block.callout.children.length;
          if (beforeCount !== afterCount) {
            log(`${indent}  🚫 Removed ${beforeCount - afterCount} duplicate(s) from callout[${idx}]`);
          }
          block.callout.children = dedupeNestedChildren(block.callout.children, depth + 1);
        }
        return block;
      });
    }
    
    log(`🔧 Running nested deduplication on ${children.length} top-level blocks...`);
    children = dedupeNestedChildren(children);
    log(`✅ Deduplication complete (including nested children)`);
    
    // FIX v11.0.7: Final pass to remove any remaining duplicate callouts
    // Duplicate callouts can appear when extracted from nested lists at multiple levels
    // Remove consecutive identical callouts (within proximity of 2 blocks)
    const calloutIndices = [];
    children.forEach((block, idx) => {
      if (block.type === 'callout') calloutIndices.push(idx);
    });
    
    try {
      log(`🔍 [FINAL-CALLOUT-DEDUPE] Found ${calloutIndices.length} callouts at indices: [${calloutIndices.join(', ')}]`);

      const actualCalloutCount = calloutIndices.length;
      // If caller provided expectedCallouts, and actual <= expected, skip final dedupe
      if (typeof expectedCallouts === 'number' && actualCalloutCount <= expectedCallouts) {
        log(`ℹ️ [FINAL-CALLOUT-DEDUPE] Skipping final dedupe: actual (${actualCalloutCount}) <= expected (${expectedCallouts})`);
      } else {
        // Build signatures for each callout in document order
        const calloutEntries = calloutIndices.map(idx => {
          const callout = children[idx];
          const fullText = (callout.callout?.rich_text || [])
            .map(rt => rt.text?.content || '')
            .join('')
            .replace(/\(sn2n:[a-z0-9\-]+\)/gi, '')
            .replace(/\s+/g, ' ')
            .trim();
          const signature = fullText.substring(0, 200).toLowerCase();
          return { idx, signature, fullText };
        });

        const indicesToRemove = [];

        if (typeof expectedCallouts === 'number') {
          // Keep earliest occurrences up to expectedCallouts (allow duplicates only if needed)
          const keepSet = new Set();
          const seenSignatures = new Set();
          let keptCount = 0;

          for (const entry of calloutEntries) {
            if (keptCount < expectedCallouts) {
              // Prefer keeping new signatures first
              if (!seenSignatures.has(entry.signature)) {
                keepSet.add(entry.idx);
                seenSignatures.add(entry.signature);
                keptCount++;
              } else {
                // Signature already seen; keep this duplicate only if we still need more
                keepSet.add(entry.idx);
                keptCount++;
              }
            } else {
              indicesToRemove.push(entry.idx);
            }
          }

          // Any callout index not in keepSet should be removed
          calloutEntries.forEach(e => {
            if (!keepSet.has(e.idx)) indicesToRemove.push(e.idx);
          });
        } else {
          // No expectedCallouts provided: fallback to original aggressive dedupe (keep first occurrence per signature)
          const seen = new Map();
          for (const entry of calloutEntries) {
            if (seen.has(entry.signature)) {
              const firstIdx = seen.get(entry.signature);
              log(`🚫 [FINAL-CALLOUT-DEDUPE] Removing duplicate callout at index ${entry.idx} (duplicate of ${firstIdx}): "${entry.fullText.substring(0,60)}..."`);
              indicesToRemove.push(entry.idx);
            } else {
              seen.set(entry.signature, entry.idx);
            }
          }
        }

        if (indicesToRemove.length > 0) {
          const toRemove = new Set(indicesToRemove);
          const beforeCount = children.length;
          children = children.filter((_, idx) => !toRemove.has(idx));
          const afterCount = children.length;
          log(`✅ [FINAL-CALLOUT-DEDUPE] Removed ${indicesToRemove.length} duplicate callout(s), blocks: ${beforeCount} → ${afterCount}`);
        }
      }
    } catch (dedupeError) {
      log(`❌ [FINAL-CALLOUT-DEDUPE] Error during final callout deduplication: ${dedupeError.message}`);
      console.error('[FINAL-CALLOUT-DEDUPE] Full error:', dedupeError);
    }

    // v11.0.21 FIX: Collect markers AFTER deduplication (matches PATCH endpoint order)
    // This prevents duplicate blocks with markers from being removed before dedupe runs
    // Collect any in-memory markers that were attached to trailing blocks
    // These will be used by the orchestrator after the page is created
    const markerMap = collectAndStripMarkers(children, {});
    // Remove collected trailing blocks from the main children list so we don't
    // create duplicates on the page root. They'll be appended later by the
    // orchestrator to their intended parents.
    const removedCount = removeCollectedBlocks(children);
    if (removedCount > 0) {
      log(
        `🔖 Removed ${removedCount} collected trailing block(s) from initial children`
      );
    }
    
    // Clean invalid blocks and remove empty children arrays
    const cleanedChildren = cleanInvalidBlocks(children);
    if (Array.isArray(cleanedChildren)) {
      children.length = 0;
      children.push(...cleanedChildren);
    }
    log(`🧹 Cleaned invalid blocks, ${children.length} blocks remain`);
    
    // v11.0.27 FIX: NOW strip private keys after marker collection is complete
    // This ensures _sn2n_marker properties are preserved during collection
    // but removed before sending to Notion API
    deepStripPrivateKeys(children);
    log(`✅ Stripped private keys from ${children.length} children after marker collection`);
    
    if (Object.keys(markerMap).length > 0) {
      log(
        `🔖 Found ${
          Object.keys(markerMap).length
        } marker(s) to orchestrate after create`
      );
      // Log each marker and its block count for debugging
      Object.keys(markerMap).forEach(marker => {
        const blocks = markerMap[marker] || [];
        const blockTypes = blocks.map(b => b.type).join(', ');
        log(`🔖   Marker "${marker}": ${blocks.length} block(s) [${blockTypes}]`);
      });
    }

    // FIX v11.0.71: Deep validation to catch invalid blocks before API call
    function validateBlocksRecursively(blocks, path = 'root') {
      if (!Array.isArray(blocks)) return { valid: true, errors: [] };
      
      const errors = [];
      blocks.forEach((block, idx) => {
        const blockPath = `${path}[${idx}]`;
        
        // Check if block has type property
        if (!block || typeof block !== 'object') {
          errors.push(`${blockPath}: Block is ${block === null ? 'null' : typeof block}`);
          return;
        }
        
        if (!block.type) {
          errors.push(`${blockPath}: Block has no type property (keys: ${Object.keys(block).join(', ')})`);
          return;
        }
        
        // Check children recursively
        const blockType = block.type;
        const blockContent = block[blockType];
        if (blockContent && Array.isArray(blockContent.children)) {
          const childErrors = validateBlocksRecursively(blockContent.children, `${blockPath}.${blockType}.children`);
          errors.push(...childErrors.errors);
        }
      });
      
      return { valid: errors.length === 0, errors };
    }
    
    const validation = validateBlocksRecursively(children);
    if (!validation.valid) {
      log(`❌ [VALIDATION] Found ${validation.errors.length} invalid blocks before API call:`);
      validation.errors.forEach(err => log(`   ⚠️ ${err}`));
      throw new Error(`Invalid blocks detected: ${validation.errors.slice(0, 3).join('; ')}`);
    }
    
    // Create the page (handling Notion's 100-block limit)
    log(`� Creating Notion page with ${children.length} blocks`);

    try {
      const dumpDir = path.join(__dirname, "..", "logs");
      if (!fs.existsSync(dumpDir)) {
        fs.mkdirSync(dumpDir, { recursive: true });
      }
      const dumpPayload = {
        ts: new Date().toISOString(),
        databaseId: payload.databaseId,
        propertyKeys: Object.keys(properties || {}),
        blockCount: children.length,
        blockTypes: children.map((block) => block.type),
        meta: { hasVideos },
        sample: children.slice(0, 20),
      };
      const dumpName = `notion-payload-${dumpPayload.ts
        .replace(/:/g, "-")
        .replace(/\./g, "-")}.json`;
      fs.writeFileSync(
        path.join(dumpDir, dumpName),
        JSON.stringify(dumpPayload, null, 2)
      );
    } catch (err) {
      log(
        "⚠️ Failed to write notion payload dump:",
        err && err.message ? err.message : err
      );
    }

    // FIX v11.0.39: Remove paragraphs that duplicate heading_3 text (table captions)
    // Table captions appear as heading_3 blocks, but sometimes also as paragraphs
    // Keep the heading, remove the paragraph duplicate
    // CRITICAL: Check BOTH children AND markerMap for heading_3 texts since heading may be in marker
    log(`\n📊 [FINAL-CAPTION-FILTER] Starting filter (${children.length} blocks, ${Object.keys(markerMap).length} markers)`);
    const heading3Texts = new Set();
    
    // Collect heading_3 texts from children array
    children.forEach(block => {
      if (block.type === 'heading_3') {
        const text = (block.heading_3?.rich_text || [])
          .map(rt => rt.text?.content || '')
          .join('')
          .trim()
          .toLowerCase();
        if (text) {
          heading3Texts.add(text);
          log(`📊 [FINAL-CAPTION-FILTER] Collected heading_3 from children: "${text}"`);
        }
      }
    });
    
    // Collect heading_3 texts from markerMap blocks (critical for markers with tables)
    Object.keys(markerMap).forEach(marker => {
      markerMap[marker].forEach(block => {
        if (block.type === 'heading_3') {
          const text = (block.heading_3?.rich_text || [])
            .map(rt => rt.text?.content || '')
            .join('')
            .trim()
            .toLowerCase();
          if (text) {
            heading3Texts.add(text);
            log(`📊 [FINAL-CAPTION-FILTER] Collected heading_3 from marker "${marker}": "${text}"`);
          }
        }
      });
    });
    
    log(`📊 [FINAL-CAPTION-FILTER] Found ${heading3Texts.size} heading_3 texts to check against`);
    
    if (heading3Texts.size > 0) {
      const beforeCount = children.length;
      children = children.filter(block => {
        if (block.type === 'paragraph') {
          const text = (block.paragraph?.rich_text || [])
            .map(rt => rt.text?.content || '')
            .join('')
            .trim()
            .toLowerCase();
          log(`📊 [FINAL-CAPTION-FILTER] Checking paragraph: "${text.substring(0, 60)}..." against Set`);
          if (text && heading3Texts.has(text)) {
            log(`📊 [FINAL-CAPTION-FILTER] ✓ MATCH! Removing paragraph that duplicates heading_3: "${text.substring(0, 60)}..."`);
            return false; // Remove this paragraph
          } else {
            log(`📊 [FINAL-CAPTION-FILTER] ✗ No match - keeping paragraph`);
          }
        }
        return true; // Keep all other blocks
      });
      if (children.length < beforeCount) {
        log(`📊 [FINAL-CAPTION-FILTER] Removed ${beforeCount - children.length} duplicate caption paragraph(s)`);
      } else {
        log(`📊 [FINAL-CAPTION-FILTER] No paragraphs removed (all checks failed)`);
      }
    } else {
      log(`📊 [FINAL-CAPTION-FILTER] Skipping filter - no heading_3 texts found`);
    }

    // VALIDATION ENHANCEMENT v11.0.40: Create plain-text copy for validation before page creation
    // This coalesced version is used ONLY for validation statistics (Audit & ContentComparison properties)
    // and is discarded after validation. The formatted blocks (children) are sent to Notion.
    let plainTextChildren = null;
    try {
      // Use servicenowService which was imported at the top of this file
      if (typeof servicenowService.createPlainTextBlocksForValidation === 'function') {
        plainTextChildren = servicenowService.createPlainTextBlocksForValidation(children);
        log(`📝 [VALIDATION-PREP] Created plain-text copy with ${plainTextChildren.length} blocks for validation stats`);
        log(`   Formatted blocks (${children.length}) will be sent to Notion with all formatting preserved`);
      } else {
        log(`⚠️ [VALIDATION-PREP] createPlainTextBlocksForValidation not available in servicenowService`);
      }
    } catch (plainTextError) {
      log(`⚠️ [VALIDATION-PREP] Failed to create plain-text copy: ${plainTextError.message}`);
      log(`   Validation will use formatted blocks instead`);
    }

    // Split children into chunks (Notion's limit is 100, but use smaller chunks for complex pages to avoid timeout)
    const MAX_BLOCKS_PER_REQUEST = 100;
    const INITIAL_BLOCKS_LIMIT = 50; // Use smaller initial chunk to avoid API timeout on complex pages
    const initialBlocks = children.slice(0, INITIAL_BLOCKS_LIMIT);
    const remainingBlocks = children.slice(INITIAL_BLOCKS_LIMIT);

    log(
      `   Initial blocks: ${initialBlocks.length}, Remaining blocks: ${remainingBlocks.length}`
    );

    // Log block types for debugging
    const blockTypes = children.map((b) => b.type).join(", ");
    log(`   Block types: ${blockTypes}`);

    if (getExtraDebug()) {
      children.slice(0, 5).forEach((child, idx) => {
        try {
          log(
            `   🔬 Child ${idx} structure: ${JSON.stringify(child, null, 2)}`
          );
        } catch (serializationError) {
          log(
            `   ⚠️ Failed to serialize child ${idx} for debug: ${serializationError.message}`
          );
        }
      });
    }

    // Debug: Show the actual children structure being sent to Notion
    children.forEach((child, idx) => {
      if (child.type === "paragraph") {
        const richText = child.paragraph?.rich_text || [];
        const hasAnnotations = richText.some((rt) => {
          const ann = rt.annotations || {};
          return ann.bold || ann.italic || ann.code;
        });
        const preview = richText[0]?.text?.content?.substring(0, 60) || "";
        log(
          `   Child ${idx} (paragraph): hasAnnotations=${hasAnnotations}, preview="${preview}..."`
        );

        // Show sample rich text item if it has annotations
        if (hasAnnotations && richText.length > 0) {
          log(
            `   Sample rich_text item:`,
            JSON.stringify(richText.slice(0, 2), null, 2)
          );
        }
      }
    });

    // FIX v11.0.5: Adaptive pre-creation delay based on content complexity
    // Prevents rate limiting for complex pages with many list items, tables, callouts
    const calculateComplexity = (blocks) => {
      let score = 0;
      const totalBlocks = blocks.length;
      const listItems = blocks.filter(b => b.type.includes('list_item')).length;
      const tables = blocks.filter(b => b.type === 'table').length;
      const callouts = blocks.filter(b => b.type === 'callout').length;
      
      // Base scoring: 1 point per 10 blocks, 5 points per table, 2 points per callout
      score += totalBlocks / 10;
      score += tables * 5;
      score += callouts * 2;
      
      // FIX v11.0.6: Enhanced list-heavy content detection with tiered scaling
      // Pages with >200 list items (e.g., Dynatrace guided-setup with 251 lists) need special handling
      if (listItems > 200) {
        // Critical: >200 list items = likely deep nesting requiring extensive orchestration
        // Add 2 points per list item over 200 (40x penalty vs base scoring)
        score += (listItems - 200) * 2;
        log(`   ⚠️ CRITICAL: List-heavy page detected (${listItems} list items)`);
      } else if (listItems > 100) {
        // Warning: >100 list items = moderate orchestration overhead
        // Add 0.5 points per list item over 100 (10x penalty vs base scoring)
        score += (listItems - 100) * 0.5;
        log(`   ⚠️ WARNING: Many list items detected (${listItems} list items)`);
      }
      
      // FIX v11.0.6: Increased max delay to 90s for list-heavy pages (was 30s)
      // At 251 list items: score ~130, delay ~65s
      // At 150 list items: score ~65, delay ~32s
      // At 100 list items: score ~50, delay ~25s
      const delayMs = Math.min(Math.round(score * 500), 90000);
      
      return { 
        score: Math.round(score), 
        delayMs, 
        totalBlocks, 
        listItems, 
        tables, 
        callouts 
      };
    };
    
    const contentComplexity = calculateComplexity(children);
    
    if (contentComplexity.delayMs > 0) {
      log(`⏳ [RATE-LIMIT-PROTECTION] Complex content detected (score: ${contentComplexity.score}/100)`);
      log(`   Total blocks: ${contentComplexity.totalBlocks}`);
      log(`   List items: ${contentComplexity.listItems}`);
      log(`   Tables: ${contentComplexity.tables}`);
      log(`   Callouts: ${contentComplexity.callouts}`);
      log(`   Pre-creation delay: ${contentComplexity.delayMs}ms to avoid rate limits`);
      
      await new Promise(resolve => setTimeout(resolve, contentComplexity.delayMs));
      log(`   ✅ Pre-creation delay complete, proceeding with page creation...`);
    }

    // Create the page with initial blocks (with retry for network errors AND rate limiting)
    let response;
    let retryCount = 0;
    const maxRetries = 2;
    const maxRateLimitRetries = 8; // FIX v11.0.5: Increased from 5 to 8 for better rate limit recovery
    let rateLimitRetryCount = 0;
    
    while (retryCount <= maxRetries || rateLimitRetryCount <= maxRateLimitRetries) {
      try {
        // FIX v11.0.71: Validate initialBlocks right before API call
        const preApiValidation = validateBlocksRecursively(initialBlocks, 'initialBlocks');
        if (!preApiValidation.valid) {
          log(`❌ [PRE-API-VALIDATION] Found ${preApiValidation.errors.length} invalid blocks in initialBlocks:`);
          preApiValidation.errors.forEach(err => log(`   ⚠️ ${err}`));
          
          // Dump the problematic block for debugging
          const problematicPath = preApiValidation.errors[0];
          log(`🔬 [DEBUG] Attempting to dump problematic block structure...`);
          try {
            // Parse path like "initialBlocks[9].numbered_list_item.children[3].bulleted_list_item.children[2]"
            const pathParts = problematicPath.match(/\[(\d+)\]/g);
            if (pathParts && pathParts.length >= 3) {
              const idx1 = parseInt(pathParts[0].match(/\d+/)[0]);
              const idx2 = parseInt(pathParts[1].match(/\d+/)[0]);
              const idx3 = parseInt(pathParts[2].match(/\d+/)[0]);
              const block = initialBlocks[idx1]?.numbered_list_item?.children?.[idx2]?.bulleted_list_item?.children?.[idx3];
              log(`🔬 Problematic block: ${JSON.stringify(block, null, 2)}`);
            }
          } catch (e) {
            log(`⚠️ Failed to dump block: ${e.message}`);
          }
          
          throw new Error(`Invalid blocks in initialBlocks: ${preApiValidation.errors.slice(0, 3).join('; ')}`);
        }
        
        // FIX v11.0.71: Dump the exact block that's causing issues
        try {
          log(`🔬 [DUMP-START] About to check block structure`);
          const block9 = initialBlocks[9];
          log(`🔬 [DUMP-1] block9 type: ${block9 ? block9.type : 'undefined'}`);
          
          if (block9 && block9.numbered_list_item && block9.numbered_list_item.children) {
            log(`🔬 [DUMP-2] block9.numbered_list_item.children length: ${block9.numbered_list_item.children.length}`);
            const child3 = block9.numbered_list_item.children[3];
            log(`🔬 [DUMP-3] child3 type: ${child3 ? child3.type : 'undefined'}`);
            
            if (child3 && child3.bulleted_list_item && child3.bulleted_list_item.children) {
              log(`🔬 [DUMP-4] child3.bulleted_list_item.children length: ${child3.bulleted_list_item.children.length}`);
              const child2 = child3.bulleted_list_item.children[2];
              log(`🔬 [DUMP-5] child2 value: ${JSON.stringify(child2)}`);
            }
          }
          log(`🔬 [DUMP-END] Finished checking block structure`);
        } catch (e) {
          log(`⚠️ [DUMP-ERROR] ${e.message}, stack: ${e.stack}`);
        }
        
        // DEBUG v11.0.70: Log blocks being sent to Notion
        const addFiltersBlock = initialBlocks.find(b => {
          if (b.type === 'numbered_list_item') {
            const text = b.numbered_list_item?.rich_text?.map(rt => rt.text?.content || '').join('') || '';
            return text.includes('Add filters to a class');
          }
          return false;
        });
        if (addFiltersBlock) {
          const blockText = addFiltersBlock.numbered_list_item.rich_text.map(rt => rt.text?.content || '').join('');
          console.log(`🔍 [TEXT-TRACE-3] Sending to Notion API: "${blockText.substring(0, 300)}"`);
          console.log(`🔍 [TEXT-TRACE-3] Block has ${addFiltersBlock.numbered_list_item.children?.length || 0} children`);
        }
        
        response = await notion.pages.create({
          parent: { database_id: payload.databaseId },
          properties: properties,
          icon: {
            type: "external",
            external: {
              url: "https://raw.githubusercontent.com/Christie-Norton-McIntosh/ServiceNow-2-Notion/main/src/img/ServiceNow%20icon.png",
            },
          },
          cover: {
            type: "external",
            external: {
              url: "https://raw.githubusercontent.com/Christie-Norton-McIntosh/ServiceNow-2-Notion/main/src/img/ServiceNow%20cover.png",
            },
          },
          children: initialBlocks,
        });
        break; // Success, exit retry loop
      } catch (error) {
        // Check for rate limiting error (429 Too Many Requests)
        const isRateLimited = error.status === 429 || 
                             error.code === 'rate_limited' || 
                             error.message?.toLowerCase().includes('rate limit');
        
        if (isRateLimited && rateLimitRetryCount < maxRateLimitRetries) {
          rateLimitRetryCount++;
          
          // FIX v11.0.5: Extended retry delays with exponential backoff (no 60s cap)
          // Delays: 15s, 22.5s, 33.75s, 50.6s, 75.9s, 113.8s, 120s, 120s (total: ~651s / 10.85min)
          const baseDelay = 15; // Start at 15s (up from 10s)
          const retryAfter = error.headers?.['retry-after'];
          const exponentialDelay = Math.min(baseDelay * Math.pow(1.5, rateLimitRetryCount - 1), 120);
          const waitSeconds = retryAfter ? parseInt(retryAfter) : exponentialDelay;
          
          log(`⚠️ 🚦 RATE LIMIT HIT (attempt ${rateLimitRetryCount}/${maxRateLimitRetries})`);
          log(`   Page: "${payload.title}"`);
          log(`   Waiting ${Math.round(waitSeconds)}s before retry (exponential backoff)...`);
          log(`   💡 Tip: Notion API has rate limits. AutoExtract will automatically retry.`);
          
          // Wait before retrying
          await new Promise(resolve => setTimeout(resolve, waitSeconds * 1000));
          
          log(`   ✅ Retry-after cooldown complete, attempting page creation again...`);
        } else if (retryCount < maxRetries && (error.code === 'ECONNRESET' || error.message?.includes('socket hang up') || error.message?.includes('ETIMEDOUT'))) {
          retryCount++;
          log(`⚠️ Network error creating page (attempt ${retryCount}/${maxRetries + 1}): ${error.message}`);
          log(`   Retrying in ${retryCount * 2} seconds...`);
          await new Promise(resolve => setTimeout(resolve, retryCount * 2000));
        } else {
          // Non-retryable error or max retries exceeded
          if (isRateLimited) {
            log(`❌ Rate limit exceeded after ${rateLimitRetryCount} retries (~${Math.round(rateLimitRetryCount * 15 * 1.5 / 60)} min total delay)`);
            log(`   💡 This page will be auto-saved for manual retry after cooldown`);
            log(`   Page complexity: ${contentComplexity.score}/100 (${contentComplexity.listItems} list items, ${contentComplexity.tables} tables)`);
            error.message = `Rate limit exceeded after extended retries: ${error.message}. Page "${payload.title}" needs manual retry after cooldown.`;
          }
          throw error;
        }
      }
    }

    log("✅ Page created successfully:", response.id);
    
    // DEBUG v11.0.70: Check if text is in created page
    (async () => {
      try {
        const pageBlocks = await notion.blocks.children.list({ block_id: response.id, page_size: 100 });
        const addFiltersBlock = pageBlocks.results.find(b => {
          if (b.type === 'numbered_list_item') {
            const text = b.numbered_list_item?.rich_text?.map(rt => rt.text?.content || '').join('') || '';
            return text.includes('Add filters to a class');
          }
          return false;
        });
        if (addFiltersBlock) {
          const blockText = addFiltersBlock.numbered_list_item.rich_text.map(rt => rt.text?.content || '').join('');
          console.log(`🔍 [TEXT-TRACE-4] In created page: "${blockText.substring(0, 300)}"`);
        } else {
          console.log(`🔍 [TEXT-TRACE-4] "Add filters to a class" block NOT found in created page!`);
        }
      } catch (e) {
        console.log(`🔍 [TEXT-TRACE-4] Error checking created page: ${e.message}`);
      }
    })();
    
    // SEND RESPONSE IMMEDIATELY to prevent client timeout
    // The response must be sent before validation and other post-processing
    // which can take a long time (30+ seconds for complex pages)
    log("📤 Sending response to client...");
    sendSuccess(res, {
      pageUrl: response.url,
      page: {
        id: response.id,
        url: response.url,
        title: payload.title,
      },
      note: "Validation and post-processing will continue asynchronously"
    });
    log("✅ Response sent - continuing with post-processing...");
    
    // Check for any placeholder warnings that occurred during conversion
    const placeholderWarnings = getAndClearPlaceholderWarnings();
    if (placeholderWarnings.length > 0) {
      console.warn(`\n⚠️ ========== PLACEHOLDER WARNING FOR PAGE ==========`);
      console.warn(`📄 Page ID: ${response.id}`);
      console.warn(`🔗 Notion URL: https://notion.so/${response.id.replace(/-/g, '')}`);
      console.warn(`\n${placeholderWarnings.length} unprotected technical placeholder(s) were stripped during conversion:`);
      
      // Collect all unique placeholders for logging
      const allPlaceholders = [];
      let combinedContext = '';
      
      placeholderWarnings.forEach((warning, index) => {
        console.warn(`\n--- Warning ${index + 1} ---`);
        console.warn(`Placeholders stripped: ${warning.placeholders.join(', ')}`);
        console.warn(`Context: "${warning.context}"`);
        console.warn(`Timestamp: ${warning.timestamp}`);
        
        allPlaceholders.push(...warning.placeholders);
        combinedContext += warning.context + ' ... ';
      });
      
      console.warn(`\n⚠️ PLEASE VERIFY THIS PAGE MANUALLY IN NOTION`);
      console.warn(`   The placeholders above were removed from inline code/text.`);
      console.warn(`   They should have been protected earlier in processing.`);
      console.warn(`⚠️ ================================================\n`);
      
      // Log to verification log file
      logPlaceholderStripped(
        response.id,
        payload.title || 'Untitled',
        Array.from(new Set(allPlaceholders)), // Deduplicate
        combinedContext
      );
    }
    
    // Log any extraction warnings that were collected during HTML conversion
    if (extractionWarnings.length > 0) {
      console.log(`\n⚠️ ========== EXTRACTION WARNINGS FOR PAGE ==========`);
      console.log(`📄 Page: ${payload.title || 'Untitled'}`);
      console.log(`🔗 Notion URL: https://notion.so/${response.id.replace(/-/g, '')}`);
      console.log(`\n${extractionWarnings.length} warning(s) occurred during extraction:\n`);
      
      extractionWarnings.forEach((warning, index) => {
        console.log(`--- Warning ${index + 1}: ${warning.type} ---`);
        
        switch (warning.type) {
          case 'UNPROCESSED_CONTENT':
            console.log(`  ${warning.data.count} elements were not processed`);
            console.log(`  HTML preview: ${warning.data.htmlPreview.substring(0, 100)}...`);
            logUnprocessedContent(
              response.id,
              payload.title || 'Untitled',
              warning.data.count,
              warning.data.htmlPreview
            );
            break;
            
          case 'IMAGE_UPLOAD_FAILED':
            console.log(`  Image URL: ${warning.data.imageUrl.substring(0, 80)}...`);
            console.log(`  Error: ${warning.data.errorMessage}`);
            logImageUploadFailed(
              response.id,
              payload.title || 'Untitled',
              warning.data.imageUrl,
              warning.data.errorMessage
            );
            break;
            
          case 'CHEERIO_PARSING_ISSUE':
            console.log(`  Lost ${warning.data.lostSections} sections, ${warning.data.lostArticles} articles`);
            if (warning.data.lostSectionIds?.length > 0) {
              console.log(`  Lost section IDs: ${warning.data.lostSectionIds.join(', ')}`);
            }
            if (warning.data.lostArticleIds?.length > 0) {
              console.log(`  Lost article IDs: ${warning.data.lostArticleIds.join(', ')}`);
            }
            logCheerioParsingIssue(
              response.id,
              payload.title || 'Untitled',
              warning.data.lostSections,
              warning.data.lostArticles
            );
            break;
            
          default:
            console.log(`  Unknown warning type: ${warning.type}`);
        }
      });
      
      console.log(`⚠️ ================================================\n`);
    }

    // Append remaining blocks in chunks if any
    if (remainingBlocks.length > 0) {
      log(
        `📝 Appending ${remainingBlocks.length} remaining blocks in chunks...`
      );

      // Split remaining blocks into chunks of 100
      const chunks = [];
      for (let i = 0; i < remainingBlocks.length; i += MAX_BLOCKS_PER_REQUEST) {
        chunks.push(remainingBlocks.slice(i, i + MAX_BLOCKS_PER_REQUEST));
      }

      log(
        `   Split into ${chunks.length} chunks of up to ${MAX_BLOCKS_PER_REQUEST} blocks each`
      );

      // Append each chunk
      for (let i = 0; i < chunks.length; i++) {
        const chunk = chunks[i];
        log(
          `   Appending chunk ${i + 1}/${chunks.length} (${
            chunk.length
          } blocks)...`
        );

        // Ensure no private keys in chunk
        deepStripPrivateKeys(chunk);
        await notion.blocks.children.append({
          block_id: response.id,
          children: chunk,
        });

        log(`   ✅ Chunk ${i + 1} appended successfully`);
      }

      log(
        `✅ All ${remainingBlocks.length} remaining blocks appended successfully`
      );
    }

    // After initial page creation and appending remaining blocks, run the orchestrator
    let orchestrationFailed = false;
    let orchestrationError = null;
    
    try {
      if (markerMap && Object.keys(markerMap).length > 0) {
        // FIX v11.0.39: Filter markerMap to remove paragraphs that duplicate heading_3 text
        // Collect all heading_3 texts from BOTH initialBlocks AND markerMap blocks
        log(`\n📊 [MARKER-CAPTION-FILTER] Starting filter for ${Object.keys(markerMap).length} markers`);
        const heading3TextsInMarkers = new Set();
        
        // Collect from initialBlocks
        initialBlocks.forEach(block => {
          if (block.type === 'heading_3') {
            const text = (block.heading_3?.rich_text || [])
              .map(rt => rt.text?.content || '')
              .join('')
              .trim()
              .toLowerCase();
            if (text) {
              heading3TextsInMarkers.add(text);
              log(`📊 [MARKER-CAPTION-FILTER] Collected heading_3 from initialBlocks: "${text}"`);
            }
          }
        });
        
        // Collect from all markerMap blocks
        Object.keys(markerMap).forEach(marker => {
          markerMap[marker].forEach(block => {
            if (block.type === 'heading_3') {
              const text = (block.heading_3?.rich_text || [])
                .map(rt => rt.text?.content || '')
                .join('')
                .trim()
                .toLowerCase();
              if (text) {
                heading3TextsInMarkers.add(text);
                log(`📊 [MARKER-CAPTION-FILTER] Collected heading_3 from marker "${marker}": "${text}"`);
              }
            }
          });
        });
        
        log(`📊 [MARKER-CAPTION-FILTER] Found ${heading3TextsInMarkers.size} heading_3 texts to check against`);
        
        // Filter each marker's blocks to remove duplicate caption paragraphs
        if (heading3TextsInMarkers.size > 0) {
          Object.keys(markerMap).forEach(marker => {
            const blocks = markerMap[marker];
            const beforeCount = blocks.length;
            log(`📊 [MARKER-CAPTION-FILTER] Checking marker "${marker}" (${beforeCount} blocks)`);
            markerMap[marker] = blocks.filter(block => {
              if (block.type === 'paragraph') {
                const text = (block.paragraph?.rich_text || [])
                  .map(rt => rt.text?.content || '')
                  .join('')
                  .trim()
                  .toLowerCase();
                log(`📊 [MARKER-CAPTION-FILTER] Checking paragraph in marker: "${text.substring(0, 60)}..."`);
                if (text && heading3TextsInMarkers.has(text)) {
                  log(`📊 [MARKER-CAPTION-FILTER] ✓ MATCH! Removing paragraph from marker "${marker}" that duplicates heading_3: "${text.substring(0, 60)}..."`);
                  return false;
                } else {
                  log(`📊 [MARKER-CAPTION-FILTER] ✗ No match - keeping paragraph in marker`);
                }
              }
              return true;
            });
            if (markerMap[marker].length < beforeCount) {
              log(`📊 [MARKER-CAPTION-FILTER] Filtered marker "${marker}": ${beforeCount} → ${markerMap[marker].length} blocks`);
            } else {
              log(`📊 [MARKER-CAPTION-FILTER] No changes to marker "${marker}"`);
            }
          });
        } else {
          log(`📊 [MARKER-CAPTION-FILTER] Skipping filter - no heading_3 texts found in initialBlocks`);
        }
        
        log(`\n========================================`);
        log("🔧 STARTING ORCHESTRATION (deep nesting + marker cleanup)");
        log(`   Page ID: ${response.id}`);
        log(`   Markers to process: ${Object.keys(markerMap).length}`);
        log(`========================================\n`);
        
        const orch = await orchestrateDeepNesting(response.id, markerMap);
        log("✅ Orchestrator completed successfully:", orch);
        
        // CRITICAL: After orchestration adds children to list items, we need to deduplicate again
        // The orchestrator may add duplicate callouts as children to list items
        // IMPORTANT: Do NOT deduplicate siblings at page root! Only deduplicate children of blocks.
        log("🔧 Running post-orchestration deduplication on nested block children...");
        
        try {
          // Fetch the current page blocks
          const pageBlocks = await notion.blocks.children.list({ block_id: response.id, page_size: 100 });
          let allBlocks = pageBlocks.results || [];
          
          // Fetch remaining pages if needed
          let cursor = pageBlocks.next_cursor;
          while (cursor) {
            const nextPage = await notion.blocks.children.list({ 
              block_id: response.id, 
              start_cursor: cursor,
              page_size: 100 
            });
            allBlocks = allBlocks.concat(nextPage.results || []);
            cursor = nextPage.next_cursor;
          }
          
          log(`   Fetched ${allBlocks.length} blocks from page (will NOT deduplicate these siblings)`);
          
          // For each block with children (list items, callouts, toggles), deduplicate its children
          // The orchestration phase can add children to these block types
          // IMPORTANT: We DO NOT deduplicate the page root blocks themselves - those are legitimate siblings
          const blockTypesWithChildren = ['numbered_list_item', 'bulleted_list_item', 'callout', 'toggle', 'quote', 'column'];
          
          // Recursive function to deduplicate children at all nesting levels
          async function deduplicateBlockChildren(blockId, blockType, depth = 0) {
            const indent = '  '.repeat(depth);
            const childrenResp = await notion.blocks.children.list({ block_id: blockId, page_size: 100 });
            const children = childrenResp.results || [];
            
            if (children.length > 1) {
              // Find CONSECUTIVE/ADJACENT duplicates only
              // Preserve identical blocks that appear in different parts of the document
              // (e.g., same table in repeated process steps)
              const duplicateIds = [];
              
              // CONTEXT-AWARE DEDUPLICATION:
              // 1. For list items (procedural steps), don't deduplicate images or tables
              //    These often legitimately repeat (e.g., same icon in multiple steps)
              // 2. At page root, deduplicate consecutive tables/images/callouts but NOT list items
              //    List items from different lists are siblings and should NOT be compared
              const isListItem = blockType === 'numbered_list_item' || blockType === 'bulleted_list_item';
              const isPageRoot = blockType === 'page';
              
              let prevChild = null;
              let prevKey = null;
              
              for (const child of children) {
                // Skip deduplication for images and tables ONLY inside list items
                if (isListItem && !isPageRoot && (child.type === 'image' || child.type === 'table')) {
                  log(`${indent}  ✓ Preserving ${child.type} in ${blockType} (procedural context)`);
                  prevChild = child;
                  prevKey = null; // Don't track key for comparison
                  continue;
                }
                
                // Skip deduplication for list items at page root (they're from different lists)
                if (isPageRoot && (child.type === 'numbered_list_item' || child.type === 'bulleted_list_item')) {
                  log(`${indent}  ✓ Preserving ${child.type} at page root (different lists)`);
                  prevChild = child;
                  prevKey = null;
                  continue;
                }
                
                // For tables at page root, only check consecutive duplicates if we have few tables
                // FIXED v11.0.7: Skip deduplication for ALL tables at page root
                // Notion API returns tables without their children, so different tables look identical by structure
                // Tables in different sections are legitimate content, not duplicates from orchestration
                if (isPageRoot && child.type === 'table') {
                  const tableCount = children.filter(c => c.type === 'table').length;
                  log(`${indent}  ✓ Preserving table at page root (${tableCount} table(s) - likely from different sections)`);
                  prevChild = child;
                  prevKey = null;
                  continue;
                }
                
                // Skip deduplication for images at page root (they're in different sections, not duplicates)
                // Images in different sections legitimately show different content
                if (isPageRoot && child.type === 'image') {
                  log(`${indent}  ✓ Preserving image at page root (different sections)`);
                  prevChild = child;
                  prevKey = null;
                  continue;
                }
                
                const key = dedupeUtil.computeBlockKey(child);
                
                // Only mark as duplicate if IMMEDIATELY PREVIOUS block has the same key
                if (prevKey && key === prevKey && prevChild) {
                  duplicateIds.push(child.id);
                  log(`${indent}  🔎 Found consecutive duplicate ${child.type}: ${child.id}`);
                } else {
                  prevChild = child;
                  prevKey = key;
                }
              }
              
              // Delete duplicates
              for (const dupId of duplicateIds) {
                try {
                  await notion.blocks.delete({ block_id: dupId });
                  log(`${indent}  🚫 Deleted duplicate child block: ${dupId}`);
                } catch (deleteError) {
                  log(`${indent}  ❌ Failed to delete duplicate ${dupId}: ${deleteError.message}`);
                }
              }
              
              if (duplicateIds.length > 0) {
                log(`${indent}Removed ${duplicateIds.length} duplicate(s) from ${blockType}`);
              }
            }
            
            // Recursively check children of children (for nested structures)
            for (const child of children) {
              if (blockTypesWithChildren.includes(child.type) && child.has_children) {
                await deduplicateBlockChildren(child.id, child.type, depth + 1);
              }
            }
          }
          
          // First, deduplicate at the PAGE ROOT LEVEL (most important!)
          // This catches duplicate tables/images/callouts at the top level
          log(`🔍 Deduplicating page root level...`);
          await deduplicateBlockChildren(response.id, 'page', 0);
          
          // Then deduplicate children of specific block types
          for (const block of allBlocks) {
            if (blockTypesWithChildren.includes(block.type) && block.has_children) {
              await deduplicateBlockChildren(block.id, block.type, 0);
            }
          }
          
          log("✅ Post-orchestration deduplication complete");
        } catch (dedupError) {
          log(`⚠️ Post-orchestration deduplication failed: ${dedupError.message}`);
        }
      } else {
        log("ℹ️ No markers to orchestrate (no deep nesting needed)");
      }
    } catch (e) {
      orchestrationFailed = true;
      orchestrationError = e;
      log(`\n========================================`);
      log("❌ ORCHESTRATION FAILED");
      log(`   Error: ${e.message}`);
      log(`   Stack: ${e.stack}`);
      log(`========================================\n`);
      log("⚠️ WARNING: Page may contain visible markers (marker cleanup failed)");
      log("⚠️ This page should be flagged for manual review or re-PATCH");
    }
    
    // FIX v11.0.23: ALWAYS RUN MARKER SWEEP after orchestration (same as PATCH endpoint)
    // The orchestrator's internal sweep may run before Notion's API has propagated all block updates
    // A final sweep with a delay ensures all residual markers are caught
    // This prevents marker leaks that validation detects in POST operations
    const hasMarkers = Object.keys(markerMap || {}).length > 0;
    const reason = orchestrationFailed 
      ? 'Orchestration failed - emergency cleanup' 
      : hasMarkers 
        ? 'POST safety sweep (verify orchestrator cleaned all markers)'
        : 'POST safety sweep (no markers expected but checking anyway)';
    
    log(`\n========================================`);
    log("🧹 RUNNING FINAL MARKER SWEEP");
    log(`   Reason: ${reason}`);
    log(`   Markers in map: ${Object.keys(markerMap || {}).length}`);
    log(`   Orchestration status: ${orchestrationFailed ? 'FAILED' : 'succeeded'}`);
    log(`========================================\n`);
    
    // Wait 1 second before sweep to let Notion's eventual consistency settle
    // This matches PATCH endpoint behavior and reduces false positives
    log(`⏸️  Waiting 1s before marker sweep to reduce conflicts...`);
    await new Promise(resolve => setTimeout(resolve, 1000));
    
    try {
      const sweepResult = await global.sweepAndRemoveMarkersFromPage(response.id);
      
      if (sweepResult && sweepResult.updated > 0) {
        log(`✅ Final marker sweep updated ${sweepResult.updated} blocks`);
        if (orchestrationFailed) {
          log(`✅ Successfully recovered from orchestration failure via marker sweep`);
        } else {
          log(`⚠️ Found markers after orchestration - orchestrator's internal sweep may have run too early`);
        }
      } else {
        log(`✅ Final marker sweep found no markers to remove`);
      }
    } catch (sweepError) {
      log(`❌ Final marker sweep failed: ${sweepError.message}`);
      log(`   Stack: ${sweepError.stack}`);
      log(`⚠️ Page ${response.id} may have visible markers - flagged for validation`);
    }

    // FIX v11.0.37: REMOVED pre-validation cleanup
    // No longer needed since we stopped creating validation paragraphs (v11.0.37)
    // Previous approach (create → cleanup) was flawed:
    // - Created duplicate content visible to users
    // - Cleanup wasn't reliable for nested blocks
    // - Content validator can extract text directly from Notion blocks
    // New approach: Never create validation paragraphs at all
    log(`📋 Validation enabled (no cleanup needed - validation paragraphs not created)`);
    
    // Run post-creation validation if enabled
    let validationResult = null;
    
    // Track validation status for polling endpoint
    if (shouldValidate) {
      validationStatus.set(response.id, {
        status: 'pending',
        startTime: new Date().toISOString()
      });
    }
    
    // FIX v11.0.18: Always create a validation result, even if validation is disabled
    // This ensures properties are never left blank
    if (!shouldValidate) {
      validationResult = {
        success: true,
        hasErrors: false,
        issues: [],
        warnings: [],
        stats: null,
        summary: `ℹ️ Validation not enabled (set SN2N_VALIDATE_OUTPUT=1 to enable)`
      };
      log(`ℹ️ Validation skipped - will set properties to indicate validation not run`);
    }
    
    if (shouldValidate) {
      // Update status to running
      const statusData = validationStatus.get(response.id);
      if (statusData) {
        statusData.status = 'running';
      }
      
      log(`\n========================================`);
      log(`🔍 STARTING VALIDATION for page ${response.id}`);
      log(`   Title: "${payload.title}"`);
      log(`   Expected blocks: ${children.length}`);
      if (orchestrationFailed) {
        log(`   ⚠️ ORCHESTRATION FAILED - validation will likely detect marker leaks`);
      }
      log(`========================================\n`);
      
      try {
        // Dynamic wait time based on orchestration complexity and page size
        // FIX v11.0.34: Increased base wait to account for Notion's eventual consistency
        // Pages were failing POST validation but passing PATCH (identical content)
        // Root cause: POST validation ran too soon after page creation + chunked appends
        // PATCH takes longer (delete + upload) giving Notion time to become consistent
        // 
        // Wait time formula:
        // Base: 5s for initial page creation + chunked block appends
        // +300ms per marker processed (orchestration PATCH requests)
        // +1s if page has >100 blocks (needs chunked append settling time)
        // Max: 15s to prevent excessive delays while ensuring consistency
        const markerCount = Object.keys(markerMap).length;
        const totalBlocks = children.length;
        const baseWait = 5000; // 5 seconds base (increased from 2s - v11.0.34)
        const extraWaitPerMarker = 300; // 300ms per marker (orchestration PATCH)
        const largePageWait = totalBlocks > 100 ? 1000 : 0; // +1s for pages >100 blocks
        
        let waitTime = baseWait;
        if (markerCount > 0) {
          waitTime += (markerCount * extraWaitPerMarker);
          log(`   +${markerCount * extraWaitPerMarker}ms for ${markerCount} markers (orchestration)`);
        }
        if (largePageWait > 0) {
          waitTime += largePageWait;
          log(`   +${largePageWait}ms for large page (${totalBlocks} blocks - chunked appends)`);
        }
        
        // Cap at 15 seconds (increased from 10s - v11.0.34)
        waitTime = Math.min(waitTime, 15000);
        
        log(`⏳ Waiting ${waitTime}ms for Notion API to process page creation and orchestration...`);
        log(`   (Base: 5s + Markers: ${markerCount} × 300ms + Large page: ${largePageWait}ms = ${waitTime}ms)`);
        await new Promise(resolve => setTimeout(resolve, waitTime));
        
        log("🔍 Running post-creation validation...");
        
        // FIX v11.0.30: Verify page was actually created with content before validation
        let hasContent = false;
        try {
          log(`🔍 Verifying page has content blocks...`);
          const blockCheck = await notion.blocks.children.list({
            block_id: response.id,
            page_size: 10
          });
          
          hasContent = blockCheck.results && blockCheck.results.length > 0;
          
          if (!hasContent) {
            log(`❌ WARNING: Page created but has NO BLOCKS - validation cannot run`);
            validationResult = {
              success: false,
              hasErrors: true,
              issues: ['Page creation succeeded but no blocks were uploaded - likely Notion API error or rate limit'],
              warnings: [],
              stats: { totalBlocks: 0 },
              summary: '❌ CRITICAL: Page created but empty - no content blocks uploaded. This may indicate a Notion API error, rate limit, or network issue during block upload. Page needs to be re-created or PATCHed with content.'
            };
            
            // Auto-save to pages-to-update for investigation
            const timestamp = new Date().toISOString().replace(/:/g, '-').split('.')[0];
            const sanitizedTitle = (payload.title || 'untitled').toLowerCase().replace(/[^a-z0-9]+/g, '-').substring(0, 50);
            const filename = `${sanitizedTitle}-empty-page-${timestamp}.html`;
            const filepath = path.join(__dirname, '../../patch/pages/pages-to-update', filename);
            
            fs.writeFileSync(filepath, payload.contentHtml, 'utf-8');
            log(`💾 Saved empty page HTML to: ${filename}`);
          } else {
            log(`✅ Page has ${blockCheck.results.length} blocks - proceeding with validation`);
          }
        } catch (pageCheckError) {
          log(`⚠️ Error checking page content: ${pageCheckError.message}`);
          // Fall through to validation (might be temporary API issue)
          hasContent = true; // Assume content exists and let validation run
        }
        
        // Only run full validation if page has content
        if (hasContent) {
          // Estimate expected block count range (±30% tolerance)
          const expectedBlocks = children.length;
          const minBlocks = Math.floor(expectedBlocks * 0.7);
          const maxBlocks = Math.ceil(expectedBlocks * 1.5);
          
          validationResult = await validateNotionPage(
            notion,
            response.id,
            {
              expectedMinBlocks: minBlocks,
              expectedMaxBlocks: maxBlocks,
              sourceHtml: extractionResult?.fixedHtml || payload.contentHtml // Use fixed HTML for accurate validation
            },
            log
          );
          
          log(`✅ Validation function completed`);
          
          // FIX v11.0.36: Retry validation up to 2 times with escalating waits (5s, 10s)
          // Handles edge cases where Notion takes >15s to settle (rare but happens)
          // Only retries if validation has actual errors (not just warnings)
          const maxValidationRetries = 2;
          let retryAttempt = 0;
          
          while (retryAttempt < maxValidationRetries && validationResult && !validationResult.success && validationResult.hasErrors) {
            retryAttempt++;
            const retryWait = retryAttempt * 5000; // 5s, 10s
            
            log(`\n⚠️ Validation attempt ${retryAttempt} failed - retrying after ${retryWait}ms...`);
            log(`   Issues: ${validationResult.issues?.join(', ') || 'unknown'}`);
            
            await new Promise(resolve => setTimeout(resolve, retryWait));
            
            log(`🔄 Retrying validation (attempt ${retryAttempt + 1}/${maxValidationRetries + 1})...`);
            const retryResult = await validateNotionPage(
              notion,
              response.id,
              {
                expectedMinBlocks: minBlocks,
                expectedMaxBlocks: maxBlocks,
                sourceHtml: extractionResult?.fixedHtml || payload.contentHtml
              },
              log
            );
            
            if (retryResult.success) {
              log(`✅ Validation succeeded on retry ${retryAttempt} - Notion eventual consistency resolved`);
              validationResult = retryResult;
              break;
            } else {
              log(`⚠️ Validation still failing after retry ${retryAttempt}`);
              validationResult = retryResult;
              
              if (retryAttempt === maxValidationRetries) {
                // All retries exhausted
                if (!validationResult.warnings) validationResult.warnings = [];
                validationResult.warnings.push(`Validation retried ${maxValidationRetries} times but still failed`);
              }
            }
          }
        }
        
      } catch (validationError) {
        log(`⚠️ Validation failed with error: ${validationError.message}`);
        log(`⚠️ Stack trace: ${validationError.stack}`);
        
        // Update validation status to error
        const statusData = validationStatus.get(response.id);
        if (statusData) {
          statusData.status = 'error';
          statusData.endTime = new Date().toISOString();
          statusData.error = validationError.message;
        }
        
        // FIX v11.0.18: Create a validation result even when validation throws
        // This ensures properties are ALWAYS updated, never left blank
        validationResult = {
          success: false,
          hasErrors: true,
          issues: [`Validation error: ${validationError.message}`],
          warnings: [],
          stats: null,
          summary: `❌ Validation encountered an error: ${validationError.message}\n\nStack: ${validationError.stack?.substring(0, 500) || 'N/A'}`
        };
        log(`📝 Created error validation result to ensure properties are updated`);
        // Don't fail the entire request if validation fails
      }
      
      // If orchestration failed, add that to validation issues
      if (orchestrationFailed && validationResult) {
        if (!validationResult.issues) validationResult.issues = [];
        validationResult.issues.push(`Orchestration failed: ${orchestrationError?.message || 'Unknown error'} - page may contain visible markers`);
        validationResult.hasErrors = true;
        validationResult.success = false;
        
        // Update summary to reflect orchestration failure
        const orchFailureNote = `\n\n❌ CRITICAL: Orchestration failed - markers may be visible in page`;
        if (validationResult.summary) {
          validationResult.summary += orchFailureNote;
        } else {
          validationResult.summary = orchFailureNote;
        }
        
        log(`⚠️ Added orchestration failure to validation result`);
      }
      
      // Update page properties with validation results (moved outside try/catch)
      // This ensures properties are ALWAYS updated, even if validation errors
      // FIX v11.0.18: Add safety check - if validationResult is somehow null, create a default one
      if (!validationResult) {
        log(`⚠️ WARNING: validationResult is null - creating default result`);
        validationResult = {
          success: false,
          hasErrors: true,
          issues: ['Internal error: validation result was null'],
          warnings: [],
          stats: null,
          summary: '❌ Internal error: validation result was not created properly'
        };
      }
      
      // FIX v11.0.29: Ensure validationResult.summary is NEVER empty (prevents empty arrays in Notion)
      if (!validationResult.summary || validationResult.summary.trim() === '') {
        log(`⚠️ WARNING: Validation summary is empty - using default message`);
        validationResult.summary = '⚠️ Validation completed but no summary was generated';
        validationResult.hasErrors = true;
        if (!validationResult.issues) validationResult.issues = [];
        validationResult.issues.push('Internal error: validation summary was empty');
      }
      
      if (validationResult) {
        // FIX v11.0.7: Increased retries from 3 to 5 and longer delays to handle transient Notion API issues
        // Pages were being "skipped" for validation when property updates failed after 3 attempts
        const maxPropertyRetries = 5;
        let propertyUpdateSuccess = false;
        // savedToUpdateFolder now declared at function scope (removed duplicate declaration - v11.0.33)
        
        for (let propRetry = 0; propRetry <= maxPropertyRetries && !propertyUpdateSuccess; propRetry++) {
          try {
            const propertyUpdates = {};

            // FIX v11.0.113: Get audit result from extraction (if available)
            const auditResult = extractionResult?.audit;

            // FIX v11.0.113: Use AUDIT-only validation (removed all LCS similarity logic)
            // AUDIT passes if coverage is within 95-105% threshold
            const hasOrderIssues = Array.isArray(validationResult.orderIssues) && validationResult.orderIssues.length > 0;
            const hasMarkerLeaks = validationResult.hasErrors && 
                                   validationResult.issues?.some(issue => 
                                     issue.toLowerCase().includes('marker') || 
                                     issue.toLowerCase().includes('sn2n:')
                                   );
            
            const auditPassed = auditResult && auditResult.passed;
            
            // Determine status based on AUDIT only (no LCS similarity)
            let validationStatus;
            let statusIcon;
            if (auditPassed) {
              validationStatus = 'PASS';
              statusIcon = '✅';
            } else if (auditResult && !auditResult.passed) {
              validationStatus = 'FAIL';
              statusIcon = '❌';
            } else if (hasMarkerLeaks) {
              validationStatus = 'FAIL';
              statusIcon = '❌';
            } else if (hasOrderIssues) {
              validationStatus = 'WARNING';
              statusIcon = '🔀';
            } else {
              // AUDIT not enabled - use WARNING status
              validationStatus = 'WARNING';
              statusIcon = '⚠️';
            }
            
            const passFail = validationStatus;

            // (Removed deprecated Status property logic; counts handled in ContentComparison header)

            // Order issues section: list ALL issues (not just first 2)
            let orderSection = '';
            if (Array.isArray(validationResult.orderIssues) && validationResult.orderIssues.length > 0) {
              const lines = [`⚠️ Order Issues (${validationResult.orderIssues.length} detected):`];
              
              validationResult.orderIssues.forEach((iss, idx) => {
                lines.push(`${idx + 1}. Inversion detected:`);
                lines.push(`   A: "${iss.segmentA || 'Unknown'}..."`);
                lines.push(`   B: "${iss.segmentB || 'Unknown'}..."`);
                lines.push(`   HTML order: A at ${iss.htmlOrder?.[0] ?? '?'}, B at ${iss.htmlOrder?.[1] ?? '?'}`);
                lines.push(`   Notion order: A at ${iss.notionOrder?.[0] ?? '?'}, B at ${iss.notionOrder?.[1] ?? '?'}`);
              });
              
              orderSection = lines.join('\n');
            }

            // Missing segments section: list ALL missing segments (not just first 3)
            let missingSection = '';
            if (Array.isArray(validationResult.missing) && validationResult.missing.length > 0) {
              const lines = [`⚠️ Missing: ${validationResult.missing.length} segment(s)`];
              lines.push(`(in HTML but not Notion)`);
              
              validationResult.missing.forEach((m, idx) => {
                const text = m?.text || m?.segment || m || '';
                const preview = text.length > 80 ? text.substring(0, 80) + '...' : text;
                lines.push(`${idx + 1}. ${preview}`);
              });
              
              missingSection = lines.join('\n');
            }

            // FIX v11.0.113: Build AUDIT-based Validation property (removed LCS validation)
            const timestamp = new Date().toISOString().split('T')[0];
            const validationLines = [];
            
            // Content Audit section (AUDIT coverage - PASS/FAIL/SKIPPED)
            if (auditResult) {
              // FIX v11.0.86+: Reorganized output format for clarity
              // Primary focus: Content extraction success + formatting overhead
              // Secondary details: Content complexity
              
              // Line 1: Timestamp + Content extraction status
              if (auditResult.missing === 0 && auditResult.extra === 0) {
                // Perfect match
                validationLines.push(`[${timestamp}] ✅ Content Extraction: 100.0% of source (exact match)`);
              } else if (auditResult.missing === 0 && auditResult.extra > 0) {
                // All content extracted, with formatting overhead
                const formattingOverhead = auditResult.extraPercent;
                validationLines.push(`[${timestamp}] ✅ Content Extraction: 100.0% of source (all content preserved)`);
                validationLines.push(`Formatting Overhead: +${formattingOverhead}% `);
              } else if (auditResult.missing > 0) {
                // Some content missing
                const contentExtracted = 100 - auditResult.missingPercent;
                validationLines.push(`[${timestamp}] ${auditResult.passed ? '✅' : '⚠️'} Content Extraction: ${contentExtracted.toFixed(1)}% of source`);
                if (auditResult.extra > 0) {
                  validationLines.push(`Formatting Overhead: +${auditResult.extraPercent}%`);
                }
                validationLines.push(`⚠️ Missing: ${auditResult.missing.toLocaleString()} chars (${auditResult.missingPercent}%)`);
              }
              
              // Add content complexity summary if available
              if (auditResult.contentAnalysis) {
                const ca = auditResult.contentAnalysis;
                const complexityDetails = [];
                if (ca.tableCount > 0) complexityDetails.push(`${ca.tableCount} table${ca.tableCount > 1 ? 's' : ''}`);
                if (ca.calloutCount > 0) complexityDetails.push(`${ca.calloutCount} callout${ca.calloutCount > 1 ? 's' : ''}`);
                if (ca.nestedListCount > 0) complexityDetails.push(`${ca.nestedListCount} nested list${ca.nestedListCount > 1 ? 's' : ''}`);
                if (ca.deepNestingCount > 0) complexityDetails.push(`${ca.deepNestingCount} deep nesting block${ca.deepNestingCount > 1 ? 's' : ''}`);
                
                if (complexityDetails.length > 0) {
                  validationLines.push(`\nContent: ${complexityDetails.join(', ')}`);
                }
              }
              
              // Add coverage and threshold info (for reference)
              validationLines.push(`\nCoverage: ${auditResult.coverageStr} (threshold: ${auditResult.threshold || '95-105%'})`);
              
              // Add technical details (hidden from casual reading)
              validationLines.push(`Source: ${auditResult.nodeCount || 'N/A'} text nodes, ${auditResult.totalLength || 'N/A'} chars`);
              validationLines.push(`Notion: ${auditResult.notionBlocks} blocks, ${auditResult.notionTextLength} chars`);
              validationLines.push(`Block/Node Ratio: ${auditResult.blockNodeRatio}x`);
              
              if (auditResult.detailedComparison) {
                const dc = auditResult.detailedComparison;
                validationLines.push(`HTML segments: ${dc.htmlSegmentCount}, Notion segments: ${dc.notionSegmentCount}`);
              }
            } else {
              validationLines.push(`[${timestamp}] Content Audit: ⚠️ SKIPPED`);
              validationLines.push('AUDIT system not enabled - no coverage data available');
            }
            
            // FIX v11.0.216: Include detailed missing segments in Audit property
            // Users need to see WHAT content is missing, not just coverage percentage
            if (missingSection) {
              validationLines.push('');
              validationLines.push(missingSection);
            }
            
            const auditContent = validationLines.join('\n');

            log(`📊 [POST-AUDIT-DEBUG] Setting Audit property (POST):`);
            log(`   Content length: ${auditContent.length} chars`);
            log(`   Content preview: ${auditContent.substring(0, 200)}...`);
            log(`   Has AUDIT result: ${!!auditResult}`);

            // Truncate to fit Notion's 2000 character limit for rich text properties
            let truncatedAuditContent = auditContent;
            if (auditContent.length > 2000) {
              truncatedAuditContent = auditContent.substring(0, 1997) + '...';
              log(`⚠️ [PROPERTY-TRUNCATE] Audit property truncated to 2000 chars (was ${auditContent.length})`);
            }

            propertyUpdates["Audit"] = {
              rich_text: [ { type: 'text', text: { content: truncatedAuditContent } } ]
            };

            // Create separate properties for detailed text comparison
            // Helper: produce a compact context tag for a segment, e.g. ' [p]' or ' [tc]'
            function compactContextTag(seg) {
              if (!seg) return '';
              try {
                if (seg.blockType) {
                  const m = {
                    paragraph: 'p',
                    callout: 'co',
                    heading_1: 'h1',
                    heading_2: 'h2',
                    heading_3: 'h3',
                    table_cell: 'tc',
                    table_row: 'tr',
                    bulleted_list_item: 'li',
                    numbered_list_item: 'li',
                    image: 'img'
                  };
                  const key = m[seg.blockType] || (seg.blockType || '').substring(0,3);
                  return ` [${key}]`;
                }
                if (seg.element) {
                  const el = (seg.element || '').toLowerCase();
                  const m2 = { p: 'p', li: 'li', td: 'tc', th: 'tc', span: 'sp', div: 'div' };
                  const key = m2[el] || el.substring(0,3);
                  return ` [${key}]`;
                }
                if (seg.context) {
                  const parts = (seg.context || '').split('>').map(s => s.trim()).filter(Boolean);
                  if (parts.length) {
                    const last = parts[parts.length - 1];
                    const short = last.replace(/[^a-z0-9]/gi, '').substring(0,3) || last.substring(0,3);
                    return ` [${short}]`;
                  }
                }
              } catch (e) {
                // ignore
              }
              return '';
            }

            if (auditResult && auditResult.detailedComparison) {
              const dc = auditResult.detailedComparison;

              // FIX v11.0.86+: MissingText and ExtraText properties removed
              // Missing/extra content details now included in Audit property directly
              // No separate property updates needed

            }

            // ContentComparison breakdown formatting (first line reflects table/image/callout count match, not validation status)
            const stats = validationResult.stats || {};
            
            // FIX v11.0.173: Count blocks from ORIGINAL HTML (not converted Notion blocks)
            // This shows true conversion accuracy: what's in ServiceNow HTML vs what's in Notion
            // Previous logic counted already-converted Notion blocks, which would always match unless upload failed
            log(`📊 [STATS-COUNT] Counting blocks from original HTML (pre-conversion)`);
            
            const sourceCounts = {
              paragraphs: 0,
              headings: 0,
              tables: 0,
              images: 0,
              callouts: 0,
              code: 0,
              orderedList: 0,
              unorderedList: 0
            };
            
            // Count blocks directly from HTML structure
            try {
              const cheerio = require('cheerio');
              const sourceHtml = payload.contentHtml || payload.content;
              const $ = cheerio.load(sourceHtml, { decodeEntities: false });
              
              log(`📊 [HTML-SOURCE-DEBUG] HTML length: ${sourceHtml.length} chars`);
              log(`📊 [HTML-SOURCE-DEBUG] HTML preview: ${sourceHtml.substring(0, 200)}`);
              
              // Count paragraphs (p tags that aren't empty)
              let pCount = 0;
              $('p').each((i, elem) => {
                const text = $(elem).text().trim();
                if (text.length > 0) {
                  pCount++;
                  sourceCounts.paragraphs++;
                }
              });
              log(`📊 [HTML-SOURCE-DEBUG] Found ${pCount} non-empty <p> tags`);
              
              // Count headings (h2-h6 + span.title which become headings in Notion)
              // FIX v11.0.188: Exclude H1 (page title) and sidebar headings from comparison
              // H1 is always the page name/title and should not be duplicated in page content
              // Sidebars are navigation/metadata, not content
              let hCount = 0;
              $('h2, h3, h4, h5, h6, span.title').each((i, elem) => {
                const $elem = $(elem);
                // Skip if inside sidebar/navigation containers
                const inSidebar = $elem.closest('.zDocsSideBoxes, .contentPlaceholder, .miniTOC, aside, nav').length > 0;
                if (!inSidebar) {
                  hCount++;
                  sourceCounts.headings++;
                }
              });
              log(`📊 [HTML-SOURCE-DEBUG] Found ${hCount} heading tags (h2-h6 + span.title, excluding H1 and sidebars)`);
              
              
              // Count tables
              const tableCount = $('table').length;
              sourceCounts.tables = tableCount;
              log(`📊 [HTML-SOURCE-DEBUG] Found ${tableCount} <table> tags`);
              
              // Count images (img tags, excluding base64 data URIs and images inside tables)
              // FIX v11.0.184: Skip images in tables because Notion tables are incompatible with image handling
              let imgCount = 0;
              $('img').each((i, elem) => {
                const src = $(elem).attr('src') || '';
                const isInTable = $(elem).closest('table').length > 0;
                if (!src.startsWith('data:') && !isInTable) {
                  imgCount++;
                  sourceCounts.images++;
                }
              });
              log(`📊 [HTML-SOURCE-DEBUG] Found ${imgCount} <img> tags (non-data URI, excluding images in tables)`);
              
              // Count callouts (note class, warning class, etc.)
              // FIX v11.0.180: Only count top-level callout containers (not nested titles/children)
              // ServiceNow notes have structure: <div class="note note note_note"><span class="note__title">
              // We should only count the outer <div>, not the inner <span>
              // FIX v11.0.86: Exclude callouts inside tables - Notion table cells can't contain callout blocks
              // Callouts in tables get converted to text/other types, not callout blocks
              let calloutCount = 0;
              $('div.note, div.warning, div.info, div.tip, div.caution, div.important').each((i, elem) => {
                const $elem = $(elem);
                // Skip if this callout is inside a table - it won't be rendered as a callout block
                const inTable = $elem.closest('table, thead, tbody, tr, td, th').length > 0;
                if (!inTable) {
                  calloutCount++;
                }
              });
              sourceCounts.callouts = calloutCount;
              log(`📊 [HTML-SOURCE-DEBUG] Found ${calloutCount} callout elements (excluding callouts in tables)`);
              
              // Count code blocks (pre or code tags)
              const preCount = $('pre').length;
              sourceCounts.code = preCount;
              log(`📊 [HTML-SOURCE-DEBUG] Found ${preCount} <pre> tags`);
              
              // Count ordered lists (ol > li)
              const olCount = $('ol > li').length;
              sourceCounts.orderedList = olCount;
              log(`📊 [HTML-SOURCE-DEBUG] Found ${olCount} <ol><li> items`);
              
              // Count unordered lists (ul > li)
              const ulCount = $('ul > li').length;
              sourceCounts.unorderedList = ulCount;
              log(`📊 [HTML-SOURCE-DEBUG] Found ${ulCount} <ul><li> items`);
              
              log(`📊 [HTML-SOURCE-COUNTS] Paragraphs: ${sourceCounts.paragraphs}, Headings: ${sourceCounts.headings}, Tables: ${sourceCounts.tables}, Images: ${sourceCounts.images}, Callouts: ${sourceCounts.callouts}, Code: ${sourceCounts.code}, OL: ${sourceCounts.orderedList}, UL: ${sourceCounts.unorderedList}`);
            } catch (countError) {
              log(`⚠️ [HTML-SOURCE-COUNTS] Error counting from HTML: ${countError.message}`);
              log(`⚠️ [HTML-SOURCE-COUNTS] Stack trace: ${countError.stack}`);
              // Fall back to zero counts - comparison will show all as mismatches
            }
            
            // Calculate Notion counts from actual page blocks
            // FIX v11.0.36: Fetch actual blocks from Notion to get accurate counts
            log(`📊 Fetching Notion blocks to calculate Stats...`);
            const notionCounts = {
              paragraphs: 0,
              headings: 0,
              tables: 0,
              images: 0,
              callouts: 0,
              code: 0,
              orderedList: 0,
              unorderedList: 0
            };
            
            try {
              const allNotionBlocks = [];
              let cursor = undefined;
              
              do {
                const blockResponse = await notion.blocks.children.list({
                  block_id: response.id,
                  page_size: 100,
                  ...(cursor ? { start_cursor: cursor } : {})
                });
                
                allNotionBlocks.push(...blockResponse.results);
                cursor = blockResponse.has_more ? blockResponse.next_cursor : undefined;
              } while (cursor);
              
              // FIX v11.0.38: Recursively count images and other blocks in nested structures
              // Previously only counted top-level blocks, missing images in tables/callouts
              // FIX v11.0.188: Exclude heading_1 blocks (page title) from heading count
              // Only count heading_2 and higher to match source count (which excludes H1)
              async function countNotionBlocksRecursive(blocks) {
                for (const block of blocks) {
                  if (block.type === 'paragraph') notionCounts.paragraphs++;
                  else if (block.type === 'heading_2' || block.type === 'heading_3') notionCounts.headings++;  // Exclude heading_1 (page title)
                  else if (block.type === 'table') notionCounts.tables++;
                  else if (block.type === 'image') notionCounts.images++;
                  else if (block.type === 'callout') notionCounts.callouts++;
                  else if (block.type === 'code') notionCounts.code++;
                  else if (block.type === 'numbered_list_item') notionCounts.orderedList++;
                  else if (block.type === 'bulleted_list_item') notionCounts.unorderedList++;
                  
                  // Recursively fetch and count children if block has them
                  if (block.has_children) {
                    try {
                      let childCursor = undefined;
                      do {
                        const childResponse = await notion.blocks.children.list({
                          block_id: block.id,
                          page_size: 100,
                          ...(childCursor ? { start_cursor: childCursor } : {})
                        });
                        await countNotionBlocksRecursive(childResponse.results);
                        childCursor = childResponse.has_more ? childResponse.next_cursor : undefined;
                      } while (childCursor);
                    } catch (childError) {
                      log(`⚠️ Failed to fetch children for block ${block.id}: ${childError.message}`);
                    }
                  }
                }
              }
              
              await countNotionBlocksRecursive(allNotionBlocks);
              log(`   ✓ Notion counts: ${allNotionBlocks.length} total blocks`);
              
            } catch (countError) {
              log(`⚠️ Failed to fetch Notion blocks for Stats: ${countError.message}`);
              // Leave notionCounts at 0
            }
            
            // Use calculated counts for comparison
            // FIX v11.0.186: Three-tier ContentComparison logic based on element types
            // ❌ FAIL if mismatch in: Headings, Code blocks, Tables, Images, Callouts (critical elements)
            // ⚠️ PASS if mismatch in: Ordered lists, Unordered lists, Paragraphs (flexible elements)
            // ✅ PASS if all elements match
            const hasHtmlContent = Object.values(sourceCounts).some(count => count > 0);
            
            // Critical elements - strict matching required
            const tablesMatch = (sourceCounts.tables === notionCounts.tables);
            const imagesMatch = (sourceCounts.images === notionCounts.images);
            const calloutsMatch = (sourceCounts.callouts === notionCounts.callouts);
            const headingsMatch = (sourceCounts.headings === notionCounts.headings);
            const codeMatch = (sourceCounts.code === notionCounts.code);
            
            // Flexible elements - may vary due to HTML structure differences
            const orderedListMatch = (sourceCounts.orderedList === notionCounts.orderedList);
            const unorderedListMatch = (sourceCounts.unorderedList === notionCounts.unorderedList);
            const paragraphsMatch = (sourceCounts.paragraphs === notionCounts.paragraphs);
            
            // Determine comparison status (v11.0.186)
            const criticalMismatch = !tablesMatch || !imagesMatch || !calloutsMatch || 
                                     !headingsMatch || !codeMatch;
            const flexibleMismatch = !orderedListMatch || !unorderedListMatch || !paragraphsMatch;
            
            let countsPass;
            let countsIcon;
            let comparisonStatus;
            
            if (criticalMismatch) {
              // FAIL - critical elements don't match
              countsPass = false;
              countsIcon = '❌';
              comparisonStatus = 'FAIL';
            } else if (flexibleMismatch) {
              // PASS with warning - flexible elements may differ, but critical ones match
              countsPass = true;
              countsIcon = '⚠️';
              comparisonStatus = 'PASS';
            } else {
              // PASS - all elements match
              countsPass = true;
              countsIcon = '✅';
              comparisonStatus = 'PASS';
            }
            
            const statsHeader = `${countsIcon}  Content Comparison: ${comparisonStatus}`; // two spaces after icon per spec
            const statsLines = [
              statsHeader,
              '📊 (Source → Notion):',
              `• Ordered list items: ${sourceCounts.orderedList} → ${notionCounts.orderedList}`,
              `• Unordered list items: ${sourceCounts.unorderedList} → ${notionCounts.unorderedList}`,
              `• Paragraphs: ${sourceCounts.paragraphs} → ${notionCounts.paragraphs}`,
              `• Headings: ${sourceCounts.headings} → ${notionCounts.headings}`,
              `• Code blocks: ${sourceCounts.code} → ${notionCounts.code}`,
              `• Tables: ${sourceCounts.tables} → ${notionCounts.tables}`,
              `• Images: ${sourceCounts.images} → ${notionCounts.images}`,
              `• Callouts: ${sourceCounts.callouts} → ${notionCounts.callouts}`,
            ];
            const statsContent = statsLines.join('\n');

            // Truncate to fit Notion's 2000 character limit for rich text properties
            let truncatedStatsContent = statsContent;
            if (statsContent.length > 2000) {
              truncatedStatsContent = statsContent.substring(0, 1997) + '...';
              log(`⚠️ [PROPERTY-TRUNCATE] ContentComparison property truncated to 2000 chars (was ${statsContent.length})`);
            }

            propertyUpdates["ContentComparison"] = {
              rich_text: [ { type: 'text', text: { content: truncatedStatsContent } } ]
            };
            log(`📊 Setting ContentComparison property with refined comparison breakdown`);
            log(`   ${countsIcon}  Content Comparison: ${comparisonStatus}`);
            log(`   Headings: ${sourceCounts.headings} → ${notionCounts.headings}`);
            
            // FIX v11.0.187: Mark pages with critical failures for auto-save
            // Trigger auto-save if ContentComparison = FAIL or Audit = FAIL
            const hasContentComparisonFail = countsPass === false;
            const hasAuditFail = auditResult && auditResult.passed === false;
            const shouldAutoSaveForFailure = hasContentComparisonFail || hasAuditFail;
            
            if (shouldAutoSaveForFailure) {
              log(`🚩 [v11.0.187] Critical failure detected:`);
              if (hasContentComparisonFail) log(`   • ContentComparison: ❌ FAIL (critical element mismatch)`);
              if (hasAuditFail) log(`   • Content Audit: ❌ FAIL`);
              log(`   → Page will be auto-saved to pages-to-update after creation`);
            }
            
            // Set Image checkbox if page contains images
            if (sourceCounts.images > 0) {
              propertyUpdates["Image"] = { checkbox: true };
              log(`🖼️ Setting Image checkbox (${sourceCounts.images} image${sourceCounts.images === 1 ? '' : 's'} detected)`);
            }
            
            // FIX v11.0.115: Check which property names exist in database (backward compatibility for Validation→Audit rename)
            let auditPropertyName = "Audit";
            let comparisonPropertyName = "ContentComparison";
            
            try {
              const dbInfo = await notion.databases.retrieve({ database_id: payload.databaseId });
              const dbProps = Object.keys(dbInfo.properties);
              
              // Check if old property names exist in database and new ones don't
              const hasOldAudit = dbProps.includes("Validation");
              const hasNewAudit = dbProps.includes("Audit");
              const hasContentComparison = dbProps.includes("ContentComparison");
              
              if (hasOldAudit && !hasNewAudit) {
                auditPropertyName = "Validation";
                log(`🔄 [POST] Using legacy property name: "Validation" (new name "Audit" not found in database)`);
              }
              
              // Rename property keys if using legacy names
              if (auditPropertyName === "Validation" && propertyUpdates["Audit"]) {
                propertyUpdates["Validation"] = propertyUpdates["Audit"];
                delete propertyUpdates["Audit"];
              }
              
              // FIX v11.0.172: If ContentComparison property doesn't exist, don't send it
              if (!hasContentComparison && propertyUpdates["ContentComparison"]) {
                log(`⚠️ [POST] ContentComparison property not found in database, skipping update`);
                delete propertyUpdates["ContentComparison"];
              }
              
              // FIX v11.0.172: If neither old nor new Audit property exists, don't send it
              if (!hasOldAudit && !hasNewAudit && propertyUpdates["Audit"]) {
                log(`⚠️ [POST] Audit property not found in database (neither "Validation" nor "Audit"), skipping Audit update`);
                delete propertyUpdates["Audit"];
              }
              
              log(`📝 [POST] Property names resolved: Audit="${auditPropertyName}", ContentComparison="${comparisonPropertyName}"`);
              
            } catch (propCheckError) {
              log(`⚠️ [POST] Could not check database properties (using new names): ${propCheckError.message}`);
              // Continue with new property names
            }
            
            // Update the page properties
            log(`📝 [POST-PROPERTY-UPDATE] Updating properties: ${Object.keys(propertyUpdates).join(', ')}`);
            await notion.pages.update({
              page_id: response.id,
              properties: propertyUpdates
            });
            
            propertyUpdateSuccess = true;
            log(`✅ [POST-PROPERTY-UPDATE] Validation properties updated successfully${propRetry > 0 ? ` (after ${propRetry} ${propRetry === 1 ? 'retry' : 'retries'})` : ''}`);
            log(`   Properties set: ${auditPropertyName} (${auditContent.length} chars), ${comparisonPropertyName}, Error, Image (if applicable)`);
            
            // FIX v11.0.187: Auto-save pages with ContentComparison FAIL or Audit FAIL
            if (shouldAutoSaveForFailure) {
              try {
                log(`💾 [v11.0.187] Auto-saving page with critical failure to pages-to-update...`);
                const fs = require('fs');
                const path = require('path');
                
                const pagesUpdateDir = path.join(__dirname, '../../patch/pages/pages-to-update');
                if (!fs.existsSync(pagesUpdateDir)) {
                  fs.mkdirSync(pagesUpdateDir, { recursive: true });
                }
                
                const timestamp = new Date().toISOString().replace(/:/g, '-').replace(/\..+/, '');
                const sanitizedTitle = (payload.title || 'untitled')
                  .toLowerCase()
                  .replace(/[^a-z0-9]+/g, '-')
                  .replace(/^-+|-+$/g, '')
                  .substring(0, 60);
                const filename = `${sanitizedTitle}-failure-${timestamp}.html`;
                const filepath = path.join(pagesUpdateDir, filename);
                
                const failureReasons = [];
                if (hasContentComparisonFail) {
                  failureReasons.push(`ContentComparison FAIL: ${sourceCounts.headings}→${notionCounts.headings} headings (${notionCounts.orderedList}→${sourceCounts.orderedList} lists, ${sourceCounts.paragraphs}→${notionCounts.paragraphs} paragraphs)`);
                }
                if (hasAuditFail) {
                  failureReasons.push(`Content Audit FAIL: Coverage ${auditResult.coverageStr}`);
                }
                
                const htmlContent = `<!--
Auto-saved: Critical validation failure (v11.0.187)
Page ID: ${response.id}
Page URL: ${response.url}
Page Title: ${payload.title}
Created: ${new Date().toISOString()}
Source URL: ${payload.url || 'N/A'}

Failure Reasons:
${failureReasons.map(r => '• ' + r).join('\n')}

Content Comparison Status: ${countsIcon}  ${comparisonStatus}
Headings: ${sourceCounts.headings} → ${notionCounts.headings}
Ordered lists: ${sourceCounts.orderedList} → ${notionCounts.orderedList}
Unordered lists: ${sourceCounts.unorderedList} → ${notionCounts.unorderedList}
Paragraphs: ${sourceCounts.paragraphs} → ${notionCounts.paragraphs}
Code blocks: ${sourceCounts.code} → ${notionCounts.code}
Tables: ${sourceCounts.tables} → ${notionCounts.tables}
Images: ${sourceCounts.images} → ${notionCounts.images}
Callouts: ${sourceCounts.callouts} → ${notionCounts.callouts}

${auditResult ? `Audit Coverage: ${auditResult.coverageStr}
Audit Threshold: ${auditResult.threshold || '95-105%'}
Audit Status: ${auditResult.passed ? '✅ PASS' : '❌ FAIL'}` : 'Audit: SKIPPED'}

Action Required: Review extraction and re-PATCH page with corrected content
-->

${payload.contentHtml || ''}
`;
                
                fs.writeFileSync(filepath, htmlContent, 'utf-8');
                log(`✅ [v11.0.187] Page auto-saved to pages-to-update for re-extraction`);
                log(`   Filename: ${filename}`);
                log(`   Location: patch/pages/pages-to-update/`);
                savedToUpdateFolder = true;
              } catch (saveError) {
                log(`❌ [v11.0.187] Failed to auto-save page with critical failure: ${saveError.message}`);
              }
            }
            
            // Auto-save pages with order issues for investigation
            if (Array.isArray(validationResult.orderIssues) && validationResult.orderIssues.length > 0) {
              try {
                log(`📋 Order issues detected (${validationResult.orderIssues.length}) - auto-saving for investigation...`);
                const fs = require('fs');
                const path = require('path');
                
                const orderIssuesDir = path.join(__dirname, '../../patch/pages/validation-order-issues');
                if (!fs.existsSync(orderIssuesDir)) {
                  fs.mkdirSync(orderIssuesDir, { recursive: true });
                }
                
                const timestamp = new Date().toISOString().replace(/:/g, '-').replace(/\..+/, '');
                const sanitizedTitle = (payload.title || 'untitled')
                  .toLowerCase()
                  .replace(/[^a-z0-9]+/g, '-')
                  .replace(/^-+|-+$/g, '')
                  .substring(0, 60);
                const filename = `${sanitizedTitle}-order-issues-${timestamp}.html`;
                const filepath = path.join(orderIssuesDir, filename);
                
                const htmlContent = `<!--
Auto-saved: Order issues detected in content validation
Page ID: ${response.id}
Page URL: ${response.url}
Page Title: ${payload.title}
Created: ${new Date().toISOString()}
Source URL: ${payload.url || 'N/A'}

Order Issues Detected: ${validationResult.orderIssues.length}
Similarity: ${validationResult.similarity}%

Order Issues:
${JSON.stringify(validationResult.orderIssues, null, 2)}

Missing Segments: ${validationResult.missing?.length || 0}
${validationResult.missing?.length > 0 ? '\nMissing:\n' + JSON.stringify(validationResult.missing.slice(0, 5), null, 2) : ''}

Full Validation Result:
${JSON.stringify(validationResult, null, 2)}

Action Required: Investigate why content order differs between HTML source and Notion output
-->

${payload.contentHtml || ''}
`;
                
                fs.writeFileSync(filepath, htmlContent, 'utf-8');
                log(`✅ AUTO-SAVED: ${filename}`);
                log(`   Location: ${filepath}`);
                log(`   Order issues: ${validationResult.orderIssues.length}`);
              } catch (saveError) {
                log(`❌ Failed to auto-save page with order issues: ${saveError.message}`);
              }
            }
            
            // FIX v11.0.28: Verify properties were actually set by retrieving the page
            // This catches cases where empty strings are sent but Notion stores empty arrays
            try {
              log(`🔍 Verifying properties were actually set in Notion...`);
              await new Promise(resolve => setTimeout(resolve, 500)); // Brief wait for Notion consistency
              
              const updatedPage = await notion.pages.retrieve({ page_id: response.id });
              const auditProp = updatedPage.properties.Audit;
              const contentComparisonProp = updatedPage.properties.ContentComparison;
              
              // Check if Audit property is actually empty in Notion
              const isAuditEmpty = !auditProp || 
                                   !auditProp.rich_text || 
                                   auditProp.rich_text.length === 0 ||
                                   (auditProp.rich_text.length === 1 && !auditProp.rich_text[0].text.content);
              
              const isContentComparisonEmpty = !contentComparisonProp || 
                                               !contentComparisonProp.rich_text || 
                                               contentComparisonProp.rich_text.length === 0;
              
              if (isAuditEmpty) {
                log(`⚠️ WARNING: Audit property is EMPTY in Notion after update!`);
                log(`   Property value: ${JSON.stringify(auditProp)}`);
                log(`   This indicates validationResult.summary was blank/empty`);
                log(`   Auto-saving page for investigation...`);
                
                // Treat as blank validation and auto-save
                try {
                  const fs = require('fs');
                  const path = require('path');
                  
                  const fixturesDir = path.join(__dirname, '../../patch/pages/pages-to-update');
                  if (!fs.existsSync(fixturesDir)) {
                    fs.mkdirSync(fixturesDir, { recursive: true });
                  }
                  
                  const timestamp = new Date().toISOString().replace(/:/g, '-').replace(/\..+/, '');
                  const sanitizedTitle = (payload.title || 'untitled')
                    .toLowerCase()
                    .replace(/[^a-z0-9]+/g, '-')
                    .replace(/^-+|-+$/g, '')
                    .substring(0, 60);
                  const filename = `${sanitizedTitle}-empty-validation-verified-${timestamp}.html`;
                  const filepath = path.join(fixturesDir, filename);
                  
                  const htmlContent = `<!--
Auto-saved: Audit property is EMPTY in Notion after property update (verified by retrieval)
Page ID: ${response.id}
Page URL: ${response.url}
Page Title: ${payload.title}
Created: ${new Date().toISOString()}
Source URL: ${payload.url || 'N/A'}

Validation Result Object:
${JSON.stringify(validationResult, null, 2)}

Retrieved Audit Property:
${JSON.stringify(auditProp, null, 2)}

Issue: Notion property has empty rich_text array []
Root Cause: Audit content was blank/empty when sent to Notion
Expected: Audit should contain coverage data or status message
-->

${payload.contentHtml || ''}
`;
                  
                  fs.writeFileSync(filepath, htmlContent, 'utf-8');
                  log(`✅ AUTO-SAVED: Page with empty audit saved to ${filename}`);
                  savedToUpdateFolder = true;
                } catch (saveError) {
                  log(`❌ Failed to auto-save page with empty audit: ${saveError.message}`);
                }
              } else {
                log(`✅ Audit property verified - content exists in Notion`);
              }
            } catch (verifyError) {
              log(`⚠️ Failed to verify properties (non-fatal): ${verifyError.message}`);
            }
            
            // LEGACY CHECK: Also check at assignment time for empty summary
            // (This catches it before sending, but above check catches after Notion stores it)
            if (!validationResult.summary || validationResult.summary.trim() === '') {
              log(`⚠️ WARNING: Validation summary is blank/empty at assignment time!`);
              log(`   Page ID: ${response.id}`);
              log(`   Page Title: ${payload.title}`);
              log(`   This page will be auto-saved to pages-to-update for investigation`);
              
              try {
                const fs = require('fs');
                const path = require('path');
                
                const fixturesDir = path.join(__dirname, '../../patch/pages/pages-to-update');
                if (!fs.existsSync(fixturesDir)) {
                  fs.mkdirSync(fixturesDir, { recursive: true });
                }
                
                const timestamp = new Date().toISOString().replace(/:/g, '-').replace(/\..+/, '');
                const sanitizedTitle = (payload.title || 'untitled')
                  .toLowerCase()
                  .replace(/[^a-z0-9]+/g, '-')
                  .replace(/^-+|-+$/g, '')
                  .substring(0, 60);
                const filename = `${sanitizedTitle}-blank-validation-${timestamp}.html`;
                const filepath = path.join(fixturesDir, filename);
                
                const htmlContent = `<!--
Auto-saved: Validation property is blank/empty after successful property update
Page ID: ${response.id}
Page URL: ${response.url}
Page Title: ${payload.title}
Created: ${new Date().toISOString()}
Source URL: ${payload.url || 'N/A'}

Validation Result Object:
${JSON.stringify(validationResult, null, 2)}

Issue: validationResult.summary is empty or blank
Expected: Summary should contain validation results or status message
-->

${payload.contentHtml || ''}
`;
                
                fs.writeFileSync(filepath, htmlContent, 'utf-8');
                log(`✅ AUTO-SAVED: Page with blank validation saved to ${filename}`);
                savedToUpdateFolder = true;
              } catch (saveError) {
                log(`❌ Failed to auto-save page with blank validation: ${saveError.message}`);
              }
            }
          } catch (propError) {
            const isLastRetry = propRetry >= maxPropertyRetries;
            // FIX v11.0.7: Extended backoff to handle transient Notion API issues (max 32s)
            const waitTime = Math.min(Math.pow(2, propRetry), 32) * 1000; // 1s, 2s, 4s, 8s, 16s, 32s
            
            if (isLastRetry) {
              log(`\n${'='.repeat(80)}`);
              log(`❌ CRITICAL: Failed to update validation properties after ${maxPropertyRetries + 1} attempts`);
              log(`   Error: ${propError.message}`);
              log(`   Page ID: ${response.id}`);
              log(`   Page URL: ${response.url}`);
              log(`${'='.repeat(80)}\n`);
              
              // FIX v11.0.24: Auto-save page to failed-validation when validation properties fail
              // This ensures the page gets flagged for revalidation even if properties can't be set
              // REMOVED: Fallback 1 (Error checkbox only) and Fallback 2 (callout block)
              // Reason: With auto-save tracking, partial validation is misleading
              try {
                const fs = require('fs');
                const path = require('path');
                
                // Create failed-validation directory if it doesn't exist
                const pagesDir = path.join(__dirname, '..', '..', 'patch', 'pages', 'failed-validation');
                if (!fs.existsSync(pagesDir)) {
                  fs.mkdirSync(pagesDir, { recursive: true });
                }
                
                // Create filename with page title and timestamp
                const sanitizedTitle = payload.title.toLowerCase()
                  .replace(/[^a-z0-9]+/g, '-')
                  .replace(/^-+|-+$/g, '')
                  .substring(0, 80);
                const timestamp = new Date().toISOString().replace(/[:.]/g, '-').substring(0, 19);
                const filename = `${sanitizedTitle}-${timestamp}.html`;
                const filepath = path.join(pagesDir, filename);
                
                // Build HTML file with metadata
                const htmlContent = `<!--
Auto-saved: Validation properties failed to update after ${maxPropertyRetries + 1} retries
Page ID: ${response.id}
Page URL: ${response.url}
Page Title: ${payload.title}
Created: ${new Date().toISOString()}
Source URL: ${payload.url || 'N/A'}

Validation Result:
${JSON.stringify(validationResult, null, 2)}

Error Details:
- Primary Error: ${propError.message}
-->

${payload.contentHtml || ''}
`;
                
                fs.writeFileSync(filepath, htmlContent, 'utf-8');
                log(`✅ AUTO-SAVED: Page saved to ${filename}`);
                log(`   Location: ${filepath}`);
                log(`   This page will be added to failed-validation folder for revalidation`);
                
                // Also log to persistent failure tracking file
                const failureLog = path.join(__dirname, '..', '..', 'patch', 'logs', 'validation-property-failures.log');
                const logEntry = `${new Date().toISOString()} | ${response.id} | "${payload.title}" | ${response.url} | ${filename}\n`;
                fs.appendFileSync(failureLog, logEntry, 'utf-8');
                log(`📝 Logged to validation-property-failures.log`);
                savedToUpdateFolder = true; // FIX v11.0.24: Mark as saved
                
              } catch (saveError) {
                log(`❌ FAILED TO AUTO-SAVE PAGE: ${saveError.message}`);
                log(`   Manual intervention required to track this page!`);
              }
              
              // Don't throw - page was created successfully, just property update failed
            } else {
              log(`⚠️ Property update failed (attempt ${propRetry + 1}/${maxPropertyRetries + 1}): ${propError.message}`);
              log(`   Retrying in ${waitTime / 1000}s...`);
              await new Promise(resolve => setTimeout(resolve, waitTime));
            }
          }
        }
        
        // Log validation errors and warnings (moved outside property update)
        if (validationResult.hasErrors) {
          log(`❌ Validation found ${validationResult.issues.length} error(s):`);
          validationResult.issues.forEach((issue, idx) => {
            log(`   ${idx + 1}. ${issue}`);
          });
          
          // AUTO-CAPTURE: Save HTML to fixtures folder when validation fails
          const shouldSaveFixtures = process.env.SN2N_SAVE_VALIDATION_FAILURES !== 'false' && process.env.SN2N_SAVE_VALIDATION_FAILURES !== '0';
          if (shouldSaveFixtures && payload.contentHtml) {
            try {
              const fixturesDir = process.env.SN2N_FIXTURES_DIR || path.join(__dirname, '../../patch/pages/pages-to-update');
              
              // Ensure directory exists
              if (!fs.existsSync(fixturesDir)) {
                fs.mkdirSync(fixturesDir, { recursive: true });
              }
              
              // Create sanitized filename from page title
              const timestamp = new Date().toISOString().replace(/:/g, '-').replace(/\..+/, '');
              const sanitizedTitle = (payload.title || 'untitled')
                .toLowerCase()
                .replace(/[^a-z0-9]+/g, '-')
                .replace(/^-+|-+$/g, '')
                .substring(0, 60);
              const filename = `${sanitizedTitle}-${timestamp}.html`;
              const filepath = path.join(fixturesDir, filename);
              
              // Create metadata comment
              const metadata = [
                '<!--',
                `  Page: ${payload.title || 'Untitled'}`,
                `  URL: ${payload.url || 'N/A'}`,
                `  Captured: ${new Date().toISOString()}`,
                `  Validation Errors: ${validationResult.issues.join('; ')}`,
                validationResult.warnings.length > 0 ? `  Warnings: ${validationResult.warnings.join('; ')}` : null,
                `  Page ID: ${response.id}`,
                `  Block Count (expected): ${children.length}`,
                `  Block Count (actual): ${validationResult.stats?.totalBlocks || 'unknown'}`,
                '-->'
              ].filter(Boolean).join('\n');
              
              // Write HTML with metadata
              const htmlWithMetadata = `${metadata}\n${payload.contentHtml}`;
              fs.writeFileSync(filepath, htmlWithMetadata, 'utf8');
              
              log(`💾 Auto-saved validation failure HTML to: ${filename}`);
            } catch (saveError) {
              log(`⚠️ Failed to save validation failure HTML: ${saveError.message}`);
            }
          }
        }
        
        if (validationResult.warnings.length > 0) {
          log(`⚠️ Validation found ${validationResult.warnings.length} warning(s):`);
          validationResult.warnings.forEach((warning, idx) => {
            log(`   ${idx + 1}. ${warning}`);
          });
        }
      }
    }
    // Note: Removed redundant "validation skipped" log - now handled earlier

    log("🔗 Page URL:", response.url);
    
    // Note: Response was already sent immediately after page creation (before validation)
    // to prevent client timeout. Validation results are logged but not sent to client.
    if (validationResult) {
      log(`📊 Validation summary: ${validationResult.success ? 'PASSED' : 'FAILED'}`);
      log(`   Errors: ${validationResult.issues.length}, Warnings: ${validationResult.warnings.length}`);
    }
    
    // FIX v11.0.19: Check if page was auto-saved due to property update failure
    if (typeof savedToUpdateFolder !== 'undefined' && savedToUpdateFolder) {
      log(`\n${'='.repeat(80)}`);
      log(`⚠️⚠️⚠️ ACTION REQUIRED: Page auto-saved to pages-to-update folder`);
      log(`   Page ID: ${response.id}`);
      log(`   Title: ${payload.title}`);
      log(`   Reason: Validation properties failed to update after all retries`);
      log(`   Location: patch/pages/pages-to-update/`);
      log(`   Next Steps: Page will be re-PATCHed by batch workflow`);
      log(`${'='.repeat(80)}\n`);
    }
    
    // FIX v11.0.31: FINAL CATCH-ALL - Verify Validation property was actually set
    // This catches pages created without validation enabled, API errors, or any other edge case
    if (!savedToUpdateFolder) { // Only check if not already saved
      try {
        log(`🔍 [FINAL-CHECK] Verifying Audit property was set...`);
        await new Promise(resolve => setTimeout(resolve, 1000)); // Wait for Notion consistency
        
        const finalPageCheck = await notion.pages.retrieve({ page_id: response.id });
        const finalAuditProp = finalPageCheck.properties.Audit;
        
        const isFinallyBlank = !finalAuditProp || 
                               !finalAuditProp.rich_text || 
                               finalAuditProp.rich_text.length === 0 ||
                               (finalAuditProp.rich_text.length === 1 && 
                                (!finalAuditProp.rich_text[0].text || 
                                 !finalAuditProp.rich_text[0].text.content ||
                                 finalAuditProp.rich_text[0].text.content.trim() === ''));
        
        if (isFinallyBlank) {
          log(`❌ [FINAL-CHECK] CRITICAL: Audit property is BLANK after all processing!`);
          log(`   This indicates a failure in the validation/property update flow`);
          log(`   Auto-saving page for re-extraction...`);
          
          try {
            const fixturesDir = path.join(__dirname, '../../patch/pages/pages-to-update');
            if (!fs.existsSync(fixturesDir)) {
              fs.mkdirSync(fixturesDir, { recursive: true });
            }
            
            const timestamp = new Date().toISOString().replace(/:/g, '-').replace(/\..+/, '');
            const sanitizedTitle = (payload.title || 'untitled')
              .toLowerCase()
              .replace(/[^a-z0-9]+/g, '-')
              .replace(/^-+|-+$/g, '')
              .substring(0, 60);
            const filename = `${sanitizedTitle}-blank-validation-final-${timestamp}.html`;
            const filepath = path.join(fixturesDir, filename);
            
            const htmlContent = `<!--
[FINAL-CHECK] Auto-saved: Audit property is BLANK after complete page creation flow
Page ID: ${response.id}
Page URL: ${response.url}
Page Title: ${payload.title}
Created: ${new Date().toISOString()}
Source URL: ${payload.url || 'N/A'}

Diagnosis: Audit property never got set or was cleared
Possible Causes:
  1. Page created without SN2N_AUDIT_CONTENT=1 enabled
  2. Audit result was null/undefined
  3. Property update silently failed without throwing error
  4. Notion API consistency issue

Retrieved Audit Property:
${JSON.stringify(finalAuditProp, null, 2)}

Action Required: Re-extract this page with validation enabled
-->

${payload.contentHtml || ''}
`;
            
            fs.writeFileSync(filepath, htmlContent, 'utf-8');
            log(`✅ [FINAL-CHECK] AUTO-SAVED: Page with blank audit saved to ${filename}`);
            savedToUpdateFolder = true; // Mark as saved
            
            log(`\n${'='.repeat(80)}`);
            log(`⚠️⚠️⚠️ [FINAL-CHECK] ACTION REQUIRED: Page auto-saved to pages-to-update folder`);
            log(`   Page ID: ${response.id}`);
            log(`   Title: ${payload.title}`);
            log(`   Reason: Audit property is BLANK after all processing`);
            log(`   Location: patch/pages/pages-to-update/`);
            log(`   Next Steps: Re-extract page with validation enabled`);
            log(`${'='.repeat(80)}\n`);
          } catch (saveError) {
            log(`❌ [FINAL-CHECK] Failed to auto-save page with blank audit: ${saveError.message}`);
          }
        } else {
          log(`✅ [FINAL-CHECK] Audit property confirmed present in Notion`);
        }
      } catch (finalCheckError) {
        log(`⚠️ [FINAL-CHECK] Failed to verify audit property (non-fatal): ${finalCheckError.message}`);
      }
    }
    
    // Run content validation if enabled (independent from block validation)
    const shouldValidateContent = process.env.SN2N_CONTENT_VALIDATION === '1' || process.env.SN2N_CONTENT_VALIDATION === 'true';
    
    if (shouldValidateContent) {
      log(`\n========================================`);
      log(`📋 STARTING CONTENT VALIDATION for page ${response.id}`);
      log(`   Title: "${payload.title}"`);
      log(`   Note: Validation paragraphs already cleaned up in pre-validation step`);
      log(`========================================\n`);
      
      try {
        // FIX v11.0.113: Replace LCS content validation with AUDIT-based validation
        // AUDIT provides clearer metrics: absolute text coverage instead of fuzzy similarity
        
        log(`🔍 Using AUDIT results for content validation...`);
        
        // Brief wait for any final Notion propagation
        await new Promise(resolve => setTimeout(resolve, 1000));
        
        // Use AUDIT results from extraction (if available)
        const auditResult = extractionResult?.audit;
        
        if (!auditResult) {
          log(`⚠️ AUDIT results not available - skipping validation`);
        } else {
          log(`✅ AUDIT validation completed`);
          log(`   Coverage: ${auditResult.coverageStr}`);
          log(`   Result: ${auditResult.passed ? 'PASS' : 'FAIL'}`);
        }
        
        // Build AUDIT validation summary
        const timestamp = new Date().toISOString().split('T')[0];
        let contentSummary = '';
        
        if (auditResult) {
          contentSummary = `\n\n[${timestamp}] Content Audit: ${auditResult.passed ? '✅ PASS' : '❌ FAIL'}`;
          contentSummary += `\nCoverage: ${auditResult.coverageStr} (threshold: ${auditResult.threshold || '95-105%'})`;
          contentSummary += `\nSource: ${auditResult.nodeCount || 'N/A'} text nodes, ${auditResult.totalLength || 'N/A'} chars`;
          contentSummary += `\nNotion: ${auditResult.notionBlocks} blocks, ${auditResult.notionTextLength} chars`;
          contentSummary += `\nBlock/Node Ratio: ${auditResult.blockNodeRatio}x`;
          
          if (auditResult.missing > 0) {
            contentSummary += `\n⚠️ Missing: ${auditResult.missing} chars (${auditResult.missingPercent}%)`;
          }
          
          // FIX v11.0.86+: Show content extraction success + formatting overhead breakdown
          if (auditResult.extra > 0) {
            const contentExtracted = 100 - auditResult.missingPercent;
            const formattingOverhead = auditResult.extraPercent;
            contentSummary += `\n✅ Content Extraction: ${contentExtracted.toFixed(1)}% of source (all content preserved)`;
            contentSummary += `\n   Formatting Overhead: +${formattingOverhead}% (tables, callouts, lists add metadata)`;
          } else if (auditResult.missing === 0) {
            contentSummary += `\n✅ Content Extraction: 100% of source (exact match)`;
          }

          // Add segment counts to content summary (detailed comparison now goes to separate properties)
          if (auditResult.detailedComparison) {
            const dc = auditResult.detailedComparison;
            contentSummary += `\nHTML segments: ${dc.htmlSegmentCount}, Notion segments: ${dc.notionSegmentCount}`;
          }
        } else {
          contentSummary = `\n\n[${timestamp}] Content Audit: ⚠️ SKIPPED (AUDIT not enabled)`;
        }
        
        // Create contentResult object for compatibility with existing code
        const contentResult = {
          success: auditResult ? auditResult.passed : true,
          coverage: auditResult ? auditResult.coverage : null,
          audit: auditResult
        };
        
        // FIX v11.0.113: Auto-remediate on AUDIT failure
        if (!contentResult.success && auditResult) {
          log(`\n🔧 ========== TRIGGERING AUTO-REMEDIATION ==========`);
          try {
            const diagnosis = diagnoseAndFixAudit({
              html: extractionResult?.fixedHtml || payload.contentHtml || payload.content,
              blocks: plainTextChildren || children,
              audit: auditResult,
              pageTitle: payload.title || 'Unknown',
              log
            });
            
            // Save diagnosis for review
            const diagnosisFile = saveDiagnosisToFile(diagnosis, response.id);
            if (diagnosisFile) {
              log(`💾 Diagnosis saved: ${diagnosisFile}`);
            }
          } catch (remErr) {
            log(`⚠️ Auto-remediation error: ${remErr.message}`);
          }
          log(`🔧 =========================================\n`);
        }
        
        // FIX v11.0.113: SKIP appending content validation - already set in initial property update
        // The initial property update (line ~2123) already sets Validation with AUDIT data
        // Appending here would cause duplication of AUDIT content
        log(`✅ Content validation result already set in Validation property (skipping duplicate append)`);
        
        try {
          const maxRetries = 3;
          let updateSuccess = false;
          
          for (let retry = 0; retry <= maxRetries && !updateSuccess; retry++) {
            try {
              // SKIP the duplicate append - Validation property already set with AUDIT data
              // Just update Error checkbox if needed
              if (!contentResult.success) {
                await notion.pages.update({
                  page_id: response.id,
                  properties: {
                    Error: { checkbox: true }
                  }
                });
              }
              
              updateSuccess = true;
              log(`✅ Content validation result already in Validation property${retry > 0 ? ` (verified after ${retry} ${retry === 1 ? 'retry' : 'retries'})` : ''}`);
              
              // If content validation failed, auto-save page
              if (!contentResult.success && !savedToUpdateFolder) {
                log(`⚠️ Content validation failed - auto-saving page for re-extraction...`);
                
                try {
                  const fixturesDir = path.join(__dirname, '../../patch/pages/pages-to-update');
                  if (!fs.existsSync(fixturesDir)) {
                    fs.mkdirSync(fixturesDir, { recursive: true });
                  }
                  
                  const timestamp = new Date().toISOString().replace(/:/g, '-').replace(/\..+/, '');
                  const sanitizedTitle = (payload.title || 'untitled')
                    .toLowerCase()
                    .replace(/[^a-z0-9]+/g, '-')
                    .replace(/^-+|-+$/g, '')
                    .substring(0, 60);
                  const filename = `${sanitizedTitle}-content-validation-failed-${timestamp}.html`;
                  const filepath = path.join(fixturesDir, filename);
                  
                  const htmlContent = `<!--
Auto-saved: Content validation failed (similarity ${contentResult.similarity}% < 95%)
Page ID: ${response.id}
Page URL: ${response.url}
Page Title: ${payload.title}
Created: ${new Date().toISOString()}
Source URL: ${payload.url || 'N/A'}

Content Validation Result:
${JSON.stringify(contentResult, null, 2)}
-->

${payload.contentHtml || ''}
`;
                  
                  fs.writeFileSync(filepath, htmlContent, 'utf-8');
                  log(`✅ AUTO-SAVED: Page with failed content validation saved to ${filename}`);
                  savedToUpdateFolder = true;
                } catch (saveError) {
                  log(`❌ Failed to auto-save page with failed content validation: ${saveError.message}`);
                }
              }
              
            } catch (appendError) {
              const isLastRetry = retry >= maxRetries;
              const waitTime = Math.pow(2, retry) * 1000; // 1s, 2s, 4s
              
              if (isLastRetry) {
                log(`❌ Failed to append content validation after ${maxRetries + 1} attempts: ${appendError.message}`);
              } else {
                log(`⚠️ Failed to append content validation (attempt ${retry + 1}/${maxRetries + 1}): ${appendError.message}`);
                log(`   Retrying in ${waitTime}ms...`);
                await new Promise(resolve => setTimeout(resolve, waitTime));
              }
            }
          }
        } catch (updateError) {
          log(`❌ Error updating page with content validation: ${updateError.message}`);
          // Non-fatal - continue processing
        }
        
      } catch (contentValidationError) {
        log(`⚠️ Content validation failed with error: ${contentValidationError.message}`);
        log(`⚠️ Stack trace: ${contentValidationError.stack}`);
        // Non-fatal - continue processing
      }
      
    } else {
      log(`ℹ️ Content validation skipped (set SN2N_CONTENT_VALIDATION=1 to enable)`);
    }
    
    // Mark validation as complete
    const statusData = validationStatus.get(response.id);
    if (statusData) {
      statusData.status = 'complete';
      statusData.endTime = new Date().toISOString();
      statusData.result = {
        blockValidation: validationResult,
        hasErrors: validationResult?.hasErrors || false
      };
      log(`✅ Validation complete - status updated for polling endpoint`);
    }
    
    // Final summary
    log(`📋 Final page structure summary:`);
    log(`   - Initial blocks sent: ${children.length}`);
    log(`   - Markers orchestrated: ${Object.keys(markerMap || {}).length}`);
    log(`   - Orchestrated blocks: ${Object.values(markerMap || {}).reduce((sum, arr) => sum + arr.length, 0)}`);
    log(`🔗 Page URL: https://www.notion.so/${response.id.replace(/-/g, '')}`);
    log("✅ Post-processing complete");
    return;
  } catch (error) {
    const { log, sendError } = getGlobals();
    log("❌ Error creating Notion page:", error.message);
    log("❌ Stack trace:", error.stack);
    if (error && error.body) {
      try {
        const parsed =
          typeof error.body === "string" ? JSON.parse(error.body) : error.body;
        log("❌ Notion error body:", JSON.stringify(parsed, null, 2));
      } catch (parseErr) {
        log("❌ Failed to parse Notion error body:", parseErr.message);
        log("❌ Raw error body:", error.body);
      }
    }
    // Only send error if response hasn't been sent yet
    // (Response is sent immediately after page creation, before validation)
    if (!res.headersSent) {
      return sendError(res, "PAGE_CREATION_FAILED", error.message, null, 500);
    } else {
      log("⚠️ Error occurred after response was sent to client - logging only");
      log("⚠️ Page was created successfully, but post-processing failed");
    }
  }
});

/**
 * GET endpoint to check validation status for a page
 * 
 * Returns:
 * - status: 'pending'|'running'|'complete'|'error'|'not_found'
 * - startTime: When validation started (ISO string)
 * - endTime: When validation completed (ISO string, if complete)
 * - duration: Validation duration in ms (if complete)
 * - result: Validation result object (if complete)
 */
router.get('/W2N/:pageId/validation', async (req, res) => {
  const { pageId } = req.params;
  const { log } = getGlobals();
  
  // Normalize pageId (remove hyphens for comparison)
  const normalizedPageId = pageId.replace(/-/g, '');
  
  // Check both with and without hyphens
  let statusData = validationStatus.get(pageId) || validationStatus.get(normalizedPageId);
  
  if (!statusData) {
    return res.json({
      status: 'not_found',
      message: 'No validation status found for this page. Page may not have been created recently, or validation tracking was not enabled.'
    });
  }
  
  const response = {
    status: statusData.status,
    startTime: statusData.startTime,
    ...(statusData.endTime && { endTime: statusData.endTime }),
    ...(statusData.endTime && statusData.startTime && { 
      duration: new Date(statusData.endTime).getTime() - new Date(statusData.startTime).getTime() 
    }),
    ...(statusData.result && { result: statusData.result })
  };
  
  log(`📊 Validation status check for ${pageId}: ${statusData.status}`);
  res.json(response);
});

/**
 * PATCH endpoint to update an existing Notion page with fresh content.
 * Strategy: Delete all existing blocks, then upload fresh extracted content.
 * This is simpler and safer than surgical patching (no complex diffing, correct ordering).
 * 
 * Request body:
 * - pageId (in URL): The Notion page ID to update
 * - title: Page title (optional, for logging)
 * - contentHtml or content: The ServiceNow HTML to extract and upload
 * - properties: Page properties to update (optional)
 * - dryRun: If true, return extracted blocks without updating page
 * 
 * Response:
 * - success: true/false
 * - pageId: The updated page ID
 * - blocksDeleted: Number of blocks deleted
 * - blocksAdded: Number of blocks added
 * - validation: Validation results (if enabled)
 */
router.patch('/W2N/:pageId', async (req, res) => {
  const { notion, log, sendSuccess, sendError, htmlToNotionBlocks, ensureFileUploadAvailable, 
          collectAndStripMarkers, removeCollectedBlocks, deepStripPrivateKeys, 
          orchestrateDeepNesting, getExtraDebug, normalizeAnnotations, normalizeUrl, 
          isValidImageUrl, cleanInvalidBlocks } = getGlobals();

  const { pageId } = req.params;
  log(`🔧 PATCH W2N: Updating page ${pageId}`);

  // Clear trackers for new request
  if (global._sn2n_paragraph_tracker) {
    console.log(`🔄 [DUPLICATE-DETECT] Clearing paragraph tracker (had ${global._sn2n_paragraph_tracker.length} entries)`);
  }
  global._sn2n_paragraph_tracker = [];

  if (global._sn2n_callout_tracker) {
    console.log(`🔄 [CALLOUT-DUPLICATE] Clearing callout tracker (had ${global._sn2n_callout_tracker.size} entries)`);
  }
  global._sn2n_callout_tracker = new Set();

  // FIX v11.0.5: Move cleanup to function scope so catch block can access it
  // Previous bug: cleanup() was defined inside try block, causing ReferenceError in catch
  let patchStartTime = Date.now();
  let operationPhase = 'initializing';
  let heartbeatInterval = null;
  let pageTitle = 'Unknown'; // Initialize for error handling
  let shouldAutoSaveForFailure = false; // Initialize to prevent ReferenceError when validation is skipped
  
  const cleanup = () => {
    if (heartbeatInterval) {
      clearInterval(heartbeatInterval);
      heartbeatInterval = null;
    }
  };
  
  // Start heartbeat after cleanup is defined
  heartbeatInterval = setInterval(() => {
    const elapsed = Math.floor((Date.now() - patchStartTime) / 1000);
    log(`💓 [${elapsed}s] PATCH in progress - ${operationPhase}...`);
  }, 10000);

  try {
    const payload = req.body;
    pageTitle = payload.title || 'Untitled';
    log(`📝 Processing PATCH request for: ${pageTitle}`);
    
    // Heartbeat already started above; patchStartTime/operationPhase initialized
    
    // Validate page ID format (accept both with and without hyphens)
    const normalizedPageId = pageId.replace(/-/g, '');
    if (!normalizedPageId || normalizedPageId.length !== 32) {
      cleanup();
      return sendError(res, "INVALID_PAGE_ID", "Page ID must be a valid 32-character UUID (with or without hyphens)", null, 400);
    }
    
    // Extract fresh content from HTML
    const html = payload.contentHtml || payload.content;
    if (!html) {
      cleanup();
      return sendError(res, "MISSING_CONTENT", "contentHtml or content required", null, 400);
    }
    
    // Validate that html is a string
    if (typeof html !== 'string') {
      const actualType = html === null ? 'null' : Array.isArray(html) ? 'array' : typeof html;
      log(`❌ Invalid content type: expected string, got ${actualType}`);
      cleanup();
      return sendError(res, "INVALID_CONTENT_TYPE", `Content must be a string, received ${actualType}`, null, 400);
    }
    
    log(`📄 HTML content length: ${html.length} characters`);
    
    // Extract blocks from HTML (same as POST endpoint)
    operationPhase = 'extracting blocks from HTML';
    const extractionResult = await htmlToNotionBlocks(html);
    
    if (!extractionResult || !extractionResult.blocks) {
      return sendError(res, "EXTRACTION_FAILED", "Failed to extract content from HTML", null, 500);
    }
    
    let { blocks: extractedBlocks, hasVideos } = extractionResult;
    log(`✅ Extracted ${extractedBlocks.length} blocks from HTML`);
    
    // [CALLOUT-TRACE] Track callouts through PATCH pipeline
    const calloutsAfterExtraction = extractedBlocks.filter(b => b.type === 'callout').length;
    console.log(`🔍 [CALLOUT-TRACE] Step 1 - After extraction: ${calloutsAfterExtraction} callouts`);
    log(`🔍 [CALLOUT-TRACE] Step 1 - After extraction: ${calloutsAfterExtraction} callouts`);
    
    if (hasVideos) {
      log("⚠️ Warning: Videos detected but not supported by Notion API");
    }
    
    // If dryRun, return extracted blocks without updating
    if (payload.dryRun) {
      log("🧪 Dry run mode - returning extracted blocks without updating page");
      log(`🧪 DEBUG: extractedBlocks.length = ${extractedBlocks.length}`);
      log(`🧪 DEBUG: extractedBlocks is array? ${Array.isArray(extractedBlocks)}`);
      
      // Count block types for reporting
      const blockTypes = {};
      extractedBlocks.forEach(block => {
        blockTypes[block.type] = (blockTypes[block.type] || 0) + 1;
      });
      
      const responsePayload = {
        dryRun: true,
        pageId,
        blocksExtracted: extractedBlocks.length,
        blockTypes,
        children: extractedBlocks,
        hasVideos,
        audit: extractionResult.audit || null  // FIX v11.0.113: Include AUDIT data in dry-run response
      };
      
      log(`🧪 DEBUG: responsePayload.children.length = ${responsePayload.children.length}`);
      log(`🧪 DEBUG: Calling sendSuccess with payload`);
      
      cleanup();
      return sendSuccess(res, responsePayload);
    }
    
    // Strip private keys before deduplication
    deepStripPrivateKeys(extractedBlocks);
    
    // FIX v11.0.6: Apply same complexity-based delay to PATCH as POST
    // Prevents rate limiting during block deletion and re-upload
    const calculateComplexityForPatch = (blocks) => {
      let score = 0;
      const totalBlocks = blocks.length;
      const listItems = blocks.filter(b => b.type.includes('list_item')).length;
      const tables = blocks.filter(b => b.type === 'table').length;
      const callouts = blocks.filter(b => b.type === 'callout').length;
      
      score += totalBlocks / 10;
      score += tables * 5;
      score += callouts * 2;
      
      if (listItems > 200) {
        score += (listItems - 200) * 2;
        log(`   ⚠️ CRITICAL: List-heavy PATCH detected (${listItems} list items)`);
      } else if (listItems > 100) {
        score += (listItems - 100) * 0.5;
        log(`   ⚠️ WARNING: Many list items in PATCH (${listItems} list items)`);
      }
      
      const delayMs = Math.min(Math.round(score * 500), 90000);
      
      return { score: Math.round(score), delayMs, totalBlocks, listItems, tables, callouts };
    };
    
    const patchComplexity = calculateComplexityForPatch(extractedBlocks);
    
    if (patchComplexity.delayMs > 0) {
      log(`⏳ [RATE-LIMIT-PROTECTION] Complex PATCH content detected (score: ${patchComplexity.score}/100)`);
      log(`   Total blocks: ${patchComplexity.totalBlocks}`);
      log(`   List items: ${patchComplexity.listItems}`);
      log(`   Tables: ${patchComplexity.tables}`);
      log(`   Callouts: ${patchComplexity.callouts}`);
      log(`   Pre-PATCH delay: ${patchComplexity.delayMs}ms to avoid rate limits`);
      
      await new Promise(resolve => setTimeout(resolve, patchComplexity.delayMs));
      log(`   ✅ Pre-PATCH delay complete, proceeding with update...`);
    }
    
    // Deduplicate blocks
    const beforeDedupeCount = extractedBlocks.length;
    // Compute expected callouts from the source HTML for conditional dedupe
    // Use Cheerio-based detection matching servicenow.cjs conversion logic EXACTLY
    let expectedCallouts = null;
    try {
      if (html) {
        try {
          const $ = cheerio.load(html || '');
          const matched = new Set();

          let calloutIndex = 0;
          $('*').each((i, el) => {
            try {
              const $el = $(el);
              const cls = ($el.attr('class') || '').toString();
              const tag = el.tagName ? el.tagName.toLowerCase() : '';
              const role = ($el.attr('role') || '').toString();

              // Match servicenow.cjs conversion logic EXACTLY:
              // 1. div.note (line 1257 in servicenow.cjs)
              // 2. section.prereq or div.section.prereq (line 3380 in servicenow.cjs)
              // 3. role="note"
              const isDivNote = (tag === 'div' && /note/i.test(cls));
              const isPrereq = ((tag === 'section' || (tag === 'div' && /section/i.test(cls))) && /prereq/i.test(cls));
              const hasNoteRole = /note/i.test(role);

              if (isDivNote || isPrereq || hasNoteRole) {
                // CRITICAL: Skip nested callouts to avoid double-counting
                // A callout is nested if it has another callout ancestor
                const hasCalloutAncestor = $el.parents().toArray().some(parent => {
                  const $parent = $(parent);
                  const parentCls = ($parent.attr('class') || '').toString();
                  const parentTag = parent.tagName ? parent.tagName.toLowerCase() : '';
                  const parentRole = ($parent.attr('role') || '').toString();
                  
                  const parentIsDivNote = (parentTag === 'div' && /note/i.test(parentCls));
                  const parentIsPrereq = ((parentTag === 'section' || (parentTag === 'div' && /section/i.test(parentCls))) && /prereq/i.test(parentCls));
                  const parentHasNoteRole = /note/i.test(parentRole);
                  
                  return parentIsDivNote || parentIsPrereq || parentHasNoteRole;
                });
                
                if (hasCalloutAncestor) {
                  // Skip - this is a nested callout (will be a child block, not a top-level callout)
                  return;
                }
                
                // Count this as a unique callout (don't use HTML as dedupe key - multiple callouts can have identical content)
                // Example: Two separate "Before you begin" sections with same role requirements are BOTH valid callouts
                calloutIndex++;
                matched.add(`callout-${calloutIndex}`);
              }
            } catch (innerE) {
              // ignore element-level parse errors
            }
          });

          expectedCallouts = matched.size;
          log(`🔍 [PATCH-DEDUPE-WIRE] expectedCallouts from HTML (cheerio): ${expectedCallouts}`);
        } catch (cheerioErr) {
          log(`⚠️ [PATCH-DEDUPE-WIRE] Cheerio parsing failed: ${cheerioErr.message}`);
          expectedCallouts = null;
        }
      }
    } catch (e) {
      expectedCallouts = null;
    }

    extractedBlocks = dedupeUtil.dedupeAndFilterBlocks(extractedBlocks, { log, expectedCallouts });
    const afterDedupeCount = extractedBlocks.length;
    
    // [CALLOUT-TRACE] Track callouts after deduplication
    const calloutsAfterDedupe = extractedBlocks.filter(b => b.type === 'callout').length;
    console.log(`🔍 [CALLOUT-TRACE] Step 2 - After deduplication: ${calloutsAfterDedupe} callouts (expected: ${expectedCallouts})`);
    log(`🔍 [CALLOUT-TRACE] Step 2 - After deduplication: ${calloutsAfterDedupe} callouts (expected: ${expectedCallouts})`);
    
    if (beforeDedupeCount !== afterDedupeCount) {
      log(`🔄 Deduplication: ${beforeDedupeCount} → ${afterDedupeCount} blocks (removed ${beforeDedupeCount - afterDedupeCount})`);
    }
    
    // Collect markers for deep nesting (same as POST endpoint pattern)
    const markerMap = collectAndStripMarkers(extractedBlocks, {});
    const removedCount = removeCollectedBlocks(extractedBlocks);
    
    // [CALLOUT-TRACE] Track callouts after marker collection
    const calloutsAfterMarkers = extractedBlocks.filter(b => b.type === 'callout').length;
    console.log(`🔍 [CALLOUT-TRACE] Step 3 - After marker collection: ${calloutsAfterMarkers} callouts (removed ${removedCount} blocks)`);
    log(`🔍 [CALLOUT-TRACE] Step 3 - After marker collection: ${calloutsAfterMarkers} callouts (removed ${removedCount} blocks)`);
    if (calloutsAfterMarkers !== calloutsAfterDedupe) {
      console.log(`⚠️ [CALLOUT-TRACE] Callout count changed during marker collection! ${calloutsAfterDedupe} → ${calloutsAfterMarkers}`);
      log(`⚠️ [CALLOUT-TRACE] Callout count changed during marker collection! ${calloutsAfterDedupe} → ${calloutsAfterMarkers}`);
    }
    
    if (Object.keys(markerMap).length > 0) {
      log(`🔖 Collected ${Object.keys(markerMap).length} markers for deep nesting orchestration`);
    }
    
    if (removedCount > 0) {
      log(`🗑️ Removed ${removedCount} collected blocks from top-level (will be appended by orchestrator)`);
    }
    
    // Validate and clean invalid blocks before upload
    const beforeCleanCount = extractedBlocks.length;
    extractedBlocks = cleanInvalidBlocks(extractedBlocks);
    const afterCleanCount = extractedBlocks.length;
    
    // [CALLOUT-TRACE] Track callouts after cleaning
    const calloutsAfterClean = extractedBlocks.filter(b => b.type === 'callout').length;
    console.log(`🔍 [CALLOUT-TRACE] Step 4 - After cleaning: ${calloutsAfterClean} callouts`);
    log(`🔍 [CALLOUT-TRACE] Step 4 - After cleaning: ${calloutsAfterClean} callouts`);
    
    if (beforeCleanCount !== afterCleanCount) {
      log(`🧹 Block cleaning: ${beforeCleanCount} → ${afterCleanCount} blocks (removed ${beforeCleanCount - afterCleanCount} invalid)`);
    } else {
      log(`🧹 Block cleaning: No invalid blocks removed (checked ${beforeCleanCount} blocks)`);
    }
    
    // Normalize rich_text annotations
    normalizeAnnotations(extractedBlocks);
    
    // Prepare blocks for upload (split into initial + remaining)
    const MAX_BLOCKS_PER_REQUEST = 100;
    const initialBlocks = extractedBlocks.slice(0, MAX_BLOCKS_PER_REQUEST);
    const remainingBlocks = extractedBlocks.slice(MAX_BLOCKS_PER_REQUEST);
    
    log(`📦 Prepared ${initialBlocks.length} initial blocks, ${remainingBlocks.length} remaining`);
    
    // STEP 1: Delete all existing blocks from the page
    operationPhase = 'fetching existing blocks';
    log(`[PATCH-PROGRESS] STEP 1: Starting delete of existing blocks from page ${pageId}`);
    log(`🗑️ STEP 1: Deleting all existing blocks from page ${pageId}`);
    
    let existingBlocks = [];
    let cursor = undefined;
    let pageNum = 1;
    
    // Fetch all existing blocks (paginated)
    do {
      const listOptions = {
        block_id: pageId,
        page_size: 100
      };
      
      // Only add start_cursor if we have one
      if (cursor) {
        listOptions.start_cursor = cursor;
      }
      
      const response = await notion.blocks.children.list(listOptions);
      
      existingBlocks = existingBlocks.concat(response.results || []);
      cursor = response.has_more ? response.next_cursor : undefined;
      
      if (cursor) {
        log(`   Fetched page ${pageNum}, ${existingBlocks.length} blocks so far...`);
        pageNum++;
      }
    } while (cursor);
    
    log(`   Found ${existingBlocks.length} existing blocks to delete`);
    
    // Parallel delete with concurrency limit and rate limit management
    operationPhase = `deleting ${existingBlocks.length} blocks in parallel`;
    let deletedCount = 0;
    let failedCount = 0;
    const maxConcurrent = 10; // Process 10 deletions in parallel
    const maxRateLimitRetries = 5;
    
    // Helper function to delete a single block with retry logic
    const deleteBlockWithRetry = async (block, index) => {
      let rateLimitRetryCount = 0;
      let conflictRetryCount = 0;
      let deleted = false;
      const maxConflictRetries = 3;
      
      while (!deleted && rateLimitRetryCount <= maxRateLimitRetries && conflictRetryCount <= maxConflictRetries) {
        try {
          await notion.blocks.delete({ block_id: block.id });
          deletedCount++;
          deleted = true;
        } catch (error) {
          if (error.status === 429) {
            rateLimitRetryCount++;
            const delay = Math.min(1000 * Math.pow(2, rateLimitRetryCount - 1), 5000);
            log(`   ⏳ Rate limit hit on delete ${index + 1}, retry ${rateLimitRetryCount}/${maxRateLimitRetries} after ${delay}ms`);
            await new Promise(resolve => setTimeout(resolve, delay));
          } else if (error.code === 'conflict_error') {
            conflictRetryCount++;
            const delay = 500 * conflictRetryCount; // 500ms, 1s, 1.5s
            log(`   🔄 Conflict on delete ${index + 1}, retry ${conflictRetryCount}/${maxConflictRetries} after ${delay}ms`);
            await new Promise(resolve => setTimeout(resolve, delay));
          } else {
            log(`   ⚠️ Failed to delete block ${block.id}: ${error.message}`);
            failedCount++;
            break; // Skip this block and continue
          }
        }
      }
      
      if (!deleted && rateLimitRetryCount > maxRateLimitRetries) {
        log(`   ❌ Max retries exceeded for block ${block.id}`);
        failedCount++;
      } else if (!deleted && conflictRetryCount > maxConflictRetries) {
        log(`   ❌ Max conflict retries exceeded for block ${block.id}`);
        failedCount++;
      }
    };
    
    // Process deletions in parallel batches
    const startTime = Date.now();
    for (let i = 0; i < existingBlocks.length; i += maxConcurrent) {
      const batch = existingBlocks.slice(i, i + maxConcurrent);
      const batchNum = Math.floor(i / maxConcurrent) + 1;
      const totalBatches = Math.ceil(existingBlocks.length / maxConcurrent);
      
      log(`   Deleting batch ${batchNum}/${totalBatches} (${batch.length} blocks)...`);
      
      // Delete batch in parallel
      await Promise.all(
        batch.map((block, batchIndex) => deleteBlockWithRetry(block, i + batchIndex))
      );
      
      // Small delay between batches to prevent overwhelming the API
      if (i + maxConcurrent < existingBlocks.length) {
        await new Promise(resolve => setTimeout(resolve, 50));
      }
      
      // Progress update every 5 batches
      if (batchNum % 5 === 0) {
        const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
        log(`   Progress: ${deletedCount}/${existingBlocks.length} deleted (${elapsed}s elapsed)`);
      }
    }
    
    const totalTime = ((Date.now() - startTime) / 1000).toFixed(1);
    log(`✅ Deleted ${deletedCount}/${existingBlocks.length} blocks in ${totalTime}s${failedCount > 0 ? ` (${failedCount} failed)` : ''}`);
    log(`[PATCH-PROGRESS] STEP 1 Complete: Deleted ${deletedCount}/${existingBlocks.length} blocks in ${totalTime}s`);
    
    // STEP 2: Upload fresh content
    operationPhase = `uploading ${extractedBlocks.length} fresh blocks`;
    log(`[PATCH-PROGRESS] STEP 2: Starting upload of ${extractedBlocks.length} fresh blocks`);
    log(`📤 STEP 2: Uploading ${extractedBlocks.length} fresh blocks`);
    
    // [CALLOUT-TRACE] Track callouts before upload
    const calloutsInInitial = initialBlocks.filter(b => b.type === 'callout').length;
    const calloutsInRemaining = remainingBlocks.filter(b => b.type === 'callout').length;
    console.log(`🔍 [CALLOUT-TRACE] Step 5 - Before upload: ${calloutsInInitial} callouts in initial batch, ${calloutsInRemaining} in remaining`);
    log(`🔍 [CALLOUT-TRACE] Step 5 - Before upload: ${calloutsInInitial} callouts in initial batch, ${calloutsInRemaining} in remaining`);
    
    // Upload initial batch (up to 100 blocks) with retry logic
    const maxRetries = 3;
    const maxConflictRetries = 3;
    let retryCount = 0;
    let conflictRetryCount = 0;
    let uploadSuccess = false;
    let rateLimitRetryCount = 0;
    
    while (!uploadSuccess && (retryCount <= maxRetries || rateLimitRetryCount <= maxRateLimitRetries || conflictRetryCount <= maxConflictRetries)) {
      try {
        await notion.blocks.children.append({
          block_id: pageId,
          children: initialBlocks
        });
        uploadSuccess = true;
        log(`✅ Uploaded ${initialBlocks.length} initial blocks`);
      } catch (error) {
        if (error.status === 429) {
          rateLimitRetryCount++;
          const delay = Math.min(1000 * Math.pow(2, rateLimitRetryCount - 1), 5000);
          log(`   ⏳ Rate limit hit on upload, retry ${rateLimitRetryCount}/${maxRateLimitRetries} after ${delay}ms`);
          await new Promise(resolve => setTimeout(resolve, delay));
        } else if (error.code === 'conflict_error') {
          conflictRetryCount++;
          const delay = 500 * conflictRetryCount; // 500ms, 1s, 1.5s
          log(`   🔄 Conflict on upload, retry ${conflictRetryCount}/${maxConflictRetries} after ${delay}ms`);
          await new Promise(resolve => setTimeout(resolve, delay));
        } else {
          retryCount++;
          if (retryCount <= maxRetries) {
            log(`   ⚠️ Upload failed (attempt ${retryCount}/${maxRetries}), retrying: ${error.message}`);
            await new Promise(resolve => setTimeout(resolve, 1000));
          } else {
            throw error;
          }
        }
      }
    }
    
    // Upload remaining blocks in chunks
    if (remainingBlocks.length > 0) {
      log(`📝 Uploading ${remainingBlocks.length} remaining blocks in chunks...`);
      
      const chunks = [];
      for (let i = 0; i < remainingBlocks.length; i += MAX_BLOCKS_PER_REQUEST) {
        chunks.push(remainingBlocks.slice(i, i + MAX_BLOCKS_PER_REQUEST));
      }
      
      for (let i = 0; i < chunks.length; i++) {
        const chunk = chunks[i];
        log(`   Uploading chunk ${i + 1}/${chunks.length} (${chunk.length} blocks)...`);
        
        deepStripPrivateKeys(chunk);
        
        // Retry logic for this chunk
        let chunkSuccess = false;
        let chunkRetries = 0;
        const maxChunkRetries = 3;
        
        while (!chunkSuccess && chunkRetries <= maxChunkRetries) {
          try {
            await notion.blocks.children.append({
              block_id: pageId,
              children: chunk
            });
            chunkSuccess = true;
          } catch (chunkError) {
            if (chunkError.code === 'conflict_error' && chunkRetries < maxChunkRetries) {
              chunkRetries++;
              const delay = 500 * chunkRetries;
              log(`   🔄 Conflict on chunk ${i + 1}, retry ${chunkRetries}/${maxChunkRetries} after ${delay}ms`);
              await new Promise(resolve => setTimeout(resolve, delay));
            } else if (chunkError.status === 429 && chunkRetries < maxChunkRetries) {
              chunkRetries++;
              const delay = 1000 * Math.pow(2, chunkRetries - 1);
              log(`   ⏳ Rate limit on chunk ${i + 1}, retry ${chunkRetries}/${maxChunkRetries} after ${delay}ms`);
              await new Promise(resolve => setTimeout(resolve, delay));
            } else {
              throw chunkError;
            }
          }
        }
        
        // Rate limit protection between chunks
        if (i < chunks.length - 1) {
          await new Promise(resolve => setTimeout(resolve, 100));
        }
      }
      
      log(`✅ All ${remainingBlocks.length} remaining blocks uploaded`);
    }
    
    // Brief pause after uploads to let Notion settle
    if (extractedBlocks.length > 0) {
      log(`⏸️  Waiting 500ms for Notion to process uploads...`);
      await new Promise(resolve => setTimeout(resolve, 500));
    }
    
    log(`[PATCH-PROGRESS] STEP 2 Complete: Uploaded all ${extractedBlocks.length} blocks successfully`);
    
    // STEP 3: Run orchestration for deep nesting
    if (markerMap && Object.keys(markerMap).length > 0) {
      operationPhase = `orchestrating deep nesting for ${Object.keys(markerMap).length} markers`;
      log(`[PATCH-PROGRESS] STEP 3: Starting deep-nesting orchestration for ${Object.keys(markerMap).length} markers`);
      log(`🔧 STEP 3: Running deep-nesting orchestration for ${Object.keys(markerMap).length} markers`);
      
      // [CALLOUT-TRACE] Check if any markers contain callouts
      let calloutsInMarkers = 0;
      Object.values(markerMap).forEach(children => {
        if (Array.isArray(children)) {
          calloutsInMarkers += children.filter(b => b && b.type === 'callout').length;
        }
      });
      log(`🔍 [CALLOUT-TRACE] Markers contain ${calloutsInMarkers} callouts that will be appended during orchestration`);
      
      try {
        const orchResult = await orchestrateDeepNesting(pageId, markerMap);
        log(`✅ Orchestration complete: ${JSON.stringify(orchResult)}`);
        log(`[PATCH-PROGRESS] STEP 3 Complete: Orchestration successful`);
      } catch (orchError) {
        log(`⚠️ Orchestration failed (non-fatal): ${orchError.message}`);
        log(`[PATCH-PROGRESS] STEP 3 Warning: Orchestration failed but continuing`);
      }
    } else {
      log(`[PATCH-PROGRESS] STEP 3 Skipped: No deep nesting markers present`);
    }
    
    // STEP 3.5: Post-orchestration deduplication (FIX v11.0.25)
    // Run deduplication BEFORE marker sweep to clean up duplicate callouts/blocks
    // This matches POST behavior and prevents validation mismatches
    // (POST dedups before validation, PATCH should too)
    operationPhase = 'running post-orchestration deduplication';
    log(`🔧 STEP 3.5: Running post-orchestration deduplication (matches POST behavior)`);
    
    try {
      // Fetch the current page blocks
      const pageBlocks = await notion.blocks.children.list({ block_id: pageId, page_size: 100 });
      let allBlocks = pageBlocks.results || [];
      
      // Fetch remaining pages if needed
      let cursor = pageBlocks.next_cursor;
      while (cursor) {
        const nextPage = await notion.blocks.children.list({ 
          block_id: pageId, 
          start_cursor: cursor,
          page_size: 100 
        });
        allBlocks = allBlocks.concat(nextPage.results || []);
        cursor = nextPage.next_cursor;
      }
      
      log(`   Fetched ${allBlocks.length} blocks from page (will NOT deduplicate page root siblings)`);
      
      // Import deduplication utilities
      const dedupeUtil = require('../utils/dedupe.cjs');
      
      // For each block with children, deduplicate its children
      const blockTypesWithChildren = ['numbered_list_item', 'bulleted_list_item', 'callout', 'toggle', 'quote', 'column'];
      
      // Recursive function to deduplicate children at all nesting levels
      async function deduplicateBlockChildren(blockId, blockType, depth = 0) {
        const indent = '  '.repeat(depth);
        const childrenResp = await notion.blocks.children.list({ block_id: blockId, page_size: 100 });
        const children = childrenResp.results || [];
        
        if (children.length > 1) {
          const duplicateIds = [];
          
          // Context-aware deduplication
          const isListItem = blockType === 'numbered_list_item' || blockType === 'bulleted_list_item';
          const isPageRoot = blockType === 'page';
          
          let prevChild = null;
          let prevKey = null;
          
          for (const child of children) {
            // Skip deduplication for images/tables in list items (procedural context)
            if (isListItem && !isPageRoot && (child.type === 'image' || child.type === 'table')) {
              log(`${indent}  ✓ Preserving ${child.type} in ${blockType} (procedural context)`);
              prevChild = child;
              prevKey = null;
              continue;
            }
            
            // Skip deduplication for list items at page root (different lists)
            if (isPageRoot && (child.type === 'numbered_list_item' || child.type === 'bulleted_list_item')) {
              log(`${indent}  ✓ Preserving ${child.type} at page root (different lists)`);
              prevChild = child;
              prevKey = null;
              continue;
            }
            
            // Skip deduplication for tables/images at page root (different sections)
            if (isPageRoot && (child.type === 'table' || child.type === 'image')) {
              log(`${indent}  ✓ Preserving ${child.type} at page root (different sections)`);
              prevChild = child;
              prevKey = null;
              continue;
            }
            
            const key = dedupeUtil.computeBlockKey(child);
            
            // Only mark as duplicate if IMMEDIATELY PREVIOUS block has the same key
            if (prevKey && key === prevKey && prevChild) {
              duplicateIds.push(child.id);
              log(`${indent}  🔎 Found consecutive duplicate ${child.type}: ${child.id}`);
            } else {
              prevChild = child;
              prevKey = key;
            }
          }
          
          // Delete duplicates
          for (const dupId of duplicateIds) {
            try {
              await notion.blocks.delete({ block_id: dupId });
              log(`${indent}  🚫 Deleted duplicate child block: ${dupId}`);
            } catch (deleteError) {
              log(`${indent}  ❌ Failed to delete duplicate ${dupId}: ${deleteError.message}`);
            }
          }
          
          if (duplicateIds.length > 0) {
            log(`${indent}Removed ${duplicateIds.length} duplicate(s) from ${blockType}`);
          }
        }
        
        // Recursively check children of children
        for (const child of children) {
          if (blockTypesWithChildren.includes(child.type) && child.has_children) {
            await deduplicateBlockChildren(child.id, child.type, depth + 1);
          }
        }
      }
      
      // First, deduplicate at the PAGE ROOT LEVEL
      log(`🔍 Deduplicating page root level...`);
      await deduplicateBlockChildren(pageId, 'page', 0);
      
      // Then deduplicate children of specific block types
      for (const block of allBlocks) {
        if (blockTypesWithChildren.includes(block.type) && block.has_children) {
          await deduplicateBlockChildren(block.id, block.type, 0);
        }
      }
      
      log("✅ Post-orchestration deduplication complete");
      
      // [CALLOUT-TRACE] Count callouts after post-orchestration deduplication
      const pageBlocksAfterDedupe = await notion.blocks.children.list({ block_id: pageId, page_size: 100 });
      const calloutsAfterPostDedupe = (pageBlocksAfterDedupe.results || []).filter(b => b.type === 'callout').length;
      log(`🔍 [CALLOUT-TRACE] Step 6 - After post-orchestration deduplication: ${calloutsAfterPostDedupe} callouts at page root`);
      
    } catch (dedupError) {
      log(`⚠️ Post-orchestration deduplication failed: ${dedupError.message}`);
    }
    
    // STEP 3.6: Marker sweep
    // ALWAYS run marker sweep for PATCH operations to clean inherited markers from previous page versions
    // PATCH deletes all blocks and re-creates them, which can leave orphaned markers from the old version
    operationPhase = 'sweeping for residual markers';
    const hasMarkers = markerMap && Object.keys(markerMap).length > 0;
    const reason = hasMarkers ? 'orchestration markers present' : 'PATCH safety sweep (cleans inherited markers)';
    log(`🧹 STEP 3.6: Preparing marker sweep (${reason})`);

    // Wait 1 second before marker sweep to reduce conflicts
    log(`⏸️  Waiting 1s before marker sweep to reduce conflicts...`);
    await new Promise(resolve => setTimeout(resolve, 1000));

    log(`🧹 STEP 3.6: Running final marker sweep to clean any residual markers`);
    try {
      // Use global context function (hot-reload safe - doesn't require relative paths)
      const sweepResult = await global.sweepAndRemoveMarkersFromPage(pageId);
      if (sweepResult && sweepResult.updated > 0) {
        log(`✅ Marker sweep updated ${sweepResult.updated} blocks (removed inherited markers)`);
      } else {
        log(`✅ Marker sweep found no markers to remove`);
      }
    } catch (sweepError) {
      log(`⚠️ Marker sweep failed (non-fatal): ${sweepError.message}`);
    }
    
    // STEP 4: Update page properties if provided
    if (payload.properties || payload.url) {
      log(`📝 STEP 4: Updating page properties`);
      
      const properties = {};
      
      // Set URL if provided (same as POST endpoint)
      if (payload.url) {
        properties["URL"] = {
          url: payload.url,
        };
      }
      
      // Apply property mappings from payload (from userscript) using Notion service
      if (payload.properties) {
        log("🔍 Received properties from userscript:");
        log(JSON.stringify(payload.properties, null, 2));
        
        // Merge with existing properties (userscript already did the mapping)
        Object.assign(properties, payload.properties);
        log("🔍 Properties after merge:");
        log(JSON.stringify(properties, null, 2));
      }
      
      try {
        await notion.pages.update({
          page_id: pageId,
          properties: properties
        });
        log(`✅ Properties updated`);
      } catch (propError) {
        log(`⚠️ Property update failed (non-fatal): ${propError.message}`);
      }
    }
    
    // STEP 5: Validation (optional, but always creates a result for property updates)
    let validationResult = null;
    const shouldValidate = process.env.SN2N_VALIDATE_OUTPUT === '1' || process.env.SN2N_VALIDATE_OUTPUT === 'true';
    
    // FIX v11.0.24: Always create a validation result, even if validation is disabled
    // This ensures properties are updated consistently with POST behavior
    if (!shouldValidate) {
      // Calculate character counts even when validation is disabled
      const htmlChars = (extractionResult.fixedHtml || html).replace(/<[^>]*>/g, '').length;
      const notionChars = extractedBlocks.reduce((total, block) => {
        if (block.type === 'paragraph' || block.type === 'heading_1' || block.type === 'heading_2' || block.type === 'heading_3') {
          const richText = block[block.type]?.rich_text || [];
          return total + richText.reduce((blockTotal, text) => blockTotal + (text.plain_text || '').length, 0);
        }
        return total;
      }, 0);
      
      validationResult = {
        success: true,
        hasErrors: false,
        issues: [],
        warnings: [],
        stats: null,
        summary: `ℹ️ Validation not enabled (set SN2N_VALIDATE_OUTPUT=1 to enable)`,
        htmlChars,
        notionChars,
        charDiff: notionChars - htmlChars
      };
      log(`ℹ️ Validation skipped - will set properties to indicate validation not run`);
    }
    
    if (shouldValidate) {
      operationPhase = 'validating updated page';
      log(`🔍 STEP 5: Validating updated page`);
      
      // Dynamic wait time based on orchestration complexity (same as POST)
      // FIX v11.0.35: Equalized PATCH wait times with POST to reduce false negative validation failures
      // PATCH was using 2s base / 10s max while POST uses 5s base / 15s max
      // Root cause: PATCH validation ran too soon, causing identical content to fail validation
      // Solution: Use same wait formula as POST for consistent eventual consistency handling
      // 
      // Wait time formula:
      // Base: 5s for uploads + deduplication + Notion eventual consistency
      // +300ms per marker processed (orchestration PATCH requests)
      // +1s if page has >100 blocks (needs chunked append settling time)
      // Max: 15s to match POST behavior
      const markerCount = markerMap ? Object.keys(markerMap).length : 0;
      const totalBlocks = extractedBlocks.length;
      const baseWait = 5000; // 5 seconds base (increased from 2s - matches POST)
      const extraWaitPerMarker = 300; // 300ms per marker (orchestration PATCH)
      const largePageWait = totalBlocks > 100 ? 1000 : 0; // +1s for pages >100 blocks
      
      let validationDelay = baseWait;
      if (markerCount > 0) {
        validationDelay += (markerCount * extraWaitPerMarker);
        log(`   +${markerCount * extraWaitPerMarker}ms for ${markerCount} markers (orchestration)`);
      }
      if (largePageWait > 0) {
        validationDelay += largePageWait;
        log(`   +${largePageWait}ms for large page (${totalBlocks} blocks - chunked appends)`);
      }
      
      // Cap at 15 seconds (increased from 10s - matches POST)
      validationDelay = Math.min(validationDelay, 15000);
      
      log(`⏳ Waiting ${validationDelay}ms for Notion's eventual consistency...`);
      log(`   (Base: 5s + Markers: ${markerCount} × 300ms + Large page: ${largePageWait}ms = ${validationDelay}ms)`);
      await new Promise(resolve => setTimeout(resolve, validationDelay));
      
      // FIX v11.0.30: Verify page has content after PATCH before validation
      let hasContent = false;
      try {
        log(`🔍 Verifying page has content after PATCH...`);
        const blockCheck = await notion.blocks.children.list({
          block_id: pageId,
          page_size: 10
        });
        
        hasContent = blockCheck.results && blockCheck.results.length > 0;
        
        if (!hasContent) {
          log(`❌ WARNING: PATCH completed but page has NO BLOCKS`);
          validationResult = {
            success: false,
            hasErrors: true,
            issues: ['PATCH operation succeeded but no blocks were uploaded - content may have been deleted or upload failed'],
            warnings: [],
            stats: { totalBlocks: 0 },
            summary: '❌ CRITICAL: PATCH completed but page is empty - no content blocks exist after update. This may indicate a Notion API error or that all blocks were accidentally deleted.'
          };
        } else {
          log(`✅ Page has ${blockCheck.results.length} blocks after PATCH - proceeding with validation`);
        }
      } catch (pageCheckError) {
        log(`⚠️ Error checking page content: ${pageCheckError.message}`);
        // Fall through to validation (might be temporary API issue)
        hasContent = true; // Assume content exists and let validation run
      }
      
      // Only run full validation if page has content
      if (hasContent) {
        try {
          validationResult = await validateNotionPage(notion, pageId, {
            sourceHtml: extractionResult.fixedHtml || html,
            expectedTitle: pageTitle,
            verbose: true
          });
          
          // FIX v11.0.40: Ensure breakdown exists for ContentComparison property by fetching Notion blocks
          // validateContentOrder returns similarity but not block type breakdown
          if (!validationResult.stats || !validationResult.stats.breakdown) {
            log(`📊 [PATCH-VALIDATION] Fetching blocks from Notion to populate ContentComparison breakdown...`);
            
            try {
              let allNotionBlocks = [];
              let cursor = undefined;
              
              do {
                const blockResponse = await notion.blocks.children.list({
                  block_id: pageId,
                  page_size: 100,
                  ...(cursor ? { start_cursor: cursor } : {})
                });
                
                allNotionBlocks.push(...blockResponse.results);
                cursor = blockResponse.has_more ? blockResponse.next_cursor : undefined;
              } while (cursor);
              
              // Count block types recursively
              const blockCounts = {
                paragraphs: 0,
                headings: 0,
                tables: 0,
                images: 0,
                callouts: 0,
                orderedList: 0,
                unorderedList: 0
              };
              
              // Recursive function to count blocks including nested children
              async function countBlocksRecursively(blocks, depth = 0) {
                for (const block of blocks) {
                  if (block.type === 'paragraph') blockCounts.paragraphs++;
                  else if (block.type.startsWith('heading_')) blockCounts.headings++;
                  else if (block.type === 'table') blockCounts.tables++;
                  else if (block.type === 'image') blockCounts.images++;
                  else if (block.type === 'callout') blockCounts.callouts++;
                  else if (block.type === 'numbered_list_item') blockCounts.orderedList++;
                  else if (block.type === 'bulleted_list_item') blockCounts.unorderedList++;
                  
                  // Recursively fetch and count children blocks
                  if (block.has_children && depth < 10) { // Limit depth to prevent infinite loops
                    try {
                      let childCursor = undefined;
                      let allChildren = [];
                      
                      do {
                        const childResponse = await notion.blocks.children.list({
                          block_id: block.id,
                          page_size: 100,
                          ...(childCursor ? { start_cursor: childCursor } : {})
                        });
                        
                        allChildren.push(...childResponse.results);
                        childCursor = childResponse.has_more ? childResponse.next_cursor : undefined;
                      } while (childCursor);
                      
                      // Recursively count children
                      if (allChildren.length > 0) {
                        await countBlocksRecursively(allChildren, depth + 1);
                      }
                    } catch (childError) {
                      log(`⚠️ [PATCH-VALIDATION] Failed to fetch children for block ${block.id}: ${childError.message}`);
                    }
                  }
                }
              }
              
              await countBlocksRecursively(allNotionBlocks);
              
              // Populate breakdown in validationResult
              if (!validationResult.stats) validationResult.stats = {};
              validationResult.stats.breakdown = {
                paragraphsNotion: blockCounts.paragraphs,
                headingsNotion: blockCounts.headings,
                tablesNotion: blockCounts.tables,
                imagesNotion: blockCounts.images,
                calloutsNotion: blockCounts.callouts,
                orderedListNotion: blockCounts.orderedList,
                unorderedListNotion: blockCounts.unorderedList
              };
              
              log(`✅ [PATCH-VALIDATION] ContentComparison breakdown populated: ${JSON.stringify(validationResult.stats.breakdown)}`);
              
            } catch (breakdownError) {
              log(`⚠️ [PATCH-VALIDATION] Failed to populate ContentComparison breakdown: ${breakdownError.message}`);
            }
          }
          
          if (validationResult.valid) {
            log(`✅ Validation passed`);
          } else {
            log(`⚠️ Validation warnings detected`);
          }
          
          // FIX v11.0.36: Retry validation up to 2 times with escalating waits (5s, 10s)
          // Handles edge cases where Notion takes >15s to settle after PATCH
          // Only retries if validation has actual errors (not just warnings)
          const maxValidationRetries = 2;
          let retryAttempt = 0;
          
          while (retryAttempt < maxValidationRetries && validationResult && !validationResult.success && validationResult.hasErrors) {
            retryAttempt++;
            const retryWait = retryAttempt * 5000; // 5s, 10s
            
            log(`\n⚠️ PATCH validation attempt ${retryAttempt} failed - retrying after ${retryWait}ms...`);
            log(`   Issues: ${validationResult.issues?.join(', ') || 'unknown'}`);
            
            await new Promise(resolve => setTimeout(resolve, retryWait));
            
            log(`🔄 Retrying PATCH validation (attempt ${retryAttempt + 1}/${maxValidationRetries + 1})...`);
            const retryResult = await validateNotionPage(notion, pageId, {
              sourceHtml: extractionResult.fixedHtml || html,
              expectedTitle: pageTitle,
              verbose: true
            });
            
            if (retryResult.success) {
              log(`✅ PATCH validation succeeded on retry ${retryAttempt} - Notion eventual consistency resolved`);
              validationResult = retryResult;
              break;
            } else {
              log(`⚠️ PATCH validation still failing after retry ${retryAttempt}`);
              validationResult = retryResult;
              
              if (retryAttempt === maxValidationRetries) {
                // All retries exhausted
                if (!validationResult.warnings) validationResult.warnings = [];
                validationResult.warnings.push(`PATCH validation retried ${maxValidationRetries} times but still failed`);
              }
            }
          }
        } catch (valError) {
          log(`⚠️ Validation failed (non-fatal): ${valError.message}`);
          // FIX v11.0.29: Ensure validation result exists even on error
          if (!validationResult) {
            validationResult = {
              success: false,
              hasErrors: true,
              issues: [`Validation error: ${valError.message}`],
              warnings: [],
              stats: null,
              summary: `❌ Validation encountered an error: ${valError.message}`
            };
          }
        }
      }
    }
    
    log(`[PATCH-PROGRESS] All steps complete - PATCH operation successful!`);
    
    // [CALLOUT-TRACE] Final callout count in Notion
    try {
      const finalPageBlocks = await notion.blocks.children.list({ block_id: pageId, page_size: 100 });
      const finalCalloutCount = (finalPageBlocks.results || []).filter(b => b.type === 'callout').length;
      log(`🔍 [CALLOUT-TRACE] Step 7 - FINAL: ${finalCalloutCount} callouts in Notion page at completion`);
    } catch (err) {
      log(`⚠️ [CALLOUT-TRACE] Could not fetch final callout count: ${err.message}`);
    }
    
    // STEP 6: Update Validation property with PATCH indicator
    // FIX v11.0.24: Always update properties (validationResult always exists now)
    // FIX v11.0.29: Ensure validationResult.summary is NEVER empty (prevents empty arrays in Notion)
    if (!validationResult) {
      log(`⚠️ WARNING: validationResult is null - creating default result`);
      validationResult = {
        success: false,
        hasErrors: true,
        issues: ['Internal error: validation result was null'],
        warnings: [],
        stats: null,
        summary: '❌ Internal error: validation result was not created properly'
      };
    }
    
    if (!validationResult.summary || validationResult.summary.trim() === '') {
      log(`⚠️ WARNING: Validation summary is empty - using default message`);
      validationResult.summary = '⚠️ Validation completed but no summary was generated';
      validationResult.hasErrors = true;
      if (!validationResult.issues) validationResult.issues = [];
      validationResult.issues.push('Internal error: validation summary was empty');
    }
    
      // FIX v11.0.116 BUG: Declare propertyUpdateSuccess/Error outside try block so catch block can access them
      let propertyUpdateSuccess = false;
      let propertyUpdateError = null;
      // FIX v11.0.116.1: Declare maxPropertyRetries outside try block for audit recalculation
      const maxPropertyRetries = 5;
      // FIX v11.0.116.2: Declare allNotionBlocks outside try block for audit recalculation
      let allNotionBlocks = [];    try {
      const propertyUpdates = {};
      
      // Set Error checkbox based on validation result
      propertyUpdates["Error"] = { checkbox: validationResult.hasErrors === true };
      if (validationResult.hasErrors) {
        log(`⚠️ Validation failed`);
        
        // FIX: Auto-save failed PATCH pages to pages-to-update for re-extraction
        try {
          log(`💾 Validation failed - auto-saving page to pages-to-update...`);
          const fixturesDir = path.join(__dirname, '../../patch/pages/pages-to-update');
          if (!fs.existsSync(fixturesDir)) {
            fs.mkdirSync(fixturesDir, { recursive: true });
          }
          
          const timestamp = new Date().toISOString().replace(/:/g, '-').replace(/\..+/, '');
          const sanitizedTitle = (pageTitle || 'untitled')
            .toLowerCase()
            .replace(/[^a-z0-9]+/g, '-')
            .replace(/^-+|-+$/g, '')
            .substring(0, 60);
          const filename = `${sanitizedTitle}-patch-validation-failed-${timestamp}.html`;
          const filepath = path.join(fixturesDir, filename);
          
          const htmlContent = `<!--
Auto-saved: PATCH validation failed
Page ID: ${pageId}
Page Title: ${pageTitle}
PATCH Completed: ${new Date().toISOString()}
Source URL: ${payload.url || 'N/A'}

Validation Result:
${JSON.stringify(validationResult, null, 2)}

Validation Issues:
${validationResult.issues ? validationResult.issues.join('\n') : 'None'}

Validation Warnings:
${validationResult.warnings ? validationResult.warnings.join('\n') : 'None'}

Action Required: Fix the issues and re-PATCH this page
-->

${html || ''}
`;
          
          fs.writeFileSync(filepath, htmlContent, 'utf-8');
          log(`✅ AUTO-SAVED: ${filename}`);
          log(`   Location: ${filepath}`);
          log(`   Reason: PATCH validation detected ${validationResult.issues?.length || 0} issue(s)`);
        } catch (saveError) {
          log(`❌ Failed to auto-save failed PATCH: ${saveError.message}`);
        }
      }
      
      // FIX v11.0.113: Replace LCS validation with AUDIT-based validation for PATCH
      // Build combined validation content with Text Content Validation + Content Audit sections
      
      // Use AUDIT results from extraction (if available)
      const auditResult = extractionResult?.audit;
      
      log(`📊 [PATCH-AUDIT-DEBUG] extractionResult keys: ${extractionResult ? Object.keys(extractionResult).join(', ') : 'N/A'}`);
      log(`📊 [PATCH-AUDIT-DEBUG] auditResult: ${auditResult ? JSON.stringify(auditResult).substring(0, 200) : 'null'}`);
      
      let auditStatus = 'SKIPPED';
      let auditIcon = '⚠️';
      let auditCoverageFail = false;
      
      if (!auditResult) {
        // No AUDIT data available
        auditStatus = 'SKIPPED';
        auditIcon = '⚠️';
        log(`⚠️ AUDIT results not available for PATCH validation`);
      } else {
        // Determine status based on AUDIT coverage
        const coveragePassed = auditResult.passed; // 95-105% range
        const hasMarkerLeaks = validationResult.hasErrors && 
                               validationResult.issues?.some(issue => 
                                 issue.toLowerCase().includes('marker') || 
                                 issue.toLowerCase().includes('sn2n:')
                               );
        
        if (!coveragePassed || hasMarkerLeaks) {
          auditStatus = 'FAIL';
          auditIcon = '❌';
          auditCoverageFail = true;
          
          // FIX v11.0.113: Auto-remediate on AUDIT failure
          log(`\n🔧 ========== TRIGGERING AUTO-REMEDIATION ==========`);
          try {
            const diagnosis = diagnoseAndFixAudit({
              html,
              blocks: extractedBlocks,
              audit: auditResult,
              pageTitle: payload.title || 'Unknown',
              log
            });
            
            // Save diagnosis for review
            const diagnosisFile = saveDiagnosisToFile(diagnosis, pageId);
            if (diagnosisFile) {
              log(`💾 Diagnosis saved: ${diagnosisFile}`);
            }
          } catch (remErr) {
            log(`⚠️ Auto-remediation error: ${remErr.message}`);
          }
          log(`🔧 =========================================\n`);
        } else {
          auditStatus = 'PASS';
          auditIcon = '✅';
        }
      }
      
      // Build validation content with Content Audit section only
      const validationLines = [];
      const timestamp = new Date().toISOString().split('T')[0];
      
      // Content Audit section (AUDIT coverage - reorganized format)
      if (auditResult) {
        // FIX v11.0.86+: Reorganized output format for clarity (POST/PATCH alignment)
        if (auditResult.missing === 0 && auditResult.extra === 0) {
          // Perfect match
          validationLines.push(`[${timestamp}] ✅ Content Extraction: 100.0% of source (exact match)`);
        } else if (auditResult.missing === 0 && auditResult.extra > 0) {
          // All content extracted, with formatting overhead
          const formattingOverhead = auditResult.extraPercent;
          validationLines.push(`[${timestamp}] ✅ Content Extraction: 100.0% of source (all content preserved)`);
          validationLines.push(`Formatting Overhead: +${formattingOverhead}% `);
        } else if (auditResult.missing > 0) {
          // Some content missing
          const contentExtracted = 100 - auditResult.missingPercent;
          validationLines.push(`[${timestamp}] ${auditResult.passed ? '✅' : '⚠️'} Content Extraction: ${contentExtracted.toFixed(1)}% of source`);
          if (auditResult.extra > 0) {
            validationLines.push(`Formatting Overhead: +${auditResult.extraPercent}%`);
          }
          validationLines.push(`⚠️ Missing: ${auditResult.missing.toLocaleString()} chars (${auditResult.missingPercent}%)`);
        }
        
        // Add content complexity summary if available
        if (auditResult.contentAnalysis) {
          const ca = auditResult.contentAnalysis;
          const complexityDetails = [];
          if (ca.tableCount > 0) complexityDetails.push(`${ca.tableCount} table${ca.tableCount > 1 ? 's' : ''}`);
          if (ca.calloutCount > 0) complexityDetails.push(`${ca.calloutCount} callout${ca.calloutCount > 1 ? 's' : ''}`);
          if (ca.nestedListCount > 0) complexityDetails.push(`${ca.nestedListCount} nested list${ca.nestedListCount > 1 ? 's' : ''}`);
          if (ca.deepNestingCount > 0) complexityDetails.push(`${ca.deepNestingCount} deep nesting block${ca.deepNestingCount > 1 ? 's' : ''}`);
          
          if (complexityDetails.length > 0) {
            validationLines.push(`\nContent: ${complexityDetails.join(', ')}`);
          }
        }
        
        // Add coverage and threshold info (for reference)
        validationLines.push(`\nCoverage: ${auditResult.coverageStr} (threshold: ${auditResult.threshold || '95-105%'})`);
        
        // Add technical details
        validationLines.push(`Source: ${auditResult.nodeCount || 'N/A'} text nodes, ${auditResult.totalLength || 'N/A'} chars`);
        validationLines.push(`Notion: ${auditResult.notionBlocks} blocks, ${auditResult.notionTextLength} chars`);
        validationLines.push(`Block/Node Ratio: ${auditResult.blockNodeRatio}x`);
      } else {
        validationLines.push('AUDIT system not enabled - no coverage data available');
      }
      
      const auditContent = validationLines.join('\n');
      
      console.log('🚨🚨🚨🚨🚨 PATCH AUDIT PROPERTY UPDATE 🚨🚨🚨🚨🚨');
      console.log(`📊 [PATCH-AUDIT-DEBUG] Setting Audit property:`);
      console.log(`   Content length: ${auditContent.length} chars`);
      console.log(`   Content preview: ${auditContent.substring(0, 200)}...`);
      console.log(`   FULL CONTENT:\n${auditContent}`);
      console.log('🚨🚨🚨🚨🚨 END AUDIT PROPERTY 🚨🚨🚨🚨🚨\n');

      // Truncate to fit Notion's 2000 character limit for rich text properties
      let truncatedAuditContent = auditContent;
      if (auditContent.length > 2000) {
        truncatedAuditContent = auditContent.substring(0, 1997) + '...';
        console.log(`⚠️ [PATCH-PROPERTY-TRUNCATE] Audit property truncated to 2000 chars (was ${auditContent.length})`);
      }

      propertyUpdates["Audit"] = {
        rich_text: [ { type: 'text', text: { content: truncatedAuditContent } } ]
      };

      // FIX v11.0.161: MissingText and ExtraText properties removed
      // Missing/extra content details now included in Audit property directly
      // No separate property updates needed

  // (Removed deprecated Status property logic; counts handled in ContentComparison header)

      // ContentComparison property refined breakdown (first line reflects table/image/callout count match, not validation status)
      const stats = validationResult.stats || {};
      const breakdown = stats.breakdown || {};
      const getNum = (v) => (typeof v === 'number' ? v : (v && v.count) || 0);
      
      // FIX v11.0.173: Count blocks from ORIGINAL HTML (not converted Notion blocks)
      // This shows true conversion accuracy: what's in ServiceNow HTML vs what's in Notion
      // Previous logic counted already-converted Notion blocks, which would always match unless upload failed
      log(`📊 [PATCH-STATS-COUNT] Counting blocks from original HTML (pre-conversion)`);
      
      const sourceCounts = {
        paragraphs: 0,
        headings: 0,
        tables: 0,
        images: 0,
        callouts: 0,
        code: 0,
        orderedList: 0,
        unorderedList: 0
      };
      
      // Count blocks directly from HTML structure
      try {
        const cheerio = require('cheerio');
        const $ = cheerio.load(html, { decodeEntities: false });
        
        log(`📊 [PATCH-HTML-SOURCE-DEBUG] HTML length: ${html.length} chars`);
        log(`📊 [PATCH-HTML-SOURCE-DEBUG] HTML preview: ${html.substring(0, 200)}`);
        
        // Count paragraphs (p tags that aren't empty)
        let pCount = 0;
        $('p').each((i, elem) => {
          const text = $(elem).text().trim();
          if (text.length > 0) {
            pCount++;
            sourceCounts.paragraphs++;
          }
        });
        log(`📊 [PATCH-HTML-SOURCE-DEBUG] Found ${pCount} non-empty <p> tags`);
        
        // Count headings (h2-h6 + span.title which become headings in Notion)
        // FIX v11.0.188: Exclude H1 (page title) and sidebar headings from comparison
        // H1 is always the page name/title and should not be duplicated in page content
        // Sidebars are navigation/metadata, not content
        let hCount = 0;
        $('h2, h3, h4, h5, h6, span.title').each((i, elem) => {
          const $elem = $(elem);
          // Skip if inside sidebar/navigation containers
          const inSidebar = $elem.closest('.zDocsSideBoxes, .contentPlaceholder, .miniTOC, aside, nav').length > 0;
          if (!inSidebar) {
            hCount++;
            sourceCounts.headings++;
          }
        });
        log(`📊 [PATCH-HTML-SOURCE-DEBUG] Found ${hCount} heading tags (h2-h6 + span.title, excluding H1 and sidebars)`);
        
        // Count tables
        const tableCount = $('table').length;
        sourceCounts.tables = tableCount;
        log(`📊 [PATCH-HTML-SOURCE-DEBUG] Found ${tableCount} <table> tags`);
        
        // Count images (img tags, excluding base64 data URIs and images inside tables)
        // FIX v11.0.184: Skip images in tables because Notion tables are incompatible with image handling
        let imgCount = 0;
        $('img').each((i, elem) => {
          const src = $(elem).attr('src') || '';
          const isInTable = $(elem).closest('table').length > 0;
          if (!src.startsWith('data:') && !isInTable) {
            imgCount++;
            sourceCounts.images++;
          }
        });
        log(`📊 [PATCH-HTML-SOURCE-DEBUG] Found ${imgCount} <img> tags (non-data URI, excluding images in tables)`);
        
        // Count callouts (note class, warning class, etc.)
        // FIX v11.0.180: Only count top-level callout containers (not nested titles/children)
        // FIX v11.0.86: Exclude callouts inside tables - Notion table cells can't contain callout blocks
        // Callouts in tables get converted to text/other types, not callout blocks
        let calloutCount = 0;
        $('div.note, div.warning, div.info, div.tip, div.caution, div.important').each((i, elem) => {
          const $elem = $(elem);
          // Skip if this callout is inside a table - it won't be rendered as a callout block
          const inTable = $elem.closest('table, thead, tbody, tr, td, th').length > 0;
          if (!inTable) {
            calloutCount++;
          }
        });
        sourceCounts.callouts = calloutCount;
        log(`📊 [PATCH-HTML-SOURCE-DEBUG] Found ${calloutCount} callout elements (top-level only)`);
        
        // Count code blocks (pre or code tags)
        const preCount = $('pre').length;
        sourceCounts.code = preCount;
        log(`📊 [PATCH-HTML-SOURCE-DEBUG] Found ${preCount} <pre> tags`);
        
        // Count ordered lists (ol > li)
        const olCount = $('ol > li').length;
        sourceCounts.orderedList = olCount;
        log(`📊 [PATCH-HTML-SOURCE-DEBUG] Found ${olCount} <ol><li> items`);
        
        // Count unordered lists (ul > li)
        const ulCount = $('ul > li').length;
        sourceCounts.unorderedList = ulCount;
        log(`📊 [PATCH-HTML-SOURCE-DEBUG] Found ${ulCount} <ul><li> items`);
        
        log(`📊 [PATCH-HTML-SOURCE-COUNTS] Paragraphs: ${sourceCounts.paragraphs}, Headings: ${sourceCounts.headings}, Tables: ${sourceCounts.tables}, Images: ${sourceCounts.images}, Callouts: ${sourceCounts.callouts}, Code: ${sourceCounts.code}, OL: ${sourceCounts.orderedList}, UL: ${sourceCounts.unorderedList}`);
      } catch (countError) {
        log(`⚠️ [PATCH-HTML-SOURCE-COUNTS] Error counting from HTML: ${countError.message}`);
        log(`⚠️ [PATCH-HTML-SOURCE-COUNTS] Stack trace: ${countError.stack}`);
        // Fall back to zero counts - comparison will show all as mismatches
      }
      
      // FIX v11.0.35: Fetch actual Notion block counts from the page (not from breakdown which may be missing)
      log(`📊 Fetching Notion blocks to calculate Stats...`);
      const notionCounts = {
        paragraphs: 0,
        headings: 0,
        tables: 0,
        images: 0,
        callouts: 0,
        code: 0,
        orderedList: 0,
        unorderedList: 0
      };
      
      try {
        allNotionBlocks = [];
        let cursor = undefined;
        
        do {
          const blockResponse = await notion.blocks.children.list({
            block_id: pageId,
            page_size: 100,
            ...(cursor ? { start_cursor: cursor } : {})
          });
          
          allNotionBlocks.push(...blockResponse.results);
          cursor = blockResponse.has_more ? blockResponse.next_cursor : undefined;
        } while (cursor);
        
        // Recursively count blocks in nested structures
        async function countNotionBlocksRecursive(blocks) {
          for (const block of blocks) {
            if (block.type === 'paragraph') notionCounts.paragraphs++;
            else if (block.type === 'heading_2' || block.type === 'heading_3') notionCounts.headings++; // Exclude heading_1 (page title) from heading count - v11.0.188
            else if (block.type === 'table') notionCounts.tables++;
            else if (block.type === 'image') notionCounts.images++;
            else if (block.type === 'callout') notionCounts.callouts++;
            else if (block.type === 'code') notionCounts.code++;
            else if (block.type === 'numbered_list_item') notionCounts.orderedList++;
            else if (block.type === 'bulleted_list_item') notionCounts.unorderedList++;
            
            // Recursively fetch and count children if block has them
            if (block.has_children) {
              try {
                let childCursor = undefined;
                do {
                  const childResponse = await notion.blocks.children.list({
                    block_id: block.id,
                    page_size: 100,
                    ...(childCursor ? { start_cursor: childCursor } : {})
                  });
                  await countNotionBlocksRecursive(childResponse.results);
                  childCursor = childResponse.has_more ? childResponse.next_cursor : undefined;
                } while (childCursor);
              } catch (childError) {
                log(`⚠️ Failed to fetch children for block ${block.id}: ${childError.message}`);
              }
            }
          }
        }
        
        await countNotionBlocksRecursive(allNotionBlocks);
        log(`   ✓ Notion counts: ${allNotionBlocks.length} total blocks`);
        
      } catch (countError) {
        log(`⚠️ Failed to fetch Notion blocks for Stats: ${countError.message}`);
        // Leave notionCounts at 0 - will show all mismatches
      }
      
      // FIX v11.0.116.1: Recalculate audit metrics based on actual Notion page content
      // The original auditResult uses text length from blocks that were supposed to be uploaded,
      // but the actual page content may differ due to deletion failures, eventual consistency, or deep nesting.
      // Recalculate using the same fetched block data used for ContentComparison.
      if (auditResult && allNotionBlocks) {
        try {
          // Extract actual text from all Notion blocks (same logic as servicenow.cjs)
          function extractAllTextFromBlock(block) {
            if (!block || typeof block !== 'object') return '';
            
            // FIX v11.0.160: Skip code blocks - not counted in text validation
            if (block.type === 'code') {
              return '';
            }
            
            let text = '';
            
            // Extract from rich text fields
            function extractFromRichText(richTextArray) {
              if (!Array.isArray(richTextArray)) return '';
              // FIX v11.0.180: Revert inline code parentheses (caused validation failures)
              return richTextArray.map(rt => rt.plain_text || '').join('');
            }
            
            // Extract based on block type (except code blocks)
            if (block.type === 'paragraph' && block.paragraph?.rich_text) {
              text += extractFromRichText(block.paragraph.rich_text);
            } else if (block.type.startsWith('heading_') && block[block.type]?.rich_text) {
              text += extractFromRichText(block[block.type].rich_text);
            } else if (block.type === 'bulleted_list_item' && block.bulleted_list_item?.rich_text) {
              text += extractFromRichText(block.bulleted_list_item.rich_text);
            } else if (block.type === 'numbered_list_item' && block.numbered_list_item?.rich_text) {
              text += extractFromRichText(block.numbered_list_item.rich_text);
            } else if (block.type === 'callout' && block.callout?.rich_text) {
              text += extractFromRichText(block.callout.rich_text);
            } else if (block.type === 'quote' && block.quote?.rich_text) {
              text += extractFromRichText(block.quote.rich_text);
            } else if (block.type === 'to_do' && block.to_do?.rich_text) {
              text += extractFromRichText(block.to_do.rich_text);
            }
            
            // Extract from table cells
            if (block.type === 'table_row' && block.table_row?.cells) {
              for (const cell of block.table_row.cells) {
                text += extractFromRichText(cell);
              }
            }
            
            // Recursively extract from children (for nested blocks)
            if (block.children && Array.isArray(block.children)) {
              for (const child of block.children) {
                text += extractAllTextFromBlock(child);
              }
            }
            
            // Extract from table children (table_row blocks)
            if (block.table?.children && Array.isArray(block.table.children)) {
              for (const child of block.table.children) {
                text += extractAllTextFromBlock(child);
              }
            }
            
            // Extract from list items with children
            if (block.bulleted_list_item?.children) {
              for (const child of block.bulleted_list_item.children) {
                text += extractAllTextFromBlock(child);
              }
            }
            if (block.numbered_list_item?.children) {
              for (const child of block.numbered_list_item.children) {
                text += extractAllTextFromBlock(child);
              }
            }
            
            return text;
          }
          
          const actualNotionTextLength = allNotionBlocks.reduce((sum, block) => {
            return sum + extractAllTextFromBlock(block).length;
          }, 0);
          
          // Update auditResult with actual page content metrics
          const originalNotionTextLength = auditResult.notionTextLength;
          auditResult.notionTextLength = actualNotionTextLength;
          auditResult.notionBlocks = allNotionBlocks.length;
          
          // Recalculate coverage and missing/extra based on actual content
          const coverageFloat = auditResult.totalLength > 0 
            ? (actualNotionTextLength / auditResult.totalLength * 100) 
            : 100;
          auditResult.coverage = coverageFloat.toFixed(1);
          auditResult.coverageStr = `${auditResult.coverage}%`;
          auditResult.missing = coverageFloat < 100 ? auditResult.totalLength - actualNotionTextLength : 0;
          auditResult.extra = coverageFloat > 100 ? actualNotionTextLength - auditResult.totalLength : 0;
          auditResult.missingPercent = auditResult.totalLength > 0 ? ((auditResult.missing / auditResult.totalLength) * 100).toFixed(1) : '0.0';
          auditResult.extraPercent = auditResult.totalLength > 0 ? ((auditResult.extra / auditResult.totalLength) * 100).toFixed(1) : '0.0';
          
          // Update pass/fail status
          const minThreshold = auditResult.threshold ? parseFloat(auditResult.threshold.split('-')[0]) : 95;
          const maxThreshold = auditResult.threshold ? parseFloat(auditResult.threshold.split('-')[1]) : 105;
          auditResult.passed = coverageFloat >= minThreshold && coverageFloat <= maxThreshold;
          
          log(`🔧 [AUDIT-RECALCULATION] Updated audit metrics with actual Notion content:`);
          log(`   Original notionTextLength: ${originalNotionTextLength} chars`);
          log(`   Actual notionTextLength: ${actualNotionTextLength} chars`);
          log(`   Updated coverage: ${auditResult.coverageStr} (was based on ${originalNotionTextLength})`);
          log(`   Updated missing: ${auditResult.missing} chars (${auditResult.missingPercent}%)`);
          
          // FIX v11.0.159: Recalculate detailed comparison using actual Notion content
          // Compare the original HTML against the fetched Notion blocks to get real missing/extra segments
          log(`🔧 [AUDIT-RECALCULATION] Recalculating detailed comparison with actual Notion content...`);
          
          try {
            // Import the function to do detailed comparison
            const servicenowService = require('../services/servicenow.cjs');
            
            // Convert fetched Notion blocks back to a format we can compare
            // FIX v11.0.159: Exclude buttons from validation
            // FIX v11.0.160: Exclude code blocks from validation
            // FIX v11.0.172: Exclude "On this page" navigation sections
            const cheerio = require('cheerio');
            const $ = cheerio.load(html, { decodeEntities: false });
            
            // Remove button elements and code blocks from HTML before extracting text
            // FIX v11.0.180: Revert inline code parentheses (caused validation failures)
            $('button').remove();
            $('.btn, .button, [role="button"]').remove(); // Also remove common button classes
            $('pre, code').remove(); // Code not counted in text validation
            
            // FIX v11.0.172: Remove "On this page" navigation sections (same as audit preprocessing)
            $('.miniTOC, .zDocsSideBoxes').remove();
            $('.contentPlaceholder').each((i, elem) => {
              const $elem = $(elem);
              const hasMiniToc = $elem.find('.zDocsMiniTocCollapseButton, .zDocsSideBoxes, .contentContainer').length > 0;
              if (hasMiniToc) {
                $elem.remove();
              }
            });
            
            // FIX v11.0.172: Remove figure captions and labels (images handle their own captions)
            $('figcaption, .figcap, .fig-title, .figure-title').remove();
            // Remove standalone "Figure X" text patterns that are separate from actual content
            $('p, div, span').each((i, elem) => {
              const $elem = $(elem);
              const text = $elem.text().trim();
              // Match patterns like "Figure 1.", "Figure 2", "Fig. 1:", etc.
              if (/^fig(?:ure)?\s*\d+\.?\:?$/i.test(text)) {
                $elem.remove();
              }
            });
            
            // FIX v11.0.172: Improved whitespace handling to prevent word concatenation
            // Add space BEFORE and AFTER block elements to ensure separation
            $('p, div, li, td, th, h1, h2, h3, h4, h5, h6').each((i, elem) => {
              const $elem = $(elem);
              // Add space before element content and after element content
              const content = $elem.html();
              if (content && content.trim()) {
                $elem.html(' ' + content + ' ');
              }
            });
            // Handle br tags specially
            $('br').replaceWith(' ');
            
            const htmlText = $.text()
              .replace(/\s+/g, ' ')          // Collapse multiple spaces
              .trim();
            const notionText = allNotionBlocks.map(block => extractAllTextFromBlock(block)).join(' ').trim();
            
            // FIX v11.0.172: Calculate LCS similarity as confidence metric
            function lcsLength(str1, str2) {
              const m = str1.length;
              const n = str2.length;
              const dp = Array(m + 1).fill(null).map(() => Array(n + 1).fill(0));
              
              for (let i = 1; i <= m; i++) {
                for (let j = 1; j <= n; j++) {
                  if (str1[i - 1] === str2[j - 1]) {
                    dp[i][j] = dp[i - 1][j - 1] + 1;
                  } else {
                    dp[i][j] = Math.max(dp[i - 1][j], dp[i][j - 1]);
                  }
                }
              }
              return dp[m][n];
            }
            
            const lcs = lcsLength(htmlText, notionText);
            const lcsSimilarity = (lcs / Math.max(htmlText.length, notionText.length) * 100).toFixed(1);
            
            log(`🔧 [AUDIT-RECALCULATION] HTML text length (excluding buttons & code): ${htmlText.length}, Notion text length: ${notionText.length}`);
            log(`🔧 [AUDIT-RECALCULATION] LCS similarity: ${lcsSimilarity}% (${lcs} matching chars)`);
            log(`🔧 [AUDIT-RECALCULATION] actualNotionTextLength (from auditResult): ${actualNotionTextLength}`);
            log(`🔧 [AUDIT-RECALCULATION] HTML text preview: ${htmlText.substring(0, 300)}...`);
            log(`🔧 [AUDIT-RECALCULATION] Notion text preview: ${notionText.substring(0, 300)}...`);
            
            // Debug: Show last 100 chars to see the difference
            log(`🔧 [AUDIT-RECALCULATION] HTML text END: ...${htmlText.substring(htmlText.length - 100)}`);
            log(`🔧 [AUDIT-RECALCULATION] Notion text END: ...${notionText.substring(notionText.length - 100)}`);
            
            // FIX v11.0.160: Update auditResult.totalLength and notionTextLength to match filtered text (without code blocks)
            // This ensures missing/extra calculations are based on the same content scope
            const filteredHtmlLength = htmlText.length;
            const filteredNotionLength = notionText.length;
            
            if (auditResult.totalLength !== filteredHtmlLength || auditResult.notionTextLength !== filteredNotionLength) {
              log(`🔧 [AUDIT-RECALCULATION] Updating totalLength from ${auditResult.totalLength} to ${filteredHtmlLength} (code blocks excluded)`);
              log(`🔧 [AUDIT-RECALCULATION] Updating notionTextLength from ${auditResult.notionTextLength} to ${filteredNotionLength} (using extracted text with spaces)`);
              auditResult.totalLength = filteredHtmlLength;
              auditResult.notionTextLength = filteredNotionLength;
              
              // Recalculate coverage with corrected lengths
              const newCoverageFloat = auditResult.totalLength > 0 
                ? (auditResult.notionTextLength / auditResult.totalLength * 100) 
                : 100;
              auditResult.coverage = newCoverageFloat.toFixed(1);
              auditResult.coverageStr = `${auditResult.coverage}%`;
              auditResult.missing = newCoverageFloat < 100 ? auditResult.totalLength - auditResult.notionTextLength : 0;
              auditResult.extra = newCoverageFloat > 100 ? auditResult.notionTextLength - auditResult.totalLength : 0;
              auditResult.missingPercent = auditResult.totalLength > 0 ? ((auditResult.missing / auditResult.totalLength) * 100).toFixed(1) : '0.0';
              auditResult.extraPercent = auditResult.totalLength > 0 ? ((auditResult.extra / auditResult.totalLength) * 100).toFixed(1) : '0.0';
              
              // FIX v11.0.160: Update pass/fail status based on recalculated coverage
              const minThreshold = auditResult.threshold ? parseFloat(auditResult.threshold.split('-')[0]) : 95;
              const maxThreshold = auditResult.threshold ? parseFloat(auditResult.threshold.split('-')[1]) : 105;
              auditResult.passed = newCoverageFloat >= minThreshold && newCoverageFloat <= maxThreshold;
              
              log(`🔧 [AUDIT-RECALCULATION] Recalculated: Coverage ${auditResult.coverageStr}, Missing ${auditResult.missing}, Extra ${auditResult.extra}`);
              log(`🔧 [AUDIT-RECALCULATION] Updated pass/fail: ${auditResult.passed ? 'PASS' : 'FAIL'} (threshold: ${minThreshold}-${maxThreshold}%)`);
            }
            
            // Create a simple detailed comparison
            auditResult.detailedComparison = {
              missingSegments: [],
              extraSegments: [],
              htmlSegmentCount: 1,
              notionSegmentCount: 1
            };
            
            // If there's missing content, identify and show the full missing text
            // FIX v11.0.160: Only report missing segments if difference is significant (>5 chars or >0.5%)
            if (auditResult.missing > 0 && (auditResult.missing > 5 || parseFloat(auditResult.missingPercent) > 0.5)) {
              // FIX v11.0.172: Improved algorithm using phrase matching (4-word sliding window)
              // instead of individual word lookup to reduce false positives
              
              // Normalize both texts for comparison
              const normalizeForComparison = (text) => {
                return text.toLowerCase()
                  .replace(/\s+/g, ' ')  // Normalize whitespace
                  .replace(/[""'']/g, '"')  // Normalize quotes
                  .replace(/[–—]/g, '-')  // Normalize dashes
                  .replace(/[()]/g, '')  // FIX v11.0.184: Remove parentheses (inline code comparison)
                  .trim();
              };
              
              const normalizedHtml = normalizeForComparison(htmlText);
              const normalizedNotion = normalizeForComparison(notionText);
              
              const htmlWords = htmlText.split(/\s+/).filter(w => w.length > 0);
              
              // Find sequences of words in HTML that are NOT in Notion using phrase matching
              const missingSequences = [];
              let currentSequence = [];
              const phraseLength = 4; // Use 4-word phrases for matching
              
              for (let i = 0; i < htmlWords.length; i++) {
                // Build a phrase starting at this position
                const phraseWords = [];
                for (let j = i; j < Math.min(i + phraseLength, htmlWords.length); j++) {
                  phraseWords.push(htmlWords[j]);
                }
                const phrase = normalizeForComparison(phraseWords.join(' '));
                
                // Check if this phrase exists in Notion
                const phraseExists = normalizedNotion.includes(phrase);
                
                if (!phraseExists) {
                  // Phrase not found in Notion, add current word to sequence
                  currentSequence.push(htmlWords[i]);
                } else {
                  // Phrase found in Notion, save current sequence if it exists and is substantial
                  if (currentSequence.length > 0) {
                    const sequenceText = currentSequence.join(' ');
                    // Only include sequences longer than 10 chars to avoid noise
                    if (sequenceText.length > 10) {
                      missingSequences.push(sequenceText);
                    }
                    currentSequence = [];
                  }
                }
              }
              
              // Add final sequence if exists and is substantial
              if (currentSequence.length > 0) {
                const sequenceText = currentSequence.join(' ');
                if (sequenceText.length > 10) {
                  missingSequences.push(sequenceText);
                }
              }
              
              // Add each missing sequence as a segment
              if (missingSequences.length > 0) {
                missingSequences.forEach((seq, idx) => {
                  // Truncate very long sequences to fit in property (max 500 chars per segment)
                  let segmentText = seq;
                  if (seq.length > 500) {
                    segmentText = seq.substring(0, 497) + '...';
                  }
                  
                  auditResult.detailedComparison.missingSegments.push({
                    text: segmentText,
                    context: 'html',
                    length: seq.length
                  });
                });
                
                log(`🔧 [AUDIT-RECALCULATION] Found ${missingSequences.length} missing text sequences`);
              } else {
                // Fallback: if no specific sequences found, show character count
                auditResult.detailedComparison.missingSegments.push({
                  text: `Content missing from Notion page (${auditResult.missing} characters, ${auditResult.missingPercent}%)`,
                  context: 'recalculated'
                });
              }
            } else if (auditResult.missing > 0) {
              // Minor difference (≤5 chars or ≤0.5%), don't report specific segments
              log(`🔧 [AUDIT-RECALCULATION] Minor missing content (${auditResult.missing} chars) - not listing specific segments`);
            }
            
            // If there's extra content, identify and show the full extra text
            // FIX v11.0.160: Only report extra segments if difference is significant (>5 chars or >0.5%)
            if (auditResult.extra > 0 && (auditResult.extra > 5 || parseFloat(auditResult.extraPercent) > 0.5)) {
              // FIX v11.0.172: Improved algorithm using phrase matching (4-word sliding window)
              // instead of individual word lookup to reduce false positives
              
              // Re-use normalize function (already defined above for missing text)
              const normalizeForComparison = (text) => {
                return text.toLowerCase()
                  .replace(/\s+/g, ' ')  // Normalize whitespace
                  .replace(/[""'']/g, '"')  // Normalize quotes
                  .replace(/[–—]/g, '-')  // Normalize dashes
                  .replace(/[()]/g, '')  // FIX v11.0.184: Remove parentheses (inline code comparison)
                  .trim();
              };
              
              const normalizedHtml = normalizeForComparison(htmlText);
              const normalizedNotion = normalizeForComparison(notionText);
              
              const notionWords = notionText.split(/\s+/).filter(w => w.length > 0);
              
              // Find sequences of words in Notion that are NOT in HTML using phrase matching
              const extraSequences = [];
              let currentSequence = [];
              const phraseLength = 4; // Use 4-word phrases for matching
              
              for (let i = 0; i < notionWords.length; i++) {
                // Build a phrase starting at this position
                const phraseWords = [];
                for (let j = i; j < Math.min(i + phraseLength, notionWords.length); j++) {
                  phraseWords.push(notionWords[j]);
                }
                const phrase = normalizeForComparison(phraseWords.join(' '));
                
                // Check if this phrase exists in HTML
                const phraseExists = normalizedHtml.includes(phrase);
                
                if (!phraseExists) {
                  // Phrase not found in HTML, add current word to sequence
                  currentSequence.push(notionWords[i]);
                } else {
                  // Phrase found in HTML, save current sequence if it exists and is substantial
                  if (currentSequence.length > 0) {
                    const sequenceText = currentSequence.join(' ');
                    // Only include sequences longer than 10 chars to avoid noise
                    if (sequenceText.length > 10) {
                      extraSequences.push(sequenceText);
                    }
                    currentSequence = [];
                  }
                }
              }
              
              // Add final sequence if exists and is substantial
              if (currentSequence.length > 0) {
                const sequenceText = currentSequence.join(' ');
                if (sequenceText.length > 10) {
                  extraSequences.push(sequenceText);
                }
              }
              
              // Add each extra sequence as a segment
              if (extraSequences.length > 0) {
                extraSequences.forEach((seq, idx) => {
                  // Truncate very long sequences to fit in property (max 500 chars per segment)
                  let segmentText = seq;
                  if (seq.length > 500) {
                    segmentText = seq.substring(0, 497) + '...';
                  }
                  
                  auditResult.detailedComparison.extraSegments.push({
                    text: segmentText,
                    context: 'notion',
                    length: seq.length
                  });
                });
                
                log(`🔧 [AUDIT-RECALCULATION] Found ${extraSequences.length} extra text sequences`);
              } else {
                // Fallback: if no specific sequences found, show character count
                auditResult.detailedComparison.extraSegments.push({
                  text: `Extra content in Notion page (${auditResult.extra} characters, ${auditResult.extraPercent}%)`,
                  context: 'recalculated'
                });
              }
            } else if (auditResult.extra > 0) {
              // Minor difference (≤5 chars or ≤0.5%), don't report specific segments
              log(`🔧 [AUDIT-RECALCULATION] Minor extra content (${auditResult.extra} chars) - not listing specific segments`);
            }
            
            log(`🔧 [AUDIT-RECALCULATION] Updated detailed comparison: ${auditResult.detailedComparison.missingSegments.length} missing, ${auditResult.detailedComparison.extraSegments.length} extra segments`);
            
          } catch (comparisonError) {
            log(`⚠️ [AUDIT-RECALCULATION] Failed to recalculate detailed comparison: ${comparisonError.message}`);
            // Keep original detailedComparison if recalculation fails
          }
          
          // FIX v11.0.159: Rebuild Audit property with recalculated metrics
          // The Audit property was already set earlier with stale values, so we need to update it
          log(`🔧 [AUDIT-RECALCULATION] Rebuilding Audit property with recalculated metrics...`);
          
          const recalculatedAuditLines = [
            `[${new Date().toISOString().split('T')[0]}] Content Audit: ${auditResult.passed ? '✅ PASS' : '❌ FAIL'}`,
            `Coverage: ${auditResult.coverageStr} (threshold: ${auditResult.threshold})`,
            `Threshold reason: ${auditResult.thresholdReason}`,
            `Source: ${auditResult.totalNodes} text nodes, ${auditResult.totalLength} chars`,
            `Notion: ${auditResult.notionBlocks} blocks, ${auditResult.notionTextLength} chars`,
            `Block/Node Ratio: ${(auditResult.notionBlocks / Math.max(auditResult.totalNodes, 1)).toFixed(2)}x`
          ];
          
          // Add content analysis summary
          if (auditResult.contentAnalysis) {
            const analysis = [];
            if (auditResult.contentAnalysis.nestedListDepth > 1) {
              analysis.push(`${auditResult.contentAnalysis.nestedListDepth}x nested list`);
            }
            if (auditResult.contentAnalysis.tableCount > 0) {
              analysis.push(`${auditResult.contentAnalysis.tableCount} table${auditResult.contentAnalysis.tableCount > 1 ? 's' : ''}`);
            }
            if (auditResult.contentAnalysis.calloutCount > 0) {
              analysis.push(`${auditResult.contentAnalysis.calloutCount} callout${auditResult.contentAnalysis.calloutCount > 1 ? 's' : ''}`);
            }
            if (analysis.length > 0) {
              recalculatedAuditLines.push(`Content: ${analysis.join(', ')}`);
            }
          }
          
          // Add missing/extra info
          if (auditResult.missing > 0) {
            recalculatedAuditLines.push(`⚠️ Missing: ${auditResult.missing} chars (${auditResult.missingPercent}%)`);
          }
          if (auditResult.extra > 0) {
            recalculatedAuditLines.push(`⚠️ Extra: ${auditResult.extra} chars (+${auditResult.extraPercent}%)`);
          }
          
          const recalculatedAuditContent = recalculatedAuditLines.join('\n');
          
          // Update the Audit property with recalculated values
          propertyUpdates["Audit"] = {
            rich_text: [ { type: 'text', text: { content: recalculatedAuditContent } } ]
          };
          
          log(`🔧 [AUDIT-RECALCULATION] Updated Audit property: Coverage ${auditResult.coverageStr}, Missing ${auditResult.missing} chars`);
          
          // FIX v11.0.161: Removed MissingText and ExtraText property recalculation
          // These properties are now redundant with comprehensive Audit property
          
        } catch (recalcError) {
          log(`⚠️ [AUDIT-RECALCULATION] Failed to recalculate audit metrics: ${recalcError.message}`);
          // Continue with original auditResult
        }
      }
      
      // Use calculated source and Notion counts
      // FIX v11.0.186: Three-tier ContentComparison logic based on element types
      // ❌ FAIL if mismatch in: Headings, Code blocks, Tables, Images, Callouts (critical elements)
      // ⚠️ PASS if mismatch in: Ordered lists, Unordered lists, Paragraphs (flexible elements)
      // ✅ PASS if all elements match
      const hasHtmlContent = Object.values(sourceCounts).some(count => count > 0);
      
      // Critical elements - strict matching required
      const tablesMatch = (sourceCounts.tables === notionCounts.tables);
      const imagesMatch = (sourceCounts.images === notionCounts.images);
      const calloutsMatch = (sourceCounts.callouts === notionCounts.callouts);
      const headingsMatch = (sourceCounts.headings === notionCounts.headings);
      const codeMatch = (sourceCounts.code === notionCounts.code);
      
      // Flexible elements - may vary due to HTML structure differences
      const orderedListMatch = (sourceCounts.orderedList === notionCounts.orderedList);
      const unorderedListMatch = (sourceCounts.unorderedList === notionCounts.unorderedList);
      const paragraphsMatch = (sourceCounts.paragraphs === notionCounts.paragraphs);
      
      // Determine comparison status (v11.0.186)
      const criticalMismatch = !tablesMatch || !imagesMatch || !calloutsMatch || 
                               !headingsMatch || !codeMatch;
      const flexibleMismatch = !orderedListMatch || !unorderedListMatch || !paragraphsMatch;
      
      let countsPass;
      let countsIcon;
      let comparisonStatus;
      
      if (criticalMismatch) {
        // FAIL - critical elements don't match
        countsPass = false;
        countsIcon = '❌';
        comparisonStatus = 'FAIL';
      } else if (flexibleMismatch) {
        // PASS with warning - flexible elements may differ, but critical ones match
        countsPass = true;
        countsIcon = '⚠️';
        comparisonStatus = 'PASS';
      } else {
        // PASS - all elements match
        countsPass = true;
        countsIcon = '✅';
        comparisonStatus = 'PASS';
      }
      
      const statsHeader = `${countsIcon}  Content Comparison: ${comparisonStatus}`;
      const statsLines = [
        statsHeader,
        '📊 (Source → Notion):',
        `• Ordered list items: ${sourceCounts.orderedList} → ${notionCounts.orderedList}`,
        `• Unordered list items: ${sourceCounts.unorderedList} → ${notionCounts.unorderedList}`,
        `• Paragraphs: ${sourceCounts.paragraphs} → ${notionCounts.paragraphs}`,
        `• Headings: ${sourceCounts.headings} → ${notionCounts.headings}`,
        `• Code blocks: ${sourceCounts.code} → ${notionCounts.code}`,
        `• Tables: ${sourceCounts.tables} → ${notionCounts.tables}`,
        `• Images: ${sourceCounts.images} → ${notionCounts.images}`,
        `• Callouts: ${sourceCounts.callouts} → ${notionCounts.callouts}`,
      ];
      const statsContent = statsLines.join('\n');
      
      // Truncate to fit Notion's 2000 character limit for rich text properties
      let truncatedStatsContent = statsContent;
      if (statsContent.length > 2000) {
        truncatedStatsContent = statsContent.substring(0, 1997) + '...';
        log(`⚠️ [PATCH-PROPERTY-TRUNCATE] ContentComparison property truncated to 2000 chars (was ${statsContent.length})`);
      }
      
      propertyUpdates["ContentComparison"] = {
        rich_text: [ { type: 'text', text: { content: truncatedStatsContent } } ]
      };
      log(`📊 Setting ContentComparison property with refined comparison breakdown (PATCH)`);
      log(`   Stats content length: ${truncatedStatsContent.length} chars`);
      log(`   Stats content preview: ${truncatedStatsContent.substring(0, 100)}...`);
      
      // FIX v11.0.187: Mark pages with critical failures for auto-save
      // Trigger auto-save if ContentComparison = FAIL or Audit = FAIL
      const hasContentComparisonFail = countsPass === false;
      const hasAuditFail = auditResult && auditResult.passed === false;
      const shouldAutoSaveForFailure = hasContentComparisonFail || hasAuditFail;
      
      if (shouldAutoSaveForFailure) {
        log(`🚩 [v11.0.187-PATCH] Critical failure detected:`);
        if (hasContentComparisonFail) log(`   • ContentComparison: ❌ FAIL (critical element mismatch)`);
        if (hasAuditFail) log(`   • Content Audit: ❌ FAIL`);
        log(`   → Page will be auto-saved to pages-to-update after PATCH`);
      }
      
      // Set Image checkbox if page contains images
      if (sourceCounts.images > 0) {
        propertyUpdates["Image"] = { checkbox: true };
        log(`🖼️ Setting Image checkbox (${sourceCounts.images} image${sourceCounts.images === 1 ? '' : 's'} detected in PATCH)`);
      }
      
      // FIX v11.0.115: Check which property names exist (backward compatibility for Validation→Audit rename)
      let auditPropertyName = "Audit";
      let comparisonPropertyName = "ContentComparison";
      
      try {
        const pageInfo = await notion.pages.retrieve({ page_id: pageId });
        const existingProps = Object.keys(pageInfo.properties);
        
        // FIX v11.0.172: Log all existing properties for debugging
        log(`📋 [PROPERTY-CHECK] Page has ${existingProps.length} properties: ${existingProps.join(', ')}`);
        
        // Check if old property names exist and new ones don't
        const hasOldAudit = existingProps.includes("Validation");
        const hasNewAudit = existingProps.includes("Audit");
        const hasContentComparison = existingProps.includes("ContentComparison");
        
        log(`📋 [PROPERTY-CHECK] Audit: hasOld=${hasOldAudit}, hasNew=${hasNewAudit}`);
        log(`📋 [PROPERTY-CHECK] ContentComparison: exists=${hasContentComparison}`);
        
        if (hasOldAudit && !hasNewAudit) {
          auditPropertyName = "Validation";
          log(`🔄 Using legacy property name: "Validation" (new name "Audit" not found)`);
        }
        
        // Rename property keys if using legacy names
        if (auditPropertyName === "Validation" && propertyUpdates["Audit"]) {
          propertyUpdates["Validation"] = propertyUpdates["Audit"];
          delete propertyUpdates["Audit"];
        }
        
        // FIX v11.0.172: If ContentComparison property doesn't exist, don't send it
        if (!hasContentComparison && propertyUpdates["ContentComparison"]) {
          log(`⚠️ ContentComparison property not found in database, skipping update`);
          delete propertyUpdates["ContentComparison"];
        }
        
        // FIX v11.0.172: If neither old nor new Audit property exists, don't send it
        if (!hasOldAudit && !hasNewAudit && propertyUpdates["Audit"]) {
          log(`⚠️ Audit property not found in database (neither "Validation" nor "Audit"), skipping Audit update`);
          delete propertyUpdates["Audit"];
        }
        
        log(`📝 Property names resolved: Audit="${auditPropertyName}", ContentComparison="${comparisonPropertyName}"`);
        
      } catch (propCheckError) {
        log(`⚠️ Could not check existing properties (using new names): ${propCheckError.message}`);
        // Continue with new property names
      }
      
      // FIX v11.0.116: Add property update retry logic to PATCH (matching POST endpoint)
      // POST has 5 retries with exponential backoff, PATCH had ZERO retries (silent failures)
      
      for (let propRetry = 0; propRetry <= maxPropertyRetries && !propertyUpdateSuccess; propRetry++) {
        try {
          // Update the page properties with retries
          log(`📝 [PATCH-PROPERTY-RETRY] Attempt ${propRetry + 1}/${maxPropertyRetries + 1}: Updating page with properties: ${Object.keys(propertyUpdates).join(', ')}`);
          log(`   propertyUpdates keys: ${JSON.stringify(Object.keys(propertyUpdates))}`);
          log(`   propertyUpdates content preview: ${JSON.stringify(propertyUpdates).substring(0, 500)}...`);
          
          const updateResult = await notion.pages.update({
            page_id: pageId,
            properties: propertyUpdates
          });
          
          log(`   Notion API response: ${JSON.stringify(updateResult).substring(0, 200)}...`);
          
          propertyUpdateSuccess = true;
          log(`✅ [PATCH-PROPERTY-RETRY] Validation properties updated successfully${propRetry > 0 ? ` (after ${propRetry} retry)` : ''} (used "${auditPropertyName}" and "${comparisonPropertyName}")`);
          
        } catch (propUpdateError) {
          propertyUpdateError = propUpdateError;
          
          const isLastRetry = propRetry >= maxPropertyRetries;
          const waitTime = Math.min(Math.pow(2, propRetry), 32) * 1000; // 1s, 2s, 4s, 8s, 16s, 32s
          
          if (isLastRetry) {
            // All retries exhausted
            log(`\n${'='.repeat(80)}`);
            log(`❌ [PATCH-PROPERTY-RETRY] CRITICAL: Property update failed after ${maxPropertyRetries + 1} attempts`);
            log(`   Error: ${propUpdateError.message}`);
            log(`   Page ID: ${pageId}`);
            log(`   Page Title: ${pageTitle}`);
            log(`   Note: Content WAS updated (${extractedBlocks.length} blocks), but properties NOT set`);
            log(`   Auto-saving to pages-to-update for re-extraction...`);
            log(`${'='.repeat(80)}\n`);
            
            // Auto-save page for re-extraction
            try {
              const fixturesDir = path.join(__dirname, '../../patch/pages/pages-to-update');
              if (!fs.existsSync(fixturesDir)) {
                fs.mkdirSync(fixturesDir, { recursive: true });
              }
              
              const timestamp = new Date().toISOString().replace(/:/g, '-').replace(/\..+/, '');
              const sanitizedTitle = (pageTitle || 'untitled')
                .toLowerCase()
                .replace(/[^a-z0-9]+/g, '-')
                .replace(/^-+|-+$/g, '')
                .substring(0, 60);
              const filename = `${sanitizedTitle}-property-update-failed-${timestamp}.html`;
              const filepath = path.join(fixturesDir, filename);
              
              const htmlContent = `<!--
Auto-saved: Property update failed after ${maxPropertyRetries + 1} retry attempts
Page ID: ${pageId}
Page Title: ${pageTitle}
PATCH Time: ${new Date().toISOString()}
Content Updated: YES (${extractedBlocks.length} blocks uploaded successfully)
Properties Updated: NO (property update API failed after ${maxPropertyRetries + 1} retries)

Error Details:
${propUpdateError.message}

Last Error:
${propUpdateError.stack ? propUpdateError.stack.substring(0, 500) : 'N/A'}

Action Required: Retry PATCH operation - content is correct but properties need to be set
-->

${html || ''}
`;
              
              fs.writeFileSync(filepath, htmlContent, 'utf-8');
              log(`✅ [PATCH-PROPERTY-RETRY] Auto-saved: ${filename}`);
            } catch (saveError) {
              log(`❌ [PATCH-PROPERTY-RETRY] Failed to auto-save: ${saveError.message}`);
            }
            
            break; // Exit retry loop
          } else {
            // Retry with exponential backoff
            log(`⚠️ [PATCH-PROPERTY-RETRY] Attempt ${propRetry + 1} failed, will retry after ${waitTime}ms`);
            log(`   Error: ${propUpdateError.message}`);
            await new Promise(resolve => setTimeout(resolve, waitTime));
          }
        }
      }
      
      // Auto-save pages with order issues for investigation (PATCH)
      if (Array.isArray(validationResult.orderIssues) && validationResult.orderIssues.length > 0) {
        try {
          log(`📋 Order issues detected (${validationResult.orderIssues.length}) - auto-saving PATCH for investigation...`);
          const fs = require('fs');
          const path = require('path');
          
          const orderIssuesDir = path.join(__dirname, '../../patch/pages/validation-order-issues');
          if (!fs.existsSync(orderIssuesDir)) {
            fs.mkdirSync(orderIssuesDir, { recursive: true });
          }
          
          const timestamp = new Date().toISOString().replace(/:/g, '-').replace(/\..+/, '');
          const sanitizedTitle = (pageTitle || 'untitled')
            .toLowerCase()
            .replace(/[^a-z0-9]+/g, '-')
            .replace(/^-+|-+$/g, '')
            .substring(0, 60);
          const filename = `${sanitizedTitle}-patch-order-issues-${timestamp}.html`;
          const filepath = path.join(orderIssuesDir, filename);
          
          const htmlContent = `<!--
Auto-saved: Order issues detected in PATCH content validation
Page ID: ${pageId}
Page Title: ${pageTitle}
PATCH Completed: ${new Date().toISOString()}
Source URL: ${payload.url || 'N/A'}

Order Issues Detected: ${validationResult.orderIssues.length}
Similarity: ${validationResult.similarity}%

Order Issues:
${JSON.stringify(validationResult.orderIssues, null, 2)}

Missing Segments: ${validationResult.missing?.length || 0}
${validationResult.missing?.length > 0 ? '\nMissing:\n' + JSON.stringify(validationResult.missing.slice(0, 5), null, 2) : ''}

Full Validation Result:
${JSON.stringify(validationResult, null, 2)}

Action Required: Investigate why content order differs between HTML source and Notion output (PATCH)
-->

${html || ''}
`;
          
          fs.writeFileSync(filepath, htmlContent, 'utf-8');
          log(`✅ AUTO-SAVED (PATCH): ${filename}`);
          log(`   Location: ${filepath}`);
          log(`   Order issues: ${validationResult.orderIssues.length}`);
        } catch (saveError) {
          log(`❌ Failed to auto-save PATCH with order issues: ${saveError.message}`);
        }
      }
      
    } catch (propError) {
      log(`⚠️ Failed to build validation properties: ${propError.message}`);
      // Don't throw - page was updated successfully, just property update failed
      propertyUpdateSuccess = false;
    }
    
    // FIX v11.0.31: FINAL CATCH-ALL for PATCH - Verify Audit property was actually set
    // FIX v11.0.115: Check both "Audit" and "Validation" property names (backward compatibility)
    try {
      log(`🔍 [FINAL-CHECK-PATCH] Verifying Audit property was set...`);
      await new Promise(resolve => setTimeout(resolve, 1000)); // Wait for Notion consistency
      
      const finalPageCheck = await notion.pages.retrieve({ page_id: pageId });
      
      // Check both new and old property names
      const finalAuditProp = finalPageCheck.properties.Audit || finalPageCheck.properties.Validation;
      const propertyNameUsed = finalPageCheck.properties.Audit ? "Audit" : (finalPageCheck.properties.Validation ? "Validation" : "unknown");
      
      const isFinallyBlank = !finalAuditProp || 
                             !finalAuditProp.rich_text || 
                             finalAuditProp.rich_text.length === 0 ||
                             (finalAuditProp.rich_text.length === 1 && 
                              (!finalAuditProp.rich_text[0].text || 
                               !finalAuditProp.rich_text[0].text.content ||
                               finalAuditProp.rich_text[0].text.content.trim() === ''));
      
      if (isFinallyBlank) {
        log(`❌ [FINAL-CHECK-PATCH] CRITICAL: ${propertyNameUsed} property is BLANK after PATCH!`);
        log(`   Auto-saving page for re-extraction...`);
        
        try {
          const fixturesDir = path.join(__dirname, '../../patch/pages/pages-to-update');
          if (!fs.existsSync(fixturesDir)) {
            fs.mkdirSync(fixturesDir, { recursive: true });
          }
          
          const timestamp = new Date().toISOString().replace(/:/g, '-').replace(/\..+/, '');
          const sanitizedTitle = (pageTitle || 'untitled')
            .toLowerCase()
            .replace(/[^a-z0-9]+/g, '-')
            .replace(/^-+|-+$/g, '')
            .substring(0, 60);
          const filename = `${sanitizedTitle}-blank-validation-patch-${timestamp}.html`;
          const filepath = path.join(fixturesDir, filename);
          
          const htmlContent = `<!--
[FINAL-CHECK-PATCH] Auto-saved: Audit property is BLANK after PATCH operation
Page ID: ${pageId}
Page Title: ${pageTitle}
PATCH Completed: ${new Date().toISOString()}
Source URL: ${payload.url || 'N/A'}

Diagnosis: Audit property update failed during PATCH
Retrieved Audit Property:
${JSON.stringify(finalAuditProp, null, 2)}

Action Required: Re-PATCH this page with validation enabled
-->

${html || ''}
`;
          
          fs.writeFileSync(filepath, htmlContent, 'utf-8');
          log(`✅ [FINAL-CHECK-PATCH] AUTO-SAVED: ${filename}`);
          
          log(`\n${'='.repeat(80)}`);
          log(`⚠️⚠️⚠️ [FINAL-CHECK-PATCH] Page auto-saved to pages-to-update folder`);
          log(`   Page ID: ${pageId}`);
          log(`   Title: ${pageTitle}`);
          log(`   Reason: Audit property is BLANK after PATCH`);
          log(`${'='.repeat(80)}\n`);
        } catch (saveError) {
          log(`❌ [FINAL-CHECK-PATCH] Failed to auto-save: ${saveError.message}`);
        }
      } else {
        log(`✅ [FINAL-CHECK-PATCH] ${propertyNameUsed} property confirmed present`);
      }
    } catch (finalCheckError) {
      log(`⚠️ [FINAL-CHECK-PATCH] Failed to verify audit property (non-fatal): ${finalCheckError.message}`);
    }
    
    // Success response
    cleanup(); // Stop heartbeat
    
    // FIX v11.0.116: Don't return "success" if property update failed
    // This ensures batch script detects the failure and re-queues the page
    if (!propertyUpdateSuccess) {
      log(`\n${'='.repeat(80)}`);
      log(`❌ [PATCH-PROPERTY-RETRY] Cannot return success - property update failed`);
      log(`   Page content WAS updated successfully (${extractedBlocks.length} blocks)`);
      log(`   But validation properties could NOT be set after ${maxPropertyRetries + 1} attempts`);
      log(`   Error: ${propertyUpdateError?.message || 'Unknown error'}`);
      log(`   Page has been auto-saved to pages-to-update for re-extraction`);
      log(`${'='.repeat(80)}\n`);
      
      cleanup();
      return sendError(res, "PROPERTY_UPDATE_FAILED",
        `Page content updated (${extractedBlocks.length} blocks) but validation properties could not be set after ${maxPropertyRetries + 1} attempts`,
        { pageId, pageTitle, blocksAdded: extractedBlocks.length, error: propertyUpdateError?.message },
        500
      );
    }
    
    const totalPatchTime = ((Date.now() - patchStartTime) / 1000).toFixed(1);
    
    // FIX v11.0.187: Auto-save pages with critical failures after PATCH
    if (shouldAutoSaveForFailure) {
      try {
        log(`💾 [v11.0.187-PATCH] Auto-saving PATCH page with critical failure to pages-to-update...`);
        const fs = require('fs');
        const path = require('path');
        
        const pagesUpdateDir = path.join(__dirname, '../../patch/pages/pages-to-update');
        if (!fs.existsSync(pagesUpdateDir)) {
          fs.mkdirSync(pagesUpdateDir, { recursive: true });
        }
        
        const timestamp = new Date().toISOString().replace(/:/g, '-').replace(/\..+/, '');
        const sanitizedTitle = (pageTitle || 'untitled')
          .toLowerCase()
          .replace(/[^a-z0-9]+/g, '-')
          .replace(/^-+|-+$/g, '')
          .substring(0, 60);
        const filename = `${sanitizedTitle}-patch-failure-${timestamp}.html`;
        const filepath = path.join(pagesUpdateDir, filename);
        
        const failureReasons = [];
        if (hasContentComparisonFail) {
          failureReasons.push(`ContentComparison FAIL: ${sourceCounts.headings}→${notionCounts.headings} headings`);
        }
        if (hasAuditFail) {
          failureReasons.push(`Content Audit FAIL: Coverage ${auditResult.coverageStr}`);
        }
        
        const htmlContent = `<!--
Auto-saved: PATCH with critical validation failure (v11.0.187)
Page ID: ${pageId}
Page URL: https://notion.so/${pageId.replace(/-/g, '')}
Page Title: ${pageTitle}
PATCH Completed: ${new Date().toISOString()}

Failure Reasons (AFTER PATCH):
${failureReasons.map(r => '• ' + r).join('\n')}

Content Comparison Status: ${countsIcon}  ${comparisonStatus}
Headings: ${sourceCounts.headings} → ${notionCounts.headings}
Ordered lists: ${sourceCounts.orderedList} → ${notionCounts.orderedList}
Unordered lists: ${sourceCounts.unorderedList} → ${notionCounts.unorderedList}
Paragraphs: ${sourceCounts.paragraphs} → ${notionCounts.paragraphs}
Code blocks: ${sourceCounts.code} → ${notionCounts.code}
Tables: ${sourceCounts.tables} → ${notionCounts.tables}
Images: ${sourceCounts.images} → ${notionCounts.images}
Callouts: ${sourceCounts.callouts} → ${notionCounts.callouts}

${auditResult ? `Audit Coverage: ${auditResult.coverageStr}
Audit Status: ${auditResult.passed ? '✅ PASS' : '❌ FAIL'}` : 'Audit: SKIPPED'}

Blocks Added: ${extractedBlocks.length}
Blocks Deleted: ${deletedCount}
Patch Duration: ${totalPatchTime}s

Action Required: Review extraction and manually fix content or re-extract from source
-->

${payload?.contentHtml || '<!-- Original HTML content not available in PATCH -->'}
`;
        
        fs.writeFileSync(filepath, htmlContent, 'utf-8');
        log(`✅ [v11.0.187-PATCH] Page auto-saved to pages-to-update for re-extraction`);
        log(`   Filename: ${filename}`);
        log(`   Location: patch/pages/pages-to-update/`);
      } catch (saveError) {
        log(`❌ [v11.0.187-PATCH] Failed to auto-save PATCH page with critical failure: ${saveError.message}`);
      }
    }
    
    const result = {
      success: true,
      pageId,
      pageUrl: `https://notion.so/${pageId.replace(/-/g, '')}`,
      blocksDeleted: deletedCount,
      blocksAdded: extractedBlocks.length,
      hasVideos,
      patchTimeSeconds: parseFloat(totalPatchTime)
    };
    
    if (validationResult) {
      result.validation = validationResult;
    }
    
    log(`✅ Page update complete in ${totalPatchTime}s`);
    return sendSuccess(res, result);
    
  } catch (error) {
    cleanup(); // Stop heartbeat on error
    
    // Enhanced error logging (added in v11.0.5)
    log("❌ Error during PATCH operation");
    log(`   Phase: ${operationPhase}`);
    log(`   Page ID: ${pageId}`);
    log(`   Title: ${pageTitle || 'Unknown'}`);
    log(`   Error: ${error.message}`);
    log(`   Stack: ${error.stack}`);
    
    // Log Notion API error details if available
    if (error.code) {
      log(`   Notion Error Code: ${error.code}`);
    }
    if (error.status) {
      log(`   HTTP Status: ${error.status}`);
    }
    if (error.body) {
      try {
        const parsed = typeof error.body === 'string' ? JSON.parse(error.body) : error.body;
        log(`   Notion Error Body: ${JSON.stringify(parsed, null, 2)}`);
      } catch (parseErr) {
        log(`   Raw Error Body: ${error.body}`);
      }
    }
    
    // Return appropriate error response
    return sendError(res, "PAGE_UPDATE_FAILED", error.message, {
      pageId,
      title: pageTitle,
      phase: operationPhase,
      errorCode: error.code,
      errorStatus: error.status
    }, error.status || 500);
  }
});

module.exports = router;
