/**
 * Pattern Learning System for AUDIT Auto-Remediation
 * 
 * Automatically captures new HTML patterns that cause AUDIT failures
 * and stores them as test fixtures for future comparison and improvement.
 * 
 * Patterns are organized by:
 * - Gap type (missing_list_items, missing_table_content, etc.)
 * - Coverage percentage
 * - Timestamp
 * 
 * Usage:
 * - When auto-remediation detects a new pattern, it captures it
 * - Stored in tests/fixtures/pattern-learning/
 * - Can be used for regression testing and improvement tracking
 * 
 * Version: 11.0.113
 */

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

/**
 * Pattern learning directory structure
 * tests/fixtures/pattern-learning/
 * ├── missing_list_items/
 * │   ├── pattern-<hash>-YYYY-MM-DD-HHMMSS.json
 * │   └── ...
 * ├── missing_table_content/
 * │   ├── pattern-<hash>-YYYY-MM-DD-HHMMSS.json
 * │   └── ...
 * ├── duplicate_text/
 * └── ...
 */

const PATTERNS_BASE_DIR = path.join(__dirname, '../../tests/fixtures/pattern-learning');

/**
 * Store a new HTML pattern that caused AUDIT failure
 * 
 * @param {Object} options
 * @param {string} options.html - Original HTML that caused failure
 * @param {Array} options.blocks - Extracted blocks
 * @param {string} options.patternType - Gap/issue type (e.g., 'missing_list_items')
 * @param {Object} options.audit - AUDIT results
 * @param {string} options.pageTitle - Page title for reference
 * @param {Function} options.log - Logger function
 * @returns {Object} { saved: boolean, file: string, hash: string }
 */
function captureNewPattern(options = {}) {
  const {
    html = '',
    blocks = [],
    patternType = 'unknown',
    audit = {},
    pageTitle = 'Unknown',
    log = console.log
  } = options;

  try {
    // Create pattern directory if it doesn't exist
    const patternDir = path.join(PATTERNS_BASE_DIR, patternType);
    if (!fs.existsSync(patternDir)) {
      fs.mkdirSync(patternDir, { recursive: true });
      log(`📁 Created pattern directory: ${patternDir}`);
    }

    // Generate hash of HTML to detect duplicates
    const htmlHash = generateHash(html);

    // Check if this pattern already exists
    const existingFiles = fs.readdirSync(patternDir);
    const existingPattern = existingFiles.find(f => f.includes(htmlHash.substring(0, 8)));
    
    if (existingPattern) {
      log(`⚠️ Pattern already captured: ${existingPattern}`);
      return {
        saved: false,
        reason: 'duplicate',
        file: existingPattern,
        hash: htmlHash
      };
    }

    // Create pattern file
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-').substring(0, 19);
    const filename = `pattern-${htmlHash.substring(0, 8)}-${timestamp}.json`;
    const filepath = path.join(patternDir, filename);

    // Prepare pattern data
    const patternData = {
      // Metadata
      captured: new Date().toISOString(),
      pageTitle,
      patternType,
      htmlHash: htmlHash.substring(0, 16),
      
      // Source HTML (for comparison)
      htmlLength: html.length,
      htmlPreview: html.substring(0, 500),
      
      // Extraction results
      blocksExtracted: blocks.length,
      blockTypes: analyzeBlockTypes(blocks),
      
      // AUDIT metrics
      coverage: audit.coverage || 0,
      coverageStr: audit.coverageStr || 'N/A',
      sourceNodes: audit.nodeCount || 0,
      sourceChars: audit.totalLength || 0,
      notionBlocks: audit.notionBlocks || 0,
      notionChars: audit.notionTextLength || 0,
      missing: audit.missing || 0,
      extra: audit.extra || 0,
      
      // Full HTML (for testing)
      fullHtml: html,
      
      // Reference
      description: `${patternType}: ${audit.coverageStr || 'N/A'} coverage on "${pageTitle}"`
    };

    // Save pattern file
    fs.writeFileSync(filepath, JSON.stringify(patternData, null, 2), 'utf8');
    
    log(`💾 New pattern captured: ${filename}`);
    log(`   Type: ${patternType}`);
    log(`   Coverage: ${audit.coverageStr || 'N/A'}`);
    log(`   File: ${filepath}`);

    return {
      saved: true,
      file: filename,
      path: filepath,
      hash: htmlHash.substring(0, 8)
    };

  } catch (err) {
    log(`❌ Failed to capture pattern: ${err.message}`);
    return {
      saved: false,
      error: err.message
    };
  }
}

/**
 * Load all patterns for a specific type
 * 
 * @param {string} patternType - Gap type to load
 * @returns {Array} Array of pattern objects
 */
function loadPatterns(patternType) {
  try {
    const patternDir = path.join(PATTERNS_BASE_DIR, patternType);
    
    if (!fs.existsSync(patternDir)) {
      return [];
    }

    const files = fs.readdirSync(patternDir);
    const patterns = [];

    files.forEach(file => {
      if (file.endsWith('.json')) {
        const filepath = path.join(patternDir, file);
        const data = JSON.parse(fs.readFileSync(filepath, 'utf8'));
        patterns.push({
          file,
          ...data
        });
      }
    });

    return patterns;

  } catch (err) {
    console.error(`Error loading patterns: ${err.message}`);
    return [];
  }
}

