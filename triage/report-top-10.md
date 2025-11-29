# Validation Triage — Top 10 Failures

Generated: 2025-11-28T05:17:16.878Z

This report lists the top-10 fixtures with the lowest similarity and a concise suggested fix for each. Use the corresponding detail JSON and blocks JSON files in `tests/fixtures/validation-issues/` for deeper analysis.

## 1. working-on-records-in-your-workspace-content-validation-failed-2025-11-27T10-31-16

- Fixture:
  - name: `working-on-records-in-your-workspace-content-validation-failed-bcavs`
  - similarity: **92.9%**
  - htmlSegments: 14
  - notionSegments: 11
  - markerLeak: NO
  - tags: {"hasTable":true,"hasUl":true,"hasOl":false,"hasCallout":true,"marker":false}

- Suggested fix: Table handling: converter sometimes splits a single table into multiple blocks (heading+table). Adjust table unwrapping/merging logic or preserve table as a single block.

- First HTML segments (up to 10):

  - callback features
  - use workspace records to and provide information to your customers and process requests
  - if callback feature is enabled customers can request a callback instead of waiting for the agent to become available agents get the callback interactions routed to them when they are available for phone callbacks auto dialout will happen upon accepting the work item in the inbox however the agent can also use the phone icon in workspace to call the customer directly if the auto dial did not succeed agents can perform the following actions in the workspace
  - dead air
  - voicemail
  - customer is busy
  - other
  - resolved
  - note agents can see the customers name on the inbox callback card
  - note the recording is also added to the activity stream and the attachment tab

- First Notion segments (up to 10):

  - use workspace records to and provide information to your customers and process requests
  - callback features
  - if callback feature is enabled customers can request a callback instead of waiting for the agent to become available agents get the callback interactions routed to them when they are available for phone callbacks auto dialout will happen upon accepting the work item in the inbox however the agent can also use the phone icon in workspace to call the customer directly if the auto dial did not succeed agents can perform the following actions in the workspace
  - note agents can see the customers name on the inbox callback card
  - callback actions
  - field
  - description
  - reattempt callback
  - agents can reattempt a callback by selecting the more actions button and then selecting re attempt callback the reason menu displays and agents have the following options to choose from dead air voicemail customer is busy other
  - closing callback

Detail JSON: `tests/fixtures/validation-issues/working-on-records-in-your-workspace-content-validation-failed-bcavs.detail.json` and blocks: `tests/fixtures/validation-issues/working-on-records-in-your-workspace-content-validation-failed-bcavs.blocks.json`

---

## 2. resize-select-modals-in-configurable-workspace-content-validation-failed-2025-11-27T10-07-39

- Fixture:
  - name: `resize-select-modals-in-configurable-workspace-content-validation-failed-igldp5`
  - similarity: **94.1%**
  - htmlSegments: 17
  - notionSegments: 14
  - markerLeak: YES
  - tags: {"hasTable":false,"hasUl":false,"hasOl":true,"hasCallout":true,"marker":false}

- Suggested fix: Marker leak detected — investigate marker collection/cleanup (collectAndStripMarkers / removeMarkerFromRichTextArray).

- First HTML segments (up to 10):

  - use declarative actions to enable resizing for select modals in your configurable workspace
  - before you begin
  - role required admin
  - about this task
  - if resizing isn t required for all record page modals use declarative actions to enable resizing for select modals
  - configuration at the declarative action level takes higher precedence than system properties
  - procedure
  - navigate to all declarative actions related list actions
  - open a related list action
  - from the ux add on event mapping select the event mapping for opening a modal

- First Notion segments (up to 10):

  - use declarative actions to enable resizing for select modals in your configurable workspace
  - before you begin role required admin
  - about this task
  - if resizing isn t required for all record page modals use declarative actions to enable resizing for select modals
  - configuration at the declarative action level takes higher precedence than system properties
  - procedure
  - navigate to all declarative actions related list actions
  - open a related list action
  - from the ux add on event mapping select the event mapping for opening a modal
  - add the following snippet to the target payload mapping field under container sn2n miieur7e 648z1z

