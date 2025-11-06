const path = require('path');
const { extractContentFromHtml } = require('../server/services/servicenow.cjs');

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
  console.log('\n=== Blocks ===');
  for (const block of result.blocks) {
    console.log(block.type, block[block.type]?.rich_text ? block[block.type].rich_text.map(rt => rt.text?.content).join('') : '');
    if (block.type === 'numbered_list_item') {
      console.log('  children types:', block.numbered_list_item.children?.map(child => child.type));
    }
    if (block._sn2n_marker) {
      console.log('  marker:', block._sn2n_marker);
    }
  }
  console.log('\nTotal blocks:', result.blocks.length);
}

main().catch(err => {
  console.error(err);
});
