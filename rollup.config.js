import resolve from "@rollup/plugin-node-resolve";
import commonjs from "@rollup/plugin-commonjs";
import terser from "@rollup/plugin-terser";
import fs from "fs";

// Dynamically read version from package.json
const pkg = JSON.parse(fs.readFileSync("./package.json", "utf8"));
const version = pkg.version;

export default {
  input: "src/main.js",
  output: {
    file: "dist/ServiceNow-2-Notion.user.js",
    format: "iife",
    name: "ServiceNowToNotion",
    banner: `// ==UserScript==
// @name         ServiceNow-2-Notion
// @namespace    https://github.com/Christie-Norton-McIntosh/ServiceNow-2-Notion
// @version      ${version}
// @description  Extract ServiceNow content and send to Notion via Universal Workflow or proxy
// @author       Norton-McIntosh
// @match        https://*.service-now.com/*
// @match        https://*.servicenow.com/*
// @grant        GM_setValue
// @grant        GM_getValue
// @grant        GM_xmlhttpRequest
// @grant        GM_addStyle
// @grant        GM_getResourceText
// @grant        GM_notification
// @run-at       document-idle
// @connect      localhost
// @connect      127.0.0.1
// @updateURL    https://raw.githubusercontent.com/Christie-Norton-McIntosh/ServiceNow-2-Notion/main/dist/ServiceNow-2-Notion.user.js
// @downloadURL  https://raw.githubusercontent.com/Christie-Norton-McIntosh/ServiceNow-2-Notion/main/dist/ServiceNow-2-Notion.user.js
// ==/UserScript==

/* jshint esversion: 8 */
/* global GM_setValue, GM_getValue, GM_xmlhttpRequest, GM_addStyle, GM_getResourceText, GM_notification */

(function() {
    'use strict';
    // Inject runtime version from build process
    window.BUILD_VERSION = "${version}";`,
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
