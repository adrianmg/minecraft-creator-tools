// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

/**
 * ZodUtilities - helpers for reporting input that Zod would otherwise silently drop.
 *
 * Zod object schemas default to "strip" mode: unknown keys are removed from the parsed
 * output without any error. That is convenient for tolerant parsing, but it means a caller
 * who misspells a field (or guesses at a field that doesn't exist) gets no feedback — their
 * value just disappears. These helpers let tools keep the tolerant behavior while still
 * telling the caller what was ignored.
 */

import { z } from "zod";

const IDENTIFIER_PATTERN = /^[A-Za-z_$][A-Za-z0-9_$]*$/;

function appendKeyToPath(path: string, key: string): string {
  if (IDENTIFIER_PATTERN.test(key)) {
    return path.length > 0 ? `${path}.${key}` : key;
  }

  return `${path}[${JSON.stringify(key)}]`;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function collectUnrecognizedKeys(schema: z.ZodTypeAny, data: unknown, path: string, results: string[]): void {
  if (data === undefined || data === null) {
    return;
  }

  const def = schema._def as any;

  switch (def.typeName as z.ZodFirstPartyTypeKind) {
    case z.ZodFirstPartyTypeKind.ZodOptional:
    case z.ZodFirstPartyTypeKind.ZodNullable:
    case z.ZodFirstPartyTypeKind.ZodDefault:
    case z.ZodFirstPartyTypeKind.ZodCatch:
    case z.ZodFirstPartyTypeKind.ZodReadonly:
      collectUnrecognizedKeys(def.innerType, data, path, results);
      return;

    case z.ZodFirstPartyTypeKind.ZodBranded:
      collectUnrecognizedKeys(def.type, data, path, results);
      return;

    case z.ZodFirstPartyTypeKind.ZodEffects:
      collectUnrecognizedKeys(def.schema, data, path, results);
      return;

    case z.ZodFirstPartyTypeKind.ZodLazy:
      collectUnrecognizedKeys(def.getter(), data, path, results);
      return;

    case z.ZodFirstPartyTypeKind.ZodPipeline:
      collectUnrecognizedKeys(def.in, data, path, results);
      return;

    case z.ZodFirstPartyTypeKind.ZodObject: {
      if (!isPlainObject(data)) {
        return;
      }

      const shape = (schema as z.AnyZodObject).shape as Record<string, z.ZodTypeAny>;
      const catchall = def.catchall as z.ZodTypeAny | undefined;
      const hasCatchall = catchall !== undefined && catchall._def.typeName !== z.ZodFirstPartyTypeKind.ZodNever;

      for (const key of Object.keys(data)) {
        const keyPath = appendKeyToPath(path, key);

        if (Object.prototype.hasOwnProperty.call(shape, key)) {
          collectUnrecognizedKeys(shape[key], data[key], keyPath, results);
        } else if (hasCatchall) {
          collectUnrecognizedKeys(catchall, data[key], keyPath, results);
        } else if (def.unknownKeys !== "passthrough") {
          results.push(keyPath);
        }
      }
      return;
    }

    case z.ZodFirstPartyTypeKind.ZodArray:
      if (Array.isArray(data)) {
        data.forEach((item, index) => collectUnrecognizedKeys(def.type, item, `${path}[${index}]`, results));
      }
      return;

    case z.ZodFirstPartyTypeKind.ZodTuple:
      if (Array.isArray(data)) {
        data.forEach((item, index) => {
          const itemSchema = index < def.items.length ? def.items[index] : def.rest;
          if (itemSchema) {
            collectUnrecognizedKeys(itemSchema, item, `${path}[${index}]`, results);
          }
        });
      }
      return;

    case z.ZodFirstPartyTypeKind.ZodRecord:
      if (isPlainObject(data)) {
        for (const key of Object.keys(data)) {
          collectUnrecognizedKeys(def.valueType, data[key], appendKeyToPath(path, key), results);
        }
      }
      return;

    case z.ZodFirstPartyTypeKind.ZodUnion:
    case z.ZodFirstPartyTypeKind.ZodDiscriminatedUnion: {
      // Mirror Zod's own resolution: the first option that accepts the value is the one
      // whose (stripped) output is used, so its unknown keys are the ones that get dropped.
      const options: z.ZodTypeAny[] = Array.isArray(def.options) ? def.options : Array.from(def.options.values());
      const match = options.find((option) => option.safeParse(data).success);
      if (match) {
        collectUnrecognizedKeys(match, data, path, results);
      }
      return;
    }

    case z.ZodFirstPartyTypeKind.ZodIntersection: {
      // A key is only dropped if neither side of the intersection knows about it.
      const left: string[] = [];
      const right: string[] = [];
      collectUnrecognizedKeys(def.left, data, path, left);
      collectUnrecognizedKeys(def.right, data, path, right);
      const rightSet = new Set(right);
      results.push(...left.filter((key) => rightSet.has(key)));
      return;
    }

    default:
      return;
  }
}

/**
 * Returns the paths (e.g. `itemTypes[0].damage`) of every object key in `data` that `schema`
 * does not recognize and would therefore strip during parsing. Keys accepted by `passthrough`
 * objects, `catchall` schemas, records, and `any`/`unknown` values are not reported.
 */
export function findUnrecognizedKeys(schema: z.ZodTypeAny, data: unknown): string[] {
  const results: string[] = [];
  collectUnrecognizedKeys(schema, data, "", results);
  return results;
}

/**
 * Wraps an object schema so that it validates exactly like the original — and produces an
 * identical JSON Schema, since it shares the original's definition — but yields the caller's
 * raw input on success instead of the stripped parse result.
 *
 * Use this for MCP tool input schemas: the MCP SDK validates tool arguments and hands the
 * *parsed* value to the tool handler, so without this wrapper the handler can never see
 * (or report) the unknown keys that were stripped. Handlers that use this wrapper should
 * re-parse the value themselves and use `findUnrecognizedKeys` to report ignored input.
 */
export function preserveUnknownKeys<T extends z.AnyZodObject>(schema: T): T {
  class UnknownKeyPreservingObject extends z.ZodObject<any> {
    _parse(input: z.ParseInput): z.ParseReturnType<any> {
      const result = super._parse(input);
      const keepRawInput = (parsed: z.SyncParseReturnType<any>): z.SyncParseReturnType<any> =>
        parsed.status === "aborted" ? parsed : { status: parsed.status, value: input.data };

      return result instanceof Promise ? result.then(keepRawInput) : keepRawInput(result);
    }
  }

  return new UnknownKeyPreservingObject(schema._def) as unknown as T;
}
