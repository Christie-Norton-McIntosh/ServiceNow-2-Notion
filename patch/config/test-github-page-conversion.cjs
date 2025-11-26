#!/usr/bin/env node
/**
 * Test GitHub onboarding page conversion to see block structure
 */
const fs = require('fs');
const path = require('path');

const API_BASE = process.env.SN2N_API_BASE || 'http://localhost:3004/api';
const FILE_PATH = path.join(__dirname, '..', 'pages-to-update', 'updated-pages', 'onboard-github-to-devops-change-velocity-workspace-2025-11-11T08-55-59.html');

async function httpPostJson(url, body) {
  const res = await fetch(url, { 
    method: 'POST', 
    headers: { 'Content-Type': 'application/json' }, 
    body: JSON.stringify(body) 
  });
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`POST ${url} failed: ${res.status} ${text}`);
  }
  return res.json();
}

async function main() {
  if (typeof fetch !== 'function') {
    global.fetch = (await import('node-fetch')).default;
  }

  const html = fs.readFileSync(FILE_PATH, 'utf8');
  
  console.log('[test] Converting to blocks via dryRun...');
  const result = await httpPostJson(`${API_BASE}/W2N`, {
    title: 'Onboard GitHub to DevOps Change Velocity — Workspace',
    databaseId: 'ignore',
    contentHtml: html,
    url: 'https://www.servicenow.com/docs/bundle/yokohama-it-service-management/page/product/enterprise-dev-ops/task/playbook-enter-github-instance-details.html',
    dryRun: true
  });

  const children = (result && result.data && result.data.children) || result.children || [];
  console.log(`[test] Generated ${children.length} blocks\n`);
  
  // Show first 10 blocks with their types and nesting
  for (let i = 0; i < Math.min(10, children.length); i++) {
    const block = children[i];
    console.log(`Block ${i + 1}: ${block.type}`);
    
    if (block[block.type]?.rich_text) {
      const text = block[block.type].rich_text.map(rt => rt.text.content).join('').substring(0, 80);
      console.log(`  Text: ${text}${text.length >= 80 ? '...' : ''}`);
    }
    
    if (block[block.type]?.children) {
      console.log(`  Has ${block[block.type].children.length} children`);
      // Show first level nesting
      block[block.type].children.slice(0, 5).forEach((child, j) => {
        console.log(`    Child ${j + 1}: ${child.type}`);
        if (child.type === 'table') {
          console.log(`      Table has ${child.table?.children?.length || 0} rows`);
        }
        if (child[child.type]?.children) {
          console.log(`      Has ${child[child.type].children.length} children`);
        }
      });
    }
    console.log('');
  }
  
  // Detailed look at block 4 (first numbered list with table)
  if (children.length >= 4) {
    console.log('=== Detailed Block 4 Analysis ===');
    const block4 = children[3];
    console.log('Type:', block4.type);
    console.log('Children:', block4[block4.type]?.children?.length || 0);
    if (block4[block4.type]?.children) {
      block4[block4.type].children.forEach((child, i) => {
        console.log(`  Child ${i + 1}: ${child.type}`);
        if (child.type === 'table') {
          const rows = child.table?.children || [];
          console.log(`    Rows: ${rows.length}`);
          rows.slice(0, 2).forEach((row, ri) => {
            console.log(`    Row ${ri + 1}: ${row.table_row?.cells?.length || 0} cells`);
          });
        }
      });
    }
    console.log('');
  }
  
  // Count list items and show nesting depth
  let listCount = 0;
  let maxDepth = 0;
  
  function countLists(blocks, depth = 0) {
    maxDepth = Math.max(maxDepth, depth);
    blocks.forEach(block => {
      if (block.type === 'numbered_list_item' || block.type === 'bulleted_list_item') {
        listCount++;
        if (block[block.type]?.children) {
          countLists(block[block.type].children, depth + 1);
        }
      }
    });
  }
  
  countLists(children);
  console.log(`[test] Total list items: ${listCount}`);
  console.log(`[test] Maximum nesting depth: ${maxDepth}`);
}

main().catch(err => {
  console.error('[test] Failed:', err && err.stack || err);
  process.exit(1);
});
