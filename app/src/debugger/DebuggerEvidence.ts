// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

/**
 * DebuggerEvidence
 *
 * Privacy-safe reliability-evidence schema and packaging for the managed-BDS
 * script debugger flow (Task 1669104). Packages results captured from the
 * live release-gate runs (Task 1669105 flow, driven through the same
 * DedicatedServer code path the Electron app uses) into a stable JSON bundle
 * that support/release reviewers can read without ever seeing creator
 * content or credentials.
 *
 * What a bundle contains (and nothing else):
 * - MCT version + commit, host kind, platform, Node version
 * - BDS version and negotiated debug protocol version
 * - connection direction, host class (loopback/lan/remote), and ports
 * - lifecycle-stage timestamps and durations per run
 * - reconnect/restart outcomes and the test-case outcome
 * - a normalized error category (DebuggerFailureKind) + code, with a
 *   sanitized, length-capped message
 *
 * Explicitly excluded, by construction AND by the privacy scanner:
 * source/world content, project filenames or paths, module names/UUIDs,
 * passcodes, auth tokens, environment variables, and raw command/log bodies
 * (IDebuggerDiagnostics.recentServerMessages is never copied into evidence).
 *
 * Every free-text field is passed through sanitizeDebuggerDiagnosticText,
 * UUID-stripped, and capped. serializeEvidenceBundle() refuses to serialize
 * a bundle that fails findEvidencePrivacyViolations(), so a leak is a hard
 * generation error, not a silent artifact.
 *
 * Related files:
 * - DebuggerLifecycle.ts: stage machine + diagnostics snapshot this consumes
 * - test/DebuggerEvidenceTest.ts: privacy assertions and redaction tests
 * - test-extra/DebuggerReliabilityEvidenceTest.ts: live release-gate harness
 * - docs/DebuggerReliabilityEvidence.md: collection/retention/deletion guide
 */

import {
  DebuggerFailureKind,
  DebuggerLifecycleStage,
  IDebuggerDiagnostics,
  sanitizeDebuggerDiagnosticText,
} from "./DebuggerLifecycle";

export const DEBUGGER_EVIDENCE_SCHEMA_VERSION = 1;

/** Longest free-text value allowed in evidence; longer text reads as a raw log body. */
export const MAX_EVIDENCE_TEXT_LENGTH = 240;

/** How the debug connection was made. The managed flow always has MCT dialing BDS's inbound listener. */
export type DebuggerEvidenceDirection = "mctConnectsToBds" | "bdsConnectsToMct";

export type DebuggerEvidenceHostClass = "loopback" | "lan" | "remote";

export type DebuggerEvidenceOutcome = "passed" | "failed";

export interface IDebuggerEvidenceStage {
  stage: DebuggerLifecycleStage;
  at: string;
  sinceRunStartMs: number;
  /** Time until the next transition; absent for the final recorded stage. */
  durationMs?: number;
  detail?: string;
}

export interface IDebuggerEvidenceReconnect {
  attempts: number;
  outcome: "notNeeded" | "recovered" | "gaveUp" | "pending";
}

export interface IDebuggerEvidenceFailure {
  kind: DebuggerFailureKind;
  /** Normalized machine-readable code (e.g. ECONNREFUSED, PORT_RANGE_EXHAUSTED). */
  code?: string;
  /** Sanitized, UUID-stripped, length-capped human summary. */
  message?: string;
}

export interface IDebuggerEvidenceCleanup {
  stageAtEnd: DebuggerLifecycleStage;
  portReleased?: boolean;
  clientDisconnected?: boolean;
}

export interface IDebuggerEvidenceConnection {
  direction: DebuggerEvidenceDirection;
  hostClass: DebuggerEvidenceHostClass;
  serverPort?: number;
  debugPort?: number;
}

