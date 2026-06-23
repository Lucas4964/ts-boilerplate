import type { Simulator } from "../core/Simulator";
import type { SimElement } from "../elements/SimElement";
import { parseUnit, formatForEdit } from "../util/format";

// A real modal property editor (replaces the old window.prompt loop). It reads
// the element's getEditInfo() descriptors into labelled text fields, applies
// changes live as you type, and commits on OK / reverts on Cancel. This is the
// boilerplate's analog of CircuitJS's EditDialog.
export class EditDialog {
  private static current: EditDialog | null = null;

  static open(sim: Simulator, el: SimElement): void {
    EditDialog.current?.cancel();
    const fields: number[] = [];
    for (let i = 0; el.getEditInfo(i) !== null; i++) fields.push(i);
    if (fields.length === 0) return; // nothing editable
    EditDialog.current = new EditDialog(sim, el, fields);
  }

  private overlay: HTMLDivElement;
  private inputs: { index: number; input: HTMLInputElement }[] = [];
  private readonly original: number[];
  private readonly keyHandler: (e: KeyboardEvent) => void;

  private constructor(
    private sim: Simulator,
    private el: SimElement,
    fields: number[],
  ) {
    sim.commands.pushUndo();
    this.original = fields.map((i) => el.getEditInfo(i)!.value);

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
      const input = document.createElement("input");
      input.type = "text";
      input.value = formatForEdit(info.value);
      input.addEventListener("input", () => this.applyLive());
      row.append(label, input);
      box.appendChild(row);
      this.inputs.push({ index, input });
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

    const first = this.inputs[0]?.input;
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

  /** Push current field values into the element so the canvas updates live. */
  private applyLive(): void {
    for (const { index, input } of this.inputs) {
      const v = parseUnit(input.value);
      if (!Number.isNaN(v)) this.el.setEditValue(index, v);
    }
    this.sim.needAnalyze();
  }

  private commit(): void {
    this.applyLive();
    this.close();
  }

  private cancel(): void {
    // restore original values
    for (let i = 0; i < this.inputs.length; i++) {
      this.el.setEditValue(this.inputs[i].index, this.original[i]);
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
