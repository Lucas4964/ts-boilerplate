import { SimElement } from "./SimElement";
import { Graphics } from "../ui/Graphics";
import { Point, distanceToRect } from "../geom/Point";
import { EditInfo } from "./EditInfo";
import { registerElement } from "./ElementRegistry";
import { getShortUnitText, round4 } from "../util/format";
import { Complex } from "../core/Complex";
import type { SimulationManager } from "../core/SimulationManager";

// Three-phase transformer as a SINGLE 6-terminal block (3 primary + 3 secondary
// line terminals). The winding topology (Δ/Y, grounding) and the vector group
// are chosen in the edit dialog — NOT by the on-canvas symbol.
//
// Internally it is a *bank* of three coupled single-phase units (one magnetic
// core per phase), modelled exactly like our single-phase TransformerElm: the
// branch-current (impedance) formulation, robust up to ideal coupling (k=1).
// The connection type only decides HOW each winding's two ends map onto the
// line terminals / neutral, which is what produces the ±30° vector-group shift:
//   - Y winding i  : line_i  ↔  neutral   (neutral = ground if grounded, else an
//                                           internal floating node)
//   - Δ⁺ winding i : line_i  ↔  line_(i+1)
//   - Δ⁻ winding i : line_i  ↔  line_(i+2)
// The √3 between line and winding voltage on a Δ side is folded into the per-unit
// turns ratio (see windingRatio).
//
// Posts: 0,1,2 = primary A,B,C (left);  3,4,5 = secondary a,b,c (right).

type Conn = "Y" | "D+" | "D-";
interface VectorGroup {
  name: string; // combobox label (connection + clock; grounding is a separate toggle)
  prim: Conn;
  sec: Conn;
  clock: number; // hours of secondary lag (×30°), for the displayed IEC name
}

// Didactic core set. The clock number is realised purely by the Δ orientation
// (Δ⁺ → secondary leads by 30°, Δ⁻ → lags), verified numerically.
const GROUPS: VectorGroup[] = [
  { name: "Yy0", prim: "Y", sec: "Y", clock: 0 },
  { name: "Dy11", prim: "D+", sec: "Y", clock: 11 },
  { name: "Dy1", prim: "D-", sec: "Y", clock: 1 },
  { name: "Yd11", prim: "Y", sec: "D-", clock: 11 },
  { name: "Dd0", prim: "D+", sec: "D+", clock: 0 },
];
const ROOT3 = Math.sqrt(3);

export class ThreePhaseTransformerElm extends SimElement {
  inductance = 4; // primary winding self-inductance L1 per phase (H, magnetizing)
  ratio = 1; // nominal LINE-to-line voltage ratio VLL_pri : VLL_sec
  couplingCoef = 0.999;
  vectorGroupIndex = 0; // default Yy0
  // Neutral grounding per Y side (no effect on a Δ side). Default grounded — the
  // stable, expected behaviour; an isolated Y neutral floats and, with an
  // unbalanced load, shifts (the classic Yy neutral instability).
  primNeutralGrounded = true;
  secNeutralGrounded = true;

  // transient companion: per-winding history sources + solved branch currents
  private reqP = 0;
  private reqS = 0;
  private reqM = 0;
  private veq: number[] = new Array(6).fill(0);
  private currents: number[] = new Array(6).fill(0); // [P0,S0,P1,S1,P2,S2]
  private currentsPhasor: Complex[] = new Array(6).fill(Complex.ZERO);
  private curcounts: number[] = new Array(6).fill(0);

  private posts: Point[] = Array.from({ length: 6 }, () => new Point());

  override getType(): string {
    return "ThreePhaseTransformerElm";
  }
  override getPostCount(): number {
    return 6;
  }
  override getPost(n: number): Point {
    return this.posts[n];
  }

  // Hit-test by the block's footprint (primary A corner to secondary c corner),
  // so the whole 6-terminal box is grabbable without a padded halo.
  override distanceTo(px: number, py: number): number {
    return distanceToRect(px, py, this.posts[0].x, this.posts[0].y, this.posts[5].x, this.posts[5].y);
  }

  private group(): VectorGroup {
    return GROUPS[this.vectorGroupIndex];
  }

  /** True when `side`'s Y neutral floats (Y and not grounded). */
  private primFloating(): boolean {
    return this.group().prim === "Y" && !this.primNeutralGrounded;
  }
  private secFloating(): boolean {
    return this.group().sec === "Y" && !this.secNeutralGrounded;
  }

