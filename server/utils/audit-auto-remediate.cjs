/**
 * AUDIT Auto-Remediation System
 * 
 * Automatically diagnoses and fixes AUDIT validation failures.
 * 
 * When AUDIT coverage is outside 95-105% range:
 * 1. Analyzes source HTML vs extracted blocks
 * 2. Identifies problematic patterns
 * 3. Suggests fixes
 * 4. Optionally applies fixes and retests
 * 5. Logs findings for manual review
 * 
 * Version: 11.0.113
 * Status: Automatic remediation on FAIL
 */

const fs = require('fs');
const path = require('path');
const cheerio = require('cheerio');
const { captureNewPattern } = require('./pattern-learning.cjs');

/**
 * Main remediation function
 * Called when AUDIT validation fails
 * 
 * @param {Object} options
 * @param {string} options.html - Original HTML
 * @param {Array} options.blocks - Extracted blocks
 * @param {Object} options.audit - AUDIT results
 * @param {Function} options.log - Logger function
 * @returns {Object} Diagnosis with findings and recommendations
 */
function diagnoseAndFixAudit(options = {}) {
  const {
    html = '',
    blocks = [],
    audit = {},
    log = console.log,
    pageTitle = 'Unknown',
    autoApplyFixes = false
  } = options;

  const diagnosis = {
    timestamp: new Date().toISOString(),
    pageTitle,
    coverage: audit.coverage || 0,
    passed: audit.passed || false,
    
    // Analysis results
    sourceAnalysis: null,
    blockAnalysis: null,
    gaps: [],
    duplicates: [],
    recommendations: [],
    
    // Auto-fix results
    fixApplied: false,
    fixResults: null
  };

  try {
    log(`\n🔍 ========== AUDIT AUTO-REMEDIATION ==========`);
    log(`📄 Page: ${pageTitle}`);
    log(`📊 Coverage: ${audit.coverageStr || 'N/A'}`);
    log(`🎯 Threshold: 95-105%`);

    // Step 1: Analyze source HTML
    log(`\n[STEP 1] Analyzing source HTML...`);
    diagnosis.sourceAnalysis = analyzeSourceHTML(html, log);
    log(`  ✅ Found ${diagnosis.sourceAnalysis.totalElements} elements`);
    log(`  ✅ Found ${diagnosis.sourceAnalysis.totalTextNodes} text nodes`);
    log(`  ✅ Found ${diagnosis.sourceAnalysis.totalChars} total characters`);

    // Step 2: Analyze extracted blocks
    log(`\n[STEP 2] Analyzing extracted blocks...`);
    diagnosis.blockAnalysis = analyzeExtractedBlocks(blocks, log);
    log(`  ✅ Extracted ${diagnosis.blockAnalysis.totalBlocks} blocks`);
    log(`  ✅ ${diagnosis.blockAnalysis.blockTypes.length} different types`);
    log(`  ✅ ${diagnosis.blockAnalysis.totalChars} total characters`);

    // Step 3: Find content gaps
    log(`\n[STEP 3] Identifying content gaps...`);
    if (audit.coverage < 95) {
      diagnosis.gaps = findContentGaps(html, blocks, diagnosis.sourceAnalysis, log, { 
        pageTitle, 
        audit,
        captureNewPattern 
      });
      log(`  ⚠️ Found ${diagnosis.gaps.length} missing content patterns`);
      
      diagnosis.gaps.forEach((gap, i) => {
        log(`     Gap ${i + 1}: ${gap.type} - "${gap.preview}"`);
      });
    }

    // Step 4: Find duplicates
    log(`\n[STEP 4] Checking for duplicate content...`);
    if (audit.coverage > 105) {
      diagnosis.duplicates = findDuplicates(blocks, log, { 
        pageTitle, 
        audit,
        html,
        captureNewPattern 
      });
      log(`  ⚠️ Found ${diagnosis.duplicates.length} potential duplicates`);
      
      diagnosis.duplicates.forEach((dup, i) => {
        log(`     Dup ${i + 1}: ${dup.type} - "${dup.preview}"`);
      });
    }

    // Step 5: Generate recommendations
    log(`\n[STEP 5] Generating recommendations...`);
    diagnosis.recommendations = generateRecommendations(diagnosis, log);
    log(`  📝 ${diagnosis.recommendations.length} recommendations:`);
    
    diagnosis.recommendations.forEach((rec, i) => {
      log(`     ${i + 1}. [${rec.priority}] ${rec.action}`);
      log(`        Reason: ${rec.reason}`);
      log(`        Fix: ${rec.fixCode || 'Manual review needed'}`);
    });

    // Step 6: Auto-apply fixes (if enabled)
    if (autoApplyFixes && diagnosis.recommendations.length > 0) {
      log(`\n[STEP 6] Auto-applying recommended fixes...`);
      diagnosis.fixApplied = true;
      // TODO: Implement auto-fix application
      log(`  ⏳ Auto-fix application not yet implemented`);
    }

    // Step 7: Generate summary
    log(`\n[SUMMARY]`);
    log(`  Coverage: ${audit.coverageStr}`);
    log(`  Status: ${diagnosis.passed ? '✅ PASS' : '❌ FAIL'}`);
    log(`  Gaps found: ${diagnosis.gaps.length}`);
    log(`  Duplicates found: ${diagnosis.duplicates.length}`);
    log(`  Recommendations: ${diagnosis.recommendations.length}`);
    
    if (diagnosis.recommendations.length > 0) {
      const topRec = diagnosis.recommendations[0];
      log(`  🎯 Top priority: ${topRec.action}`);
    }

    log(`\n=========================================\n`);

    return diagnosis;

  } catch (err) {
    log(`❌ Remediation error: ${err.message}`);
    diagnosis.error = err.message;
    return diagnosis;
  }
}

