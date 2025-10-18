// URL utilities (client-friendly subset of server helpers)

export function normalizeUrl(url, baseUrl = null) {
  if (!url || typeof url !== "string") return url;

  const decodedUrl = url
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'");

  if (decodedUrl.startsWith("#")) return decodedUrl;
  if (decodedUrl.startsWith("/")) {
    if (baseUrl) {
      try {
        const base = new URL(baseUrl);
        return new URL(decodedUrl, base).href;
      } catch (e) {
        return decodedUrl;
      }
    }
    return decodedUrl;
  }
  if (decodedUrl.startsWith("./")) {
    if (baseUrl) {
      try {
        const base = new URL(baseUrl);
        return new URL(decodedUrl, base).href;
      } catch (e) {
        return decodedUrl;
      }
    }
    return decodedUrl;
  }

  try {
    const urlObj = new URL(decodedUrl);
    let pathname = urlObj.pathname;
    const segments = pathname.split("/").filter((s) => s !== "");
    const resolved = [];
    for (const seg of segments) {
      if (seg === "..") resolved.pop();
      else if (seg !== ".") resolved.push(seg);
    }
    urlObj.pathname = "/" + resolved.join("/");
    return urlObj.href;
  } catch (e) {
    if (decodedUrl.includes("../")) {
      const parts = decodedUrl.split("/");
      const resolved = [];
      for (const part of parts) {
        if (part === "..") resolved.pop();
        else if (part !== "." && part !== "") resolved.push(part);
      }
      return resolved.join("/");
    }
    return decodedUrl;
  }
}

export function isValidImageUrl(url) {
  if (!url || typeof url !== "string") return false;
  const normalized = normalizeUrl(url);
  if (normalized.startsWith("#")) return false;
  if (
    normalized.startsWith("../") ||
    normalized.startsWith("./") ||
    normalized.startsWith("/")
  )
    return false;

  try {
    const u = new URL(normalized);
    if (!["http:", "https:"].includes(u.protocol)) return false;
    const hasFileExtension = /\.(jpg|jpeg|png|gif|webp|bmp|svg)$/i.test(
      u.pathname
    );
    const hasQueryParams = u.search.length > 0;
    if (
      u.hostname.includes("servicenow") &&
      !hasFileExtension &&
      hasQueryParams
    )
      return false;
    if (!hasFileExtension && hasQueryParams && u.search.length > 20)
      return false;
    const isDoc = /(docs?|documentation|bundle|page|help|guide)/i.test(
      u.pathname
    );
    if (isDoc && !hasFileExtension) return false;
    return true;
  } catch (e) {
    return false;
  }
}
