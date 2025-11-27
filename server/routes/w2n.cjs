
/**
 * @file Express route for ServiceNow-2-Notion W2N (Web-to-Notion) endpoint.
 * @module routes/w2n
 */

const express = require('express');
const router = express.Router();
const fs = require('fs');
const path = require('path');

// FORCE RELOAD TIMESTAMP: 2025-10-24T04:53:00.000Z  
console.log('🔥🔥🔥 W2N.CJS MODULE LOADED AT:', new Date().toISOString());
console.log('🔥🔥🔥 MODULE VERSION: 04:53:00 - TIMESTAMP FORCE RELOAD WITH REGEX FIX');

// Import services
const notionService = require('../services/notion.cjs');
const servicenowService = require('../services/servicenow.cjs');
const dedupeUtil = require('../utils/dedupe.cjs');
const { getAndClearPlaceholderWarnings } = require('../converters/rich-text.cjs');
const { deduplicateTableBlocks } = require('../converters/table.cjs');
const { logPlaceholderStripped, logUnprocessedContent, logImageUploadFailed, logCheerioParsingIssue } = require('../utils/verification-log.cjs');
const { validateNotionPage } = require('../utils/validate-notion-page.cjs');
const { runValidationAndUpdate } = require('../services/content-validator.cjs');

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
      log("🔍 DryRun mode enabled - converting content to blocks without creating page");
      let children = [];
      let hasVideos = false;
      let extractionWarnings = [];
      if (payload.contentHtml) {
        log("🔄 (dryRun) Converting HTML content to Notion blocks");
  const result = await htmlToNotionBlocks(payload.contentHtml);
  children = result.blocks;
        hasVideos = result.hasVideos;
        extractionWarnings = result.warnings || [];
        log(`✅ (dryRun) Converted HTML to ${children.length} Notion blocks`);
        if (hasVideos) {
          log(`🎥 (dryRun) Video content detected`);
        }
        if (extractionWarnings.length > 0) {
          log(`⚠️ (dryRun) ${extractionWarnings.length} warnings collected during extraction`);
        }
      } else if (payload.content) {
        log("🔄 (dryRun) Converting plain text content to Notion blocks");
        const result = await htmlToNotionBlocks(payload.content);
        children = result.blocks;
        hasVideos = result.hasVideos;
        extractionWarnings = result.warnings || [];
        log(`✅ (dryRun) Converted content to ${children.length} Notion blocks`);
      }
      // DRYRUN ENHANCEMENT: Simulate marker-based orchestration so structure matches real page
      try {
        const { collectAndStripMarkers, removeCollectedBlocks } = getGlobals();
        if (typeof collectAndStripMarkers === 'function' && typeof removeCollectedBlocks === 'function') {
          log('🔖 (dryRun) Collecting marker-tagged blocks for simulated orchestration');
          const markerMap = collectAndStripMarkers(children, {});
          const removed = removeCollectedBlocks(children);
          if (removed > 0) log(`🔖 (dryRun) Removed ${removed} collected block(s) from top-level`);

          // Helper: strip marker tokens from rich_text
          const stripMarkerTokens = (rich) => {
            if (!Array.isArray(rich)) return rich;
            const cleaned = [];
            const tokenRegex = /\(sn2n:[^)]+\)/g;
            for (const rt of rich) {
              const t = (rt && rt.text && typeof rt.text.content === 'string') ? rt.text.content : '';
              const newText = t.replace(tokenRegex, '').replace(/\s{2,}/g, ' ').trim();
              const clone = { ...(rt || {}) };
              if (clone.text && typeof clone.text === 'object') {
                clone.text = { ...clone.text, content: newText };
              }
              // Recompute plain_text for consistency
              clone.plain_text = newText;
              // Skip empty text nodes without link
              if (newText.length === 0 && !clone.text?.link) continue;
              cleaned.push(clone);
            }
            return cleaned;
          };

          // Attach collected blocks to parents containing the corresponding marker token
          const attachToParents = (arr) => {
            if (!Array.isArray(arr)) return;
            for (const blk of arr) {
              if (!blk || typeof blk !== 'object') continue;
              const type = blk.type;
              const typed = type && blk[type] ? blk[type] : null;
              const rich = typed && Array.isArray(typed.rich_text) ? typed.rich_text : [];
              // Find any marker tokens in rich_text
              const concat = rich.map(r => r?.text?.content || '').join('');
              const matches = concat.match(/\(sn2n:([a-z0-9_\-]+)\)/gi) || [];
              if (matches.length > 0) {
                for (const token of matches) {
                  const marker = token.slice(6, -1); // remove "(sn2n:" and ")"
                  const blocksToAppend = markerMap[marker] || [];
                  if (blocksToAppend.length > 0) {
                    // Ensure children array exists for supported types
                    const supportedParents = ['numbered_list_item', 'bulleted_list_item', 'callout', 'toggle', 'to_do', 'paragraph'];
                    if (type && supportedParents.includes(type)) {
                      if (!blk[type].children) blk[type].children = [];
                      blk[type].children.push(...blocksToAppend);
                      // Mark as attached so we don't attach again
                      markerMap[marker] = [];
                    }
                  }
                }
                // Strip marker tokens from rich_text after attaching
                if (typed) {
                  typed.rich_text = stripMarkerTokens(rich);
                }
              }
              // Recurse into children
              if (typed && Array.isArray(typed.children)) attachToParents(typed.children);
              if (Array.isArray(blk.children)) attachToParents(blk.children);
            }
          };

          attachToParents(children);
          log('🔖 (dryRun) Marker attachment simulation complete');
        }
      } catch (e) {
        log(`⚠️ (dryRun) Marker simulation failed: ${e && e.message ? e.message : e}`);
      }

      return sendSuccess(res, { dryRun: true, children, hasVideos, warnings: extractionWarnings });
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
      
      // Merge with existing properties (userscript already did the mapping)
      Object.assign(properties, payload.properties);
      log("🔍 Properties after merge:");
      log(JSON.stringify(properties, null, 2));
    } else {
      log("⚠️ No properties received from userscript");
    }

    // Create children blocks from content
    let children = [];
    let hasVideos = false;

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
      
      const result = await htmlToNotionBlocks(payload.contentHtml);
      children = result.blocks;
      hasVideos = result.hasVideos;
      extractionWarnings = result.warnings || [];
      log(`✅ Converted HTML to ${children.length} Notion blocks`);
      
      // Deduplicate consecutive identical tables
      const beforeDedupe = children.length;
      children = deduplicateTableBlocks(children);
      if (children.length < beforeDedupe) {
        log(`🧹 Removed ${beforeDedupe - children.length} duplicate table(s)`);
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

    // Before creating the page, strip any internal helper keys from blocks
    deepStripPrivateKeys(children);

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
    children = dedupeUtil.dedupeAndFilterBlocks(children, { log });
    
    // SPECIALIZED DEDUPE: Remove duplicate "Before you begin" callouts (Role required: none)
    // These appear 3 times in the source HTML (one per nested task section) but should only appear once each
    // The global dedupe may miss them if they're separated by large procedure blocks
    const beforeYouBeginTexts = new Set();
    const beforeChildren = children.length;
    children = children.filter(block => {
      if (block.type === 'callout' && block.callout?.rich_text) {
        const text = block.callout.rich_text.map(rt => rt.text?.content || '').join('').trim();
        // Match "Before you begin" or "Role required:" callouts
        if (text.startsWith('Before you begin') || text.includes('Role required:')) {
          if (beforeYouBeginTexts.has(text)) {
            log(`🔧 [PREREQ-DEDUPE] Removing duplicate "Before you begin" callout: "${text.substring(0, 50)}..."`);
            return false; // Remove duplicate
          }
          beforeYouBeginTexts.add(text);
        }
      }
      return true;
    });
    if (children.length < beforeChildren) {
      log(`🔧 [PREREQ-DEDUPE] Removed ${beforeChildren - children.length} duplicate "Before you begin" callout(s)`);
    }
    
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
            { log }
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
            { log }
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
          block.toggle.children = dedupeUtil.dedupeAndFilterBlocks(block.toggle.children, { log });
          const afterCount = block.toggle.children.length;
          if (beforeCount !== afterCount) {
            log(`${indent}  🚫 Removed ${beforeCount - afterCount} duplicate(s) from toggle[${idx}]`);
          }
          block.toggle.children = dedupeNestedChildren(block.toggle.children, depth + 1);
        } else if (block.type === 'callout' && block.callout?.children) {
          const beforeCount = block.callout.children.length;
          log(`${indent}🔍 [NESTED-DEDUPE] callout[${idx}] has ${beforeCount} children`);
          block.callout.children = dedupeUtil.dedupeAndFilterBlocks(block.callout.children, { log });
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

    // Check the "Error" checkbox if extraction warnings were detected
    if (extractionWarnings.length > 0) {
      log(`⚠️ Setting Error checkbox due to ${extractionWarnings.length} extraction warning(s)`);
      properties["Error"] = {
        checkbox: true
      };
    }

    // Create the page with initial blocks (with retry for network errors AND rate limiting)
    let response;
    let retryCount = 0;
    const maxRetries = 2;
    const maxRateLimitRetries = 5; // Allow more retries for rate limiting
    let rateLimitRetryCount = 0;
    
    while (retryCount <= maxRetries || rateLimitRetryCount <= maxRateLimitRetries) {
      try {
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
          // Extract retry-after header or use exponential backoff
          const retryAfter = error.headers?.['retry-after'] || (rateLimitRetryCount * 10);
          const waitSeconds = Math.min(parseInt(retryAfter) || (rateLimitRetryCount * 10), 60);
          
          log(`⚠️ 🚦 RATE LIMIT HIT (attempt ${rateLimitRetryCount}/${maxRateLimitRetries + 1})`);
          log(`   Page: "${payload.title}"`);
          log(`   Waiting ${waitSeconds} seconds before retry...`);
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
            log(`❌ Rate limit exceeded after ${rateLimitRetryCount} retries`);
            log(`   💡 This page will be marked for manual retry`);
            error.message = `Rate limit exceeded: ${error.message}. Page "${payload.title}" needs to be processed manually after cooldown.`;
          }
          throw error;
        }
      }
    }

    log("✅ Page created successfully:", response.id);
    // IMMEDIATE ZERO-BLOCK RECOVERY CHECK (pre-orchestration)
    try {
      const initialChildProbe = await notion.blocks.children.list({ block_id: response.id, page_size: 10 });
      const initialCount = initialChildProbe.results?.length || 0;
      if (initialCount === 0 && Array.isArray(initialBlocks) && initialBlocks.length > 0) {
        log(`⚠️ [ZERO-BLOCK-DETECT] Page ${response.id} has 0 children immediately after creation. Attempting recovery append...`);
        const chunkSize = 100;
        for (let i = 0; i < initialBlocks.length; i += chunkSize) {
          const chunk = initialBlocks.slice(i, i + chunkSize);
          if (typeof deepStripPrivateKeys === 'function') {
            deepStripPrivateKeys(chunk);
          }
          await notion.blocks.children.append({ block_id: response.id, children: chunk });
          log(`✅ [ZERO-BLOCK-RECOVERY] Appended recovery chunk ${(i / chunkSize) + 1} (${chunk.length} blocks)`);
        }
        // Increased delay for Notion eventual consistency (v11.0.6: 1500ms → 2000ms)
        await new Promise(r => setTimeout(r, 2000));
        const postRecoveryProbe = await notion.blocks.children.list({ block_id: response.id, page_size: 10 });
        const postCount = postRecoveryProbe.results?.length || 0;
        log(`🔎 [ZERO-BLOCK-RECOVERY] Child count after recovery: ${postCount}`);
        if (postCount === 0) {
          log(`❌ [ZERO-BLOCK-RECOVERY] Recovery failed (still 0). Will mark page during validation phase.`);
          // Flag for later property update
          response._sn2n_zero_block_recovery_failed = true;
        } else {
          log(`✅ [ZERO-BLOCK-RECOVERY] Recovery succeeded; proceeding with orchestration.`);
        }
      } else {
        log(`🔍 [ZERO-BLOCK-DETECT] Initial child count: ${initialCount} (no recovery needed)`);
      }
    } catch (zbErr) {
      log(`⚠️ [ZERO-BLOCK-RECOVERY] Error during immediate recovery attempt: ${zbErr.message}`);
    }
    
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
    try {
      if (markerMap && Object.keys(markerMap).length > 0) {
        log("🔧 Running deep-nesting orchestrator...");
        const orch = await orchestrateDeepNesting(response.id, markerMap);
        log("🔧 Orchestrator result:", orch);
        
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
                // If there are only 1-2 tables total, they might be genuine orchestration duplicates
                // Notion API returns tables without their children, so all tables look identical by structure
                if (isPageRoot && child.type === 'table') {
                  const tableCount = children.filter(c => c.type === 'table').length;
                  if (tableCount > 2) {
                    log(`${indent}  ✓ Preserving table at page root (${tableCount} tables, likely different sections)`);
                    prevChild = child;
                    prevKey = null;
                    continue;
                  } else {
                    // With 1-2 tables, allow consecutive deduplication to catch orchestration duplicates
                    log(`${indent}  🔍 Checking table for consecutive deduplication (only ${tableCount} table(s) at root)`);
                  }
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
      }
    } catch (e) {
      log("⚠️ Orchestrator failed:", e && e.message);
    }

    // Run post-creation validation if enabled
    let validationResult = null;
    const shouldValidate = process.env.SN2N_VALIDATE_OUTPUT === '1' || process.env.SN2N_VALIDATE_OUTPUT === 'true';
    
    if (shouldValidate) {
      try {
        // Delay to allow Notion's API to fully process page creation and deduplication
        // Increased from 500ms to 2000ms to prevent "got 0 blocks" false positives
        // Notion's eventual consistency can take 1-2 seconds for complex pages
        await new Promise(resolve => setTimeout(resolve, 2000));
        
        // PRE-VALIDATION EMPTY PAGE RETRY: fetch quick child count
        try {
          const preVal = await notion.blocks.children.list({ block_id: response.id, page_size: 10 });
          const preCount = preVal.results?.length || 0;
          if (preCount === 0 && Array.isArray(initialBlocks) && initialBlocks.length > 0) {
            log("⚠️ [EMPTY-PAGE-RETRY] Detected 0 blocks before validation; attempting single re-append of initial blocks...");
            const chunkSize = 100;
            for (let i = 0; i < initialBlocks.length; i += chunkSize) {
              const chunk = initialBlocks.slice(i, i + chunkSize);
              deepStripPrivateKeys && deepStripPrivateKeys(chunk);
              await notion.blocks.children.append({ block_id: response.id, children: chunk });
              log(`✅ [EMPTY-PAGE-RETRY] Re-appended chunk ${(i/chunkSize)+1} (${chunk.length} blocks)`);
            }
            // Increased delay for Notion eventual consistency (v11.0.6: 1500ms → 2000ms)
            await new Promise(r => setTimeout(r, 2000));
          }
        } catch (e) {
          log(`⚠️ [EMPTY-PAGE-RETRY] Pre-validation retry logic failed: ${e.message}`);
        }

        log("🔍 Running post-creation validation...");
        
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
            sourceHtml: payload.contentHtml // Pass original HTML for content comparison
          },
          log
        );
        
        log(`✅ Validation function completed`);
        
      } catch (validationError) {
        log(`⚠️ Validation failed with error: ${validationError.message}`);
        log(`⚠️ Stack trace: ${validationError.stack}`);
        // Create a placeholder result to ensure we log the validation attempt
        validationResult = {
          success: false,
          hasErrors: true,
          issues: [`Validation error: ${validationError.message}`],
          warnings: [],
          stats: null,
          summary: `❌ Validation encountered an error: ${validationError.message}`
        };
        // Don't fail the entire request if validation fails
      }
      
      // INJECT ZERO-BLOCK RECOVERY FLAG if page was marked during immediate recovery
      if (response._sn2n_zero_block_recovery_failed && validationResult) {
        validationResult.zeroBlockRecoveryFailed = true;
        validationResult.hasErrors = true;
        if (!validationResult.issues) validationResult.issues = [];
        validationResult.issues.push('Zero-block recovery failed: page has no blocks after retry');
        log(`⚠️ [ZERO-BLOCK-FLAG] Injected recovery failure into validation result`);
      }
      
      // Update page properties with validation results (moved outside try/catch)
      // This ensures properties are ALWAYS updated, even if validation errors
      if (validationResult) {
        try {
          const propertyUpdates = {};
          
          // Set Error checkbox based on validation result (always explicit)
          if (validationResult.hasErrors) {
            propertyUpdates["Error"] = { checkbox: true };
            log(`⚠️ Validation failed - setting Error checkbox`);
          } else {
            propertyUpdates["Error"] = { checkbox: false };
            log(`✅ Validation passed - clearing Error checkbox`);
          }
          
          // Set Validation property with results summary (without stats)
          // Using rich_text property type (multi-line text)
          propertyUpdates["Validation"] = {
            rich_text: [
              {
                type: "text",
                text: { content: validationResult.summary }
              }
            ]
          };
          
          // Set Stats property with detailed statistics
          // Using rich_text property type (multi-line text)
          if (validationResult.stats) {
            const statsText = JSON.stringify(validationResult.stats, null, 2);
            propertyUpdates["Stats"] = {
              rich_text: [
                {
                  type: "text",
                  text: { content: statsText }
                }
              ]
            };
            log(`📊 Setting Stats property with validation statistics`);
          }
          
          // Update the page properties
          await notion.pages.update({
            page_id: response.id,
            properties: propertyUpdates
          });
          
          log(`✅ Validation properties updated successfully`);
        } catch (propError) {
          log(`❌ Failed to update validation properties: ${propError.message}`);
          // Don't throw - page was created successfully, just property update failed
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
              // Save failed pages to unified hub: patch/pages/pages-to-update/
              // Fix path (previously missing 'pages/' segment)
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
    } else {
      log(`ℹ️ Validation skipped (SN2N_VALIDATE_OUTPUT not enabled)`);
    }
    
    // Run content validation (text order and completeness)
    // This runs independently from block-count validation
    const shouldRunContentValidation = process.env.SN2N_CONTENT_VALIDATION === '1' || process.env.SN2N_CONTENT_VALIDATION === 'true';
    
    if (shouldRunContentValidation && payload.contentHtml) {
      try {
        log("📋 Running content validation (text order and completeness)...");
        
        // Delay to allow Notion's API to fully process the page
        await new Promise(resolve => setTimeout(resolve, 2000));
        
        // Extract block counts from validation result (if available)
        const blockCounts = (validationResult && validationResult.sourceCounts && validationResult.notionCounts) ? {
          source: validationResult.sourceCounts,
          notion: validationResult.notionCounts
        } : null;
        
        // Pass contextFlags to content validator with zero-block recovery status
        const contextFlags = {
          zeroBlockRecoveryFailed: validationResult?.zeroBlockRecoveryFailed || false
        };
        
        const contentValidationResult = await runValidationAndUpdate(
          payload.contentHtml,
          response.id,
          notion,
          blockCounts,
          contextFlags
        );
        
        if (contentValidationResult.success) {
          log(`✅ Content validation PASSED (${contentValidationResult.similarity}% similarity)`);
        } else if (contentValidationResult.error) {
          log(`❌ Content validation ERROR: ${contentValidationResult.error}`);
        } else {
          log(`❌ Content validation FAILED (${contentValidationResult.similarity}% similarity)`);
          
          // Identify failure pattern for diagnostics (v11.0.6)
          const failurePattern = [];
          if (contentValidationResult.similarity < 50) failurePattern.push('severe-loss');
          else if (contentValidationResult.similarity < 90) failurePattern.push('content-loss');
          if (contentValidationResult.orderIssues?.length > 0) failurePattern.push('order-issues');
          if (contentValidationResult.missing?.length > 5) failurePattern.push('many-missing');
          if (contentValidationResult.extra?.length > 5) failurePattern.push('many-extra');
          if (validationResult?.zeroBlockRecoveryFailed) failurePattern.push('zero-block');
          log(`📊 [FAILURE-PATTERN] ${failurePattern.length > 0 ? failurePattern.join(', ') : 'near-threshold'}`);
          
          // Auto-capture HTML for content validation failures (same hub as block failures)
          const shouldSaveContentFailures = process.env.SN2N_SAVE_VALIDATION_FAILURES !== 'false' && process.env.SN2N_SAVE_VALIDATION_FAILURES !== '0';
          if (shouldSaveContentFailures && payload.contentHtml) {
            try {
              const fixturesDir = process.env.SN2N_FIXTURES_DIR || path.join(__dirname, '../../patch/pages/pages-to-update');
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
              const metadata = [
                '<!--',
                `  Type: Content Validation Failure`,
                `  Page: ${payload.title || 'Untitled'}`,
                `  URL: ${payload.url || 'N/A'}`,
                `  Captured: ${new Date().toISOString()}`,
                `  Page ID: ${response.id}`,
                `  Similarity: ${contentValidationResult.similarity}%`,
                `  HTML chars: ${contentValidationResult.htmlChars}`,
                `  Notion chars: ${contentValidationResult.notionChars}`,
                '-->'
              ].join('\n');
              const htmlWithMetadata = `${metadata}\n${payload.contentHtml}`;
              fs.writeFileSync(filepath, htmlWithMetadata, 'utf8');
              log(`💾 Auto-saved content validation failure HTML to: ${filename}`);
            } catch (saveErr) {
              log(`⚠️ Failed to save content validation failure HTML: ${saveErr.message}`);
            }
          }
        }
        
      } catch (contentValidationError) {
        log(`⚠️ Content validation failed with error: ${contentValidationError.message}`);
        // Don't fail the entire request if content validation fails
      }
    } else if (!shouldRunContentValidation) {
      log(`ℹ️ Content validation skipped (SN2N_CONTENT_VALIDATION not enabled)`);
    } else {
      log(`ℹ️ Content validation skipped (no contentHtml provided)`);
    }

    log("🔗 Page URL:", response.url);
    
    // Note: Response was already sent immediately after page creation (before validation)
    // to prevent client timeout. Validation results are logged but not sent to client.
    if (validationResult) {
      log(`📊 Validation summary: ${validationResult.success ? 'PASSED' : 'FAILED'}`);
      log(`   Errors: ${validationResult.issues.length}, Warnings: ${validationResult.warnings.length}`);
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

  // Heartbeat interval + cleanup hoisted so catch block can access
  let patchStartTime = Date.now();
  let operationPhase = 'initializing';
  let heartbeatInterval = setInterval(() => {
    const elapsed = Math.floor((Date.now() - patchStartTime) / 1000);
    log(`💓 [${elapsed}s] PATCH in progress - ${operationPhase}...`);
  }, 10000);
  const cleanup = () => {
    if (heartbeatInterval) {
      clearInterval(heartbeatInterval);
      heartbeatInterval = null;
    }
  };

  try {
    const payload = req.body;
    const pageTitle = payload.title || 'Untitled';
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
    
    log(`📄 HTML content length: ${html.length} characters`);
    
    // Extract blocks from HTML (same as POST endpoint)
    operationPhase = 'extracting blocks from HTML';
    const extractionResult = await htmlToNotionBlocks(html);
    
    if (!extractionResult || !extractionResult.blocks) {
      return sendError(res, "EXTRACTION_FAILED", "Failed to extract content from HTML", null, 500);
    }
    
    let { blocks: extractedBlocks, hasVideos } = extractionResult;
    
    // Defensive guard: ensure extractedBlocks is always an array
    if (!Array.isArray(extractedBlocks)) {
      log(`⚠️ extractedBlocks is not an array (type: ${typeof extractedBlocks}), defaulting to empty array`);
      extractedBlocks = [];
    }
    
    log(`✅ Extracted ${extractedBlocks.length} blocks from HTML`);
    
    if (hasVideos) {
      log("⚠️ Warning: Videos detected but not supported by Notion API");
    }
    
    // If dryRun, return extracted blocks without updating
    if (payload.dryRun) {
      log("🧪 Dry run mode - returning extracted blocks without updating page");
      
      // Count block types for reporting
      const blockTypes = {};
      extractedBlocks.forEach(block => {
        blockTypes[block.type] = (blockTypes[block.type] || 0) + 1;
      });
      
      return sendSuccess(res, {
        dryRun: true,
        pageId,
        blocksExtracted: extractedBlocks.length,
        blockTypes,
        children: extractedBlocks,
        hasVideos
      });
    }
    
    // Strip private keys before deduplication
    deepStripPrivateKeys(extractedBlocks);
    
    // Deduplicate blocks
    const beforeDedupeCount = extractedBlocks.length;
    extractedBlocks = dedupeUtil.dedupeAndFilterBlocks(extractedBlocks);
    const afterDedupeCount = extractedBlocks.length;
    
    if (beforeDedupeCount !== afterDedupeCount) {
      log(`🔄 Deduplication: ${beforeDedupeCount} → ${afterDedupeCount} blocks (removed ${beforeDedupeCount - afterDedupeCount})`);
    }
    
    // Collect markers for deep nesting (same as POST endpoint pattern)
    const markerMap = collectAndStripMarkers(extractedBlocks, {});
    const removedCount = removeCollectedBlocks(extractedBlocks);
    
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
    
    // STEP 2.5: Zero-block recovery check
    if (extractedBlocks.length > 0) {
      log(`🔍 STEP 2.5: Checking for zero-block issue after PATCH upload...`);
      try {
        const probeResult = await notion.blocks.children.list({
          block_id: pageId,
          page_size: 10
        });
        const initialCount = probeResult.results?.length || 0;
        
        if (initialCount === 0) {
          log(`⚠️ [ZERO-BLOCK-DETECT] Page ${pageId} has 0 children after PATCH. Attempting recovery append...`);
          
          // Re-append blocks in chunks
          const recoveryChunks = [];
          for (let i = 0; i < extractedBlocks.length; i += 100) {
            recoveryChunks.push(extractedBlocks.slice(i, i + 100));
          }
          
          for (let i = 0; i < recoveryChunks.length; i++) {
            const chunk = recoveryChunks[i];
            log(`   [ZERO-BLOCK-RECOVERY] Appending recovery chunk ${i + 1}/${recoveryChunks.length} (${chunk.length} blocks)...`);
            await notion.blocks.children.append({
              block_id: pageId,
              children: chunk
            });
          }
          
          // Increased delay for Notion eventual consistency (v11.0.6: 1500ms → 2000ms)
          await new Promise(resolve => setTimeout(resolve, 2000));
          
          // Recheck
          const recheckResult = await notion.blocks.children.list({
            block_id: pageId,
            page_size: 10
          });
          const finalCount = recheckResult.results?.length || 0;
          
          if (finalCount === 0) {
            log(`❌ [ZERO-BLOCK-RECOVERY] FAILED - Page still has 0 children after recovery attempt`);
            // Flag for validation
            if (!validationResult) validationResult = {};
            validationResult.zeroBlockRecoveryFailed = true;
          } else {
            log(`✅ [ZERO-BLOCK-RECOVERY] SUCCESS - Page now has ${finalCount} children`);
          }
        } else {
          log(`🔍 [ZERO-BLOCK-DETECT] Initial child count: ${initialCount} (no recovery needed)`);
        }
      } catch (zeroBlockError) {
        log(`⚠️ [ZERO-BLOCK-DETECT] Check failed: ${zeroBlockError.message}`);
      }
    }
    
    // STEP 3: Run orchestration for deep nesting
    if (markerMap && Object.keys(markerMap).length > 0) {
      operationPhase = `orchestrating deep nesting for ${Object.keys(markerMap).length} markers`;
      log(`[PATCH-PROGRESS] STEP 3: Starting deep-nesting orchestration for ${Object.keys(markerMap).length} markers`);
      log(`🔧 STEP 3: Running deep-nesting orchestration for ${Object.keys(markerMap).length} markers`);
      
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
    
    // STEP 3.5: Marker sweep
    // If markers were collected (orchestration ran), always sweep.
    // Additionally, when SN2N_ORPHAN_LIST_REPAIR=1, perform a fallback sweep even if markerMap is empty.
    const shouldForceSweep = process.env.SN2N_ORPHAN_LIST_REPAIR === '1';
    if ((markerMap && Object.keys(markerMap).length > 0) || shouldForceSweep) {
      operationPhase = 'sweeping for residual markers';
      const reason = (markerMap && Object.keys(markerMap).length > 0) ? 'orchestration markers present' : 'fallback safety sweep enabled';
      log(`🧹 STEP 3.5: Preparing marker sweep (${reason})`);

      // Wait 1 second before marker sweep to reduce conflicts
      log(`⏸️  Waiting 1s before marker sweep to reduce conflicts...`);
      await new Promise(resolve => setTimeout(resolve, 1000));

      log(`🧹 STEP 3.5: Running final marker sweep to clean any residual markers`);
      try {
        const { sweepAndRemoveMarkersFromPage } = require('./orchestration/deep-nesting.cjs');
        const sweepResult = await sweepAndRemoveMarkersFromPage(pageId);
        if (sweepResult && sweepResult.updated > 0) {
          log(`✅ Marker sweep updated ${sweepResult.updated} blocks`);
        } else {
          log(`✅ Marker sweep found no markers to remove`);
        }
      } catch (sweepError) {
        log(`⚠️ Marker sweep failed (non-fatal): ${sweepError.message}`);
      }
    } else {
      log(`✅ STEP 3.5: No markers collected and safety sweep disabled, skipping marker sweep (saves 2-5 seconds)`);
    }
    
    // STEP 4: Update page properties if provided
    if (payload.properties) {
      log(`📝 STEP 4: Updating page properties`);
      
      try {
        await notion.pages.update({
          page_id: pageId,
          properties: payload.properties
        });
        log(`✅ Properties updated`);
      } catch (propError) {
        log(`⚠️ Property update failed (non-fatal): ${propError.message}`);
      }
    }
    
    // STEP 5: Optional validation
    let validationResult = null;
    if (process.env.SN2N_VALIDATE_OUTPUT === '1') {
      operationPhase = 'validating updated page';
      log(`🔍 STEP 5: Validating updated page`);
      
      // Shorter delay for PATCH (1s instead of 2s for POST) - PATCH operations are simpler
      const validationDelay = 1000;
      log(`   Waiting ${validationDelay}ms for Notion's eventual consistency...`);
      await new Promise(resolve => setTimeout(resolve, validationDelay));
      
      try {
        validationResult = await validateNotionPage(notion, pageId, {
          sourceHtml: html,
          expectedTitle: pageTitle,
          verbose: true
        });
        
        if (validationResult.valid) {
          log(`✅ Validation passed`);
        } else {
          log(`⚠️ Validation warnings detected`);
        }
      } catch (valError) {
        log(`⚠️ Validation failed (non-fatal): ${valError.message}`);
      }
    }
    
    // STEP 5.5: Content validation (text order and completeness)
    if (process.env.SN2N_CONTENT_VALIDATION === '1' && html) {
      try {
        log("📋 STEP 5.5: Running content validation (text order and completeness)...");
        
        // Delay to allow Notion's API to fully process the page
        await new Promise(resolve => setTimeout(resolve, 2000));
        
        // Extract block counts from validation result (if available)
        const blockCounts = (validationResult && validationResult.sourceCounts && validationResult.notionCounts) ? {
          source: validationResult.sourceCounts,
          notion: validationResult.notionCounts
        } : null;
        
        // Pass contextFlags to content validator with zero-block recovery status
        const contextFlags = {
          zeroBlockRecoveryFailed: validationResult?.zeroBlockRecoveryFailed || false
        };
        
        const contentValidationResult = await runValidationAndUpdate(
          html,
          pageId,
          notion,
          blockCounts,
          contextFlags
        );
        
        if (contentValidationResult.success) {
          log(`✅ Content validation PASSED (${contentValidationResult.similarity}% similarity)`);
        } else if (contentValidationResult.error) {
          log(`❌ Content validation ERROR: ${contentValidationResult.error}`);
        } else {
          log(`❌ Content validation FAILED (${contentValidationResult.similarity}% similarity)`);
          
          // Identify failure pattern for diagnostics (v11.0.6)
          const failurePattern = [];
          if (contentValidationResult.similarity < 50) failurePattern.push('severe-loss');
          else if (contentValidationResult.similarity < 90) failurePattern.push('content-loss');
          if (contentValidationResult.orderIssues?.length > 0) failurePattern.push('order-issues');
          if (contentValidationResult.missing?.length > 5) failurePattern.push('many-missing');
          if (contentValidationResult.extra?.length > 5) failurePattern.push('many-extra');
          if (validationResult?.zeroBlockRecoveryFailed) failurePattern.push('zero-block');
          log(`📊 [FAILURE-PATTERN] ${failurePattern.length > 0 ? failurePattern.join(', ') : 'near-threshold'}`);
          
          // Auto-capture HTML for content validation failures
          const shouldSaveContentFailures = process.env.SN2N_SAVE_VALIDATION_FAILURES !== 'false' && process.env.SN2N_SAVE_VALIDATION_FAILURES !== '0';
          if (shouldSaveContentFailures && html) {
            try {
              const fs = require('fs');
              const path = require('path');
              const fixturesDir = process.env.SN2N_FIXTURES_DIR || path.join(__dirname, '../../patch/pages/pages-to-update');
              if (!fs.existsSync(fixturesDir)) {
                fs.mkdirSync(fixturesDir, { recursive: true });
              }
              const timestamp = new Date().toISOString().replace(/:/g, '-').replace(/\..+/, '');
              const sanitizedTitle = (pageTitle || 'untitled')
                .toLowerCase()
                .replace(/[^a-z0-9]+/g, '-')
                .replace(/^-+|-+$/g, '')
                .substring(0, 50);
              const filename = `${sanitizedTitle}-${timestamp}.html`;
              const filepath = path.join(fixturesDir, filename);
              
              // Build metadata comment
              const metadata = [
                `<!-- PATCH CONTENT VALIDATION FAILURE -->`,
                `<!-- Page ID: ${pageId} -->`,
                `<!-- Similarity: ${contentValidationResult.similarity}% -->`,
                `<!-- Timestamp: ${new Date().toISOString()} -->`,
                `<!-- Block Counts: ${contentValidationResult.htmlSegments} HTML → ${contentValidationResult.notionSegments} Notion -->`,
                contentValidationResult.orderIssues?.length > 0 ? `<!-- Order Issues: ${contentValidationResult.orderIssues.length} -->` : null,
                contentValidationResult.missing?.length > 0 ? `<!-- Missing Segments: ${contentValidationResult.missing.length} -->` : null,
                contentValidationResult.extra?.length > 0 ? `<!-- Extra Segments: ${contentValidationResult.extra.length} -->` : null,
                `<!-- PATCH Operation -->`
              ].filter(Boolean).join('\n');
              
              fs.writeFileSync(filepath, `${metadata}\n\n${html}`, 'utf8');
              log(`📁 Saved PATCH validation failure to: ${filepath}`);
            } catch (saveError) {
              log(`⚠️ Failed to save PATCH validation failure: ${saveError.message}`);
            }
          }
        }
      } catch (contentValError) {
        log(`⚠️ Content validation failed (non-fatal): ${contentValError.message}`);
      }
    }
    
    log(`[PATCH-PROGRESS] All steps complete - PATCH operation successful!`);
    
    // STEP 6: Update Validation property with PATCH indicator
    if (validationResult) {
      try {
        const propertyUpdates = {};
        
        // Set Error checkbox if validation failed
        if (validationResult.hasErrors) {
          propertyUpdates["Error"] = { checkbox: true };
          log(`⚠️ Validation failed - setting Error checkbox`);
        } else {
          // Clear Error checkbox on successful validation
          propertyUpdates["Error"] = { checkbox: false };
        }
        
        // Set Validation property with PATCH indicator and results summary
        const patchIndicator = "🔄 PATCH\n\n";
        propertyUpdates["Validation"] = {
          rich_text: [
            {
              type: "text",
              text: { content: patchIndicator + validationResult.summary }
            }
          ]
        };
        
        // Set Stats property with detailed statistics
        if (validationResult.stats) {
          const statsText = JSON.stringify(validationResult.stats, null, 2);
          propertyUpdates["Stats"] = {
            rich_text: [
              {
                type: "text",
                text: { content: statsText }
              }
            ]
          };
          log(`📊 Setting Stats property with validation statistics`);
        }
        
        // Update the page properties
        await notion.pages.update({
          page_id: pageId,
          properties: propertyUpdates
        });
        
        log(`✅ Validation properties updated with PATCH indicator`);
      } catch (propError) {
        log(`⚠️ Failed to update validation properties: ${propError.message}`);
        // Don't throw - page was updated successfully, just property update failed
      }
    }
    
    // Success response
    cleanup(); // Stop heartbeat
    const totalPatchTime = ((Date.now() - patchStartTime) / 1000).toFixed(1);
    
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
    log(`❌ PATCH W2N Error: ${error.message}`);
    log(`❌ Error stack:`, error.stack);
    log(`❌ Operation phase: ${operationPhase}`);
    
    if (error.body) {
      try {
        const parsed = JSON.parse(error.body);
        log("❌ Notion error body:", JSON.stringify(parsed, null, 2));
      } catch (parseErr) {
        log("❌ Failed to parse Notion error body:", parseErr.message);
        log("❌ Raw error body:", error.body);
      }
    }
    
    return sendError(res, "PAGE_UPDATE_FAILED", error.message, null, 500);
  }
});

/**
 * POST /api/W2N/:pageId/cleanup-markers
 * 
 * Clean up orphaned sn2n:marker tokens from a page's rich_text blocks.
 * This is useful for pages that were created during AutoExtract but timed out
 * before the marker sweep could complete, leaving markers in the content.
 * 
 * @param {string} pageId - The Notion page ID (with or without hyphens)
 * @returns {object} { updated: number } - Number of blocks updated
 * 
 * Example: POST /api/W2N/1234567890abcdef1234567890abcdef/cleanup-markers
 */
router.post('/W2N/:pageId/cleanup-markers', async (req, res) => {
  const { notion, log, sendSuccess, sendError } = getGlobals();
  const startTime = Date.now();
  
  // Normalize pageId (remove hyphens if present)
  let pageId = req.params.pageId;
  if (!pageId) {
    return sendError(res, 'MISSING_PAGE_ID', 'Page ID is required', null, 400);
  }
  
  pageId = pageId.replace(/-/g, '');
  if (pageId.length !== 32) {
    return sendError(res, 'INVALID_PAGE_ID', 'Page ID must be 32 characters (UUID without hyphens)', null, 400);
  }
  
  log(`🧹 [MARKER-CLEANUP] Starting marker cleanup for page ${pageId}`);
  
  try {
    // Import the sweep function
    const { sweepAndRemoveMarkersFromPage } = require('../orchestration/deep-nesting.cjs');
    
    // Run the marker sweep
    const sweepResult = await sweepAndRemoveMarkersFromPage(pageId);
    
    const elapsedMs = Date.now() - startTime;
    const elapsedSec = (elapsedMs / 1000).toFixed(1);
    
    log(`✅ [MARKER-CLEANUP] Completed in ${elapsedSec}s. Blocks updated: ${sweepResult.updated}`);
    
    return sendSuccess(res, {
      pageId,
      updated: sweepResult.updated,
      elapsedMs,
      message: `Cleaned ${sweepResult.updated} block(s) with marker tokens`
    });
    
  } catch (error) {
    const elapsedMs = Date.now() - startTime;
    const elapsedSec = (elapsedMs / 1000).toFixed(1);
    
    log(`❌ [MARKER-CLEANUP] Failed after ${elapsedSec}s:`, error.message);
    
    if (error.body) {
      try {
        const parsed = JSON.parse(error.body);
        log("❌ Notion error body:", JSON.stringify(parsed, null, 2));
      } catch (parseErr) {
        log("❌ Failed to parse Notion error body:", parseErr.message);
        log("❌ Raw error body:", error.body);
      }
    }
    
    return sendError(res, 'MARKER_CLEANUP_FAILED', error.message, null, 500);
  }
});

module.exports = router;