/**
 * Analyze source HTML structure
 */
function analyzeSourceHTML(html, log) {
  const analysis = {
    totalElements: 0,
    elementTypes: {},
    totalTextNodes: 0,
    totalChars: 0,
    hiddenElements: [],
    emptyElements: [],
    complexNesting: [],
    specialContainers: [],
    listItems: 0,
    tables: 0,
    codeBlocks: 0,
    callouts: 0
  };

  try {
    const $ = cheerio.load(html, { decodeEntities: false });

    // Count elements
    $('*').each((i, el) => {
      const $el = $(el);
      const tag = el.tagName?.toLowerCase() || 'unknown';
      const text = $el.contents().text().trim();
      const chars = text.length;

      analysis.totalElements++;
      analysis.elementTypes[tag] = (analysis.elementTypes[tag] || 0) + 1;

      if (text) {
        analysis.totalTextNodes++;
        analysis.totalChars += chars;
      }

      // Check for hidden elements
      const display = $el.css('display');
      const visibility = $el.css('visibility');
      if (display === 'none' || visibility === 'hidden') {
        analysis.hiddenElements.push({
          tag,
          text: text.substring(0, 50),
          chars
        });
      }

      // Count special elements
      if (tag === 'li') analysis.listItems++;
      if (tag === 'table') analysis.tables++;
      if (tag === 'pre' || tag === 'code') analysis.codeBlocks++;
      if (tag === 'div' && ($el.attr('class') || '').includes('note')) {
        analysis.callouts++;
      }

      // Check nesting depth
      const depth = $el.parents().length;
      if (depth > 5) {
        analysis.complexNesting.push({
          tag,
          depth,
          text: text.substring(0, 30)
        });
      }

      // Identify special containers
      const className = $el.attr('class') || '';
      if (className.includes('wrapper') || className.includes('container')) {
        analysis.specialContainers.push({
          tag,
          class: className,
          text: text.substring(0, 30)
        });
      }
    });

  } catch (err) {
    log(`⚠️ HTML analysis error: ${err.message}`);
  }

  return analysis;
}

/**
 * Analyze extracted blocks structure
 */
