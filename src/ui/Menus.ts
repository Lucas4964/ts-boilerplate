import type { Simulator } from "../core/Simulator";
import { ElementRegistry } from "../elements/ElementRegistry";

// Names that stay as toolbar buttons (Wire and Ground); everything else moves
// into the menu-bar dropdowns.
const TOOLBAR_ELEMENTS = new Set(["WireElm", "GroundElm"]);

// Menu-bar structure: each entry is a top-level menu with items; a null item
// becomes a submenu host rendered as `{ label, sub: [...] }`.
interface MenuItem {
  label: string;
  mode?: string;
  sub?: MenuItem[];
}
const MENU_BAR: { label: string; items: MenuItem[] }[] = [
  {
    label: "Components",
    items: [
      { label: "Resistor", mode: "ResistorElm" },
      { label: "Capacitor", mode: "CapacitorElm" },
      { label: "Inductor", mode: "InductorElm" },
      {
        label: "Transformers",
        sub: [
          { label: "1 Phase", mode: "TransformerElm" },
          { label: "1 Phase (Ideal)", mode: "IdealTransformerElm" },
          { label: "3 Phase", mode: "ThreePhaseTransformerElm" },
        ],
      },
    ],
  },
  {
    label: "Sources",
    items: [
      {
        label: "Voltage",
        sub: [
          { label: "AC Source", mode: "ACVoltageElm" },
          { label: "DC Source", mode: "DCVoltageElm" },
        ],
      },
      {
        label: "Current",
        sub: [
          { label: "AC Current", mode: "ACCurrentElm" },
          { label: "DC Current", mode: "DCCurrentElm" },
        ],
      },
      {
        label: "Controlled",
        sub: [
          { label: "VCVS (V→V)", mode: "VCVSElm" },
          { label: "VCCS (V→I)", mode: "VCCSElm" },
          { label: "CCVS (I→V)", mode: "CCVSElm" },
          { label: "CCCS (I→I)", mode: "CCCSElm" },
        ],
      },
    ],
  },
  {
    label: "Measurement",
    items: [
      { label: "V Probe", mode: "VoltageProbeElm" },
      { label: "ΔV Probe", mode: "DiffVoltageProbeElm" },
      { label: "I Probe", mode: "CurrentProbeElm" },
      { label: "Ammeter", mode: "AmmeterElm" },
    ],
  },
];

// DC-only elements have no phasor, so they can't be inserted in phasor mode.
const DC_ONLY_MODES = ["DCVoltageElm", "DCCurrentElm"];

// Builds the toolbar DOM and keeps button state in sync. Equivalent in spirit
// to CircuitJS's Menus/composeMainMenu — all actions are routed through the
// CommandManager so the menu stays a thin view.
export class Menus {
  private sim: Simulator;
  private runButton!: HTMLButtonElement;
  // Tracks every mode-activating interactive element (toolbar buttons AND menu
  // items) so updateModeButtons() can highlight the active one everywhere.
  private modeButtons = new Map<string, HTMLElement>();
  private analysisButtons = new Map<string, HTMLButtonElement>();
  private freqInput!: HTMLInputElement;
  private menuBar!: HTMLElement;

  constructor(sim: Simulator) {
    this.sim = sim;
  }

  build(): void {
    const tb = this.sim.toolbarEl;
    tb.innerHTML = "";

    // Build menu bar and insert it above the toolbar in the DOM.
    this.menuBar = this.buildMenuBar();
    tb.parentElement!.insertBefore(this.menuBar, tb);

    const ctrl = this.group(tb);
    this.runButton = this.button(ctrl, "Run", () => this.sim.commands.perform("toggle-run"));
    this.button(ctrl, "Reset", () => this.sim.commands.perform("reset"));

    const modeG = this.group(tb);
    this.modeButtons.set("select", this.button(modeG, "Select", () => this.sim.commands.perform("mode:select")));
    // Only Wire and Ground stay as toolbar buttons; the rest are in the menu bar.
    for (const def of ElementRegistry.list()) {
      if (!TOOLBAR_ELEMENTS.has(def.name)) continue;
      const btn = this.button(modeG, def.label, () => this.sim.commands.perform("mode:" + def.name));
      this.modeButtons.set(def.name, btn);
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
    // DC-only sources can't be placed in phasor mode; visually disable them.
    for (const name of DC_ONLY_MODES) {
      this.modeButtons.get(name)?.classList.toggle("item-disabled", phasor);
    }
  }

  updateRunButton(running: boolean): void {
    this.runButton.textContent = running ? "Stop" : "Run";
    this.runButton.classList.toggle("active", running);
  }

  updateModeButtons(mode: string): void {
    for (const [name, el] of this.modeButtons) {
      el.classList.toggle("active", name === mode);
    }
  }

  // --- menu bar -------------------------------------------------------------

  private buildMenuBar(): HTMLElement {
    const nav = document.createElement("nav");
    nav.className = "menubar";

    // Close all open menus when clicking outside the bar.
    document.addEventListener("pointerdown", (e) => {
      if (!nav.contains(e.target as Node)) {
        nav.querySelectorAll(".menu.open").forEach((m) => m.classList.remove("open"));
      }
    });

    for (const menuDef of MENU_BAR) {
      const menuEl = document.createElement("div");
      menuEl.className = "menu";

      const header = document.createElement("button");
      header.textContent = menuDef.label + " ▾"; // ▾
      header.addEventListener("click", (e) => {
        e.stopPropagation();
        const isOpen = menuEl.classList.contains("open");
        // Close all open menus first, then toggle this one.
        nav.querySelectorAll(".menu.open").forEach((m) => m.classList.remove("open"));
        if (!isOpen) menuEl.classList.add("open");
      });
      menuEl.appendChild(header);

      const ul = document.createElement("ul");
      ul.className = "dropdown";
      this.buildMenuItems(ul, menuDef.items);
      menuEl.appendChild(ul);

      nav.appendChild(menuEl);
    }

    return nav;
  }

  private buildMenuItems(parent: HTMLElement, items: MenuItem[]): void {
    for (const item of items) {
      const li = document.createElement("li");

      if (item.sub) {
        // Submenu host: hover reveals child <ul>.
        li.className = "has-sub";
        li.textContent = item.label + " ▸"; // ▸
        const subUl = document.createElement("ul");
        subUl.className = "sub-dropdown";
        this.buildMenuItems(subUl, item.sub);
        li.appendChild(subUl);
      } else if (item.mode) {
        const mode = item.mode;
        li.textContent = item.label;
        li.addEventListener("click", () => {
          if (li.classList.contains("item-disabled")) return;
          // Close the menu after selection.
          this.menuBar.querySelectorAll(".menu.open").forEach((m) => m.classList.remove("open"));
          this.sim.commands.perform("mode:" + mode);
        });
        // Register for active-mode highlighting.
        this.modeButtons.set(mode, li);
      }

      parent.appendChild(li);
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
