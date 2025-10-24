
/**
 * @file Express route for ServiceNow-2-Notion W2N (Web-to-Notion) endpoint.
 * @module routes/w2n
 */

const express = require('express');
const router = express.Router();
const fs = require('fs');
const path = require('path');

console.log('🔥🔥🔥 W2N.CJS MODULE LOADED AT:', new Date().toISOString());
console.log('🔥🔥🔥 MODULE VERSION: 02:16:45 - FORCE RELOAD');

// Import services
const notionService = require('../services/notion.cjs');
const servicenowService = require('../services/servicenow.cjs');
const dedupeUtil = require('../utils/dedupe.cjs');

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
  
  console.log('🔥🔥🔥🔥🔥 W2N ROUTE HANDLER ENTRY - FILE VERSION 02:16:45 🔥🔥🔥🔥🔥');
  log('🔥🔥🔥 W2N ROUTE HANDLER ENTRY - FILE VERSION 02:16:45');
  
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

    // DEBUG: Check if HTML contains pre tags at the API entry point
    if (payload.contentHtml) {
      const hasPreTags = payload.contentHtml.includes("<pre");
      const hasClosingPreTags = payload.contentHtml.includes("</pre>");
      log(
        `🔍 DEBUG API: contentHtml has <pre>: ${hasPreTags}, has </pre>: ${hasClosingPreTags}`
      );
      
      // COUNT ARTICLE.NESTED1 ELEMENTS AT API ENTRY
      const nested1Matches = payload.contentHtml.match(/class="topic task nested1"/g);
      const nested1Count = nested1Matches ? nested1Matches.length : 0;
      log(`🚨🚨🚨 API ENTRY POINT: Found ${nested1Count} article.nested1 elements in received HTML`);
      
      // Check for nested0
      const nested0Matches = payload.contentHtml.match(/class="[^"]*nested0[^"]*"/g);
      const nested0Count = nested0Matches ? nested0Matches.length : 0;
      log(`🚨🚨🚨 API ENTRY POINT: Found ${nested0Count} article.nested0 elements in received HTML`);
      log('🔥🔥🔥 INSIDE DIAGNOSTIC BLOCK - LAST LINE BEFORE CLOSING BRACE');
    }
    
    log('🔥🔥🔥 AFTER DIAGNOSTIC BLOCK - THIS LINE SHOULD ALWAYS EXECUTE');
    
    // FIX: ServiceNow HTML has unclosed article.nested0 tag - FIX OUTSIDE THE IF BLOCK
    // This causes Cheerio to auto-close it prematurely, making later articles siblings instead of children
    log(`🔧 DEBUG: About to check for nested0. payload.contentHtml exists: ${!!payload.contentHtml}, includes nested0: ${payload.contentHtml && payload.contentHtml.includes('class="nested0"')}`);
    if (payload.contentHtml && payload.contentHtml.includes('class="nested0"')) {
      log('🔧 Attempting to fix unclosed article.nested0 tag...');
      const miniTOCIndex = payload.contentHtml.indexOf('<div class="miniTOC');
      if (miniTOCIndex > -1) {
        // Find the last </article> before miniTOC
        const beforeMiniTOC = payload.contentHtml.substring(0, miniTOCIndex);
        const lastArticleCloseIndex = beforeMiniTOC.lastIndexOf('</article>');
        if (lastArticleCloseIndex > -1) {
          // Insert </article> to close nested0 after the last nested1 article closes
          const insertIndex = lastArticleCloseIndex + '</article>'.length;
          payload.contentHtml = payload.contentHtml.substring(0, insertIndex) + 
                                '</article>' +  // Close article.nested0
                                payload.contentHtml.substring(insertIndex);
          log(`🔧 FIXED: Inserted missing </article> tag to close article.nested0 at position ${insertIndex}`);
        } else {
          log('⚠️ Could not find last </article> tag to insert fix');
        }
      } else {
        log('⚠️ Could not find miniTOC to determine where to insert fix');
      }
    }

    if (!payload.title || (!payload.content && !payload.contentHtml)) {
      return sendError(
        res,
        "MISSING_FIELDS",
        "Missing required fields: title and (content or contentHtml)",
        null,
        400
      );
    }

    if (!payload.databaseId) {
      // Allow a dry-run mode for testing conversions without creating a Notion page
      if (payload.dryRun) {
        // Create children blocks from content so the caller can inspect conversion
        let children = [];
        let hasVideos = false;
        if (payload.contentHtml) {
          log("🔄 (dryRun) Converting HTML content to Notion blocks");
          const result = await htmlToNotionBlocks(payload.contentHtml);
          children = result.blocks;
          hasVideos = result.hasVideos;
          log(`✅ (dryRun) Converted HTML to ${children.length} Notion blocks`);
          if (hasVideos) {
            log(`🎥 (dryRun) Video content detected`);
          }
        } else if (payload.content) {
          children = [
            {
              object: "block",
              type: "paragraph",
              paragraph: {
                rich_text: [
                  { type: "text", text: { content: payload.content } },
                ],
              },
            },
          ];
        }
        return sendSuccess(res, { dryRun: true, children, hasVideos });
      }

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
    if (payload.contentHtml) {
      log("🔄 Converting HTML content to Notion blocks");
      
      const result = await htmlToNotionBlocks(payload.contentHtml);
      children = result.blocks;
      hasVideos = result.hasVideos;
      log(`✅ Converted HTML to ${children.length} Notion blocks`);
      if (hasVideos) {
        log(`🎥 Video content detected - will set hasVideos property`);
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

    // Split children into chunks of 100 (Notion's limit per request)
    const MAX_BLOCKS_PER_REQUEST = 100;
    const initialBlocks = children.slice(0, MAX_BLOCKS_PER_REQUEST);
    const remainingBlocks = children.slice(MAX_BLOCKS_PER_REQUEST);

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

    log("🔗 Page URL:", response.url);

    return sendSuccess(res, {
      pageUrl: response.url,
      page: {
        id: response.id,
        url: response.url,
        title: payload.title,
      },
    });
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
