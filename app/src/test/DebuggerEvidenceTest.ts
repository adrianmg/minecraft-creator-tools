// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

/**
 * DebuggerEvidenceTest
 *
 * Privacy assertions and redaction tests for the debugger reliability
 * evidence bundle (Task 1669104). Proves that:
 * - prohibited fields (paths, module UUIDs, passcodes, tokens, env vars,
 *   raw server-log bodies) never survive into a built evidence run
 * - the privacy scanner catches poisoned bundles (bad keys and bad values)
 * - serialization refuses to emit a bundle that fails validation
 * - the reliability summary math (pass rate, timings, reconnects) is right
 */

import { assert } from "chai";
import {
  DebuggerFailureKind,
  DebuggerLifecycleStage,
  IDebuggerDiagnostics,
} from "../debugger/DebuggerLifecycle";
import {
  DEBUGGER_EVIDENCE_SCHEMA_VERSION,
  MAX_EVIDENCE_TEXT_LENGTH,
  assertEvidencePrivacy,
  buildEvidenceBundle,
  buildEvidenceRun,
  buildEvidenceSummary,
  classifyEvidenceHost,
  findEvidenceCompletenessViolations,
  findEvidencePrivacyViolations,
  normalizeDebuggerErrorCode,
  serializeEvidenceBundle,
  toEvidenceText,
  IDebuggerEvidenceRun,
} from "../debugger/DebuggerEvidence";

const SECRET_PATH = "C:\\Users\\creatorname\\Documents\\MySecretAddon";
const SECRET_PASSCODE = "hunter2passcode";
const SECRET_UUID = "1f9f28d4-72cd-4f7f-8a2f-0f7e3a9d1b6c";
const SECRET_LOG_LINE = "[2026-08-24 INFO] Player creatorSteve said: my base is at 100,64,100";

/** A deliberately dirty diagnostics snapshot, as if taken mid-failure. */
function makeDirtyDiagnostics(): IDebuggerDiagnostics {
  return {
    stage: DebuggerLifecycleStage.failed,
    failureKind: DebuggerFailureKind.tcpConnect,
    // The lifecycle sanitizes on entry, but evidence must not rely on that -
    // feed raw secrets here and prove they cannot survive.
    errorMessage: `Failed to connect to localhost:19144 (ECONNREFUSED) while loading "${SECRET_PATH}" passcode=${SECRET_PASSCODE}`,
    generatedAt: "2026-08-24T10:00:30.000Z",
    bdsVersion: "1.21.130.4",
    serverPort: 19132,
    debugPort: 19144,
    inboundScriptDebuggingEnabled: true,
    outboundScriptDebuggingEnabled: false,
    protocolVersion: 10,
    hasTargetModule: true,
    // IDebuggerDiagnostics no longer declares a raw module UUID field, but
    // the evidence layer must not rely on that: smuggle one in and prove
    // the explicit field mapping drops it anyway.
    ...({ targetModuleUuid: SECRET_UUID } as object),
    pluginCount: 2,
    stageHistory: [
      { stage: DebuggerLifecycleStage.configuring, at: "2026-08-24T10:00:00.000Z" },
      { stage: DebuggerLifecycleStage.startingListener, at: "2026-08-24T10:00:03.000Z" },
      {
        stage: DebuggerLifecycleStage.waitingForReadiness,
        at: "2026-08-24T10:00:03.500Z",
        detail: `port 19144, world at ${SECRET_PATH}`,
      },
      { stage: DebuggerLifecycleStage.connectingTcp, at: "2026-08-24T10:00:04.000Z", detail: "localhost:19144" },
      { stage: DebuggerLifecycleStage.failed, at: "2026-08-24T10:00:19.000Z" },
    ],
    recentServerMessages: [SECRET_LOG_LINE, "Version: 1.21.130.4"],
  };
}

