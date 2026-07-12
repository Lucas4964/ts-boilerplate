import { SimElement } from "./SimElement";
import { Graphics } from "../ui/Graphics";
import { Point } from "../geom/Point";
import { EditInfo } from "./EditInfo";
import { registerElement } from "./ElementRegistry";
import { getUnitText, formatPolar, round4 } from "../util/format";
import { Complex } from "../core/Complex";
import type { SimulationManager } from "../core/SimulationManager";

const GRID = 16; // mirror Simulator.gridSize; keeps rotated posts grid-aligned

// Transformer = two magnetically-coupled inductors, modelled exactly like SPICE
// (ngspice mut/ind): the *branch-current* (impedance) formulation. Each winding
// adds a current unknown (reusing the engine's voltage-source rows) and a branch
// equation:
//   transient:  V(p)−V(n) = req·I + reqM·I_other + veq      (trapezoidal companion)
//   phasor:     V(p)−V(n) = jωL·I + jωM·I_other
// with M = k·√(L1·L2). Unlike a Norton/admittance form, this never inverts [L],
// so it stays well-conditioned up to ideal coupling (k→1).
//
// Posts: 0 = primary top, 1 = primary bottom, 2 = secondary top, 3 = secondary bottom.
// L1 = inductance, L2 = inductance/ratio², so `ratio` is the turns ratio N1/N2.
export class TransformerElm extends SimElement {
  inductance = 4; // primary inductance L1 (H)
  ratio = 1; // primary / secondary turns (N1:N2)
  couplingCoef = 0.999;
  orientation = 0; // 0..3 = 0/90/180/270° (see rotate); canonical box is horizontal

  // transient companion resistances (set in stamp) + history sources
  private req1 = 0;
  private req2 = 0;
  private reqM = 0;
  private veq1 = 0;
  private veq2 = 0;
  // (protected so IdealTransformerElm can reuse the geometry/drawing wholesale)
  protected currents: [number, number] = [0, 0]; // solved branch currents [I1, I2]
  protected curcount1 = 0;
  protected curcount2 = 0;

  // phasor-mode solved branch currents
  protected currentPhasor2 = Complex.ZERO; // secondary (currentPhasor holds primary)

  protected posts: Point[] = [new Point(), new Point(), new Point(), new Point()];
  // Canonical (unrotated, horizontal) posts — used by draw() inside the rotation
  // transform. `posts` above holds the rotated (world) posts read by the engine.
  protected cposts: Point[] = [new Point(), new Point(), new Point(), new Point()];

  override getType(): string {
    return "TransformerElm";
  }
  override getPostCount(): number {
    return 4;
  }
  override getPost(n: number): Point {
    return this.posts[n];
  }

  // Two branch currents (primary, secondary) as extra MNA unknowns.
  override getVoltageSourceCount(): number {
    return 2;
  }
  override setVoltageSource(n: number, vs: number): void {
    if (n === 0) this.voltSource = vs; // base id; secondary is voltSource+1
  }

  /** Effective L1, L2, M from the editable (inductance, ratio, coupling). */
  private inductances(): { l1: number; l2: number; m: number } {
    const l1 = this.inductance;
    const l2 = this.inductance / (this.ratio * this.ratio);
    const m = this.couplingCoef * Math.sqrt(l1 * l2);
    return { l1, l2, m };
  }

  override setPoints(): void {
    super.setPoints();
    // Canonical axis-aligned box; primary = left edge, secondary = right edge.
    const xL = this.x;
    const xR = Math.abs(this.x2 - this.x) < 16 ? this.x + 48 : this.x2;
    const yT = this.y;
    const yB = Math.abs(this.y2 - this.y) < 16 ? this.y + 64 : this.y2;
    this.cposts = [
      new Point(xL, yT), // 0 primary top
      new Point(xL, yB), // 1 primary bottom
      new Point(xR, yT), // 2 secondary top
      new Point(xR, yB), // 3 secondary bottom
    ];
    // Rotate the canonical posts into world space by `orientation` about the
    // grid-snapped box centre, so the terminals stay on the grid.
    const ccx = Math.round((xL + xR) / 2 / GRID) * GRID;
    const ccy = Math.round((yT + yB) / 2 / GRID) * GRID;
    this.posts = this.cposts.map((p) => this.rotPost(p, ccx, ccy));
  }

  /** Rotate a canonical post about (ccx,ccy) by `orientation` quarter-turns,
   *  snapped to the grid. Quarter turns are clockwise in screen coords (y-down). */
  private rotPost(p: Point, ccx: number, ccy: number): Point {
    const dx = p.x - ccx;
    const dy = p.y - ccy;
    let nx: number, ny: number;
    switch (this.orientation) {
      case 1:
        nx = -dy;
        ny = dx;
        break; // 90° CW
      case 2:
        nx = -dx;
        ny = -dy;
        break; // 180°
      case 3:
        nx = dy;
        ny = -dx;
        break; // 270° CW
      default:
        nx = dx;
        ny = dy; // 0°
    }
    return new Point(Math.round((ccx + nx) / GRID) * GRID, Math.round((ccy + ny) / GRID) * GRID);
  }

