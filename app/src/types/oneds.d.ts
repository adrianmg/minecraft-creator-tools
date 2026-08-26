// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

/**
 * Type definitions for 1DS JS SDK (Analytics Web SKU)
 *
 * These types are based on the Application Insights JavaScript SDK API
 * since 1DS JS SDK is built on top of it.
 *
 * Note: Initialization happens in site/index.body.html, so only the runtime
 * instance methods are defined here.
 */

declare global {
  interface Window {
    oneDSInstance?: OneDSApplicationInsights;
    creatorToolsSite?: {
      /** Real MCTools app version (e.g. "0.17.2"), stamped at release time. */
      version?: string;
      termsOfUseUrl?: string;
      privacyUrl?: string;
      trademarksUrl?: string;
    };
    manageConsent?: () => void;
    siteConsent?: {
      isConsentRequired?: boolean;
    };
  }
}

/**
 * A single 1DS telemetry envelope (ITelemetryItem) as seen by a telemetry
 * initializer. Custom, queryable dimensions (Part C) live on `data`; that is
 * where MCTools stamps `mctoolsVersion` for auto-captured web analytics rows.
 */
export interface OneDSTelemetryItem {
  name?: string;
  time?: string;
  iKey?: string;
  ext?: Record<string, any>;
  tags?: Record<string, any>;
  baseType?: string;
  baseData?: Record<string, any>;
  data?: Record<string, any>;
}

/**
 * Callback invoked for every telemetry envelope before it is sent. Returning
 * `false` drops the item; any other value (including `void`) keeps it.
 */
export type OneDSTelemetryInitializer = (envelope: OneDSTelemetryItem) => boolean | void;

export interface OneDSApplicationInsights {
  /**
   * Register a telemetry initializer that runs for every envelope (including
   * auto-captured web analytics events) before it is sent. Used by site.js to
   * tag each envelope with the real MCTools app version.
   * @param telemetryInitializer Callback that may mutate or drop the envelope
   */
  addTelemetryInitializer?(telemetryInitializer: OneDSTelemetryInitializer): { remove: () => void } | void;

  /**
   * Track a custom event
   * @param event Event details
   */
  trackEvent(event: { name: string; data?: Record<string, any>; measurements?: Record<string, number> }): void;

  /**
   * Track a page view
   * @param pageView Page view details
   */
  trackPageView(pageView: {
    name: string;
    uri?: string;
    data?: Record<string, any>;
    measurements?: Record<string, number>;
  }): void;

  /**
   * Track an exception/error
   * @param exception Exception details
   */
  trackException(exception: { exception: Error; data?: Record<string, any>; severityLevel?: number }): void;

  /**
   * Track a metric/measurement
   * @param metric Metric details
   */
  trackMetric(metric: {
    name: string;
    average: number;
    sampleCount?: number;
    min?: number;
    max?: number;
    data?: Record<string, any>;
  }): void;

  /**
   * Track a trace/log message
   * @param trace Trace details
   */
  trackTrace(trace: { message: string; severityLevel?: number; data?: Record<string, any> }): void;

  /**
   * Track a page action (Web Analytics plugin)
   * @param action Action details
   */
  trackPageAction?(action: { name: string; data?: Record<string, any> }): void;

  /**
   * Track content update (Web Analytics plugin)
   * @param update Update details
   */
  trackContentUpdate?(update: { name: string; data?: Record<string, any> }): void;

  /**
   * Set authenticated user context
   * @param authenticatedUserId User identifier
   * @param accountId Optional account identifier
   */
  setAuthenticatedUserContext?(authenticatedUserId: string, accountId?: string): void;

  /**
   * Clear authenticated user context
   */
  clearAuthenticatedUserContext?(): void;

  /**
   * Flush any pending telemetry data
   */
  flush?(): void;

  /**
   * Start tracking a page (for SPA scenarios)
   * @param name Page name
   */
  startTrackPage?(name: string): void;

  /**
   * Stop tracking a page (for SPA scenarios)
   * @param name Page name
   * @param url Optional URL
   * @param data Optional properties
   */
  stopTrackPage?(name: string, url?: string, data?: Record<string, any>): void;

  /**
   * Start tracking an event (for duration tracking)
   * @param name Event name
   */
  startTrackEvent?(name: string): void;

  /**
   * Stop tracking an event (for duration tracking)
   * @param name Event name
   * @param data Optional properties
   * @param measurements Optional measurements
   */
  stopTrackEvent?(name: string, data?: Record<string, any>, measurements?: Record<string, number>): void;
}
