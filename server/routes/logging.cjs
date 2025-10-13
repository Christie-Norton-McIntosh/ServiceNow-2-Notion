
/**
 * @file Express route for ServiceNow-2-Notion logging endpoint.
 * @module routes/logging
 */

const express = require('express');
const router = express.Router();

/**
 * GET /api/logging
 * Returns current verbose and extraDebug logging states.
 * @route GET /api/logging
 * @returns {Object} JSON logging state
 */
router.get('/api/logging', (req, res) => {
  res.json({
    success: true,
    data: {
      verbose: global.getVerbose ? global.getVerbose() : false,
      extraDebug: global.getExtraDebug ? global.getExtraDebug() : false,
    },
    meta: {}
  });
});

/**
 * POST /api/logging
 * Updates verbose and extraDebug logging states.
 * @route POST /api/logging
 * @param {boolean} verbose - Enable/disable verbose logging
 * @param {boolean} extraDebug - Enable/disable extra debug logging
 * @returns {Object} JSON updated logging state
 */
router.post('/api/logging', (req, res) => {
  try {
    const { verbose, extraDebug } = req.body || {};
    const response = {};
    if (typeof global.setVerbose === 'function' && typeof verbose !== 'undefined') {
      response.verbose = global.setVerbose(!!verbose);
    } else {
      response.verbose = global.getVerbose ? global.getVerbose() : false;
    }
    if (typeof global.setExtraDebug === 'function' && typeof extraDebug !== 'undefined') {
      response.extraDebug = global.setExtraDebug(!!extraDebug);
    } else {
      response.extraDebug = global.getExtraDebug ? global.getExtraDebug() : false;
    }
    res.json({ success: true, data: response, meta: {} });
  } catch (e) {
    res.status(500).json({ success: false, error: 'SERVER_ERROR', message: e.message || String(e), details: null });
  }
});

module.exports = router;
