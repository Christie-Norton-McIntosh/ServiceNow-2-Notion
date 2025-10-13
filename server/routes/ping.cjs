const express = require('express');
const router = express.Router();

router.get('/ping', (req, res) => {
  res.json({ success: true, data: { pong: true, ts: Date.now() } });
});

module.exports = router;
