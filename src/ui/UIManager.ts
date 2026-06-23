import type { Simulator } from "../core/Simulator";
import { Graphics } from "./Graphics";
import { SimElement } from "../elements/SimElement";

// Owns the canvas and the animation loop. The loop mirrors CircuitJS's
// updateCircuit(): analyze (if dirty) -> stamp (if needed) -> run -> draw,
// driven by requestAnimationFrame instead of a GWT Timer.
export class UIManager {
  private sim: Simulator;
  private dpr = 1;
  cssWidth = 0;
  cssHeight = 0;

  constructor(sim: Simulator) {
    this.sim = sim;
  }

  init(): void {
    this.setCanvasSize();
    window.addEventListener("resize", () => this.setCanvasSize());
    requestAnimationFrame(this.loop);
  }

  setCanvasSize(): void {
    const canvas = this.sim.canvas;
    const rect = canvas.getBoundingClientRect();
    this.dpr = window.devicePixelRatio || 1;
    this.cssWidth = Math.max(1, Math.floor(rect.width));
    this.cssHeight = Math.max(1, Math.floor(rect.height));
    canvas.width = Math.floor(this.cssWidth * this.dpr);
    canvas.height = Math.floor(this.cssHeight * this.dpr);
    // Draw in CSS pixels so element coords and pointer coords line up.
    this.sim.ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
  }

  private loop = (): void => {
    this.updateCircuit();
    requestAnimationFrame(this.loop);
  };

  updateCircuit(): void {
    const s = this.sim;

    if (s.analyzeFlag) {
      s.sim.analyzeCircuit(s.elmList);
      s.analyzeFlag = false;
    }
    if (s.sim.needsStamp && s.simRunning && s.sim.stopMessage == null) {
      s.sim.stampCircuit();
    }

    if (s.simRunning && s.sim.stopMessage == null && s.sim.matrixSize >= 0) {
      s.sim.runCircuit();
    }

    // dot-animation speed: proportional to current; 0 when paused
    SimElement.currentMult = s.simRunning && s.sim.stopMessage == null ? 60 * s.speed : 0;

    this.draw();
    this.updateInfobar();
  }

  private draw(): void {
    const s = this.sim;
    const g = new Graphics(s.ctx);
    // background
    g.setColor("#000000");
    g.fillRect(0, 0, this.cssWidth, this.cssHeight);
    this.drawGrid(g);

    for (const e of s.elmList) e.draw(g);

    // element currently being dragged out (not yet in the list during creation
    // it IS in the list, so nothing extra needed here)
  }

  private drawGrid(g: Graphics): void {
    const step = this.sim.gridSize;
    g.setColor("#161616");
    for (let x = 0; x < this.cssWidth; x += step) {
      for (let y = 0; y < this.cssHeight; y += step) {
        g.fillRect(x, y, 1, 1);
      }
    }
  }

  private updateInfobar(): void {
    const s = this.sim;
    if (s.sim.stopMessage) {
      s.infobarEl.textContent = "⚠ " + s.sim.stopMessage;
      return;
    }
    const sel = s.getSelected();
    if (sel) {
      s.infobarEl.textContent = sel.getInfo().join("    ");
      return;
    }
    const t = s.sim.time;
    s.infobarEl.textContent =
      `t = ${t.toExponential(3)} s    elements: ${s.elmList.length}    ` +
      `${s.simRunning ? "running" : "paused"}    mode: ${s.mouseMode}`;
  }
}
