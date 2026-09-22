import SemanticVersion from "../../../core/versioning/SemanticVersion";
import { InfoItemType } from "../../IInfoItemData";
import { ProjectInfoSuite } from "../../IProjectInfoData";
import {
  defineValidationRule,
  ValidationRuleDefinition,
  ValidationSeverity,
} from "../../tests/ValidationRuleDefinition";

export const MinDropDownOptions = 2;

export const AllowedPackScopes = new Set(["global", "world", "any"]);

export const AllowedCapabilities = new Set<string>(["pbr"]);
export const AllowedDependencyModules: Record<string, SemanticVersion> = {
  "@minecraft/server": new SemanticVersion(1, 0, 0),
  "@minecraft/server-ui": new SemanticVersion(1, 0, 0),
};
export const TargetMevForVV = new SemanticVersion(1, 21, 120);
export const NamespaceFormat = /.+:.+/;
export const FormatVersion1 = 1;
export const FormatVersion2 = 2;
export const FormatVersion3 = 3;
export const ValidFormatVersions = new Set([FormatVersion1, FormatVersion2, FormatVersion3]);
export const WorldTemplateModuleName = "world_template";
export const KnownModuleTypes = new Set([
  "persona_piece",
  WorldTemplateModuleName,
  "skin_pack",
  "data",
  "script",
  "resources",
]);

// The mininmum min_engine_version allowed for blockbench emotes. See user story #1331327 for context
export const BlockBenchEmoteMinEngineVersion: SemanticVersion = new SemanticVersion(1, 17, 0);

const rule = (spec: {
  ruleIndex: number;
  name: string;
  title: string;
  defaultMessage?: string;
  severities?: readonly ValidationSeverity[];
}): ValidationRuleDefinition =>
  defineValidationRule({
    generatorId: "CHKMANIF",
    ruleIndex: spec.ruleIndex,
    name: spec.name,
    title: spec.title,
    defaultMessage: spec.defaultMessage,
    severities: spec.severities ?? [InfoItemType.error],
    suites: [ProjectInfoSuite.defaultInDevelopment, ProjectInfoSuite.currentPlatformVersions],
    source: {
      file: "app/src/info/projectGenerators/checkManifest/CheckManifestData.ts",
      symbol: `Tests.${spec.name[0].toUpperCase()}${spec.name.substring(1)}`,
    },
  });

