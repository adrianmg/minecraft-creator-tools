// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

/**
 * SiteTelemetryTest.ts
 *
 * Regression test for the 1DS version-stamping telemetry initializer in public/site.js.
 *
 * With pageView auto-capture enabled, the 1DS Web Analytics plugin captures the initial
 * Ms.Web.PageView and flushes its initialization queue synchronously during initialize().
 * The mctoolsVersion initializer must therefore be registered BEFORE initialize(), otherwise
 * the first page-view envelope escapes untagged and page-view/session version analytics are
 * incomplete (the regression this test guards).
 *
 * The test loads the REAL public/site.js in a sandbox with a faithful fake of the 1DS SDK: its
 * initialize() emits the initial page view synchronously through only the initializers
 * registered up to that point — exactly the SDK behavior that exposed the bug — and asserts the
 * first page-view envelope carries data.mctoolsVersion.
 *
 * Also covers the release stamping of the bootstrap URL (tools/stampSiteBootstrapUrl.js):
 * site.js is served unhashed, so without a release-specific URL a new release's index.html can
 * pair with a stale cached site.js and mislabel auto-captured rows with the previous release's
 * version. The generated HTML must pin `site.js?v=<release version>` so bootstrap and bundle
 * versions cannot diverge.
 */

import { expect } from "chai";
import * as fs from "fs";
import * as vm from "vm";
import TestPaths from "./TestPaths";

interface FakeEnvelope {
  name: string;
  data: Record<string, unknown>;
}

type Initializer = (envelope: FakeEnvelope) => boolean | void;

interface SiteRunResult {
  /** One entry per addTelemetryInitializer call, in order, noting whether it preceded initialize(). */
  registrations: { beforeInitialize: boolean }[];
  /** The initial page-view envelope captured synchronously during initialize(). */
  firstPageViewEnvelope?: FakeEnvelope;
  /** The version site.js declares on window.creatorToolsSite. */
  declaredVersion?: string;
  /** Runs an envelope through the registered initializers, as the SDK does for each telemetry item. */
  applyInitializers: (envelope: FakeEnvelope) => FakeEnvelope;
}

