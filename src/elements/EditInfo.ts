// Descriptor for one editable property of an element. Mirrors EditInfo.java but
// trimmed to the numeric case used by the starter elements. getEditInfo()/
// setEditValue() on SimElement form the editing contract; the UI iterates
// getEditInfo(0), getEditInfo(1), ... until it returns null.
export class EditInfo {
  name: string;
  value: number;

  /** Render the field read-only (shown but not editable, e.g. a value driven by
   *  a global setting). Disabled fields are never written back on commit. */
  disabled = false;

  /** When set, the field renders with a unit combobox offering these choices.
   *  The element converts between units in getEditInfo/setEditValue; the
   *  selected index is reported via {@link unitChoiceIndex}. */
  unitChoices?: string[];
  unitChoiceIndex = 0;

  /** When set, the field is a *pure choice* (combobox only, no numeric input):
   *  the user picks one of these labels and the element reacts via
   *  setEditChoice(n, index). Used for discrete topology options like a
   *  transformer's vector group. The selected index is {@link choiceIndex}. */
  choices?: string[];
  choiceIndex = 0;

  /** Render the value at full precision (no rounding/engineering-suffix), so a
   *  highly sensitive parameter like a coupling coefficient keeps every digit the
   *  user typed (e.g. 0.9999999 must not collapse to 1). */
  precise = false;

  constructor(name: string, value: number) {
    this.name = name;
    this.value = value;
  }

  /** Build a pure-choice descriptor (combobox only). `value` is unused. */
  static choice(name: string, options: string[], selected: number): EditInfo {
    const ei = new EditInfo(name, 0);
    ei.choices = options;
    ei.choiceIndex = selected;
    return ei;
  }

  /** Build a full-precision numeric field (no rounding on display). */
  static precise(name: string, value: number): EditInfo {
    const ei = new EditInfo(name, value);
    ei.precise = true;
    return ei;
  }
}
