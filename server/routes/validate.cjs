
/**
 * @file Express route to re-run validation on existing Notion pages and update properties.
 * @module routes/validate
 */

const express = require('express');
const router = express.Router();
const { validateNotionPage } = require('../utils/validate-notion-page.cjs');

/**
 * POST /api/validate
 * Body:
 *   - pageId: string (Notion page ID, with or without hyphens) OR
 *   - pageIds: string[] (array of page IDs)
 *   - options?: {
 *       expectedMinBlocks?: number,
 *       expectedMaxBlocks?: number,
 *       expectedHeadings?: string[],
 *       sourceHtml?: string
 *     }
 *
 * Re-validates the page(s) and updates Notion properties:
 *   - Error (checkbox): true when hasErrors, false otherwise
 *   - Validation (rich_text): human-readable summary
 *   - Stats (rich_text): JSON statistics (when available)
 */
router.post('/validate', async (req, res) => {
  try {
    const notion = global.notion;
    if (!notion) {
      return res.status(500).json({ success: false, error: 'NOTION_CLIENT_UNINITIALIZED', message: 'Notion client not initialized' });
    }

    const { pageId, pageIds, options = {} } = req.body || {};
    const ids = Array.isArray(pageIds) ? pageIds : pageId ? [pageId] : [];

    if (ids.length === 0) {
      return res.status(400).json({ success: false, error: 'MISSING_PAGE_ID', message: 'Provide pageId or pageIds in request body' });
    }

    const results = [];

    for (const rawId of ids) {
      const id = typeof rawId === 'string' ? rawId.replace(/-/g, '') : String(rawId);
      try {
        const validation = await validateNotionPage(notion, id, options, console.log);

        // Get the current page to see what properties exist
        const page = await notion.pages.retrieve({ page_id: id });
        const existingProps = Object.keys(page.properties);

        console.log(`🔍 [VALIDATE] Page has properties: ${existingProps.join(', ')}`);
        console.log(`🔍 [VALIDATE] Looking for: Error, Audit/Validation, ContentComparison/Stats`);

        // Build property updates only for properties that exist
        const props = {};

        // Always try to update Error checkbox if it exists
        if (existingProps.includes('Error')) {
          props.Error = { checkbox: !!validation.hasErrors };
          console.log(`✅ [VALIDATE] Will update Error property`);
        } else {
          console.log(`❌ [VALIDATE] Error property not found`);
        }

        // Get current property values to check if they contain detailed PATCH/POST data
        const currentAuditProp = page.properties.Audit || page.properties.Validation;
        const currentStatsProp = page.properties.ContentComparison || page.properties.Stats;
        
        // Extract current text content
        const getCurrentText = (prop) => {
          if (!prop || !prop.rich_text || prop.rich_text.length === 0) return '';
          return prop.rich_text.map(rt => rt.text?.content || '').join('');
        };
        
        const currentAuditText = getCurrentText(currentAuditProp);
        const currentStatsText = getCurrentText(currentStatsProp);
        
        // Check if properties already contain detailed PATCH/POST data
        const hasDetailedAuditData = currentAuditText.includes('Content Audit:') || 
                                    currentAuditText.includes('Coverage:') ||
                                    currentAuditText.includes('Missing:') ||
                                    currentAuditText.includes('Extra:');
        
        const hasDetailedStatsData = currentStatsText.includes('Content Comparison:') ||
                                    currentStatsText.includes('• Tables:') ||
                                    currentStatsText.includes('• Images:') ||
                                    currentStatsText.includes('Source → Notion');
        
        console.log(`🔍 [VALIDATE] Current Audit content preview: "${currentAuditText.substring(0, 50)}..."`);
        console.log(`🔍 [VALIDATE] Current Stats content preview: "${currentStatsText.substring(0, 50)}..."`);
        console.log(`🔍 [VALIDATE] Has detailed audit data: ${hasDetailedAuditData}`);
        console.log(`🔍 [VALIDATE] Has detailed stats data: ${hasDetailedStatsData}`);

        // Try Audit/Validation property - skip if already has detailed PATCH/POST data
        if (existingProps.includes('Audit')) {
          if (hasDetailedAuditData) {
            console.log(`⏭️ [VALIDATE] Skipping Audit property update - already contains detailed PATCH/POST data`);
          } else {
            props.Audit = {
              rich_text: [
                { type: 'text', text: { content: validation.summary || (validation.hasErrors ? '❌ Validation failed' : '✅ Validation passed') } }
              ]
            };
            console.log(`✅ [VALIDATE] Will update Audit property`);
          }
        } else if (existingProps.includes('Validation')) {
          if (hasDetailedAuditData) {
            console.log(`⏭️ [VALIDATE] Skipping Validation property update - already contains detailed PATCH/POST data`);
          } else {
            props.Validation = {
              rich_text: [
                { type: 'text', text: { content: validation.summary || (validation.hasErrors ? '❌ Validation failed' : '✅ Validation passed') } }
              ]
            };
            console.log(`✅ [VALIDATE] Will update Validation property`);
          }
        } else {
          console.log(`❌ [VALIDATE] Neither Audit nor Validation property found`);
        }

        // Try ContentComparison/Stats property - skip if already has detailed PATCH/POST data
        // NOTE: Validate endpoint cannot update ContentComparison/Stats properties meaningfully
        // because it doesn't have source HTML for block count comparisons
        if (existingProps.includes('ContentComparison')) {
          if (hasDetailedStatsData) {
            console.log(`⏭️ [VALIDATE] Skipping ContentComparison property update - already contains detailed PATCH/POST data`);
          } else {
            console.log(`⏭️ [VALIDATE] Skipping ContentComparison property update - no source HTML for comparison`);
          }
        } else if (existingProps.includes('Stats')) {
          if (hasDetailedStatsData) {
            console.log(`⏭️ [VALIDATE] Skipping Stats property update - already contains detailed PATCH/POST data`);
          } else {
            console.log(`⏭️ [VALIDATE] Skipping Stats property update - no source HTML for comparison`);
          }
        }

        console.log(`🔄 [VALIDATE] Final properties to update: ${Object.keys(props).join(', ')}`);

        if (Object.keys(props).length === 0) {
          console.log(`⚠️ [VALIDATE] No compatible properties found to update`);
          results.push({ pageId: id, success: true, hasErrors: !!validation.hasErrors, warning: 'No compatible properties found' });
          continue;
        }

        await notion.pages.update({ page_id: id, properties: props });

        results.push({ pageId: id, success: true, hasErrors: !!validation.hasErrors });
      } catch (e) {
        results.push({ pageId: rawId, success: false, error: e.message || String(e) });
      }
    }

    const summary = {
      total: results.length,
      updated: results.filter(r => r.success).length,
      failed: results.filter(r => !r.success).length,
      errorsCleared: results.filter(r => r.success && !r.hasErrors).length
    };

    return res.json({ success: true, data: { results, summary } });
  } catch (err) {
    return res.status(500).json({ success: false, error: 'SERVER_ERROR', message: err.message || String(err) });
  }
});

module.exports = router;
