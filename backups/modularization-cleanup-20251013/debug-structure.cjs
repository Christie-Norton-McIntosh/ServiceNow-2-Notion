const fs = require('fs');

const content = fs.readFileSync('sn2n-proxy.cjs', 'utf8');
const lines = content.split('\n');

// Find extractBlocksFromHTML function start
let funcStart = -1;
for (let i = 0; i < lines.length; i++) {
  if (lines[i].includes('extractBlocksFromHTML') && lines[i].includes('async')) {
    funcStart = i;
    break;
  }
}

console.log('Function starts at line:', funcStart + 1);

// Look for the for loop with await
let forLoopLine = -1;
for (let i = 0; i < lines.length; i++) {
  if (lines[i].trim().startsWith('for (const m of matches)')) {
    forLoopLine = i;
    break;
  }
}

console.log('For loop at line:', forLoopLine + 1);
console.log('Distance:', forLoopLine - funcStart, 'lines');

// Check indentation
if (funcStart >= 0) {
  console.log('Function line indentation:', lines[funcStart].match(/^\s*/)[0].length);
  console.log('Function line:', lines[funcStart]);
}

if (forLoopLine >= 0) {
  console.log('For loop line indentation:', lines[forLoopLine].match(/^\s*/)[0].length);
  console.log('For loop line:', lines[forLoopLine]);
}

// Check if there's a closing brace that ends the function early
console.log('\nLooking for suspicious braces between function start and for loop:');
for (let i = funcStart + 1; i < forLoopLine; i++) {
  const line = lines[i];
  if (line.includes('}') && line.match(/^\s*/)[0].length <= 2) {
    console.log('Potential function-ending brace at line:', i + 1);
    console.log('Line:', JSON.stringify(line));
    console.log('Indentation:', line.match(/^\s*/)[0].length);
  }
}

// Also check the actual function signature area
console.log('\nFunction declaration area:');
for (let i = Math.max(0, funcStart - 2); i < Math.min(lines.length, funcStart + 10); i++) {
  console.log(`${i + 1}: ${JSON.stringify(lines[i])}`);
}