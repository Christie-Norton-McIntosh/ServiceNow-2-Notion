/**
 * @fileoverview Notion API Service
 * 
 * This module encapsulates all Notion API interactions, providing a clean interface
 * for page creation, block appending, property mapping, and client management.
 * 
 * Key Features:
 * - Notion client initialization and management
 * - Page creation with properties and children blocks
 * - Block appending for content updates
 * - Data-to-property mapping with type validation
 * - Image upload handling (placeholder implementation)
 * - Property schema validation and conversion
 * 
 * Dependencies:
 * - @notionhq/client (Official Notion API client)
 * - axios (HTTP client for image downloads)
 * 
 * @module services/notion
 * @since 8.2.5
 */

const axios = require('axios');
const { Client: NotionClient } = require('@notionhq/client');

let notion = null;

/**
 * Initializes the Notion API client with the provided authentication token.
 * 
 * This function sets up the global Notion client instance used throughout the application.
 * It uses a singleton pattern to ensure only one client instance exists.
 * 
 * @param {string} token - Notion integration token (starts with "secret_")
 * 
 * @returns {NotionClient|null} Initialized Notion client instance, or null if no token provided
 * 
 * @example
 * const client = initNotionClient(process.env.NOTION_TOKEN);
 * if (client) {
 *   console.log('Notion client initialized successfully');
 * }
 * 
 * @see {@link getNotionClient} for retrieving the initialized client
 */
function initNotionClient(token) {
  if (!token) return null;
  if (!notion) {
    notion = new NotionClient({ auth: token, notionVersion: '2022-06-28' });
  }
  return notion;
}

/**
 * Retrieves the currently initialized Notion client instance.
 * 
 * @returns {NotionClient|null} The Notion client instance, or null if not initialized
 * 
 * @example
 * const client = getNotionClient();
 * if (!client) {
 *   throw new Error('Notion client not initialized');
 * }
 * 
 * @see {@link initNotionClient} for initializing the client
 */
function getNotionClient() {
  return notion;
}

/**
 * Creates a new page in a Notion database with the specified properties and content.
 * 
 * @async
 * @param {string} databaseId - UUID of the target Notion database
 * @param {object} properties - Page properties mapped to database schema
 * @param {Array<object>} children - Array of Notion block objects for page content
 * 
 * @returns {Promise<object>} Created page object from Notion API
 * 
 * @throws {Error} If Notion client is not initialized
 * @throws {Error} If database ID is invalid or access is denied
 * @throws {Error} If properties don't match database schema
 * 
 * @example
 * const page = await createPage(
 *   'database-uuid-here',
 *   { 
 *     Title: { title: [{ type: 'text', text: { content: 'New Page' } }] },
 *     Status: { select: { name: 'In Progress' } }
 *   },
 *   [
 *     { type: 'paragraph', paragraph: { rich_text: [{ type: 'text', text: { content: 'Hello world' } }] } }
 *   ]
 * );
 * 
 * @see {@link mapDataToNotionProperties} for property mapping utilities
 */
async function createPage(databaseId, properties, children) {
  if (!notion) throw new Error('Notion client not initialized');
  return await notion.pages.create({
    parent: { database_id: databaseId },
    properties,
    children,
  });
}

/**
 * Appends blocks to an existing Notion page.
 * 
 * This function adds content blocks to a page, useful for updating pages with
 * additional content or handling Notion's 100-block limit through pagination.
 * 
 * @async
 * @param {string} pageId - UUID of the target Notion page
 * @param {Array<object>} blocks - Array of Notion block objects to append
 * 
 * @returns {Promise<object>} Response from Notion API with append results
 * 
 * @throws {Error} If Notion client is not initialized
 * @throws {Error} If page ID is invalid or access is denied
 * @throws {Error} If blocks exceed Notion's limits (100 blocks per request)
 * 
 * @example
 * await appendBlocks('page-uuid-here', [
 *   { type: 'heading_2', heading_2: { rich_text: [{ type: 'text', text: { content: 'New Section' } }] } },
 *   { type: 'paragraph', paragraph: { rich_text: [{ type: 'text', text: { content: 'Additional content' } }] } }
 * ]);
 * 
 * @see {@link createPage} for initial page creation
 */
