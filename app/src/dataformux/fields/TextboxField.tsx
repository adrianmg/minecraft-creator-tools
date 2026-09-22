/**
 * ========================================================================
 * ARCHITECTURE: TextboxField.tsx
 * ========================================================================
 *
 * TextboxField is a field renderer for text-based input fields.
 * It handles string, int, float, and number field types with optional
 * dropdown choices.
 *
 * FIELD TYPES HANDLED:
 *   - FieldDataType.string (2)
 *   - FieldDataType.int (0)
 *   - FieldDataType.float (1)
 *   - FieldDataType.number (21)
 *   - FieldDataType.stringLookup (15)
 *
 * FEATURES:
 *   - Text input for free-form values
 *   - Dropdown when choices are provided
 *   - Searchable dropdown for non-strict choice matching
 *   - Working value tracking for float inputs (preserves "3." while typing "3.5")
 *   - Consistent styling with theme support
 *
 * DROPDOWN VALUE VS. DISPLAY TEXT:
 *   The stored value is the choice id (e.g. 3 for an intValueLookup), but the
 *   input must show the choice title ("Painting"). Forcing the Autocomplete's
 *   inputValue to the raw stored value made numeric lookups display their ids.
 *   - mustMatchChoices: the input text is left uncontrolled so MUI derives it
 *     from the selected option and typing only filters the list; partial text
 *     is never persisted because it is not a valid value. A stored value that
 *     matches none of the choices (legacy content, choices still loading) is
 *     surfaced as a disabled synthetic option so the user can see it and clear
 *     or replace it instead of looking at a misleadingly empty field.
 *   - freeSolo: typed text is persisted as-is on every keystroke, and the parent
 *     re-renders with the parsed value right away. The text the user is typing
 *     is kept in local state (editingText) while the input is focused so a
 *     value that happens to equal a choice id (typing "1" on the way to "11")
 *     is not swapped for that choice's title mid-edit. Once the field loses
 *     focus, or a choice is picked, the committed value is displayed as the
 *     matching choice's title (or the raw value when nothing matches).
 *
 * CLEAR OWNERSHIP:
 *   MUI reports the clear indicator through both onInputChange (reason
 *   "clear") and onChange(null), but it skips onChange(null) when the
 *   Autocomplete value is already null, which is exactly the freeSolo state
 *   with unmatched typed text. Each mode therefore has a single owner:
 *   - freeSolo: onInputChange owns it (reason "clear", or "input" with empty
 *     text); onChange(null) is ignored.
 *   - mustMatchChoices: onChange(null) owns it; onInputChange is ignored.
 *   Clearing goes through props.onChange(undefined) so the property is unset.
 *   Routing it through onTextChange("") would persist an empty string for
 *   string lookups, which is not a valid choice either.
 *
 * RELATED FILES:
 *   - IFieldRendererProps.ts - Props interface
 *   - DataForm.tsx - Parent form component
 *   - FieldRendererRegistry.ts - Registry that maps types to renderers
 *   - FieldUtilities.ts - Title and description helpers
 *
 * ========================================================================
 */

import React, { ChangeEvent } from "react";
import { TextField, Autocomplete, Box, Button } from "@mui/material";
import { IFieldRendererProps, getCssClassName } from "./IFieldRendererProps";
import IField, { FieldDataType } from "../../dataform/IField";
import FieldUtilities from "../../dataform/FieldUtilities";
import { mcColors } from "../../UX/hooks/theme/mcColors";
import CreatorToolsHost, { CreatorToolsThemeStyle } from "../../app/CreatorToolsHost";

/**
 * Extended props for TextboxField that includes text change callback.
 */
export interface ITextboxFieldProps extends Omit<IFieldRendererProps<string | number>, "onTextChange" | "onChange"> {
  /**
   * Callback for committed value changes. Called with undefined when the user
   * clears the field so the parent unsets the property instead of storing "".
   */
  onChange: (newValue: string | number | undefined, field: IField) => void;

  /**
   * Callback for raw text changes (before type conversion).
   * Used for working value tracking in float/number fields.
   * Note: Different signature from base - takes fieldId instead of field.
   */
  onTextChange: (fieldId: string, newText: string) => void;

  /**
   * Callback for dropdown selection changes.
   * Called with the selected choice ID.
   */
  onDropdownChange: (fieldId: string, selectedId: string | number | boolean) => void;

