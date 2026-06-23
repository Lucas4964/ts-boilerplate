import type { Simulator } from "../core/Simulator";
import { SimElement } from "../elements/SimElement";
import { ElementRegistry } from "../elements/ElementRegistry";
import { EditDialog } from "./EditDialog";

// Pointer interaction: place new elements (when a tool is selected), or
// select/move existing ones (in "select" mode). Double-click edits properties
// by iterating the element's getEditInfo() descriptors.
export class MouseManager {
  private sim: Simulator;
  private draggingNew: SimElement | null = null;
  private movingElement: SimElement | null = null;
  private lastGX = 0;
  private lastGY = 0;

  constructor(sim: Simulator) {
    this.sim = sim;
  }

  init(): void {
    const c = this.sim.canvas;
    c.addEventListener("pointerdown", (e) => this.onDown(e));
    c.addEventListener("pointermove", (e) => this.onMove(e));
    c.addEventListener("pointerup", (e) => this.onUp(e));
    c.addEventListener("dblclick", (e) => this.onDoubleClick(e));
  }

  private pos(e: PointerEvent | MouseEvent): { x: number; y: number } {
    const rect = this.sim.canvas.getBoundingClientRect();
    return { x: e.clientX - rect.left, y: e.clientY - rect.top };
  }

  private onDown(e: PointerEvent): void {
    const { x, y } = this.pos(e);
    const gx = this.sim.snap(x);
    const gy = this.sim.snap(y);
    this.sim.canvas.setPointerCapture(e.pointerId);

    if (this.sim.mouseMode !== "select") {
      const el = ElementRegistry.createByName(this.sim.mouseMode, gx, gy);
      if (el) {
        this.sim.commands.pushUndo();
        this.sim.clearSelection();
        el.selected = true;
        this.sim.addElement(el);
        this.draggingNew = el;
      }
      return;
    }

    const hit = this.findElementAt(x, y);
    this.sim.clearSelection();
    if (hit) {
      this.sim.commands.pushUndo();
      hit.selected = true;
      this.movingElement = hit;
      this.lastGX = gx;
      this.lastGY = gy;
    }
  }

  private onMove(e: PointerEvent): void {
    const { x, y } = this.pos(e);
    const gx = this.sim.snap(x);
    const gy = this.sim.snap(y);

    if (this.draggingNew) {
      this.draggingNew.drag(gx, gy);
      this.sim.needAnalyze();
    } else if (this.movingElement) {
      const dx = gx - this.lastGX;
      const dy = gy - this.lastGY;
      if (dx !== 0 || dy !== 0) {
        this.movingElement.move(dx, dy);
        this.lastGX = gx;
        this.lastGY = gy;
        this.sim.needAnalyze();
      }
    }
  }

  private onUp(e: PointerEvent): void {
    if (this.draggingNew) {
      // A plain click (no drag) gets a sensible default size instead of vanishing.
      if (this.draggingNew.creationFailed()) {
        this.draggingNew.drag(this.draggingNew.x + 64, this.draggingNew.y);
      }
      this.draggingNew = null;
      this.sim.setMouseMode("select"); // revert to select after placing one
      this.sim.needAnalyze();
    }
    this.movingElement = null;
    if (this.sim.canvas.hasPointerCapture(e.pointerId)) {
      this.sim.canvas.releasePointerCapture(e.pointerId);
    }
  }

  private onDoubleClick(e: MouseEvent): void {
    const { x, y } = this.pos(e);
    const hit = this.findElementAt(x, y);
    if (hit) {
      this.sim.clearSelection();
      hit.selected = true;
      EditDialog.open(this.sim, hit);
    }
  }

  private findElementAt(x: number, y: number): SimElement | null {
    const list = this.sim.elmList;
    for (let i = list.length - 1; i >= 0; i--) {
      const e = list[i];
      if (e.getBoundingBox().contains(x, y) || e.distanceTo(x, y) < 10) return e;
    }
    return null;
  }
}