describe("site.js 1DS version stamping", () => {
  function runSiteJs(): SiteRunResult {
    const source = fs.readFileSync(TestPaths.publicRoot + "site.js", "utf8");

    const registrations: { beforeInitialize: boolean }[] = [];
    const initializers: Initializer[] = [];
    let initialized = false;
    let firstPageViewEnvelope: FakeEnvelope | undefined;

    // Faithful fake of the 1DS Web Analytics ApplicationInsights, modeling the specific behavior
    // that matters here: initialize() synchronously captures + flushes the initial page view
    // through only the initializers registered so far.
    class FakeApplicationInsights {
      addTelemetryInitializer(fn: Initializer) {
        registrations.push({ beforeInitialize: !initialized });
        initializers.push(fn);
        return { remove: () => undefined };
      }

      initialize() {
        initialized = true;

        const envelope: FakeEnvelope = { name: "Ms.Web.PageView", data: {} };
        for (const initializer of initializers) {
          initializer(envelope);
        }
        firstPageViewEnvelope = envelope;
      }
    }

    // In the browser, window IS the global object; site.js reads bare globals (WcpConsent, oneDS,
    // navigator) and also assigns window.* — so make the sandbox reference itself as `window`.
    const sandbox: Record<string, unknown> = {
      navigator: { globalPrivacyControl: false },
      oneDS: { ApplicationInsights: FakeApplicationInsights },
      WcpConsent: {
        init(_locale: string, _elementId: string, callback: (err: unknown, consent: unknown) => void) {
          callback(undefined, {
            isConsentRequired: false,
            getConsent: () => ({ Required: true, Analytics: true, SocialMedia: false, Advertising: false }),
          });
        },
      },
    };
    sandbox.window = sandbox;

    vm.createContext(sandbox);
    vm.runInContext(source, sandbox);

    const creatorToolsSite = (sandbox as { creatorToolsSite?: { version?: string } }).creatorToolsSite;

    const applyInitializers = (envelope: FakeEnvelope) => {
      for (const initializer of initializers) {
        initializer(envelope);
      }
      return envelope;
    };

    return { registrations, firstPageViewEnvelope, declaredVersion: creatorToolsSite?.version, applyInitializers };
  }

  it("registers the version initializer BEFORE initialize() so the first page view is tagged", () => {
    const { registrations } = runSiteJs();

    expect(registrations.length, "expected the version initializer to be registered").to.be.greaterThan(0);
    expect(
      registrations[0].beforeInitialize,
      "the version initializer must be registered before analytics.initialize()"
    ).to.equal(true);
  });

  it("stamps mctoolsVersion onto the initial page-view envelope captured during initialize()", () => {
    const { firstPageViewEnvelope, declaredVersion } = runSiteJs();

    expect(declaredVersion, "site.js should declare creatorToolsSite.version").to.be.a("string");
    expect(firstPageViewEnvelope, "initialize() should have captured an initial page-view envelope").to.not.equal(
      undefined
    );
    expect(firstPageViewEnvelope!.data.mctoolsVersion).to.equal(declaredVersion);
  });

  it("does not overwrite an mctoolsVersion already present on the envelope (fill-only)", () => {
    const { applyInitializers } = runSiteJs();

    // Custom TelemetryService events already carry the version from the content-hashed
    // app bundle; a stale cached site.js must not relabel them with its own version.
    const envelope = applyInitializers({
      name: "mctools_custom_event",
      data: { mctoolsVersion: "9.9.9-from-bundle" },
    });

    expect(envelope.data.mctoolsVersion).to.equal("9.9.9-from-bundle");
  });

  describe("bootstrap URL release stamping", () => {
    // Runtime require via TestPaths keeps the path valid under both ts-mocha and
    // compiled runs; the tool is plain CommonJS shared with gulpfile.js.
    const stampSiteBootstrapUrl: (html: string, version?: string) => string = require(TestPaths.appRoot +
      "tools/stampSiteBootstrapUrl");

    it("pins the site.js reference in the shipped body HTML to the given release version", () => {
      const bodyHtml = fs.readFileSync(TestPaths.appRoot + "site/index.body.html", "utf8");

      // Guards both the stamper and the HTML: if site/index.body.html stops
      // referencing site.js in the form the stamper targets, the pin silently
      // becomes a no-op and stale-bootstrap mislabeling returns.
      expect(bodyHtml).to.contain('src="site.js"');

      const stamped = stampSiteBootstrapUrl(bodyHtml, "9.9.9");

      expect(stamped).to.contain('src="site.js?v=9.9.9"');
      expect(stamped).to.not.contain('src="site.js"');
    });

    it("models differing bootstrap and bundle versions: the pin follows the release, not the cached bootstrap", () => {
      // The failure mode this guards: a stale cached site.js from the previous
      // release (its self-declared version below) paired with a freshly served
      // index.html from the new release. The pinned URL must be derived from
      // the release version alone, so the stale cache entry can never satisfy
      // the new HTML's request.
      const { declaredVersion } = runSiteJs();
      expect(declaredVersion, "site.js should declare a version to model the stale bootstrap").to.be.a("string");

      const newReleaseVersion = declaredVersion + "-next.1";
      const stamped = stampSiteBootstrapUrl('<script src="site.js"></script>', newReleaseVersion);

      expect(stamped).to.contain('src="site.js?v=' + encodeURIComponent(newReleaseVersion) + '"');
      expect(stamped).to.not.contain('src="site.js?v=' + declaredVersion + '"');
      expect(stamped).to.not.contain('src="site.js"');
    });

    it("re-stamps an already-stamped reference with the new release version (idempotent)", () => {
      const once = stampSiteBootstrapUrl('<script src="site.js"></script>', "1.0.0");
      const again = stampSiteBootstrapUrl(once, "2.0.0");

      expect(again).to.contain('src="site.js?v=2.0.0"');
      expect(again).to.not.contain("1.0.0");
    });

    it("leaves other script references and the HTML structure untouched", () => {
      const html = '<script src="other.js"></script><script src="site.js"></script><div id="root"></div>';
      const stamped = stampSiteBootstrapUrl(html, "3.0.0");

      expect(stamped).to.contain('src="other.js"');
      expect(stamped).to.contain('<div id="root"></div>');
      expect(stamped).to.contain('src="site.js?v=3.0.0"');
    });

    it("returns the HTML unchanged when no version is available (never breaks the build)", () => {
      const html = '<script src="site.js"></script>';

      expect(stampSiteBootstrapUrl(html, undefined)).to.equal(html);
      expect(stampSiteBootstrapUrl(html, "")).to.equal(html);
    });
  });
});
