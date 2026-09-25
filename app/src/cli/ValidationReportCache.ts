/**
 * ValidationReportCache - decides when `mct validate` may reuse an existing `<name>.mcr.json` report.
 *
 * `mct validate` writes `<name>.mcr.json` alongside its other report files. Batch runs over large
 * collections of projects use it to skip projects that were already validated. Report file names
 * are derived only from the project's folder or file name, so the report alone can't tell whether
 * it describes the project being validated now.
 *
 * Before validating, the worker computes a cache key and stores it in the report as
 * `reportCacheKey`. A later run reuses the report only when it recomputes the same key. The key
 * covers:
 * - the CLI version, since validation rules change between releases
 * - the absolute path of the project source and its accessory files, so two projects with the
 *   same folder name don't share results
 * - the suite and exclusion list
 * - the relative path, size, modification time, and change time of every file under the source,
 *   so adding, removing, or editing any file invalidates the report
 *
 * If the source can't be read, no key is produced and the project is always re-validated. Reports
 * without a key, such as those written by older versions, are never reused.
 */

import * as crypto from "crypto";
import * as fs from "fs";
import * as path from "path";
import { constants } from "../core/Constants";
import IProjectStartInfo from "./IProjectStartInfo";

export interface IReportCacheKeyOptions {
  suite?: string;
  exclusionList?: string;

  /** Paths to leave out of the source signature, such as an output folder inside the project. */
  excludePaths?: string[];
}

export default class ValidationReportCache {
  /** Bump when the key's inputs change so reports written with an older key are ignored. */
  static readonly keySchemaVersion = 1;

  /**
   * Compute the cache key for validating `projectStart` with `options`. Returns undefined when the
   * project source can't be read, in which case the report must not be reused.
   */
  static getCacheKey(projectStart: IProjectStartInfo, options: IReportCacheKeyOptions = {}): string | undefined {
    const primaryPath = projectStart.localFilePath ?? projectStart.localFolderPath;

    if (!primaryPath) {
      return undefined;
    }

    const sourcePaths = [path.resolve(primaryPath)];

    for (const accessoryFile of projectStart.accessoryFiles ?? []) {
      sourcePaths.push(path.resolve(accessoryFile));
    }

    const excludePaths = (options.excludePaths ?? []).map((excludePath) => path.resolve(excludePath));

    const hash = crypto.createHash("sha256");

    hash.update(
      JSON.stringify({
        keySchemaVersion: ValidationReportCache.keySchemaVersion,
        toolVersion: constants.version,
        sourcePaths,
        suite: options.suite ?? null,
        exclusionList: options.exclusionList ?? null,
      })
    );

    for (const sourcePath of sourcePaths) {
      if (!ValidationReportCache.addSourceSignature(hash, sourcePath, excludePaths)) {
        return undefined;
      }
    }

    return hash.digest("hex");
  }

  /** True when `cachedKey` was read from an existing report and matches `currentKey`. */
  static isReportCurrent(cachedKey: unknown, currentKey: string | undefined): boolean {
    return typeof cachedKey === "string" && currentKey !== undefined && cachedKey === currentKey;
  }

  private static isExcluded(candidatePath: string, excludePaths: string[]) {
    for (const excludePath of excludePaths) {
      if (candidatePath === excludePath || candidatePath.startsWith(excludePath + path.sep)) {
        return true;
      }
    }

    return false;
  }

  /**
   * Add every file and folder under `rootPath` to `hash`. Symbolic links are followed; each real
   * folder is visited once so link cycles terminate. Returns false if anything can't be read.
   */
  private static addSourceSignature(hash: crypto.Hash, rootPath: string, excludePaths: string[]): boolean {
    const visitedFolders = new Set<string>();
    const pending = [rootPath];

    hash.update("\n#source\n");

    while (pending.length > 0) {
      const currentPath = pending.pop() as string;
      const relativePath = path.relative(rootPath, currentPath).split(path.sep).join("/");

      let stat: fs.Stats;

      try {
        stat = fs.statSync(currentPath);
      } catch {
        return false;
      }

      if (!stat.isDirectory()) {
        hash.update(`f|${relativePath}|${stat.size}|${stat.mtimeMs}|${stat.ctimeMs}\n`);
        continue;
      }

      hash.update(`d|${relativePath}\n`);

      let entryNames: string[];

      try {
        const realPath = fs.realpathSync(currentPath);

        if (visitedFolders.has(realPath)) {
          continue;
        }

        visitedFolders.add(realPath);

        entryNames = fs.readdirSync(currentPath);
      } catch {
        return false;
      }

      entryNames.sort();

      // Push in reverse so entries are visited, and hashed, in sorted order.
      for (let i = entryNames.length - 1; i >= 0; i--) {
        const childPath = path.join(currentPath, entryNames[i]);

        if (!ValidationReportCache.isExcluded(childPath, excludePaths)) {
          pending.push(childPath);
        }
      }
    }

    return true;
  }
}