function makeCleanDiagnostics(overrides?: Partial<IDebuggerDiagnostics>): IDebuggerDiagnostics {
  return {
    stage: DebuggerLifecycleStage.connected,
    failureKind: DebuggerFailureKind.none,
    generatedAt: "2026-08-24T10:01:00.000Z",
    bdsVersion: "1.21.130.4",
    serverPort: 19132,
    debugPort: 19144,
    inboundScriptDebuggingEnabled: true,
    outboundScriptDebuggingEnabled: false,
    protocolVersion: 10,
    pluginCount: 1,
    stageHistory: [
      { stage: DebuggerLifecycleStage.configuring, at: "2026-08-24T10:00:00.000Z" },
      { stage: DebuggerLifecycleStage.startingListener, at: "2026-08-24T10:00:03.000Z" },
      { stage: DebuggerLifecycleStage.waitingForReadiness, at: "2026-08-24T10:00:03.500Z", detail: "port 19144" },
      { stage: DebuggerLifecycleStage.connectingTcp, at: "2026-08-24T10:00:04.000Z", detail: "localhost:19144" },
      { stage: DebuggerLifecycleStage.connected, at: "2026-08-24T10:00:05.200Z", detail: "protocol v10, port 19144" },
    ],
    recentServerMessages: ["Server started."],
    ...overrides,
  };
}

function buildRun(diagnostics: IDebuggerDiagnostics, overrides?: Partial<{ testCaseId: string; outcome: "passed" | "failed" }>) {
  return buildEvidenceRun(diagnostics, {
    runId: "run-001",
    testCaseId: overrides?.testCaseId ?? "connect-success",
    outcome: overrides?.outcome ?? "passed",
    startedAt: "2026-08-24T10:00:00.000Z",
    endedAt: "2026-08-24T10:00:30.000Z",
    host: "localhost",
  });
}

const TOOL_INFO = {
  mctVersion: "0.0.1-dev",
  commit: "abc1234def",
  hostKind: "testHarness" as const,
  platform: "win32",
  nodeVersion: "v22.0.0",
};