  // Rotate in place (single element) or orbit the group pivot, advancing the
  // orientation state; the canonical (horizontal) footprint is preserved.
  override rotate(quarter: number, cx: number, cy: number, snap: (v: number) => number): void {
    const bx = (this.x + this.x2) / 2;
    const by = (this.y + this.y2) / 2;
    const dx = bx - cx;
    const dy = by - cy;
    let ndx: number, ndy: number;
    if (quarter === 1) {
      ndx = -dy;
      ndy = dx;
    } else if (quarter === -1) {
      ndx = dy;
      ndy = -dx;
    } else {
      ndx = -dx;
      ndy = -dy;
    }
    const ncx = snap(cx + ndx);
    const ncy = snap(cy + ndy);
    const hw = (this.x2 - this.x) / 2;
    const hh = (this.y2 - this.y) / 2;
    this.x = ncx - hw;
    this.y = ncy - hh;
    this.x2 = ncx + hw;
    this.y2 = ncy + hh;
    const q = quarter === -1 ? 3 : quarter;
    this.orientation = (this.orientation + q) % 4;
    this.setPoints();
  }

  // --- transient (branch-current companion) ---------------------------------

  override stamp(sim: SimulationManager): void {
    const { l1, l2, m } = this.inductances();
    const k = 2 / sim.timeStep; // trapezoidal: req = 2L/dt
    this.req1 = k * l1;
    this.req2 = k * l2;
    this.reqM = k * m;
    const vn1 = sim.nodeCount + this.voltSource;
    const vn2 = vn1 + 1;
    this.stampBranch(sim, this.nodes[0], this.nodes[1], vn1, vn2, this.req1, this.reqM);
    this.stampBranch(sim, this.nodes[2], this.nodes[3], vn2, vn1, this.req2, this.reqM);
  }