async function appendBlocks(pageId, blocks) {
  if (!notion) throw new Error('Notion client not initialized');
  return await notion.blocks.children.append({
    block_id: pageId,
    children: blocks,
  });
}

/**
 * Uploads an image to Notion and returns the file upload information.
 * 
 * This is a placeholder implementation for image upload functionality.
 * The actual implementation would download the image from the provided URL
 * and upload it to Notion's file storage system.
 * 
 * @async
 * @param {string} imageUrl - URL of the image to upload to Notion
 * @param {string} [alt='image'] - Alt text for the image
 * 
 * @returns {Promise<string|null>} File upload ID from Notion, or null if upload fails
 * 
 * @todo Implement actual image download and upload functionality
 * @todo Add support for different image formats and size validation
 * @todo Handle Notion's file upload limits and constraints
 * 
 * @example
 * const fileId = await uploadImageToNotion('https://example.com/image.png', 'Example image');
 * if (fileId) {
 *   // Use fileId in image blocks or as page cover/icon
 * }
 */
async function uploadImageToNotion(imageUrl, alt = 'image') {
  // Example: download and upload image, return file_upload id
  // This can be expanded as needed
  // ...implementation...
  return null;
}

/**
 * Maps raw data to Notion database properties using the provided mappings and schema.
 * 
 * This function takes raw data (e.g., from ServiceNow) and converts it to Notion's
 * property format using the mapping configuration and database schema for validation.
 * 
 * @param {object} data - Raw data object with key-value pairs to map
 * @param {object} mappings - Mapping configuration: { notionProperty: dataKey }
 * @param {object} databaseSchema - Notion database schema with property definitions
 * @param {object} databaseSchema.properties - Property definitions keyed by property name
 * 
 * @returns {object} Notion properties object ready for page creation
 * 
 * @example
 * const data = {
 *   title: 'ServiceNow Incident',
 *   state: 'In Progress',
 *   priority: 'High',
 *   created_on: '2023-10-13'
 * };
 * 
 * const mappings = {
 *   'Title': 'title',
 *   'Status': 'state',
 *   'Priority': 'priority',
 *   'Created': 'created_on'
 * };
 * 
 * const properties = mapDataToNotionProperties(data, mappings, databaseSchema);
 * // Returns: {
 * //   Title: { title: [{ type: 'text', text: { content: 'ServiceNow Incident' } }] },
 * //   Status: { select: { name: 'In Progress' } },
 * //   Priority: { select: { name: 'High' } },
 * //   Created: { date: { start: '2023-10-13' } }
 * // }
 * 
 * @see {@link mapValueToNotionProperty} for individual value conversion
 */
function mapDataToNotionProperties(data, mappings, databaseSchema) {
  const { log } = getGlobals();
  const properties = {};

  // Apply property mappings
  for (const [notionProperty, dataKey] of Object.entries(mappings)) {
    if (!data.hasOwnProperty(dataKey)) continue;

    const value = data[dataKey];
    const propertySchema = databaseSchema.properties[notionProperty];

    if (!propertySchema) {
      log(`⚠️ Property ${notionProperty} not found in database schema`);
      continue;
    }

    try {
      const mappedProperty = mapValueToNotionProperty(value, propertySchema);
      if (mappedProperty !== null) {
        properties[notionProperty] = mappedProperty;
      }
    } catch (error) {
      log(`❌ Error mapping ${notionProperty}: ${error.message}`);
    }
  }

  return properties;
}

/**
 * Converts a single value to the appropriate Notion property format based on schema type.
 * 
 * This function handles the conversion of raw values to Notion's typed property format,
 * ensuring compatibility with different property types and validating against schema constraints.
 * 
 * @param {*} value - Raw value to convert (string, number, boolean, Date, Array, etc.)
 * @param {object} propertySchema - Notion property schema definition
 * @param {string} propertySchema.type - Property type (title, rich_text, select, etc.)
 * @param {object} [propertySchema.select] - Select options for select properties
 * @param {object} [propertySchema.multi_select] - Multi-select options for multi_select properties
 * 
 * @returns {object|null} Notion property object, or null if value cannot be converted
 * 
 * @example
 * // Convert text to title property
 * const titleProp = mapValueToNotionProperty('My Page Title', { type: 'title' });
 * // Returns: { title: [{ type: 'text', text: { content: 'My Page Title' } }] }
 * 
 * @example
 * // Convert string to select property
 * const selectProp = mapValueToNotionProperty('High', {
 *   type: 'select',
 *   select: { options: [{ name: 'High', color: 'red' }, { name: 'Low', color: 'green' }] }
 * });
 * // Returns: { select: { name: 'High' } }
 * 
 * @example
 * // Convert date string to date property
 * const dateProp = mapValueToNotionProperty('2023-10-13', { type: 'date' });
 * // Returns: { date: { start: '2023-10-13' } }
 * 
 * @see {@link mapDataToNotionProperties} for bulk property mapping
 */