describe("DebuggerEvidence privacy", () => {
  it("never carries prohibited diagnostics content into an evidence run", () => {
    const run = buildRun(makeDirtyDiagnostics(), { outcome: "failed" });
    const serialized = JSON.stringify(run);

    assert.notInclude(serialized, "creatorname", "user path segments must not survive");
    assert.notInclude(serialized, "MySecretAddon", "project folder names must not survive");
    assert.notInclude(serialized, SECRET_PASSCODE, "passcodes must not survive");
    assert.notInclude(serialized, SECRET_UUID, "module UUIDs must not survive");
    assert.notInclude(serialized, "creatorSteve", "player/log content must not survive");
    assert.notInclude(serialized, "recentServerMessages", "raw server log bodies must not be copied at all");
    assert.notInclude(serialized, "targetModuleUuid", "the module UUID field itself must not be copied");
  });

  it("keeps only a derived boolean for the target module", () => {
    const run = buildRun(makeDirtyDiagnostics(), { outcome: "failed" });

    assert.isTrue(run.hasTargetModule);
  });

  it("produces a run and bundle that pass privacy validation even from dirty input", () => {
    const run = buildRun(makeDirtyDiagnostics(), { outcome: "failed" });
    const bundle = buildEvidenceBundle([run], TOOL_INFO, "2026-08-24T10:05:00.000Z");

    assert.deepEqual(findEvidencePrivacyViolations(bundle), []);
    assert.doesNotThrow(() => assertEvidencePrivacy(bundle));
  });

  it("flags keys outside the schema allowlist", () => {
    const run = buildRun(makeCleanDiagnostics()) as unknown as Record<string, unknown>;
    run["extraDatum"] = "hello";

    const violations = findEvidencePrivacyViolations(run);

    assert.isTrue(violations.some((v) => v.path.includes("extraDatum") && v.reason.includes("allowlist")));
  });

  it("flags prohibited key names with a specific reason", () => {
    const poisoned = { projectId: "x", worldSeedInfo: 1, passcodeHint: "y", envSnapshot: "z" };

    const violations = findEvidencePrivacyViolations(poisoned);
    const reasons = violations.map((v) => v.reason).join("; ");

    assert.include(reasons, '"project"');
    assert.include(reasons, '"world"');
    assert.include(reasons, '"passcode"');
    assert.include(reasons, '"env"');
  });

  it("flags string values containing paths, UUIDs, credentials, and env assignments", () => {
    assert.isNotEmpty(findEvidencePrivacyViolations({ detail: "loaded C:\\Users\\someone\\pack" }));
    assert.isNotEmpty(findEvidencePrivacyViolations({ detail: `module ${SECRET_UUID}` }));
    assert.isNotEmpty(findEvidencePrivacyViolations({ detail: "token=deadbeefcafe" }));
    assert.isNotEmpty(findEvidencePrivacyViolations({ detail: "MCTOOLS_SECRET_THING=1" }));
    assert.isNotEmpty(findEvidencePrivacyViolations({ detail: "x".repeat(MAX_EVIDENCE_TEXT_LENGTH + 1) }));
  });

  it("does not flag URI schemes as filesystem paths, while still flagging real drive paths", () => {
    // Regression: /[A-Za-z]:[\\/]/ also matched "https://..." (it contains
    // "s://"), so a privacy-safe diagnostic/recovery URL failed evidence
    // packaging. The detector now requires a path boundary (start or a
    // non-alphanumeric) before the single drive letter.
    const urlViolations = findEvidencePrivacyViolations({ detail: "see https://aka.ms/minecraft-debugger" });

    assert.isFalse(
      urlViolations.some((v) => v.reason.includes("filesystem path") || v.reason.includes("redactable")),
      `a URL must not read as a filesystem path: ${JSON.stringify(urlViolations)}`
    );

    const pathViolations = findEvidencePrivacyViolations({ detail: "exe at Q:\\slot\\bedrock_server.exe" });
    assert.isTrue(pathViolations.some((v) => v.reason.includes("filesystem path")));

    const forwardSlashViolations = findEvidencePrivacyViolations({ detail: "exe at Q:/slot/bedrock_server" });
    assert.isTrue(forwardSlashViolations.some((v) => v.reason.includes("filesystem path")));
  });

  it("accepts the normal clean values the lifecycle actually produces", () => {
    assert.deepEqual(
      findEvidencePrivacyViolations({
        detail: "protocol v10, port 19144",
        message: "BDS did not confirm 'Debugger listening' on port 19144 within 15s.",
        at: "2026-08-24T10:00:05.200Z",
      }),
      []
    );
  });

  it("does not flag URI schemes as filesystem paths, while still flagging real drive paths", () => {
    // Regression: /[A-Za-z]:[\\/]/ also matched "https://..." (it contains
    // "s://"), so a privacy-safe diagnostic/recovery URL failed evidence
    // packaging. The detector now requires a path boundary (start or a
    // non-alphanumeric) before the single drive letter.
    const urlViolations = findEvidencePrivacyViolations({ detail: "see https://aka.ms/minecraft-debugger" });

    assert.isFalse(
      urlViolations.some((v) => v.reason.includes("filesystem path") || v.reason.includes("redactable")),
      `a URL must not read as a filesystem path: ${JSON.stringify(urlViolations)}`
    );

    const pathViolations = findEvidencePrivacyViolations({ detail: "exe at Q:\\slot\\bedrock_server.exe" });
    assert.isTrue(pathViolations.some((v) => v.reason.includes("filesystem path")));

    const forwardSlashViolations = findEvidencePrivacyViolations({ detail: "exe at Q:/slot/bedrock_server" });
    assert.isTrue(forwardSlashViolations.some((v) => v.reason.includes("filesystem path")));
  });

  it("refuses to serialize a poisoned bundle", () => {
    const run = buildRun(makeCleanDiagnostics());
    const bundle = buildEvidenceBundle([run], TOOL_INFO, "2026-08-24T10:05:00.000Z");

    (bundle as unknown as Record<string, unknown>)["scratchNotes"] = SECRET_PATH;

    assert.throws(() => serializeEvidenceBundle(bundle), /privacy validation/);
  });

  it("serializes a clean bundle and stamps schema version and commit linkage", () => {
    const run = buildRun(makeCleanDiagnostics());
    const bundle = buildEvidenceBundle([run], TOOL_INFO, "2026-08-24T10:05:00.000Z");
    const text = serializeEvidenceBundle(bundle);
    const parsed = JSON.parse(text);

    assert.equal(parsed.schemaVersion, DEBUGGER_EVIDENCE_SCHEMA_VERSION);
    assert.equal(parsed.tool.commit, "abc1234def");
    assert.equal(parsed.bdsVersion, "1.21.130.4");
    assert.equal(parsed.protocolVersion, 10);
    assert.match(parsed.bundleId, /^dbg-evidence-\d{14}$/);
  });
});

