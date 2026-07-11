import { SimElement, CurrentSense, CurrentSensePhasor } from "./SimElement";
import { Graphics } from "../ui/Graphics";
import { Point } from "../geom/Point";
import { EditInfo } from "./EditInfo";
import { registerElement } from "./ElementRegistry";
import { getUnitText, getShortUnitText } from "../util/format";
import { Inductor } from "./Inductor";
import { Complex } from "../core/Complex";
import type { SimulationManager } from "../core/SimulationManager";

// Inductor — delegates its companion model to the reusable Inductor helper.
export class InductorElm extends SimElement {
  inductance = 1; // henries
  private ind = new Inductor();
  private yPhasor = Complex.ZERO; // complex admittance at the analysis frequency

  override getType(): string {
    return "InductorElm";
  }
  override getPostCount(): number {
    return 2;
  }
  override getPost(n: number): Point {
    return n === 0 ? this.point1 : this.point2;
  }

  override setPoints(): void {
    super.setPoints();
    this.calcLeads(32);
  }

  override stamp(sim: SimulationManager): void {
    this.ind.inductance = this.inductance;
    this.ind.stamp(sim, this.nodes[0], this.nodes[1]);
  }
  override startIteration(): void {
    this.ind.startIteration(this.volts[0] - this.volts[1]);
  }
  override doStep(sim: SimulationManager): void {
    this.ind.doStep(sim);
  }
  override calculateCurrent(): void {
    this.current = this.ind.calculateCurrent(this.volts[0] - this.volts[1]);
  }

  // Phasor mode: Z_L = jωL → Y = 1/(jωL).
  override stampPhasor(sim: SimulationManager, omega: number): void {
    const zL = new Complex(0, omega * this.inductance);
    this.yPhasor = zL.abs() === 0 ? Complex.ZERO : Complex.ONE.div(zL);
    sim.stampAdmittance(this.nodes[0], this.nodes[1], this.yPhasor);
  }
  override calculateCurrentPhasor(): void {
    this.currentPhasor = this.voltsPhasor[0].sub(this.voltsPhasor[1]).mul(this.yPhasor);
  }
  override reset(): void {
    super.reset();
    this.ind.reset();
  }

  // i = vd/(2L/dt) + companion history — bindable as a current control. The g
  // coefficient is computed from L and the timestep directly (order-independent).
  override currentSense(sim: SimulationManager): CurrentSense {
    return {
      kind: "linear",
      p: this.nodes[0],
      n: this.nodes[1],
      g: sim.timeStep / (2 * this.inductance),
      iConst: this.ind.companionCurrent(),
    };
  }
  override currentSensePhasor(_sim: SimulationManager, omega: number): CurrentSensePhasor {
    const zL = new Complex(0, omega * this.inductance);
    const y = zL.abs() === 0 ? Complex.ZERO : Complex.ONE.div(zL);
    return { kind: "linear", p: this.nodes[0], n: this.nodes[1], y, iConst: Complex.ZERO };
  }