export interface IDebuggerEvidenceRun {
  runId: string;
  /** Which release-gate case produced this run (e.g. "connect-success"). */
  testCaseId: string;
  /** Test-case outcome: an expected-failure case that failed as expected is "passed". */
  outcome: DebuggerEvidenceOutcome;
  startedAt: string;
  endedAt: string;
  durationMs: number;
  connection: IDebuggerEvidenceConnection;
  bdsVersion?: string;
  protocolVersion?: number;
  inboundScriptDebuggingEnabled?: boolean;
  outboundScriptDebuggingEnabled?: boolean;
  /** Whether a target script module was selected. Never the module name/UUID. */
  hasTargetModule?: boolean;
  pluginCount?: number;
  /** Time from the first lifecycle transition to the connected stage, when reached. */
  timeToConnectedMs?: number;
  stages: IDebuggerEvidenceStage[];
  reconnect: IDebuggerEvidenceReconnect;
  cleanup?: IDebuggerEvidenceCleanup;
  failure?: IDebuggerEvidenceFailure;
}

export interface IDebuggerEvidenceTool {
  mctVersion: string;
  commit?: string;
  hostKind: "electron" | "cli" | "testHarness";
  platform: string;
  nodeVersion?: string;
}

export interface IDebuggerEvidenceTimingStats {
  samples: number;
  minMs: number;
  medianMs: number;
  maxMs: number;
}

export interface IDebuggerEvidenceSummary {
  totalRuns: number;
  passed: number;
  failed: number;
  passRatePct: number;
  timeToConnected?: IDebuggerEvidenceTimingStats;
  reconnectOutcomes: { recovered: number; gaveUp: number };
  failureKindCounts: { [kind: string]: number };
  /** Failure kinds observed in runs whose test-case outcome was "failed" (i.e., unexpected). */
  unresolvedFailureKinds: string[];
  /**
   * Runs whose cleanup evidence exists but does not prove BOTH flags
   * (portReleased and clientDisconnected) true. Surfaced in the summary so
   * a leaked reservation or connection is visible at a glance rather than
   * buried in per-run cleanup records.
   */
  incompleteCleanups: number;
}

export interface IDebuggerEvidenceBundle {
  schemaVersion: number;
  bundleId: string;
  generatedAt: string;
  tool: IDebuggerEvidenceTool;
  bdsVersion?: string;
  protocolVersion?: number;
  runs: IDebuggerEvidenceRun[];
  summary: IDebuggerEvidenceSummary;
}

// ---------------------------------------------------------------------------
// Normalization helpers
// ---------------------------------------------------------------------------

const UUID_REGEX = /[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}/g;

/**
 * Map a free-text failure message to a stable machine-readable code, checking
 * the most specific phrasings first so composite messages (original error +
 * "giving up after N reconnect attempts") normalize to the terminal cause.
 */
export function normalizeDebuggerErrorCode(message: string | undefined): string | undefined {
  if (!message) {
    return undefined;
  }

  const lower = message.toLowerCase();

  if (lower.includes("no free script debugger port")) {
    return "PORT_RANGE_EXHAUSTED";
  }

  if (lower.includes("allow-inbound-script-debugging=false")) {
    return "INBOUND_DEBUGGING_DISABLED";
  }

  if (lower.includes("allow-outbound-script-debugging=false")) {
    return "OUTBOUND_DEBUGGING_DISABLED";
  }

  if (lower.includes("did not confirm")) {
    return "LISTENER_CONFIRMATION_TIMEOUT";
  }

  if (lower.includes("handshake timeout")) {
    return "HANDSHAKE_TIMEOUT";
  }

  if (lower.includes("passcode")) {
    return "PASSCODE_REJECTED";
  }

  if (lower.includes("protocol") && (lower.includes("mismatch") || lower.includes("unsupported"))) {
    return "PROTOCOL_MISMATCH";
  }

  const errno = message.match(/\b(E[A-Z]{2,15})\b/);

  if (errno) {
    return errno[1];
  }

  if (lower.includes("giving up after")) {
    return "RECONNECT_EXHAUSTED";
  }

  return undefined;
}

