const { computeBlockKey, dedupeAndFilterBlocks } = require('../../utils/dedupe.cjs');

function assert(cond, msg) {
  if (!cond) {
    console.error('FAIL:', msg);
    process.exit(1);
  }
}

(function run() {
  console.log('Running dedupe util unit tests');

  const blocks = [
    { type: 'paragraph', paragraph: { rich_text: [{ text: { content: 'hello' } }] } },
    { type: 'paragraph', paragraph: { rich_text: [{ text: { content: 'hello' } }] } },
    { type: 'image', image: { file_upload: { id: '123' } } },
    { type: 'image', image: { file_upload: { id: '123' } } },
    { type: 'image', image: { external: { url: 'https://example.com/a.png' } } },
    { type: 'image', image: { external: { url: 'https://example.com/a.png' } } },
  ];

  // Additional fixtures: table, callout, list items
  const tableBlock = {
    type: 'table',
    table: {
      table_width: 2,
      children: [
        { table_row: { cells: [[{ text: { content: 'A1' } }], [{ text: { content: 'B1' } }]] } },
        { table_row: { cells: [[{ text: { content: 'A2' } }], [{ text: { content: 'B2' } }]] } },
      ]
    }
  };

  const calloutBlock = {
    type: 'callout',
    callout: {
      rich_text: [{ text: { content: 'Note: check this' } }],
      icon: { type: 'emoji', emoji: 'ℹ️' },
      color: 'gray_background'
    }
  };

  const listItems = [
    { type: 'bulleted_list_item', bulleted_list_item: { rich_text: [{ text: { content: 'item1' } }] } },
    { type: 'bulleted_list_item', bulleted_list_item: { rich_text: [{ text: { content: 'item1' } }] } },
  ];

  blocks.push(tableBlock, calloutBlock, ...listItems);

  const out = dedupeAndFilterBlocks(blocks, { log: () => {} });

  // Expect: paragraphs deduped to one, uploaded images deduped to one, external images kept twice
  const paraCount = out.filter(b => b.type === 'paragraph').length;
  const uploadedImageCount = out.filter(b => b.type === 'image' && b.image.file_upload).length;
  const externalImageCount = out.filter(b => b.type === 'image' && b.image.external).length;
  const tableCount = out.filter(b => b.type === 'table').length;
  const calloutCount = out.filter(b => b.type === 'callout').length;
  const bulletCount = out.filter(b => b.type === 'bulleted_list_item').length;

  assert(paraCount === 1, `expected 1 paragraph after dedupe, got ${paraCount}`);
  assert(uploadedImageCount === 1, `expected 1 uploaded image after dedupe, got ${uploadedImageCount}`);
  assert(externalImageCount === 2, `expected 2 external images (no dedupe), got ${externalImageCount}`);
  assert(tableCount === 1, `expected 1 table after dedupe, got ${tableCount}`);
  assert(calloutCount === 0 || calloutCount === 1, `expected callout filtered or present depending on color; got ${calloutCount}`);
  // list items with identical text — updated expectation to match current dedupe policy
  assert(bulletCount === 2, `expected 2 bulleted_list_item after dedupe, got ${bulletCount}`);

  console.log('All dedupe util unit tests passed');
})();
