#!/usr/bin/env node
// Simple test script to exercise the /api/blocks/append endpoint
const axios = require("axios");
const path = require("path");

async function run() {
  const base = process.env.SN2N_PROXY_BASE || "http://localhost:3004";
  const url = `${base.replace(/\/$/, "")}/api/blocks/append`;

  const parentBlockId = process.env.TEST_PARENT_BLOCK_ID;
  if (!parentBlockId) {
    console.error(
      "Please set TEST_PARENT_BLOCK_ID env var to a valid Notion block id (page id or block id)"
    );
    process.exit(1);
  }

  // Example children: a numbered_list_item child with a nested bulleted_list_item as children
  const children = [
    {
      object: "block",
      type: "numbered_list_item",
      numbered_list_item: {
        rich_text: [
          { type: "text", text: { content: "Step with nested details" } },
        ],
        children: [
          {
            object: "block",
            type: "bulleted_list_item",
            bulleted_list_item: {
              rich_text: [
                { type: "text", text: { content: "Nested bullet A" } },
              ],
            },
          },
          {
            object: "block",
            type: "bulleted_list_item",
            bulleted_list_item: {
              rich_text: [
                { type: "text", text: { content: "Nested bullet B" } },
              ],
            },
          },
        ],
      },
    },
    {
      object: "block",
      type: "paragraph",
      paragraph: {
        rich_text: [
          {
            type: "text",
            text: { content: "A paragraph appended after the list" },
          },
        ],
      },
    },
  ];

  try {
    console.log("Posting to", url, "parentBlockId=", parentBlockId);
    const resp = await axios.post(
      url,
      { blockId: parentBlockId, children },
      { timeout: 60000 }
    );
    console.log("Response:", resp.data);
  } catch (err) {
    console.error(
      "Request failed:",
      err.response ? err.response.data : err.message
    );
    process.exit(1);
  }
}

run();
