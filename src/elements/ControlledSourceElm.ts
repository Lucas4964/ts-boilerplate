import { SimElement } from "./SimElement";
import { Graphics } from "../ui/Graphics";
import { Point } from "../geom/Point";
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

  // Control mode lives in the serialized `flags` header, bit 1:
  //   1 = REMOTE (default for new elements): a plain 2-terminal output; the
  //       control is another element picked on the canvas (dashed ctrl link).
  //   0 = WIRED: the classic 4-terminal box with the c+/c− pair (old saves,
  //       whose flags are 0, keep their wired topology).
  static readonly FLAG_REMOTE = 1;
  override getDefaultFlags(): number {
    return ControlledSourceElm.FLAG_REMOTE;
  }
  isRemote(): boolean {
    return (this.flags & ControlledSourceElm.FLAG_REMOTE) !== 0;
  }
  setRemote(remote: boolean): void {
    this.flags = remote ? this.flags | ControlledSourceElm.FLAG_REMOTE : this.flags & ~ControlledSourceElm.FLAG_REMOTE;
  }

  override getPostCount(): number {
    return this.isRemote() ? 2 : 4;
  }
  override getPost(n: number): Point {
    // Remote: post 0 = out− (point1), post 1 = out+ (point2) — the standard
    // 2-terminal source convention (post 1 is the driven "+" terminal).
    if (this.isRemote()) return n === 0 ? this.point1 : this.point2;
    return this.posts[n];
  }
  override getReferenceNode(): number {
    return this.isRemote() ? 1 : 0;
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
    if (this.isRemote()) {
      // Plain 2-terminal linear geometry (like the independent sources).
      this.calcLeads(36);
      return;
    }
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

  override rotate(quarter: number, cx: number, cy: number, snap: (v: number) => number): void {
    if (this.isRemote()) {
      // Remote mode is a plain 2-terminal element — rotate the endpoints.
      super.rotate(quarter, cx, cy, snap);
      return;
    }
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

  /** Remote-mode drawing: a clean 2-terminal source — leads + a diamond on the
   *  axis (the dependent-source symbol), reference star on out+ (post 1), and
   *  the dashed "ctrl" link to the bound control element. */
  private drawRemote(g: Graphics): void {
    const s = 12; // diamond half-size
    this.setBboxP(this.point1, this.point2, s + 2);
    this.curcount = this.updateDotCount(this.outputCurrent(), this.curcount);
    this.draw2Leads(g);
    const len = Math.hypot(this.lead2.x - this.lead1.x, this.lead2.y - this.lead1.y);
    if (len > 0) {
      const ux = (this.lead2.x - this.lead1.x) / len;
      const uy = (this.lead2.y - this.lead1.y) / len;
      this.color(g);
      g.save();
      g.transform(ux, uy, -uy, ux, this.lead1.x, this.lead1.y);
      const m = len / 2;
      const ctx = g.ctx;
      ctx.beginPath();
      ctx.moveTo(m - s, 0);
      ctx.lineTo(m, -s);
      ctx.lineTo(m + s, 0);
      ctx.lineTo(m, s);
      ctx.closePath();
      ctx.stroke();
      if (this.currentOutput()) {
        // arrow along the axis pointing toward out+ (post 1 side)
        g.drawLine(m - s + 4, 0, m + s - 4, 0);
        g.drawLine(m + s - 4, 0, m + s - 9, -4);
        g.drawLine(m + s - 4, 0, m + s - 9, 4);
      } else {
        // "+" toward post 1 (out+), "−" toward post 0
        g.drawLine(m + 4, 0, m + 8, 0);
        g.drawLine(m + 6, -2, m + 6, 2);
        g.drawLine(m - 8, 0, m - 4, 0);
      }
      g.restore();
    }
    this.doDots(g);
    this.drawReferenceMark(g); // "*" on out+ (post 1)
    this.drawValues(g, this.getType().replace("Elm", "") + " " + this.gainText(), s + 4);
    this.drawPosts(g);
    // dashed link to the control element (or nothing when no control yet)
    if (this.controlTarget) {
      const c = this.interpPoint(this.lead1, this.lead2, 0.5);
      const t = this.controlTarget;
      const tx = (t.x + t.x2) / 2;
      const ty = (t.y + t.y2) / 2;
      g.setColor("#ffaa44");
      g.setLineWidth(1);
      g.setLineDash(4, 4);
      g.drawLine(c.x, c.y, tx, ty);
      g.setLineDash(0, 0);
      g.setFontSize(10);
      g.drawString("ctrl", (c.x + tx) / 2 + 4, (c.y + ty) / 2 - 2);
    }
  }

  override draw(g: Graphics): void {
    if (this.isRemote()) {
      this.drawRemote(g);
      return;
    }
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
    const label = this.getType().replace("Elm", "") + "  " + this.gainText();
    g.drawString(label, mid.x - g.measureWidth(label) / 2, mid.y + 4);
  }

  /** Gain label drawn on canvas / shown in the panel; subclasses with a complex
   *  gain (CCVS) override it. */
  protected gainText(): string {
    return this.gainPrefix() + round4(this.gain);
  }

  private senseCount = 0;

  // --- editing / info ----------------------------------------------------------

  private pickRequested = false;

  /** Extra numeric edit fields a subclass adds between the gain and the
   *  Control choice (e.g. the CCVS reactance). */
  protected extraEditCount(): number {
    return 0;
  }
  protected getExtraEditInfo(_k: number): EditInfo | null {
    return null;
  }
  protected setExtraEditValue(_k: number, _v: number): void {}

  override getEditInfo(n: number): EditInfo | null {
    if (n === 0) return EditInfo.precise(this.gainLabel(), this.gain);
    const k = n - 1;
    if (k < this.extraEditCount()) return this.getExtraEditInfo(k);
    if (n === 1 + this.extraEditCount()) {
      const remoteLabel = this.controlTarget
        ? "Remote: " + this.controlTarget.getType().replace("Elm", "")
        : "Remote (no control picked)";
      // "Pick…" is always offered, so the control element can be CHANGED at
      // any time (re-pick) — not only when unbound.
      return EditInfo.choice(
        "Control",
        ["Wired terminals (c+/c−)", remoteLabel, "Pick control element…"],
        this.isRemote() ? 1 : 0,
      );
    }
    return null;
  }
  override setEditValue(n: number, value: number): void {
    if (n === 0) {
      if (Number.isFinite(value) && value !== 0) this.gain = value;
      return;
    }
    const k = n - 1;
    if (k < this.extraEditCount()) this.setExtraEditValue(k, value);
  }
  override setEditChoice(n: number, choiceIndex: number): void {
    if (n !== 1 + this.extraEditCount()) return;
    if (choiceIndex === 0) {
      // back to the wired c+/c− pair (4-terminal box)
      this.setRemote(false);
      this.controlTarget = null;
      this.setPoints();
    } else if (choiceIndex === 1) {
      this.setRemote(true); // keep whatever control is bound
      this.setPoints();
    } else if (choiceIndex === 2) {
      this.setRemote(true);
      this.setPoints();
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
    // A bound control implies remote mode; migrates saves from before the
    // wired/remote split (bound elements become the clean 2-terminal form).
    if (this.pendingTargetIndex >= 0) this.setRemote(true);
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
   *  bound target's nodes ordered by ITS reference convention (the `*` mark);
   *  the own c+/c− posts in wired mode; ground/ground when remote with no
   *  control picked yet (stamp entries on node 0 are dropped → output is 0). */
  protected controlNodes(): { p: number; n: number } {
    const t = this.controlTarget;
    if (t) {
      return t.getReferenceNode() === 1 ? { p: t.nodes[1], n: t.nodes[0] } : { p: t.nodes[0], n: t.nodes[1] };
    }
    if (this.isRemote()) return { p: 0, n: 0 };
    return { p: this.nodes[0], n: this.nodes[1] };
  }

  /** Output node pair {p: out+, n: out−} for the current mode (remote: the two
   *  posts with out+ = post 1; wired: box posts 2/3). */
  protected outNodes(): { p: number; n: number } {
    return this.isRemote() ? { p: this.nodes[1], n: this.nodes[0] } : { p: this.nodes[2], n: this.nodes[3] };
  }

  /** Control voltage: the bound target's Vd (its own polarity), the wired
   *  c+/c− pair, or 0 when remote with no control picked. */
  protected controlVolts(): number {
    if (this.controlTarget) return this.controlTarget.getVoltageDiff();
    return this.isRemote() ? 0 : this.volts[0] - this.volts[1];
  }
  protected controlVoltsPhasor(): Complex {
    if (this.controlTarget) return this.controlTarget.getVoltageDiffPhasor();
    return this.isRemote() ? Complex.ZERO : this.voltsPhasor[0].sub(this.voltsPhasor[1]);
  }
  /** Control current: the bound target's I (its own direction), the internal
   *  0 V sense reading (wired mode), or 0 when remote and unbound. */
  protected controlCurrent(): number {
    if (this.controlTarget) return this.controlTarget.getCurrent();
    return this.isRemote() ? 0 : this.current;
  }
  protected controlCurrentPhasor(): Complex {
    if (this.controlTarget) return this.controlTarget.getCurrentPhasor();
    return this.isRemote() ? Complex.ZERO : this.currentPhasor;
  }
  /** Output voltage V(out+) − V(out−), mode-aware. */
  protected outputVolts(): number {
    return this.isRemote() ? this.volts[1] - this.volts[0] : this.volts[2] - this.volts[3];
  }
  protected outputVoltsPhasor(): Complex {
    return this.isRemote() ? this.voltsPhasor[1].sub(this.voltsPhasor[0]) : this.voltsPhasor[2].sub(this.voltsPhasor[3]);
  }

  // Delivered power (positive when sourcing, like the independent sources).
  override getPower(): number {
    return this.outputVolts() * this.outputCurrent();
  }
  override getPowerPhasor(): Complex {
    return this.outputVoltsPhasor().mul(this.outputCurrentPhasor().conj());
  }

  private boundInfo(): string {
    if (this.controlTarget) return "ctrl ← " + this.controlTarget.getType().replace("Elm", "") + " (remote)";
    return this.isRemote() ? "ctrl: remote (none picked)" : "ctrl: wired c+/c−";
  }

  override getInfo(): string[] {
    const ctrl = this.currentControl()
      ? "Ictrl = " + getUnitText(this.controlCurrent(), "A")
      : "Vctrl = " + getUnitText(this.controlVolts(), "V");
    return [
      this.getType().replace("Elm", ""),
      this.gainText(),
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
      this.gainText(),
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
    const o = this.outNodes();
    sim.stampVoltageSource(o.n, o.p, this.voltSource); // no RHS: row stays = 0
    const { p, n } = this.controlNodes(); // own c pair, or the bound target's nodes
    sim.stampMatrix(vn, p, -this.gain);
    sim.stampMatrix(vn, n, this.gain);
  }
  override stampPhasor(sim: SimulationManager): void {
    const vn = sim.nodeCount + this.voltSource;
    const o = this.outNodes();
    sim.stampVoltageSourceC(o.n, o.p, this.voltSource, Complex.ZERO);
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
    if (this.isRemote()) {
      // 2-terminal source convention (post 1 = out+, delivered)
      return n === 1 ? -this.current : this.current;
    }
    if (n === 2) return -this.current; // into out+ = −(delivered)
    if (n === 3) return this.current;
    return 0; // ideal control pair
  }
  override getPostCurrentPhasor(n: number): Complex {
    if (this.isRemote()) {
      return n === 1 ? this.currentPhasor.neg() : this.currentPhasor;
    }
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
    const o = this.outNodes();
    const { p, n } = this.controlNodes();
    sim.stampVCCurrentSource(o.n, o.p, p, n, this.gain);
  }
  override stampPhasor(sim: SimulationManager): void {
    const o = this.outNodes();
    const { p, n } = this.controlNodes();
    sim.stampVCCurrentSourceC(o.n, o.p, p, n, this.gain);
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
    if (this.isRemote()) return n === 1 ? -this.current : this.current;
    if (n === 2) return -this.current;
    if (n === 3) return this.current;
    return 0;
  }
  override getPostCurrentPhasor(n: number): Complex {
    if (this.isRemote()) return n === 1 ? this.currentPhasor.neg() : this.currentPhasor;
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
    return this.isRemote() ? 0 : 1; // wired: the internal 0 V sense; remote: none
  }
  override stamp(sim: SimulationManager): void {
    const o = this.outNodes();
    if (!this.isRemote()) {
      // wired: internal 0 V sense between c+ and c−, output coupled to its row
      const vn = sim.nodeCount + this.voltSource;
      sim.stampVoltageSource(this.nodes[0], this.nodes[1], this.voltSource, 0);
      sim.stampMatrix(o.n, vn, this.gain); // β·I leaves out−
      sim.stampMatrix(o.p, vn, -this.gain); // β·I delivered at out+
      return;
    }
    const t = this.controlTarget;
    const sense = t ? t.currentSense(sim) : null;
    if (!sense) return; // remote with no (expressible) control → open output
    if (sense.kind === "branch") {
      const col = sim.nodeCount + sense.vs; // target's own branch-current column
      sim.stampMatrix(o.n, col, this.gain);
      sim.stampMatrix(o.p, col, -this.gain);
    } else if (sense.g !== 0) {
      // i_out = β·(g·(Vp−Vn) + iConst): matrix part here, iConst each doStep
      sim.stampVCCurrentSource(o.n, o.p, sense.p, sense.n, this.gain * sense.g);
    }
  }
  override doStep(sim: SimulationManager): void {
    const t = this.controlTarget;
    if (!t || !this.isRemote()) return;
    const sense = t.currentSense(sim);
    if (sense && sense.kind === "linear" && sense.iConst !== 0) {
      const o = this.outNodes();
      sim.stampCurrentSource(o.n, o.p, this.gain * sense.iConst); // β·iConst at out+
    }
  }
  override stampPhasor(sim: SimulationManager): void {
    const o = this.outNodes();
    if (!this.isRemote()) {
      const vn = sim.nodeCount + this.voltSource;
      sim.stampVoltageSourceC(this.nodes[0], this.nodes[1], this.voltSource, Complex.ZERO);
      sim.stampMatrixC(o.n, vn, new Complex(this.gain, 0));
      sim.stampMatrixC(o.p, vn, new Complex(-this.gain, 0));
      return;
    }
    const t = this.controlTarget;
    const sense = t ? t.currentSensePhasor(sim, sim.omega) : null;
    if (!sense) return;
    if (sense.kind === "branch") {
      const col = sim.nodeCount + sense.vs;
      sim.stampMatrixC(o.n, col, new Complex(this.gain, 0));
      sim.stampMatrixC(o.p, col, new Complex(-this.gain, 0));
    } else {
      if (sense.y.abs() !== 0) stampVCCSComplex(sim, o.n, o.p, sense.p, sense.n, sense.y.scale(this.gain));
      if (sense.iConst.abs() !== 0) sim.stampCurrentSourceC(o.n, o.p, sense.iConst.scale(this.gain));
    }
  }
  protected outputCurrent(): number {
    return this.gain * this.controlCurrent(); // wired: own sense; remote: target's I
  }
  protected outputCurrentPhasor(): Complex {
    return this.controlCurrentPhasor().scale(this.gain);
  }
  override getPostCurrent(n: number): number {
    if (this.isRemote()) return n === 1 ? -this.outputCurrent() : this.outputCurrent();
    if (n === 0) return this.current; // wired sense current through the c pair
    if (n === 1) return -this.current;
    if (n === 2) return -this.outputCurrent();
    return this.outputCurrent();
  }
  override getPostCurrentPhasor(n: number): Complex {
    if (this.isRemote()) return n === 1 ? this.outputCurrentPhasor().neg() : this.outputCurrentPhasor();
    if (n === 0) return this.currentPhasor;
    if (n === 1) return this.currentPhasor.neg();
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
  /** Imaginary part of the transresistance (Ω): Z = gain + j·reactance, used in
   *  PHASOR mode only — this is the X_m of a mutually-coupled line, so
   *  V = Z_m·I_other works per phase (exact even for unbalanced/untransposed
   *  systems: the coupling is the full phase-domain Z matrix). In transient
   *  there is no jX operator, so only the real gain applies. */
  reactance = 0;
  private currents: [number, number] = [0, 0]; // [I_sense, I_out]
  private currentsPhasor: [Complex, Complex] = [Complex.ZERO, Complex.ZERO];

  private zGain(): Complex {
    return new Complex(this.gain, this.reactance);
  }
  protected override extraEditCount(): number {
    return 1;
  }
  protected override getExtraEditInfo(k: number): EditInfo | null {
    if (k === 0) return EditInfo.precise("Reactance x (Ω, phasor)", this.reactance);
    return null;
  }
  protected override setExtraEditValue(k: number, v: number): void {
    if (k === 0 && Number.isFinite(v)) this.reactance = v; // 0 / negative are valid
  }
  protected override gainText(): string {
    if (this.reactance === 0) return this.gainPrefix() + round4(this.gain);
    const sign = this.reactance >= 0 ? "+j" : "-j";
    return "Z=" + round4(this.gain) + sign + round4(Math.abs(this.reactance));
  }
  override getDumpAttributes(): number[] {
    return [...super.getDumpAttributes(), this.reactance];
  }
  override applyDumpAttributes(a: number[]): void {
    super.applyDumpAttributes(a);
    this.reactance = a.length > 3 ? a[3] : 0;
  }

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
    // wired: 0 V sense + output row; remote: output row only
    return this.isRemote() ? 1 : 2;
  }
  override setVoltageSource(n: number, vs: number): void {
    if (n === 0) this.voltSource = vs; // base id (wired: sense; remote: output)
  }
  /** MNA row of the output source: remote has no sense row before it. */
  private outVs(): number {
    return this.isRemote() ? this.voltSource : this.voltSource + 1;
  }
  override stamp(sim: SimulationManager): void {
    const o = this.outNodes();
    const vnOut = sim.nodeCount + this.outVs();
    sim.stampVoltageSource(o.n, o.p, this.outVs()); // output row (= 0 RHS)
    if (!this.isRemote()) {
      const vnSense = sim.nodeCount + this.voltSource;
      sim.stampVoltageSource(this.nodes[0], this.nodes[1], this.voltSource, 0); // sense
      sim.stampMatrix(vnOut, vnSense, -this.gain); // V(o+)−V(o−) − r·I_sense = 0
      return;
    }
    const t = this.controlTarget;
    const sense = t ? t.currentSense(sim) : null;
    if (!sense) return; // remote, no control → behaves as a 0 V source
    if (sense.kind === "branch") {
      sim.stampMatrix(vnOut, sim.nodeCount + sense.vs, -this.gain);
    } else if (sense.g !== 0) {
      // V(o+)−V(o−) − r·g·(Vp−Vn) = r·iConst (RHS refreshed each doStep)
      sim.stampMatrix(vnOut, sense.p, -this.gain * sense.g);
      sim.stampMatrix(vnOut, sense.n, this.gain * sense.g);
    }
  }
  override doStep(sim: SimulationManager): void {
    const t = this.controlTarget;
    if (!t || !this.isRemote()) return;
    const sense = t.currentSense(sim);
    if (sense && sense.kind === "linear" && sense.iConst !== 0) {
      sim.stampRightSide(sim.nodeCount + this.outVs(), this.gain * sense.iConst);
    }
  }
  override stampPhasor(sim: SimulationManager): void {
    const o = this.outNodes();
    const vnOut = sim.nodeCount + this.outVs();
    const Z = this.zGain(); // complex transresistance: V(o+)−V(o−) = Z·I_ctrl
    sim.stampVoltageSourceC(o.n, o.p, this.outVs(), Complex.ZERO);
    if (!this.isRemote()) {
      const vnSense = sim.nodeCount + this.voltSource;
      sim.stampVoltageSourceC(this.nodes[0], this.nodes[1], this.voltSource, Complex.ZERO);
      sim.stampMatrixC(vnOut, vnSense, Z.neg());
      return;
    }
    const t = this.controlTarget;
    const sense = t ? t.currentSensePhasor(sim, sim.omega) : null;
    if (!sense) return;
    if (sense.kind === "branch") {
      sim.stampMatrixC(vnOut, sim.nodeCount + sense.vs, Z.neg());
    } else {
      if (sense.y.abs() !== 0) {
        sim.stampMatrixC(vnOut, sense.p, sense.y.mul(Z).neg());
        sim.stampMatrixC(vnOut, sense.n, sense.y.mul(Z));
      }
      if (sense.iConst.abs() !== 0) sim.stampRightSideC(vnOut, sense.iConst.mul(Z));
    }
  }
  override setCurrent(vs: number, c: number): void {
    // remote: the single source is the output; wired: [sense, output]
    const idx = this.isRemote() ? 1 : vs - this.voltSource;
    this.currents[idx] = c;
    this.current = this.isRemote() ? this.controlCurrent() : this.currents[0];
  }
  override setCurrentPhasor(vs: number, c: Complex): void {
    const idx = this.isRemote() ? 1 : vs - this.voltSource;
    this.currentsPhasor[idx] = c;
    this.currentPhasor = this.isRemote() ? this.controlCurrentPhasor() : this.currentsPhasor[0];
  }
  protected outputCurrent(): number {
    return this.currents[1]; // solved output branch current (out of out+)
  }
  protected outputCurrentPhasor(): Complex {
    return this.currentsPhasor[1];
  }
  override getPostCurrent(n: number): number {
    if (this.isRemote()) return n === 1 ? -this.currents[1] : this.currents[1];
    if (n === 0) return this.currents[0];
    if (n === 1) return -this.currents[0];
    if (n === 2) return -this.currents[1];
    return this.currents[1];
  }
  override getPostCurrentPhasor(n: number): Complex {
    if (this.isRemote()) return n === 1 ? this.currentsPhasor[1].neg() : this.currentsPhasor[1];
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
