
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

      // FIX v11.0.7: Final callout deduplication for dry run mode
      // Apply same deduplication logic as non-dry-run mode to ensure consistent results
      try {
        const calloutIndices = [];
        children.forEach((block, idx) => {
          if (block.type === 'callout') calloutIndices.push(idx);
        });
        
        if (calloutIndices.length > 1) {
          log(`🔍 [DRYRUN-CALLOUT-DEDUPE] Found ${calloutIndices.length} callouts at indices: [${calloutIndices.join(', ')}]`);
          
          const seenCalloutTexts = new Map(); // text -> first index
          const indicesToRemove = [];
          
          calloutIndices.forEach((idx) => {
            const callout = children[idx];
            
            // Extract and normalize text content
            const fullText = (callout.callout?.rich_text || [])
              .map(rt => rt.text?.content || '')
              .join('')
              .replace(/\(sn2n:[a-z0-9\-]+\)/gi, '') // Strip markers
              .replace(/\s+/g, ' ')  // Normalize whitespace
              .trim();
            
            // Use first 200 chars as signature (handles minor variations)
            const signature = fullText.substring(0, 200).toLowerCase();
            
            if (seenCalloutTexts.has(signature)) {
              // Duplicate found - mark for removal
              const firstIdx = seenCalloutTexts.get(signature);
              log(`🚫 [DRYRUN-CALLOUT-DEDUPE] Removing duplicate callout at index ${idx} (duplicate of ${firstIdx}): "${fullText.substring(0, 60)}..."`);
              indicesToRemove.push(idx);
            } else {
              // First occurrence - keep it
              seenCalloutTexts.set(signature, idx);
            }
          });
          
          if (indicesToRemove.length > 0) {
            const toRemove = new Set(indicesToRemove);
            const beforeCount = children.length;
            children = children.filter((_, idx) => !toRemove.has(idx));
            const afterCount = children.length;
            log(`✅ [DRYRUN-CALLOUT-DEDUPE] Removed ${indicesToRemove.length} duplicate callout(s), blocks: ${beforeCount} → ${afterCount}`);
          }
        }
      } catch (dedupeError) {
        log(`❌ [DRYRUN-CALLOUT-DEDUPE] Error during callout deduplication: ${dedupeError.message}`);
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
    const beforeDedupeCount = children.length;
    const calloutsBefore = children.filter(c => c.type === 'callout').length;
    log(`🔍 [DEDUPE-DEBUG] Before deduplication: ${beforeDedupeCount} blocks (${calloutsBefore} callouts)`);
    children = dedupeUtil.dedupeAndFilterBlocks(children, { log });
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
    
    // FIX v11.0.7: Final pass to remove any remaining duplicate callouts
    // Duplicate callouts can appear when extracted from nested lists at multiple levels
    // Remove consecutive identical callouts (within proximity of 2 blocks)
    const calloutIndices = [];
    children.forEach((block, idx) => {
      if (block.type === 'callout') calloutIndices.push(idx);
    });
    
    try {
      log(`🔍 [FINAL-CALLOUT-DEDUPE] Found ${calloutIndices.length} callouts at indices: [${calloutIndices.join(', ')}]`);
      
      // FIX v11.0.7: Aggressive callout deduplication by text content only
      // Callouts extracted from nested lists can create duplicates even after other deduplication passes
      // Use simple text-based matching (first 200 chars) to catch all duplicates
      const seenCalloutTexts = new Map(); // text -> first index
      const indicesToRemove = [];
      
      calloutIndices.forEach((idx) => {
        const callout = children[idx];
        
        // Extract and normalize text content
        const fullText = (callout.callout?.rich_text || [])
          .map(rt => rt.text?.content || '')
          .join('')
          .replace(/\(sn2n:[a-z0-9\-]+\)/gi, '') // Strip markers
          .replace(/\s+/g, ' ')  // Normalize whitespace
          .trim();
        
        // Use first 200 chars as signature (handles minor variations)
        const signature = fullText.substring(0, 200).toLowerCase();
        
        if (seenCalloutTexts.has(signature)) {
          // Duplicate found - mark for removal
          const firstIdx = seenCalloutTexts.get(signature);
          log(`🚫 [FINAL-CALLOUT-DEDUPE] Removing duplicate callout at index ${idx} (duplicate of ${firstIdx}): "${fullText.substring(0, 60)}..."`);
          indicesToRemove.push(idx);
        } else {
          // First occurrence - keep it
          seenCalloutTexts.set(signature, idx);
        }
      });
      
      if (indicesToRemove.length > 0) {
        const toRemove = new Set(indicesToRemove);
        const beforeCount = children.length;
        children = children.filter((_, idx) => !toRemove.has(idx));
        const afterCount = children.length;
        log(`✅ [FINAL-CALLOUT-DEDUPE] Removed ${indicesToRemove.length} duplicate callout(s), blocks: ${beforeCount} → ${afterCount}`);
      }
    } catch (dedupeError) {
      log(`❌ [FINAL-CALLOUT-DEDUPE] Error during final callout deduplication: ${dedupeError.message}`);
      console.error('[FINAL-CALLOUT-DEDUPE] Full error:', dedupeError);
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

    // Run post-creation validation if enabled
    let validationResult = null;
    const shouldValidate = process.env.SN2N_VALIDATE_OUTPUT === '1' || process.env.SN2N_VALIDATE_OUTPUT === 'true';
    
    if (shouldValidate) {
      log(`\n========================================`);
      log(`🔍 STARTING VALIDATION for page ${response.id}`);
      log(`   Title: "${payload.title}"`);
      log(`   Expected blocks: ${children.length}`);
      if (orchestrationFailed) {
        log(`   ⚠️ ORCHESTRATION FAILED - validation will likely detect marker leaks`);
      }
      log(`========================================\n`);
      
      try {
        // Delay to allow Notion's API to fully process page creation and deduplication
        // Increased from 500ms to 2000ms to prevent "got 0 blocks" false positives
        // Notion's eventual consistency can take 1-2 seconds for complex pages
        log("⏳ Waiting 2s for Notion API to process page creation...");
        await new Promise(resolve => setTimeout(resolve, 2000));
        
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
            sourceHtml: extractionResult?.fixedHtml || payload.contentHtml // Use fixed HTML for accurate validation
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
      if (validationResult) {
        // FIX v11.0.7: Increased retries from 3 to 5 and longer delays to handle transient Notion API issues
        // Pages were being "skipped" for validation when property updates failed after 3 attempts
        const maxPropertyRetries = 5;
        let propertyUpdateSuccess = false;
        
        for (let propRetry = 0; propRetry <= maxPropertyRetries && !propertyUpdateSuccess; propRetry++) {
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
            
            propertyUpdateSuccess = true;
            log(`✅ Validation properties updated successfully${propRetry > 0 ? ` (after ${propRetry} ${propRetry === 1 ? 'retry' : 'retries'})` : ''}`);
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
              log(`\n⚠️ ATTEMPTING FALLBACK: Minimal property update (Error checkbox only)`);
              log(`${'='.repeat(80)}\n`);
              
              // FIX v11.0.7: FALLBACK 1 - Try minimal property update with just Error checkbox
              try {
                await notion.pages.update({
                  page_id: response.id,
                  properties: {
                    "Error": { checkbox: validationResult.hasErrors }
                  }
                });
                log(`✅ FALLBACK SUCCESS: Error checkbox updated (minimal properties)`);
                propertyUpdateSuccess = true;
              } catch (fallback1Error) {
                log(`❌ FALLBACK 1 FAILED: ${fallback1Error.message}`);
                
                // FIX v11.0.7: FALLBACK 2 - Write validation summary as block comment
                try {
                  log(`⚠️ ATTEMPTING FALLBACK 2: Block comment with validation summary`);
                  const validationSummary = `🤖 VALIDATION METADATA (Auto-generated)\n` +
                    `Status: ${validationResult.hasErrors ? '❌ Failed' : '✅ Passed'}\n` +
                    `Errors: ${validationResult.criticalIssues}\n` +
                    `Warnings: ${validationResult.minorIssues}\n` +
                    `Stats: ${validationResult.statsText}\n` +
                    `Timestamp: ${new Date().toISOString()}`;
                  
                  // Prepend callout with validation info at top of page
                  await notion.blocks.children.append({
                    block_id: response.id,
                    children: [{
                      object: 'block',
                      type: 'callout',
                      callout: {
                        rich_text: [{ type: 'text', text: { content: validationSummary } }],
                        icon: { type: 'emoji', emoji: validationResult.hasErrors ? '❌' : '✅' },
                        color: validationResult.hasErrors ? 'red_background' : 'green_background'
                      }
                    }]
                  });
                  log(`✅ FALLBACK 2 SUCCESS: Validation metadata written as block comment`);
                  propertyUpdateSuccess = true;
                } catch (fallback2Error) {
                  log(`❌ FALLBACK 2 FAILED: ${fallback2Error.message}`);
                  log(`\n⚠️ WARNING: Page ${response.id} has NO validation metadata`);
                  log(`   Page exists at: ${response.url}`);
                  log(`   Manual validation may be required!\n`);
                }
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
    } else {
      log(`ℹ️ Validation skipped (SN2N_VALIDATE_OUTPUT not enabled)`);
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
    // ALWAYS run marker sweep for PATCH operations to clean inherited markers from previous page versions
    // PATCH deletes all blocks and re-creates them, which can leave orphaned markers from the old version
    operationPhase = 'sweeping for residual markers';
    const hasMarkers = markerMap && Object.keys(markerMap).length > 0;
    const reason = hasMarkers ? 'orchestration markers present' : 'PATCH safety sweep (cleans inherited markers)';
    log(`🧹 STEP 3.5: Preparing marker sweep (${reason})`);

    // Wait 1 second before marker sweep to reduce conflicts
    log(`⏸️  Waiting 1s before marker sweep to reduce conflicts...`);
    await new Promise(resolve => setTimeout(resolve, 1000));

    log(`🧹 STEP 3.5: Running final marker sweep to clean any residual markers`);
    try {
      const { sweepAndRemoveMarkersFromPage } = require('./orchestration/deep-nesting.cjs');
      const sweepResult = await sweepAndRemoveMarkersFromPage(pageId);
      if (sweepResult && sweepResult.updated > 0) {
        log(`✅ Marker sweep updated ${sweepResult.updated} blocks (removed inherited markers)`);
      } else {
        log(`✅ Marker sweep found no markers to remove`);
      }
    } catch (sweepError) {
      log(`⚠️ Marker sweep failed (non-fatal): ${sweepError.message}`);
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
          sourceHtml: extractionResult.fixedHtml || html,
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
    log(`❌ PATCH W2N Error:`, error.message);
    
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

module.exports = router;
