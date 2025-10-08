/*
 - W2N-Proxy/martian-helper.js
 - Clean implementation: conversion helpers and Notion upload utilities.
 */

const axios = require("axios");
const { v4: uuidv4 } = require("uuid");
const crypto = require("crypto");
const fs = require("fs");
const path = require("path");
let martian = null;
try {
  martian = require("@tryfabric/martian");
} catch (e) {
  martian = null;
}

let notionClient = null;
function setNotionClient(client) {
  notionClient = client;
}

async function convertToNotionBlocks(
  input,
  { from = "markdown", options = {} } = {}
) {
  if (!martian)
    throw new Error("Martian not installed. Run npm install in W2N-Proxy");

  // Default options based on Martian documentation to enable key features
  const defaultOptions = {
    enableEmojiCallouts: true, // Enable emoji-style callouts (📘 Note: ...)
    strictImageUrls: false, // CHANGED: Don't validate image URLs to avoid converting images to text - let proxy handle image processing
    nonInline: "ignore", // Ignore non-inline elements when parsing rich text
    notionLimits: {
      truncate: false, // Don't truncate - we handle chunking in the proxy
      onError: (err) => {
        if (
          typeof window !== "undefined"
            ? window.SN2N_REF_DEBUG
            : process && process.env && process.env.SN2N_REF_DEBUG
        )
          console.log(`🔍 Martian Notion limits warning: ${err.message}`);
      },
    },
  };

  // Merge user options with defaults
  const martianOptions = { ...defaultOptions, ...options };

  let blocks;

  if (from === "markdown") {
    if (typeof martian.markdownToBlocks === "function")
      blocks = await martian.markdownToBlocks(input, martianOptions);
    else if (typeof martian.markdownToNotion === "function")
      blocks = await martian.markdownToNotion(input, martianOptions);
    else if (typeof martian.toNotion === "function")
      blocks = await martian.toNotion(input, {
        format: "markdown",
        ...martianOptions,
      });
  } else if (from === "html") {
    if (typeof martian.htmlToBlocks === "function")
      blocks = await martian.htmlToBlocks(input, martianOptions);
    else if (typeof martian.htmlToNotion === "function")
      blocks = await martian.htmlToNotion(input, martianOptions);
    else if (typeof martian.toNotion === "function")
      blocks = await martian.toNotion(input, {
        format: "html",
        ...martianOptions,
      });
  } else {
    throw new Error("Unsupported conversion or martian API missing");
  }

  // Post-process blocks to style table headers, flatten nested lists, and convert toggle patterns
  if (blocks && Array.isArray(blocks)) {
    console.log(
      `[DEBUG] Processing ${blocks.length} blocks for table/list fixes`
    );
    const blockTypes = blocks.map((b) => b.type).filter(Boolean);
    console.log(`[DEBUG] Block types found: ${JSON.stringify(blockTypes)}`);
    const tableBlocks = blocks.filter((b) => b.type === "table");
    console.log(
      `[DEBUG] Found ${tableBlocks.length} table blocks BEFORE processing`
    );

    blocks = blocks.map((block) => styleTableHeaders(block));
    blocks = flattenNestedBulletLists(blocks);
    blocks = flattenNestedNumberedLists(blocks);
    blocks = convertTogglePatterns(blocks);

    // Check for tables again after toggle processing (tables might be created there)
    const finalTableBlocks = blocks.filter((b) => b.type === "table");
    console.log(
      `[DEBUG] Found ${finalTableBlocks.length} table blocks AFTER toggle processing`
    );

    // Process tables again if any were created during toggle processing
    if (finalTableBlocks.length > 0) {
      console.log(
        `[DEBUG] Running final table processing on ${finalTableBlocks.length} tables`
      );
      blocks = blocks.map((block) => styleTableHeaders(block));
    }
  }
  return blocks;
}

