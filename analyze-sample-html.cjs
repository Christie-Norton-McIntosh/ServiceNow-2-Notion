#!/usr/bin/env node

/**
 * Test server processing of Related Content HTML
 */

const fs = require('fs');
const path = require('path');

// Read the sample HTML
const htmlFile = 'sample-activate-procurement';
const htmlContent = fs.readFileSync(htmlFile, 'utf8');

console.log(`📄 Loaded HTML: ${htmlContent.length} characters`);
console.log(`🔍 Contains "Related Content": ${htmlContent.includes('Related Content')}`);

// Extract just the content part (remove the outer wrapper)
const startMarker = '<div dir="ltr" class="zDocsTopicPageBodyContent">';
const endMarker = '</div><div class="" style="display: block !important;';

const startIdx = htmlContent.indexOf(startMarker);
const endIdx = htmlContent.indexOf(endMarker, startIdx);

if (startIdx !== -1 && endIdx !== -1) {
    const contentHtml = htmlContent.substring(startIdx, endIdx + endMarker.length);
    console.log(`📋 Extracted content HTML: ${contentHtml.length} characters`);
    console.log(`🔍 Content contains Related Content: ${contentHtml.includes('Related Content')}`);

    // Count contentPlaceholder elements
    const placeholderMatches = contentHtml.match(/contentPlaceholder/g) || [];
    console.log(`🏷️  Found ${placeholderMatches.length} contentPlaceholder references`);

    // Extract Related Content section
    const relatedStart = contentHtml.indexOf('<h5 class=" css-g931ng" aria-level="5">Related Content</h5>');
    if (relatedStart !== -1) {
        const relatedEnd = contentHtml.indexOf('</div></div><div class=""', relatedStart);
        if (relatedEnd !== -1) {
            const relatedSection = contentHtml.substring(relatedStart, relatedEnd + 12);
            console.log(`📎 Related Content section: ${relatedSection.length} characters`);
            console.log(`📎 Contains ${relatedSection.match(/<li>/g)?.length || 0} list items`);
            console.log(`📎 Contains ${relatedSection.match(/<a /g)?.length || 0} links`);
        }
    }

    // Save for server testing
    const testFile = 'test-related-content-server.html';
    fs.writeFileSync(testFile, contentHtml);
    console.log(`💾 Saved test HTML to: ${testFile}`);

} else {
    console.log('❌ Could not extract content HTML from sample');
}