function analyzeExtractedBlocks(blocks, log) {
  const analysis = {
    totalBlocks: blocks.length,
    blockTypes: {},
    totalChars: 0,
    emptyBlocks: [],
    nestedBlocks: [],
    richTextAnnotations: {}
  };

  try {
    blocks.forEach((block, i) => {
      analysis.blockTypes[block.type] = (analysis.blockTypes[block.type] || 0) + 1;

      // Count characters - FIX: Access rich_text via block[block.type], not block.rich_text
      // Blocks have structure: { type: "paragraph", paragraph: { rich_text: [...] } }
      const blockContent = block[block.type];
      if (blockContent && blockContent.rich_text) {
        blockContent.rich_text.forEach((rt, rtIndex) => {
          // FIX: rt.text.content is the primary field we set during extraction
          // plain_text is computed by Notion API, so prioritize text.content
          const textContent = rt.text?.content || rt.plain_text || '';
          
          // DEBUG: Log first few rich_text elements to see structure
          if (i < 3 && rtIndex < 2) {
            console.log(`[AUDIT-DEBUG] Block[${i}] ${block.type}, rt[${rtIndex}]:`, {
              hasTextContent: !!rt.text?.content,
              hasPlainText: !!rt.plain_text,
              textLength: textContent.length,
              preview: textContent.substring(0, 50)
            });
          }
          
          analysis.totalChars += textContent.length;
          
          // Track annotations
          if (rt.annotations) {
            Object.entries(rt.annotations).forEach(([key, val]) => {
              if (val) {
                analysis.richTextAnnotations[key] = 
                  (analysis.richTextAnnotations[key] || 0) + 1;
              }
            });
          }
        });
      }

      // Check for empty blocks
      const richText = blockContent?.rich_text || [];
      const text = richText.map(rt => rt.text?.content || rt.plain_text || '').join('').trim();
      if (!text) {
        analysis.emptyBlocks.push({
          index: i,
          type: block.type
        });
      }

      // Check for nested blocks
      if (block.children && block.children.length > 0) {
        analysis.nestedBlocks.push({
          index: i,
          type: block.type,
          childCount: block.children.length
        });
      }
    });

    // Convert types object to array for consistent output
    analysis.blockTypes = Object.entries(analysis.blockTypes).map(
      ([type, count]) => ({ type, count })
    );

  } catch (err) {
    log(`⚠️ Block analysis error: ${err.message}`);
  }

  return analysis;
}

/**
 * Find content gaps (missing elements)
 */
