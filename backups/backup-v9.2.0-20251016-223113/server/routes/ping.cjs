
/**
 * @file Express route for ServiceNow-2-Notion ping endpoint.
 * @module routes/ping
 */

const express = require('express');
const router = express.Router();

/**
 * GET /api/ping
 * Returns a simple pong response with timestamp.
 * @route GET /api/ping
 * @returns {Object} JSON pong response
 */
router.get('/api/ping', (req, res) => {
  res.json({ success: true, data: { pong: true, ts: Date.now() } });
});

module.exports = router;
