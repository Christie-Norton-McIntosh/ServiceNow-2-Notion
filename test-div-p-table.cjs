const cheerio = require('cheerio');

// Test HTML: div.p with text node + deeply nested table in DataTables wrapper
const html = `
<div class="p">Solution definitions and the required plugins are as follows:<div class="table-wrap"><div id="predictive-intelligence-for-incident__table_ekm_dwq_hnb_wrapper" class="dataTables_wrapper no-footer"><div id="predictive-intelligence-for-incident__table_ekm_dwq_hnb_filter" class="dataTables_filter"><label>Search:<input type="search" class="" placeholder="" aria-controls="predictive-intelligence-for-incident__table_ekm_dwq_hnb"></label></div><div class="zDocsFilterTableDiv zDocsFilterColumnsTableDiv"><div><button type="button" data-toggle="dropdown" aria-label="Export table to a file" class="zDocsTopicPageTableExportButton"><svg aria-hidden="true" class="ico-ellipsis-v"><use xlink:href="#ico-ellipsis-v"></use></svg></button><div class="dropdown-menu zDocsDropdownMenu zDocsTopicPageTableExportMenu"><button type="button" aria-label="Export to Excel" class="dropdown-item">Export to Excel</button><button type="button" aria-label="Export to CSV" class="dropdown-item">Export to CSV</button></div></div></div><table count-columns="2" class="table frame-all dataTable no-footer" id="predictive-intelligence-for-incident__table_ekm_dwq_hnb"><caption><span class="table--title-label">Table 2. </span><span class="title">Solution definitions and plugins</span></caption><colgroup><col style="width:50%"><col style="width:50%"></colgroup><thead class="thead">
                     <tr class="row"><th class="entry colsep-1 rowsep-1 sorting" id="predictive-intelligence-for-incident__table_ekm_dwq_hnb__entry__1" tabindex="0" aria-controls="predictive-intelligence-for-incident__table_ekm_dwq_hnb" rowspan="1" colspan="1" aria-label="Solution definition: activate to sort column ascending">Solution definition</th><th class="entry colsep-1 rowsep-1 sorting" id="predictive-intelligence-for-incident__table_ekm_dwq_hnb__entry__2" tabindex="0" aria-controls="predictive-intelligence-for-incident__table_ekm_dwq_hnb" rowspan="1" colspan="1" aria-label="Plugins: activate to sort column ascending">Plugins</th></tr>
                  </thead><tbody class="tbody">
                     
                     
                     
                     
                  <tr class="row odd">
                        <td class="entry colsep-1 rowsep-1" headers="predictive-intelligence-for-incident__table_ekm_dwq_hnb__entry__1"><ul class="ul" id="predictive-intelligence-for-incident__ul_pj4_hwq_hnb">
                              <li class="li">Incident Assignment</li>
                              <li class="li">Incident Categorization</li>
                              <li class="li">Incident Service</li>
                              <li class="li">Incident Configuration Item</li>
                           </ul></td>
                        <td class="entry colsep-1 rowsep-1" headers="predictive-intelligence-for-incident__table_ekm_dwq_hnb__entry__2">The plugins com.glide.platform_ml and com.snc.incident.ml_solution must be
                  active.</td>
                     </tr><tr class="row even">
                        <td class="entry colsep-1 rowsep-1" headers="predictive-intelligence-for-incident__table_ekm_dwq_hnb__entry__1">Similar Incidents (MIM)</td>
                        <td class="entry colsep-1 rowsep-1" headers="predictive-intelligence-for-incident__table_ekm_dwq_hnb__entry__2">The plugins com.glide.platform_ml and com.snc.incident.mim.ml_solution must
                  be active.</td>
                     </tr><tr class="row odd">
                        <td class="entry colsep-1 rowsep-1" headers="predictive-intelligence-for-incident__table_ekm_dwq_hnb__entry__1">Major Incident Recommendation</td>
                        <td class="entry colsep-1 rowsep-1" headers="predictive-intelligence-for-incident__table_ekm_dwq_hnb__entry__2">The plugins com.snc.contextual_search_ml and com.snc.incident.mim.ml_solution
                  must be active.</td>
                     </tr><tr class="row even">
                        <td class="entry colsep-1 rowsep-1" headers="predictive-intelligence-for-incident__table_ekm_dwq_hnb__entry__1"><ul class="ul" id="predictive-intelligence-for-incident__ul_ttq_yvq_hnb">
                              <li class="li">Similar Open Incidents</li>
                              <li class="li">Similar Resolved Incidents</li>
                              <li class="li">Similar Incidents</li>
                              <li class="li">Similar Knowledge Articles</li>
                           </ul></td>
                        <td class="entry colsep-1 rowsep-1" headers="predictive-intelligence-for-incident__table_ekm_dwq_hnb__entry__2">The plugins com.snc.contextual_search_ml and com.snc.incident.mim.ml_solution
                  must be active.</td>
                     </tr></tbody></table></div></div></div>
`;

