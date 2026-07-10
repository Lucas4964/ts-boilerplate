import { SimElement } from "./SimElement";
import { Graphics } from "../ui/Graphics";
import { Point, distanceToRect } from "../geom/Point";
import { EditInfo } from "./EditInfo";
import { registerElement } from "./ElementRegistry";
import { getUnitText, formatPolar, round4 } from "../util/format";
import { Complex } from "../core/Complex";
import type { SimulationManager } from "../core/SimulationManager";

// The four LINEAR dependent sources (VCVS, VCCS, CCVS, CCCS), modelled after
// ngspice's E/G/H/F devices: constant MNA stamps, no Newton iteration, and the
// SAME real coefficients in the phasor (AC) matrix — the gains are frequency-
// independent. The self-contained 4-terminal topology follows Falstad's chips:
//   posts 0 = c+ (top-left), 1 = c− (bottom-left)   — control pair
//   posts 2 = out+ (top-right), 3 = out− (bottom-right) — output pair
// Voltage control (VCxS): wire c+/c− in PARALLEL with the sensed component (the
// pair is ideal — it draws no current). Current control (CCxS): wire c+/c− in
// SERIES into the sensed branch — internally it is a 0 V source (an ideal
// ammeter) whose solved branch current is the control variable.
// Output conventions: for voltage outputs, out+ is driven positive by a positive
// control; for current outputs, positive output current EXITS out+.
//
// ngspice stamps implemented (vcvsload.c / vccsload.c / cccsload.c / ccvsload.c):
//   E: branch row  V(o+)−V(o−) − μ·(Vc+−Vc−) = 0
//   G: ±gm block at (out±, c±)                       (no extra unknown)
//   F: ±β at (out±, sense-branch column)             (sense = internal 0 V row)
//   H: branch row  V(o+)−V(o−) − r·I_sense = 0

const GRID = 16; // mirror Simulator.gridSize; keeps rotated posts grid-aligned

/** Complex-coefficient VCCS stamp (for a bound L/C control in phasor mode,
 *  where the coupling is β·jωC etc. — stampVCCurrentSourceC only takes a real g). */
function stampVCCSComplex(sim: SimulationManager, cn1: number, cn2: number, vn1: number, vn2: number, y: Complex): void {
  sim.stampMatrixC(cn1, vn1, y);
  sim.stampMatrixC(cn2, vn2, y);
  sim.stampMatrixC(cn1, vn2, y.neg());
  sim.stampMatrixC(cn2, vn1, y.neg());
}

export abstract class ControlledSourceElm extends SimElement {
  gain = 1;
  orientation = 0; // 0..3 = 0/90/180/270°, same pattern as the transformers

  // Optional BOUND control: instead of wiring c+/c−, the control variable is
  // another element picked on the canvas (Edit dialog → Control → Pick). The
  // control then equals exactly the quantity that element's info panel shows
  // (its Vd with its own reference polarity, or its I with its own direction).
  // Persisted as an index into the element list (−1 = wired mode).
  controlTarget: SimElement | null = null;
  private pendingTargetIndex = -1;

  protected posts: Point[] = Array.from({ length: 4 }, () => new Point());
  protected cposts: Point[] = Array.from({ length: 4 }, () => new Point());

  override getPostCount(): number {
    return 4;
  }
  override getPost(n: number): Point {
    return this.posts[n];
  }

  /** Label for the gain edit field, e.g. "Gain (V/V)". */
  protected abstract gainLabel(): string;
  /** Short gain prefix drawn on the canvas, e.g. "μ=", "gm=". */
  protected abstract gainPrefix(): string;
  /** True when the OUTPUT is a current (diamond gets an arrow, not +/−). */
  protected abstract currentOutput(): boolean;
  /** True when the CONTROL is a current (c pair is a series 0 V sense). */
  protected abstract currentControl(): boolean;
  /** Output current delivered out of the out+ terminal. */
  protected abstract outputCurrent(): number;
  protected abstract outputCurrentPhasor(): Complex;

