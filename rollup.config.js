import resolve from "@rollup/plugin-node-resolve";
import commonjs from "@rollup/plugin-commonjs";
import terser from "@rollup/plugin-terser";

export default {
  input: "src/main.js",
  output: {
    file: "dist/ServiceNow-2-Notion.user.js",
    format: "iife",
    name: "ServiceNowToNotion",
    banner: `// ==UserScript==
// @name         ServiceNow-2-Notion
// @namespace    https://github.com/nortonglitz/ServiceNow-2-Notion
// @version      8.2.4
// @description  Extract ServiceNow content and send to Notion via Universal Workflow or proxy
// @author       Norton Glitz
// @match        https://*.service-now.com/*
// @match        https://*.servicenow.com/*
// @grant        GM_setValue
// @grant        GM_getValue
// @grant        GM_xmlhttpRequest
// @grant        GM_addStyle
// @grant        GM_getResourceText
// @grant        GM_notification
// @run-at       document-idle
// @downloadURL  https://github.com/nortonglitz/ServiceNow-2-Notion/raw/main/dist/ServiceNow-2-Notion.user.js
// @updateURL    https://github.com/nortonglitz/ServiceNow-2-Notion/raw/main/dist/ServiceNow-2-Notion.user.js
// @homepage     https://github.com/nortonglitz/ServiceNow-2-Notion
// @supportURL   https://github.com/nortonglitz/ServiceNow-2-Notion/issues
// @connect      localhost
// @connect      127.0.0.1
// ==/UserScript==

/* jshint esversion: 8 */
/* global GM_setValue, GM_getValue, GM_xmlhttpRequest, GM_addStyle, GM_getResourceText, GM_notification */

(function() {
    'use strict';`,
    footer: `})();`,
    strict: false,
  },
  plugins: [
    resolve({
      browser: true,
      preferBuiltins: false,
    }),
    commonjs(),
    // Only minify in production
    ...(process.env.NODE_ENV === "production"
      ? [
          terser({
            compress: {
              drop_console: false, // Keep console logs for debugging
            },
            mangle: {
              reserved: [
                "GM_setValue",
                "GM_getValue",
                "GM_xmlhttpRequest",
                "GM_addStyle",
                "GM_getResourceText",
                "GM_notification",
              ],
            },
          }),
        ]
      : []),
  ],
};
