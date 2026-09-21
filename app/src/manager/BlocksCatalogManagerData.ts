// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { InfoItemType } from "../info/IInfoItemData";
import { ProjectInfoSuite } from "../info/IProjectInfoData";
import { defineValidationRule, ValidationRuleDefinition } from "../info/tests/ValidationRuleDefinition";

/**
 * Rule metadata for BlocksCatalogManager (BLOCKSCAT), which validates
 * resource pack blocks.json catalog entries against the block types the
 * project defines and the vanilla block catalog. 101 (catalog found) is an
 * informational inventory item, not a validation rule; 53 is a feature
 * counter.
 */

const rule = (spec: {
  ruleIndex: number;
  name: string;
  title: string;
  severities: ValidationRuleDefinition["severities"];
}): ValidationRuleDefinition =>
  defineValidationRule({
    generatorId: "BLOCKSCAT",
    ruleIndex: spec.ruleIndex,
    name: spec.name,
    title: spec.title,
    severities: spec.severities,
    suites: [ProjectInfoSuite.defaultInDevelopment],
    source: {
      file: "app/src/manager/BlocksCatalogManagerData.ts",
      symbol: "BlocksCatalogValidationRules",
    },
  });

export const BlocksCatalogValidationRules: readonly ValidationRuleDefinition[] = [
  rule({
    ruleIndex: 100,
    name: "unusedBlockCatalogResource",
    title: "Unused Blocks Catalog Resource",
    severities: [InfoItemType.warning],
  }),
  rule({
    ruleIndex: 102,
    name: "vanillaOverrideBlockCatalogResource",
    title: "Blocks Catalog Overrides Vanilla Resource",
    severities: [InfoItemType.recommendation],
  }),
];