function styleTableHeaders(block) {
  // Check if this is a table block
  if (block.type === "table" && block.table) {
    console.log(
      `[DEBUG] Processing table with ${block.table.children?.length || 0} rows`
    );

    // Validate and fix table structure first
    if (block.table.children && block.table.children.length > 0) {
      // Find the expected number of columns from the table width or first row
      let expectedColumns = block.table.table_width || 0;
      console.log(`[DEBUG] Initial expectedColumns: ${expectedColumns}`);

      // If no table_width is set, use the first row to determine column count
      if (
        !expectedColumns &&
        block.table.children[0] &&
        block.table.children[0].table_row &&
        block.table.children[0].table_row.cells
      ) {
        expectedColumns = block.table.children[0].table_row.cells.length;
        console.log(
          `[DEBUG] Determined expectedColumns from first row: ${expectedColumns}`
        );
      }

      // Fix all rows to match the expected column count
      if (expectedColumns > 0) {
        console.log(
          `[DEBUG] Fixing ${block.table.children.length} rows to match ${expectedColumns} columns`
        );
        block.table.children = block.table.children.map((row, rowIndex) => {
          if (
            row.type === "table_row" &&
            row.table_row &&
            row.table_row.cells
          ) {
            const currentCells = row.table_row.cells.length;
            console.log(
              `[DEBUG] Row ${rowIndex}: has ${currentCells} cells, expected ${expectedColumns}`
            );

            if (currentCells < expectedColumns) {
              // Add empty cells to match expected width
              const emptyCellsNeeded = expectedColumns - currentCells;
              console.log(
                `[DEBUG] Row ${rowIndex}: Adding ${emptyCellsNeeded} empty cells`
              );
              const emptyCells = Array(emptyCellsNeeded).fill([
                {
                  type: "text",
                  text: { content: "" },
                  annotations: {},
                },
              ]);
              row.table_row.cells = [...row.table_row.cells, ...emptyCells];
            } else if (currentCells > expectedColumns) {
              // Truncate excess cells
              console.log(
                `[DEBUG] Row ${rowIndex}: Truncating from ${currentCells} to ${expectedColumns} cells`
              );
              row.table_row.cells = row.table_row.cells.slice(
                0,
                expectedColumns
              );
            }
          } else {
            console.log(
              `[DEBUG] Row ${rowIndex}: Not a table_row or missing structure`,
              row?.type
            );
          }
          return row;
        });

        // Ensure table_width is set correctly
        block.table.table_width = expectedColumns;
        console.log(`[DEBUG] Set table_width to: ${expectedColumns}`);
      } else {
        console.log(
          `[DEBUG] No expectedColumns determined, skipping table processing`
        );
      }
    }

    // Style the first row (header) with bold formatting (no background color)
    if (block.table.children && block.table.children.length > 0) {
      const headerRow = block.table.children[0];
      if (
        headerRow.type === "table_row" &&
        headerRow.table_row &&
        headerRow.table_row.cells
      ) {
        headerRow.table_row.cells = headerRow.table_row.cells.map((cell) => {
          // Add bold formatting to each header cell (no background)
          if (Array.isArray(cell) && cell.length > 0) {
            return cell.map((richText) => ({
              ...richText,
              annotations: {
                ...richText.annotations,
                bold: true,
                // Remove any background color - not supported in table cells
              },
            }));
          }
          return cell;
        });
      }
    }

    // ✅ FIX LINE BREAKS - Process all table cells to handle line break separators
    console.log(`[DEBUG] Processing line breaks in all table cells`);
    let lineBreaksProcessed = 0;

    if (block.table.children && block.table.children.length > 0) {
      block.table.children.forEach((row, rowIndex) => {
        if (row.type === "table_row" && row.table_row && row.table_row.cells) {
          row.table_row.cells = row.table_row.cells.map((cell, cellIndex) => {
            if (Array.isArray(cell) && cell.length > 0) {
              // Process each rich text element in the cell
              const processedCell = [];

              cell.forEach((richText) => {
                if (
                  richText.type === "text" &&
                  richText.text &&
                  richText.text.content
                ) {
                  const content = richText.text.content;

                  // Check for line break indicators (newlines, pipes, etc.)
                  if (content.includes("\n") || content.includes(" | ")) {
                    // Split content on line break indicators
                    let parts = content.split(/\n+|\s*\|\s*/);
                    parts = parts.filter((part) => part.trim().length > 0);

                    if (parts.length > 1) {
                      console.log(
                        `[DEBUG] Row ${rowIndex}, Cell ${cellIndex}: Split "${content}" into ${parts.length} parts`
                      );
                      lineBreaksProcessed++;

                      // Create separate rich text elements for each part
                      parts.forEach((part, partIndex) => {
                        processedCell.push({
                          ...richText,
                          text: {
                            ...richText.text,
                            content: part.trim(),
                          },
                        });

                        // Add line break between parts (except after the last one)
                        if (partIndex < parts.length - 1) {
                          processedCell.push({
                            type: "text",
                            text: { content: "\n" },
                            annotations: {},
                          });
                        }
                      });
                    } else {
                      processedCell.push(richText);
                    }
                  } else {
                    processedCell.push(richText);
                  }
                } else {
                  processedCell.push(richText);
                }
              });

              return processedCell;
            }
            return cell;
          });
        }
      });
    }

    console.log(
      `[DEBUG] Processed line breaks in ${lineBreaksProcessed} table cells`
    );
  }

  // Recursively process child blocks
  if (block.children && Array.isArray(block.children)) {
    block.children = block.children.map((child) => styleTableHeaders(child));
  }

  return block;
}

