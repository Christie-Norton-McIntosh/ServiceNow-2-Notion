# Website-to-Notion Template

This template provides a complete framework for extracting content from any website and converting it to Notion pages. It includes a Tampermonkey userscript frontend and a Node.js proxy server backend.

## Architecture

- **Frontend**: Tampermonkey userscript extracts content from web pages and sends to local proxy server
- **Backend**: Node.js/Express server converts HTML to Notion blocks and creates pages via Notion API
- **Build**: Rollup bundles ES6 modules into a single userscript file

## Quick Start

1. **Install dependencies**:

   ```bash
   npm install
   cd server && npm install && cd ..
   ```

2. **Configure Notion**:

   - Create a Notion database with desired properties
   - Get your Notion API key and database ID
   - Update `src/config.js` with your credentials

3. **Customize content extraction**:

   - Edit `src/content/content-extractor.js` for your website's content structure
   - Edit `src/content/metadata-extractor.js` for metadata extraction

4. **Build and test**:
   ```bash
   npm run build
   npm start  # Start proxy server
   # Load dist/Website-to-Notion.user.js into Tampermonkey
   ```

## Customization Points

### Content Extraction (`src/content/content-extractor.js`)

This module extracts the main content from web pages. Key functions:

- `extractContent()`: Main content extraction logic
- `extractImages()`: Image URL extraction and processing
- `extractTables()`: Table structure parsing

### Metadata Extraction (`src/content/metadata-extractor.js`)

This module extracts page metadata like title, author, date, etc. Key functions:

- `extractMetadata()`: Main metadata extraction
- `extractTitle()`: Page title extraction
- `extractTags()`: Tag/category extraction

### Notion Database Configuration

Update `src/config.js` with your Notion database schema:

```javascript
export const NOTION_CONFIG = {
  apiKey: "your-api-key",
  databaseId: "your-database-id",
  properties: {
    Title: { type: "title" },
    URL: { type: "url" },
    Tags: { type: "multi_select" },
    // Add your custom properties
  },
};
```

## Notion Block Types & Element Styling

The proxy server converts HTML elements to Notion blocks using marker-based processing. Here are the supported conversions:

### Text Formatting Markers

| HTML Element                            | Notion Annotation | Example                |
| --------------------------------------- | ----------------- | ---------------------- |
| `<strong>`, `<b>`                       | **bold**          | `**bold text**`        |
| `<em>`, `<i>`                           | _italic_          | `*italic text*`        |
| `<code>`                                | `inline code`     | `` `code` ``           |
| `<span class="uicontrol">`              | **bold blue**     | `**UI Control**`       |
| `<span class="technical">`              | `red inline code` | `` `technical term` `` |
| `<span class="sectiontitle tasklabel">` | **bold**          | `**Task Label**`       |

### Block Types

| HTML Element         | Notion Block Type      | Notes                                    |
| -------------------- | ---------------------- | ---------------------------------------- |
| `<p>`                | Paragraph              | Basic text block                         |
| `<h1>`, `<h2>`, etc. | Heading 1/2/3          | Respects heading hierarchy               |
| `<pre>`              | Code Block             | Language detection from class attributes |
| `<ul>`, `<ol>`       | Bulleted/Numbered List | Nested up to 2 levels                    |
| `<blockquote>`       | Quote                  | Block quote styling                      |
| `<table>`            | Table                  | Full table structure with headers        |
| `<img>`              | Image                  | Uploaded to Notion with alt text         |
| `<figure>`           | Image + Caption        | Caption as separate paragraph            |

### Special Processing

- **Mixed Content**: Paragraphs containing both text and code blocks are split appropriately
- **Figure Captions**: `<figcaption>` elements become separate caption paragraphs
- **Soft Returns**: Line breaks within paragraphs are preserved
- **Technical Identifiers**: Elements with specific classes get special formatting
- **Character Limits**: Long content is automatically chunked to fit Notion's limits

## Development Workflow

### Building

```bash
npm run build  # Creates dist/Website-to-Notion.user.js
```

### Server Development

```bash
npm start  # Auto-restarts on server/ changes
```

### Version Management

```bash
npm version patch  # For bug fixes
npm version minor  # For new features
npm version major  # For breaking changes
```

## UI Components

The template includes reusable UI components in `src/ui/`:

- `main-panel.js`: Main control panel
- `property-mapping-modal.js`: Notion property mapping
- `advanced-settings-modal.js`: Configuration options
- `overlay-progress.js`: Progress indicators

## API Modules

- `database-api.js`: Notion database operations
- `proxy-api.js`: Communication with proxy server
- `workflow-api.js`: Multi-step operations

## Utilities

- `notion-utils.js`: Notion-specific helper functions
- `url-utils.js`: URL processing utilities

## Troubleshooting

### Common Issues

1. **Userscript not loading**: Ensure Tampermonkey is enabled and userscript is installed
2. **Proxy server connection failed**: Check that `npm start` is running on port 3004
3. **Notion API errors**: Verify API key and database ID in config
4. **Content not extracting**: Check browser console for extraction errors

### Debug Mode

Set `SN2N_VERBOSE=1` environment variable for detailed logging:

```bash
SN2N_VERBOSE=1 npm start
```

## Contributing

When adapting this template for a new website:

1. Fork this template
2. Customize `src/content/` modules for your target website
3. Update `src/config.js` with your Notion database schema
4. Test thoroughly on your target pages
5. Update this README with website-specific instructions