  /** Full IEC-style name including grounding, e.g. Yy0 → "YNyn0" when both Y
   *  neutrals are grounded, "Yyn0" / "YNy0" when mixed, "Yy0" when isolated. */
  private displayName(): string {
    const g = this.group();
    const p = g.prim !== "Y" ? "D" : this.primNeutralGrounded ? "YN" : "Y";
    const s = g.sec !== "Y" ? "d" : this.secNeutralGrounded ? "yn" : "y";
    return p + s + g.clock;
  }

  // One internal node per floating (isolated) Y neutral (primary first, then secondary).
  override getInternalNodeCount(): number {
    return (this.primFloating() ? 1 : 0) + (this.secFloating() ? 1 : 0);
  }

  // Six branch currents (3 phases × 2 windings) as extra MNA unknowns.
  override getVoltageSourceCount(): number {
    return 6;
  }
  override setVoltageSource(n: number, vs: number): void {
    if (n === 0) this.voltSource = vs; // base id; winding k uses voltSource + k
  }

  /** Per-unit turns ratio Ns/Np, with the √3 line/winding factor folded in so
   *  `ratio` stays the nameplate line-to-line voltage ratio. */
  private windingRatio(): number {
    const g = this.group();
    const primDelta = g.prim !== "Y";
    const secDelta = g.sec !== "Y";
    // n_w = Vw_pri / Vw_sec = ratio · (Δ:1, Y:1/√3 on each side)
    const nW = (this.ratio * (primDelta ? 1 : 1 / ROOT3)) / (secDelta ? 1 : 1 / ROOT3);
    return 1 / nW; // ratioUnit = Ns/Np
  }
  private inductances(): { l1: number; l2: number; m: number } {
    const l1 = this.inductance;
    const ru = this.windingRatio();
    const l2 = l1 * ru * ru;
    const m = this.couplingCoef * Math.sqrt(l1 * l2);
    return { l1, l2, m };
  }

  /** Local node index of phase `i`'s line terminal on `side` (0 = primary). */
  private lineLocal(side: number, i: number): number {
    return (side === 0 ? 0 : 3) + (i % 3);
  }
  /** Local index of `side`'s neutral, or -1 when it is ground. Only valid for Y.
   *  A grounded Y neutral maps to ground (node 0); a floating one gets an internal
   *  node (primary at index 6, secondary after it). */
  private neutralLocal(side: number): number {
    if (side === 0) return this.primFloating() ? 6 : -1;
    return this.secFloating() ? 6 + (this.primFloating() ? 1 : 0) : -1;
  }
  /** {p, n} local node indices for winding (side, phase i); -1 means ground. */
  private windingLocal(side: number, i: number): { p: number; n: number } {
    const conn = side === 0 ? this.group().prim : this.group().sec;
    const line = (j: number): number => this.lineLocal(side, j);
    if (conn === "Y") return { p: line(i), n: this.neutralLocal(side) };
    if (conn === "D+") return { p: line(i), n: line(i + 1) };
    return { p: line(i), n: line(i + 2) }; // D-
  }
  /** Circuit node for a local index (-1 → ground node 0). */
  private cnode(local: number): number {
    return local < 0 ? 0 : this.nodes[local];
  }
  /** Solved transient voltage at a local index (-1 → 0 V). */
  private lvolt(local: number): number {
    return local < 0 ? 0 : this.volts[local];
  }

  override setPoints(): void {
    super.setPoints();
    const xL = this.x;
    const xR = Math.abs(this.x2 - this.x) < 32 ? this.x + 112 : this.x2;
    const yT = this.y;
    const yB = Math.abs(this.y2 - this.y) < 32 ? this.y + 96 : this.y2;
    // Snap the middle row (phase B/b posts) to the grid so it stays connectable
    // even when the dragged height is an odd multiple of the grid (GRID mirrors
    // Simulator.gridSize). The plain centre would land off-grid for those heights.
    const GRID = 16;
    const yM = yT + Math.max(GRID, Math.round((yB - yT) / 2 / GRID) * GRID);
    this.posts = [
      new Point(xL, yT),
      new Point(xL, yM),
      new Point(xL, yB),
      new Point(xR, yT),
      new Point(xR, yM),
      new Point(xR, yB),
    ];
  }

  // --- transient (branch-current companion) ---------------------------------

