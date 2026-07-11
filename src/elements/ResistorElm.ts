import { SimElement, CurrentSense, CurrentSensePhasor } from "./SimElement";
import { Graphics } from "../ui/Graphics";
import { Point } from "../geom/Point";
import { EditInfo } from "./EditInfo";
import { registerElement } from "./ElementRegistry";
import { getUnitText, getShortUnitText } from "../util/format";
import { Complex } from "../core/Complex";
import type { SimulationManager } from "../core/SimulationManager";

// Linear resistor — the simplest element: one constant matrix stamp, current
// derived from Ohm's law. A good template to copy when adding a new 2-terminal
// element (see README "add an element").
export class ResistorElm extends SimElement {
  resistance = 1000;

  override getType(): string {
    return "ResistorElm";
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
    sim.stampResistor(this.nodes[0], this.nodes[1], this.resistance);
  }

  override calculateCurrent(): void {
    this.current = (this.volts[0] - this.volts[1]) / this.resistance;
  }

  // Phasor mode: Z_R = R (purely real), so Y = 1/R.
  override stampPhasor(sim: SimulationManager): void {
    sim.stampAdmittance(this.nodes[0], this.nodes[1], new Complex(1 / this.resistance, 0));
  }
  override calculateCurrentPhasor(): void {
    this.currentPhasor = this.voltsPhasor[0].sub(this.voltsPhasor[1]).scale(1 / this.resistance);
  }

  // i = (V(p)−V(n))/R — bindable as a current control (Ohm's law is exact).
  override currentSense(): CurrentSense {
    return { kind: "linear", p: this.nodes[0], n: this.nodes[1], g: 1 / this.resistance, iConst: 0 };
  }
  override currentSensePhasor(): CurrentSensePhasor {
    return {
      kind: "linear",
      p: this.nodes[0],
      n: this.nodes[1],
      y: new Complex(1 / this.resistance, 0),
      iConst: Complex.ZERO,
    };
  }

  // Faithful port of Falstad's ResistorElm.draw (US zigzag): the body is drawn
  // in a local frame — x runs 0→len along lead1→lead2, +y perpendicular — set
  // up with a canvas affine transform, exactly like the Java (g.context
  // .transform(ux, uy, −uy, ux, lead1.x, lead1.y)). 4 loop iterations produce
  // the classic 8-peak zigzag with amplitude hs = 6 (2 when the element is
  // very short), stroke width 3.
  override draw(g: Graphics): void {
    let hs = 6;
    this.setBboxP(this.point1, this.point2, hs);
    this.draw2Leads(g);
    const len = Math.hypot(this.lead2.x - this.lead1.x, this.lead2.y - this.lead1.y);
    if (len > 0) {
      const ux = (this.lead2.x - this.lead1.x) / len;
      const uy = (this.lead2.y - this.lead1.y) / len;
      this.color(g);
      g.save();
      g.setLineWidth(3);
      g.transform(ux, uy, -uy, ux, this.lead1.x, this.lead1.y);
      if (this.dn < 30) hs = 2;
      const ctx = g.ctx;
      ctx.beginPath();
      ctx.moveTo(0, 0);
      for (let i = 0; i < 4; i++) {
        ctx.lineTo(((1 + 4 * i) * len) / 16, hs);
        ctx.lineTo(((3 + 4 * i) * len) / 16, -hs);
      }
      ctx.lineTo(len, 0);
      ctx.stroke();
      g.restore();
    }
    this.doDots(g);
    this.drawValues(g, this.canvasValueText(), hs + 2);
    this.drawReferenceMark(g);
    this.drawPosts(g);
  }

  // Resistance is real ohms in both modes (the photo shows just the number).
  protected override canvasValueText(): string {
    return getShortUnitText(this.resistance, "");
  }

  override getEditInfo(n: number): EditInfo | null {
    return n === 0 ? new EditInfo("Resistance (ohms)", this.resistance) : null;
  }
  override setEditValue(n: number, value: number): void {
    if (n === 0 && value > 0) this.resistance = value;
  }

  override getDumpAttributes(): number[] {
    return [this.resistance];
  }
  override applyDumpAttributes(a: number[]): void {
    if (a.length > 0) this.resistance = a[0];
  }

  override getInfo(): string[] {
    return [
      "Resistor",
      this.currentInfo(),
      this.voltageDiffInfo(),
      "R = " + getUnitText(this.resistance, "Ω"),
      this.powerInfo(),
    ];
  }

  override getInfoPhasor(): string[] {
    return [
      "Resistor",
      this.currentInfoPhasor(),
      this.voltageDiffInfoPhasor(),
      "R = " + getUnitText(this.resistance, "Ω"),
      this.powerInfoPhasor(),
    ];
  }
}

registerElement({
  name: "ResistorElm",
  label: "Resistor",
  group: "Passive",
  dumpType: 114,
  ctor: (x, y) => new ResistorElm(x, y),
});
