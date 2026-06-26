import type { Simulator } from "../core/Simulator";
import { ElementRegistry } from "../elements/ElementRegistry";

// Builds the toolbar DOM and keeps button state in sync. Equivalent in spirit
// to CircuitJS's Menus/composeMainMenu — all actions are routed through the
// CommandManager so the menu stays a thin view.
export class Menus {
  private sim: Simulator;
  private runButton!: HTMLButtonElement;
  private modeButtons = new Map<string, HTMLButtonElement>();
  private analysisButtons = new Map<string, HTMLButtonElement>();
  private freqInput!: HTMLInputElement;

  constructor(sim: Simulator) {
    this.sim = sim;
  }

  build(): void {
    const tb = this.sim.toolbarEl;
    tb.innerHTML = "";

    const ctrl = this.group(tb);
    this.runButton = this.button(ctrl, "Run", () => this.sim.commands.perform("toggle-run"));
    this.button(ctrl, "Reset", () => this.sim.commands.perform("reset"));

    const modeG = this.group(tb);
    this.modeButtons.set("select", this.button(modeG, "Select", () => this.sim.commands.perform("mode:select")));
    for (const def of ElementRegistry.list()) {
      this.modeButtons.set(
        def.name,
        this.button(modeG, def.label, () => this.sim.commands.perform("mode:" + def.name)),
      );
    }

    const editG = this.group(tb);
    this.button(editG, "Delete", () => this.sim.commands.perform("delete"));
    this.button(editG, "Clear", () => this.sim.commands.perform("clear"));

    const ioG = this.group(tb);
    this.button(ioG, "Export", () => this.sim.commands.perform("export"));
    this.button(ioG, "Import", () => this.sim.commands.perform("import"));

    const viewG = this.group(tb);
    this.button(viewG, "Zoom +", () => this.sim.commands.perform("zoom-in"));
    this.button(viewG, "Zoom −", () => this.sim.commands.perform("zoom-out"));
    this.button(viewG, "Reset View", () => this.sim.commands.perform("reset-view"));

    // Analysis mode: time-domain transient vs AC steady-state phasor + the
    // global analysis frequency that drives the reactances in phasor mode.
    const anG = this.group(tb);
    this.analysisButtons.set(
      "transient",
      this.button(anG, "Transient", () => this.sim.commands.perform("analysis:transient")),
    );
    this.analysisButtons.set(
      "phasor",
      this.button(anG, "Phasor", () => this.sim.commands.perform("analysis:phasor")),
    );
    this.label(anG, "f (Hz)");
    const freq = document.createElement("input");
    freq.type = "number";
    freq.min = "0";
    freq.step = "any";
    freq.value = String(this.sim.sim.analysisFrequency);
    freq.className = "freq-input";
    freq.addEventListener("input", () => {
      const v = Number(freq.value);
      if (Number.isFinite(v) && v > 0) this.sim.sim.setAnalysisFrequency(v);
    });
    anG.appendChild(freq);
    this.freqInput = freq;

    const speedG = this.group(tb);
    this.label(speedG, "Speed");
    const slider = document.createElement("input");
    slider.type = "range";
    slider.min = "1";
    slider.max = "300";
    slider.value = String(this.sim.sim.stepsPerFrame);
    slider.addEventListener("input", () => {
      const v = Number(slider.value);
      this.sim.sim.stepsPerFrame = Math.max(1, Math.round(v));
      this.sim.speed = v / 80;
    });
    speedG.appendChild(slider);

    this.updateRunButton(this.sim.simRunning);
    this.updateModeButtons(this.sim.mouseMode);
    this.updateForAnalysisMode(this.sim.sim.analysisMode);
  }

  /** Sync the toolbar to the analysis mode: highlight the active button, enable
   *  the global frequency only in phasor mode, and disable the DC-source button
   *  in phasor mode (a DC source has no phasor — it can't be inserted there). */
  updateForAnalysisMode(mode: string): void {
    const phasor = mode === "phasor";
    for (const [name, btn] of this.analysisButtons) {
      btn.classList.toggle("active", name === mode);
    }
    this.freqInput.disabled = !phasor;
    const dc = this.modeButtons.get("DCVoltageElm");
    if (dc) dc.disabled = phasor;
  }

  updateRunButton(running: boolean): void {
    this.runButton.textContent = running ? "Stop" : "Run";
    this.runButton.classList.toggle("active", running);
  }

  updateModeButtons(mode: string): void {
    for (const [name, btn] of this.modeButtons) {
      btn.classList.toggle("active", name === mode);
    }
  }

  // --- tiny DOM helpers -----------------------------------------------------

  private group(parent: HTMLElement): HTMLElement {
    const g = document.createElement("div");
    g.className = "group";
    parent.appendChild(g);
    return g;
  }

  private button(parent: HTMLElement, text: string, onClick: () => void): HTMLButtonElement {
    const b = document.createElement("button");
    b.textContent = text;
    b.addEventListener("click", onClick);
    parent.appendChild(b);
    return b;
  }

  private label(parent: HTMLElement, text: string): void {
    const s = document.createElement("span");
    s.className = "label";
    s.textContent = text;
    parent.appendChild(s);
  }
}