function flattenNestedBulletLists(blocks) {
  const result = [];

  for (const block of blocks) {
    if (block.type === "bulleted_list_item" && block.bulleted_list_item) {
      // Create a new block without nested children
      const flatBlock = {
        type: "bulleted_list_item",
        bulleted_list_item: {
          rich_text: block.bulleted_list_item.rich_text || [],
        },
      };

      result.push(flatBlock);

      // If there were children, add them as separate top-level bullet items
      if (
        block.bulleted_list_item.children &&
        Array.isArray(block.bulleted_list_item.children)
      ) {
        const childBlocks = flattenNestedBulletLists(
          block.bulleted_list_item.children
        );

        // Add indentation to the text content to maintain visual hierarchy
        childBlocks.forEach((childBlock) => {
          if (
            childBlock.type === "bulleted_list_item" &&
            childBlock.bulleted_list_item.rich_text
          ) {
            // Add indentation by modifying the first rich text element
            if (childBlock.bulleted_list_item.rich_text.length > 0) {
              const firstText = childBlock.bulleted_list_item.rich_text[0];
              if (firstText.text && firstText.text.content) {
                firstText.text.content = "    " + firstText.text.content; // 4 spaces for indentation
              }
            }
          }
          result.push(childBlock);
        });
      }
    } else {
      // Non-bullet list blocks, process recursively if needed
      if (block.children && Array.isArray(block.children)) {
        const processedBlock = { ...block };
        processedBlock.children = flattenNestedBulletLists(block.children);
        result.push(processedBlock);
      } else {
        result.push(block);
      }
    }
  }

  return result;
}

