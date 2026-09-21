// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

// Import-time environment shim that makes DebugStatsPanel.tsx requirable
// inside the Node-based unit-test process. Import this module BEFORE importing
// DebugStatsPanel in a spec file — module require order follows import
// declaration order.

export {};

declare const require: any;

// DebugStatsPanel.tsx imports .css files; give Node's module loader a no-op
// handler.
require.extensions[".css"] = () => undefined;