  override setPoints(): void {
    super.setPoints();
    // Canonical axis-aligned square-ish box; control = left, output = right.
    const xL = this.x;
    const xR = Math.abs(this.x2 - this.x) < 16 ? this.x + 64 : this.x2;
    const yT = this.y;
    const yB = Math.abs(this.y2 - this.y) < 16 ? this.y + 64 : this.y2;
    this.cposts = [
      new Point(xL, yT), // 0 c+
      new Point(xL, yB), // 1 c−
      new Point(xR, yT), // 2 out+
      new Point(xR, yB), // 3 out−
    ];
    const ccx = Math.round((xL + xR) / 2 / GRID) * GRID;
    const ccy = Math.round((yT + yB) / 2 / GRID) * GRID;
    this.posts = this.cposts.map((p) => {
      const w = this.rotWorld(p.x, p.y, ccx, ccy);
      return new Point(Math.round(w.x / GRID) * GRID, Math.round(w.y / GRID) * GRID);
    });
  }

  /** Rotate a canonical point about (ccx,ccy) by `orientation` quarter-turns
   *  (clockwise, screen y-down) — for posts and label anchors. */
  protected rotWorld(px: number, py: number, ccx: number, ccy: number): { x: number; y: number } {
    const dx = px - ccx;
    const dy = py - ccy;
    switch (this.orientation) {
      case 1:
        return { x: ccx - dy, y: ccy + dx };
      case 2:
        return { x: ccx - dx, y: ccy - dy };
      case 3:
        return { x: ccx + dy, y: ccy - dx };
      default:
        return { x: px, y: py };
    }
  }

  override distanceTo(px: number, py: number): number {
    return distanceToRect(px, py, this.posts[0].x, this.posts[0].y, this.posts[3].x, this.posts[3].y);
  }

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

  // --- drawing ---------------------------------------------------------------

