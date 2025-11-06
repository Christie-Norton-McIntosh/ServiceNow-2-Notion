const { extractContentFromHtml } = require('../server/services/servicenow.cjs');
const { collectAndStripMarkers, removeCollectedBlocks } = require('../server/orchestration/marker-management.cjs');

async function main() {
  global.log = console.log;
  global.downloadAndUploadImage = async () => null;
  global.isValidImageUrl = () => true;
  global.normalizeUrl = (url) => url;
  global.ensureFileUploadAvailable = async () => true;
  global.getExtraDebug = () => false;

  const html = `<!doctype html>
  <html>
  <body>
    <article>
      <div class="body">
        <ol>
          <li>
            Step 1 intro text.
            <div class="table-wrap">
              <table>
                <thead>
                  <tr>
                    <th>Col A</th>
                    <th>Col B</th>
                  </tr>
                </thead>
                <tbody>
                  <tr>
                    <td>A1</td>
                    <td>B1</td>
                  </tr>
                </tbody>
              </table>
            </div>
            <p>More text between tables.</p>
            <table>
              <thead>
                <tr>
                  <th>Col X</th>
                  <th>Col Y</th>
                </tr>
              </thead>
              <tbody>
                <tr>
                  <td>X1</td>
                  <td>Y1</td>
                </tr>
              </tbody>
            </table>
          </li>
        </ol>
      </div>
    </article>
  </body>
  </html>`;

  const result = await extractContentFromHtml(html);
  console.log('\n=== Raw Blocks ===');
  for (const block of result.blocks) {
    const blockType = block.type;
    const payload = block[blockType] || {};
    const text = Array.isArray(payload.rich_text)
      ? payload.rich_text.map((rt) => rt.text?.content || '').join('')
      : '';
    console.log(blockType, JSON.stringify(text));
    if (blockType === 'numbered_list_item') {
      const childTypes = Array.isArray(payload.children)
        ? payload.children.map((child) => child.type)
        : [];
      console.log('  children types:', childTypes);
    }
    if (block._sn2n_marker) {
      console.log('  marker:', block._sn2n_marker);
    }
  }
  console.log('\nTotal raw blocks:', result.blocks.length);

  const markerMap = collectAndStripMarkers(result.blocks, {});
  const removed = removeCollectedBlocks(result.blocks);
  console.log('\nMarkers collected:', Object.keys(markerMap));
  console.log('Blocks removed during pruning:', removed);
  console.log('Remaining initial payload blocks:', result.blocks.length);
  result.blocks.forEach((block, idx) => {
    const type = block.type;
    const payload = block[type] || {};
    const text = Array.isArray(payload.rich_text)
      ? payload.rich_text.map((rt) => rt.text?.content || '').join('')
      : '';
    console.log(`  [${idx}] ${type} -> ${JSON.stringify(text)}`);
  });

  console.log('\nMarker map payload counts:');
  for (const [marker, blocks] of Object.entries(markerMap)) {
    console.log(`  ${marker}: ${blocks.length} block(s)`);
    blocks.forEach((block, idx) => {
      console.log(`    - ${idx}: ${block.type}`);
    });
  }
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