  // Faithful port of Falstad's InductorElm.draw + CircuitElm.drawCoil: the coil
  // is ceil(len/11) tangent SEMICIRCLES (radius len/(2·loopCt), arcs π→2π),
  // drawn in a local frame set up by the same canvas affine transform the Java
  // uses, stroke width 3, round line caps. hs = 8.
  override draw(g: Graphics): void {
    const hs = 8;
    this.setBboxP(this.point1, this.point2, hs);
    // Uniform stroke: leads and coil share one width (no thin-lead/thick-body mix).
    const w = this.needsHighlight() ? 4 : 3;
    this.color(g);
    g.setLineWidth(w);
    g.drawLineP(this.point1, this.lead1);
    g.drawLineP(this.point2, this.lead2);
    const len = Math.hypot(this.lead2.x - this.lead1.x, this.lead2.y - this.lead1.y);
    if (len > 0) {
      const ux = (this.lead2.x - this.lead1.x) / len;
      const uy = (this.lead2.y - this.lead1.y) / len;
      g.save();
      g.setLineWidth(w);
      g.setLineCap("round");
      g.transform(ux, uy, -uy, ux, this.lead1.x, this.lead1.y);
      const ctx = g.ctx;
      const loopCt = Math.ceil(len / 11);
      for (let loop = 0; loop < loopCt; loop++) {
        ctx.beginPath();
        ctx.moveTo((len * loop) / loopCt, 0);
        ctx.arc((len * (loop + 0.5)) / loopCt, 0, len / (2 * loopCt), Math.PI, Math.PI * 2);
        ctx.lineTo((len * (loop + 1)) / loopCt, 0);
        ctx.stroke();
      }
      g.restore();
    }
    this.doDots(g);
    this.drawValues(g, this.canvasValueText(), hs);
    this.drawReferenceMark(g);
    this.drawPosts(g);
  }

  // Transient: physical value "1H". Phasor: reactance in ohms with a "j" prefix
  // ("j376.991") to flag the imaginary impedance Z_L = jωL.
  protected override canvasValueText(): string {
    if (SimElement.analysisMode === "phasor") {
      const w = 2 * Math.PI * SimElement.analysisFrequency;
      return "j" + getShortUnitText(w * this.inductance, "");
    }
    return getShortUnitText(this.inductance, "H");
  }

  // Phasor edit only: whether the value field is shown/entered as impedance (Ω)
  // vs the physical value (H). The element always stores henries; Ω is derived.
  private editUnitOhm = true;
  override beginEdit(): void {
    this.editUnitOhm = true; // default to Ω each time the dialog opens
  }

  override getEditInfo(n: number): EditInfo | null {
    if (n !== 0) return null;
    if (SimElement.analysisMode !== "phasor") {
      return new EditInfo("Inductance (H)", this.inductance);
    }
    const w = 2 * Math.PI * SimElement.analysisFrequency;
    const ei = this.editUnitOhm
      ? new EditInfo("Impedance (Ω)", w * this.inductance) // XL = ωL
      : new EditInfo("Inductance (H)", this.inductance);
    ei.unitChoices = ["Ω", "H"];
    ei.unitChoiceIndex = this.editUnitOhm ? 0 : 1;
    return ei;
  }
  override setEditValue(n: number, value: number): void {
    if (n !== 0 || value <= 0) return;
    if (SimElement.analysisMode === "phasor" && this.editUnitOhm) {
      const w = 2 * Math.PI * SimElement.analysisFrequency;
      if (w > 0) this.inductance = value / w; // XL = ωL  ->  L = XL/ω
    } else {
      this.inductance = value; // physical henries
    }
  }
  override setEditUnit(n: number, choiceIndex: number): void {
    if (n === 0) this.editUnitOhm = choiceIndex === 0;
  }

  override getDumpAttributes(): number[] {
    return [this.inductance];
  }
  override applyDumpAttributes(a: number[]): void {
    if (a.length > 0) this.inductance = a[0];
  }

  override getInfo(): string[] {
    return [
      "Inductor",
      this.currentInfo(),
      this.voltageDiffInfo(),
      "L = " + getUnitText(this.inductance, "H"),
      this.powerInfo(),
    ];
  }

  override getInfoPhasor(): string[] {
    const xl = this.yPhasor.abs() === 0 ? 0 : 1 / this.yPhasor.abs();
    return [
      "Inductor",
      this.currentInfoPhasor(),
      this.voltageDiffInfoPhasor(),
      "L = " + getUnitText(this.inductance, "H"),
      "XL = " + getUnitText(xl, "Ω"),
      this.powerInfoPhasor(),
    ];
  }
}

registerElement({
  name: "InductorElm",
  label: "Inductor",
  group: "Passive",
  dumpType: 108,
  ctor: (x, y) => new InductorElm(x, y),
});