Detail JSON: `tests/fixtures/validation-issues/resize-select-modals-in-configurable-workspace-content-validation-failed-igldp5.detail.json` and blocks: `tests/fixtures/validation-issues/resize-select-modals-in-configurable-workspace-content-validation-failed-igldp5.blocks.json`

---

## 3. administering-tags-2025-11-27t12-23-41-patch-validation-fail-patch-validation-failed-2025-11-28T03-55-15

- Fixture:
  - name: `administering-tags-1yx7pe`
  - similarity: **100%**
  - htmlSegments: 52
  - notionSegments: 57
  - markerLeak: NO
  - tags: {"hasTable":true,"hasUl":true,"hasOl":true,"hasCallout":true,"marker":false}

- Suggested fix: Content mismatch: compare the first differing segments in the detail JSON to find the misaligned conversion (see detail file).

- First HTML segments (up to 10):

  - you can create a tag directly from the tags list
  - before you begin
  - role required tags_admin
  - procedure
  - only tags of the standard or most recent record types appear on the tagged documents page
  - from the tags module you can edit all tags
  - about this task
  - configure the system to automatically assign a tag to records that match conditions defined in the tag record
  - you can enable the system to send a notification when a record with a certain tag is updated
  - navigate to all system definition tags or self service my tags

- First Notion segments (up to 10):

  - if you have an administrator role you can configure and manage all tags even tags created by other users you can also configure notifications auto assignment and zing indexing for tags
  - you must have the tags_admin role for these administrative tasks
  - create a tag from the tags list
  - you can create a tag directly from the tags list
  - before you begin role required tags_admin
  - procedure
  - navigate to all system definition tags or self service my tags
  - click new
  - enter a name for the tag in the name field
  - optional modify tag settings

Detail JSON: `tests/fixtures/validation-issues/administering-tags-1yx7pe.detail.json` and blocks: `tests/fixtures/validation-issues/administering-tags-1yx7pe.blocks.json`

---

## 4. navigate-directly-to-a-table-2025-11-27T12-09-21

- Fixture:
  - name: `navigate-directly-to-a-table-19lv9e`
  - similarity: **100%**
  - htmlSegments: 17
  - notionSegments: 19
  - markerLeak: YES
  - tags: {"hasTable":true,"hasUl":false,"hasOl":true,"hasCallout":true,"marker":false}

- Suggested fix: Marker leak detected — investigate marker collection/cleanup (collectAndStripMarkers / removeMarkerFromRichTextArray).

- First HTML segments (up to 10):

  - you can use commands in the navigation filter to navigate directly to the list form or configuration view of a table
  - before you begin
  - role required none
  - about this task
  - procedure
  - for example enter change_request form to open a new change request
  - in the navigation filter of the application navigator enter one of the following commands export to excelexport to csvtable 1 commandbehavior table name list opens the list view of the table in the same window or tab table name form or table name do opens the form view of the table in the same window or tab table name config opens the configuration view personalize_all do of the table in the same window or tab table name filter opens an empty list view of the table in the same window or tab so that you can apply filters without loading the list this is helpful for large lists that take a long time to load for example enter change_request form to open a new change request note you can also enter any of the commands above in uppercase to open the list or form in a new window or tab for example enter change_request form to open a new change request in a new window or tab
  - in core ui press the enter key
  - note the table name must match the name in the dictionary entry for the table
  - export to excelexport to csvtable 1 commandbehavior table name list opens the list view of the table in the same window or tab table name form or table name do opens the form view of the table in the same window or tab table name config opens the configuration view personalize_all do of the table in the same window or tab table name filter opens an empty list view of the table in the same window or tab so that you can apply filters without loading the list this is helpful for large lists that take a long time to load for example enter change_request form to open a new change request note you can also enter any of the commands above in uppercase to open the list or form in a new window or tab for example enter change_request form to open a new change request in a new window or tab

- First Notion segments (up to 10):

  - you can use commands in the navigation filter to navigate directly to the list form or configuration view of a table
  - before you begin role required none
  - about this task
  - commands work only for tables you are permitted to access
  - note the table name must match the name in the dictionary entry for the table
  - procedure
  - in the navigation filter of the application navigator enter one of the following commands sn2n miieur9p 6q95ch
  - command
  - behavior
  - list

