import { Graphics } from "../ui/Graphics";
import { Point, Rectangle, distanceSq } from "../geom/Point";
import { EditInfo } from "./EditInfo";
import type { SimulationManager } from "../core/SimulationManager";

// Abstract base for every element — the direct analog of CircuitJS's CircuitElm.
// It defines the lifecycle contract the engine and UI rely on. New elements
// subclass this (or an intermediate base such as VoltageElm) and implement the
// abstract members; see README.md for the step-by-step "add an element" recipe.
export abstract class SimElement {
  // --- geometry (grid coordinates of the two drag endpoints) ---
  x: number;
  y: number;
  x2: number;
  y2: number;
  point1 = new Point();
  point2 = new Point();
  lead1 = new Point();
  lead2 = new Point();
  protected dn = 0;
  protected dpx1 = 0;
  protected dpy1 = 0;

  // --- simulation state ---
  nodes: number[] = []; // circuit-node index for each post + internal node
  volts: number[] = []; // solved voltage at each node
  voltSource = 0; // id of this element's first voltage source (if any)
  current = 0;
  protected curcount = 0; // current-animation phase
  flags = 0;

  // --- editor/selection state ---
  selected = false;
  boundingBox = new Rectangle();

  /** Pixels of "current" travel per frame; set globally by UIManager each frame. */
  static currentMult = 0;
  static currentColor = "#ffff00";
  static selectColor = "#00ffff";
  static elementColor = "#cccccc";

  constructor(x: number, y: number) {
    this.x = x;
    this.y = y;
    this.x2 = x;
    this.y2 = y;
    this.flags = this.getDefaultFlags();
    // NOTE: allocNodes()/setPoints() are intentionally NOT called here. With
    // class fields, a subclass's field initializers run after super(), so any
    // geometry computed in a base-constructor setPoints() would be overwritten.
    // The registry factory calls them right after construction instead.
  }

  getDefaultFlags(): number {
    return 0;
  }

  // ---- abstract / overridable contract -------------------------------------

  abstract getType(): string; // registry name, also used for serialization
  abstract getPostCount(): number;
  abstract draw(g: Graphics): void;

  getInternalNodeCount(): number {
    return 0;
  }
  getNodeCount(): number {
    return this.getPostCount() + this.getInternalNodeCount();
  }
  getVoltageSourceCount(): number {
    return 0;
  }
  setVoltageSource(_n: number, vs: number): void {
    this.voltSource = vs;
  }

  nonLinear(): boolean {
    return false;
  }

  /** True for elements that pin their node to the 0 V reference (ground). */
  isGround(): boolean {
    return false;
  }

  /** True for ideal wires: the engine merges the two posts into one node. */
  isWire(): boolean {
    return false;
  }

  /** Stamp the constant part of the MNA system (called once per analyze). */
  stamp(_sim: SimulationManager): void {}
  /** Update companion-model sources from the previous step (per timestep). */
  startIteration(): void {}
  /** Stamp time-varying contributions (per timestep, before each solve). */
  doStep(_sim: SimulationManager): void {}

  // ---- node / voltage plumbing ---------------------------------------------

  allocNodes(): void {
    const n = this.getNodeCount() + this.getVoltageSourceCount();
    this.nodes = new Array(n).fill(-1);
    this.volts = new Array(n).fill(0);
  }

  setNode(p: number, n: number): void {
    this.nodes[p] = n;
  }

  setNodeVoltage(n: number, v: number): void {
    this.volts[n] = v;
    this.calculateCurrent();
  }

  calculateCurrent(): void {}

  setCurrent(_vs: number, c: number): void {
    this.current = c;
  }
  getCurrent(): number {
    return this.current;
  }
  getVoltageDiff(): number {
    return this.volts[0] - this.volts[1];
  }
  reset(): void {
    for (let i = 0; i < this.volts.length; i++) this.volts[i] = 0;
    this.current = 0;
    this.curcount = 0;
  }

  // ---- geometry ------------------------------------------------------------

  /** Recompute derived geometry; override to add per-element layout (leads). */
  setPoints(): void {
    this.point1 = new Point(this.x, this.y);
    this.point2 = new Point(this.x2, this.y2);
    const dx = this.x2 - this.x;
    const dy = this.y2 - this.y;
    this.dn = Math.sqrt(dx * dx + dy * dy);
    this.dpx1 = this.dn === 0 ? 0 : dy / this.dn;
    this.dpy1 = this.dn === 0 ? 0 : -dx / this.dn;
    this.lead1 = this.point1;
    this.lead2 = this.point2;
  }

  /** Carve out a body of length `len` centered between the two posts. */
  protected calcLeads(len: number): void {
    if (this.dn < len || len === 0) {
      this.lead1 = this.point1;
      this.lead2 = this.point2;
      return;
    }
    this.lead1 = this.interpPoint(this.point1, this.point2, (this.dn - len) / (2 * this.dn));
    this.lead2 = this.interpPoint(this.point1, this.point2, (this.dn + len) / (2 * this.dn));
  }

  protected interpPoint(a: Point, b: Point, f: number, g = 0): Point {
    const r = new Point();
    r.x = Math.floor(a.x * (1 - f) + b.x * f + g * this.dpx1 + 0.48);
    r.y = Math.floor(a.y * (1 - f) + b.y * f + g * this.dpy1 + 0.48);
    return r;
  }

