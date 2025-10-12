const fs = require("fs");
const path = require("path");
const proxy = require("./sn2n-proxy.cjs");

async function run() {
  const html = fs.readFileSync(
    path.join(__dirname, "test-complex-list.html"),
    "utf8"
  );
  const result = await proxy.htmlToNotionBlocks(html);
  // Collect markers using the same helper used by the server
  const markerMap = proxy.collectAndStripMarkers(result.blocks, {});
  const out = {
    ts: new Date().toISOString(),
    blocks: result.blocks,
    markerMapKeys: Object.keys(markerMap),
    markerMapSample: Object.fromEntries(
      Object.entries(markerMap)
        .slice(0, 5)
        .map(([k, v]) => [
          k,
          v.map((b) => ({ type: b.type, id: b.id || null })),
        ])
    ),
  };
  fs.writeFileSync(
    path.join(__dirname, "logs", "complex-list-test.json"),
    JSON.stringify(out, null, 2)
  );
  console.log("Wrote logs/complex-list-test.json");

  // Also print a simplified view for quick inspection
  console.log("\n=== SIMPLIFIED OUTPUT ===");
  result.blocks.forEach((block, i) => {
    console.log(`${i}: ${block.type}`);
    if (block.type === 'bulleted_list_item') {
      const text = block.bulleted_list_item?.rich_text?.[0]?.text?.content || '(empty)';
      console.log(`   Text: "${text}"`);
      if (block.bulleted_list_item?.children) {
        block.bulleted_list_item.children.forEach((child, j) => {
          console.log(`   Child ${j}: ${child.type}`);
          if (child.type === 'paragraph') {
            const paraText = child.paragraph?.rich_text?.[0]?.text?.content || '';
            console.log(`      Para: "${paraText.substring(0, 50)}..."`);
          } else if (child.type === 'table') {
            console.log(`      Table: ${child.table?.children?.length || 0} rows`);
          } else if (child.type === 'callout') {
            const calloutText = child.callout?.rich_text?.[0]?.text?.content || '';
            console.log(`      Callout: "${calloutText.substring(0, 50)}..."`);
          }
        });
      }
    }
  });
}

run().catch((err) => {
  console.error("test error", (err && err.stack) || err);
  process.exit(1);
});