function flattenNestedNumberedLists(blocks) {
  const result = [];

  for (const block of blocks) {
    if (block.type === "numbered_list_item" && block.numbered_list_item) {
      // Create a new block without nested children
      const flatBlock = {
        type: "numbered_list_item",
        numbered_list_item: {
          rich_text: block.numbered_list_item.rich_text || [],
        },
      };

      result.push(flatBlock);

      // If there were children, add them as separate top-level numbered items
      if (
        block.numbered_list_item.children &&
        Array.isArray(block.numbered_list_item.children)
      ) {
        const childBlocks = flattenNestedNumberedLists(
          block.numbered_list_item.children
        );

        // Add indentation to the text content to maintain visual hierarchy
        childBlocks.forEach((childBlock) => {
          if (
            childBlock.type === "numbered_list_item" &&
            childBlock.numbered_list_item.rich_text
          ) {
            // Add indentation by modifying the first rich text element
            if (childBlock.numbered_list_item.rich_text.length > 0) {
              const firstText = childBlock.numbered_list_item.rich_text[0];
              if (firstText.text && firstText.text.content) {
                firstText.text.content = "    " + firstText.text.content; // 4 spaces for indentation
              }
            }
          }
          result.push(childBlock);
        });
      }
    } else {
      // Non-numbered list blocks, process recursively if needed
      if (block.children && Array.isArray(block.children)) {
        const processedBlock = { ...block };
        processedBlock.children = flattenNestedNumberedLists(block.children);
        result.push(processedBlock);
      } else {
        result.push(block);
      }
    }
  }

  return result;
}

function convertTogglePatterns(blocks) {
  const result = [];

  for (let i = 0; i < blocks.length; i++) {
    const block = blocks[i];

    // Look for H3 heading blocks that contain "(h3toggle)" pattern
    if (
      block.type === "heading_3" &&
      block.heading_3 &&
      block.heading_3.rich_text
    ) {
      const text = block.heading_3.rich_text
        .map((rt) => rt.plain_text || rt.text?.content || "")
        .join("");

      // Check if this looks like an H3 toggle pattern
      if (text.includes("(h3toggle)")) {
        // Create the toggle title by removing "(h3toggle)"
        const toggleTitle = text.replace(/\s*\(h3toggle\)\s*$/i, "").trim();

        // Collect following blocks until we hit another heading or reach end
        const children = [];
        let j = i + 1;

        while (j < blocks.length) {
          const nextBlock = blocks[j];

          // Stop if we hit another heading or another toggle pattern
          if (
            nextBlock.type === "heading_1" ||
            nextBlock.type === "heading_2" ||
            nextBlock.type === "heading_3" ||
            (nextBlock.type === "paragraph" &&
              nextBlock.paragraph?.rich_text?.some((rt) =>
                (rt.plain_text || rt.text?.content || "").includes("(toggle)")
              )) ||
            (nextBlock.type === "heading_3" &&
              nextBlock.heading_3?.rich_text?.some((rt) =>
                (rt.plain_text || rt.text?.content || "").includes("(h3toggle)")
              ))
          ) {
            break;
          }

          children.push(nextBlock);
          j++;
        }

        // Flatten nested bullet lists and numbered lists to comply with Notion limits
        let flattenedChildren = flattenNestedBulletLists(children);
        flattenedChildren = flattenNestedNumberedLists(flattenedChildren);

        // Create the H3 toggle block - Notion uses heading_3 type with is_toggleable: true
        const toggleBlock = {
          type: "heading_3",
          heading_3: {
            rich_text: [
              {
                type: "text",
                text: { content: toggleTitle },
                annotations: {
                  bold: false,
                  italic: false,
                  strikethrough: false,
                  underline: false,
                  code: false,
                  color: "default",
                },
              },
            ],
            is_toggleable: true,
            children: flattenedChildren,
          },
        };

        result.push(toggleBlock);

        // Skip the blocks we consumed as children
        i = j - 1; // -1 because the loop will increment
      } else {
        // Regular H3 heading, process recursively if needed
        if (block.children && Array.isArray(block.children)) {
          block.children = convertTogglePatterns(block.children);
        }
        result.push(block);
      }
    }
    // Look for paragraph blocks that contain "(toggle)" pattern (regular toggles)
    else if (
      block.type === "paragraph" &&
      block.paragraph &&
      block.paragraph.rich_text
    ) {
      const text = block.paragraph.rich_text
        .map((rt) => rt.plain_text || rt.text?.content || "")
        .join("");

      // Check if this looks like a toggle header pattern
      if (text.includes("(toggle)")) {
        // Create the toggle title by removing "(toggle)"
        const toggleTitle = text.replace(/\s*\(toggle\)\s*$/i, "").trim();

        // Collect following blocks until we hit another heading or reach end
        const children = [];
        let j = i + 1;

        while (j < blocks.length) {
          const nextBlock = blocks[j];

          // Stop if we hit another heading or another toggle pattern
          if (
            nextBlock.type === "heading_1" ||
            nextBlock.type === "heading_2" ||
            nextBlock.type === "heading_3" ||
            (nextBlock.type === "paragraph" &&
              nextBlock.paragraph?.rich_text?.some((rt) =>
                (rt.plain_text || rt.text?.content || "").includes("(toggle)")
              )) ||
            (nextBlock.type === "heading_3" &&
              nextBlock.heading_3?.rich_text?.some((rt) =>
                (rt.plain_text || rt.text?.content || "").includes("(h3toggle)")
              ))
          ) {
            break;
          }

          children.push(nextBlock);
          j++;
        }

        // Flatten nested bullet lists and numbered lists to comply with Notion limits
        let flattenedChildren = flattenNestedBulletLists(children);
        flattenedChildren = flattenNestedNumberedLists(flattenedChildren);

        // Create the regular toggle block
        const toggleBlock = {
          type: "toggle",
          toggle: {
            rich_text: [
              {
                type: "text",
                text: { content: toggleTitle },
                annotations: {
                  bold: false,
                  italic: false,
                  strikethrough: false,
                  underline: false,
                  code: false,
                  color: "default",
                },
              },
            ],
            children: flattenedChildren,
          },
        };

        result.push(toggleBlock);

        // Skip the blocks we consumed as children
        i = j - 1; // -1 because the loop will increment
      } else {
        // Regular paragraph, process recursively if needed
        if (block.children && Array.isArray(block.children)) {
          block.children = convertTogglePatterns(block.children);
        }
        result.push(block);
      }
    } else {
      // Other block types, process recursively if needed
      if (block.children && Array.isArray(block.children)) {
        block.children = convertTogglePatterns(block.children);
      }
      result.push(block);
    }
  }

  return result;
}

