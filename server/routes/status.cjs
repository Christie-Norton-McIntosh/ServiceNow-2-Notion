const express = require('express');
const router = express.Router();

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