  abstract getPost(n: number): Point;

  getPostCountPoints(): Point[] {
    const pts: Point[] = [];
    for (let i = 0; i < this.getPostCount(); i++) pts.push(this.getPost(i));
    return pts;
  }

  // ---- interaction ---------------------------------------------------------

  setPosition(x: number, y: number, x2: number, y2: number): void {
    this.x = x;
    this.y = y;
    this.x2 = x2;
    this.y2 = y2;
    this.setPoints();
  }

  /** Called while the user drags out a new element. */
  drag(xx: number, yy: number): void {
    this.x2 = xx;
    this.y2 = yy;
    this.setPoints();
  }

  move(dx: number, dy: number): void {
    this.setPosition(this.x + dx, this.y + dy, this.x2 + dx, this.y2 + dy);
  }

  /** True if the element is a zero-length "click" (creation should be cancelled). */
  creationFailed(): boolean {
    return this.x === this.x2 && this.y === this.y2;
  }

  protected setBbox(x1: number, y1: number, x2: number, y2: number, pad = 0): void {
    const xmin = Math.min(x1, x2) - pad;
    const ymin = Math.min(y1, y2) - pad;
    this.boundingBox.x = xmin;
    this.boundingBox.y = ymin;
    this.boundingBox.width = Math.abs(x2 - x1) + 2 * pad;
    this.boundingBox.height = Math.abs(y2 - y1) + 2 * pad;
  }

  getBoundingBox(): Rectangle {
    return this.boundingBox;
  }

  /** Hit-test for selection (distance to the post-to-post segment). */
  distanceTo(px: number, py: number): number {
    return Math.sqrt(this.distanceToSegment(px, py, this.x, this.y, this.x2, this.y2));
  }

  private distanceToSegment(px: number, py: number, x1: number, y1: number, x2: number, y2: number): number {
    const dx = x2 - x1;
    const dy = y2 - y1;
    const len2 = dx * dx + dy * dy;
    if (len2 === 0) return distanceSq(px, py, x1, y1);
    let t = ((px - x1) * dx + (py - y1) * dy) / len2;
    t = Math.max(0, Math.min(1, t));
    return distanceSq(px, py, x1 + t * dx, y1 + t * dy);
  }

  // ---- drawing helpers -----------------------------------------------------

  protected color(g: Graphics): void {
    g.setColor(this.selected ? SimElement.selectColor : SimElement.elementColor);
    g.setLineWidth(this.selected ? 2 : 1.5);
  }

  protected drawPosts(g: Graphics): void {
    g.setColor("#888888");
    for (let i = 0; i < this.getPostCount(); i++) {
      const p = this.getPost(i);
      g.fillCircle(p.x, p.y, 2.5);
    }
  }

  protected draw2Leads(g: Graphics): void {
    this.color(g);
    g.drawLineP(this.point1, this.lead1);
    g.drawLineP(this.point2, this.lead2);
  }

  /** Advance the current-animation phase for a current of `cur`. */
  updateDotCount(cur = this.current, cc = this.curcount): number {
    let cadd = cur * SimElement.currentMult;
    cadd %= 8;
    return cc + cadd;
  }

  protected doDots(g: Graphics): void {
    this.curcount = this.updateDotCount(this.current, this.curcount);
    this.drawDots(g, this.point1, this.point2, this.curcount);
  }

  protected drawDots(g: Graphics, a: Point, b: Point, pos: number): void {
    if (SimElement.currentMult === 0 || pos === 0) return;
    const dx = b.x - a.x;
    const dy = b.y - a.y;
    const dn = Math.sqrt(dx * dx + dy * dy);
    const ds = 16;
    pos %= ds;
    if (pos < 0) pos += ds;
    g.setColor(SimElement.currentColor);
    for (let di = pos; di < dn; di += ds) {
      const x0 = Math.floor(a.x + (di * dx) / dn);
      const y0 = Math.floor(a.y + (di * dy) / dn);
      g.fillRect(x0 - 1, y0 - 1, 2, 2);
    }
  }

  // ---- info / editing ------------------------------------------------------

  getInfo(): string[] {
    return [this.getType()];
  }

  getEditInfo(_n: number): EditInfo | null {
    return null;
  }
  setEditValue(_n: number, _value: number): void {}

  // ---- serialization -------------------------------------------------------

  /** Extra numeric fields a subclass wants persisted, after the common header. */
  getDumpAttributes(): number[] {
    return [];
  }
  applyDumpAttributes(_attrs: number[]): void {}

  dump(): string {
    const head = [this.getType(), this.x, this.y, this.x2, this.y2, this.flags];
    return head.concat(this.getDumpAttributes()).join(" ");
  }

  /** Restore geometry + persisted fields when loading from a dump line. */
  load(x: number, y: number, x2: number, y2: number, flags: number, attrs: number[]): void {
    this.x = x;
    this.y = y;
    this.x2 = x2;
    this.y2 = y2;
    this.flags = flags;
    this.applyDumpAttributes(attrs);
    this.allocNodes();
    this.setPoints();
  }
}
