import { SimElement, CurrentSense, CurrentSensePhasor } from "./SimElement";
import { Graphics } from "../ui/Graphics";
import { Point } from "../geom/Point";
import { EditInfo } from "./EditInfo";
import { registerElement } from "./ElementRegistry";
import { getUnitText, getShortUnitText } from "../util/format";
import { Complex } from "../core/Complex";
import type { SimulationManager } from "../core/SimulationManager";

// Capacitor via the trapezoidal companion model: a resistor (R = dt/2C) in
// parallel with a current source whose value is refreshed each timestep from
// the previous voltage/current. This is the canonical reactive-element pattern:
//   stamp()          -> constant companion resistor
//   startIteration() -> recompute the companion current source
//   doStep()         -> stamp that current source into the right-hand side
//   calculateCurrent()-> derive element current and remember the voltage
export class CapacitorElm extends SimElement {
  capacitance = 1e-5; // 10 µF
  /** Voltage across the capacitor at t = 0 (transient only), as in Falstad's
   *  CapacitorElm — reset() precharges the companion history to this value. */
  initialVoltage = 0;
  private compResistance = 0;
  private voltdiff = 0;
  private curSourceValue = 0;
  private yPhasor = Complex.ZERO; // complex admittance at the analysis frequency

  private plate1: [Point, Point] = [new Point(), new Point()];
  private plate2: [Point, Point] = [new Point(), new Point()];

  override getType(): string {
    return "CapacitorElm";
  }
  override getPostCount(): number {
    return 2;
  }
  override getPost(n: number): Point {
    return n === 0 ? this.point1 : this.point2;
  }

  override setPoints(): void {
    super.setPoints();
    this.calcLeads(8); // small gap between the plates
    const w = 12;
    this.plate1 = [
      new Point(Math.round(this.lead1.x + this.dpx1 * w), Math.round(this.lead1.y + this.dpy1 * w)),
      new Point(Math.round(this.lead1.x - this.dpx1 * w), Math.round(this.lead1.y - this.dpy1 * w)),
    ];
    this.plate2 = [
      new Point(Math.round(this.lead2.x + this.dpx1 * w), Math.round(this.lead2.y + this.dpy1 * w)),
      new Point(Math.round(this.lead2.x - this.dpx1 * w), Math.round(this.lead2.y - this.dpy1 * w)),
    ];
  }

  override stamp(sim: SimulationManager): void {
    this.compResistance = sim.timeStep / (2 * this.capacitance);
    sim.stampResistor(this.nodes[0], this.nodes[1], this.compResistance);
  }

  override startIteration(): void {
    this.curSourceValue = -this.voltdiff / this.compResistance - this.current;
  }

  override doStep(sim: SimulationManager): void {
    sim.stampCurrentSource(this.nodes[0], this.nodes[1], this.curSourceValue);
  }

  override calculateCurrent(): void {
    const vd = this.volts[0] - this.volts[1];
    if (this.compResistance > 0) this.current = vd / this.compResistance + this.curSourceValue;
    this.voltdiff = vd;
  }

  // Phasor mode: Z_C = 1/(jωC) → Y = jωC.
  override stampPhasor(sim: SimulationManager, omega: number): void {
    this.yPhasor = new Complex(0, omega * this.capacitance);
    sim.stampAdmittance(this.nodes[0], this.nodes[1], this.yPhasor);
  }
  override calculateCurrentPhasor(): void {
    this.currentPhasor = this.voltsPhasor[0].sub(this.voltsPhasor[1]).mul(this.yPhasor);
  }

  override reset(): void {
    super.reset();
    this.voltdiff = this.initialVoltage; // precharge (Falstad parity)
    this.curSourceValue = 0;
  }

  // i = vd/(dt/2C) + companion history — bindable as a current control. The g
  // coefficient is computed from C and the timestep directly (order-independent).
  override currentSense(sim: SimulationManager): CurrentSense {
    return {
      kind: "linear",
      p: this.nodes[0],
      n: this.nodes[1],
      g: (2 * this.capacitance) / sim.timeStep,
      iConst: this.curSourceValue,
    };
  }
  override currentSensePhasor(_sim: SimulationManager, omega: number): CurrentSensePhasor {
    return {
      kind: "linear",
      p: this.nodes[0],
      n: this.nodes[1],
      y: new Complex(0, omega * this.capacitance),
      iConst: Complex.ZERO,
    };
  }

