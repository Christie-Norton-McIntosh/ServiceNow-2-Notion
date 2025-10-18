
/**
 * @file Express route for ServiceNow-2-Notion health check endpoint.
 * @module routes/health
 */

const express = require('express');
const router = express.Router();

/**
 * GET /api/health
 * Returns health status, version, and Notion client state.
 * @route GET /api/health
 * @returns {Object} JSON health status
 */
router.get('/api/health', (req, res) => {
  return res.json({
    success: true,
    data: {
      status: 'ok',
      version: process.env.npm_package_version || 'dev',
      notion: {
        tokenConfigured: !!process.env.NOTION_TOKEN,
        clientInitialized: !!global.notion,
      },
      ts: new Date().toISOString(),
    },
    meta: {}
  });
});

module.exports = router;
