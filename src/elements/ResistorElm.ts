import { SimElement } from "./SimElement";
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

  override draw(g: Graphics): void {
    this.setBbox(this.point1.x, this.point1.y, this.point2.x, this.point2.y, 8);
    this.draw2Leads(g);
    this.color(g);
    const segs = 16;
    const xs: number[] = [this.lead1.x];
    const ys: number[] = [this.lead1.y];
    for (let i = 1; i < segs; i++) {
      const off = i % 2 === 1 ? 5 : -5;
      const p = this.interpPoint(this.lead1, this.lead2, i / segs, off);
      xs.push(p.x);
      ys.push(p.y);
    }
    xs.push(this.lead2.x);
    ys.push(this.lead2.y);
    g.drawPolyline(xs, ys, xs.length);
    this.doDots(g);
    this.drawValues(g, this.canvasValueText(), 9);
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