  override stamp(sim: SimulationManager): void {
    const { l1, l2, m } = this.inductances();
    const k = 2 / sim.timeStep; // trapezoidal: req = 2L/dt
    this.reqP = k * l1;
    this.reqS = k * l2;
    this.reqM = k * m;
    for (let i = 0; i < 3; i++) {
      const vnP = sim.nodeCount + this.voltSource + 2 * i;
      const vnS = vnP + 1;
      const wp = this.windingLocal(0, i);
      const ws = this.windingLocal(1, i);
      this.stampBranch(sim, this.cnode(wp.p), this.cnode(wp.n), vnP, vnS, this.reqP, this.reqM);
      this.stampBranch(sim, this.cnode(ws.p), this.cnode(ws.n), vnS, vnP, this.reqS, this.reqM);
    }
  }

  private stampBranch(
    sim: SimulationManager,
    p: number,
    n: number,
    vn: number,
    vnOther: number,
    rSelf: number,
    rMut: number,
  ): void {
    sim.stampMatrix(p, vn, 1);
    sim.stampMatrix(n, vn, -1);
    sim.stampMatrix(vn, p, 1);
    sim.stampMatrix(vn, n, -1);
    sim.stampMatrix(vn, vn, -rSelf);
    sim.stampMatrix(vn, vnOther, -rMut);
  }

  override startIteration(): void {
    for (let i = 0; i < 3; i++) {
      const wp = this.windingLocal(0, i);
      const ws = this.windingLocal(1, i);
      const v1p = this.lvolt(wp.p) - this.lvolt(wp.n);
      const v2p = this.lvolt(ws.p) - this.lvolt(ws.n);
      const i1p = this.currents[2 * i];
      const i2p = this.currents[2 * i + 1];
      this.veq[2 * i] = -(this.reqP * i1p + this.reqM * i2p + v1p);
      this.veq[2 * i + 1] = -(this.reqM * i1p + this.reqS * i2p + v2p);
    }
  }

  override doStep(sim: SimulationManager): void {
    const base = sim.nodeCount + this.voltSource;
    for (let k = 0; k < 6; k++) sim.stampRightSide(base + k, this.veq[k]);
  }

  override setCurrent(vs: number, c: number): void {
    this.currents[vs - this.voltSource] = c;
  }
  override calculateCurrent(): void {
    this.current = this.lineCurrent(0); // primary A line current, for the dot animation
  }

  // Per-terminal current = the line current into that terminal (handles the
  // distinct current at each of the 6 terminals — e.g. terminal B ≠ terminal A).
  override getPostCurrent(n: number): number {
    return this.lineCurrent(n);
  }
  override getPostCurrentPhasor(n: number): Complex {
    return this.lineCurrentPhasor(n);
  }

  /** External LINE current into local terminal `t`, by KCL over the windings:
   *  each branch current I_k leaves its `p` node and enters its `n` node, so the
   *  current the external circuit must feed into the terminal is
   *  Σ(p==t) I_k − Σ(n==t) I_k. For a Y winding this equals the winding current;
   *  for Δ it is the √3-larger difference of two winding currents. */
  private lineCurrent(t: number): number {
    let sum = 0;
    for (let i = 0; i < 3; i++) {
      const wp = this.windingLocal(0, i);
      const ws = this.windingLocal(1, i);
      if (wp.p === t) sum += this.currents[2 * i];
      if (wp.n === t) sum -= this.currents[2 * i];
      if (ws.p === t) sum += this.currents[2 * i + 1];
      if (ws.n === t) sum -= this.currents[2 * i + 1];
    }
    return sum;
  }
  /** Phasor counterpart of {@link lineCurrent}. */
  private lineCurrentPhasor(t: number): Complex {
    let sum = Complex.ZERO;
    for (let i = 0; i < 3; i++) {
      const wp = this.windingLocal(0, i);
      const ws = this.windingLocal(1, i);
      if (wp.p === t) sum = sum.add(this.currentsPhasor[2 * i]);
      if (wp.n === t) sum = sum.sub(this.currentsPhasor[2 * i]);
      if (ws.p === t) sum = sum.add(this.currentsPhasor[2 * i + 1]);
      if (ws.n === t) sum = sum.sub(this.currentsPhasor[2 * i + 1]);
    }
    return sum;
  }

  // --- phasor (branch-current, complex impedance) ---------------------------

  override stampPhasor(sim: SimulationManager, omega: number): void {
    const { l1, l2, m } = this.inductances();
    for (let i = 0; i < 3; i++) {
      const vnP = sim.nodeCount + this.voltSource + 2 * i;
      const vnS = vnP + 1;
      const wp = this.windingLocal(0, i);
      const ws = this.windingLocal(1, i);
      this.stampBranchC(sim, this.cnode(wp.p), this.cnode(wp.n), vnP, vnS, omega * l1, omega * m);
      this.stampBranchC(sim, this.cnode(ws.p), this.cnode(ws.n), vnS, vnP, omega * l2, omega * m);
    }
  }

