// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { expect } from "chai";
import { installDomGlobals, restoreDomGlobals, domWindow } from "./textboxFieldSpecSetup";
import React from "react";
import { createRoot, Root } from "react-dom/client";
import TextboxField, { ITextboxFieldProps } from "./TextboxField";
import IField, { FieldDataType } from "../../dataform/IField";
import ISimpleReference from "../../dataform/ISimpleReference";
import IProjectTheme from "../../UX/types/IProjectTheme";
import FormPropertyManager from "../../dataform/FormPropertyManager";

// The shim installs jsdom globals at import time so react-dom and MUI load with
// a DOM present; drop them again until the hooks below re-install them.
restoreDomGlobals();

// Regression coverage for lookup dropdowns rendered by TextboxField (e.g. the
// Image Editor properties form, Outputs > Type: an intValueLookup with
// mustMatchChoices). Two bugs were reported against that dropdown:
//   1. After picking "Painting" the input showed "3" (the stored choice id)
//      because the Autocomplete's inputValue was forced to the raw value.
//   2. The clear (X) indicator did nothing, because the Autocomplete onChange
//      handler ignored the null it reports; users had to Backspace instead.
// The "live" harness below additionally emulates DataForm: every change is run
// through FormPropertyManager and the field is re-rendered with the stored
// value, the way it happens in production on each keystroke.

// @types/react 18.3.0 does not yet declare React.act even though react 18.3.1 ships it.
const act: (callback: () => void) => void = (React as any).act;

const OUTPUT_TYPE_CHOICES: ISimpleReference[] = [
  { id: 1, title: "Block Texture" },
  { id: 2, title: "Item Texture" },
  { id: 3, title: "Painting" },
  { id: 11, title: "Block Billboard 3x3" },
];

const PAINTING_CHOICES: ISimpleReference[] = [
  { id: "backyard", title: "Backyard" },
  { id: "baroque", title: "Baroque" },
];

function outputTypeField(overrides: Partial<IField> = {}): IField {
  return {
    id: "type",
    title: "Type",
    dataType: FieldDataType.intValueLookup,
    mustMatchChoices: true,
    choices: OUTPUT_TYPE_CHOICES,
    ...overrides,
  };
}

interface IHarness {
  textChanges: { fieldId: string; text: string }[];
  dropdownChanges: { fieldId: string; selectedId: string | number | boolean }[];
  valueChanges: { fieldId: string; value: string | number | undefined }[];
  render(field: IField, value: string | number | undefined): void;
  /**
   * Renders the field bound to a FormPropertyManager-backed object, so each
   * callback stores the value the way DataForm does and re-renders the field
   * with whatever was stored.
   */
  renderLive(field: IField, value: string | number | undefined): { [name: string]: any };
  input(): HTMLInputElement;
  clearButton(): HTMLButtonElement | null;
  typeText(text: string): void;
  clickClear(): void;
  focus(): void;
  blur(): void;
  unmount(): void;
}