function mapValueToNotionProperty(value, propertySchema) {
  if (value === null || value === undefined || value === '') return null;

  const type = propertySchema.type;

  switch (type) {
    case 'title':
      return { title: [{ type: 'text', text: { content: String(value).substring(0, 2000) } }] };
    
    case 'rich_text':
      return { rich_text: [{ type: 'text', text: { content: String(value).substring(0, 2000) } }] };
    
    case 'url':
      if (typeof value === 'string' && (value.startsWith('http://') || value.startsWith('https://'))) {
        return { url: value };
      }
      return null;
    
    case 'select':
      const selectOptions = propertySchema.select?.options || [];
      const matchingOption = selectOptions.find(opt => 
        opt.name.toLowerCase() === String(value).toLowerCase()
      );
      if (matchingOption) {
        return { select: { name: matchingOption.name } };
      }
      return null;
    
    case 'multi_select':
      if (Array.isArray(value)) {
        const multiSelectOptions = propertySchema.multi_select?.options || [];
        const validOptions = value
          .map(v => multiSelectOptions.find(opt => opt.name.toLowerCase() === String(v).toLowerCase()))
          .filter(Boolean)
          .map(opt => ({ name: opt.name }));
        
        if (validOptions.length > 0) {
          return { multi_select: validOptions };
        }
      }
      return null;
    
    case 'date':
      if (value instanceof Date || (typeof value === 'string' && !isNaN(Date.parse(value)))) {
        const dateString = value instanceof Date ? value.toISOString().split('T')[0] : value;
        return { date: { start: dateString } };
      }
      return null;
    
    case 'checkbox':
      return { checkbox: Boolean(value) };
    
    case 'number':
      const numValue = Number(value);
      if (!isNaN(numValue)) {
        return { number: numValue };
      }
      return null;
    
    default:
      return null;
  }
}

/**
 * Retrieves global utility functions with fallbacks.
 * 
 * @private
 * @returns {object} Object containing global utility functions
 * @returns {function} returns.log - Logging function (global.log or console.log fallback)
 */
function getGlobals() {
  return {
    log: global.log || console.log,
  };
}

/**
 * @typedef {object} NotionPropertySchema
 * @property {string} type - Property type (title, rich_text, select, etc.)
 * @property {object} [select] - Select configuration for select properties
 * @property {Array<object>} [select.options] - Available select options
 * @property {object} [multi_select] - Multi-select configuration
 * @property {Array<object>} [multi_select.options] - Available multi-select options
 */

/**
 * @typedef {object} NotionDatabaseSchema
 * @property {object} properties - Property definitions keyed by property name
 */

/**
 * @typedef {object} PropertyMappings
 * @description Object mapping Notion property names to data keys
 * @example { "Title": "title", "Status": "state", "Priority": "priority" }
 */

// Export all Notion service functions
module.exports = {
  /** @type {function(string): NotionClient|null} */
  initNotionClient,
  /** @type {function(): NotionClient|null} */
  getNotionClient,
  /** @type {function(string, object, Array<object>): Promise<object>} */
  createPage,
  /** @type {function(string, Array<object>): Promise<object>} */
  appendBlocks,
  /** @type {function(string, string=): Promise<string|null>} */
  uploadImageToNotion,
  /** @type {function(object, PropertyMappings, NotionDatabaseSchema): object} */
  mapDataToNotionProperties,
  /** @type {function(*, NotionPropertySchema): object|null} */
  mapValueToNotionProperty,
};