/** Classify a connection host string into a coarse, non-identifying class. */
export function classifyEvidenceHost(host: string | undefined): DebuggerEvidenceHostClass {
  if (host === undefined) {
    return "loopback"; // the managed flow always dials localhost
  }

  const lower = host.toLowerCase();

  if (lower === "localhost" || lower.startsWith("127.") || lower === "::1") {
    return "loopback";
  }

  if (
    lower.startsWith("10.") ||
    lower.startsWith("192.168.") ||
    /^172\.(1[6-9]|2\d|3[01])\./.test(lower) ||
    lower.startsWith("fe80:") ||
    lower.endsWith(".local")
  ) {
    return "lan";
  }

  return "remote";
}

/**
 * Sanitize one free-text field for inclusion in evidence: path/credential
 * scrub, UUID strip (module UUIDs identify creator content), length cap.
 */
export function toEvidenceText(text: string | undefined): string | undefined {
  if (text === undefined) {
    return undefined;
  }

  let result = sanitizeDebuggerDiagnosticText(text).replace(UUID_REGEX, "<uuid>");

  if (result.length > MAX_EVIDENCE_TEXT_LENGTH) {
    result = result.substring(0, MAX_EVIDENCE_TEXT_LENGTH - 1) + "…";
  }

  return result;
}

// ---------------------------------------------------------------------------
// Builders
// ---------------------------------------------------------------------------

export interface IBuildEvidenceRunOptions {
  runId: string;
  testCaseId: string;
  outcome: DebuggerEvidenceOutcome;
  startedAt: string;
  endedAt: string;
  /** Host the debug client dialed; classified, never stored verbatim beyond its class. */
  host?: string;
  direction?: DebuggerEvidenceDirection;
  cleanup?: IDebuggerEvidenceCleanup;
}

/**
 * Build one privacy-safe evidence run from a lifecycle diagnostics snapshot.
 * Prohibited diagnostics content (raw server log bodies in
 * recentServerMessages) is deliberately never copied - only derived
 * booleans/counts survive. The diagnostics snapshot itself no longer
 * carries a raw module UUID (IDebuggerDiagnostics.hasTargetModule), and
 * even if a caller smuggled one in, this explicit field mapping would
 * drop it.
 */
export function buildEvidenceRun(diagnostics: IDebuggerDiagnostics, options: IBuildEvidenceRunOptions): IDebuggerEvidenceRun {
  const startedMs = Date.parse(options.startedAt);
  const endedMs = Date.parse(options.endedAt);

  const history = diagnostics.stageHistory;
  const runStartMs = history.length > 0 ? Date.parse(history[0].at) : startedMs;

  const stages: IDebuggerEvidenceStage[] = [];

  for (let i = 0; i < history.length; i++) {
    const transition = history[i];
    const atMs = Date.parse(transition.at);
    const nextMs = i + 1 < history.length ? Date.parse(history[i + 1].at) : undefined;

    stages.push({
      stage: transition.stage,
      at: transition.at,
      sinceRunStartMs: Math.max(0, atMs - runStartMs),
      durationMs: nextMs !== undefined ? Math.max(0, nextMs - atMs) : undefined,
      detail: toEvidenceText(transition.detail),
    });
  }

  let timeToConnectedMs: number | undefined;
  let lastReconnectIndex = -1;
  let reconnectAttempts = 0;

  for (let i = 0; i < stages.length; i++) {
    if (stages[i].stage === DebuggerLifecycleStage.connected && timeToConnectedMs === undefined) {
      timeToConnectedMs = stages[i].sinceRunStartMs;
    }

    if (stages[i].stage === DebuggerLifecycleStage.reconnecting) {
      reconnectAttempts++;
      lastReconnectIndex = i;
    }
  }

  let reconnectOutcome: IDebuggerEvidenceReconnect["outcome"] = "notNeeded";

  if (reconnectAttempts > 0) {
    const recoveredAfter = stages.some(
      (s, i) => i > lastReconnectIndex && s.stage === DebuggerLifecycleStage.connected
    );
    const failedAfter = stages.some((s, i) => i > lastReconnectIndex && s.stage === DebuggerLifecycleStage.failed);

    reconnectOutcome = recoveredAfter ? "recovered" : failedAfter ? "gaveUp" : "pending";
  }

  let failure: IDebuggerEvidenceFailure | undefined;

  if (diagnostics.failureKind !== DebuggerFailureKind.none) {
    failure = {
      kind: diagnostics.failureKind,
      code: normalizeDebuggerErrorCode(diagnostics.errorMessage),
      message: toEvidenceText(diagnostics.errorMessage),
    };
  }

  return {
    runId: options.runId,
    testCaseId: options.testCaseId,
    outcome: options.outcome,
    startedAt: options.startedAt,
    endedAt: options.endedAt,
    durationMs: Math.max(0, endedMs - startedMs),
    connection: {
      direction: options.direction ?? "mctConnectsToBds",
      hostClass: classifyEvidenceHost(options.host),
      serverPort: diagnostics.serverPort,
      debugPort: diagnostics.debugPort,
    },
    bdsVersion: diagnostics.bdsVersion,
    protocolVersion: diagnostics.protocolVersion,
    inboundScriptDebuggingEnabled: diagnostics.inboundScriptDebuggingEnabled,
    outboundScriptDebuggingEnabled: diagnostics.outboundScriptDebuggingEnabled,
    hasTargetModule: diagnostics.hasTargetModule === true ? true : undefined,
    pluginCount: diagnostics.pluginCount,
    timeToConnectedMs: timeToConnectedMs,
    stages: stages,
    reconnect: { attempts: reconnectAttempts, outcome: reconnectOutcome },
    cleanup: options.cleanup,
    failure: failure,
  };
}

