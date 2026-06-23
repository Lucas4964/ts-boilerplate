import { SimElement } from "./SimElement";
import { Graphics } from "../ui/Graphics";
import { Point } from "../geom/Point";
import { EditInfo } from "./EditInfo";
import { registerElement } from "./ElementRegistry";
import { getUnitText } from "../util/format";
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
  private compResistance = 0;
  private voltdiff = 0;
  private curSourceValue = 0;

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

  override reset(): void {
    super.reset();
    this.voltdiff = 0;
    this.curSourceValue = 0;
  }

  override draw(g: Graphics): void {
    this.setBbox(this.point1.x, this.point1.y, this.point2.x, this.point2.y, 12);
    this.draw2Leads(g);
    this.color(g);
    g.drawLineP(this.plate1[0], this.plate1[1]);
    g.drawLineP(this.plate2[0], this.plate2[1]);
    this.doDots(g);
    this.drawReferenceMark(g);
    this.drawPosts(g);
  }

  override getEditInfo(n: number): EditInfo | null {
    return n === 0 ? new EditInfo("Capacitance (F)", this.capacitance) : null;
  }
  override setEditValue(n: number, value: number): void {
    if (n === 0 && value > 0) this.capacitance = value;
  }

  override getDumpAttributes(): number[] {
    return [this.capacitance];
  }
  override applyDumpAttributes(a: number[]): void {
    if (a.length > 0) this.capacitance = a[0];
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
}

registerElement({
  name: "CapacitorElm",
  label: "Capacitor",
  group: "Passive",
  dumpType: 99,
  ctor: (x, y) => new CapacitorElm(x, y),
});
