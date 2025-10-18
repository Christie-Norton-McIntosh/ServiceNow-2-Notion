/**
 * Centralized configuration loader.
 */
require('dotenv').config();

module.exports = {
  port: parseInt(process.env.PORT || '3004', 10),
  notionToken: process.env.NOTION_TOKEN || null,
  notionVersion: process.env.NOTION_VERSION || '2022-06-28',
  verbose: process.env.SN2N_VERBOSE === '1',
  extraDebug: process.env.SN2N_EXTRA_DEBUG === '1',
};