async function uploadFileToNotion(buffer, filename) {
  if (!notionClient)
    throw new Error("Notion client not injected. Call setNotionClient(notion)");

  // Defensive check: some @notionhq/client versions do not expose fileUploads
  if (
    !notionClient.fileUploads ||
    typeof notionClient.fileUploads.create !== "function" ||
    typeof notionClient.fileUploads.send !== "function"
  ) {
    const available = Object.keys(notionClient || {}).join(", ");
    throw new Error(
      `Notion SDK file upload API not available. Update @notionhq/client to a version that provides fileUploads.create/send or use external image URLs. Notion client available keys: ${available}`
    );
  }

  // Determine content type from filename extension
  const ext = (filename || "").split(".").pop().toLowerCase();
  const ctMap = {
    png: "image/png",
    jpg: "image/jpeg",
    jpeg: "image/jpeg",
    gif: "image/gif",
    webp: "image/webp",
    pdf: "application/pdf",
    doc: "application/msword",
    docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  };
  const contentType = ctMap[ext] || "application/octet-stream";

  // Use single_part mode only for now, as multi_part is having issues
  const mode = "single_part";

  console.log(
    `[martian-helper] Starting ${mode} upload for ${filename} (${buffer.length} bytes, ${contentType})`
  );

  try {
    // Step 1: Create upload session
    const createRes = await notionClient.fileUploads.create({
      mode,
      filename: filename || `upload-${uuidv4()}`,
      content_type: contentType,
      ...(mode === "multi_part"
        ? {
            number_of_parts: Math.max(
              1,
              Math.ceil(buffer.length / (5 * 1024 * 1024))
            ),
          }
        : {}),
    });

    console.log(
      "[martian-helper] File upload session created:",
      JSON.stringify(createRes, null, 2)
    );

    const uploadId = createRes.id || createRes.file_upload_id;
    if (!uploadId) {
      throw new Error("No upload ID returned from Notion API");
    }

    // Step 2: Send the file using the SDK (let SDK handle the upload_url request)
    // Prepare data using Blob if available for better compatibility
    try {
      // Create a proper Blob for the SDK
      const { Blob } = require("buffer");
      const blob = new Blob([buffer], { type: contentType });

      console.log("[martian-helper] Sending file data to Notion...");

      // Always use the simpler single_part mode approach
      const sendRes = await notionClient.fileUploads.send({
        file_upload_id: uploadId,
        file: {
          filename: filename || `upload-${uuidv4()}`,
          data: blob,
        },
      });

      console.log(
        "[martian-helper] File upload send response:",
        JSON.stringify(sendRes, null, 2)
      );

      // Step 3: Complete the upload if necessary
      if (
        sendRes.status === "pending" &&
        typeof notionClient.fileUploads.complete === "function"
      ) {
        console.log("[martian-helper] Completing file upload...");
        await notionClient.fileUploads.complete({
          file_upload_id: uploadId,
        });
      }

      // Return the block that can be used in page creation
      const usedId = sendRes.id || uploadId;

      // Compute checksum and log upload metadata for verification
      try {
        const sha256 = crypto.createHash("sha256").update(buffer).digest("hex");
        const logDir = path.resolve(__dirname, "logs");
        if (!fs.existsSync(logDir)) fs.mkdirSync(logDir, { recursive: true });
        const logFile = path.join(logDir, "upload-checks.json");
        let data = {};
        try {
          data = fs.existsSync(logFile)
            ? JSON.parse(fs.readFileSync(logFile, "utf8") || "{}")
            : {};
        } catch (e) {
          data = {};
        }
        data[usedId] = {
          fileUploadId: usedId,
          filename: filename || null,
          size: buffer.length,
          sha256,
          timestamp: new Date().toISOString(),
          request_id: (sendRes && sendRes.request_id) || null,
        };
        fs.writeFileSync(logFile, JSON.stringify(data, null, 2));
        console.log(
          "[martian-helper] Wrote upload-checks.json entry for",
          usedId
        );
      } catch (e) {
        console.log(
          "[martian-helper] Failed to write upload log:",
          e && e.message
        );
      }
      return {
        fileUploadId: usedId,
        block: {
          object: "block",
          type: "image",
          image: { type: "file_upload", file_upload: { id: usedId } },
        },
      };
    } catch (e) {
      console.log("[martian-helper] File upload error:", e && e.message);
      if (e.response) {
        console.log(
          "[martian-helper] Error response:",
          e.response.status,
          e.response.data
        );
      }
      throw e;
    }
  } catch (e) {
    console.log("[martian-helper] File upload session error:", e && e.message);
    if (e.response) {
      console.log(
        "[martian-helper] Session error response:",
        e.response.status,
        e.response.data
      );
    }
    throw e;
  }
}