  override draw(g: Graphics): void {
    const xL = this.cposts[0].x;
    const xR = this.cposts[2].x;
    const yT = this.cposts[0].y;
    const yB = this.cposts[1].y;
    const ccx = Math.round((xL + xR) / 2 / GRID) * GRID;
    const ccy = Math.round((yT + yB) / 2 / GRID) * GRID;
    const cy = (yT + yB) / 2;
    const bodyL = xL + 14;
    const bodyR = xR - 14;
    const cxm = (bodyL + bodyR) / 2;
    const s = 14; // diamond half-size
    this.setBbox(this.posts[0].x, this.posts[0].y, this.posts[3].x, this.posts[3].y, 12);

    // output current animation
    this.curcount = this.updateDotCount(this.outputCurrent(), this.curcount);

    g.save();
    g.translate(ccx, ccy);
    g.rotate((this.orientation * Math.PI) / 2);
    g.translate(-ccx, -ccy);
    this.color(g);
    // control stubs: down the left edge (a series path for CCxS, taps for VCxS)
    g.drawLine(this.cposts[0].x, this.cposts[0].y, bodyL, yT);
    g.drawLine(this.cposts[1].x, this.cposts[1].y, bodyL, yB);
    g.drawLine(bodyL, yT, bodyL, yB); // control-side rail
    // output stubs to the diamond
    g.drawLine(this.cposts[2].x, this.cposts[2].y, cxm, yT);
    g.drawLine(this.cposts[3].x, this.cposts[3].y, cxm, yB);
    g.drawLine(cxm, yT, cxm, cy - s);
    g.drawLine(cxm, yB, cxm, cy + s);
    // the diamond (dependent-source symbol)
    g.drawPolyline([cxm, cxm + s, cxm, cxm - s, cxm], [cy - s, cy, cy + s, cy, cy - s], 5);
    if (this.currentOutput()) {
      // arrow pointing toward out+ (top): shaft + head
      g.drawLine(cxm, cy + s - 5, cxm, cy - s + 5);
      g.drawLine(cxm, cy - s + 5, cxm - 4, cy - s + 11);
      g.drawLine(cxm, cy - s + 5, cxm + 4, cy - s + 11);
    } else {
      // +/− marking the driven polarity (out+ side up)
      g.drawLine(cxm - 4, cy - 6, cxm + 4, cy - 6);
      g.drawLine(cxm, cy - 10, cxm, cy - 2);
      g.drawLine(cxm - 4, cy + 7, cxm + 4, cy + 7);
    }
    // dots: sense current on the control rail, output current on the out stubs
    if (this.currentControl()) {
      this.senseCount = this.updateDotCount(this.getCurrent(), this.senseCount);
      this.drawDots(g, new Point(bodyL, yT), new Point(bodyL, yB), this.senseCount);
    }
    this.drawDots(g, new Point(cxm, cy - s), new Point(this.cposts[2].x, this.cposts[2].y), this.curcount);
    this.drawDots(g, new Point(this.cposts[3].x, this.cposts[3].y), new Point(cxm, cy + s), this.curcount);
    g.restore();

    this.drawPosts(g);

    // Bound control: dashed link from the control side to the target's centre
    // (the wired pair is inert — its labels are dimmed below).
    if (this.controlTarget) {
      const from = this.rotWorld(xL, (yT + yB) / 2, ccx, ccy);
      const t = this.controlTarget;
      const tx = (t.x + t.x2) / 2;
      const ty = (t.y + t.y2) / 2;
      g.setColor("#ffaa44");
      g.setLineWidth(1);
      g.setLineDash(4, 4);
      g.drawLine(from.x, from.y, tx, ty);
      g.setLineDash(0, 0);
      g.setFontSize(10);
      g.drawString("ctrl", (from.x + tx) / 2 + 4, (from.y + ty) / 2 - 2);
    }

    // labels, world space, horizontal
    g.setColor(this.controlTarget ? "#666666" : SimElement.elementColor);
    g.setFontSize(10);
    const put = (text: string, px: number, py: number): void => {
      const p = this.rotWorld(px, py, ccx, ccy);
      g.drawString(text, p.x, p.y);
    };
    put("c+", xL + 3, yT - 4);
    put("c-", xL + 3, yB + 12);
    g.setColor(SimElement.elementColor);
    put("+", xR - 8, yT - 4);
    put("-", xR - 8, yB + 12);
    // type + gain, centered under the body
    const mid = this.rotWorld(cxm, yB + 14, ccx, ccy);
    g.setColor(SimElement.valueColor);
    g.setFontSize(11);
    const label = this.getType().replace("Elm", "") + "  " + this.gainPrefix() + round4(this.gain);
    g.drawString(label, mid.x - g.measureWidth(label) / 2, mid.y + 4);
  }

  private senseCount = 0;

  // --- editing / info ----------------------------------------------------------

  private pickRequested = false;

  override getEditInfo(n: number): EditInfo | null {
    if (n === 0) return EditInfo.precise(this.gainLabel(), this.gain);
    if (n === 1) {
      const bound = this.controlTarget !== null;
      const pickLabel = bound
        ? "Bound: " + this.controlTarget!.getType().replace("Elm", "")
        : "Pick element on canvas…";
      return EditInfo.choice("Control", ["Wired (c+/c−)", pickLabel], bound ? 1 : 0);
    }
    return null;
  }
  override setEditValue(n: number, value: number): void {
    if (n === 0 && Number.isFinite(value) && value !== 0) this.gain = value;
  }
  override setEditChoice(n: number, choiceIndex: number): void {
    if (n !== 1) return;
    if (choiceIndex === 0) {
      this.controlTarget = null; // back to the wired c+/c− pair
    } else if (!this.controlTarget) {
      this.pickRequested = true; // EditDialog closes and starts the canvas pick
    }
  }
  /** One-shot flag read by EditDialog after a choice change: true = the user
   *  asked to pick a control element on the canvas. */
  consumePickRequest(): boolean {
    const r = this.pickRequested;
    this.pickRequested = false;
    return r;
  }
  /** Full target validation (structure + expressible current for CCxS). */
  acceptsTarget(t: SimElement, sim: SimulationManager): boolean {
    if (!this.isBindableTarget(t)) return false;
    if (this.currentControl() && t.currentSense(sim) === null) return false;
    return true;
  }

