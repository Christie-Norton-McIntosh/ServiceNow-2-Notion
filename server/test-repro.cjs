const fs = require("fs");
const path = require("path");
const proxy = require("./sn2n-proxy.cjs");

async function run() {
  const html = fs.readFileSync(
    path.join(__dirname, "sample-repro.html"),
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
    path.join(__dirname, "logs", "repro-dump.json"),
    JSON.stringify(out, null, 2)
  );
  console.log("Wrote logs/repro-dump.json");
}

run().catch((err) => {
  console.error("repro error", (err && err.stack) || err);
  process.exit(1);
});