  /**
   * Whether an "Add" button should be shown for this field's lookup.
   * Set by parent when lookupProvider.canAddItem() returns true.
   */
  showAddButton?: boolean;

  /**
   * Callback when the "Add" button is clicked.
   * Parent should invoke lookupProvider.addItem() and update choices.
   */
  onAddClick?: (fieldId: string, lookupId: string) => void;
}

/**
 * Renders a text input or dropdown field based on the field configuration.
 *
 * When choices are provided, renders as a searchable dropdown.
 * Otherwise, renders as a standard text input.
 */
export default function TextboxField(props: ITextboxFieldProps): JSX.Element {
  const {
    field,
    value,
    defaultValue,
    baseKey,
    theme,
    cssConfig,
    choices,
    workingValue,
    descriptionElements,
    sampleElements,
  } = props;

  const title = FieldUtilities.getFieldTitle(field);

  // Determine the string value to display
  let strVal = value !== undefined && value !== null ? String(value) : "";

  // Build CSS class - add fieldWrapNumber for numeric fields
  let cssClass = getCssClassName("fieldWrap", cssConfig);
  const isNumeric = field.dataType === FieldDataType.float || field.dataType === FieldDataType.number;

  // Add required but empty styling
  const isEmpty = value === undefined || value === null || value === "";
  if (field.isRequired && isEmpty) {
    cssClass += " " + getCssClassName("fieldWrapRequiredEmpty", cssConfig);
  }

  if (isNumeric) {
    cssClass += " " + getCssClassName("fieldWrapNumber", cssConfig);

    // For float/number fields, use working value if it represents the same numeric value
    // This preserves user input like "3." while typing "3.5"
    if (workingValue !== undefined && workingValue !== "") {
      // The parent should have already validated that workingValue parses to the same value
      strVal = workingValue;
    }
  }

  let interior: JSX.Element;
  let choiceDescriptionArea: JSX.Element = <></>;

  // Text the user is actively typing in a freeSolo dropdown. undefined means
  // "not editing": show the committed value (choice title or raw value).
  const [editingText, setEditingText] = React.useState<string | undefined>(undefined);

  // Determine if we should show a dropdown (has choices OR is a lookup with add support)
  const hasChoices = choices && choices.length > 0;
  const showAsDropdown = hasChoices || (field.lookupId && props.showAddButton);

  // Render dropdown if choices are provided or if it's a lookup with add support
  if (showAsDropdown) {
    interface IDropdownOption {
      label: string;
      id: string | number | boolean;
      description?: string;
      isUnmatched?: boolean;
    }

    const options: IDropdownOption[] = [];
    let selectedOption: IDropdownOption | null = null;

    if (choices) {
      for (let i = 0; i < choices.length; i++) {
        const choiceTitle = choices[i].title;
        const id = choices[i].id;
        const option: IDropdownOption = {
          label: choiceTitle ? choiceTitle : String(id),
          id: choices[i].id,
          description: choices[i].description,
        };
        options.push(option);

        if (strVal.toString() === id.toString()) {
          selectedOption = option;
        }

        // Show description for selected choice
        if (id === value && choices[i].description) {
          choiceDescriptionArea = <div>{choices[i].description}</div>;
        }
      }
    }

    const isFreeSolo = !field.mustMatchChoices;

    // A strict lookup whose stored value is not among the choices would otherwise
    // render empty (and without a clear button) while the property stays populated.
    if (!isFreeSolo && selectedOption === null && strVal !== "" && value !== undefined && value !== null) {
      const unmatchedOption: IDropdownOption = {
        label: strVal,
        id: value,
        description: "Not one of the available choices",
        isUnmatched: true,
      };
      options.push(unmatchedOption);
      selectedOption = unmatchedOption;
      choiceDescriptionArea = <div>{unmatchedOption.description}</div>;
    }

    const clearValue = () => {
      props.onChange(undefined, field);
    };

    const handleDropdownChange = (event: React.SyntheticEvent, newValue: IDropdownOption | string | null) => {
      if (newValue && typeof newValue === "object" && newValue.id !== undefined) {
        setEditingText(undefined);
        props.onDropdownChange(field.id, newValue.id);
      } else if (typeof newValue === "string") {
        // freeSolo: Enter pressed on typed text.
        setEditingText(undefined);
        props.onDropdownChange(field.id, newValue);
      } else if (newValue === null && !isFreeSolo) {
        clearValue();
      }
    };

    const handleInputChange = (event: React.SyntheticEvent, newInputValue: string, reason: string) => {
      if (!isFreeSolo) {
        // Typed text only filters the list; selection changes arrive via onChange.
        return;
      }

      if (reason === "clear" || (reason === "input" && newInputValue === "")) {
        setEditingText("");
        clearValue();
      } else if (reason === "input") {
        setEditingText(newInputValue);
        props.onTextChange(field.id, newInputValue);
      }
    };

    const handleBlur = () => {
      setEditingText(undefined);
    };

    // freeSolo: controlled input text. While editing, show exactly what was typed;
    // otherwise the matching choice's title, else the raw value.
    // mustMatchChoices: MUI owns the input text so it always reflects the selected option.
    let inputValueProps = {};

    if (isFreeSolo) {
      let inputValue = strVal;

      if (editingText !== undefined) {
        inputValue = editingText;
      } else if (selectedOption) {
        inputValue = selectedOption.label;
      }

      inputValueProps = { inputValue };
    }

    interior = (
      <Autocomplete
        freeSolo={isFreeSolo}
        options={options}
        value={selectedOption}
        {...inputValueProps}
        onChange={handleDropdownChange}
        onInputChange={handleInputChange}
        onBlur={handleBlur}
        getOptionLabel={(option) => (typeof option === "string" ? option : option.label)}
        getOptionDisabled={(option) => option.isUnmatched === true}
        isOptionEqualToValue={(option, value) => option.id === value.id}
        size="small"
        fullWidth
        renderInput={(params) => <TextField {...params} label={title} variant="outlined" />}
        renderOption={(props, option) => (
          <Box component="li" {...props} key={String(option.id)}>
            <div>
              <div>{option.label}</div>
              {option.description && <div style={{ fontSize: "0.8em", opacity: 0.7 }}>{option.description}</div>}
            </div>
          </Box>
        )}
      />
    );

    // Add "Add" button if the lookup supports adding
    if (props.showAddButton && props.onAddClick && field.lookupId) {
      interior = (
        <div className={getCssClassName("fieldWithAddButtonWrapper", cssConfig)}>
          <label className={getCssClassName("fieldAddButtonLabel", cssConfig)}>{title}</label>
          <div className={getCssClassName("fieldWithAddButton", cssConfig)}>
            <Autocomplete
              freeSolo={isFreeSolo}
              options={options}
              value={selectedOption}
              {...inputValueProps}
              onChange={handleDropdownChange}
              onInputChange={handleInputChange}
              onBlur={handleBlur}
              getOptionLabel={(option) => (typeof option === "string" ? option : option.label)}
              getOptionDisabled={(option) => option.isUnmatched === true}
              isOptionEqualToValue={(option, value) => option.id === value.id}
              size="small"
              fullWidth
              renderInput={(params) => <TextField {...params} variant="outlined" />}
            />
            <Button
              variant="outlined"
              size="small"
              onClick={() => props.onAddClick!(field.id, field.lookupId!)}
              title={`Add new ${field.lookupId}`}
              sx={{ ml: 1, whiteSpace: "nowrap" }}
            >
              + Add
            </Button>
          </div>
        </div>
      );
    }
  } else {
    // Render text input
    const handleInputChange = (event: ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => {
      props.onTextChange(field.id, event.target.value);
    };

    interior = (
      <TextField
        label={title}
        key={"fri" + baseKey}
        id={field.id}
        value={strVal}
        onChange={handleInputChange}
        size="small"
        fullWidth
        variant="outlined"
      />
    );
  }

  const isDark = CreatorToolsHost.theme === CreatorToolsThemeStyle.dark;

  return (
    <div
      className={cssClass}
      key={"fz" + baseKey}
      style={{
        borderTopColor: isDark ? mcColors.gray5 : mcColors.gray2,
        borderBottomColor: isDark ? mcColors.gray4 : mcColors.gray3,
      }}
    >
      {interior}
      {choiceDescriptionArea}
      {descriptionElements}
      {sampleElements}
    </div>
  );
}
