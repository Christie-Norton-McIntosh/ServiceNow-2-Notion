const pageId = '2b3a89fedba581028fd9c42ae5ee9688';

console.log('📋 Fetching blocks from Create dependent relationship rules page...\n');

fetch(`http://localhost:3004/api/databases/282a89fedba5815e91f0db972912ef9f/pages/${pageId}`)
  .then(r => r.json())
  .then(data => {
    const blocks = data.results || [];
    console.log(`Total blocks: ${blocks.length}\n`);
    console.log('First 30 blocks:\n');
    
    blocks.slice(0, 30).forEach((block, i) => {
      const type = block.type;
      let content = '';
      
      if (type === 'heading_2' || type === 'heading_3') {
        content = block[type].rich_text.map(t => t.plain_text).join('');
      } else if (type === 'paragraph') {
        content = block[type].rich_text.map(t => t.plain_text).join('').slice(0, 80);
      } else if (type === 'callout') {
        content = block[type].rich_text.map(t => t.plain_text).join('').slice(0, 60);
      } else if (type === 'numbered_list_item' || type === 'bulleted_list_item') {
        content = block[type].rich_text.map(t => t.plain_text).join('').slice(0, 60);
      }
      
      console.log(`[${String(i+1).padStart(2)}] ${type.padEnd(20)} ${content}`);
    });
  })
  .catch(err => console.error('Error:', err.message));
