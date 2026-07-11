import type { Simulator } from "../core/Simulator";
import { SimElement } from "../elements/SimElement";
import { ControlledSourceElm } from "../elements/ControlledSourceElm";
import { ElementRegistry } from "../elements/ElementRegistry";
import { EditDialog } from "./EditDialog";
import { ContextMenu } from "./ContextMenu";
import { Rectangle, distanceSq } from "../geom/Point";

// Screen-pixel radius for grabbing an element's endpoint handle (to resize it);
// converted to world units. Body hit-testing itself is pure world-coordinate
// bounding-box containment (Falstad-style — see findElementAt), so it needs no
// screen-pixel tolerance.
const HANDLE_HIT_PX = 12;

// Pointer interaction: place new elements (when a tool is selected), or
// select / move / resize existing ones (in "select" mode). Dragging an endpoint
// expands or compresses the element; the middle or right button pans the view
// and the wheel zooms it. Double-click edits properties.
export class MouseManager {
  private sim: Simulator;
  private draggingNew: SimElement | null = null;
  private movingElement: SimElement | null = null;
  private movingGroup = false; // true when dragging a rubber-band multi-selection
  private movingHandle: { el: SimElement; which: number } | null = null;
  private panning = false;
  private lastGX = 0;
  private lastGY = 0;
  private lastSX = 0;
  private lastSY = 0;
  // Two-click placement in progress (e.g. the differential probe: A then B).
  private twoClickPending: SimElement | null = null;
  // Rubber-band area selection: drag start (world) + the current rect (world).
  private selStart: { x: number; y: number } | null = null;
  selectionRect: Rectangle | null = null;
  // Control-pick mode: the next left-click binds the clicked element as this
  // controlled source's control (started from its edit dialog).
  pickingFor: ControlledSourceElm | null = null;

  /** Enter control-pick mode for a controlled source (Esc / right-click cancels). */
  startControlPick(el: ControlledSourceElm): void {
    this.pickingFor = el;
    this.sim.setMouseMode("select");
  }
  cancelControlPick(): void {
    this.pickingFor = null;
  }

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
    // Middle button always pans. Right button: in a placement tool it exits the
    // tool (so a Wire chain ends on right-click); in Select it pans.
    if (e.button === 1 || e.button === 2) {
      if (e.button === 2 && this.pickingFor) {
        this.cancelControlPick(); // right-click aborts the control pick
        e.preventDefault();
        return;
      }
      if (e.button === 2 && this.sim.mouseMode !== "select") {
        this.sim.setMouseMode("select"); // cancels any two-click in progress
        e.preventDefault();
        return;
      }
      // Right-click over a component (select mode): open the rotation context
      // menu instead of panning. Right-drag on empty space still pans.
      if (e.button === 2) {
        const w = this.worldPos(e);
        const hit = this.findElementAt(w.x, w.y);
        if (hit) {
          if (!hit.selected) {
            this.sim.clearSelection();
            hit.selected = true; // keep an existing multi-selection if it includes hit
          }
          ContextMenu.open(this.sim, e.clientX, e.clientY);
          e.preventDefault();
          return;
        }
      }
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

    // Control-pick mode: this click selects the control element (or is ignored
    // if the target is not bindable — e.g. a wire for a current control).
    if (this.pickingFor) {
      const hit = this.findElementAt(w.x, w.y);
      if (hit && this.pickingFor.acceptsTarget(hit, this.sim.sim)) {
        this.sim.commands.pushUndo();
        this.pickingFor.controlTarget = hit;
        this.pickingFor = null;
        this.sim.needAnalyze();
      }
      return;
    }

    if (this.sim.mouseMode !== "select") {
      this.onPlaceDown(gx, gy);
      return;
    }

    const hit = this.findElementAt(w.x, w.y);
    if (hit && hit.selected && this.countSelected() > 1) {
      // Clicking on an already-selected element in a multi-selection: preserve
      // the whole group and set up a group drag (don't clear selection).
      this.sim.commands.pushUndo();
      this.movingElement = hit;
      this.movingGroup = true;
      this.lastGX = gx;
      this.lastGY = gy;
    } else {
      this.sim.clearSelection();
      if (hit) {
        hit.selected = true;
        this.sim.commands.pushUndo();
        const handle = hit.nearestHandle(w.x, w.y, HANDLE_HIT_PX / this.sim.scale);
        if (handle >= 0) {
          this.movingHandle = { el: hit, which: handle }; // resize (expand/compress)
        } else {
          this.movingElement = hit; // move the whole element
          this.movingGroup = false;
        }
        this.lastGX = gx;
        this.lastGY = gy;
      } else {
        // empty space: begin a rubber-band area selection
        this.selStart = { x: w.x, y: w.y };
        this.selectionRect = new Rectangle(w.x, w.y, 0, 0);
      }
    }
  }

