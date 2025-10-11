# Notion Blocks & Element Configuration Guide

This document details how HTML elements are converted to Notion blocks and rich text annotations in the Website-to-Notion system.

## Overview

The conversion process uses a marker-based system where HTML elements are first converted to text with special markers, then parsed into Notion blocks with appropriate rich text annotations.

## Marker-Based Processing

### Text Formatting Markers

| Marker              | Notion Annotation | Description         | Example HTML                            |
| ------------------- | ----------------- | ------------------- | --------------------------------------- |
| `**text**`          | **Bold**          | Strong emphasis     | `<strong>`, `<b>`                       |
| `*text*`            | _Italic_          | Emphasis            | `<em>`, `<i>`                           |
| `` `text` ``        | `Inline Code`     | Code snippets       | `<code>`                                |
| `§§UICONTROL§text§` | **Bold Blue**     | UI controls         | `<span class="uicontrol">`              |
| `§§TECHNICAL§text§` | `Red Inline Code` | Technical terms     | `<span class="technical">`              |
| `§§TASKLABEL§text§` | **Bold**          | Task/section labels | `<span class="sectiontitle tasklabel">` |

### Block Separation Markers

| Marker                | Purpose          | Description                       |
| --------------------- | ---------------- | --------------------------------- |
| `§BLOCK§`             | Block separator  | Separates different Notion blocks |
| `§CODEBLOCK§language` | Code block start | Begins a code block with language |
| `§/CODEBLOCK§`        | Code block end   | Ends a code block                 |
| `§LIST§`              | List start       | Begins a list block               |
| `§/LIST§`             | List end         | Ends a list block                 |

## HTML Element Mappings

### Headings

| HTML                   | Notion Block            | Processing                             |
| ---------------------- | ----------------------- | -------------------------------------- |
| `<h1>`                 | Heading 1               | Direct conversion, preserves hierarchy |
| `<h2>`                 | Heading 2               | Direct conversion                      |
| `<h3>`                 | Heading 3               | Direct conversion                      |
| `<h4>`, `<h5>`, `<h6>` | Paragraph with **bold** | Notion limits to 3 heading levels      |

### Text Blocks

| HTML     | Notion Block    | Processing                              |
| -------- | --------------- | --------------------------------------- |
| `<p>`    | Paragraph       | Processes inline formatting markers     |
| `<div>`  | Paragraph       | Container elements become paragraphs    |
| `<span>` | Inline text     | Formatting based on class attributes    |
| `<br>`   | Soft line break | Preserves line breaks within paragraphs |

### Lists

| HTML   | Notion Block  | Processing                        |
| ------ | ------------- | --------------------------------- |
| `<ul>` | Bulleted List | Converts `<li>` to list items     |
| `<ol>` | Numbered List | Converts `<li>` to numbered items |
| `<li>` | List Item     | Supports nesting up to 2 levels   |

### Code Elements

| HTML                        | Notion Block            | Processing                       |
| --------------------------- | ----------------------- | -------------------------------- |
| `<pre>`                     | Code Block              | Language detection from class/id |
| `<code>`                    | Inline Code             | Within text blocks               |
| `<pre class="language-js">` | Code Block (JavaScript) | Class-based language detection   |

### Tables

| HTML           | Notion Block  | Processing                   |
| -------------- | ------------- | ---------------------------- |
| `<table>`      | Table         | Full table structure         |
| `<thead>`      | Table headers | First row becomes headers    |
| `<tbody>`      | Table rows    | Subsequent rows as data      |
| `<tr>`         | Table row     | Row structure                |
| `<th>`, `<td>` | Table cell    | Cell content with formatting |

### Media Elements

| HTML           | Notion Block    | Processing                            |
| -------------- | --------------- | ------------------------------------- |
| `<img>`        | Image           | Uploaded to Notion                    |
| `<figure>`     | Image + Caption | Image with separate caption paragraph |
| `<figcaption>` | Paragraph       | Caption text below image              |

### Blockquotes

| HTML           | Notion Block | Processing          |
| -------------- | ------------ | ------------------- |
| `<blockquote>` | Quote        | Block quote styling |

## Special Element Classes

### ServiceNow-Specific Classes

| Class                    | Processing            | Notion Result      |
| ------------------------ | --------------------- | ------------------ |
| `uicontrol`              | UI control marker     | **Bold blue text** |
| `technical`              | Technical term marker | `Red inline code`  |
| `sectiontitle tasklabel` | Task label marker     | **Bold text**      |
| `code`                   | Code element          | `Inline code`      |

### Generic Classes

| Class Pattern | Processing          | Notion Result                     |
| ------------- | ------------------- | --------------------------------- |
| `language-*`  | Code language       | Code block with detected language |
| `highlight`   | Syntax highlighting | Preserved in code blocks          |

## Processing Rules

### Mixed Content Handling

Paragraphs containing both text and code blocks are split:

```html
<p>Here is some text <code>inline code</code> and more text.</p>
```

Becomes:

- Paragraph: "Here is some text `inline code` and more text."

### Figure Captions

```html
<figure>
  <img src="image.jpg" alt="Alt text" />
  <figcaption>This is the caption</figcaption>
</figure>
```

Becomes:

1. Image block
2. Caption paragraph: "This is the caption"

### Nested Lists

Lists are flattened to Notion's 2-level maximum:

```html
<ul>
  <li>
    Item 1
    <ul>
      <li>Nested item 1</li>
      <li>
        Nested item 2
        <ul>
          <li>Deep nested (becomes regular paragraph)</li>
        </ul>
      </li>
    </ul>
  </li>
</ul>
```

### Character Limits

Long content is automatically chunked:

- **Paragraphs**: Split at natural breakpoints
- **Code blocks**: Split at line boundaries
- **Tables**: Split into multiple tables if needed

## Configuration

### Custom Element Mappings

Add custom mappings in `server/sn2n-proxy.cjs`:

```javascript
const customMappings = {
  ".my-custom-class": "§§CUSTOM§",
  "data-custom": "§§SPECIAL§",
};
```

### Language Detection

Code block languages are detected from:

1. `class` attributes: `language-js`, `lang-javascript`
2. `id` attributes: `code-javascript`
3. Parent element classes
4. Content analysis (fallback)

## Debugging

### Verbose Logging

Enable detailed processing logs:

```bash
SN2N_VERBOSE=1 npm start
```

### Marker Processing

Logs show the conversion pipeline:

```
[HTML] <p><strong>Bold</strong> text</p>
[MARKERS] **Bold** text
[BLOCKS] Paragraph with bold annotation
```

### Error Handling

- Invalid HTML is sanitized
- Unsupported elements become plain text
- Encoding issues are logged and recovered

## Extending the System

### Adding New Markers

1. Define marker format in `server/sn2n-proxy.cjs`
2. Add processing logic in the conversion pipeline
3. Update this documentation

### Custom Element Handlers

Add custom element processing:

```javascript
function processCustomElement(element) {
  // Custom logic here
  return processedContent;
}
```

### Testing Conversions

Use the test links in `server/test-links.cjs` to validate conversions on real content.