async function prepareImageBlocks(images = []) {
  if (!Array.isArray(images) || images.length === 0) return [];
  const blocks = [];
  for (const img of images) {
    if (img.isBase64 && img.data) {
      const m = img.data.match(/^data:(.+);base64,(.*)$/);
      let buffer;
      let filename = img.alt || `upload-${uuidv4()}.png`;
      if (m) {
        buffer = Buffer.from(m[2], "base64");
        const ext = m[1].split("/").pop().split("+")[0];
        // Ensure we use a supported extension for Notion API
        const safeExt = ["png", "jpg", "jpeg", "gif", "webp"].includes(
          ext.toLowerCase()
        )
          ? ext
          : "png";
        filename = (img.filename || img.alt || `upload`) + `.${safeExt}`;
      } else {
        buffer = Buffer.from(img.data, "base64");
        // Default to PNG if no extension detected
        if (!filename.includes(".")) {
          filename += ".png";
        }
      }
      if (notionClient) {
        const up = await uploadFileToNotion(buffer, filename).catch((e) => {
          console.log("[martian-helper] Upload failed:", e && e.message);
          return null;
        });

        if (up && up.block) blocks.push(up.block);
        else if (up && up.fileUploadId)
          blocks.push({
            object: "block",
            type: "image",
            image: {
              type: "file_upload",
              file_upload: { id: up.fileUploadId },
            },
          });
      } else {
        blocks.push({
          object: "block",
          type: "image",
          image: {
            file: {
              url: img.placeholderUploadUrl || "REPLACE_WITH_UPLOADED_URL",
            },
          },
        });
      }
    } else if (img.url) {
      blocks.push({
        object: "block",
        type: "image",
        image: { external: { url: img.url } },
      });
    }
  }
  return blocks;
}

