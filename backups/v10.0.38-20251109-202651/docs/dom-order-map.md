# DOM Order Map

This note explains the DOM order map introduced in `server/services/servicenow.cjs` to keep orphaned nodes (for example, stray `<li>` elements) in their original position when we rebuild the list of content elements.

## Why we need it

ServiceNow pages occasionally produce HTML where list items or sections sit outside their expected parents. Our extraction logic collects those "orphan" elements from multiple locations to make sure they are not lost. Before the map existed, those orphaned nodes were appended to the end of `contentElements`, which meant they showed up at the bottom of the Notion page instead of in the correct step order.

## How the map is built

1. Right after Cheerio loads the document, we walk every node under `$.root()` using `$.root().find('*')`.
2. For each element we encounter, we store the element reference as the key in a `Map` (`elementOrderMap`) and assign it the next incremental index (`orderCounter++`).
3. Because Cheerio exposes stable element objects, we can later look up the same reference and recover the original traversal index.
4. We log the total number of indexed elements so we can trace issues if the map ever goes out of sync.

```js
let elementOrderMap = new Map();
let orderCounter = 0;
$.root().find('*').each((_, el) => {
  if (el && !elementOrderMap.has(el)) {
    elementOrderMap.set(el, orderCounter++);
  }
});
```

## Where the map is used

After all collection strategies finish populating `contentElements`, we sort the array by the stored index:

```js
contentElements.sort((a, b) => {
  const orderA = elementOrderMap.has(a) ? elementOrderMap.get(a) : Number.MAX_SAFE_INTEGER;
  const orderB = elementOrderMap.has(b) ? elementOrderMap.get(b) : Number.MAX_SAFE_INTEGER;
  return orderA - orderB;
});
```

This ensures that whatever order the element appeared in the source HTML is preserved in the final processing queue. Anything that was not indexed (for example, dynamically created nodes) floats to the bottom via `Number.MAX_SAFE_INTEGER`, which is a safe fallback.

## Maintenance tips

- **Keep the map in sync:** If new code creates entirely new Cheerio elements that need ordering guarantees, add them to the map when they are created.
- **Avoid cloning without indexing:** Cloning nodes produces new element objects that are not in the map. Either index the clone immediately or avoid sorting them with the originals.
- **Reset per extraction:** The map is declared inside `extractContentFromHtml`, so each conversion starts with a clean slate.
- **Logging:** The existing verbose logging shows how many elements were indexed and when the sort runs, which is useful when debugging ordering bugs.

With this map in place, orphaned nodes now stay in their canonical order, eliminating the "stray steps at the bottom" regression without sacrificing the safety net that collects them in the first place.
