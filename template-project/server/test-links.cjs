// Test script for hyperlink processing
function cleanHtmlText(html) {
  if (!html) return "";

  // Remove HTML tags
  let text = html.replace(/<[^>]*>/g, " ");

  // Decode HTML entities
  text = text
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&nbsp;/g, " ");

  // Clean up whitespace
  text = text.replace(/\s+/g, " ").trim();

  return text;
}

// Helper function to validate URLs for Notion links
function isValidNotionUrl(url) {
  if (!url || typeof url !== "string") return false;

  try {
    const parsedUrl = new URL(url);

    // Only allow http and https protocols
    if (!["http:", "https:"].includes(parsedUrl.protocol)) {
      return false;
    }

    // Basic validation - URL should have a hostname
    if (!parsedUrl.hostname) {
      return false;
    }

    return true;
  } catch (e) {
    // Invalid URL format
    return false;
  }
}

// Helper function to convert HTML to Notion rich text format
function htmlToNotionRichText(html) {
  if (!html) return [{ type: "text", text: { content: "" } }];

  const richText = [];
  let text = html;

  // Handle links specially - support both single and double quotes
  const linkRegex = /<a[^>]*href=(["'])([^"']*)\1[^>]*>([\s\S]*?)<\/a>/gi;
  let lastIndex = 0;
  let match;

  while ((match = linkRegex.exec(text)) !== null) {
    // Add text before the link
    if (match.index > lastIndex) {
      const beforeText = text.substring(lastIndex, match.index);
      const cleanedBefore = cleanHtmlText(beforeText);
      if (cleanedBefore.trim()) {
        richText.push({
          type: "text",
          text: { content: cleanedBefore },
        });
      }
    }

    // Add the link (only if URL is valid)
    const linkText = cleanHtmlText(match[3]);
    const linkUrl = match[2];
    if (linkText.trim()) {
      if (linkUrl && isValidNotionUrl(linkUrl)) {
        richText.push({
          type: "text",
          text: { content: linkText.trim(), link: { url: linkUrl } },
        });
      } else {
        // Invalid URL - just add as plain text
        richText.push({
          type: "text",
          text: { content: linkText.trim() },
        });
      }
    }

    lastIndex = linkRegex.lastIndex;
  }

  // Add remaining text after last link
  if (lastIndex < text.length) {
    const remainingText = text.substring(lastIndex);
    const cleanedRemaining = cleanHtmlText(remainingText);
    if (cleanedRemaining.trim()) {
      richText.push({
        type: "text",
        text: { content: cleanedRemaining },
      });
    }
  }

  // If no links were found, return plain text
  if (richText.length === 0) {
    return [{ type: "text", text: { content: cleanHtmlText(text) } }];
  }

  // Ensure proper spacing between rich text elements
  for (let i = 0; i < richText.length - 1; i++) {
    const current = richText[i];
    const next = richText[i + 1];

    // If current text doesn't end with space and next text doesn't start with space
    if (
      current.text.content &&
      next.text.content &&
      !current.text.content.endsWith(" ") &&
      !next.text.content.startsWith(" ")
    ) {
      // Add space to the end of current text
      current.text.content += " ";
    }
  }

  return richText;
}

const testHtml =
  '<p>This is a test with <a href="https://servicenow.com">ServiceNow</a> and <a href="https://store.servicenow.com">Store</a> links.</p>';

console.log("Testing HTML:", testHtml);

const result = htmlToNotionRichText(testHtml);
console.log("Result:", JSON.stringify(result, null, 2));
