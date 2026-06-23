import type { Simulator } from "../core/Simulator";
import { Graphics } from "./Graphics";
import { SimElement } from "../elements/SimElement";
import { getUnitText } from "../util/format";

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
    const ctx = s.ctx;
    const g = new Graphics(ctx);

    // 1) background painted in screen space (so it always covers the canvas)
    ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    g.setColor("#000000");
    g.fillRect(0, 0, this.cssWidth, this.cssHeight);

    // 2) grid + elements painted in world space (pan/zoom applied here)
    ctx.setTransform(
      this.dpr * s.scale,
      0,
      0,
      this.dpr * s.scale,
      this.dpr * s.originX,
      this.dpr * s.originY,
    );
    this.drawGrid(g);
    for (const e of s.elmList) e.draw(g);
  }

  private drawGrid(g: Graphics): void {
    const s = this.sim;
    const step = s.gridSize;
    if (step * s.scale < 6) return; // too dense to be useful when zoomed far out

    // Only iterate over the grid points currently visible (in world coords).
    const left = s.toWorldX(0);
    const top = s.toWorldY(0);
    const right = s.toWorldX(this.cssWidth);
    const bottom = s.toWorldY(this.cssHeight);
    const dot = 1 / s.scale; // keep dots ~1 device px regardless of zoom
    g.setColor("#161616");
    for (let x = Math.floor(left / step) * step; x <= right; x += step) {
      for (let y = Math.floor(top / step) * step; y <= bottom; y += step) {
        g.fillRect(x, y, dot, dot);
      }
    }
  }

  private updateInfobar(): void {
    const s = this.sim;
    if (s.sim.stopMessage) {
      s.infobarEl.textContent = "⚠ " + s.sim.stopMessage;
    } else {
      const t = s.sim.time;
      const zoom = Math.round(s.scale * 100);
      s.infobarEl.textContent =
        `t = ${t.toExponential(3)} s    elements: ${s.elmList.length}    ` +
        `${s.simRunning ? "running" : "paused"}    mode: ${s.mouseMode}    zoom: ${zoom}%`;
    }
    this.updateInfoPanel();
  }

  // Bottom-right panel showing the selected element's electrical quantities,
  // mirroring CircuitJS's info overlay (title, then I / Vd / value / P, plus the
  // circuit operating frequency fo when an oscillating source is present).
  private updateInfoPanel(): void {
    const s = this.sim;
    const panel = s.infopanelEl;
    const sel = s.getSelected();
    if (!sel) {
      panel.style.display = "none";
      return;
    }
    const lines = sel.getInfo().slice();
    const fo = s.operatingFrequency();
    if (fo > 0) lines.push("fo = " + getUnitText(fo, "Hz"));

    panel.replaceChildren();
    for (let i = 0; i < lines.length; i++) {
      const row = document.createElement("div");
      row.className = i === 0 ? "ip-title" : "ip-row";
      row.textContent = lines[i];
      panel.appendChild(row);
    }
    panel.style.display = "block";
  }
}