Detail JSON: `tests/fixtures/validation-issues/navigate-directly-to-a-table-19lv9e.detail.json` and blocks: `tests/fixtures/validation-issues/navigate-directly-to-a-table-19lv9e.blocks.json`

---

## 5. navigate-directly-to-a-table-patch-validation-failed-2025-11-27T20-18-48

- Fixture:
  - name: `navigate-directly-to-a-table-patch-validation-failed-40jrg6`
  - similarity: **100%**
  - htmlSegments: 17
  - notionSegments: 19
  - markerLeak: YES
  - tags: {"hasTable":true,"hasUl":false,"hasOl":true,"hasCallout":true,"marker":false}

- Suggested fix: Marker leak detected — investigate marker collection/cleanup (collectAndStripMarkers / removeMarkerFromRichTextArray).

- First HTML segments (up to 10):

  - you can use commands in the navigation filter to navigate directly to the list form or configuration view of a table
  - before you begin
  - role required none
  - about this task
  - procedure
  - for example enter change_request form to open a new change request
  - in the navigation filter of the application navigator enter one of the following commands export to excelexport to csvtable 1 commandbehavior table name list opens the list view of the table in the same window or tab table name form or table name do opens the form view of the table in the same window or tab table name config opens the configuration view personalize_all do of the table in the same window or tab table name filter opens an empty list view of the table in the same window or tab so that you can apply filters without loading the list this is helpful for large lists that take a long time to load for example enter change_request form to open a new change request note you can also enter any of the commands above in uppercase to open the list or form in a new window or tab for example enter change_request form to open a new change request in a new window or tab
  - in core ui press the enter key
  - note the table name must match the name in the dictionary entry for the table
  - export to excelexport to csvtable 1 commandbehavior table name list opens the list view of the table in the same window or tab table name form or table name do opens the form view of the table in the same window or tab table name config opens the configuration view personalize_all do of the table in the same window or tab table name filter opens an empty list view of the table in the same window or tab so that you can apply filters without loading the list this is helpful for large lists that take a long time to load for example enter change_request form to open a new change request note you can also enter any of the commands above in uppercase to open the list or form in a new window or tab for example enter change_request form to open a new change request in a new window or tab

- First Notion segments (up to 10):

  - you can use commands in the navigation filter to navigate directly to the list form or configuration view of a table
  - before you begin role required none
  - about this task
  - commands work only for tables you are permitted to access
  - note the table name must match the name in the dictionary entry for the table
  - procedure
  - in the navigation filter of the application navigator enter one of the following commands sn2n miieura2 qnw790
  - command
  - behavior
  - list

Detail JSON: `tests/fixtures/validation-issues/navigate-directly-to-a-table-patch-validation-failed-40jrg6.detail.json` and blocks: `tests/fixtures/validation-issues/navigate-directly-to-a-table-patch-validation-failed-40jrg6.blocks.json`

---

## 6. activate-the-knowledge-article-view-page-on-upgrade-order-issues-17bou7.json

- Fixture:
  - name: `activate-the-knowledge-article-view-page-on-upgrade-order-issues-17bou7`
  - similarity: **ERR%**
  - htmlSegments: -
  - notionSegments: -
  - markerLeak: NO
  - tags: N/A

- Suggested fix: Conversion error during processing; inspect logs.

- First HTML segments (up to 10):

  - if upgrading from a previous release take advantage of the latest article view features by activating the knowledge article view page route map new capabilities include article versioning and using links and images in article feedback this map is active by default in new instances and applies to all portals in the system
  - before you begin
  - role required admin
  - about this task
  - the knowledge article view page route map routes the kb_article page to the kb_article_view page by default users with the public role cannot access the kb_article_view page however your administrator can modify this behavior for more information see enable external or public users to view knowledge articles from the knowledge management service portal
  - procedure
  - result
  - comment on a knowledge article
  - create an article version by importing a word document
  - create a version of a knowledge article from a managed document

