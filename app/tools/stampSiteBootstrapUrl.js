// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

/**
 * Rewrites the unhashed `site.js` bootstrap reference in generated HTML to a
 * release-specific URL (`site.js?v=<version>`).
 *
 * Why: site.js initializes 1DS telemetry and stamps auto-captured rows (page
 * views, client errors, page actions) with `creatorToolsSite.version`. The
 * file is served unhashed, so a browser can pair a freshly-fetched index.html
 * (whose app bundles are content-hashed) with a stale cached site.js from the
 * previous release — mislabeling exactly the rows the stamp exists to
 * version. Pinning the bootstrap URL to the release version in the generated
 * HTML forces a cache miss on every release, so the bootstrap and bundle
 * versions can never diverge. (Inlining the version ahead of site.js is not
 * an option: the production CSP has no 'unsafe-inline' for scripts.)
 *
 * Pure and idempotent: an already-stamped reference is re-stamped with the
 * given version. Used by gulpfile.js `customizeSiteBody` and unit-tested in
 * src/test/SiteTelemetryTest.ts.
 */
module.exports = function stampSiteBootstrapUrl(html, version) {
  if (!version || typeof version !== "string") {
    return html;
  }

  return html.replace(/src="site\.js(\?v=[^"]*)?"/g, 'src="site.js?v=' + encodeURIComponent(version) + '"');
};