function createHarness(): IHarness {
  const container = domWindow.document.createElement("div");
  domWindow.document.body.appendChild(container);

  const root: Root = createRoot(container);
  const textChanges: IHarness["textChanges"] = [];
  const dropdownChanges: IHarness["dropdownChanges"] = [];
  const valueChanges: IHarness["valueChanges"] = [];

  function baseProps(field: IField, value: string | number | undefined): ITextboxFieldProps {
    return {
      field,
      value,
      defaultValue: undefined,
      baseKey: "spec." + field.id,
      theme: {} as IProjectTheme,
      readOnly: false,
      cssConfig: { displayNarrow: false },
      choices: field.choices,
      onChange: (newValue: string | number | undefined, f: IField) => {
        valueChanges.push({ fieldId: f.id, value: newValue });
      },
      onTextChange: (fieldId: string, text: string) => {
        textChanges.push({ fieldId, text });
      },
      onDropdownChange: (fieldId: string, selectedId: string | number | boolean) => {
        dropdownChanges.push({ fieldId, selectedId });
      },
    };
  }

  const harness: IHarness = {
    textChanges,
    dropdownChanges,
    valueChanges,
    render(field: IField, value: string | number | undefined) {
      act(() => {
        root.render(React.createElement(TextboxField, baseProps(field, value)));
      });
    },
    renderLive(field: IField, value: string | number | undefined) {
      const manager = new FormPropertyManager({ id: "spec", fields: [field] });
      const directObject: { [name: string]: any } = {};

      if (value !== undefined) {
        directObject[field.id] = value;
      }

      const rerender = () => {
        const props = baseProps(field, directObject[field.id]);
        const recording = { onChange: props.onChange, onTextChange: props.onTextChange };

        // Mirror DataForm: onTextChange/onDropdownChange go through
        // processInputUpdate (string -> typed value), onChange sets the value as-is.
        props.onTextChange = (fieldId: string, text: string) => {
          recording.onTextChange(fieldId, text);
          manager.processInputUpdate(fieldId, text, directObject);
          rerender();
        };
        props.onDropdownChange = (fieldId: string, selectedId: string | number | boolean) => {
          dropdownChanges.push({ fieldId, selectedId });
          manager.processInputUpdate(fieldId, String(selectedId), directObject);
          rerender();
        };
        props.onChange = (newValue: string | number | undefined, f: IField) => {
          recording.onChange(newValue, f);
          manager.setPropertyValue(f.id, newValue, directObject);
          rerender();
        };

        act(() => {
          root.render(React.createElement(TextboxField, props));
        });
      };

      rerender();

      return directObject;
    },
    input() {
      const input = container.querySelector("input");
      expect(input, "autocomplete input").to.not.equal(null);
      return input as HTMLInputElement;
    },
    clearButton() {
      return container.querySelector(".MuiAutocomplete-clearIndicator") as HTMLButtonElement | null;
    },
    typeText(text: string) {
      // Drive React's controlled-input plumbing the way a real keystroke does:
      // set the native value, then dispatch a bubbling input event.
      const input = harness.input();
      const valueSetter = Object.getOwnPropertyDescriptor(domWindow.HTMLInputElement.prototype, "value")!.set!;

      act(() => {
        valueSetter.call(input, text);
        input.dispatchEvent(new domWindow.Event("input", { bubbles: true }));
      });
    },
    clickClear() {
      const clearButton = harness.clearButton();
      expect(clearButton, "clear indicator").to.not.equal(null);

      act(() => {
        clearButton!.click();
      });
    },
    focus() {
      act(() => {
        harness.input().focus();
      });
    },
    blur() {
      act(() => {
        harness.input().blur();
      });
    },
    unmount() {
      act(() => {
        root.unmount();
      });
      container.remove();
    },
  };

  return harness;
}

