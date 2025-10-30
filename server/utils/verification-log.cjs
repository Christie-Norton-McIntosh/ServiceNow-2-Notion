/**
 * @fileoverview Verification Log Utility
 * 
 * Maintains a separate log file for tracking Notion pages that require manual verification.
 * This includes pages with:
 * - Stripped technical placeholders
 * - Failed image uploads (falling back to external URLs)
 * - Cheerio parsing discrepancies
 * - Unprocessed content warnings
 * - Other content conversion issues
 * 
 * @module utils/verification-log
 */

const fs = require('fs');
const path = require('path');

// Log file path
const LOG_DIR = path.join(__dirname, '../logs');
const LOG_FILE = path.join(LOG_DIR, 'pages-to-verify.log');

// Ensure logs directory exists
if (!fs.existsSync(LOG_DIR)) {
  fs.mkdirSync(LOG_DIR, { recursive: true });
}

/**
 * Get Notion page URL from page ID
 * @param {string} pageId - Notion page ID (with or without dashes)
 * @returns {string} Notion page URL
 */
function getNotionUrl(pageId) {
  const cleanId = pageId.replace(/-/g, '');
  return `https://notion.so/${cleanId}`;
}

/**
 * Format timestamp for log entries
 * @returns {string} Formatted timestamp
 */
function getTimestamp() {
  return new Date().toISOString();
}

/**
 * Write a verification entry to the log
 * @param {Object} entry - Verification entry
 * @param {string} entry.pageId - Notion page ID
 * @param {string} entry.pageTitle - Page title
 * @param {string} entry.issueType - Type of issue (e.g., 'PLACEHOLDER_STRIPPED', 'IMAGE_UPLOAD_FAILED')
 * @param {string} entry.description - Detailed description of the issue
 * @param {Object} [entry.context] - Additional context (will be JSON stringified)
 */
function logVerificationEntry(entry) {
  const timestamp = getTimestamp();
  const notionUrl = getNotionUrl(entry.pageId);
  
  const logEntry = {
    timestamp,
    pageId: entry.pageId,
    pageTitle: entry.pageTitle || 'Unknown',
    notionUrl,
    issueType: entry.issueType,
    description: entry.description,
    context: entry.context || {}
  };
  
  // Format as readable text
  const textEntry = [
    '\n' + '='.repeat(80),
    `[${timestamp}] ${entry.issueType}`,
    `Page: ${entry.pageTitle}`,
    `ID: ${entry.pageId}`,
    `URL: ${notionUrl}`,
    `Issue: ${entry.description}`,
    entry.context ? `Context: ${JSON.stringify(entry.context, null, 2)}` : '',
    '='.repeat(80)
  ].filter(Boolean).join('\n');
  
  // Append to log file
  fs.appendFileSync(LOG_FILE, textEntry + '\n', 'utf8');
  
  // Also log to console with color coding
  console.warn('\n⚠️  VERIFICATION NEEDED ⚠️');
  console.warn(textEntry);
}

/**
 * Log a placeholder stripping issue
 * @param {string} pageId - Notion page ID
 * @param {string} pageTitle - Page title
 * @param {Array<string>} placeholders - Array of stripped placeholders
 * @param {string} context - HTML context where placeholders appeared
 */
function logPlaceholderStripped(pageId, pageTitle, placeholders, context) {
  logVerificationEntry({
    pageId,
    pageTitle,
    issueType: 'PLACEHOLDER_STRIPPED',
    description: `${placeholders.length} technical placeholder(s) were stripped: ${placeholders.join(', ')}`,
    context: {
      placeholders,
      htmlContext: context.substring(0, 300)
    }
  });
}

/**
 * Log an image upload failure
 * @param {string} pageId - Notion page ID
 * @param {string} pageTitle - Page title
 * @param {string} imageUrl - Image URL that failed to upload
 * @param {string} errorMessage - Error message from upload attempt
 */
function logImageUploadFailed(pageId, pageTitle, imageUrl, errorMessage) {
  logVerificationEntry({
    pageId,
    pageTitle,
    issueType: 'IMAGE_UPLOAD_FAILED',
    description: `Image upload failed, using external URL fallback`,
    context: {
      imageUrl: imageUrl.substring(0, 200),
      error: errorMessage
    }
  });
}

/**
 * Log a Cheerio parsing discrepancy
 * @param {string} pageId - Notion page ID
 * @param {string} pageTitle - Page title
 * @param {number} lostSections - Number of sections lost during parsing
 * @param {number} lostArticles - Number of articles lost during parsing
 */
function logCheerioParsingIssue(pageId, pageTitle, lostSections, lostArticles) {
  logVerificationEntry({
    pageId,
    pageTitle,
    issueType: 'CHEERIO_PARSING_LOSS',
    description: `Cheerio lost ${lostSections} sections and ${lostArticles} articles during HTML parsing`,
    context: {
      lostSections,
      lostArticles
    }
  });
}

