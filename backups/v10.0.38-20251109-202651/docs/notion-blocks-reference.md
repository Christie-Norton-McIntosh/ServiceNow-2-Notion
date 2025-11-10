# Notion Block Types & Suggested HTML Sources

This table lists the block types exposed by the Notion public API alongside commonly associated HTML tags or structures that can be translated into each block. Leave the HTML column blank when there is no conventional HTML source.

| Notion Block Type  | Typical HTML Tags / Structures                                        |
| ------------------ | --------------------------------------------------------------------- |
| paragraph          | `<p>`<br>`<div>` (text-only)                                          |
| heading_1          | `<h1>`                                                                |
| heading_2          | `<h2>`                                                                |
| heading_3          | `<h3>`                                                                |
| bulleted_list_item | `<ul>` + `<li>`                                                       |
| numbered_list_item | `<ol>` + `<li>`                                                       |
| to_do              | `<input type="checkbox">` + `<label>`<br>`<li class="task">`          |
| toggle             | `<details>` + `<summary>`                                             |
| child_page         |                                                                       |
| child_database     |                                                                       |
| callout            | `<aside>`<br>`<div class="callout">`                                  |
| quote              | `<blockquote>`                                                        |
| code               | `<pre>`<br>`<code>`                                                   |
| equation           | `<math>`<br>`<span class="math">`<br>`$$…$$`                          |
| divider            | `<hr>`                                                                |
| breadcrumb         | `<nav class="breadcrumb">`<br>`<ul class="breadcrumb">`               |
| table_of_contents  | `<nav class="toc">`<br>`<div id="toc">`                               |
| column_list        | `<div class="row">`<br>`<div class="columns">`                        |
| column             | `<div class="col">`<br>`<div class="column">`                         |
| link_to_page       | `<a href="https://www.notion.so/...">`                                |
| synced_block       |                                                                       |
| template           |                                                                       |
| table              | `<table>`                                                             |
| table_row          | `<tr>`                                                                |
| embed              | `<iframe>`<br>`<object>`<br>`<embed>`                                 |
| bookmark           | `<a>` with Open Graph meta preview<br>`<figure class="link-preview">` |
| link_preview       | `<figure class="link-preview">`<br>`<a class="card">`                 |
| image              | `<img>`<br>`<figure><img>`                                            |
| video              | `<video>`<br>`<iframe>` (YouTube/Vimeo embeds)                        |
| audio              | `<audio>`                                                             |
| file               | `<a href="file.ext">`<br>`<object data="file.ext">`                   |
| pdf                | `<embed type="application/pdf">`<br>`<object data="...pdf">`          |
| captioned_image    | `<figure><img><figcaption>`                                           |
| unsupported        |                                                                       |