  override beforeDump(elmList: SimElement[]): void {
    this.pendingTargetIndex = this.controlTarget ? elmList.indexOf(this.controlTarget) : -1;
  }
  override getDumpAttributes(): number[] {
    return [this.gain, this.orientation, this.pendingTargetIndex];
  }
  override applyDumpAttributes(a: number[]): void {
    if (a.length > 0) this.gain = a[0];
    if (a.length > 1) this.orientation = ((Math.round(a[1]) % 4) + 4) % 4;
    this.pendingTargetIndex = a.length > 2 ? Math.round(a[2]) : -1;
    this.controlTarget = null; // resolved on the next analyze (bindMeasurement)
  }

  /** Structural target check (full electrical check happens at pick/stamp time,
   *  where the sim is available for currentSense). */
  isBindableTarget(t: SimElement): boolean {
    return t !== this && t.getPostCount() === 2;
  }

  // Resolve a loaded index → object, and drop bindings whose target vanished
  // (deleted) — the element then falls back to its wired c+/c− pair.
  override bindMeasurement(elmList: SimElement[]): void {
    if (this.pendingTargetIndex >= 0) {
      const t = elmList[this.pendingTargetIndex];
      this.controlTarget = t && this.isBindableTarget(t) ? t : null;
      this.pendingTargetIndex = -1;
    }
    if (this.controlTarget && !elmList.includes(this.controlTarget)) this.controlTarget = null;
  }

  /** Control node pair (p,n) so that V(p)−V(n) is the control voltage: the
   *  bound target's nodes ordered by ITS reference convention (the `*` mark),
   *  or this element's own c+/c− posts in wired mode. */
  protected controlNodes(): { p: number; n: number } {
    const t = this.controlTarget;
    if (t) {
      return t.getReferenceNode() === 1 ? { p: t.nodes[1], n: t.nodes[0] } : { p: t.nodes[0], n: t.nodes[1] };
    }
    return { p: this.nodes[0], n: this.nodes[1] };
  }

  /** Control voltage: the bound target's Vd (its own polarity) or V(c+)−V(c−). */
  protected controlVolts(): number {
    return this.controlTarget ? this.controlTarget.getVoltageDiff() : this.volts[0] - this.volts[1];
  }
  protected controlVoltsPhasor(): Complex {
    return this.controlTarget ? this.controlTarget.getVoltageDiffPhasor() : this.voltsPhasor[0].sub(this.voltsPhasor[1]);
  }
  /** Control current: the bound target's I (its own direction) or the internal
   *  0 V sense reading (this.current, delivered by the engine in wired mode). */
  protected controlCurrent(): number {
    return this.controlTarget ? this.controlTarget.getCurrent() : this.current;
  }
  protected controlCurrentPhasor(): Complex {
    return this.controlTarget ? this.controlTarget.getCurrentPhasor() : this.currentPhasor;
  }
  /** Output voltage V(out+) − V(out−). */
  protected outputVolts(): number {
    return this.volts[2] - this.volts[3];
  }
  protected outputVoltsPhasor(): Complex {
    return this.voltsPhasor[2].sub(this.voltsPhasor[3]);
  }

  // Delivered power (positive when sourcing, like the independent sources).
  override getPower(): number {
    return this.outputVolts() * this.outputCurrent();
  }
  override getPowerPhasor(): Complex {
    return this.outputVoltsPhasor().mul(this.outputCurrentPhasor().conj());
  }