/**
 * Log unprocessed content warning
 * @param {string} pageId - Notion page ID
 * @param {string} pageTitle - Page title
 * @param {number} unprocessedCount - Number of unprocessed elements
 * @param {string} htmlPreview - Preview of remaining HTML structure
 */
function logUnprocessedContent(pageId, pageTitle, unprocessedCount, htmlPreview) {
  logVerificationEntry({
    pageId,
    pageTitle,
    issueType: 'UNPROCESSED_CONTENT',
    description: `${unprocessedCount} content elements were not processed`,
    context: {
      elementCount: unprocessedCount,
      htmlPreview: htmlPreview.substring(0, 500)
    }
  });
}

/**
 * Log content extraction/conversion warning
 * @param {string} pageId - Notion page ID
 * @param {string} pageTitle - Page title
 * @param {string} warningType - Type of warning (e.g., 'MALFORMED_HTML', 'UNSUPPORTED_TAG')
 * @param {string} description - Description of the issue
 * @param {Object} context - Additional context
 */
function logContentWarning(pageId, pageTitle, warningType, description, context = {}) {
  logVerificationEntry({
    pageId,
    pageTitle,
    issueType: warningType,
    description,
    context
  });
}

/**
 * Get summary of verification issues
 * @param {number} [days=7] - Number of days to look back
 * @returns {Object} Summary with counts by issue type
 */
function getVerificationSummary(days = 7) {
  if (!fs.existsSync(LOG_FILE)) {
    return { total: 0, byType: {}, message: 'No verification log found' };
  }
  
  const content = fs.readFileSync(LOG_FILE, 'utf8');
  const lines = content.split('\n');
  
  const cutoffDate = new Date();
  cutoffDate.setDate(cutoffDate.getDate() - days);
  
  const summary = {
    total: 0,
    byType: {},
    recentEntries: []
  };
  
  // Parse log entries
  let currentEntry = null;
  for (const line of lines) {
    if (line.startsWith('[')) {
      // Extract timestamp and issue type
      const timestampMatch = line.match(/\[([^\]]+)\]/);
      const issueTypeMatch = line.match(/\]\s+(\w+)/);
      
      if (timestampMatch && issueTypeMatch) {
        const timestamp = new Date(timestampMatch[1]);
        const issueType = issueTypeMatch[1];
        
        if (timestamp >= cutoffDate) {
          summary.total++;
          summary.byType[issueType] = (summary.byType[issueType] || 0) + 1;
          
          if (summary.recentEntries.length < 10) {
            summary.recentEntries.push({ timestamp: timestampMatch[1], issueType, line });
          }
        }
      }
    }
  }
  
  return summary;
}

/**
 * Clear old log entries (older than specified time)
 * @param {number} [hoursToKeep=24] - Number of hours of logs to keep (default 24 hours)
 */
function cleanOldEntries(hoursToKeep = 24) {
  if (!fs.existsSync(LOG_FILE)) {
    return;
  }
  
  try {
    const content = fs.readFileSync(LOG_FILE, 'utf8');
    if (!content.trim()) {
      return; // Empty file, nothing to clean
    }
    
    // Split by separator and filter entries
    const entries = content.split('\n================================================================================\n');
    const cutoffTime = new Date(Date.now() - (hoursToKeep * 60 * 60 * 1000));
    
    const recentEntries = entries.filter(entry => {
      const match = entry.match(/\[(\d{4}-\d{2}-\d{2}T[\d:.]+Z)\]/);
      if (!match) return false;
      return new Date(match[1]) >= cutoffTime;
    });
    
    if (recentEntries.length === 0) {
      // No recent entries, clear the file
      fs.writeFileSync(LOG_FILE, '', 'utf8');
      console.log(`🧹 Cleaned verification log: no entries within last ${hoursToKeep} hours`);
    } else if (recentEntries.length < entries.length) {
      // Write back only recent entries
      fs.writeFileSync(LOG_FILE, recentEntries.join('\n================================================================================\n'), 'utf8');
      const removed = entries.length - recentEntries.length;
      console.log(`🧹 Cleaned verification log: removed ${removed} old entries, kept ${recentEntries.length} from last ${hoursToKeep} hours`);
    }
  } catch (err) {
    console.error(`❌ Error cleaning verification log: ${err.message}`);
  }
}

module.exports = {
  logVerificationEntry,
  logPlaceholderStripped,
  logImageUploadFailed,
  logCheerioParsingIssue,
  logUnprocessedContent,
  logContentWarning,
  getVerificationSummary,
  cleanOldEntries,
  getNotionUrl,
  LOG_FILE
};
