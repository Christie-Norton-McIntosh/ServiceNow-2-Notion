#!/usr/bin/env node

/**
 * Pattern Learning Management Tool
 * 
 * View, analyze, and manage patterns captured by auto-remediation system.
 * 
 * Usage:
 *   node tools/manage-patterns.cjs                    # List all patterns
 *   node tools/manage-patterns.cjs --type <type>      # List patterns by type
 *   node tools/manage-patterns.cjs --stats             # Show statistics
 *   node tools/manage-patterns.cjs --clean             # Clean old patterns (keep last 5)
 *   node tools/manage-patterns.cjs --gen-tests         # Generate comparison test scripts
 */

const fs = require('fs');
const path = require('path');

const PATTERNS_DIR = path.join(__dirname, '../tests/fixtures/pattern-learning');

function ensureDir() {
  if (!fs.existsSync(PATTERNS_DIR)) {
    console.log(`📁 No pattern learning directory found: ${PATTERNS_DIR}`);
    console.log(`   Patterns will be created on first AUDIT failure\n`);
    return false;
  }
  return true;
}

function getAllPatterns() {
  if (!ensureDir()) return {};
  
  const patterns = {};
  const types = fs.readdirSync(PATTERNS_DIR);
  
  types.forEach(type => {
    const typeDir = path.join(PATTERNS_DIR, type);
    if (fs.statSync(typeDir).isDirectory()) {
      const files = fs.readdirSync(typeDir).filter(f => f.endsWith('.json'));
      patterns[type] = files.map(file => {
        const filePath = path.join(typeDir, file);
        const data = JSON.parse(fs.readFileSync(filePath, 'utf8'));
        return {
          file,
          path: filePath,
          ...data
        };
      }).sort((a, b) => new Date(b.captured) - new Date(a.captured));
    }
  });
  
  return patterns;
}

function listPatterns(filterType = null) {
  console.log(`\n${'='.repeat(80)}`);
  console.log('📚 CAPTURED PATTERNS');
  console.log(`${'='.repeat(80)}\n`);

  const patterns = getAllPatterns();
  
  if (Object.keys(patterns).length === 0) {
    console.log('No patterns captured yet. Patterns will be saved when AUDIT fails.\n');
    return;
  }

  Object.entries(patterns).forEach(([type, patternList]) => {
    if (filterType && type !== filterType) return;
    
    console.log(`📂 ${type} (${patternList.length} patterns)`);
    console.log(`${'─'.repeat(80)}`);
    
    patternList.forEach((p, i) => {
      const captured = new Date(p.captured).toLocaleString();
      console.log(`   ${i + 1}. [${p.coverage}%] ${p.pageTitle}`);
      console.log(`      📅 Captured: ${captured}`);
      console.log(`      📝 Blocks: ${p.blocksExtracted} (${Object.entries(p.blockTypes || {}).map(([t, c]) => `${t}:${c}`).join(', ')})`);
      console.log(`      🔍 Hash: ${p.htmlHash}`);
      console.log(`      📄 File: ${p.file}`);
    });
    console.log();
  });
}

function showStats() {
  console.log(`\n${'='.repeat(80)}`);
  console.log('📊 PATTERN LEARNING STATISTICS');
  console.log(`${'='.repeat(80)}\n`);

  const patterns = getAllPatterns();
  
  if (Object.keys(patterns).length === 0) {
    console.log('No patterns captured yet.\n');
    return;
  }

  let totalPatterns = 0;
  const coverageByType = {};
  const typeStats = {};

  Object.entries(patterns).forEach(([type, patternList]) => {
    totalPatterns += patternList.length;
    typeStats[type] = {
      count: patternList.length,
      avgCoverage: 0,
      minCoverage: 100,
      maxCoverage: 0,
      totalChars: 0,
      avgBlocks: 0
    };
    
    patternList.forEach(p => {
      typeStats[type].avgCoverage += p.coverage;
      typeStats[type].minCoverage = Math.min(typeStats[type].minCoverage, p.coverage);
      typeStats[type].maxCoverage = Math.max(typeStats[type].maxCoverage, p.coverage);
      typeStats[type].totalChars += p.htmlLength;
      typeStats[type].avgBlocks += p.blocksExtracted;
    });
    
    typeStats[type].avgCoverage = Math.round(typeStats[type].avgCoverage / patternList.length);
    typeStats[type].avgBlocks = Math.round(typeStats[type].avgBlocks / patternList.length);
  });

  console.log(`📈 Overall Stats:`);
  console.log(`   Total pattern types: ${Object.keys(patterns).length}`);
  console.log(`   Total patterns captured: ${totalPatterns}`);
  
  console.log(`\n📊 By Type:`);
  Object.entries(typeStats).forEach(([type, stats]) => {
    console.log(`\n   ${type}`);
    console.log(`   ├─ Patterns: ${stats.count}`);
    console.log(`   ├─ Avg Coverage: ${stats.avgCoverage}%`);
    console.log(`   ├─ Coverage Range: ${stats.minCoverage}% → ${stats.maxCoverage}%`);
    console.log(`   ├─ Avg HTML Size: ${Math.round(stats.totalChars / stats.count)} chars`);
    console.log(`   └─ Avg Blocks: ${stats.avgBlocks}`);
  });
  
  console.log();
}