  private boundInfo(): string {
    return this.controlTarget ? "ctrl ← " + this.controlTarget.getType().replace("Elm", "") + " (bound)" : "ctrl: wired c+/c−";
  }

  override getInfo(): string[] {
    const ctrl = this.currentControl()
      ? "Ictrl = " + getUnitText(this.controlCurrent(), "A")
      : "Vctrl = " + getUnitText(this.controlVolts(), "V");
    return [
      this.getType().replace("Elm", ""),
      this.gainPrefix().replace("=", "") + " = " + round4(this.gain),
      this.boundInfo(),
      ctrl,
      "Vout = " + getUnitText(this.outputVolts(), "V"),
      "Iout = " + getUnitText(this.outputCurrent(), "A"),
      "P = " + getUnitText(this.getPower(), "W"),
    ];
  }
  override getInfoPhasor(): string[] {
    const ctrl = this.currentControl()
      ? "Ictrl = " + formatPolar(this.controlCurrentPhasor(), "A")
      : "Vctrl = " + formatPolar(this.controlVoltsPhasor(), "V");
    return [
      this.getType().replace("Elm", ""),
      this.gainPrefix().replace("=", "") + " = " + round4(this.gain),
      this.boundInfo(),
      ctrl,
      "Vout = " + formatPolar(this.outputVoltsPhasor(), "V"),
      "Iout = " + formatPolar(this.outputCurrentPhasor(), "A"),
      "S = " + formatPolar(this.getPowerPhasor(), "VA"),
    ];
  }
}

// ---------------------------------------------------------------------------
// VCVS (ngspice E): V(o+)−V(o−) = μ·(Vc+ − Vc−). One output branch row; the
// control pair is ideal (draws no current). Branch current i flows o−→o+
// internally (delivered at out+); the engine returns it via setCurrent.
export class VCVSElm extends ControlledSourceElm {
  override getType(): string {
    return "VCVSElm";
  }
  protected gainLabel(): string {
    return "Gain (V/V)";
  }
  protected gainPrefix(): string {
    return "μ=";
  }
  protected currentOutput(): boolean {
    return false;
  }
  protected currentControl(): boolean {
    return false;
  }
  override getVoltageSourceCount(): number {
    return 1;
  }
  override stamp(sim: SimulationManager): void {
    const vn = sim.nodeCount + this.voltSource;
    sim.stampVoltageSource(this.nodes[3], this.nodes[2], this.voltSource); // no RHS: row stays = 0
    const { p, n } = this.controlNodes(); // own c pair, or the bound target's nodes
    sim.stampMatrix(vn, p, -this.gain);
    sim.stampMatrix(vn, n, this.gain);
  }
  override stampPhasor(sim: SimulationManager): void {
    const vn = sim.nodeCount + this.voltSource;
    sim.stampVoltageSourceC(this.nodes[3], this.nodes[2], this.voltSource, Complex.ZERO);
    const { p, n } = this.controlNodes();
    sim.stampMatrixC(vn, p, new Complex(-this.gain, 0));
    sim.stampMatrixC(vn, n, new Complex(this.gain, 0));
  }
  protected outputCurrent(): number {
    return this.current; // solved branch current, delivered out of out+
  }
  protected outputCurrentPhasor(): Complex {
    return this.currentPhasor;
  }
  override getPostCurrent(n: number): number {
    if (n === 2) return -this.current; // into out+ = −(delivered)
    if (n === 3) return this.current;
    return 0; // ideal control pair
  }
  override getPostCurrentPhasor(n: number): Complex {
    if (n === 2) return this.currentPhasor.neg();
    if (n === 3) return this.currentPhasor;
    return Complex.ZERO;
  }
}

