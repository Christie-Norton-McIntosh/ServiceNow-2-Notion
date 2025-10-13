const express = require('express');
const router = express.Router();

// Import required helpers from main context
const { log, sendError } = global;
const htmlToNotionBlocks = global.htmlToNotionBlocks;

router.post('/api/W2N', async (req, res) => {
  try {
    const payload = req.body;
    log && log("📝 Processing W2N request for:", payload.title);

    if (payload.contentHtml) {
      const hasPreTags = payload.contentHtml.includes("<pre");
      const hasClosingPreTags = payload.contentHtml.includes("</pre>");
      log && log(`🔍 DEBUG API: contentHtml has <pre>: ${hasPreTags}, has </pre>: ${hasClosingPreTags}`);
      if (hasPreTags) {
        const preIndex = payload.contentHtml.indexOf("<pre");
        const preSnippet = payload.contentHtml.substring(preIndex, preIndex + 200);
        log && log(`🔍 DEBUG API: Pre tag snippet: ${preSnippet}`);
      }
    }

    if (!payload.title || (!payload.content && !payload.contentHtml)) {
      return sendError && sendError(
        res,
        "MISSING_FIELDS",
        "Missing required fields: title and (content or contentHtml)",
        null,
        400
      );
    }

    if (!payload.databaseId) {
      if (payload.dryRun) {
        let children = [];
        let hasVideos = false;
        if (payload.contentHtml) {
          log && log("🔄 (dryRun) Converting HTML content to Notion blocks");
          const result = await htmlToNotionBlocks(payload.contentHtml);
          children = result.blocks;
          hasVideos = result.hasVideos;
          log && log(`✅ (dryRun) Converted HTML to ${children.length} Notion blocks`);
          if (hasVideos) {
            log && log(`🎥 (dryRun) Video content detected`);
          }
        } else if (payload.content) {
          children = [
            {
              object: "block",
              type: "paragraph",
              paragraph: { rich_text: [{ type: "text", text: { content: payload.content } }] }
            }
          ];
        }
        return res.json({ success: true, data: { children, hasVideos }, meta: {} });
      }
      return sendError && sendError(res, "MISSING_DATABASE_ID", "Missing databaseId", null, 400);
    }

    // ...existing code for Notion page creation...
    return res.json({ success: true, data: { message: "Notion page creation not implemented in route split." }, meta: {} });
  } catch (err) {
    return sendError && sendError(res, "SERVER_ERROR", err.message || String(err));
  }
});

module.exports = router;
