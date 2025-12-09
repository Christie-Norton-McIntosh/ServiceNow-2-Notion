/**
 * @file pages.cjs
 * @description Route handlers for retrieving Notion page properties
 * Used by batch scripts to verify validation status after PATCH operations
 */

const express = require('express');
const router = express.Router();

/**
 * GET /api/pages/:id
 * Retrieve Notion page properties by page ID
 * @param {string} id - Page ID (with or without hyphens)
 * @returns {Object} Notion page object with properties
 */
router.get('/pages/:id', async (req, res) => {
  try {
    const notion = global.notion;
    if (!notion) {
      return res.status(500).json({ 
        success: false, 
        error: 'NOTION_CLIENT_UNINITIALIZED', 
        message: 'Notion client not initialized' 
      });
    }

    // Normalize page ID (remove hyphens for Notion API)
    const pageId = req.params.id.replace(/-/g, '');
    
    if (!pageId || pageId.length !== 32) {
      return res.status(400).json({ 
        success: false, 
        error: 'INVALID_PAGE_ID', 
        message: 'Page ID must be 32 characters (UUID without hyphens)' 
      });
    }

    console.log(`[PAGES] Fetching page properties for: ${pageId}`);

    // Retrieve page from Notion
    const page = await notion.pages.retrieve({ page_id: pageId });

    console.log(`[PAGES] Successfully retrieved page with properties: ${Object.keys(page.properties).join(', ')}`);

    return res.json({
      success: true,
      id: page.id,
      created_time: page.created_time,
      last_edited_time: page.last_edited_time,
      properties: page.properties,
      url: page.url
    });

  } catch (err) {
    console.error(`[PAGES] Error retrieving page: ${err.message}`);
    
    // Handle specific Notion API errors
    if (err.code === 'object_not_found') {
      return res.status(404).json({ 
        success: false, 
        error: 'PAGE_NOT_FOUND', 
        message: 'Page not found or integration does not have access' 
      });
    }

    return res.status(500).json({ 
      success: false, 
      error: 'SERVER_ERROR', 
      message: err.message || String(err) 
    });
  }
});

module.exports = router;