// VCCS (ngspice G): i_out = gm·(Vc+ − Vc−), delivered out of out+. Pure
// transconductance block — no extra MNA unknown at all.
export class VCCSElm extends ControlledSourceElm {
  constructor(x: number, y: number) {
    super(x, y);
    this.gain = 0.1; // ngspice-ish default gm
  }
  override getType(): string {
    return "VCCSElm";
  }
  protected gainLabel(): string {
    return "Transconductance (S)";
  }
  protected gainPrefix(): string {
    return "gm=";
  }
  protected currentOutput(): boolean {
    return true;
  }
  protected currentControl(): boolean {
    return false;
  }
  override stamp(sim: SimulationManager): void {
    // takes gm·Vc from out− and delivers it at out+ (positive i exits out+)
    const { p, n } = this.controlNodes();
    sim.stampVCCurrentSource(this.nodes[3], this.nodes[2], p, n, this.gain);
  }
  override stampPhasor(sim: SimulationManager): void {
    const { p, n } = this.controlNodes();
    sim.stampVCCurrentSourceC(this.nodes[3], this.nodes[2], p, n, this.gain);
  }
  override calculateCurrent(): void {
    this.current = this.gain * this.controlVolts();
  }
  override calculateCurrentPhasor(): void {
    this.currentPhasor = this.controlVoltsPhasor().scale(this.gain);
  }
  protected outputCurrent(): number {
    return this.current;
  }
  protected outputCurrentPhasor(): Complex {
    return this.currentPhasor;
  }
  override getPostCurrent(n: number): number {
    if (n === 2) return -this.current;
    if (n === 3) return this.current;
    return 0;
  }
  override getPostCurrentPhasor(n: number): Complex {
    if (n === 2) return this.currentPhasor.neg();
    if (n === 3) return this.currentPhasor;
    return Complex.ZERO;
  }
}

// CCCS (ngspice F): i_out = β·I_sense. The control pair is an internal 0 V
// source (ideal ammeter, wired in series); the output couples ±β into the
// sense-branch column. `current` holds I_sense (set by the engine).
export class CCCSElm extends ControlledSourceElm {
  constructor(x: number, y: number) {
    super(x, y);
    this.gain = 2;
  }
  override getType(): string {
    return "CCCSElm";
  }
  protected gainLabel(): string {
    return "Gain (A/A)";
  }
  protected gainPrefix(): string {
    return "β=";
  }
  protected currentOutput(): boolean {
    return true;
  }
  protected currentControl(): boolean {
    return true;
  }
  override getVoltageSourceCount(): number {
    return 1; // the 0 V sense (inert when bound to an external control)
  }
  override stamp(sim: SimulationManager): void {
    const vn = sim.nodeCount + this.voltSource;
    sim.stampVoltageSource(this.nodes[0], this.nodes[1], this.voltSource, 0); // sense: c+ → c−
    const t = this.controlTarget;
    const sense = t ? t.currentSense(sim) : null;
    if (t && !sense) this.controlTarget = null; // target's current not expressible → wired fallback
    if (!this.controlTarget) {
      sim.stampMatrix(this.nodes[3], vn, this.gain); // β·I leaves out−
      sim.stampMatrix(this.nodes[2], vn, -this.gain); // β·I delivered at out+
      return;
    }
    if (sense!.kind === "branch") {
      const col = sim.nodeCount + sense!.vs; // target's own branch-current column
      sim.stampMatrix(this.nodes[3], col, this.gain);
      sim.stampMatrix(this.nodes[2], col, -this.gain);
    } else if (sense!.g !== 0) {
      // i_out = β·(g·(Vp−Vn) + iConst): matrix part here, iConst each doStep
      sim.stampVCCurrentSource(this.nodes[3], this.nodes[2], sense!.p, sense!.n, this.gain * sense!.g);
    }
  }
  override doStep(sim: SimulationManager): void {
    const t = this.controlTarget;
    if (!t) return;
    const sense = t.currentSense(sim);
    if (sense && sense.kind === "linear" && sense.iConst !== 0) {
      sim.stampCurrentSource(this.nodes[3], this.nodes[2], this.gain * sense.iConst); // β·iConst at out+
    }
  }
  override stampPhasor(sim: SimulationManager): void {
    const vn = sim.nodeCount + this.voltSource;
    sim.stampVoltageSourceC(this.nodes[0], this.nodes[1], this.voltSource, Complex.ZERO);
    const t = this.controlTarget;
    const sense = t ? t.currentSensePhasor(sim, sim.omega) : null;
    if (t && !sense) this.controlTarget = null;
    if (!this.controlTarget) {
      sim.stampMatrixC(this.nodes[3], vn, new Complex(this.gain, 0));
      sim.stampMatrixC(this.nodes[2], vn, new Complex(-this.gain, 0));
      return;
    }
    if (sense!.kind === "branch") {
      const col = sim.nodeCount + sense!.vs;
      sim.stampMatrixC(this.nodes[3], col, new Complex(this.gain, 0));
      sim.stampMatrixC(this.nodes[2], col, new Complex(-this.gain, 0));
    } else {
      if (sense!.y.abs() !== 0) stampVCCSComplex(sim, this.nodes[3], this.nodes[2], sense!.p, sense!.n, sense!.y.scale(this.gain));
      if (sense!.iConst.abs() !== 0) sim.stampCurrentSourceC(this.nodes[3], this.nodes[2], sense!.iConst.scale(this.gain));
    }
  }
  protected outputCurrent(): number {
    return this.gain * this.controlCurrent(); // wired: own sense; bound: target's I
  }
  protected outputCurrentPhasor(): Complex {
    return this.controlCurrentPhasor().scale(this.gain);
  }
  override getPostCurrent(n: number): number {
    const is = this.controlTarget ? 0 : this.current; // c pair inert when bound
    if (n === 0) return is;
    if (n === 1) return -is;
    if (n === 2) return -this.outputCurrent();
    return this.outputCurrent();
  }
  override getPostCurrentPhasor(n: number): Complex {
    const is = this.controlTarget ? Complex.ZERO : this.currentPhasor;
    if (n === 0) return is;
    if (n === 1) return is.neg();
    if (n === 2) return this.outputCurrentPhasor().neg();
    return this.outputCurrentPhasor();
  }
}

