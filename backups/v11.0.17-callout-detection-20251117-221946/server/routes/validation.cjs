/**
 * Validation endpoints for HTML-to-Notion conversions
 * Integrates the validation scripts with the API workflow
 */

const { Router } = require('express');
const cheerio = require('cheerio');
const { performDryRunConversion } = require('./w2n.cjs');

const router = Router();

/**
 * Lenient validation thresholds (avoid excessive failures)
 * These match the thresholds used in validateNotionPage (±30% tolerance)
 */
const VALIDATION_THRESHOLDS = {
  // Block count range: ±30% (same as validateNotionPage)
  // minBlocks = expectedBlocks * 0.7, maxBlocks = expectedBlocks * 1.5
  blockCountMin: 0.7,  // 70% of expected
  blockCountMax: 1.5,  // 150% of expected
  
  // Default element count tolerance (30%)
  countDiffPercent: 30,
};

/**
 * Extract HTML structure for validation
 */
function extractHtmlStructure(html) {
  const $ = cheerio.load(html);
  
  // Find the ServiceNow content container
  const contentContainer = $('div.body').first();
  if (contentContainer.length === 0) {
    return {
      headings: 0,
      lists: 0,
      tables: 0,
      images: 0,
      codeBlocks: 0,
      callouts: 0,
    };
  }

  // Count structural elements
  const headings = contentContainer.find('h1, h2, h3, h4, h5, h6').length;
  const lists = contentContainer.find('ol, ul').length;
  const tables = contentContainer.find('table').length;
  const images = contentContainer.find('img').length;
  const codeBlocks = contentContainer.find('pre, code.codeblock').length;
  
  // Callouts are typically divs with specific classes
  const callouts = contentContainer.find('div.note, div.tip, div.warning, div.caution, div.important').length;

  return {
    headings,
    lists,
    tables,
    images,
    codeBlocks,
    callouts,
  };
}

/**
 * Extract Notion block structure for validation
 */
function extractNotionStructure(blocks) {
  let headings = 0;
  let lists = 0;
  let tables = 0;
  let images = 0;
  let codeBlocks = 0;
  let callouts = 0;

  function countBlocks(blockList) {
    for (const block of blockList) {
      if (block.type?.match(/heading_/)) headings++;
      if (block.type === 'numbered_list_item' || block.type === 'bulleted_list_item') lists++;
      if (block.type === 'table') tables++;
      if (block.type === 'image') images++;
      if (block.type === 'code') codeBlocks++;
      if (block.type === 'callout') callouts++;
      
      // Recurse into children
      if (block.children && block.children.length > 0) {
        countBlocks(block.children);
      }
    }
  }

  countBlocks(blocks);

  return {
    headings,
    lists,
    tables,
    images,
    codeBlocks,
    callouts,
  };
}

/**
 * Compare two counts with lenient threshold
 * @returns {object} { pass: boolean, diff: number, diffPercent: number }
 */
function compareWithThreshold(htmlCount, notionCount, threshold = VALIDATION_THRESHOLDS.countDiffPercent) {
  if (htmlCount === 0 && notionCount === 0) {
    return { pass: true, diff: 0, diffPercent: 0 };
  }
  
  const diff = Math.abs(htmlCount - notionCount);
  const diffPercent = htmlCount > 0 ? (diff / htmlCount) * 100 : (notionCount > 0 ? 100 : 0);
  
  return {
    pass: diffPercent <= threshold,
    diff,
    diffPercent: Math.round(diffPercent),
  };
}

/**
 * Validate HTML-to-Notion conversion
 * POST /api/validate
 * Body: { contentHtml: string, databaseId?: string }
 * Returns: { valid: boolean, issues: string[], warnings: string[], stats: object }
 */