function cleanOldPatterns(keepCount = 5) {
  console.log(`\n${'='.repeat(80)}`);
  console.log(`🧹 CLEANING OLD PATTERNS (keeping last ${keepCount})`);
  console.log(`${'='.repeat(80)}\n`);

  const patterns = getAllPatterns();
  let deleted = 0;
  
  Object.entries(patterns).forEach(([type, patternList]) => {
    if (patternList.length > keepCount) {
      const toDelete = patternList.slice(keepCount);
      toDelete.forEach(p => {
        fs.unlinkSync(p.path);
        console.log(`   🗑️  Deleted: ${p.file} (${p.coverage}% coverage)`);
        deleted++;
      });
    }
  });
  
  if (deleted === 0) {
    console.log('   ℹ️  No patterns to clean - all within limit\n');
  } else {
    console.log(`\n   ✅ Deleted ${deleted} old patterns\n`);
  }
}

function generateComparisonTests() {
  console.log(`\n${'='.repeat(80)}`);
  console.log('🧪 GENERATING COMPARISON TEST SCRIPTS');
  console.log(`${'='.repeat(80)}\n`);

  const patterns = getAllPatterns();
  
  if (Object.keys(patterns).length === 0) {
    console.log('No patterns to generate tests for.\n');
    return;
  }

  let totalGenerated = 0;
  
  Object.entries(patterns).forEach(([type, patternList]) => {
    patternList.forEach((p, i) => {
      const testName = `test-pattern-${type}-${p.htmlHash.substring(0, 8)}.cjs`;
      const testPath = path.join(__dirname, '../tests', testName);
      
      const testContent = `#!/usr/bin/env node
/**
 * Pattern Comparison Test: ${type}
 * Generated from captured pattern
 * 
 * Captured: ${new Date(p.captured).toLocaleString()}
 * Page: ${p.pageTitle}
 * Coverage: ${p.coverage}%
 */

const path = require('path');
const patternFile = path.join(__dirname, '../fixtures/pattern-learning/${type}/${p.file}');
const pattern = require(patternFile);

console.log(\`\n🔍 Pattern Comparison Test: ${type}\`);
console.log('─'.repeat(80));
console.log(\`📄 Page: \${pattern.pageTitle}\`);
console.log(\`📊 Coverage: \${pattern.coverage}%\`);
console.log(\`🔍 Hash: \${pattern.htmlHash}\`);
console.log(\`📝 Blocks: \${pattern.blocksExtracted}\`);
console.log('─'.repeat(80));

// Verify pattern data integrity
if (!pattern.captured) throw new Error('Missing captured timestamp');
if (!pattern.htmlLength) throw new Error('Missing HTML length');
if (!pattern.fullHtml) throw new Error('Missing full HTML');

console.log('✅ Pattern data valid');
console.log(\`   HTML: \${pattern.htmlLength} chars\`);
console.log(\`   Blocks: \${pattern.blocksExtracted}\`);
console.log(\`   Types: \${Object.entries(pattern.blockTypes || {}).map(([t, c]) => \`\${t}:\${c}\`).join(', ')}\`);

// Note: Full extraction comparison would go here
// For now, just verify the pattern loaded correctly
console.log(\`\n✅ Pattern comparison test ready\n\`);
`;

      fs.writeFileSync(testPath, testContent);
      console.log(`   ✅ Generated: ${testName}`);
      totalGenerated++;
    });
  });
  
  console.log(`\n   ✅ Total test scripts generated: ${totalGenerated}`);
  console.log(`   📂 Location: tests/test-pattern-*.cjs\n`);
}

// Main
const args = process.argv.slice(2);

try {
  if (args.includes('--stats')) {
    showStats();
  } else if (args.includes('--clean')) {
    cleanOldPatterns();
  } else if (args.includes('--gen-tests')) {
    generateComparisonTests();
  } else if (args.includes('--type')) {
    const typeIndex = args.indexOf('--type');
    const type = args[typeIndex + 1];
    if (type) {
      listPatterns(type);
    } else {
      console.log('❌ Please specify a pattern type with --type\n');
    }
  } else {
    listPatterns();
  }
} catch (err) {
  console.error(`\n❌ Error: ${err.message}\n`);
  process.exit(1);
}