// --- PrismDrive external upload helper (fallback) -------------------------
// Uses PrismDrive API described in W2N/examples/prism-drive.md to upload a
// file and return a public URL that can be used as Notion external image URL.
// This keeps the proxy working even if Notion multipart uploads fail.
async function uploadToPrismDrive(buffer, filename) {
  // PrismDrive expects Authorization: Bearer <token> and multipart/form-data
  // We'll read PRISM_DRIVE_TOKEN from environment; return null if missing.
  const token = process.env.PRISM_DRIVE_TOKEN;
  if (!token) {
    console.log(
      "[martian-helper] PrismDrive token not configured (PRISM_DRIVE_TOKEN)"
    );
    return null;
  }
  try {
    const FormData = require("form-data");
    const fd = new FormData();
    fd.append("parentId", "Notion External Storage");
    fd.append("file", buffer, {
      filename,
      contentType: "application/octet-stream",
    });

    const res = await axios.post(
      "https://app.prismdrive.com/api/v1/uploads",
      fd,
      {
        headers: {
          ...fd.getHeaders(),
          Authorization: `Bearer ${token}`,
          Accept: "application/json",
        },
        maxBodyLength: Infinity,
        maxContentLength: Infinity,
      }
    );
    if (res && res.data && res.data.fileEntry && res.data.fileEntry.url) {
      // PrismDrive returns a relative url in examples; build absolute if needed.
      const p = res.data.fileEntry.url;
      const url = p.startsWith("http") ? p : `https://app.prismdrive.com/${p}`;
      return { url, meta: res.data.fileEntry };
    }
    console.log(
      "[martian-helper] PrismDrive upload returned unexpected body:",
      res && res.data
    );
    return null;
  } catch (err) {
    console.log(
      "[martian-helper] PrismDrive upload failed:",
      err && err.message
    );
    if (err && err.response)
      console.log(
        "[martian-helper] PrismDrive response:",
        err.response.status,
        err.response.data
      );
    return null;
  }
}

// Wrap file upload: if it fails, try external host (PrismDrive) and
// return an external image block so pages are still created successfully.
const originalUploadFileToNotion = uploadFileToNotion;
async function uploadFileWithExternalFallback(buffer, filename) {
  const result = await originalUploadFileToNotion(buffer, filename).catch(
    (e) => {
      console.log("[martian-helper] uploadFileToNotion threw:", e && e.message);
      return null;
    }
  );
  if (result && result.block) return result;
  // If Notion upload returned an object but upload failed, attempt PrismDrive.
  const prism = await uploadToPrismDrive(buffer, filename);
  if (prism && prism.url) {
    return {
      fileUploadId: null,
      block: {
        object: "block",
        type: "image",
        image: { external: { url: prism.url } },
      },
      external: true,
    };
  }
  return result;
}

// Export the module
module.exports = {
  convertToNotionBlocks,
  prepareImageBlocks,
  setNotionClient,
  uploadFileToNotion: uploadFileWithExternalFallback,
  _uploadFileToNotionRaw: originalUploadFileToNotion,
  uploadToPrismDrive,
};