export function buildEvidenceSummary(runs: IDebuggerEvidenceRun[]): IDebuggerEvidenceSummary {
  const passed = runs.filter((r) => r.outcome === "passed").length;
  const failed = runs.length - passed;

  const connectSamples = runs
    .map((r) => r.timeToConnectedMs)
    .filter((v): v is number => v !== undefined)
    .sort((a, b) => a - b);

  let timeToConnected: IDebuggerEvidenceTimingStats | undefined;

  if (connectSamples.length > 0) {
    timeToConnected = {
      samples: connectSamples.length,
      minMs: connectSamples[0],
      medianMs: connectSamples[Math.floor((connectSamples.length - 1) / 2)],
      maxMs: connectSamples[connectSamples.length - 1],
    };
  }

  const failureKindCounts: { [kind: string]: number } = {};
  const unresolved = new Set<string>();

  for (const run of runs) {
    if (run.failure !== undefined) {
      failureKindCounts[run.failure.kind] = (failureKindCounts[run.failure.kind] ?? 0) + 1;

      if (run.outcome === "failed") {
        unresolved.add(run.failure.kind);
      }
    }
  }

  return {
    totalRuns: runs.length,
    passed: passed,
    failed: failed,
    passRatePct: runs.length === 0 ? 0 : Math.round((passed / runs.length) * 1000) / 10,
    timeToConnected: timeToConnected,
    reconnectOutcomes: {
      recovered: runs.filter((r) => r.reconnect.outcome === "recovered").length,
      gaveUp: runs.filter((r) => r.reconnect.outcome === "gaveUp").length,
    },
    failureKindCounts: failureKindCounts,
    unresolvedFailureKinds: Array.from(unresolved).sort(),
    incompleteCleanups: runs.filter(
      (r) => r.cleanup !== undefined && (r.cleanup.portReleased !== true || r.cleanup.clientDisconnected !== true)
    ).length,
  };
}

export function buildEvidenceBundle(
  runs: IDebuggerEvidenceRun[],
  tool: IDebuggerEvidenceTool,
  generatedAt?: string
): IDebuggerEvidenceBundle {
  const at = generatedAt ?? new Date().toISOString();

  return {
    schemaVersion: DEBUGGER_EVIDENCE_SCHEMA_VERSION,
    bundleId: "dbg-evidence-" + at.replace(/[-:.TZ]/g, "").substring(0, 14),
    generatedAt: at,
    tool: tool,
    bdsVersion: runs.map((r) => r.bdsVersion).find((v) => v !== undefined),
    protocolVersion: runs.map((r) => r.protocolVersion).find((v) => v !== undefined),
    runs: runs,
    summary: buildEvidenceSummary(runs),
  };
}

