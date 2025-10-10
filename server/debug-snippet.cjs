const { htmlToNotionBlocks } = require("./sn2n-proxy.cjs");

const fs = require("fs");

async function main() {
  const html = fs.readFileSync(process.argv[2], "utf8");
  const result = await htmlToNotionBlocks(html);
  console.log(JSON.stringify(result.blocks, null, 2));
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
