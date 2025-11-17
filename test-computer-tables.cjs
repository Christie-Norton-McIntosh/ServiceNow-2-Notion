// Quick test to check table extraction from Computer page
const fs = require('fs');
const path = require('path');

// Read the HTML file
const htmlPath = path.join(__dirname, 'patch/pages/pages-to-update/computer-cmdb-ci-computer-class-2025-11-17T01-45-20.html');
const html = fs.readFileSync(htmlPath, 'utf8');

// Count tables in source HTML
const tableMatches = html.match(/<table[^>]*>/gi);
console.log('Tables in source HTML:', tableMatches ? tableMatches.length : 0);

if (tableMatches) {
  tableMatches.forEach((match, idx) => {
    console.log(`\nTable ${idx + 1}:`);
    console.log(match.substring(0, 150));
  });
}

// Check for DataTables wrapper
const hasDataTablesWrapper = html.includes('dataTables_wrapper');
console.log('\n\nHas DataTables wrapper:', hasDataTablesWrapper);

// Count table-wrap divs
const tableWrapMatches = html.match(/<div[^>]*class="[^"]*table-wrap[^"]*"[^>]*>/gi);
console.log('Table-wrap divs:', tableWrapMatches ? tableWrapMatches.length : 0);