// CCVS (ngspice H): V(o+)−V(o−) = r·I_sense. Two branch rows: the 0 V sense
// (voltSource) and the output source (voltSource+1) coupled by −r.
export class CCVSElm extends ControlledSourceElm {
  constructor(x: number, y: number) {
    super(x, y);
    this.gain = 10;
  }
  private currents: [number, number] = [0, 0]; // [I_sense, I_out]
  private currentsPhasor: [Complex, Complex] = [Complex.ZERO, Complex.ZERO];

  override getType(): string {
    return "CCVSElm";
  }
  protected gainLabel(): string {
    return "Transresistance (Ω)";
  }
  protected gainPrefix(): string {
    return "r=";
  }
  protected currentOutput(): boolean {
    return false;
  }
  protected currentControl(): boolean {
    return true;
  }
  override getVoltageSourceCount(): number {
    return 2;
  }
  override setVoltageSource(n: number, vs: number): void {
    if (n === 0) this.voltSource = vs; // base id; the output row is voltSource+1
  }
  override stamp(sim: SimulationManager): void {
    const vnSense = sim.nodeCount + this.voltSource;
    const vnOut = vnSense + 1;
    sim.stampVoltageSource(this.nodes[0], this.nodes[1], this.voltSource, 0); // sense (inert when bound)
    sim.stampVoltageSource(this.nodes[3], this.nodes[2], this.voltSource + 1); // output row (= 0 RHS)
    const t = this.controlTarget;
    const sense = t ? t.currentSense(sim) : null;
    if (t && !sense) this.controlTarget = null; // unexpressible current → wired fallback
    if (!this.controlTarget) {
      sim.stampMatrix(vnOut, vnSense, -this.gain); // V(o+)−V(o−) − r·I_sense = 0
      return;
    }
    if (sense!.kind === "branch") {
      sim.stampMatrix(vnOut, sim.nodeCount + sense!.vs, -this.gain);
    } else if (sense!.g !== 0) {
      // V(o+)−V(o−) − r·g·(Vp−Vn) = r·iConst (RHS refreshed each doStep)
      sim.stampMatrix(vnOut, sense!.p, -this.gain * sense!.g);
      sim.stampMatrix(vnOut, sense!.n, this.gain * sense!.g);
    }
  }
  override doStep(sim: SimulationManager): void {
    const t = this.controlTarget;
    if (!t) return;
    const sense = t.currentSense(sim);
    if (sense && sense.kind === "linear" && sense.iConst !== 0) {
      sim.stampRightSide(sim.nodeCount + this.voltSource + 1, this.gain * sense.iConst);
    }
  }
  override stampPhasor(sim: SimulationManager): void {
    const vnSense = sim.nodeCount + this.voltSource;
    const vnOut = vnSense + 1;
    sim.stampVoltageSourceC(this.nodes[0], this.nodes[1], this.voltSource, Complex.ZERO);
    sim.stampVoltageSourceC(this.nodes[3], this.nodes[2], this.voltSource + 1, Complex.ZERO);
    const t = this.controlTarget;
    const sense = t ? t.currentSensePhasor(sim, sim.omega) : null;
    if (t && !sense) this.controlTarget = null;
    if (!this.controlTarget) {
      sim.stampMatrixC(vnOut, vnSense, new Complex(-this.gain, 0));
      return;
    }
    if (sense!.kind === "branch") {
      sim.stampMatrixC(vnOut, sim.nodeCount + sense!.vs, new Complex(-this.gain, 0));
    } else {
      if (sense!.y.abs() !== 0) {
        sim.stampMatrixC(vnOut, sense!.p, sense!.y.scale(-this.gain));
        sim.stampMatrixC(vnOut, sense!.n, sense!.y.scale(this.gain));
      }
      if (sense!.iConst.abs() !== 0) sim.stampRightSideC(vnOut, sense!.iConst.scale(this.gain));
    }
  }
  override setCurrent(vs: number, c: number): void {
    this.currents[vs - this.voltSource] = c;
    this.current = this.currents[0]; // sense current is the control reading
  }
  override setCurrentPhasor(vs: number, c: Complex): void {
    this.currentsPhasor[vs - this.voltSource] = c;
    this.currentPhasor = this.currentsPhasor[0];
  }
  protected outputCurrent(): number {
    return this.currents[1]; // solved output branch current (out of out+)
  }
  protected outputCurrentPhasor(): Complex {
    return this.currentsPhasor[1];
  }
  override getPostCurrent(n: number): number {
    if (n === 0) return this.currents[0];
    if (n === 1) return -this.currents[0];
    if (n === 2) return -this.currents[1];
    return this.currents[1];
  }
  override getPostCurrentPhasor(n: number): Complex {
    if (n === 0) return this.currentsPhasor[0];
    if (n === 1) return this.currentsPhasor[0].neg();
    if (n === 2) return this.currentsPhasor[1].neg();
    return this.currentsPhasor[1];
  }
  override reset(): void {
    super.reset();
    this.currents = [0, 0];
    this.currentsPhasor = [Complex.ZERO, Complex.ZERO];
  }
}

registerElement({ name: "VCVSElm", label: "VCVS", group: "Sources", dumpType: 213, ctor: (x, y) => new VCVSElm(x, y) });
registerElement({ name: "VCCSElm", label: "VCCS", group: "Sources", dumpType: 215, ctor: (x, y) => new VCCSElm(x, y) });
registerElement({ name: "CCVSElm", label: "CCVS", group: "Sources", dumpType: 214, ctor: (x, y) => new CCVSElm(x, y) });
registerElement({ name: "CCCSElm", label: "CCCS", group: "Sources", dumpType: 216, ctor: (x, y) => new CCCSElm(x, y) });