describe("DebuggerEvidence redaction", () => {
  it("redacts paths, strips UUIDs, and caps length in evidence text", () => {
    const redacted = toEvidenceText(`saw ${SECRET_UUID} under "${SECRET_PATH}"`);

    assert.isDefined(redacted);
    assert.notInclude(redacted, SECRET_UUID);
    assert.notInclude(redacted, "MySecretAddon");
    assert.include(redacted, "<uuid>");

    const long = toEvidenceText("y".repeat(1000));
    assert.isAtMost(long!.length, MAX_EVIDENCE_TEXT_LENGTH);
  });

  it("sanitizes stage details and failure messages in built runs", () => {
    const run = buildRun(makeDirtyDiagnostics(), { outcome: "failed" });
    const waiting = run.stages.find((s) => s.stage === DebuggerLifecycleStage.waitingForReadiness);

    assert.isDefined(waiting?.detail);
    assert.notInclude(waiting!.detail, "MySecretAddon");
    assert.notInclude(run.failure?.message ?? "", SECRET_PASSCODE);
  });
});

describe("DebuggerEvidence normalization", () => {
  it("normalizes error codes, most specific first", () => {
    assert.equal(normalizeDebuggerErrorCode("No free script debugger port found in range 19144-19163."), "PORT_RANGE_EXHAUSTED");
    assert.equal(normalizeDebuggerErrorCode("server.properties has allow-inbound-script-debugging=false"), "INBOUND_DEBUGGING_DISABLED");
    assert.equal(normalizeDebuggerErrorCode("server.properties has allow-outbound-script-debugging=false"), "OUTBOUND_DEBUGGING_DISABLED");
    assert.equal(normalizeDebuggerErrorCode("BDS did not confirm 'Debugger listening' on port 19144 within 15s."), "LISTENER_CONFIRMATION_TIMEOUT");
    assert.equal(normalizeDebuggerErrorCode("Handshake timeout waiting for ProtocolEvent"), "HANDSHAKE_TIMEOUT");
    assert.equal(normalizeDebuggerErrorCode("connect ECONNREFUSED 127.0.0.1:19144 (giving up after 5 reconnect attempts)"), "ECONNREFUSED");
    assert.equal(normalizeDebuggerErrorCode("socket closed (giving up after 5 reconnect attempts)"), "RECONNECT_EXHAUSTED");
    assert.isUndefined(normalizeDebuggerErrorCode("something unusual"));
    assert.isUndefined(normalizeDebuggerErrorCode(undefined));
  });

  it("classifies connection hosts into coarse classes", () => {
    assert.equal(classifyEvidenceHost("localhost"), "loopback");
    assert.equal(classifyEvidenceHost("127.0.0.1"), "loopback");
    assert.equal(classifyEvidenceHost("::1"), "loopback");
    assert.equal(classifyEvidenceHost("192.168.1.20"), "lan");
    assert.equal(classifyEvidenceHost("172.20.0.3"), "lan");
    assert.equal(classifyEvidenceHost("203.0.113.7"), "remote");
    assert.equal(classifyEvidenceHost(undefined), "loopback");
  });
});

