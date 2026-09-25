// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import IFile from "../storage/IFile";
import { EventDispatcher, IEventHandler } from "ste-events";

import LocToken from "./LocToken";
import StorageUtilities from "../storage/StorageUtilities";
import ZipStorage from "../storage/ZipStorage";
import Utilities from "../core/Utilities";

export default class Lang {
  private _file?: IFile;
  private _containerName?: string;
  private _language?: string;
  private _isLoaded: boolean = false;

  public tokens: { [name: string]: LocToken } = {};

  private _onLoaded = new EventDispatcher<Lang, Lang>();

  public get isLoaded() {
    return this._isLoaded;
  }

  public get file() {
    return this._file;
  }

  public set file(newFile: IFile | undefined) {
    this._file = newFile;
  }

  public get onLoaded() {
    return this._onLoaded.asEvent();
  }

  public get containerName() {
    return this._containerName;
  }

  public get language() {
    return this._language;
  }

  public getLocKeys(): string[] {
    return Object.keys(this.tokens);
  }

  /**
   * Parses the `key=value` lines of a .lang file into a key → value map. Comment-only
   * lines are skipped; trailing `#` comments are removed from values.
   */
  static parseEntries(content: string): Map<string, string> {
    const entries = new Map<string, string>();

    for (let line of content.replace(/^\uFEFF/, "").split(/\r?\n/)) {
      line = line.trim();

      if (line.length === 0 || line.startsWith("#")) {
        continue;
      }

      const equalsIndex = line.indexOf("=");

      if (equalsIndex > 0) {
        const key = line.substring(0, equalsIndex).trim();
        let value = line.substring(equalsIndex + 1);
        const hashIndex = value.indexOf("#");

        if (hashIndex >= 0) {
          value = value.substring(0, hashIndex);
        }

        if (!entries.has(key)) {
          entries.set(key, value.trim());
        }
      }
    }

    return entries;
  }

  /**
   * Appends any of `entries` whose key isn't already defined to the text of a .lang file.
   * Existing lines are left byte-for-byte unchanged, so existing keys keep their values;
   * keys that exist with a different value are reported in `kept`.
   */
  static appendMissingEntries(
    existingContent: string | undefined,
    entries: { key: string; value: string }[]
  ): { content: string; added: string[]; kept: { key: string; existingValue: string; newValue: string }[] } {
    const content = existingContent ?? "";
    const existing = Lang.parseEntries(content);
    const newline = content.includes("\r\n") ? "\r\n" : "\n";
    const added: string[] = [];
    const kept: { key: string; existingValue: string; newValue: string }[] = [];
    const linesToAdd: string[] = [];

    for (const entry of entries) {
      const key = entry.key.trim();
      const value = entry.value.replace(/[\r\n]+/g, " ").trim();

      if (key.length === 0 || added.includes(key)) {
        continue;
      }

      const existingValue = existing.get(key);

      if (existingValue !== undefined) {
        if (existingValue !== value) {
          kept.push({ key, existingValue, newValue: value });
        }
        continue;
      }

      added.push(key);
      linesToAdd.push(`${key}=${value}`);
    }

    if (linesToAdd.length === 0) {
      return { content, added, kept };
    }

    let prefix = content;

    if (prefix.length > 0 && !prefix.endsWith("\n")) {
      prefix += newline;
    }

    return { content: prefix + linesToAdd.join(newline) + newline, added, kept };
  }

  /**
   * Returns updated texts/languages.json content that includes `language`, or undefined when
   * no change is needed (or the existing content isn't a JSON array we can safely extend).
   */
  static addLanguageToLanguagesJson(existingContent: string | undefined, language: string): string | undefined {
    if (existingContent === undefined || existingContent.trim().length === 0) {
      return JSON.stringify([language], null, 2);
    }

    try {
      const languages = JSON.parse(existingContent.replace(/^\uFEFF/, ""));

      if (!Array.isArray(languages) || languages.includes(language)) {
        return undefined;
      }

      return JSON.stringify([...languages, language], null, 2);
    } catch {
      return undefined;
    }
  }

