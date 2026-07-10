import { Graphics } from "../ui/Graphics";
import { Point, Rectangle, distanceSq } from "../geom/Point";
import { EditInfo } from "./EditInfo";
import { getUnitText, formatPolar } from "../util/format";
import { Complex } from "../core/Complex";
import type { SimulationManager, AnalysisMode } from "../core/SimulationManager";

/**
 * How an element's current can be expressed DURING the solve, so a
 * current-controlled source can couple to it inside the MNA matrix (a probe
 * reads currents AFTER the solve — that is not enough for control):
 *  - "branch": the current IS an MNA unknown (a voltage-source row) — couple to
 *    matrix column `nodeCount + vs`. Sign = the element's own current convention.
 *  - "linear": i = g·(V(p) − V(n)) + iConst, where p/n are circuit nodes, `g` is
 *    constant per analyze and `iConst` may change every step (companion history,
 *    time-varying source) — re-read it in doStep.
 */
export type CurrentSense = { kind: "branch"; vs: number } | { kind: "linear"; p: number; n: number; g: number; iConst: number };
/** Phasor twin: same shapes, complex coefficient (e.g. jωC) and constant. */
export type CurrentSensePhasor =
  | { kind: "branch"; vs: number }
  | { kind: "linear"; p: number; n: number; y: Complex; iConst: Complex };

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
  volts: number[] = []; // solved voltage at each node (transient mode)
  voltsPhasor: Complex[] = []; // solved node phasors (phasor / AC steady-state mode)
  voltSource = 0; // id of this element's first voltage source (if any)
  current = 0;
  currentPhasor: Complex = Complex.ZERO; // solved current phasor (phasor mode)
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
  static valueColor = "#ffffff"; // on-canvas component value labels
  static valueFontSize = 12;

  // Current analysis mode + global frequency, mirrored here so getEditInfo() can
  // present mode-aware fields (e.g. impedance in Ω) without threading the sim
  // through every call. Set by EditDialog.open() before reading the fields.
  static analysisMode: AnalysisMode = "transient";
  static analysisFrequency = 60;

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

  /** Whether this element has a meaningful per-terminal current a current probe
   *  can clamp onto. False for wires/ground/probes (no computed branch current). */
  currentMeasurable(): boolean {
    return true;
  }

  /** Stamp the constant part of the MNA system (called once per analyze). */
  stamp(_sim: SimulationManager): void {}
  /** Update companion-model sources from the previous step (per timestep). */
  startIteration(): void {}
  /** Stamp time-varying contributions (per timestep, before each solve). */
  doStep(_sim: SimulationManager): void {}

  /**
   * Stamp this element into the complex MNA system for phasor (AC steady-state)
   * analysis at angular frequency `omega` (rad/s). Reactive elements contribute
   * their complex admittance Y = 1/Z (Z_L = jωL, Z_C = 1/(jωC)); independent
   * sources contribute their phasor. Default: nothing (e.g. wires/ground).
   */
  stampPhasor(_sim: SimulationManager, _omega: number): void {}
  /** Derive this element's current phasor from the solved node phasors. */
  calculateCurrentPhasor(): void {}

  // ---- node / voltage plumbing ---------------------------------------------

  allocNodes(): void {
    const n = this.getNodeCount() + this.getVoltageSourceCount();
    this.nodes = new Array(n).fill(-1);
    this.volts = new Array(n).fill(0);
    this.voltsPhasor = new Array(n).fill(Complex.ZERO);
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

  /**
   * Current flowing INTO the element at post `n` (its sign tells the direction).
   * The 2-terminal default routes the branch current to post 0 (+) and post 1
   * (−); multi-terminal parts (transformers) override it per winding/terminal.
   * Used by the clamp-on current probe to read one specific terminal — so on a
   * multi-terminal device, terminal B reads B's current, not A's.
   */
  getPostCurrent(n: number): number {
    return n === 0 ? this.getCurrent() : -this.getCurrent();
  }

  /** Called once per analyze (after node assignment) so a measurement element can
   *  (re)bind to what it measures — e.g. a current probe to the nearest terminal.
   *  Default: nothing. */
  bindMeasurement(_elmList: SimElement[]): void {}

  /**
   * Describe this element's current as a solvable-time quantity (see
   * {@link CurrentSense}) so a current-controlled source can bind to it.
   * Default: null — the current is not expressible (wires, probes,
   * multi-terminal parts). Implementations must compute coefficients from their
   * own parameters + sim.timeStep (not from fields cached in stamp(), which may
   * not have run yet when the controlled source stamps first).
   */
  currentSense(_sim: SimulationManager): CurrentSense | null {
    return null;
  }
  /** Phasor twin of {@link currentSense} (complex coefficient, e.g. jωC). */
  currentSensePhasor(_sim: SimulationManager, _omega: number): CurrentSensePhasor | null {
    return null;
  }

  /** Hook called by the serializer right before dump(), with the full list —
   *  lets an element persist a reference to another as a list index. */
  beforeDump(_elmList: SimElement[]): void {}

  /** Phasor counterpart of setCurrent: receives a solved branch-current phasor
   *  for voltage source `vs`. Multi-source elements (transformer) override it. */
  setCurrentPhasor(_vs: number, c: Complex): void {
    this.currentPhasor = c;
  }

  /**
   * Index of the post treated as the *positive* voltage reference — the
   * terminal marked with the small white dot. The info panel shows
   *   Vd = V(reference) - V(other),
   * so the user can read straight off the symbol how the displayed voltage was
   * computed. Passive elements keep post 0; voltage sources point it at their
   * (+) terminal (see VoltageElm).
   */
  getReferenceNode(): number {
    return 0;
  }

  /** Voltage across the element, measured from the reference post (see above). */
  getVoltageDiff(): number {
    return this.getReferenceNode() === 1 ? this.volts[1] - this.volts[0] : this.volts[0] - this.volts[1];
  }

  // ---- phasor (AC steady-state) results ------------------------------------

  getCurrentPhasor(): Complex {
    return this.currentPhasor;
  }
  /** Phasor counterpart of {@link getPostCurrent}: current phasor into post `n`. */
  getPostCurrentPhasor(n: number): Complex {
    return n === 0 ? this.getCurrentPhasor() : this.getCurrentPhasor().neg();
  }
  /** Complex voltage across the element, measured from the reference post. */
  getVoltageDiffPhasor(): Complex {
    return this.getReferenceNode() === 1
      ? this.voltsPhasor[1].sub(this.voltsPhasor[0])
      : this.voltsPhasor[0].sub(this.voltsPhasor[1]);
  }
  /** Complex power S = V·conj(I) (VA): |S| is apparent, re=P, im=Q. */
  getPowerPhasor(): Complex {
    return this.getVoltageDiffPhasor().mul(this.getCurrentPhasor().conj());
  }
  reset(): void {
    for (let i = 0; i < this.volts.length; i++) this.volts[i] = 0;
    this.voltsPhasor = this.voltsPhasor.map(() => Complex.ZERO);
    this.current = 0;
    this.currentPhasor = Complex.ZERO;
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

  /**
   * Rotate the element by a multiple of 90° around a pivot (world coords),
   * snapping the result to the grid. `quarter` is +1 (90° clockwise, screen
   * y-down), -1 (90° counter-clockwise), or 2 (180°). For a single element the
   * pivot is its own centre (rotate in place); for a group it is the group's
   * centre (the elements orbit it). The default rotates the two defining
   * endpoints — enough for every linear / single-terminal symbol, whose draw and
   * hit-test follow the point1→point2 axis. Box-based parts (transformers)
   * override this to also advance an orientation state.
   */
  rotate(quarter: number, cx: number, cy: number, snap: (v: number) => number): void {
    const r = (px: number, py: number): { x: number; y: number } => {
      const dx = px - cx;
      const dy = py - cy;
      let nx: number, ny: number;
      if (quarter === 1) {
        nx = -dy;
        ny = dx;
      } else if (quarter === -1) {
        nx = dy;
        ny = -dx;
      } else {
        nx = -dx;
        ny = -dy;
      }
      return { x: snap(cx + nx), y: snap(cy + ny) };
    };
    const p1 = r(this.x, this.y);
    const p2 = r(this.x2, this.y2);
    this.setPosition(p1.x, p1.y, p2.x, p2.y);
  }

  /**
   * Whether the element exposes endpoint handles for resize/reorient by drag.
   * Two-terminal elements do; single-terminal symbols (e.g. ground) opt in so
   * they can still be stretched and rotated even though they have one post.
   */
  protected hasHandles(): boolean {
    return this.getPostCount() >= 2;
  }

  /**
   * Endpoint offset applied when the element is created with a plain click
   * (no drag-out), so it gets a sensible default size instead of vanishing.
   * Horizontal stub by default; override to point a symbol elsewhere.
   */
  getDefaultDragOffset(): { dx: number; dy: number } {
    return { dx: 64, dy: 0 };
  }

  /**
   * Placement style: false (default) = press-drag-release sets both endpoints in
   * one gesture; true = two separate clicks (click A, then click B). The
   * differential voltage probe uses two-click placement.
   */
  usesTwoClickPlacement(): boolean {
    return false;
  }

  /**
   * Index (0 or 1) of the drag handle within `hitDist` (world units) of
   * (wx, wy), or -1 if none. The handles are the two defining endpoints; moving
   * just one expands/compresses the element (CircuitJS's drag-post behaviour).
   */
  nearestHandle(wx: number, wy: number, hitDist: number): number {
    if (!this.hasHandles()) return -1;
    const r2 = hitDist * hitDist;
    const d0 = distanceSq(wx, wy, this.x, this.y);
    const d1 = distanceSq(wx, wy, this.x2, this.y2);
    if (d0 <= r2 && d0 <= d1) return 0;
    if (d1 <= r2) return 1;
    return -1;
  }

  /** Move a single endpoint (expansion/compression), leaving the other fixed. */
  dragHandle(which: number, gx: number, gy: number): void {
    if (which === 0) {
      this.x = gx;
      this.y = gy;
    } else {
      this.x2 = gx;
      this.y2 = gy;
    }
    this.setPoints();
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

  /**
   * Distance from (px,py) to this element's drawn shape, used for click
   * hit-testing — 0 when the point is on/inside the body. The default hugs the
   * post-to-post segment (right for thin, linear elements: wires, R/L/C, leads);
   * elements with a 2-D body override it (a source adds its circle, a
   * transformer its rectangle) so the hit area matches the real symbol instead
   * of a padded bounding box.
   */
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

  /**
   * Small white dot beside the reference terminal (see getReferenceNode), so
   * the user can see at a glance which node is the positive voltage reference.
   * Placed at the body end on the reference side, nudged perpendicular so it
   * sits next to the symbol rather than on the wire.
   */
  protected drawReferenceMark(g: Graphics): void {
    const base = this.getReferenceNode() === 1 ? this.lead2 : this.lead1;
    const cx = Math.round(base.x + this.dpx1 * 8);
    const cy = Math.round(base.y + this.dpy1 * 8);
    this.drawRefStar(g, cx, cy);
  }

  /** Draw the reference-terminal marker — a small white "*" centered on (x, y).
   *  (Replaces the former dot; shared by R/L/C, sources and the transformers.) */
  protected drawRefStar(g: Graphics, x: number, y: number): void {
    g.setColor("#ffffff");
    g.setFontSize(11);
    const w = g.measureWidth("*");
    g.drawString("*", x - w / 2, y + 4); // baseline nudge to visually center "*"
  }

  /** Value text to print beside the element on the canvas (e.g. "1H", "j377").
   *  Default: nothing. R/L/C override it (mode-aware). */
  protected canvasValueText(): string {
    return "";
  }

  /**
   * Draw `s` next to the body, always horizontally so it stays legible at any
   * orientation: centered above a horizontal element, or to the side of a
   * vertical/diagonal one (flipped to the left for the x<x2 && y>y2 diagonal so
   * it doesn't sit on the symbol). Faithful port of CircuitElm.drawValues; `hs`
   * is the perpendicular offset (clear of the symbol's half-width).
   */
  protected drawValues(g: Graphics, s: string, hs: number): void {
    if (s === "") return;
    g.setFontSize(SimElement.valueFontSize);
    const w = g.measureWidth(s);
    g.setColor(SimElement.valueColor);
    const ya = SimElement.valueFontSize / 2;
    const xc = (this.x + this.x2) / 2;
    const yc = (this.y + this.y2) / 2;
    const dpx = this.dpx1 * hs;
    const dpy = this.dpy1 * hs;
    if (Math.round(dpx) === 0) {
      g.drawString(s, xc - w / 2, yc - Math.abs(dpy) - 2);
    } else {
      let xx = xc + Math.abs(dpx) + 2;
      if (this.x < this.x2 && this.y > this.y2) xx = xc - (w + Math.abs(dpx) + 2);
      g.drawString(s, xx, yc + dpy + ya);
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

  /** Instantaneous power dissipated/absorbed (V·I). Override for multiport parts. */
  getPower(): number {
    return this.getVoltageDiff() * this.getCurrent();
  }

  /**
   * Oscillation frequency this element imposes on the circuit, or 0 if none.
   * The info panel shows the circuit's operating frequency `fo` (the max over
   * all elements), so an AC source reports its frequency here.
   */
  getOscillationFrequency(): number {
    return 0;
  }

  // Shared info-line builders so every element labels quantities the same way
  // (matches CircuitJS: "I = …", "Vd = …", "P = …").
  protected currentInfo(): string {
    return "I = " + getUnitText(this.getCurrent(), "A");
  }
  protected voltageDiffInfo(): string {
    return "Vd = " + getUnitText(this.getVoltageDiff(), "V");
  }
  protected powerInfo(): string {
    return "P = " + getUnitText(this.getPower(), "W");
  }

  // Phasor counterparts: same labels, values shown in polar form (mag ∠ angle°).
  protected currentInfoPhasor(): string {
    return "I = " + formatPolar(this.getCurrentPhasor(), "A");
  }
  protected voltageDiffInfoPhasor(): string {
    return "Vd = " + formatPolar(this.getVoltageDiffPhasor(), "V");
  }
  protected powerInfoPhasor(): string {
    return "S = " + formatPolar(this.getPowerPhasor(), "VA");
  }

  getInfo(): string[] {
    return [this.getType()];
  }

  /** Info lines for phasor mode (polar form). Defaults to the transient lines. */
  getInfoPhasor(): string[] {
    return this.getInfo();
  }

  /** Called when an edit dialog opens, to reset transient edit-UI state (e.g.
   *  the L/C unit combobox back to its default). Default: nothing. */
  beginEdit(): void {}

  getEditInfo(_n: number): EditInfo | null {
    return null;
  }
  setEditValue(_n: number, _value: number): void {}

  /** Change the unit selected for field `n`'s combobox (see EditInfo.unitChoices).
   *  Affects how getEditInfo/setEditValue interpret that field. Default: nothing. */
  setEditUnit(_n: number, _choiceIndex: number): void {}

  /** Pick option `choiceIndex` for a pure-choice field `n` (see EditInfo.choices),
   *  e.g. a transformer's vector group. May change topology (node count), so the
   *  dialog re-analyzes afterwards. Default: nothing. */
  setEditChoice(_n: number, _choiceIndex: number): void {}

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