  /** Stamp one winding's KCL + branch equation (constant part) into row `vn`:
   *  KCL: I leaves `p`, enters `n`; branch eq: V(p)−V(n) − rSelf·I(vn) − rMut·I(vnOther). */
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
    // trapezoidal history: veq = −(req·i_prev + reqM·i_other_prev + v_prev)
    const v1p = this.volts[0] - this.volts[1];
    const v2p = this.volts[2] - this.volts[3];
    const i1p = this.currents[0];
    const i2p = this.currents[1];
    this.veq1 = -(this.req1 * i1p + this.reqM * i2p + v1p);
    this.veq2 = -(this.reqM * i1p + this.req2 * i2p + v2p);
  }

  override doStep(sim: SimulationManager): void {
    const vn1 = sim.nodeCount + this.voltSource;
    sim.stampRightSide(vn1, this.veq1);
    sim.stampRightSide(vn1 + 1, this.veq2);
  }

  override setCurrent(vs: number, c: number): void {
    this.currents[vs - this.voltSource] = c; // solved branch current
  }
  override calculateCurrent(): void {
    this.current = this.currents[0]; // primary, for the dot animation
  }

  // Per-terminal current (into the element): primary winding I1 enters post 0 and
  // leaves post 1; secondary winding I2 enters post 2 and leaves post 3.
  override getPostCurrent(n: number): number {
    const i = n < 2 ? this.currents[0] : this.currents[1];
    return n % 2 === 0 ? i : -i;
  }
  override getPostCurrentPhasor(n: number): Complex {
    const i = n < 2 ? this.currentPhasor : this.currentPhasor2;
    return n % 2 === 0 ? i : i.neg();
  }

  // --- phasor (branch-current, complex impedance) ---------------------------

  override stampPhasor(sim: SimulationManager, omega: number): void {
    const { l1, l2, m } = this.inductances();
    const vn1 = sim.nodeCount + this.voltSource;
    const vn2 = vn1 + 1;
    // Z = jωL  ->  the branch entry is −jωL (so V = jωL·I).
    this.stampBranchC(sim, this.nodes[0], this.nodes[1], vn1, vn2, omega * l1, omega * m);
    this.stampBranchC(sim, this.nodes[2], this.nodes[3], vn2, vn1, omega * l2, omega * m);
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
    if (vs - this.voltSource === 0) this.currentPhasor = c;
    else this.currentPhasor2 = c;
  }

  override reset(): void {
    super.reset();
    this.currents = [0, 0];
    this.veq1 = 0;
    this.veq2 = 0;
    this.currentPhasor2 = Complex.ZERO;
    this.curcount1 = 0;
    this.curcount2 = 0;
  }

  // --- drawing --------------------------------------------------------------

  private drawCoil(g: Graphics, top: Point, bottom: Point, dir: number): void {
    const segs = 32;
    const humps = 4;
    const amp = 8 * dir;
    const xs: number[] = [];
    const ys: number[] = [];
    for (let i = 0; i <= segs; i++) {
      const f = i / segs;
      const off = Math.abs(Math.sin(f * humps * Math.PI)) * amp;
      xs.push(Math.round(top.x + off));
      ys.push(Math.round(top.y + (bottom.y - top.y) * f));
    }
    g.drawPolyline(xs, ys, xs.length);
  }

  override draw(g: Graphics): void {
    // Draw the symbol in its CANONICAL (horizontal) frame inside a canvas
    // rotation, so the existing coil/core/star code is reused verbatim for any
    // orientation. The engine-facing posts (this.posts) are already rotated.
    const xL = this.cposts[0].x;
    const xR = this.cposts[2].x;
    const yT = this.cposts[0].y;
    const yB = this.cposts[1].y;
    // Selection bbox uses the rotated posts (world space), before the transform.
    this.setBbox(this.posts[0].x, this.posts[0].y, this.posts[3].x, this.posts[3].y, 10);
    const ccx = Math.round((xL + xR) / 2 / GRID) * GRID;
    const ccy = Math.round((yT + yB) / 2 / GRID) * GRID;
    g.save();
    g.translate(ccx, ccy);
    g.rotate((this.orientation * Math.PI) / 2);
    g.translate(-ccx, -ccy);
    this.color(g);
    this.drawCoil(g, this.cposts[0], this.cposts[1], +1); // primary, humps toward center
    this.drawCoil(g, this.cposts[2], this.cposts[3], -1); // secondary
    // core lines
    const cx = Math.round((xL + xR) / 2);
    g.drawLine(cx - 3, yT, cx - 3, yB);
    g.drawLine(cx + 3, yT, cx + 3, yB);
    // current animation on each winding
    this.curcount1 = this.updateDotCount(this.currents[0], this.curcount1);
    this.curcount2 = this.updateDotCount(this.currents[1], this.curcount2);
    this.drawDots(g, this.cposts[0], this.cposts[1], this.curcount1);
    this.drawDots(g, this.cposts[2], this.cposts[3], this.curcount2);
    // Dot-convention markers ("*") on the (+) reference terminals: primary post 0
    // (top-left) and secondary post 2 (top-right), nudged inward toward the core
    // so they sit beside the coil rather than on the post. V1/V2 are measured
    // dot→undotted, so these show why the reported sign comes out as it does.
    this.drawRefStar(g, xL + 7, yT + 6);
    this.drawRefStar(g, xR - 7, yT + 6);
    g.restore();
    this.drawPosts(g); // real (rotated) post markers, in world space
  }

  // --- editing / info -------------------------------------------------------

  override getEditInfo(n: number): EditInfo | null {
    if (n === 0) return new EditInfo("Primary Inductance (H)", this.inductance);
    if (n === 1) return EditInfo.precise("Turns Ratio (N1:N2)", this.ratio);
    if (n === 2) return EditInfo.precise("Coupling Coefficient", this.couplingCoef);
    return null;
  }
  override setEditValue(n: number, value: number): void {
    // Coupling up to 1 is allowed — the branch-current form handles ideal
    // coupling (no det = L1L2−M² in a denominator).
    if (n === 0 && value > 0) this.inductance = value;
    else if (n === 1 && value > 0) this.ratio = value;
    else if (n === 2 && value > 0 && value <= 1) this.couplingCoef = value;
  }

  override getDumpAttributes(): number[] {
    return [this.inductance, this.ratio, this.couplingCoef, this.orientation];
  }
  override applyDumpAttributes(a: number[]): void {
    if (a.length > 0) this.inductance = a[0];
    if (a.length > 1) this.ratio = a[1];
    if (a.length > 2) this.couplingCoef = a[2];
    if (a.length > 3) this.orientation = ((a[3] % 4) + 4) % 4;
  }

  override getInfo(): string[] {
    return [
      "Transformer",
      "L1 = " + getUnitText(this.inductance, "H"),
      "n = " + round4(this.ratio),
      "I1 = " + getUnitText(this.currents[0], "A"),
      "I2 = " + getUnitText(this.currents[1], "A"),
    ];
  }

  override getInfoPhasor(): string[] {
    return [
      "Transformer",
      "n = " + round4(this.ratio),
      "I1 = " + formatPolar(this.currentPhasor, "A"),
      "I2 = " + formatPolar(this.currentPhasor2, "A"),
      "V1 = " + formatPolar(this.voltsPhasor[0].sub(this.voltsPhasor[1]), "V"),
      "V2 = " + formatPolar(this.voltsPhasor[2].sub(this.voltsPhasor[3]), "V"),
    ];
  }
}

registerElement({
  name: "TransformerElm",
  label: "Transformer",
  group: "Passive",
  dumpType: 121,
  ctor: (x, y) => new TransformerElm(x, y),
});