- First Notion segments (up to 10):

  - if upgrading from a previous release take advantage of the latest article view features by activating the knowledge article view page route map new capabilities include article versioning and using links and images in article feedback this map is active by default in new instances and applies to all portals in the system
  - before you begin role required admin
  - about this task
  - the knowledge article view page route map routes the kb_article page to the kb_article_view page by default users with the public role cannot access the kb_article_view page however your administrator can modify this behavior for more information see enable external or public users to view knowledge articles from the knowledge management service portal
  - knowledge article view
  - comment on a knowledge article
  - create an article version by importing a word document
  - create a version of a knowledge article from a managed document
  - procedure
  - navigate to all service portal page route maps

Detail JSON: `tests/fixtures/validation-issues/activate-the-knowledge-article-view-page-on-upgrade-order-issues-17bou7.detail.json` and blocks: `tests/fixtures/validation-issues/activate-the-knowledge-article-view-page-on-upgrade-order-issues-17bou7.blocks.json`

---

## 7. activate-the-knowledge-article-view-page-on-upgrade-order-issues-19ophz.json

- Fixture:
  - name: `activate-the-knowledge-article-view-page-on-upgrade-order-issues-19ophz`
  - similarity: **ERR%**
  - htmlSegments: -
  - notionSegments: -
  - markerLeak: NO
  - tags: N/A

- Suggested fix: Conversion error during processing; inspect logs.

- First HTML segments (up to 10):

  - if upgrading from a previous release take advantage of the latest article view features by activating the knowledge article view page route map new capabilities include article versioning and using links and images in article feedback this map is active by default in new instances and applies to all portals in the system
  - before you begin
  - role required admin
  - about this task
  - the knowledge article view page route map routes the kb_article page to the kb_article_view page by default users with the public role cannot access the kb_article_view page however your administrator can modify this behavior for more information see enable external or public users to view knowledge articles from the knowledge management service portal
  - procedure
  - result
  - comment on a knowledge article
  - create an article version by importing a word document
  - create a version of a knowledge article from a managed document

- First Notion segments (up to 10):

  - if upgrading from a previous release take advantage of the latest article view features by activating the knowledge article view page route map new capabilities include article versioning and using links and images in article feedback this map is active by default in new instances and applies to all portals in the system
  - before you begin role required admin
  - about this task
  - the knowledge article view page route map routes the kb_article page to the kb_article_view page by default users with the public role cannot access the kb_article_view page however your administrator can modify this behavior for more information see enable external or public users to view knowledge articles from the knowledge management service portal
  - knowledge article view
  - comment on a knowledge article
  - create an article version by importing a word document
  - create a version of a knowledge article from a managed document
  - procedure
  - navigate to all service portal page route maps

Detail JSON: `tests/fixtures/validation-issues/activate-the-knowledge-article-view-page-on-upgrade-order-issues-19ophz.detail.json` and blocks: `tests/fixtures/validation-issues/activate-the-knowledge-article-view-page-on-upgrade-order-issues-19ophz.blocks.json`

---

## 8. add-content-to-a-page-1iajxh.json

- Fixture:
  - name: `add-content-to-a-page-1iajxh`
  - similarity: **ERR%**
  - htmlSegments: -
  - notionSegments: -
  - markerLeak: NO
  - tags: N/A

- Suggested fix: Conversion error during processing; inspect logs.

- First HTML segments (up to 10):

  - after you define the page settings set the content of the page by adding content blocks setting content blocks is similar to how you add content to homepages
  - before you begin
  - procedure
  - on the page form under related links click edit page
  - click add content
  - select a content block from the picker
  - select the dropzone where the content goes create content blocks by adding one of the content blocks named new block type to the page
  - note do not add any type of report such as a calendar to iframes for more information on adding a report directly onto a page without using iframes see embedding reports in jelly
  - create content blocks by adding one of the content blocks named new block type to the page

