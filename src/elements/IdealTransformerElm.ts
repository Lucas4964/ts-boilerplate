import { TransformerElm } from "./TransformerElm";
import { Graphics } from "../ui/Graphics";
import { EditInfo } from "./EditInfo";
import { registerElement } from "./ElementRegistry";
import { getUnitText, formatPolar, round4 } from "../util/format";
import { Complex } from "../core/Complex";
import type { SimulationManager } from "../core/SimulationManager";

// IDEAL transformer: the textbook two-port with a single parameter, the turns
// ratio n = N1/N2 — no inductance, no coupling coefficient:
//   V1 = n·V2          (voltages measured dot→non-dot, posts 0→1 and 2→3)
//   I2 = −n·I1         (power balance: V1·I1 + V2·I2 = 0)
// Classic MNA stamp (Vlach & Singhal): ONE extra current unknown j = I1 with a
// constraint row, plus KCL couplings ±1 (primary) and ∓n (secondary). Linear
// and frequency-independent, so the SAME real coefficients serve the transient
// and the phasor matrix — and it transforms any waveform, including DC (that is
// the ideal two-port's definition; a physical transformer would short DC
// through its magnetizing inductance instead).
//
// Robustness: a tiny internal series resistance RSER on the constraint row
// (V1 − n·V2 = RSER·j) breaks the row-dependency degeneracy of closed ideal
// constraint loops — notably a Δ–Δ bank, where the three pure constraints sum
// to the identity 0 = 0 (the delta circulating current is physically
// indeterminate without leakage). With RSER every topology solves; the error
// is at the µV level, invisible at the app's 4-decimal display.
const RSER = 1e-6;

export class IdealTransformerElm extends TransformerElm {
  override getType(): string {
    return "IdealTransformerElm";
  }

  // One branch-current unknown (j = I1) instead of the parent's two.
  override getVoltageSourceCount(): number {
    return 1;
  }
  override setVoltageSource(n: number, vs: number): void {
    if (n === 0) this.voltSource = vs;
  }

  override stamp(sim: SimulationManager): void {
    const vn = sim.nodeCount + this.voltSource;
    const n = this.ratio;
    // KCL: I1 = j flows post0 → post1; I2 = −n·j flows post2 → post3.
    sim.stampMatrix(this.nodes[0], vn, 1);
    sim.stampMatrix(this.nodes[1], vn, -1);
    sim.stampMatrix(this.nodes[2], vn, -n);
    sim.stampMatrix(this.nodes[3], vn, n);
    // Constraint row: V1 − n·V2 = RSER·j.
    sim.stampMatrix(vn, this.nodes[0], 1);
    sim.stampMatrix(vn, this.nodes[1], -1);
    sim.stampMatrix(vn, this.nodes[2], -n);
    sim.stampMatrix(vn, this.nodes[3], n);
    sim.stampMatrix(vn, vn, -RSER);
  }

  override stampPhasor(sim: SimulationManager): void {
    const vn = sim.nodeCount + this.voltSource;
    const n = this.ratio;
    const one = Complex.ONE;
    const nc = new Complex(n, 0);
    sim.stampMatrixC(this.nodes[0], vn, one);
    sim.stampMatrixC(this.nodes[1], vn, one.neg());
    sim.stampMatrixC(this.nodes[2], vn, nc.neg());
    sim.stampMatrixC(this.nodes[3], vn, nc);
    sim.stampMatrixC(vn, this.nodes[0], one);
    sim.stampMatrixC(vn, this.nodes[1], one.neg());
    sim.stampMatrixC(vn, this.nodes[2], nc.neg());
    sim.stampMatrixC(vn, this.nodes[3], nc);
    sim.stampMatrixC(vn, vn, new Complex(-RSER, 0));
  }

  // No companion model: nothing to refresh per step.
  override startIteration(): void {}
  override doStep(_sim: SimulationManager): void {}

  // The engine delivers j = I1; the secondary current is derived (I2 = −n·I1),
  // keeping the parent's currents[] convention so getPostCurrent/draw work.
  override setCurrent(_vs: number, c: number): void {
    this.currents[0] = c;
    this.currents[1] = -this.ratio * c;
  }
  override setCurrentPhasor(_vs: number, c: Complex): void {
    this.currentPhasor = c;
    this.currentPhasor2 = c.scale(-this.ratio);
  }
  override calculateCurrentPhasor(): void {}

  // Single edit field: the turns ratio (full precision, like the coupling).
  override getEditInfo(n: number): EditInfo | null {
    if (n === 0) return EditInfo.precise("Turns Ratio (N1:N2)", this.ratio);
    return null;
  }
  override setEditValue(n: number, value: number): void {
    if (n === 0 && value > 0) this.ratio = value;
  }

  override getDumpAttributes(): number[] {
    return [this.ratio, this.orientation];
  }
  override applyDumpAttributes(a: number[]): void {
    if (a.length > 0) this.ratio = a[0];
    if (a.length > 1) this.orientation = ((Math.round(a[1]) % 4) + 4) % 4;
  }

  override draw(g: Graphics): void {
    super.draw(g);
    // Distinguish from the physical transformer with a small centred label.
    this.drawValues(g, "ideal n=" + round4(this.ratio), 14);
  }

  override getInfo(): string[] {
    return [
      "Ideal Transformer",
      "n = " + round4(this.ratio),
      "I1 = " + getUnitText(this.currents[0], "A"),
      "I2 = " + getUnitText(this.currents[1], "A"),
      "V1 = " + getUnitText(this.volts[0] - this.volts[1], "V"),
      "V2 = " + getUnitText(this.volts[2] - this.volts[3], "V"),
    ];
  }
  override getInfoPhasor(): string[] {
    return [
      "Ideal Transformer",
      "n = " + round4(this.ratio),
      "I1 = " + formatPolar(this.currentPhasor, "A"),
      "I2 = " + formatPolar(this.currentPhasor2, "A"),
      "V1 = " + formatPolar(this.voltsPhasor[0].sub(this.voltsPhasor[1]), "V"),
      "V2 = " + formatPolar(this.voltsPhasor[2].sub(this.voltsPhasor[3]), "V"),
    ];
  }
}

registerElement({
  name: "IdealTransformerElm",
  label: "Transformer (Ideal)",
  group: "Passive",
  dumpType: 122,
  ctor: (x, y) => new IdealTransformerElm(x, y),
});