  /** Handle a left-press while a placement tool is active. */
  private onPlaceDown(gx: number, gy: number): void {
    // Second click of a two-click placement (e.g. diff probe): set B, finalize.
    if (this.twoClickPending) {
      const el = this.twoClickPending;
      el.setPosition(el.x, el.y, gx, gy); // point1 stays at A, point2 = B
      this.twoClickPending = null; // clear before mode change so it isn't cancelled
      this.sim.setMouseMode("select");
      this.sim.needAnalyze();
      return;
    }
    const el = ElementRegistry.createByName(this.sim.mouseMode, gx, gy);
    if (!el) return;
    this.sim.commands.pushUndo();
    this.sim.clearSelection();
    el.selected = true;
    this.sim.addElement(el);
    if (el.usesTwoClickPlacement()) {
      el.setPosition(gx, gy, gx, gy); // anchor A; B follows the cursor until click 2
      this.twoClickPending = el;
    } else {
      this.draggingNew = el; // press-drag-release sets the far endpoint
    }
  }

  /** Drop a half-finished two-click placement (called when the mode changes). */
  cancelPending(): void {
    if (this.twoClickPending) {
      const pending = this.twoClickPending;
      this.twoClickPending = null;
      this.sim.elmList = this.sim.elmList.filter((el) => el !== pending);
      this.sim.needAnalyze();
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

    if (this.selStart) {
      // grow the rubber-band rectangle (normalized, world coords)
      const x = Math.min(this.selStart.x, w.x);
      const y = Math.min(this.selStart.y, w.y);
      this.selectionRect = new Rectangle(x, y, Math.abs(w.x - this.selStart.x), Math.abs(w.y - this.selStart.y));
      return;
    }

    if (this.twoClickPending) {
      this.twoClickPending.drag(gx, gy); // preview B following the cursor
      this.sim.needAnalyze();
      return;
    }

    if (this.draggingNew) {
      this.draggingNew.drag(gx, gy);
      this.sim.needAnalyze();
    } else if (this.movingHandle) {
      this.movingHandle.el.dragHandle(this.movingHandle.which, gx, gy);
      this.sim.needAnalyze();
    } else if (!this.movingElement) {
      // Falstad-style hover: the element under the cursor is highlighted so
      // the user sees what the next click will act on (also previews the
      // target while control-picking).
      if (this.sim.mouseMode === "select" || this.pickingFor) {
        SimElement.hoverElm = this.findElementAt(w.x, w.y);
      } else {
        SimElement.hoverElm = null;
      }
    }
    if (this.movingElement) {
      const dx = gx - this.lastGX;
      const dy = gy - this.lastGY;
      if (dx !== 0 || dy !== 0) {
        if (this.movingGroup) {
          for (const el of this.sim.elmList) {
            if (el.selected) el.move(dx, dy);
          }
        } else {
          this.movingElement.move(dx, dy);
        }
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
        const o = this.draggingNew.getDefaultDragOffset();
        this.draggingNew.drag(this.draggingNew.x + o.dx, this.draggingNew.y + o.dy);
      }
      const placed = this.draggingNew;
      this.draggingNew = null;
      // The Wire tool stays active for rapid chaining (exit with Esc or right
      // button); every other tool reverts to Select after placing one.
      if (!placed.isWire()) this.sim.setMouseMode("select");
      this.sim.needAnalyze();
    }
    if (this.selStart) {
      // Finalize the rubber-band, but only if the user actually dragged a box —
      // a plain click on empty space must select nothing (a zero-area rect would
      // otherwise catch any element whose bounding box covers the click point).
      const r = this.selectionRect;
      if (r && (r.width > 2 || r.height > 2)) {
        for (const el of this.sim.elmList) {
          if (el.getBoundingBox().intersects(r)) el.selected = true;
        }
      }
      this.selStart = null;
      this.selectionRect = null;
    }
    this.movingElement = null;
    this.movingGroup = false;
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

  private countSelected(): number {
    return this.sim.elmList.filter((e) => e.selected).length;
  }

  /**
   * Faithful port of Falstad's mouseSelect hit test (MouseManager.java):
   * everything in WORLD coordinates — no screen-pixel tolerance, so behaviour
   * is identical at any zoom level.
   *  1. Among elements whose bounding box (set tightly by each draw()) contains
   *     the point, pick the smallest getMouseDistance() ≥ 0 (perpendicular
   *     distance² to the post-to-post line; −1 opts out — wires use a
   *     threshold so their long thin box doesn't steal crossing clicks).
   *  2. If no box contains the point, an element still wins if the point is
   *     within √26 world units of one of its posts (how tiny parts get picked).
   */
  private findElementAt(wx: number, wy: number): SimElement | null {
    const list = this.sim.elmList;
    let best: SimElement | null = null;
    let bestDist = Infinity;
    for (const e of list) {
      if (e.getBoundingBox().contains(wx, wy)) {
        const dist = e.getMouseDistance(wx, wy);
        if (dist >= 0 && dist < bestDist) {
          bestDist = dist;
          best = e;
        }
      }
    }
    if (best === null) {
      // post-proximity fallback (Falstad: distanceSq < 26)
      outer: for (const e of list) {
        for (let j = 0; j < e.getPostCount(); j++) {
          const p = e.getPost(j);
          if (distanceSq(p.x, p.y, wx, wy) < 26) {
            best = e;
            break outer;
          }
        }
      }
    }
    return best;
  }
}