/**
 * Validates that a run set covers EXACTLY an expected scenario matrix:
 * every expected test-case id present with its expected multiplicity
 * (repeat an id in the expected list to require multiple runs), and no
 * unexpected ids. Packaging must fail on violations rather than build a
 * bundle from whatever survived: a test harness keeps running after a
 * scenario fails before its capture, so a bare count check would happily
 * report a 100% pass rate over a silently shrunk denominator.
 */
export function findEvidenceCompletenessViolations(
  runs: { testCaseId: string }[],
  expectedTestCaseIds: string[]
): string[] {
  const violations: string[] = [];

  const expectedCounts = new Map<string, number>();
  for (const id of expectedTestCaseIds) {
    expectedCounts.set(id, (expectedCounts.get(id) ?? 0) + 1);
  }

  const actualCounts = new Map<string, number>();
  for (const run of runs) {
    actualCounts.set(run.testCaseId, (actualCounts.get(run.testCaseId) ?? 0) + 1);
  }

  for (const [id, expected] of expectedCounts) {
    const actual = actualCounts.get(id) ?? 0;

    if (actual < expected) {
      violations.push(`missing scenario '${id}': expected ${expected} run(s), captured ${actual}`);
    } else if (actual > expected) {
      violations.push(`duplicated scenario '${id}': expected ${expected} run(s), captured ${actual}`);
    }
  }

  for (const id of actualCounts.keys()) {
    if (!expectedCounts.has(id)) {
      violations.push(`unexpected scenario '${id}': not part of the expected matrix`);
    }
  }

  return violations;
}

// ---------------------------------------------------------------------------
// Privacy enforcement
// ---------------------------------------------------------------------------

export interface IEvidencePrivacyViolation {
  path: string;
  reason: string;
}

/**
 * Every key that may appear anywhere in a bundle. A key outside this set is a
 * privacy violation - new fields must be added here consciously, which also
 * keeps the bundle format stable for support/release review.
 */
const ALLOWED_EVIDENCE_KEYS = new Set<string>([
  "schemaVersion",
  "bundleId",
  "generatedAt",
  "tool",
  "mctVersion",
  "commit",
  "hostKind",
  "platform",
  "nodeVersion",
  "bdsVersion",
  "protocolVersion",
  "runs",
  "runId",
  "testCaseId",
  "outcome",
  "startedAt",
  "endedAt",
  "durationMs",
  "connection",
  "direction",
  "hostClass",
  "serverPort",
  "debugPort",
  "inboundScriptDebuggingEnabled",
  "outboundScriptDebuggingEnabled",
  "hasTargetModule",
  "pluginCount",
  "timeToConnectedMs",
  "stages",
  "stage",
  "at",
  "sinceRunStartMs",
  "detail",
  "reconnect",
  "attempts",
  "cleanup",
  "stageAtEnd",
  "portReleased",
  "clientDisconnected",
  "incompleteCleanups",
  "failure",
  "kind",
  "code",
  "message",
  "summary",
  "totalRuns",
  "passed",
  "failed",
  "passRatePct",
  "timeToConnected",
  "samples",
  "minMs",
  "medianMs",
  "maxMs",
  "reconnectOutcomes",
  "recovered",
  "gaveUp",
  "failureKindCounts",
  "unresolvedFailureKinds",
]);

// failureKindCounts is keyed by DebuggerFailureKind values, which are not in
// the structural allowlist; its dynamic keys are validated against the enum.
const FAILURE_KIND_VALUES = new Set<string>(Object.values(DebuggerFailureKind));

/** Key-name fragments that indicate a prohibited field slipped in. */
const FORBIDDEN_KEY_FRAGMENTS = [
  "path",
  "file",
  "folder",
  "directory",
  "world",
  "project",
  "module",
  "passcode",
  "password",
  "token",
  "secret",
  "authorization",
  "credential",
  "env",
  "xuid",
  "uuid",
  "chat",
  "player",
  "log",
];

