// Let's try to isolate the issue by creating a copy with just the function
const fs = require('fs');

const content = fs.readFileSync('sn2n-proxy.cjs', 'utf8');
const lines = content.split('\n');

// Find function start and extract just the function
let funcStart = -1;
for (let i = 0; i < lines.length; i++) {
  if (lines[i].includes('extractBlocksFromHTML') && lines[i].includes('async')) {
    funcStart = i;
    break;
  }
}

// Find function end by brace counting
let braceCount = 0;
let inFunction = false;
let funcEnd = -1;

for (let i = funcStart; i < lines.length; i++) {
  const line = lines[i];
  
  if (line.includes(') {') && !inFunction) {
    inFunction = true;
    braceCount = 1;
    continue;
  }
  
  if (!inFunction) continue;
  
  const openBraces = (line.match(/{/g) || []).length;
  const closeBraces = (line.match(/}/g) || []).length;
  braceCount += openBraces - closeBraces;
  
  if (braceCount === 0) {
    funcEnd = i;
    break;
  }
}

console.log(`Function spans lines ${funcStart + 1} to ${funcEnd + 1}`);

// Create a minimal test with just the problematic section
const testLines = [
  'const { htmlToNotionRichText } = require("./converters/rich-text");',
  '',
  'async function testFunction() {',
  '  const matches = [{ tag: "p", index: 0, attributes: "" }];',
  '  let lastEndPos = 0;',
  '  ',
  '  for (const m of matches) {',
  '    if (m.index > lastEndPos) {',
  '      const textBetween = "test content";',
  '      const result = await htmlToNotionRichText(textBetween);',
  '      console.log(result);',
  '    }',
  '  }',
  '}',
  '',
  'testFunction();'
];

fs.writeFileSync('test-minimal.cjs', testLines.join('\n'));
console.log('Created minimal test file');