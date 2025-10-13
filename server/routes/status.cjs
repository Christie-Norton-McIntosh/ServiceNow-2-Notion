
/**
 * @file Express route for ServiceNow-2-Notion status endpoint.
 * @module routes/status
 */

const express = require('express');
const router = express.Router();

/**
 * GET /api/status
 * Returns service status, version, uptime, and timestamp.
 * @route GET /api/status
 * @returns {Object} JSON status response
 */
router.get('/api/status', (req, res) => {
  res.json({
    success: true,
    data: {
      service: 'sn2n-proxy',
      version: process.env.npm_package_version || 'dev',
      uptime: process.uptime(),
      timestamp: new Date().toISOString(),
    },
    meta: {}
  });
});

module.exports = router;
