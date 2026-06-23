import { SimElement } from "./SimElement";
import { Graphics } from "../ui/Graphics";
import { Point } from "../geom/Point";
import { EditInfo } from "./EditInfo";
import { registerElement } from "./ElementRegistry";
import { getUnitText } from "../util/format";
import { Inductor } from "./Inductor";
import type { SimulationManager } from "../core/SimulationManager";

// Inductor — delegates its companion model to the reusable Inductor helper.
export class InductorElm extends SimElement {
  inductance = 1; // henries
  private ind = new Inductor();

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
    this.drawReferenceMark(g);
    this.drawPosts(g);
  }

  override getEditInfo(n: number): EditInfo | null {
    return n === 0 ? new EditInfo("Inductance (H)", this.inductance) : null;
  }
  override setEditValue(n: number, value: number): void {
    if (n === 0 && value > 0) this.inductance = value;
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
}

registerElement({
  name: "InductorElm",
  label: "Inductor",
  group: "Passive",
  dumpType: 108,
  ctor: (x, y) => new InductorElm(x, y),
});