  private stampBranchC(
    sim: SimulationManager,
    p: number,
    n: number,
    vn: number,
    vnOther: number,
    xSelf: number,
    xMut: number,
  ): void {
    sim.stampMatrixC(p, vn, Complex.ONE);
    sim.stampMatrixC(n, vn, Complex.ONE.neg());
    sim.stampMatrixC(vn, p, Complex.ONE);
    sim.stampMatrixC(vn, n, Complex.ONE.neg());
    sim.stampMatrixC(vn, vn, new Complex(0, -xSelf)); // −jωL
    sim.stampMatrixC(vn, vnOther, new Complex(0, -xMut)); // −jωM
  }

  override setCurrentPhasor(vs: number, c: Complex): void {
    this.currentsPhasor[vs - this.voltSource] = c;
  }

  override reset(): void {
    super.reset();
    this.currents = new Array(6).fill(0);
    this.currentsPhasor = new Array(6).fill(Complex.ZERO);
    this.veq = new Array(6).fill(0);
    this.curcounts = new Array(6).fill(0);
  }

  // --- drawing --------------------------------------------------------------

  override draw(g: Graphics): void {
    const xL = this.posts[0].x;
    const xR = this.posts[3].x;
    const yT = this.posts[0].y;
    const yB = this.posts[2].y;
    this.setBbox(xL, yT, xR, yB, 14);
    const bodyL = xL + 22;
    const bodyR = xR - 22;
    const bodyT = yT - 10;
    const bodyB = yB + 10;

    this.color(g);
    g.drawRect(bodyL, bodyT, bodyR - bodyL, bodyB - bodyT);
    // terminal stubs
    for (let i = 0; i < 3; i++) g.drawLine(this.posts[i].x, this.posts[i].y, bodyL, this.posts[i].y);
    for (let i = 3; i < 6; i++) g.drawLine(this.posts[i].x, this.posts[i].y, bodyR, this.posts[i].y);
    // current animation along the stubs — each stub carries its terminal's LINE
    // current (curcounts indexed by terminal 0..5)
    for (let t = 0; t < 6; t++) {
      this.curcounts[t] = this.updateDotCount(this.lineCurrent(t), this.curcounts[t]);
    }
    for (let i = 0; i < 3; i++) {
      this.drawDots(g, this.posts[i], new Point(bodyL, this.posts[i].y), this.curcounts[i]);
      this.drawDots(g, this.posts[3 + i], new Point(bodyR, this.posts[3 + i].y), this.curcounts[3 + i]);
    }

    // phase labels
    g.setColor(SimElement.elementColor);
    g.setFontSize(11);
    const pl = ["A", "B", "C"];
    const sl = ["a", "b", "c"];
    for (let i = 0; i < 3; i++) {
      g.drawString(pl[i], bodyL + 3, this.posts[i].y - 3);
      g.drawString(sl[i], bodyR - 9, this.posts[3 + i].y - 3);
    }

    // vector group + ratio, centered
    const cx = Math.round((bodyL + bodyR) / 2);
    const cy = this.posts[1].y;
    g.setColor(SimElement.valueColor);
    g.setFontSize(13);
    const name = this.displayName();
    g.drawString(name, cx - g.measureWidth(name) / 2, cy - 2);
    g.setFontSize(10);
    const rt = "n=" + round4(this.ratio);
    g.drawString(rt, cx - g.measureWidth(rt) / 2, cy + 12);

    // dot-convention markers ("*") on the primary/secondary phase-A reference terminals
    this.drawRefStar(g, bodyL + 4, yT + 5);
    this.drawRefStar(g, bodyR - 4, yT + 5);

    this.drawPosts(g);
  }

  // --- editing / info -------------------------------------------------------

  // Dialog fields, in order. The neutral toggles appear only for Y sides, so the
  // layout is dynamic (kept contiguous — the dialog stops at the first null).
  private editFields(): string[] {
    const f = ["group", "ratio", "inductance", "coupling"];
    if (this.group().prim === "Y") f.push("primN");
    if (this.group().sec === "Y") f.push("secN");
    return f;
  }