export const Tests = {
  InvalidFormatVersion: rule({
    ruleIndex: 101,
    name: "invalidFormatVersion",
    title: "InvalidFormatVersion",
  }),
  InvalidManifestSchema: rule({
    ruleIndex: 102,
    name: "invalidManifestSchema",
    title: "Invalid Json Schema For Manifest File",
  }),
  InvalidNumberOfManifests: rule({
    ruleIndex: 103,
    name: "invalidNumberOfManifests",
    title: "Invalid Number Of Manifests",
    defaultMessage: "Packs must have exactly one manifest",
  }),
  MissingHeaderProperty: rule({
    ruleIndex: 104,
    name: "missingHeaderProperty",
    title: "Missing Header Property",
  }),
  HeaderPropertyRequiredV2: rule({
    ruleIndex: 105,
    name: "headerPropertyRequiredV2",
    title: "Header Property Required",
    defaultMessage: "Header property is required for format version 2 and above",
  }),
  MinEngineVersionTooHigh: rule({
    ruleIndex: 106,
    name: "minEngineVersionTooHigh",
    title: "Min Engine Version Too High For Format Version 1",
    defaultMessage: `[min_engine_version] is too high. To use a higher version, you need to use [format_version] [${FormatVersion2}]`,
  }),
  InvalidPackScope: rule({
    ruleIndex: 107,
    name: "invalidPackScope",
    title: "InvalidPackScope",
    defaultMessage: `pack_scope must be one of [${[...AllowedPackScopes].join(", ")}]`,
  }),
  TooManyWorldTemplates: rule({
    ruleIndex: 108,
    name: "tooManyWorldTemplates",
    title: "More Than 1 World Templates",
    defaultMessage: "manifest.modules can have only 1 world_template module",
  }),
  InvalidModuleType: rule({
    ruleIndex: 109,
    name: "invalidModuleType",
    title: "Invalid Module Type",
  }),
  DuplicateId: rule({
    ruleIndex: 110,
    name: "duplicateId",
    title: "Duplicate Id Found",
    defaultMessage: "Duplicate UUID found. All UUIDs must be unique",
  }),
  InvalidId: rule({
    ruleIndex: 111,
    name: "invalidId",
    title: "UUID is not valid",
  }),
  NoDependencyIdentifier: rule({
    ruleIndex: 112,
    name: "noDependencyIdentifier",
    title: "No Dependency Identifier",
    defaultMessage: "Dependency is invalid, no 'module_name' or 'uuid' identifier found",
  }),
  MultipleDependencyIdentifier: rule({
    ruleIndex: 113,
    name: "multipleDependencyIdentifier",
    title: "Multiple Dependency Identifier",
    defaultMessage: "Dependencies should be expressed by 'module_name' or UUID, not both",
  }),
  ModuleNameNotAllowed: rule({
    ruleIndex: 114,
    name: "moduleNameNotAllowed",
    title: "Module Name Not Allowed",
  }),
  UnableToParseVersion: rule({
    ruleIndex: 115,
    name: "unableToParseVersion",
    title: "Unable To Parse Version",
  }),
  BelowMinVersion: rule({
    ruleIndex: 116,
    name: "belowMinVersion",
    title: "Version Is Below Minimum Allowed",
  }),
  InvalidCapability: rule({
    ruleIndex: 117,
    name: "invalidCapability",
    title: "Invalid Capability",
  }),
  DuplicateSubpackFolder: rule({
    ruleIndex: 118,
    name: "duplicateSubpackFolder",
    title: "Duplicate Subpack Folder",
    defaultMessage: "Subpack folder name used twice",
  }),
  DuplicateSubpackName: rule({
    ruleIndex: 119,
    name: "duplicateSubpackName",
    title: "Duplicate Subpack Name",
    defaultMessage: "Subpack name used twice",
  }),
  MissingSettingsProperty: rule({
    ruleIndex: 122,
    name: "missingSettingsProperty",
    title: "Manifest Settings Missing Property",
    defaultMessage: "Property in manifest settings is missing or undefined",
  }),
  InvalidSettingType: rule({
    ruleIndex: 123,
    name: "invalidSettingType",
    title: "Invalid Setting Type",
    defaultMessage: "Manifest settings has invalid type property",
  }),
  InvalidSettingsMin: rule({
    ruleIndex: 124,
    name: "invalidSettingsMin",
    title: "Invalid Setting Minimum",
    defaultMessage: "Manifest min must be less max",
  }),
  InvalidSliderDefault: rule({
    ruleIndex: 125,
    name: "invalidSliderDefault",
    title: "Invalid Slider Setting Default",
    defaultMessage: "Manifest default must be less max, greather than min, and a number if type is slider",
  }),
  InvalidDropdownDefault: rule({
    ruleIndex: 126,
    name: "invalidDropdownDefault",
    title: "Invalid Dropdown Setting Default",
    defaultMessage: "Default must exist in the options list",
  }),
  InvalidSettingsStep: rule({
    ruleIndex: 127,
    name: "invalidSettingsStep",
    title: "Invalid Setting Step",
    defaultMessage: "Manifest step must be greater than 0 and less than (max - min)",
  }),
  DuplicateSettingsName: rule({
    ruleIndex: 128,
    name: "duplicateSettingsName",
    title: "Duplicate Settings Name",
  }),
  SettingsNamespaceRequired: rule({
    ruleIndex: 129,
    name: "settingsNamespaceRequired",
    title: "Settings Name Requires Namespace",
    defaultMessage: "Settings name must be in the format of a namespace and include ':'",
  }),
  NotEnoughSettingsOptions: rule({
    ruleIndex: 130,
    name: "notEnoughSettingsOptions",
    title: "Not Enough Settings Options",
    defaultMessage: `Settings dropdowns must have at least ${MinDropDownOptions} options`,
  }),
  DuplicateOptions: rule({
    ruleIndex: 131,
    name: "duplicateOptions",
    title: "Duplicate Settings Options",
    defaultMessage: `Settings dropdowns must not have duplicate options`,
  }),
  InvalidBaseGameVersion: rule({
    ruleIndex: 132,
    name: "invalidBaseGameVersion",
    title: "Invalid Base Game Version",
    defaultMessage: `Use of [base_game_version] requires [format_version] [${FormatVersion2}] or higher`,
  }),
  WildCardGameVersion: rule({
    ruleIndex: 133,
    name: "wildCardGameVersion",
    title: "WildCard Game Version",
    defaultMessage: `[base_game_version] wildcards are not recommended`,
    severities: [InfoItemType.warning],
  }),
  MinEngineVersionForVV: rule({
    ruleIndex: 134,
    name: "minEngineVersionForVV",
    title: "PBR Pack Min Engine Version",
    defaultMessage: `Packs that support PBR must have a minimum min_engine_version of at least ${TargetMevForVV.asString()}`,
  }),
  HasPBRFilesButNoManifestCapability: rule({
    ruleIndex: 135,
    name: "hasPBRFilesButNoManifestCapability",
    title: "Has Vibrant Visuals Enhanced Files But No Manifest Capability",
    defaultMessage: `Packs that contain PBR related files must declare the "pbr" capability in the manifest`,
    severities: [InfoItemType.error],
  }),
} as const;

/**
 * Rule slots whose production checks are currently disabled (the subpack
 * name/memory-tier validations in CheckManifestGenerator.validateSubpacks are
 * commented out because the SubpackTypes name whitelist rejected legitimate
 * creator-chosen subpack names). Kept out of `Tests` so the coverage catalog
 * only inventories rules that can actually fire; indices 120/121 stay
 * reserved here for when the checks are reinstated.
 */
export const DisabledTests = {
  InvalidSubpackName: rule({
    ruleIndex: 120,
    name: "invalidSubpackName",
    title: "Invalid Subpack Name",
  }),
  InvalidSubpackMemoryTier: rule({
    ruleIndex: 121,
    name: "invalidSubpackMemoryTier",
    title: "Invalid Subpack Memory Tier",
    defaultMessage: "Memory Tier for subpack must be greater than or equal to the minimum",
  }),
} as const;
