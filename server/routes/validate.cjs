
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

        // Build property updates
        const props = {
          Error: { checkbox: !!validation.hasErrors },
          Validation: {
            rich_text: [
              { type: 'text', text: { content: validation.summary || (validation.hasErrors ? '❌ Validation failed' : '✅ Validation passed') } }
            ]
          }
        };

        if (validation.stats) {
          props.Stats = {
            rich_text: [
              { type: 'text', text: { content: JSON.stringify(validation.stats, null, 2) } }
            ]
          };
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