function findContentGaps(html, blocks, sourceAnalysis, log, options = {}) {
  const gaps = [];
  const $ = cheerio.load(html, { decodeEntities: false });
  const { pageTitle, audit, captureNewPattern } = options;

  try {
    // Extract all text from blocks
    const blockTexts = new Set();
    blocks.forEach(block => {
      if (block.rich_text) {
        block.rich_text.forEach(rt => {
          const text = rt.text.trim();
          if (text) blockTexts.add(text.toLowerCase());
        });
      }
    });

    // Check for missing list items
    const listItems = [];
    $('li').each((i, el) => {
      const text = $(el).text().trim();
      if (text && !blockTexts.has(text.toLowerCase())) {
        listItems.push({
          index: i,
          text: text.substring(0, 50)
        });
      }
    });
    if (listItems.length > 0) {
      gaps.push({
        type: 'missing_list_items',
        count: listItems.length,
        preview: listItems[0]?.text || 'List items',
        severity: 'high',
        fixCode: 'Check extractLists() in servicenow.cjs'
      });
      
      // Capture pattern for learning
      if (captureNewPattern) {
        captureNewPattern({
          html,
          blocks,
          patternType: 'missing_list_items',
          audit,
          pageTitle,
          log
        });
      }
    }

    // Check for missing table content
    const tableRows = [];
    $('tr').each((i, el) => {
      const text = $(el).text().trim();
      if (text && !blockTexts.has(text.toLowerCase())) {
        tableRows.push({
          index: i,
          text: text.substring(0, 50)
        });
      }
    });
    if (tableRows.length > 0) {
      gaps.push({
        type: 'missing_table_content',
        count: tableRows.length,
        preview: tableRows[0]?.text || 'Table rows',
        severity: 'high',
        fixCode: 'Check extractTables() in servicenow.cjs'
      });
      
      // Capture pattern for learning
      if (captureNewPattern) {
        captureNewPattern({
          html,
          blocks,
          patternType: 'missing_table_content',
          audit,
          pageTitle,
          log
        });
      }
    }

    // Check for missing code blocks
    const codeBlocks = [];
    $('pre, code').each((i, el) => {
      const text = $(el).text().trim();
      if (text && !blockTexts.has(text.toLowerCase())) {
        codeBlocks.push({
          index: i,
          text: text.substring(0, 50)
        });
      }
    });
    if (codeBlocks.length > 0) {
      gaps.push({
        type: 'missing_code',
        count: codeBlocks.length,
        preview: codeBlocks[0]?.text || 'Code blocks',
        severity: 'high',
        fixCode: 'Check code block extraction logic'
      });
      
      // Capture pattern for learning
      if (captureNewPattern) {
        captureNewPattern({
          html,
          blocks,
          patternType: 'missing_code',
          audit,
          pageTitle,
          log
        });
      }
    }

    // Check for deeply nested content not being extracted
    if (sourceAnalysis.complexNesting?.length > 0) {
      gaps.push({
        type: 'deep_nesting',
        count: sourceAnalysis.complexNesting.length,
        preview: sourceAnalysis.complexNesting[0]?.text || 'Nested content',
        severity: 'medium',
        fixCode: 'Use SN2N_STRICT_ORDER=1 for strict DOM traversal'
      });
      
      // Capture pattern for learning
      if (captureNewPattern) {
        captureNewPattern({
          html,
          blocks,
          patternType: 'deep_nesting',
          audit,
          pageTitle,
          log
        });
      }
    }

    // Check for hidden elements that might contain content
    if (sourceAnalysis.hiddenElements?.length > 0) {
      gaps.push({
        type: 'hidden_elements',
        count: sourceAnalysis.hiddenElements.length,
        preview: sourceAnalysis.hiddenElements[0]?.text || 'Hidden content',
        severity: 'low',
        fixCode: 'Check if hidden content should be extracted'
      });
      
      // Capture pattern for learning
      if (captureNewPattern) {
        captureNewPattern({
          html,
          blocks,
          patternType: 'hidden_elements',
          audit,
          pageTitle,
          log
        });
      }
    }

  } catch (err) {
    log(`⚠️ Gap analysis error: ${err.message}`);
  }

  return gaps;
}

/**
 * Find duplicate content
 */
function findDuplicates(blocks, log, options = {}) {
  const duplicates = [];
  const textMap = new Map();
  const { pageTitle, audit, html, captureNewPattern } = options;

  try {
    blocks.forEach((block, i) => {
      if (block.rich_text) {
        const text = block.rich_text.map(rt => rt.text).join('').trim();
        
        if (text) {
          if (textMap.has(text)) {
            // Found duplicate
            duplicates.push({
              type: block.type,
              preview: text.substring(0, 50),
              firstIndex: textMap.get(text),
              secondIndex: i,
              severity: 'high'
            });
            
            // Capture pattern for learning
            if (captureNewPattern) {
              captureNewPattern({
                html,
                blocks,
                patternType: 'duplicate_text',
                audit,
                pageTitle,
                log
              });
            }
          } else {
            textMap.set(text, i);
          }
        }
      }
    });

    // Check for near-duplicates (similar text)
    const texts = Array.from(textMap.keys());
    for (let i = 0; i < texts.length; i++) {
      for (let j = i + 1; j < texts.length; j++) {
        const similarity = calculateSimilarity(texts[i], texts[j]);
        if (similarity > 0.9) {
          duplicates.push({
            type: 'near_duplicate',
            preview: texts[i].substring(0, 50),
            similarity: parseFloat((similarity * 100).toFixed(1)),
            severity: 'medium'
          });
          
          // Capture pattern for learning
          if (captureNewPattern) {
            captureNewPattern({
              html,
              blocks,
              patternType: 'near_duplicate_text',
              audit,
              pageTitle,
              log
            });
          }
        }
      }
    }

  } catch (err) {
    log(`⚠️ Duplicate analysis error: ${err.message}`);
  }

  return duplicates;
}

