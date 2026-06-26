import { SimElement } from "./SimElement";
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

  override draw(g: Graphics): void {
    this.setBbox(this.point1.x, this.point1.y, this.point2.x, this.point2.y, 10);
    this.draw2Leads(g);
    this.color(g);
    // four coil "bumps" drawn as a single polyline (|sin| humps on one side)
    const segs = 40;
    const humps = 4;
    const amp = 7;
    const xs: number[] = [];
    const ys: number[] = [];
    for (let i = 0; i <= segs; i++) {
      const f = i / segs;
      const off = Math.abs(Math.sin(f * humps * Math.PI)) * amp;
      const p = this.interpPoint(this.lead1, this.lead2, f, off);
      xs.push(p.x);
      ys.push(p.y);
    }
    g.drawPolyline(xs, ys, xs.length);
    this.doDots(g);
    this.drawValues(g, this.canvasValueText(), 10);
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
