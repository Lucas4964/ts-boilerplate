import type { Simulator } from "../core/Simulator";
import { SimElement } from "../elements/SimElement";
import { parseUnit, formatForEdit } from "../util/format";

// A real modal property editor (replaces the old window.prompt loop). It reads
// the element's getEditInfo() descriptors into labelled text fields, applies
// changes live as you type, and commits on OK / reverts on Cancel. This is the
// boilerplate's analog of CircuitJS's EditDialog.
//
// Fields may be read-only (EditInfo.disabled — shown but never written, e.g. an
// AC source's frequency in phasor mode) or carry a unit combobox
// (EditInfo.unitChoices — e.g. an inductor entered as Ω or H in phasor mode).
export class EditDialog {
  private static current: EditDialog | null = null;

  static open(sim: Simulator, el: SimElement): void {
    EditDialog.current?.cancel();
    // Make the element's mode-aware getEditInfo() see the current analysis mode
    // and frequency, then let it reset any transient edit-UI state (unit combos).
    SimElement.analysisMode = sim.sim.analysisMode;
    SimElement.analysisFrequency = sim.sim.analysisFrequency;
    el.beginEdit();

    const fields: number[] = [];
    for (let i = 0; el.getEditInfo(i) !== null; i++) fields.push(i);
    if (fields.length === 0) return; // nothing editable
    EditDialog.current = new EditDialog(sim, el, fields);
  }

  private overlay: HTMLDivElement;
  private rows: {
    index: number;
    input?: HTMLInputElement; // absent for pure-choice fields
    disabled: boolean;
    hasUnits: boolean;
    isChoice: boolean;
  }[] = [];
  private readonly original: { value: number; unit: number; choice: number }[];
  private readonly keyHandler: (e: KeyboardEvent) => void;

  private constructor(
    private sim: Simulator,
    private el: SimElement,
    fields: number[],
  ) {
    sim.commands.pushUndo();
    this.original = fields.map((i) => {
      const info = el.getEditInfo(i)!;
      return { value: info.value, unit: info.unitChoiceIndex, choice: info.choiceIndex };
    });

    this.overlay = document.createElement("div");
    this.overlay.className = "dialog-overlay";

    const box = document.createElement("div");
    box.className = "dialog";

    const title = document.createElement("h2");
    title.textContent = "Edit " + el.getType();
    box.appendChild(title);

    for (const index of fields) {
      const info = el.getEditInfo(index)!;
      const row = document.createElement("div");
      row.className = "field";

      const label = document.createElement("label");
      label.textContent = info.name;

      // Pure-choice field: a combobox only, no numeric input.
      if (info.choices !== undefined && info.choices.length > 0) {
        const select = document.createElement("select");
        info.choices.forEach((c, i) => {
          const opt = document.createElement("option");
          opt.value = String(i);
          opt.textContent = c;
          if (i === info.choiceIndex) opt.selected = true;
          select.appendChild(opt);
        });
        select.addEventListener("change", () => this.changeChoice(index, Number(select.value)));
        row.append(label, select);
        box.appendChild(row);
        this.rows.push({ index, disabled: false, hasUnits: false, isChoice: true });
        continue;
      }

      const input = document.createElement("input");
      input.type = "text";
      // Precise fields keep every digit (no rounding); others use a tidy
      // engineering-notation string that still round-trips through parseUnit.
      input.value = info.precise ? String(info.value) : formatForEdit(info.value);
      input.disabled = info.disabled;
      if (!info.disabled) input.addEventListener("input", () => this.applyLive());
      row.append(label, input);

      const hasUnits = info.unitChoices !== undefined && info.unitChoices.length > 0;
      if (hasUnits) {
        const select = document.createElement("select");
        info.unitChoices!.forEach((u, i) => {
          const opt = document.createElement("option");
          opt.value = String(i);
          opt.textContent = u;
          if (i === info.unitChoiceIndex) opt.selected = true;
          select.appendChild(opt);
        });
        select.addEventListener("change", () => this.changeUnit(index, input, Number(select.value)));
        row.appendChild(select);
      }

      box.appendChild(row);
      this.rows.push({ index, input, disabled: info.disabled, hasUnits, isChoice: false });
    }

    const buttons = document.createElement("div");
    buttons.className = "buttons";
    const cancel = document.createElement("button");
    cancel.textContent = "Cancel";
    cancel.addEventListener("click", () => this.cancel());
    const ok = document.createElement("button");
    ok.textContent = "OK";
    ok.className = "active";
    ok.addEventListener("click", () => this.commit());
    buttons.append(cancel, ok);
    box.appendChild(buttons);

    this.overlay.appendChild(box);
    this.overlay.addEventListener("pointerdown", (e) => {
      if (e.target === this.overlay) this.cancel();
    });
    document.body.appendChild(this.overlay);

    const first = this.rows.find((r) => r.input && !r.disabled)?.input;
    first?.focus();
    first?.select();

    this.keyHandler = (e: KeyboardEvent): void => {
      if (e.key === "Enter") {
        this.commit();
        e.preventDefault();
      } else if (e.key === "Escape") {
        this.cancel();
        e.preventDefault();
      }
    };
    window.addEventListener("keydown", this.keyHandler, true);
  }

  /** Push current (editable) field values into the element so the canvas updates live. */
  private applyLive(): void {
    for (const { index, input, disabled } of this.rows) {
      if (disabled || !input) continue; // read-only / pure-choice: nothing to write
      const v = parseUnit(input.value);
      if (!Number.isNaN(v)) this.el.setEditValue(index, v);
    }
    this.sim.needAnalyze();
  }

  /** Pick a pure-choice option; may change topology, so re-analyze. */
  private changeChoice(index: number, choiceIndex: number): void {
    this.el.setEditChoice(index, choiceIndex);
    this.sim.needAnalyze();
  }

  /** Switch a field's unit: commit the current value in the old unit (so it
   *  converts to the stored physical value), then re-read it in the new unit. */
  private changeUnit(index: number, input: HTMLInputElement, choiceIndex: number): void {
    const v = parseUnit(input.value);
    if (!Number.isNaN(v)) this.el.setEditValue(index, v);
    this.el.setEditUnit(index, choiceIndex);
    const info = this.el.getEditInfo(index);
    if (info) input.value = formatForEdit(info.value);
    this.sim.needAnalyze();
  }

  private commit(): void {
    this.applyLive();
    this.close();
  }

  private cancel(): void {
    // Restore each field's original unit BEFORE its value, so a value captured
    // in Ω isn't reinterpreted as H/F (which would corrupt the physical value).
    for (let i = 0; i < this.rows.length; i++) {
      const row = this.rows[i];
      if (row.isChoice) {
        this.el.setEditChoice(row.index, this.original[i].choice);
        continue;
      }
      if (row.disabled) continue;
      if (row.hasUnits) this.el.setEditUnit(row.index, this.original[i].unit);
      this.el.setEditValue(row.index, this.original[i].value);
    }
    this.sim.needAnalyze();
    this.close();
  }

  private close(): void {
    window.removeEventListener("keydown", this.keyHandler, true);
    this.overlay.remove();
    if (EditDialog.current === this) EditDialog.current = null;
  }
}