/**
 * Generate fix recommendations
 */
function generateRecommendations(diagnosis, log) {
  const recommendations = [];

  try {
    // Coverage < 95% recommendations
    if (diagnosis.coverage < 95) {
      // Prioritize by gap severity
      const highSeverityGaps = diagnosis.gaps.filter(g => g.severity === 'high');
      
      highSeverityGaps.forEach(gap => {
        recommendations.push({
          priority: 'HIGH',
          action: `Fix missing ${gap.type}`,
          reason: `${gap.count} instances of ${gap.type} not extracted`,
          affectedContent: gap.preview,
          fixCode: gap.fixCode,
          coverage_impact: '+5-15%'
        });
      });

      // Add medium severity recommendations
      const mediumGaps = diagnosis.gaps.filter(g => g.severity === 'medium');
      mediumGaps.forEach(gap => {
        recommendations.push({
          priority: 'MEDIUM',
          action: `Improve ${gap.type}`,
          reason: `${gap.count} instances detected`,
          affectedContent: gap.preview,
          fixCode: gap.fixCode,
          coverage_impact: '+2-5%'
        });
      });
    }

    // Coverage > 105% recommendations
    if (diagnosis.coverage > 105) {
      diagnosis.duplicates.forEach(dup => {
        recommendations.push({
          priority: 'HIGH',
          action: `Remove duplicate ${dup.type}`,
          reason: `Duplicate content extracted`,
          affectedContent: dup.preview,
          fixCode: 'Check deduplication logic in w2n.cjs',
          coverage_impact: `-${dup.similarity || 5}%`
        });
      });
    }

    // Add low priority debug recommendations
    if (diagnosis.sourceAnalysis?.hiddenElements?.length > 0) {
      recommendations.push({
        priority: 'DEBUG',
        action: 'Review hidden elements',
        reason: `${diagnosis.sourceAnalysis.hiddenElements.length} hidden elements found`,
        affectedContent: diagnosis.sourceAnalysis.hiddenElements[0]?.text,
        fixCode: 'Check CSS visibility settings',
        coverage_impact: 'Variable'
      });
    }

  } catch (err) {
    log(`⚠️ Recommendation generation error: ${err.message}`);
  }

  return recommendations;
}

/**
 * Calculate text similarity (simple)
 */
function calculateSimilarity(str1, str2) {
  const len1 = str1.length;
  const len2 = str2.length;
  const maxLen = Math.max(len1, len2);
  
  if (maxLen === 0) return 1;
  
  let matches = 0;
  for (let i = 0; i < Math.min(len1, len2); i++) {
    if (str1[i] === str2[i]) matches++;
  }
  
  return matches / maxLen;
}

/**
 * Save diagnosis to file for review
 */
function saveDiagnosisToFile(diagnosis, pageId) {
  try {
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-').substring(0, 19);
    const filename = `audit-diagnosis-${pageId}-${timestamp}.json`;
    const filepath = path.join(__dirname, '../../patch/logs', filename);
    
    fs.mkdirSync(path.dirname(filepath), { recursive: true });
    fs.writeFileSync(filepath, JSON.stringify(diagnosis, null, 2), 'utf8');
    
    return filepath;
  } catch (err) {
    console.error(`Failed to save diagnosis: ${err.message}`);
    return null;
  }
}

module.exports = {
  diagnoseAndFixAudit,
  analyzeSourceHTML,
  analyzeExtractedBlocks,
  findContentGaps,
  findDuplicates,
  generateRecommendations,
  saveDiagnosisToFile
};