router.post('/validate', async (req, res) => {
  try {
    const { contentHtml, databaseId } = req.body;
    
    if (!contentHtml) {
      return res.status(400).json({
        success: false,
        error: 'Missing contentHtml in request body',
      });
    }

    // Extract HTML structure
    const htmlStructure = extractHtmlStructure(contentHtml);

    // Perform dry-run conversion to get Notion blocks
    const dryRunResult = await performDryRunConversion({
      contentHtml,
      databaseId: databaseId || process.env.NOTION_DATABASE_ID,
      title: 'Validation Dry Run',
    });

    if (!dryRunResult.success) {
      return res.status(500).json({
        success: false,
        error: 'Dry run conversion failed',
        details: dryRunResult.error,
      });
    }

    // Extract Notion structure
    const notionStructure = extractNotionStructure(dryRunResult.children || []);

    // Compare structures with lenient thresholds
    const issues = [];
    const warnings = [];
    
    // Headings
    const headingComparison = compareWithThreshold(htmlStructure.headings, notionStructure.headings);
    if (!headingComparison.pass) {
      if (headingComparison.diffPercent > 50) {
        issues.push(`Heading count mismatch: HTML=${htmlStructure.headings}, Notion=${notionStructure.headings} (${headingComparison.diffPercent}% diff)`);
      } else {
        warnings.push(`Heading count differs: HTML=${htmlStructure.headings}, Notion=${notionStructure.headings} (${headingComparison.diffPercent}% diff)`);
      }
    }

    // Lists (most lenient - Notion flattens nested lists)
    const listComparison = compareWithThreshold(htmlStructure.lists, notionStructure.lists, 50); // 50% threshold
    if (!listComparison.pass) {
      warnings.push(`List count differs significantly: HTML=${htmlStructure.lists}, Notion=${notionStructure.lists} (${listComparison.diffPercent}% diff)`);
    }

    // Tables (should match closely)
    const tableComparison = compareWithThreshold(htmlStructure.tables, notionStructure.tables, 20);
    if (!tableComparison.pass) {
      if (tableComparison.diffPercent > 40) {
        issues.push(`Table count mismatch: HTML=${htmlStructure.tables}, Notion=${notionStructure.tables} (${tableComparison.diffPercent}% diff)`);
      } else {
        warnings.push(`Table count differs: HTML=${htmlStructure.tables}, Notion=${notionStructure.tables} (${tableComparison.diffPercent}% diff)`);
      }
    }

    // Images (allow for deduplication)
    const imageComparison = compareWithThreshold(htmlStructure.images, notionStructure.images, 40);
    if (!imageComparison.pass) {
      warnings.push(`Image count differs: HTML=${htmlStructure.images}, Notion=${notionStructure.images} (${imageComparison.diffPercent}% diff, deduplication expected)`);
    }

    // Code blocks
    const codeComparison = compareWithThreshold(htmlStructure.codeBlocks, notionStructure.codeBlocks);
    if (!codeComparison.pass) {
      warnings.push(`Code block count differs: HTML=${htmlStructure.codeBlocks}, Notion=${notionStructure.codeBlocks} (${codeComparison.diffPercent}% diff)`);
    }

    // Callouts (allow for filtering of gray info callouts)
    const calloutComparison = compareWithThreshold(htmlStructure.callouts, notionStructure.callouts, 40);
    if (!calloutComparison.pass) {
      warnings.push(`Callout count differs: HTML=${htmlStructure.callouts}, Notion=${notionStructure.callouts} (${calloutComparison.diffPercent}% diff, filtering expected)`);
    }

    // Determine overall validation status
    const valid = issues.length === 0;

    return res.json({
      success: true,
      valid,
      issues,
      warnings,
      stats: {
        html: htmlStructure,
        notion: notionStructure,
        comparisons: {
          headings: headingComparison,
          lists: listComparison,
          tables: tableComparison,
          images: imageComparison,
          codeBlocks: codeComparison,
          callouts: calloutComparison,
        },
      },
    });
  } catch (error) {
    console.error('❌ Validation error:', error);
    return res.status(500).json({
      success: false,
      error: 'Validation failed',
      details: error.message,
    });
  }
});

/**
 * Helper function to perform dry-run conversion
 * Exported for use by w2n route
 */
async function performDryRunConversion(data) {
  // This is imported from w2n.cjs above
  return performDryRunConversion(data);
}

module.exports = { router, extractHtmlStructure, extractNotionStructure, compareWithThreshold };
