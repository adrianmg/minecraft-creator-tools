/**
 * ValidationReportCacheTest - Unit tests for when `mct validate` may reuse an existing .mcr.json report.
 */

/// <reference types="node" />

import { expect } from "chai";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import ValidationReportCache, { IReportCacheKeyOptions } from "../cli/ValidationReportCache";
import IProjectStartInfo from "../cli/IProjectStartInfo";

interface IKeyChangeCase {
  name: string;
  /** Options for the first key; defaults to baseOptions. */
  initialOptions?: (projectFolder: string) => IReportCacheKeyOptions;
  /** Change the project (or the options used to validate it) after the first key is computed. */
  change: (
    projectFolder: string,
    tempBase: string
  ) => { projectStart?: IProjectStartInfo; options?: IReportCacheKeyOptions } | void;
  expectKeyChanged: boolean;
}

function writeFile(filePath: string, content: string) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, content);
}

function setModifiedTime(filePath: string, time: Date) {
  fs.utimesSync(filePath, time, time);
}

describe("ValidationReportCache", () => {
  let tempBase: string;
  let projectFolder: string;

  const baseOptions: IReportCacheKeyOptions = { suite: "main", exclusionList: undefined };

  beforeEach(() => {
    tempBase = fs.mkdtempSync(path.join(os.tmpdir(), "mct-report-cache-"));
    projectFolder = path.join(tempBase, "a", "myproject");

    writeFile(path.join(projectFolder, "behavior_packs", "bp", "manifest.json"), '{ "format_version": 2 }');
    writeFile(path.join(projectFolder, "behavior_packs", "bp", "pack_icon.png"), "icon");
    writeFile(path.join(projectFolder, "resource_packs", "rp", "manifest.json"), '{ "format_version": 2 }');

    const fixedTime = new Date(Date.now() - 60 * 60 * 1000);
    setModifiedTime(path.join(projectFolder, "behavior_packs", "bp", "manifest.json"), fixedTime);
    setModifiedTime(path.join(projectFolder, "behavior_packs", "bp", "pack_icon.png"), fixedTime);
  });

  afterEach(() => {
    fs.rmSync(tempBase, { recursive: true, force: true });
  });

  const keyChangeCases: IKeyChangeCase[] = [
    {
      name: "nothing changes",
      change: () => {},
      expectKeyChanged: false,
    },
    {
      name: "a file is deleted",
      change: (folder) => fs.rmSync(path.join(folder, "behavior_packs", "bp", "pack_icon.png")),
      expectKeyChanged: true,
    },
    {
      name: "a file is added",
      change: (folder) => writeFile(path.join(folder, "behavior_packs", "bp", "entities", "cow.json"), "{}"),
      expectKeyChanged: true,
    },
    {
      name: "a file is renamed",
      change: (folder) =>
        fs.renameSync(
          path.join(folder, "behavior_packs", "bp", "pack_icon.png"),
          path.join(folder, "behavior_packs", "bp", "pack_icon2.png")
        ),
      expectKeyChanged: true,
    },
    {
      name: "a file's content changes size",
      change: (folder) => fs.writeFileSync(path.join(folder, "behavior_packs", "bp", "manifest.json"), "{}"),
      expectKeyChanged: true,
    },
    {
      name: "a file is modified without changing size",
      change: (folder) => {
        const manifestPath = path.join(folder, "behavior_packs", "bp", "manifest.json");
        fs.writeFileSync(manifestPath, '{ "format_version": 3 }');
        setModifiedTime(manifestPath, new Date());
      },
      expectKeyChanged: true,
    },
    {
      name: "a different suite is used",
      change: () => ({ options: { ...baseOptions, suite: "addon" } }),
      expectKeyChanged: true,
    },
    {
      name: "an exclusion list is added",
      change: () => ({ options: { ...baseOptions, exclusionList: "PATHLENGTH" } }),
      expectKeyChanged: true,
    },
    {
      name: "a project with the same folder name at another path is validated",
      change: (folder, base) => {
        const otherFolder = path.join(base, "b", "myproject");
        fs.cpSync(folder, otherFolder, { recursive: true, preserveTimestamps: true });
        return { projectStart: { ctorProjectName: "myproject", localFolderPath: otherFolder } };
      },
      expectKeyChanged: true,
    },
    {
      name: "a file is added under an excluded output folder",
      initialOptions: (folder) => ({ ...baseOptions, excludePaths: [path.join(folder, "out")] }),
      change: (folder) => writeFile(path.join(folder, "out", "myproject.mcr.json"), "{}"),
      expectKeyChanged: false,
    },
  ];

  for (const testCase of keyChangeCases) {
    it(`key ${testCase.expectKeyChanged ? "changes" : "is unchanged"} when ${testCase.name}`, () => {
      const projectStart: IProjectStartInfo = { ctorProjectName: "myproject", localFolderPath: projectFolder };
      const firstOptions = testCase.initialOptions ? testCase.initialOptions(projectFolder) : baseOptions;

      const firstKey = ValidationReportCache.getCacheKey(projectStart, firstOptions);
      expect(firstKey).to.be.a("string");

      const changed = testCase.change(projectFolder, tempBase) || {};
      const secondKey = ValidationReportCache.getCacheKey(
        changed.projectStart ?? projectStart,
        changed.options ?? firstOptions
      );

      expect(secondKey).to.be.a("string");

      if (testCase.expectKeyChanged) {
        expect(secondKey).to.not.equal(firstKey);
      } else {
        expect(secondKey).to.equal(firstKey);
      }
    });
  }

  it("key changes when a single-file project is replaced", () => {
    const zipPath = path.join(tempBase, "pack.mcaddon");
    writeFile(zipPath, "zip-1");
    setModifiedTime(zipPath, new Date(Date.now() - 60 * 60 * 1000));

    const projectStart: IProjectStartInfo = { ctorProjectName: "pack.mcaddon", localFilePath: zipPath };
    const firstKey = ValidationReportCache.getCacheKey(projectStart, baseOptions);

    fs.writeFileSync(zipPath, "zip-2");

    expect(firstKey).to.be.a("string");
    expect(ValidationReportCache.getCacheKey(projectStart, baseOptions)).to.not.equal(firstKey);
  });

  it("key changes when an accessory file changes", () => {
    const zipPath = path.join(tempBase, "pack.mcaddon");
    const dataPath = path.join(tempBase, "pack.data.json");
    writeFile(zipPath, "zip");
    writeFile(dataPath, "{}");

    const projectStart: IProjectStartInfo = {
      ctorProjectName: "pack.mcaddon",
      localFilePath: zipPath,
      accessoryFiles: [dataPath],
    };
    const firstKey = ValidationReportCache.getCacheKey(projectStart, baseOptions);

    fs.writeFileSync(dataPath, '{ "title": "x" }');

    expect(ValidationReportCache.getCacheKey(projectStart, baseOptions)).to.not.equal(firstKey);
  });

  it("returns no key when the project source is missing", () => {
    const projectStart: IProjectStartInfo = {
      ctorProjectName: "missing",
      localFolderPath: path.join(tempBase, "does-not-exist"),
    };

    expect(ValidationReportCache.getCacheKey(projectStart, baseOptions)).to.equal(undefined);
    expect(ValidationReportCache.getCacheKey({ ctorProjectName: "nopath" }, baseOptions)).to.equal(undefined);
  });

  const isReportCurrentCases: { cachedKey: unknown; currentKey: string | undefined; expected: boolean }[] = [
    { cachedKey: "abc", currentKey: "abc", expected: true },
    { cachedKey: "abc", currentKey: "def", expected: false },
    { cachedKey: undefined, currentKey: "abc", expected: false },
    { cachedKey: "abc", currentKey: undefined, expected: false },
    { cachedKey: undefined, currentKey: undefined, expected: false },
    { cachedKey: 123, currentKey: "123", expected: false },
  ];

  for (const testCase of isReportCurrentCases) {
    it(`isReportCurrent(${JSON.stringify(testCase.cachedKey)}, ${JSON.stringify(testCase.currentKey)}) is ${
      testCase.expected
    }`, () => {
      expect(ValidationReportCache.isReportCurrent(testCase.cachedKey, testCase.currentKey)).to.equal(
        testCase.expected
      );
    });
  }
});
