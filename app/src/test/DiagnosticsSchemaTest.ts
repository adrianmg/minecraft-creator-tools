// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

/**
 * DiagnosticsSchemaTest.ts
 *
 * Unit tests for DiagnosticsSchemaUtilities - the protocol v10 diagnostics
 * schema layer used by DebugStatsPanel:
 * - Wire descriptor validation and UI tab model construction (buildSchemaModel)
 * - Capability-gated controls (buildControlsModel)
 * - Stat-to-tab matching and value scaling
 * - Panel display state derivation across connect/reconnect/disconnect,
 *   external ownership, diagnostics-only, and stale-event scenarios
 */

import { expect } from "chai";
import {
  buildControlsModel,
  buildSchemaModel,
  buildTableRows,
  derivePanelDisplayState,
  matchStatsForTab,
  scaleStatValue,
  IDiagnosticsPanelFacts,
  IDiagnosticsStatValue,
  SCHEMA_LOAD_GRACE_MS,
  STALE_EVENT_THRESHOLD_MS,
} from "../debugger/DiagnosticsSchemaUtilities";
import { IDiagnosticsTabDescriptor, ProtocolVersion } from "../debugger/IMinecraftDebugProtocol";

describe("DiagnosticsSchema", function () {
  const validDescriptor: IDiagnosticsTabDescriptor = {
    name: "server_timing",
    stat_group_id: "server_timing",
    data_source: "server",
    display_type: "line_chart",
    title: "Server Timing",
    y_label: "ms",
    target_value: 50,
    value_scalar: 2,
  };

  describe("buildSchemaModel", function () {
    it("builds tab models from valid descriptors", function () {
      const model = buildSchemaModel([validDescriptor]);

      expect(model.errors.length).to.equal(0);
      expect(model.tabs.length).to.equal(1);

      const tab = model.tabs[0];
      expect(tab.id).to.equal("server_timing");
      expect(tab.title).to.equal("Server Timing");
      expect(tab.statGroupId).to.equal("server_timing");
      expect(tab.dataSource).to.equal("server");
      expect(tab.displayType).to.equal("line_chart");
      expect(tab.yLabel).to.equal("ms");
      expect(tab.targetValue).to.equal(50);
      expect(tab.valueScalar).to.equal(2);
      expect(tab.isEmptyTab).to.be.false;
    });

    it("falls back to name when no title is provided", function () {
      const model = buildSchemaModel([{ ...validDescriptor, title: undefined }]);
      expect(model.tabs[0].title).to.equal("server_timing");
    });

    it("flags is_empty_tab descriptors as intentionally empty", function () {
      const model = buildSchemaModel([{ ...validDescriptor, is_empty_tab: true }]);
      expect(model.tabs[0].isEmptyTab).to.be.true;
    });

    it("merges statistic_id and statistic_ids without duplicates", function () {
      const model = buildSchemaModel([{ ...validDescriptor, statistic_id: "a", statistic_ids: ["a", "b"] }]);
      expect(model.tabs[0].statisticIds).to.deep.equal(["a", "b"]);
    });

    it("reports an error for a non-array payload without throwing", function () {
      const model = buildSchemaModel("garbage");
      expect(model.tabs.length).to.equal(0);
      expect(model.errors.length).to.equal(1);
      expect(model.errors[0].message).to.include("not an array");
    });

    it("keeps valid descriptors when others are malformed", function () {
      const model = buildSchemaModel([
        validDescriptor,
        null,
        { name: "no_group" },
        { ...validDescriptor, name: "bad_source", data_source: "martian" },
        { ...validDescriptor, name: "bad_display", display_type: "hologram" },
      ]);

      expect(model.tabs.length).to.equal(1);
      expect(model.errors.length).to.equal(4);
      expect(model.errors[1].message).to.include("no_group");
      expect(model.errors[2].message).to.include("martian");
      expect(model.errors[3].message).to.include("hologram");
    });

    it("uniquifies duplicate descriptor names for tab ids", function () {
      const model = buildSchemaModel([validDescriptor, { ...validDescriptor }]);
      expect(model.tabs.length).to.equal(2);
      expect(model.tabs[0].id).to.not.equal(model.tabs[1].id);
    });
  });

  describe("buildControlsModel", function () {
    it("hides profiler and commands for pre-v5 versions", function () {
      const controls = buildControlsModel(ProtocolVersion.SupportPasscode);
      expect(controls.showPauseResume).to.be.true;
      expect(controls.showProfiler).to.be.false;
      expect(controls.showCommands).to.be.false;
    });

    it("shows profiler for v5+ versions", function () {
      const controls = buildControlsModel(ProtocolVersion.SupportProfilerCaptures);
      expect(controls.showProfiler).to.be.true;
      expect(controls.showCommands).to.be.true;
    });

    it("hides all controls when no version was negotiated", function () {
      const controls = buildControlsModel(undefined);
      expect(controls.showPauseResume).to.be.false;
      expect(controls.showProfiler).to.be.false;
      expect(controls.showCommands).to.be.false;
    });

    it("prefers explicit capabilities over version inference", function () {
      const controls = buildControlsModel(ProtocolVersion.SupportEmptyTabs, {
        supportsProfiler: false,
        supportsCommands: false,
      });
      expect(controls.showProfiler).to.be.false;
      expect(controls.showCommands).to.be.false;
    });
  });

  describe("matchStatsForTab and scaling", function () {
    const stats: IDiagnosticsStatValue[] = [
      { name: "worldTick", values: [1.5], parent: "tick", fullId: "tick_worldtick", parentFullId: "tick" },
      { name: "scriptTick", values: [0.5], parent: "tick", fullId: "tick_scripttick", parentFullId: "tick" },
      { name: "entities", values: [42], fullId: "entities" },
    ];

    it("matches stats by group id against full id paths", function () {
      // stacked_line_chart is a multi-series display type: with no
      // statistic_ids declared it keeps the whole group.
      const model = buildSchemaModel([
        { ...validDescriptor, name: "tick_tab", stat_group_id: "tick", display_type: "stacked_line_chart" },
      ]);
      const matched = matchStatsForTab(model.tabs[0], stats);

      expect(matched.length).to.equal(2);
      expect(matched.map((s) => s.name)).to.deep.equal(["worldTick", "scriptTick"]);
    });

    it("defaults a line_chart without statistic_id to the group-id statistic", function () {
      // The protocol defines a line chart's effective series as
      // statistic_id ?? stat_group_id - it renders ONE statistic, never the
      // whole group as sibling cards.
      const model = buildSchemaModel([{ ...validDescriptor, name: "tick_tab", stat_group_id: "tick" }]);

      expect(model.tabs[0].statisticIds).to.deep.equal(["tick"]);

      const matched = matchStatsForTab(model.tabs[0], [{ name: "tick", values: [4], fullId: "tick" }, ...stats]);

      expect(matched.length).to.equal(1);
      expect(matched[0].name).to.equal("tick");
    });

    it("filters by statistic_ids when specified", function () {
      const model = buildSchemaModel([
        { ...validDescriptor, name: "tick_tab", stat_group_id: "tick", statistic_ids: ["tick_worldtick"] },
      ]);
      const matched = matchStatsForTab(model.tabs[0], stats);

      expect(matched.length).to.equal(1);
      expect(matched[0].name).to.equal("worldTick");
    });

    it("matches by name/parent when full ids are unavailable", function () {
      const legacyStats: IDiagnosticsStatValue[] = [
        { name: "worldTick", values: [1.5], parent: "tick" },
        { name: "memory", values: [512] },
      ];
      const model = buildSchemaModel([
        { ...validDescriptor, name: "tick_tab", stat_group_id: "tick", display_type: "stacked_line_chart" },
      ]);
      const matched = matchStatsForTab(model.tabs[0], legacyStats);

      expect(matched.length).to.equal(1);
      expect(matched[0].name).to.equal("worldTick");
    });

    it("keeps the result empty until the named statistics arrive", function () {
      const model = buildSchemaModel([
        { ...validDescriptor, name: "tick_tab", stat_group_id: "tick", statistic_ids: ["tick_pendingstat"] },
      ]);
      const matched = matchStatsForTab(model.tabs[0], stats);

      expect(matched.length).to.equal(0);
    });

    it("does not accept statistic ids by substring", function () {
      // "tick" is contained in every full id in the group, but no stat is
      // actually named "tick" - nothing may match.
      const model = buildSchemaModel([
        { ...validDescriptor, name: "tick_tab", stat_group_id: "tick", statistic_ids: ["tick"] },
      ]);
      const matched = matchStatsForTab(model.tabs[0], stats);

      expect(matched.length).to.equal(0);
    });

    it("suppresses value-less grouping nodes but keeps value-less aggregates with child tuples", function () {
      const model = buildSchemaModel([
        { ...validDescriptor, name: "tick_tab", stat_group_id: "tick", display_type: "stacked_line_chart" },
      ]);
      const matched = matchStatsForTab(model.tabs[0], [
        // Grouping node: no values, no tuples - must be suppressed even
        // though its id matches the group exactly.
        { name: "tick", values: [], fullId: "tick" },
        // Aggregate carrying its data as child tuples - must be retained.
        { name: "tick", values: [], fullId: "tick", childrenStringValues: [["worldTick", "1.5"]] },
        ...stats,
      ]);

      expect(matched.length).to.equal(3);
      expect(matched.filter((s) => s.childrenStringValues !== undefined).length).to.equal(1);
    });

    it("does not attribute nested descendants to an ancestor group", function () {
      // A stat whose DIRECT group is "world" belongs to the world tab even
      // though that group sits under "tick" - the official providers compare
      // the event's direct group to stat_group_id.
      const nested: IDiagnosticsStatValue[] = [
        {
          name: "chunkLoads",
          values: [7],
          parent: "world",
          fullId: "tick_world_chunkloads",
          parentFullId: "tick_world",
        },
      ];

      const tickModel = buildSchemaModel([
        { ...validDescriptor, name: "tick_tab", stat_group_id: "tick", display_type: "stacked_line_chart" },
      ]);
      expect(matchStatsForTab(tickModel.tabs[0], nested).length).to.equal(0);

      const worldModel = buildSchemaModel([
        { ...validDescriptor, name: "world_tab", stat_group_id: "world", display_type: "stacked_line_chart" },
      ]);
      expect(matchStatsForTab(worldModel.tabs[0], nested).length).to.equal(1);
    });

    it("does not let a leaf merely named like the group override its authoritative full ids", function () {
      // A leaf NAMED "tick" whose direct parent is the world group (itself
      // nested under tick). Its full ids are authoritative: the name fallback
      // must not pull it into the tick tab - it belongs to the world tab via
      // its direct parent.
      const repeatedLeafName: IDiagnosticsStatValue[] = [
        { name: "tick", values: [3], parent: "world", fullId: "tick_world_tick", parentFullId: "tick_world" },
      ];

      const tickModel = buildSchemaModel([
        { ...validDescriptor, name: "tick_tab", stat_group_id: "tick", display_type: "stacked_line_chart" },
      ]);
      expect(matchStatsForTab(tickModel.tabs[0], repeatedLeafName).length).to.equal(0);

      const worldModel = buildSchemaModel([
        { ...validDescriptor, name: "world_tab", stat_group_id: "world", display_type: "stacked_line_chart" },
      ]);
      expect(matchStatsForTab(worldModel.tabs[0], repeatedLeafName).length).to.equal(1);
    });

    it("accepts the group nested under a per-client prefix for client tabs only", function () {
      const clientStats: IDiagnosticsStatValue[] = [
        {
          name: "worldTick",
          values: [2],
          parent: "tick",
          fullId: "clients_client0_tick_worldtick",
          parentFullId: "clients_client0_tick",
        },
      ];
      const clientModel = buildSchemaModel([
        {
          ...validDescriptor,
          name: "tick_tab",
          stat_group_id: "tick",
          data_source: "client",
          display_type: "stacked_line_chart",
        },
      ]);

      expect(matchStatsForTab(clientModel.tabs[0], clientStats).length).to.equal(1);

      // The per-client prefix rule belongs to client tabs; a server tab with
      // the same group must not accept the client-nested stat.
      const serverModel = buildSchemaModel([
        { ...validDescriptor, name: "tick_tab", stat_group_id: "tick", display_type: "stacked_line_chart" },
      ]);

      expect(matchStatsForTab(serverModel.tabs[0], clientStats).length).to.equal(0);
    });

    it("keeps colliding client/server group names in their own tabs", function () {
      // Client stats arrive nested under a per-client prefix while server
      // stats carry the bare group. When both sources share a group segment
      // ("tick"), the suffix rule must apply ONLY to the client tab -
      // otherwise the client-nested stat also populates the server (and
      // server_script) tab for the same group.
      const colliding: IDiagnosticsStatValue[] = [
        // Server: direct member of the bare "tick" group
        { name: "worldTick", values: [1.5], parent: "tick", fullId: "tick_worldtick", parentFullId: "tick" },
        // Server: member of a NESTED "tick" group (engine_tick)
        { name: "deepTick", values: [3], parent: "tick", fullId: "engine_tick_deeptick", parentFullId: "engine_tick" },
        // Client: member of the per-client-nested "tick" group
        {
          name: "frameTick",
          values: [2],
          parent: "tick",
          fullId: "clients_client0_tick_frametick",
          parentFullId: "clients_client0_tick",
        },
      ];

      const serverModel = buildSchemaModel([
        { ...validDescriptor, name: "server_tick_tab", stat_group_id: "tick", display_type: "stacked_line_chart" },
      ]);
      const serverMatched = matchStatsForTab(serverModel.tabs[0], colliding).map((s) => s.name);
      expect(serverMatched).to.deep.equal(["worldTick", "deepTick"]);

      const scriptModel = buildSchemaModel([
        {
          ...validDescriptor,
          name: "script_tick_tab",
          stat_group_id: "tick",
          data_source: "server_script",
          display_type: "stacked_line_chart",
        },
      ]);
      const scriptMatched = matchStatsForTab(scriptModel.tabs[0], colliding).map((s) => s.name);
      expect(scriptMatched).to.deep.equal(["worldTick", "deepTick"]);

      const clientModel = buildSchemaModel([
        {
          ...validDescriptor,
          name: "client_tick_tab",
          stat_group_id: "tick",
          data_source: "client",
          display_type: "stacked_line_chart",
        },
      ]);
      const clientMatched = matchStatsForTab(clientModel.tabs[0], colliding).map((s) => s.name);
      // EXACT set: only the per-client-nested stat belongs here. Neither the
      // root-level server stat (worldTick, direct parentFullId "tick" - the
      // clause that previously bypassed the source gate) nor the
      // server-nested "tick" group (engine_tick) may leak into the client
      // tab.
      expect(clientMatched).to.deep.equal(["frameTick"]);
    });

    it("gates the entire match on the tab's data source when sources share a group id", function () {
      // Regression: the client-suffix branch was accepted for EVERY tab and
      // the direct matches never consulted tab.dataSource, so client and
      // server descriptors sharing a group id ("tick" exists on both sides)
      // consumed each other's statistics and the UI misattributed them.
      const shared: IDiagnosticsStatValue[] = [
        { name: "worldTick", values: [1.5], parent: "tick", fullId: "tick_worldtick", parentFullId: "tick" },
        {
          name: "worldTick",
          values: [2],
          parent: "tick",
          fullId: "clients_client0_tick_worldtick",
          parentFullId: "clients_client0_tick",
        },
        {
          name: "worldTick",
          values: [3],
          parent: "tick",
          fullId: "clients_client1_tick_worldtick",
          parentFullId: "clients_client1_tick",
        },
      ];

      const model = buildSchemaModel([
        {
          ...validDescriptor,
          name: "server_tick",
          stat_group_id: "tick",
          data_source: "server",
          display_type: "stacked_line_chart",
        },
        {
          ...validDescriptor,
          name: "client_tick",
          stat_group_id: "tick",
          data_source: "client",
          display_type: "stacked_line_chart",
        },
        {
          ...validDescriptor,
          name: "script_tick",
          stat_group_id: "tick",
          data_source: "server_script",
          display_type: "stacked_line_chart",
        },
      ]);

      // Exact result sets per source: the server tab gets only the
      // root-level stat, the client tab only the per-client nested stats
      // (every client), and server_script - root-level like server, since
      // only client statistics are nested on the wire - gets the root stat.
      expect(matchStatsForTab(model.tabs[0], shared).map((s) => s.fullId)).to.deep.equal(["tick_worldtick"]);
      expect(matchStatsForTab(model.tabs[1], shared).map((s) => s.fullId)).to.deep.equal([
        "clients_client0_tick_worldtick",
        "clients_client1_tick_worldtick",
      ]);
      expect(matchStatsForTab(model.tabs[2], shared).map((s) => s.fullId)).to.deep.equal(["tick_worldtick"]);
    });

    it("does not let a client tab claim a nested server group sharing its trailing segment", function () {
      // Server-side nested group "tick_world": its members' parent path ends
      // in "_world", but it does not sit under the per-client root - a
      // client tab with group "world" must not claim it.
      const nestedServer: IDiagnosticsStatValue[] = [
        {
          name: "chunkLoads",
          values: [7],
          parent: "world",
          fullId: "tick_world_chunkloads",
          parentFullId: "tick_world",
        },
      ];
      const model = buildSchemaModel([
        {
          ...validDescriptor,
          name: "client_world",
          stat_group_id: "world",
          data_source: "client",
          display_type: "stacked_line_chart",
        },
      ]);

      expect(matchStatsForTab(model.tabs[0], nestedServer).length).to.equal(0);
    });

    it("does not group-match stats whose ids merely start with the group text", function () {
      const model = buildSchemaModel([
        { ...validDescriptor, name: "tick_tab", stat_group_id: "tick", display_type: "stacked_line_chart" },
      ]);
      const matched = matchStatsForTab(model.tabs[0], [
        { name: "x", values: [1], parent: "tickle", fullId: "tickle_x", parentFullId: "tickle" },
      ]);

      expect(matched.length).to.equal(0);
    });

    it("applies value_scalar to numeric values only", function () {
      const model = buildSchemaModel([validDescriptor]);
      expect(scaleStatValue(model.tabs[0], 10)).to.equal(20);
      expect(scaleStatValue(model.tabs[0], "text")).to.equal("text");
    });
  });

  describe("buildTableRows", function () {
    it("renders non-aggregate stats as one row holding only the newest sample", function () {
      // values is an oldest-to-newest sample window, not table columns; the
      // official table resolver keeps only the current tick.
      const model = buildSchemaModel([{ ...validDescriptor, display_type: "table" }]);
      const rows = buildTableRows(model.tabs[0], [{ name: "worldTick", values: [1.5, 3], fullId: "tick_worldtick" }]);

      expect(rows).to.deep.equal([{ id: "tick_worldtick", name: "worldTick", verbatim: false, values: [3] }]);
    });

    it("never receives empty grouping stats - membership suppresses them upstream", function () {
      // _flattenStats emits every tree node, including grouping/non-value
      // nodes with values: []. matchStatsForTab suppresses those (matching
      // the official providers), so table tabs show the truthful "no data
      // received yet" state instead of blank rows.
      const model = buildSchemaModel([
        { ...validDescriptor, name: "tick_tab", stat_group_id: "tick", display_type: "table" },
      ]);
      const matched = matchStatsForTab(model.tabs[0], [
        { name: "tick", values: [], fullId: "tick" },
        { name: "worldTick", values: [], parent: "tick", fullId: "tick_worldtick", parentFullId: "tick" },
      ]);

      expect(matched.length).to.equal(0);
      expect(buildTableRows(model.tabs[0], matched)).to.deep.equal([]);
    });

    it("expands aggregate child tuples into key/value rows and restores numeric values", function () {
      const model = buildSchemaModel([{ ...validDescriptor, display_type: "multi_column_table" }]);
      const rows = buildTableRows(model.tabs[0], [
        {
          name: "packets",
          values: [],
          fullId: "packets",
          childrenStringValues: [
            ["movePacket", "12", "3.5"],
            ["chatPacket", "1", "0.25"],
          ],
        },
      ]);

      expect(rows).to.deep.equal([
        { id: "packets:movePacket", name: "movePacket", verbatim: false, values: [12, 3.5] },
        { id: "packets:chatPacket", name: "chatPacket", verbatim: false, values: [1, 0.25] },
      ]);
    });

    it("keeps dynamic property keys and values verbatim", function () {
      // Dynamic property values are creator data: numeric-looking strings
      // like "001" or "1e3" must render exactly as stored, not as 1 / 1000.
      const model = buildSchemaModel([{ ...validDescriptor, display_type: "dynamic_properties_table" }]);
      const rows = buildTableRows(model.tabs[0], [
        {
          name: "dynamicProperties",
          values: [],
          fullId: "dynamicproperties",
          childrenStringValues: [
            ["my:save_slot", "001"],
            ["my:scale", "1e3"],
            ["my:player_name", "Alex"],
          ],
        },
      ]);

      expect(rows.length).to.equal(3);
      expect(rows[0]).to.deep.equal({
        id: "dynamicproperties:my:save_slot",
        name: "my:save_slot",
        verbatim: true,
        values: ["001"],
      });
      expect(rows[1].values).to.deep.equal(["1e3"]);
      expect(rows[2].name).to.equal("my:player_name");
      expect(rows[2].verbatim).to.be.true;
      expect(rows[2].values).to.deep.equal(["Alex"]);
    });

    it("skips empty child tuples and does not emit a row for the aggregate parent", function () {
      const model = buildSchemaModel([{ ...validDescriptor, display_type: "table" }]);
      const rows = buildTableRows(model.tabs[0], [
        { name: "packets", values: [99], fullId: "packets", childrenStringValues: [[], ["movePacket", "12"]] },
      ]);

      expect(rows).to.deep.equal([{ id: "packets:movePacket", name: "movePacket", verbatim: false, values: [12] }]);
    });
  });

  describe("derivePanelDisplayState", function () {
    const baseFacts: IDiagnosticsPanelFacts = {
      connectionStatus: "connected",
      diagnosticsEnabled: true,
      ownership: "attachedByMct",
      protocolVersion: ProtocolVersion.SupportEmptyTabs,
      hasSchema: true,
      hasReceivedStats: true,
      msSinceLastEvent: 100,
    };

    it("reports active for a healthy v10 session", function () {
      expect(derivePanelDisplayState(baseFacts)).to.equal("active");
    });

    it("reports diagnosticsDisabled regardless of connection", function () {
      expect(derivePanelDisplayState({ ...baseFacts, diagnosticsEnabled: false })).to.equal("diagnosticsDisabled");
    });

    it("reports ownedExternally when disconnected and another debugger owns the endpoint", function () {
      expect(
        derivePanelDisplayState({
          ...baseFacts,
          connectionStatus: "disconnected",
          ownership: "attachedExternally",
        })
      ).to.equal("ownedExternally");
    });

    it("reports plain disconnected otherwise", function () {
      expect(
        derivePanelDisplayState({ ...baseFacts, connectionStatus: "disconnected", ownership: "unattached" })
      ).to.equal("disconnected");
    });

    it("reports loadingSchema for a v9+ session before schema or stats arrive", function () {
      expect(
        derivePanelDisplayState({
          ...baseFacts,
          hasSchema: false,
          hasReceivedStats: false,
          msSinceLastEvent: undefined,
        })
      ).to.equal("loadingSchema");
    });

    it("reports loadingSchema while within the schema-load grace period", function () {
      expect(
        derivePanelDisplayState({
          ...baseFacts,
          hasSchema: false,
          hasReceivedStats: false,
          msSinceLastEvent: undefined,
          msSinceConnect: SCHEMA_LOAD_GRACE_MS - 1,
        })
      ).to.equal("loadingSchema");
    });

    it("falls back to noEvents when the schema-load grace period expires", function () {
      // A v9+ target that omitted the SchemaEvent (or sent one so malformed it
      // was ignored) must not show "loading" forever.
      expect(
        derivePanelDisplayState({
          ...baseFacts,
          hasSchema: false,
          hasReceivedStats: false,
          msSinceLastEvent: undefined,
          msSinceConnect: SCHEMA_LOAD_GRACE_MS + 1,
        })
      ).to.equal("noEvents");
    });

    it("reports noEvents for pre-v9 sessions before stats arrive", function () {
      expect(
        derivePanelDisplayState({
          ...baseFacts,
          protocolVersion: ProtocolVersion.SupportBreakpointsAsRequest,
          hasSchema: false,
          hasReceivedStats: false,
          msSinceLastEvent: undefined,
        })
      ).to.equal("noEvents");
    });

    it("reports stale when events stop flowing", function () {
      expect(derivePanelDisplayState({ ...baseFacts, msSinceLastEvent: STALE_EVENT_THRESHOLD_MS + 1 })).to.equal(
        "stale"
      );
    });

    it("supports diagnostics-only sessions (no schema, stats flowing)", function () {
      expect(derivePanelDisplayState({ ...baseFacts, hasSchema: false, hasReceivedStats: true })).to.equal("active");
    });
  });
});