describe("DebuggerEvidence lifecycle mapping", () => {
  it("computes stage offsets, durations, and time-to-connected", () => {
    const run = buildRun(makeCleanDiagnostics());

    assert.equal(run.stages[0].sinceRunStartMs, 0);
    assert.equal(run.stages[0].durationMs, 3000);
    assert.equal(run.timeToConnectedMs, 5200);
    assert.isUndefined(run.stages[run.stages.length - 1].durationMs);
    assert.equal(run.reconnect.outcome, "notNeeded");
  });

  it("derives reconnect outcomes from the stage history", () => {
    const recovered = buildRun(
      makeCleanDiagnostics({
        stageHistory: [
          { stage: DebuggerLifecycleStage.connected, at: "2026-08-24T10:00:01.000Z" },
          { stage: DebuggerLifecycleStage.reconnecting, at: "2026-08-24T10:00:02.000Z", detail: "attempt 1/5 in 1000ms" },
          { stage: DebuggerLifecycleStage.connectingTcp, at: "2026-08-24T10:00:03.000Z" },
          { stage: DebuggerLifecycleStage.connected, at: "2026-08-24T10:00:04.000Z" },
        ],
      })
    );

    assert.equal(recovered.reconnect.attempts, 1);
    assert.equal(recovered.reconnect.outcome, "recovered");

    const gaveUp = buildRun(
      makeCleanDiagnostics({
        failureKind: DebuggerFailureKind.tcpConnect,
        errorMessage: "connect ECONNREFUSED (giving up after 5 reconnect attempts)",
        stageHistory: [
          { stage: DebuggerLifecycleStage.reconnecting, at: "2026-08-24T10:00:02.000Z" },
          { stage: DebuggerLifecycleStage.reconnecting, at: "2026-08-24T10:00:04.000Z" },
          { stage: DebuggerLifecycleStage.failed, at: "2026-08-24T10:00:08.000Z" },
        ],
      }),
      { outcome: "failed" }
    );

    assert.equal(gaveUp.reconnect.attempts, 2);
    assert.equal(gaveUp.reconnect.outcome, "gaveUp");
    assert.equal(gaveUp.failure?.code, "ECONNREFUSED");
  });

  it("summarizes pass rate, timings, and unresolved failure kinds", () => {
    const passing = buildRun(makeCleanDiagnostics());

    const expectedFailure = buildRun(
      makeCleanDiagnostics({
        failureKind: DebuggerFailureKind.settings,
        errorMessage: "server.properties has allow-inbound-script-debugging=false",
        stageHistory: [
          { stage: DebuggerLifecycleStage.configuring, at: "2026-08-24T10:00:00.000Z" },
          { stage: DebuggerLifecycleStage.failed, at: "2026-08-24T10:00:01.000Z" },
        ],
      }),
      { testCaseId: "failure-settings", outcome: "passed" }
    );

    const unexpectedFailure = buildRun(
      makeCleanDiagnostics({
        failureKind: DebuggerFailureKind.listenerReadiness,
        errorMessage: "BDS did not confirm 'Debugger listening' on port 19144 within 15s.",
        stageHistory: [
          { stage: DebuggerLifecycleStage.configuring, at: "2026-08-24T10:00:00.000Z" },
          { stage: DebuggerLifecycleStage.failed, at: "2026-08-24T10:00:16.000Z" },
        ],
      }),
      { outcome: "failed" }
    );

    const runs: IDebuggerEvidenceRun[] = [passing, expectedFailure, unexpectedFailure];
    const summary = buildEvidenceSummary(runs);

    assert.equal(summary.totalRuns, 3);
    assert.equal(summary.passed, 2);
    assert.equal(summary.failed, 1);
    assert.equal(summary.passRatePct, 66.7);
    assert.equal(summary.timeToConnected?.samples, 1);
    assert.equal(summary.timeToConnected?.medianMs, 5200);
    assert.equal(summary.failureKindCounts[DebuggerFailureKind.settings], 1);
    assert.deepEqual(summary.unresolvedFailureKinds, [DebuggerFailureKind.listenerReadiness]);

    const bundle = buildEvidenceBundle(runs, TOOL_INFO, "2026-08-24T10:05:00.000Z");
    assert.deepEqual(findEvidencePrivacyViolations(bundle), []);
  });
});

