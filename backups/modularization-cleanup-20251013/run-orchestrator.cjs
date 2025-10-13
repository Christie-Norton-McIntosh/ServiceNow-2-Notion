const proxy = require("./sn2n-proxy.cjs");
const fs = require("fs");
const path = require("path");

async function run() {
  const html = fs.readFileSync(
    path.join(__dirname, "sample-repro.html"),
    "utf8"
  );
  const result = await proxy.htmlToNotionBlocks(html);
  const markerMap = proxy.collectAndStripMarkers(result.blocks, {});
  // Remove collected trailing blocks from the main children list (same as server flow)
  const removed = proxy.removeCollectedBlocks(result.blocks);
  if (removed > 0)
    console.log("Removed collected trailing blocks from children:", removed);
  // Strip any private helper keys before sending to Notion
  proxy.deepStripPrivateKeys(result.blocks);

  // Use provided env vars from server/.env (dotenv is loaded in sn2n-proxy)
  const databaseId =
    process.env.DATABASE_ID ||
    process.env.NOTION_DATABASE_ID ||
    process.env.NOTION_PAGE_ID ||
    process.env.NOTION_TEST_DATABASE ||
    "282a89fe-dba5-815e-91f0-db972912ef9f";

  console.log("Creating page in database:", databaseId);

  // Build a minimal payload similar to W2N endpoint
  const payload = {
    title: "SN2N Orchestrator Repro - " + new Date().toISOString(),
    databaseId: databaseId,
    contentHtml: html,
  };

  // Call the same code path used by the server to create the page and run orchestrator
  const fakeReq = { body: payload };
  const fakeRes = {
    status: (n) => ({ json: (o) => console.log("res", n, o) }),
  };

  // We can call the internal function by invoking the /api/W2N handler indirectly by calling htmlToNotionBlocks and then using Notion SDK calls directly here.
  // Simpler: replicate the create + append + orchestrator flow using exported helpers.

  // Create full children set AFTER cleanup so no private helper keys are included
  const children = result.blocks;

  // Recompute slices after removeCollectedBlocks + deepStripPrivateKeys
  const initialBlocks = children.slice(0, 100);
  const remainingBlocks = children.slice(100);

  // Create page using cleaned initial blocks
  const response = await proxy.notion.pages.create({
    parent: { database_id: payload.databaseId },
    properties: { Name: { title: [{ text: { content: payload.title } }] } },
    children: initialBlocks,
  });
  console.log("Page created:", response.id, response.url);

  if (remainingBlocks.length > 0) {
    await proxy.appendBlocksToBlockId(response.id, remainingBlocks);
    console.log("Remaining blocks appended");
  }

  // Run orchestrator with our markerMap
  const orch = await proxy.orchestrateDeepNesting(response.id, markerMap);
  console.log("Orchestrator result:", orch);

  // List page children to verify
  const list = await proxy.notion.blocks.children.list({
    block_id: response.id,
    page_size: 200,
  });
  fs.writeFileSync(
    path.join(__dirname, "logs", "orchestrator-result.json"),
    JSON.stringify({ page: response, children: list.results }, null, 2)
  );
  console.log("Wrote logs/orchestrator-result.json");
}

run().catch((e) => {
  console.error("run-orchestrator error", (e && e.message) || e);
  process.exit(1);
});
