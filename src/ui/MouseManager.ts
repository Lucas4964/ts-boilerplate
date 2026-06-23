import type { Simulator } from "../core/Simulator";
import { SimElement } from "../elements/SimElement";
import { ElementRegistry } from "../elements/ElementRegistry";
import { EditDialog } from "./EditDialog";

// Screen-pixel radius for grabbing an element's endpoint handle (to resize it)
// and for hit-testing a thin element body. Both are converted to world units.
const HANDLE_HIT_PX = 12;
const BODY_HIT_PX = 8;

// Pointer interaction: place new elements (when a tool is selected), or
// select / move / resize existing ones (in "select" mode). Dragging an endpoint
// expands or compresses the element; the middle or right button pans the view
// and the wheel zooms it. Double-click edits properties.
export class MouseManager {
  private sim: Simulator;
  private draggingNew: SimElement | null = null;
  private movingElement: SimElement | null = null;
  private movingHandle: { el: SimElement; which: number } | null = null;
  private panning = false;
  private lastGX = 0;
  private lastGY = 0;
  private lastSX = 0;
  private lastSY = 0;

  constructor(sim: Simulator) {
    this.sim = sim;
  }

  init(): void {
    const c = this.sim.canvas;
    c.addEventListener("pointerdown", (e) => this.onDown(e));
    c.addEventListener("pointermove", (e) => this.onMove(e));
    c.addEventListener("pointerup", (e) => this.onUp(e));
    c.addEventListener("dblclick", (e) => this.onDoubleClick(e));
    c.addEventListener("wheel", (e) => this.onWheel(e), { passive: false });
    c.addEventListener("contextmenu", (e) => e.preventDefault()); // free up right-drag for panning
  }

  /** Pointer position in screen (CSS) pixels relative to the canvas. */
  private screenPos(e: MouseEvent): { x: number; y: number } {
    const rect = this.sim.canvas.getBoundingClientRect();
    return { x: e.clientX - rect.left, y: e.clientY - rect.top };
  }

  /** Pointer position in world (circuit) coordinates. */
  private worldPos(e: MouseEvent): { x: number; y: number } {
    const s = this.screenPos(e);
    return { x: this.sim.toWorldX(s.x), y: this.sim.toWorldY(s.y) };
  }

  private onDown(e: PointerEvent): void {
    // Middle or right button => pan the view.
    if (e.button === 1 || e.button === 2) {
      const s = this.screenPos(e);
      this.panning = true;
      this.lastSX = s.x;
      this.lastSY = s.y;
      this.sim.canvas.setPointerCapture(e.pointerId);
      this.sim.canvas.style.cursor = "grabbing";
      e.preventDefault();
      return;
    }
    if (e.button !== 0) return;

    const w = this.worldPos(e);
    const gx = this.sim.snap(w.x);
    const gy = this.sim.snap(w.y);
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

    const hit = this.findElementAt(w.x, w.y);
    this.sim.clearSelection();
    if (hit) {
      hit.selected = true;
      this.sim.commands.pushUndo();
      const handle = hit.nearestHandle(w.x, w.y, HANDLE_HIT_PX / this.sim.scale);
      if (handle >= 0) {
        this.movingHandle = { el: hit, which: handle }; // resize (expand/compress)
      } else {
        this.movingElement = hit; // move the whole element
      }
      this.lastGX = gx;
      this.lastGY = gy;
    }
  }

  private onMove(e: PointerEvent): void {
    if (this.panning) {
      const s = this.screenPos(e);
      this.sim.pan(s.x - this.lastSX, s.y - this.lastSY);
      this.lastSX = s.x;
      this.lastSY = s.y;
      return;
    }

    const w = this.worldPos(e);
    const gx = this.sim.snap(w.x);
    const gy = this.sim.snap(w.y);

    if (this.draggingNew) {
      this.draggingNew.drag(gx, gy);
      this.sim.needAnalyze();
    } else if (this.movingHandle) {
      this.movingHandle.el.dragHandle(this.movingHandle.which, gx, gy);
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
    if (this.panning) {
      this.panning = false;
      this.sim.canvas.style.cursor = "";
    }
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
    this.movingHandle = null;
    if (this.sim.canvas.hasPointerCapture(e.pointerId)) {
      this.sim.canvas.releasePointerCapture(e.pointerId);
    }
  }

  private onWheel(e: WheelEvent): void {
    e.preventDefault();
    const s = this.screenPos(e);
    const factor = e.deltaY < 0 ? 1.1 : 1 / 1.1;
    this.sim.zoomAt(s.x, s.y, factor);
  }

  private onDoubleClick(e: MouseEvent): void {
    const w = this.worldPos(e);
    const hit = this.findElementAt(w.x, w.y);
    if (hit) {
      this.sim.clearSelection();
      hit.selected = true;
      EditDialog.open(this.sim, hit);
    }
  }

  private findElementAt(wx: number, wy: number): SimElement | null {
    const list = this.sim.elmList;
    const tol = BODY_HIT_PX / this.sim.scale;
    for (let i = list.length - 1; i >= 0; i--) {
      const e = list[i];
      if (e.getBoundingBox().contains(wx, wy) || e.distanceTo(wx, wy) < tol) return e;
    }
    return null;
  }
}