describe("TextboxField lookup dropdown", () => {
  let harness: IHarness;

  before(() => {
    installDomGlobals();
  });

  after(() => {
    restoreDomGlobals();
  });

  beforeEach(() => {
    harness = createHarness();
  });

  afterEach(() => {
    harness.unmount();
  });

  it("shows the selected choice title instead of its numeric id", () => {
    harness.render(outputTypeField(), 3);

    expect(harness.input().value).to.equal("Painting");
  });

  it("shows the selected choice title for string lookups", () => {
    harness.render(
      outputTypeField({
        id: "paintingOverrideName",
        dataType: FieldDataType.stringLookup,
        choices: PAINTING_CHOICES,
      }),
      "baroque"
    );

    expect(harness.input().value).to.equal("Baroque");
  });

  it("shows the choice title in freeSolo mode too", () => {
    harness.render(outputTypeField({ mustMatchChoices: false }), 11);

    expect(harness.input().value).to.equal("Block Billboard 3x3");
  });

  it("renders an empty input when no choice is selected", () => {
    harness.render(outputTypeField(), undefined);

    expect(harness.input().value).to.equal("");
    expect(harness.clearButton()).to.equal(null);
  });

  it("follows the stored value when it changes externally", () => {
    const field = outputTypeField();

    harness.render(field, 1);
    expect(harness.input().value).to.equal("Block Texture");

    harness.render(field, 2);
    expect(harness.input().value).to.equal("Item Texture");
  });

  it("unsets the value when the clear indicator is clicked", () => {
    harness.render(outputTypeField(), 3);

    harness.clickClear();

    expect(harness.valueChanges).to.deep.equal([{ fieldId: "type", value: undefined }]);
    expect(harness.textChanges).to.deep.equal([]);
    expect(harness.dropdownChanges).to.deep.equal([]);
  });

  it("clears the visible text once the parent drops the value", () => {
    const field = outputTypeField();

    harness.render(field, 3);
    harness.clickClear();

    harness.render(field, undefined);
    expect(harness.input().value).to.equal("");
  });

  it("does not persist partial text while filtering a mustMatchChoices dropdown", () => {
    harness.render(outputTypeField(), 3);

    harness.typeText("Pai");

    expect(harness.textChanges).to.deep.equal([]);
    expect(harness.dropdownChanges).to.deep.equal([]);
    expect(harness.valueChanges).to.deep.equal([]);
  });

  it("persists typed text in freeSolo mode", () => {
    harness.render(
      outputTypeField({ id: "name", dataType: FieldDataType.stringLookup, mustMatchChoices: false }),
      undefined
    );

    harness.typeText("my_block");

    expect(harness.textChanges).to.deep.equal([{ fieldId: "name", text: "my_block" }]);
  });

  describe("freeSolo editing through a parent that re-renders on every keystroke", () => {
    it("keeps the typed text when it is a prefix of another choice id", () => {
      const field = outputTypeField({ mustMatchChoices: false });
      const stored = harness.renderLive(field, undefined);

      harness.focus();
      harness.typeText("1");

      // "1" is choice id 1 ("Block Texture") and the parent has already stored it,
      // but the user is still typing and must keep seeing what they typed.
      expect(stored.type).to.equal(1);
      expect(harness.input().value).to.equal("1");

      harness.typeText("11");

      expect(stored.type).to.equal(11);
      expect(harness.input().value).to.equal("11");
      expect(harness.textChanges.map((c) => c.text)).to.deep.equal(["1", "11"]);
    });

    it("shows the committed choice title once editing ends", () => {
      const field = outputTypeField({ mustMatchChoices: false });
      harness.renderLive(field, undefined);

      harness.focus();
      harness.typeText("11");
      expect(harness.input().value).to.equal("11");

      harness.blur();

      expect(harness.input().value).to.equal("Block Billboard 3x3");
    });

    it("keeps raw text that matches no choice after editing ends", () => {
      const field = outputTypeField({ mustMatchChoices: false });
      const stored = harness.renderLive(field, undefined);

      harness.focus();
      harness.typeText("42");
      harness.blur();

      expect(stored.type).to.equal(42);
      expect(harness.input().value).to.equal("42");
    });
  });

  describe("clear ownership", () => {
    it("clears unmatched freeSolo text from the clear indicator", () => {
      const field = outputTypeField({ id: "name", dataType: FieldDataType.stringLookup, mustMatchChoices: false });
      const stored = harness.renderLive(field, "not_a_choice");

      // Nothing matches, so the Autocomplete value is null and MUI only reports
      // the clear through onInputChange.
      expect(harness.input().value).to.equal("not_a_choice");

      harness.clickClear();

      expect(harness.valueChanges).to.deep.equal([{ fieldId: "name", value: undefined }]);
      expect(stored.name).to.equal(undefined);
      expect(harness.input().value).to.equal("");
    });

    it("clears a matched freeSolo value exactly once", () => {
      const field = outputTypeField({ mustMatchChoices: false });
      const stored = harness.renderLive(field, 3);

      harness.clickClear();

      expect(harness.valueChanges).to.deep.equal([{ fieldId: "type", value: undefined }]);
      expect(harness.textChanges).to.deep.equal([]);
      expect(stored.type).to.equal(undefined);
      expect(harness.input().value).to.equal("");
    });

    it("unsets a strict string lookup instead of storing an empty string", () => {
      const field = outputTypeField({
        id: "paintingOverrideName",
        dataType: FieldDataType.stringLookup,
        choices: PAINTING_CHOICES,
      });
      const stored = harness.renderLive(field, "baroque");

      harness.clickClear();

      expect(harness.textChanges).to.deep.equal([]);
      expect(harness.valueChanges).to.deep.equal([{ fieldId: "paintingOverrideName", value: undefined }]);
      expect(stored.paintingOverrideName).to.equal(undefined);
      expect("paintingOverrideName" in stored ? stored.paintingOverrideName : undefined).to.not.equal("");
    });

    it("unsets a freeSolo value when all text is deleted", () => {
      const field = outputTypeField({ id: "name", dataType: FieldDataType.stringLookup, mustMatchChoices: false });
      const stored = harness.renderLive(field, "backyard");

      harness.focus();
      harness.typeText("");

      expect(harness.valueChanges).to.deep.equal([{ fieldId: "name", value: undefined }]);
      expect(harness.textChanges).to.deep.equal([]);
      expect(stored.name).to.equal(undefined);
    });
  });

  describe("strict lookup with a stored value that matches no choice", () => {
    it("shows the raw value instead of an empty field", () => {
      harness.render(outputTypeField(), 99);

      expect(harness.input().value).to.equal("99");
      expect(harness.clearButton(), "clear indicator").to.not.equal(null);
    });

    it("can be cleared", () => {
      const field = outputTypeField();
      const stored = harness.renderLive(field, 99);

      harness.clickClear();

      expect(stored.type).to.equal(undefined);
      expect(harness.input().value).to.equal("");
    });

    it("shows the string value of a legacy string lookup", () => {
      harness.render(
        outputTypeField({
          id: "paintingOverrideName",
          dataType: FieldDataType.stringLookup,
          choices: PAINTING_CHOICES,
        }),
        "removed_painting"
      );

      expect(harness.input().value).to.equal("removed_painting");
    });
  });
});