  static async ensureOnFile(file: IFile, loadHandler?: IEventHandler<Lang, Lang>) {
    let lang: Lang | undefined;

    if (file.manager === undefined) {
      lang = new Lang();

      lang.file = file;

      file.manager = lang;
    }

    if (file.manager !== undefined && file.manager instanceof Lang) {
      lang = file.manager as Lang;

      if (!lang.isLoaded) {
        if (loadHandler) {
          lang.onLoaded.subscribe(loadHandler);
        }

        await lang.load();
      }
    }

    return lang;
  }

  persist(): boolean {
    if (this._file === undefined) {
      return false;
    }

    let content = this._file.content;

    if (content === undefined || content === null || content instanceof Uint8Array) {
      content = "";
    }

    for (const tokName in this.tokens) {
      const tok = this.tokens[tokName];

      if (tok && tok.isModified) {
        const tokStart: number = content.indexOf(tokName + "=");

        if (tokStart >= 0) {
          const tokEndR = content.indexOf("\r", tokStart + tokName.length + 1);
          let tokEnd = content.indexOf("\n", tokStart + tokName.length + 1);

          if (tokEndR > tokStart && tokEndR === tokEnd - 1) {
            tokEnd = tokEndR;
          }

          if (tokEnd < 0) {
            tokEnd = content.length;
          }

          content = content.substring(0, tokStart + tokName.length + 1) + tok.value + content.substring(tokEnd);
        } else {
          // Try to insert a new token into areas that are similarly named.
          const periodInName = tokName.lastIndexOf(".");
          let wasInserted = false;

          if (periodInName >= 0) {
            const findSimilar: number = content.lastIndexOf("\n" + tokName.substring(0, periodInName + 1));

            if (findSimilar >= 0) {
              content =
                content.substring(0, findSimilar + 1) +
                tokName +
                "=" +
                tok.value +
                "\n" +
                content.substring(findSimilar + 1);
              wasInserted = true;
            }
          }

          if (!wasInserted) {
            content += "\n" + tokName + "=" + tok.value;
          }
        }

        tok.isModified = false;
      }
    }

    return this._file.setContent(content);
  }

  async save() {
    if (this._file === undefined) {
      return;
    }

    if (this.persist()) {
      await this._file.saveContent(false);
    }
  }

  async load() {
    if (this._file === undefined || this._isLoaded) {
      return;
    }

    if (!this._file.isContentLoaded) {
      await this._file.loadContent();
    }

    if (this._file.content === null || this._file.content instanceof Uint8Array) {
      this._isLoaded = true;
      this._onLoaded.dispatch(this, this);
      return;
    }

    const content = this._file.content;

    this._language = StorageUtilities.getBaseFromName(this._file.name);
    let dir = this._file.parentFolder;

    if (dir) {
      if (dir.name === "texts" && dir.parentFolder) {
        dir = dir.parentFolder;
      }

      if (dir.name === "" && !dir.parentFolder && (dir.storage as ZipStorage).name) {
        this._containerName = (dir.storage as ZipStorage).name;
      } else {
        this._containerName = dir.name;
      }
    }

    const lines = content.split("\n");

    for (let line of lines) {
      line = line.trim();
      const lastEqual = line.indexOf("=");

      if (lastEqual > 0 && lastEqual < line.length - 1) {
        const tokenName = line.substring(0, lastEqual);
        let tokenVal = line.substring(lastEqual + 1);

        let comment = undefined;
        let lastHash = tokenVal.indexOf("#");

        if (lastHash >= 0) {
          comment = tokenVal.substring(lastHash + 1);
          tokenVal = tokenVal.substring(0, lastHash).trim();
        }

        if (Utilities.isUsableAsObjectKey(tokenName)) {
          this.tokens[tokenName] = {
            value: tokenVal,
            comment: comment,
            isModified: false,
          };
        }
      }
    }

    this._isLoaded = true;
    this._onLoaded.dispatch(this, this);
  }
}