describe("DebuggerEvidence completeness", () => {
  // The evidence harness keeps running after a scenario fails before its
  // capture, so packaging must verify the exact expected scenario matrix -
  // a count threshold would report a 100% pass rate over a shrunk
  // denominator. Expected ids repeat to express multiplicity.
  const MATRIX = ["cold-start", "cold-start", "reconnect", "failure-settings"];

  const runsFor = (...ids: string[]) => ids.map((id) => ({ testCaseId: id }));

  it("accepts an exact match including multiplicities", () => {
    assert.deepEqual(
      findEvidenceCompletenessViolations(runsFor("cold-start", "reconnect", "cold-start", "failure-settings"), MATRIX),
      []
    );
  });

  it("flags a missing scenario", () => {
    const violations = findEvidenceCompletenessViolations(runsFor("cold-start", "cold-start", "reconnect"), MATRIX);

    assert.lengthOf(violations, 1);
    assert.include(violations[0], "missing scenario 'failure-settings'");
  });

  it("flags a multiplicity shortfall as missing", () => {
    const violations = findEvidenceCompletenessViolations(runsFor("cold-start", "reconnect", "failure-settings"), MATRIX);

    assert.lengthOf(violations, 1);
    assert.include(violations[0], "missing scenario 'cold-start'");
    assert.include(violations[0], "expected 2 run(s), captured 1");
  });

  it("flags a duplicated scenario", () => {
    const violations = findEvidenceCompletenessViolations(
      runsFor("cold-start", "cold-start", "reconnect", "reconnect", "failure-settings"),
      MATRIX
    );

    assert.lengthOf(violations, 1);
    assert.include(violations[0], "duplicated scenario 'reconnect'");
  });

  it("flags an unexpected scenario outside the matrix", () => {
    const violations = findEvidenceCompletenessViolations(
      runsFor("cold-start", "cold-start", "reconnect", "failure-settings", "improvised-extra"),
      MATRIX
    );

    assert.lengthOf(violations, 1);
    assert.include(violations[0], "unexpected scenario 'improvised-extra'");
  });

  it("reports every violation kind at once for a badly skewed set", () => {
    const violations = findEvidenceCompletenessViolations(
      runsFor("cold-start", "reconnect", "reconnect", "improvised-extra"),
      MATRIX
    );

    assert.lengthOf(violations, 4);
    assert.isTrue(violations.some((v) => v.includes("missing scenario 'cold-start'")));
    assert.isTrue(violations.some((v) => v.includes("duplicated scenario 'reconnect'")));
    assert.isTrue(violations.some((v) => v.includes("missing scenario 'failure-settings'")));
    assert.isTrue(violations.some((v) => v.includes("unexpected scenario 'improvised-extra'")));
  });
});

describe("DebuggerEvidence cleanup accounting", () => {
  // Deliberate teardown fires no disconnect event (the client reference is
  // cleared first), so cleanup evidence comes from state inspection - and
  // the summary must surface incomplete cleanup instead of ignoring the
  // per-run cleanup records.
  function runWithCleanup(cleanup?: { portReleased?: boolean; clientDisconnected?: boolean }) {
    return buildEvidenceRun(makeCleanDiagnostics(), {
      runId: "run-001",
      testCaseId: "connect-success",
      outcome: "passed",
      startedAt: "2026-08-24T10:00:00.000Z",
      endedAt: "2026-08-24T10:00:30.000Z",
      host: "localhost",
      cleanup:
        cleanup === undefined
          ? undefined
          : {
              stageAtEnd: DebuggerLifecycleStage.idle,
              portReleased: cleanup.portReleased,
              clientDisconnected: cleanup.clientDisconnected,
            },
    });
  }

  it("counts runs whose cleanup does not prove both flags", () => {
    const runs = [
      runWithCleanup({ portReleased: true, clientDisconnected: true }), // complete
      runWithCleanup({ portReleased: false, clientDisconnected: true }), // leaked port
      runWithCleanup({ portReleased: true, clientDisconnected: false }), // leaked client
      runWithCleanup({ portReleased: true }), // clientDisconnected unproven
      runWithCleanup(undefined), // no cleanup record - nothing to judge
    ];

    const summary = buildEvidenceSummary(runs);

    assert.equal(summary.incompleteCleanups, 3);
  });

  it("reports zero for fully clean runs and serializes within the privacy allowlist", () => {
    const runs = [runWithCleanup({ portReleased: true, clientDisconnected: true })];

    const bundle = buildEvidenceBundle(runs, TOOL_INFO, "2026-08-24T10:05:00.000Z");

    assert.equal(bundle.summary.incompleteCleanups, 0);
    assert.deepEqual(findEvidencePrivacyViolations(bundle), []);
    assert.include(serializeEvidenceBundle(bundle), '"incompleteCleanups"');
  });
});
