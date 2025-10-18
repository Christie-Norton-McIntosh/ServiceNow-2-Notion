
/**
 * @file Express route for ServiceNow-2-Notion upload endpoints.
 * @module routes/upload
 */

const express = require('express');
const path = require('path');
const router = express.Router();

/**
 * Returns runtime global context for Notion upload operations.
 * @returns {Object} Global context
 */
function getGlobals() {
  return {
    notion: global.notion,
    log: global.log,
    sendSuccess: global.sendSuccess,
    sendError: global.sendError,
    ensureFileUploadAvailable: global.ensureFileUploadAvailable,
    downloadAndUploadImage: global.downloadAndUploadImage,
    uploadBufferToNotion: global.uploadBufferToNotion
  };
}

router.post('/fetch-and-upload', async (req, res) => {
  const { log, sendSuccess, sendError, downloadAndUploadImage } = getGlobals();
  try {
    const { url, filename, alt } = req.body || {};
    if (!url)
      return sendError(
        res,
        "MISSING_URL",
        "Missing 'url' in request body",
        null,
        400
      );
    log("fetch-and-upload ->", url);
    const uploadId = await downloadAndUploadImage(
      url,
      alt || filename || "image"
    );
    if (!uploadId)
      return sendError(
        res,
        "UPLOAD_FAILED",
        "Failed to download or upload image",
        null,
        500
      );
    return sendSuccess(res, {
      fileUploadId: uploadId,
      fileName: filename || alt || path.basename(url),
    });
  } catch (err) {
    log("fetch-and-upload error:", err && err.message);
    return sendError(res, "SERVER_ERROR", err && err.message, null, 500);
  }
});

router.post('/upload-to-notion', async (req, res) => {
  const { log, sendSuccess, sendError, ensureFileUploadAvailable, uploadBufferToNotion } = getGlobals();
  try {
    if (!ensureFileUploadAvailable())
      return sendError(
        res,
        "NOTION_UPLOAD_NOT_AVAILABLE",
        "Notion file upload not available (NOTION_TOKEN missing)",
        null,
        500
      );

    let filename;
    let buffer;

    if (req.body && req.body.data) {
      const data = req.body.data;
      const match = String(data).match(/^data:(.+);base64,(.*)$/);
      if (match) {
        const mimeType = match[1];
        const b64 = match[2];
        buffer = Buffer.from(b64, "base64");
        const ext = mimeType.split("/").pop().split("+")[0];
        filename = req.body.filename || `upload.${ext}`;
      } else {
        buffer = Buffer.from(String(data), "base64");
        filename = req.body.filename || `upload.bin`;
      }
    } else if (req.body && req.body.base64 && req.body.filename) {
      buffer = Buffer.from(req.body.base64, "base64");
      filename = req.body.filename;
    } else {
      return sendError(
        res,
        "NO_FILE_DATA",
        "No file data provided (expected data:dataURI or base64 + filename)",
        null,
        400
      );
    }

    const mimeType = req.body.mimeType || null;
    const fileUploadId = await uploadBufferToNotion(
      buffer,
      filename,
      mimeType || "application/octet-stream"
    );
    if (!fileUploadId)
      return sendError(res, "UPLOAD_FAILED", "Upload failed", null, 500);
    return sendSuccess(res, { fileUploadId, fileName: filename });
  } catch (err) {
    log("upload-to-notion error:", err && err.message);
    return sendError(
      res,
      "SERVER_ERROR",
      err.message || "internal error",
      null,
      500
    );
  }
});

module.exports = router;