  override getEditInfo(n: number): EditInfo | null {
    switch (this.editFields()[n]) {
      case "group":
        return EditInfo.choice("Vector group", GROUPS.map((x) => x.name), this.vectorGroupIndex);
      case "ratio":
        return new EditInfo("Line voltage ratio (VLLp:VLLs)", this.ratio);
      case "inductance":
        return new EditInfo("Primary Inductance (H)", this.inductance);
      case "coupling":
        return EditInfo.precise("Coupling Coefficient", this.couplingCoef);
      case "primN":
        return EditInfo.choice("Primary neutral", ["Grounded", "Isolated"], this.primNeutralGrounded ? 0 : 1);
      case "secN":
        return EditInfo.choice("Secondary neutral", ["Grounded", "Isolated"], this.secNeutralGrounded ? 0 : 1);
      default:
        return null;
    }
  }
  override setEditValue(n: number, value: number): void {
    const f = this.editFields()[n];
    if (f === "ratio" && value > 0) this.ratio = value;
    else if (f === "inductance" && value > 0) this.inductance = value;
    else if (f === "coupling" && value > 0 && value <= 1) this.couplingCoef = value;
  }
  override setEditChoice(n: number, choiceIndex: number): void {
    const f = this.editFields()[n];
    if (f === "group" && choiceIndex >= 0 && choiceIndex < GROUPS.length) this.vectorGroupIndex = choiceIndex;
    else if (f === "primN") this.primNeutralGrounded = choiceIndex === 0;
    else if (f === "secN") this.secNeutralGrounded = choiceIndex === 0;
  }

  override getDumpAttributes(): number[] {
    return [
      this.ratio,
      this.inductance,
      this.couplingCoef,
      this.vectorGroupIndex,
      this.primNeutralGrounded ? 1 : 0,
      this.secNeutralGrounded ? 1 : 0,
    ];
  }
  override applyDumpAttributes(a: number[]): void {
    if (a.length > 0) this.ratio = a[0];
    if (a.length > 1) this.inductance = a[1];
    if (a.length > 2) this.couplingCoef = a[2];
    if (a.length > 3) this.vectorGroupIndex = Math.max(0, Math.min(GROUPS.length - 1, Math.round(a[3])));
    if (a.length > 4) this.primNeutralGrounded = a[4] !== 0;
    if (a.length > 5) this.secNeutralGrounded = a[5] !== 0;
  }

  // --- info panel: every phase, grouped by side ------------------------------

  /** Magnitude with an SI prefix, no unit (the row label says V or I), at 4
   *  decimal places with trailing zeros stripped, e.g. 0.8564 → "856.4m". */
  private fmt(x: number): string {
    return getShortUnitText(x, "");
  }
  /** Compact polar "mag∠deg°" (no unit) so three phases fit on one line. */
  private polar(c: Complex): string {
    const deg = c.abs() < 1e-14 ? "0" : round4((c.arg() * 180) / Math.PI);
    return this.fmt(c.abs()) + "∠" + deg + "°";
  }
  // Monospace row: "Lbl  A <val>   B <val>   C <val>" with padded cells so the
  // A/B/C columns line up across the four rows (panel font is monospace).
  private phaseRow(label: string, vals: string[]): string {
    const tag = ["A", "B", "C"];
    const cells = vals.map((v, i) => (tag[i] + " " + v).padEnd(22));
    return label.padEnd(3) + cells.join("");
  }

  override getInfo(): string[] {
    const v = (i: number): string => this.fmt(this.volts[i]);
    const a = (i: number): string => this.fmt(this.lineCurrent(i));
    return [
      "3φ Transformer (" + this.displayName() + ")  n=" + round4(this.ratio),
      this.phaseRow("Vp", [v(0), v(1), v(2)]),
      this.phaseRow("Vs", [v(3), v(4), v(5)]),
      this.phaseRow("Ip", [a(0), a(1), a(2)]),
      this.phaseRow("Is", [a(3), a(4), a(5)]),
    ];
  }

  override getInfoPhasor(): string[] {
    const v = (i: number): string => this.polar(this.voltsPhasor[i]);
    const a = (i: number): string => this.polar(this.lineCurrentPhasor(i));
    return [
      "3φ Transformer (" + this.displayName() + ")  n=" + round4(this.ratio),
      this.phaseRow("Vp", [v(0), v(1), v(2)]),
      this.phaseRow("Vs", [v(3), v(4), v(5)]),
      this.phaseRow("Ip", [a(0), a(1), a(2)]),
      this.phaseRow("Is", [a(3), a(4), a(5)]),
    ];
  }
}

registerElement({
  name: "ThreePhaseTransformerElm",
  label: "3φ Transformer",
  group: "Passive",
  dumpType: 122,
  ctor: (x, y) => new ThreePhaseTransformerElm(x, y),
});
