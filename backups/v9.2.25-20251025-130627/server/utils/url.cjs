/**
 * @fileoverview URL Utilities
 * 
 * Centralized URL normalization and validation utilities for ServiceNow integration.
 * 
 * @module utils/url
 * @since 9.0.0
 */

/**
 * Converts ServiceNow relative URLs to absolute URLs.
 * @param {string} url - The URL to normalize
 * @returns {string} Absolute ServiceNow URL if input is relative, otherwise original
 */
function convertServiceNowUrl(url) {
  if (!url || typeof url !== "string") return url;
  if (url.startsWith("/")) {
    return "https://www.servicenow.com" + url;
  }
  return url;
}

/**
 * Validates if a URL is safe and properly formatted for Notion links.
 * @param {string} url - The URL to validate
 * @returns {boolean} True if URL is valid for Notion, false otherwise
 */
function isValidNotionUrl(url) {
  if (!url || typeof url !== "string") {
    return false;
  }
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

/**
 * Determines if an iframe URL is from a known video platform.
 * @param {string} url - The iframe URL to check
 * @returns {boolean} True if URL is from a recognized video platform
 */
function isVideoIframeUrl(url) {
  if (!url) return false;
  const videoPatterns = [
    /youtube\.com\/embed\//i,
    /youtube-nocookie\.com\/embed\//i,
    /player\.vimeo\.com\//i,
    /vimeo\.com\/video\//i,
    /wistia\.(com|net)/i,
    /fast\.wistia\.(com|net)/i,
    /loom\.com\/embed\//i,
    /vidyard\.com\/embed\//i,
    /brightcove\.(com|net)/i,
  ];
  return videoPatterns.some((pattern) => pattern.test(url));
}

module.exports = {
  convertServiceNowUrl,
  isValidNotionUrl,
  isVideoIframeUrl
};