/**
 * Get pattern statistics
 * 
 * @returns {Object} Statistics about captured patterns
 */
function getPatternStatistics() {
  try {
    if (!fs.existsSync(PATTERNS_BASE_DIR)) {
      return {
        totalPatterns: 0,
        patternTypes: {}
      };
    }

    const stats = {
      totalPatterns: 0,
      patternTypes: {},
      patternsByType: {}
    };

    const typeDirectories = fs.readdirSync(PATTERNS_BASE_DIR);

    typeDirectories.forEach(typeDir => {
      const typePath = path.join(PATTERNS_BASE_DIR, typeDir);
      
      if (fs.statSync(typePath).isDirectory()) {
        const files = fs.readdirSync(typePath).filter(f => f.endsWith('.json'));
        
        stats.patternTypes[typeDir] = files.length;
        stats.totalPatterns += files.length;
        stats.patternsByType[typeDir] = files.map(f => ({
          file: f,
          timestamp: extractTimestamp(f)
        }));
      }
    });

    return stats;

  } catch (err) {
    console.error(`Error getting pattern statistics: ${err.message}`);
    return { totalPatterns: 0, patternTypes: {} };
  }
}

/**
 * Generate comparison script for a pattern
 * 
 * Useful for testing fixes against previously failing patterns
 * 
 * @param {string} patternType - Pattern type
 * @param {string} filename - Pattern filename
 * @returns {string} Path to generated comparison script
 */
function generateComparisonScript(patternType, filename) {
  try {
    const patternPath = path.join(PATTERNS_BASE_DIR, patternType, filename);
    const patternData = JSON.parse(fs.readFileSync(patternPath, 'utf8'));
    
    // Create comparison script
    const scriptName = `compare-${patternType}-${extractTimestamp(filename)}.cjs`;
    const scriptPath = path.join(__dirname, `../../tests/${scriptName}`);
    
    const scriptContent = `#!/usr/bin/env node

/**
 * Pattern Comparison Script - Auto-generated
 * Tests extraction against previously failing pattern
 * 
 * Generated: ${new Date().toISOString()}
 * Pattern Type: ${patternType}
 * Pattern File: ${filename}
 */

const { extractBlocks } = require('../server/services/servicenow.cjs');

// Original HTML that caused failure
const html = \`${patternData.fullHtml.replace(/`/g, '\\`')}\`;

// Expected metrics from when pattern was captured
const expectedCoverage = ${patternData.coverage};
const expectedSourceNodes = ${patternData.sourceNodes};
const expectedSourceChars = ${patternData.sourceChars};

console.log('\\n🔍 Pattern Comparison Test');
console.log('═══════════════════════════════════════════════════════');
console.log('Pattern Type:', '${patternType}');
console.log('Original Coverage:', expectedCoverage + '%');
console.log('Source: ' + expectedSourceNodes + ' nodes, ' + expectedSourceChars + ' chars');
console.log('');

try {
  // Extract with current code
  const result = extractBlocks(html);
  const { audit } = result;
  
  if (audit) {
    console.log('📊 Current Results:');
    console.log('Coverage:', audit.coverageStr);
    console.log('Source: ' + audit.nodeCount + ' nodes, ' + audit.totalLength + ' chars');
    console.log('Notion: ' + audit.notionBlocks + ' blocks, ' + audit.notionTextLength + ' chars');
    console.log('');
    
    // Compare
    const coverageImproved = audit.coverage > expectedCoverage;
    const coverageDiff = (audit.coverage - expectedCoverage).toFixed(1);
    
    if (coverageImproved) {
      console.log('✅ IMPROVED! Coverage +' + coverageDiff + '%');
    } else if (Math.abs(coverageDiff) < 1) {
      console.log('⚠️ NO CHANGE: Coverage difference: ' + coverageDiff + '%');
    } else {
      console.log('❌ REGRESSED! Coverage ' + coverageDiff + '%');
    }
    
    console.log('═══════════════════════════════════════════════════════\\n');
  } else {
    console.log('⚠️ AUDIT not available');
  }
} catch (err) {
  console.error('❌ Extraction failed:', err.message);
}
`;

    fs.writeFileSync(scriptPath, scriptContent, 'utf8');
    return scriptPath;

  } catch (err) {
    console.error(`Error generating comparison script: ${err.message}`);
    return null;
  }
}

/**
 * Helper: Generate content hash
 */
function generateHash(content) {
  return crypto.createHash('sha256').update(content).digest('hex');
}

/**
 * Helper: Analyze block types
 */
function analyzeBlockTypes(blocks) {
  const types = {};
  blocks.forEach(block => {
    types[block.type] = (types[block.type] || 0) + 1;
  });
  return types;
}

/**
 * Helper: Extract timestamp from filename
 */
function extractTimestamp(filename) {
  const match = filename.match(/(\d{4}-\d{2}-\d{2})/);
  return match ? match[1] : 'unknown';
}

module.exports = {
  captureNewPattern,
  loadPatterns,
  getPatternStatistics,
  generateComparisonScript,
  PATTERNS_BASE_DIR
};