console.log('=== Test: div.p with text + deeply nested table ===\n');

const $ = cheerio.load(html, { decodeEntities: false });

const $divP = $('div.p').first();
console.log('1. Found div.p:', $divP.length > 0);

// Check if it contains tables
const hasTables = $divP.find('table').length > 0;
console.log('2. Contains tables:', hasTables);

// Get direct child nodes
const childNodes = Array.from($divP.get(0).childNodes);
console.log('3. Direct child nodes:', childNodes.length);

// Iterate through child nodes and classify them
childNodes.forEach((node, i) => {
  const isTextNode = node.nodeType === 3;
  const isElementNode = node.nodeType === 1;
  const nodeName = (node.name || node.nodeName || node.tagName || '').toUpperCase();
  const isBlockElement = isElementNode && ['DIV', 'TABLE', 'UL', 'OL', 'FIGURE', 'PRE'].includes(nodeName);
  
  if (isTextNode) {
    const text = (node.nodeValue || node.data || '').trim();
    console.log(`   [${i}] TEXT NODE: "${text.substring(0, 50)}${text.length > 50 ? '...' : ''}"`);
  } else if (isElementNode) {
    const $node = $(node);
    const className = $node.attr('class') || '';
    console.log(`   [${i}] ELEMENT: <${nodeName}${className ? ` class="${className}"` : ''}> - isBlockElement: ${isBlockElement}`);
    
    // If it's a div, check if it contains tables
    if (nodeName === 'DIV') {
      const tablesInside = $node.find('table').length;
      console.log(`        -> Contains ${tablesInside} table(s)`);
    }
  }
});

console.log('\n4. Testing processElement logic:');
// Simulate the processElement logic
let currentTextHtml = '';
const processedBlocks = [];

for (const node of childNodes) {
  const isTextNode = node.nodeType === 3;
  const isElementNode = node.nodeType === 1;
  const nodeName = (node.name || node.nodeName || node.tagName || '').toUpperCase();
  const isBlockElement = isElementNode && ['DIV', 'TABLE', 'UL', 'OL', 'FIGURE', 'PRE'].includes(nodeName);
  
  if (isTextNode || (isElementNode && !isBlockElement)) {
    const textToAdd = isTextNode ? (node.nodeValue || node.data || '') : $(node).prop('outerHTML');
    currentTextHtml += textToAdd;
  } else if (isBlockElement) {
    if (currentTextHtml.trim()) {
      console.log(`   -> Flush text: "${currentTextHtml.trim().substring(0, 80)}..."`);
      processedBlocks.push({ type: 'paragraph', text: currentTextHtml.trim() });
      currentTextHtml = '';
    }
    console.log(`   -> Process block element: <${nodeName}>`);
    processedBlocks.push({ type: nodeName.toLowerCase() });
  }
}

if (currentTextHtml.trim()) {
  console.log(`   -> Flush remaining text: "${currentTextHtml.trim().substring(0, 80)}..."`);
  processedBlocks.push({ type: 'paragraph', text: currentTextHtml.trim() });
}

console.log('\n5. Resulting blocks:', processedBlocks.map(b => b.type).join(', '));
console.log('\n6. First block content:', processedBlocks[0]?.text?.substring(0, 100));