- First Notion segments (up to 10):

  - after you define the page settings set the content of the page by adding content blocks setting content blocks is similar to how you add content to homepages
  - before you begin role required content_admin or admin sn2n miieuraz 97yplu
  - note do not add any type of report such as a calendar to iframes for more information on adding a report directly onto a page without using iframes see embedding reports in jelly
  - procedure
  - on the page form under related links click edit page
  - click add content
  - select a content block from the picker
  - select the dropzone where the content goes create content blocks by adding one of the content blocks named new block type to the page sn2n miieurb2 6um1fu
  - content block options and dropzones
  - related content sn2n related content__miieurb4 sf7olt

Detail JSON: `tests/fixtures/validation-issues/add-content-to-a-page-1iajxh.detail.json` and blocks: `tests/fixtures/validation-issues/add-content-to-a-page-1iajxh.blocks.json`

---

## 9. add-content-to-a-page-1k4w28.json

- Fixture:
  - name: `add-content-to-a-page-1k4w28`
  - similarity: **ERR%**
  - htmlSegments: -
  - notionSegments: -
  - markerLeak: NO
  - tags: N/A

- Suggested fix: Conversion error during processing; inspect logs.

- First HTML segments (up to 10):

  - after you define the page settings set the content of the page by adding content blocks setting content blocks is similar to how you add content to homepages
  - before you begin
  - procedure
  - on the page form under related links click edit page
  - click add content
  - select a content block from the picker
  - select the dropzone where the content goes create content blocks by adding one of the content blocks named new block type to the page
  - note do not add any type of report such as a calendar to iframes for more information on adding a report directly onto a page without using iframes see embedding reports in jelly
  - create content blocks by adding one of the content blocks named new block type to the page

- First Notion segments (up to 10):

  - after you define the page settings set the content of the page by adding content blocks setting content blocks is similar to how you add content to homepages
  - before you begin role required content_admin or admin sn2n miieurb9 fipksr
  - note do not add any type of report such as a calendar to iframes for more information on adding a report directly onto a page without using iframes see embedding reports in jelly
  - procedure
  - on the page form under related links click edit page
  - click add content
  - select a content block from the picker
  - select the dropzone where the content goes create content blocks by adding one of the content blocks named new block type to the page sn2n miieurbd nz5eav
  - content block options and dropzones
  - related content sn2n related content__miieurbe 49qlw8

Detail JSON: `tests/fixtures/validation-issues/add-content-to-a-page-1k4w28.detail.json` and blocks: `tests/fixtures/validation-issues/add-content-to-a-page-1k4w28.blocks.json`

---

## 10. add-content-to-a-page-1r75m8.json

- Fixture:
  - name: `add-content-to-a-page-1r75m8`
  - similarity: **ERR%**
  - htmlSegments: -
  - notionSegments: -
  - markerLeak: NO
  - tags: N/A

- Suggested fix: Conversion error during processing; inspect logs.

- First HTML segments (up to 10):

  - after you define the page settings set the content of the page by adding content blocks setting content blocks is similar to how you add content to homepages
  - before you begin
  - procedure
  - on the page form under related links click edit page
  - click add content
  - select a content block from the picker
  - select the dropzone where the content goes create content blocks by adding one of the content blocks named new block type to the page
  - note do not add any type of report such as a calendar to iframes for more information on adding a report directly onto a page without using iframes see embedding reports in jelly
  - create content blocks by adding one of the content blocks named new block type to the page

- First Notion segments (up to 10):

  - after you define the page settings set the content of the page by adding content blocks setting content blocks is similar to how you add content to homepages
  - before you begin role required content_admin or admin sn2n miieurbl s86c2j
  - note do not add any type of report such as a calendar to iframes for more information on adding a report directly onto a page without using iframes see embedding reports in jelly
  - procedure
  - on the page form under related links click edit page
  - click add content
  - select a content block from the picker
  - select the dropzone where the content goes create content blocks by adding one of the content blocks named new block type to the page sn2n miieurbn i5jory
  - content block options and dropzones
  - related content sn2n related content__miieurbo s5x2rw

Detail JSON: `tests/fixtures/validation-issues/add-content-to-a-page-1r75m8.detail.json` and blocks: `tests/fixtures/validation-issues/add-content-to-a-page-1r75m8.blocks.json`

---

