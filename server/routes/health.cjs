const express = require('express');
const router = express.Router();

router.get('/health', (req, res) => {
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