function checkEvidenceString(value: string, path: string, violations: IEvidencePrivacyViolation[]): void {
  if (sanitizeDebuggerDiagnosticText(value) !== value) {
    violations.push({ path: path, reason: "contains redactable content (path, credential, or xuid)" });
  }

  // Boundary-anchored like the sanitizer's own path detector: URI schemes
  // are two or more letters, so "https://..." (which contains "s://") must
  // not read as a drive path and fail evidence packaging.
  if (/(^|[^A-Za-z0-9])[A-Za-z]:[\\/]/.test(value) || value.includes("\\\\")) {
    violations.push({ path: path, reason: "contains a filesystem path" });
  }

  UUID_REGEX.lastIndex = 0;

  if (UUID_REGEX.test(value)) {
    violations.push({ path: path, reason: "contains a UUID (possible module/pack identifier)" });
  }

  if (/\b[A-Z][A-Z0-9_]{3,}=[^\s=]/.test(value)) {
    violations.push({ path: path, reason: "contains an environment-variable style assignment" });
  }

  if (value.length > MAX_EVIDENCE_TEXT_LENGTH) {
    violations.push({ path: path, reason: "over-long free text (looks like a raw log/command body)" });
  }
}

function walkEvidence(value: unknown, path: string, violations: IEvidencePrivacyViolation[]): void {
  if (typeof value === "string") {
    checkEvidenceString(value, path, violations);
    return;
  }

  if (value === null || typeof value !== "object") {
    return;
  }

  if (Array.isArray(value)) {
    for (let i = 0; i < value.length; i++) {
      walkEvidence(value[i], `${path}[${i}]`, violations);
    }
    return;
  }

  const isFailureKindMap = path.endsWith(".failureKindCounts");

  for (const [key, child] of Object.entries(value as Record<string, unknown>)) {
    const childPath = path === "" ? key : `${path}.${key}`;

    if (isFailureKindMap) {
      if (!FAILURE_KIND_VALUES.has(key)) {
        violations.push({ path: childPath, reason: "failureKindCounts key is not a DebuggerFailureKind" });
      }
    } else if (!ALLOWED_EVIDENCE_KEYS.has(key)) {
      // Allowlisted keys were vetted at schema-design time (hasTargetModule
      // deliberately contains "module" but carries only a boolean); anything
      // else is a violation, with the forbidden-fragment match as the more
      // specific reason when one applies.
      const lowerKey = key.toLowerCase();
      const fragment = FORBIDDEN_KEY_FRAGMENTS.find((f) => lowerKey.includes(f));

      violations.push({
        path: childPath,
        reason:
          fragment !== undefined
            ? `key name contains prohibited fragment "${fragment}"`
            : "key is not in the evidence schema allowlist",
      });
    }

    walkEvidence(child, childPath, violations);
  }
}

/**
 * Scan a bundle (or any evidence fragment) for privacy violations: keys
 * outside the schema allowlist, prohibited key names, filesystem paths,
 * credentials, UUIDs, env-var assignments, and raw-log-sized text.
 */
export function findEvidencePrivacyViolations(bundle: unknown): IEvidencePrivacyViolation[] {
  const violations: IEvidencePrivacyViolation[] = [];

  walkEvidence(bundle, "", violations);

  return violations;
}

/** Throw if the bundle violates the privacy rules. */
export function assertEvidencePrivacy(bundle: unknown): void {
  const violations = findEvidencePrivacyViolations(bundle);

  if (violations.length > 0) {
    throw new Error(
      "Evidence bundle failed privacy validation:\n" +
        violations.map((v) => `  ${v.path}: ${v.reason}`).join("\n")
    );
  }
}

/**
 * Serialize a bundle for export. Refuses (throws) if privacy validation
 * fails, so a leaking bundle can never be written to disk or clipboard.
 */
export function serializeEvidenceBundle(bundle: IDebuggerEvidenceBundle): string {
  assertEvidencePrivacy(bundle);

  return JSON.stringify(bundle, undefined, 2);
}
