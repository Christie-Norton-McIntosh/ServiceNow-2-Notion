const fs = require('fs');
const cheerio = require('cheerio');

const html = fs.readFileSync('patch/pages/pages-to-update/duplicate-cis-remediation-2025-11-19T08-56-28.html', 'utf8');
const $ = cheerio.load(html);

const tables = $('table');
console.log(`Found ${tables.length} tables in HTML`);

tables.each((idx, table) => {
  const id = $(table).attr('id');
  const classes = $(table).attr('class');
  const countColumns = $(table).attr('count-columns');
  const rowCount = $(table).find('tr').length;
  console.log(`Table ${idx + 1}: id="${id}", class="${classes}", count-columns="${countColumns}", rows=${rowCount}`);
  
  // Show first row preview
  const firstRow = $(table).find('tr').first();
  const cellText = firstRow.find('th, td').map((i, cell) => $(cell).text().trim().substring(0, 20)).get().join(' | ');
  console.log(`  First row: ${cellText}`);
});
