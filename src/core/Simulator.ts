import { SimulationManager } from "./SimulationManager";
import { UIManager } from "../ui/UIManager";
import { MouseManager } from "../ui/MouseManager";
import { CommandManager } from "../ui/CommandManager";
import { Menus } from "../ui/Menus";
import { SimElement } from "../elements/SimElement";
import "../elements/index"; // side-effect: register all elements

export interface SimulatorDom {
  canvas: HTMLCanvasElement;
  toolbar: HTMLElement;
  infobar: HTMLElement;
}

// Central orchestrator — the analog of CircuitJS's CirSim. It owns the element
// list and the managers and wires them together; the heavy lifting lives in the
// managers (simulation, rendering, input, commands, menu). Kept deliberately
// thin so the architecture (not this class) is what you reuse.
export class Simulator {
  canvas: HTMLCanvasElement;
  ctx: CanvasRenderingContext2D;
  toolbarEl: HTMLElement;
  infobarEl: HTMLElement;

  elmList: SimElement[] = [];
  sim = new SimulationManager();
  ui: UIManager;
  mouse: MouseManager;
  commands: CommandManager;
  menus: Menus;

  analyzeFlag = true; // circuit topology changed -> re-analyze
  simRunning = true;
  gridSize = 16;
  speed = 1; // animation/step-rate multiplier
  mouseMode = "select"; // "select" or a registered element name

  constructor(dom: SimulatorDom) {
    this.canvas = dom.canvas;
    this.toolbarEl = dom.toolbar;
    this.infobarEl = dom.infobar;
    const ctx = this.canvas.getContext("2d");
    if (!ctx) throw new Error("2D canvas context unavailable");
    this.ctx = ctx;

    this.ui = new UIManager(this);
    this.mouse = new MouseManager(this);
    this.commands = new CommandManager(this);
    this.menus = new Menus(this);
  }

  init(): void {
    this.menus.build();
    this.commands.init();
    this.mouse.init();
    this.ui.init(); // starts the render loop
  }

  // --- element list ---------------------------------------------------------

  addElement(e: SimElement): void {
    this.elmList.push(e);
    this.needAnalyze();
  }

  deleteSelected(): void {
    const before = this.elmList.length;
    this.elmList = this.elmList.filter((e) => !e.selected);
    if (this.elmList.length !== before) this.needAnalyze();
  }

  clearCircuit(): void {
    this.elmList = [];
    this.needAnalyze();
  }

  clearSelection(): void {
    for (const e of this.elmList) e.selected = false;
  }

  getSelected(): SimElement | null {
    return this.elmList.find((e) => e.selected) ?? null;
  }

  // --- simulation control ---------------------------------------------------

  needAnalyze(): void {
    this.analyzeFlag = true;
  }

  setSimRunning(r: boolean): void {
    this.simRunning = r;
    if (r) this.sim.stopMessage = null;
    this.menus.updateRunButton(r);
  }

  resetSimulation(): void {
    this.sim.reset();
    this.needAnalyze();
  }

  // --- helpers --------------------------------------------------------------

  snap(v: number): number {
    return Math.round(v / this.gridSize) * this.gridSize;
  }

  setMouseMode(mode: string): void {
    this.mouseMode = mode;
    this.menus.updateModeButtons(mode);
  }
}