  override draw(g: Graphics): void {
    this.setBboxP(this.point1, this.point2, 12);
    this.draw2Leads(g);
    this.color(g);
    g.drawLineP(this.plate1[0], this.plate1[1]);
    g.drawLineP(this.plate2[0], this.plate2[1]);
    this.doDots(g);
    this.drawValues(g, this.canvasValueText(), 15);
    this.drawReferenceMark(g);
    this.drawPosts(g);
  }

  // Transient: physical value "15µF". Phasor: reactance magnitude in ohms with a
  // "-j" prefix ("-j176.839") to flag the imaginary impedance Z_C = 1/(jωC).
  protected override canvasValueText(): string {
    if (SimElement.analysisMode === "phasor") {
      const w = 2 * Math.PI * SimElement.analysisFrequency;
      const xc = w > 0 ? 1 / (w * this.capacitance) : 0;
      return "-j" + getShortUnitText(xc, "");
    }
    return getShortUnitText(this.capacitance, "F");
  }

  // Phasor edit only: whether the value field is shown/entered as impedance (Ω)
  // vs the physical value (F). The element always stores farads; Ω is derived.
  private editUnitOhm = true;
  override beginEdit(): void {
    this.editUnitOhm = true; // default to Ω each time the dialog opens
  }

  override getEditInfo(n: number): EditInfo | null {
    // Initial voltage is a transient-only concept (no initial condition in a
    // steady-state phasor solve), so the field appears only in transient mode.
    if (n === 1 && SimElement.analysisMode !== "phasor") {
      return new EditInfo("Initial Voltage (V)", this.initialVoltage);
    }
    if (n !== 0) return null;
    if (SimElement.analysisMode !== "phasor") {
      return new EditInfo("Capacitance (F)", this.capacitance);
    }
    const w = 2 * Math.PI * SimElement.analysisFrequency;
    const xc = w > 0 ? 1 / (w * this.capacitance) : 0; // |XC| = 1/(ωC)
    const ei = this.editUnitOhm
      ? new EditInfo("Impedance (Ω)", xc)
      : new EditInfo("Capacitance (F)", this.capacitance);
    ei.unitChoices = ["Ω", "F"];
    ei.unitChoiceIndex = this.editUnitOhm ? 0 : 1;
    return ei;
  }
  override setEditValue(n: number, value: number): void {
    if (n === 1) {
      // initial voltage may be zero or negative; takes effect on Reset
      if (Number.isFinite(value)) this.initialVoltage = value;
      return;
    }
    if (n !== 0 || value <= 0) return;
    if (SimElement.analysisMode === "phasor" && this.editUnitOhm) {
      const w = 2 * Math.PI * SimElement.analysisFrequency;
      if (w > 0) this.capacitance = 1 / (w * value); // XC = 1/(ωC)  ->  C = 1/(ωXC)
    } else {
      this.capacitance = value; // physical farads
    }
  }
  override setEditUnit(n: number, choiceIndex: number): void {
    if (n === 0) this.editUnitOhm = choiceIndex === 0;
  }

  override getDumpAttributes(): number[] {
    return [this.capacitance, this.initialVoltage];
  }
  override applyDumpAttributes(a: number[]): void {
    if (a.length > 0) this.capacitance = a[0];
    if (a.length > 1) {
      this.initialVoltage = a[1];
      this.voltdiff = a[1]; // a loaded circuit starts precharged (fresh t = 0)
    }
  }

  override getInfo(): string[] {
    return [
      "Capacitor",
      this.currentInfo(),
      this.voltageDiffInfo(),
      "C = " + getUnitText(this.capacitance, "F"),
      this.powerInfo(),
    ];
  }

  override getInfoPhasor(): string[] {
    const xc = this.yPhasor.abs() === 0 ? 0 : 1 / this.yPhasor.abs();
    return [
      "Capacitor",
      this.currentInfoPhasor(),
      this.voltageDiffInfoPhasor(),
      "C = " + getUnitText(this.capacitance, "F"),
      "XC = " + getUnitText(xc, "Ω"),
      this.powerInfoPhasor(),
    ];
  }
}

registerElement({
  name: "CapacitorElm",
  label: "Capacitor",
  group: "Passive",
  dumpType: 99,
  ctor: (x, y) => new CapacitorElm(x, y),
});
