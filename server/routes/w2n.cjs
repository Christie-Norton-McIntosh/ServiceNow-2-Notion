
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
    isValidImageUrl: global.isValidImageUrl
  };
}

router.post('/W2N', async (req, res) => {
  const { notion, log, sendSuccess, sendError, htmlToNotionBlocks, ensureFileUploadAvailable, 
          collectAndStripMarkers, removeCollectedBlocks, deepStripPrivateKeys, 
          orchestrateDeepNesting, getExtraDebug, normalizeAnnotations, normalizeUrl, 
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
      let filteredCallouts = 0;
      let duplicates = 0;
      
      for (const blk of blockArray) {
        try {
          // Filter out gray info callouts only (keep blue notes)
          if (
            blk &&
            blk.type === "callout" &&
            blk.callout &&
            blk.callout.color === "gray_background" &&
            blk.callout.icon?.type === "emoji" &&
            String(blk.callout.icon.emoji).includes("ℹ")
          ) {
            log(`🚫 Filtering gray callout: emoji="${blk.callout.icon?.emoji}", color="${blk.callout.color}"`);
            removed++;
            filteredCallouts++;
            continue;
          }

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
        log(`🔧 dedupeAndFilterBlocks: removed ${removed} total (${filteredCallouts} callouts, ${duplicates} duplicates)`);
      }

      return out;
    }

    // Use central dedupe utility so unit tests can target it
    children = dedupeUtil.dedupeAndFilterBlocks(children, { log });

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

    // Create the page with initial blocks (with retry for network errors)
    let response;
    let retryCount = 0;
    const maxRetries = 2;
    
    while (retryCount <= maxRetries) {
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
        if (retryCount < maxRetries && (error.code === 'ECONNRESET' || error.message?.includes('socket hang up') || error.message?.includes('ETIMEDOUT'))) {
          retryCount++;
          log(`⚠️ Network error creating page (attempt ${retryCount}/${maxRetries + 1}): ${error.message}`);
          log(`   Retrying in ${retryCount * 2} seconds...`);
          await new Promise(resolve => setTimeout(resolve, retryCount * 2000));
        } else {
          throw error; // Non-retryable error or max retries exceeded
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
    try {
      if (markerMap && Object.keys(markerMap).length > 0) {
        log("🔧 Running deep-nesting orchestrator...");
        const orch = await orchestrateDeepNesting(response.id, markerMap);
        log("🔧 Orchestrator result:", orch);
      }
    } catch (e) {
      log("⚠️ Orchestrator failed:", e && e.message);
    }

    // Run post-creation validation if enabled
    let validationResult = null;
    const shouldValidate = process.env.SN2N_VALIDATE_OUTPUT === '1' || process.env.SN2N_VALIDATE_OUTPUT === 'true';
    
    if (shouldValidate) {
      try {
        log("� Running post-creation validation...");
        
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
        
        // Update page properties with validation results
        const propertyUpdates = {};
        
        // Set Error checkbox if validation failed
        if (validationResult.hasErrors) {
          propertyUpdates["Error"] = { checkbox: true };
          log(`⚠️ Validation failed - setting Error checkbox`);
        }
        
        // Set Validation property with results summary
        // Using rich_text property type (multi-line text)
        propertyUpdates["Validation"] = {
          rich_text: [
            {
              type: "text",
              text: { content: validationResult.summary }
            }
          ]
        };
        
        // Update the page properties
        await notion.pages.update({
          page_id: response.id,
          properties: propertyUpdates
        });
        
        log(`✅ Validation complete and properties updated`);
        
        if (validationResult.hasErrors) {
          log(`❌ Validation found ${validationResult.issues.length} error(s):`);
          validationResult.issues.forEach((issue, idx) => {
            log(`   ${idx + 1}. ${issue}`);
          });
          
          // AUTO-CAPTURE: Save HTML to fixtures folder when validation fails
          const shouldSaveFixtures = process.env.SN2N_SAVE_VALIDATION_FAILURES !== 'false' && process.env.SN2N_SAVE_VALIDATION_FAILURES !== '0';
          if (shouldSaveFixtures && payload.contentHtml) {
            try {
              const fixturesDir = process.env.SN2N_FIXTURES_DIR || path.join(__dirname, '../../tests/fixtures/validation-failures');
              
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
        
      } catch (validationError) {
        log(`⚠️ Validation failed with error: ${validationError.message}`);
        // Don't fail the entire request if validation fails
      }
    }

    log("🔗 Page URL:", response.url);
    
    // Note: Response was already sent immediately after page creation (before validation)
    // to prevent client timeout. Validation results are logged but not sent to client.
    if (validationResult) {
      log(`📊 Validation summary: ${validationResult.success ? 'PASSED' : 'FAILED'}`);
      log(`   Errors: ${validationResult.issues.length}, Warnings: ${validationResult.warnings.length}`);
    }
    
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
    return sendError(res, "PAGE_CREATION_FAILED", error.message, null, 500);
  }
});

module.exports = router;
