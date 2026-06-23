import { SimElement } from "./SimElement";
import { Graphics } from "../ui/Graphics";
import { Point } from "../geom/Point";
import { EditInfo } from "./EditInfo";
import { registerElement } from "./ElementRegistry";
import { getUnitText } from "../util/format";
import type { SimulationManager } from "../core/SimulationManager";

// Ideal-ish transformer: two magnetically-coupled inductors. The companion
// model is the trapezoidal discretization of the 2x2 inductance matrix
//   [v1; v2] = [L1 M; M L2] d/dt [i1; i2]
// stamped as two conductances + two voltage-controlled current sources, plus a
// pair of companion current sources updated each step. couplingCoef≈1 makes it
// behave as a near-ideal transformer with turns ratio `ratio`.
export class TransformerElm extends SimElement {
  inductance = 4; // primary inductance (H)
  ratio = 1; // secondary / primary turns
  couplingCoef = 0.999;

  // companion admittance matrix entries (set in stamp)
  private a1 = 0;
  private a2 = 0;
  private a3 = 0;
  private a4 = 0;
  private curSourceValue1 = 0;
  private curSourceValue2 = 0;
  private currents: [number, number] = [0, 0];
  private curcount1 = 0;
  private curcount2 = 0;

  private posts: Point[] = [new Point(), new Point(), new Point(), new Point()];

  override getType(): string {
    return "TransformerElm";
  }
  override getPostCount(): number {
    return 4;
  }
  override getPost(n: number): Point {
    return this.posts[n];
  }

  override setPoints(): void {
    super.setPoints();
    // Axis-aligned box; primary = left edge, secondary = right edge.
    const xL = this.x;
    const xR = Math.abs(this.x2 - this.x) < 16 ? this.x + 48 : this.x2;
    const yT = this.y;
    const yB = Math.abs(this.y2 - this.y) < 16 ? this.y + 64 : this.y2;
    this.posts = [
      new Point(xL, yT), // 0 primary top
      new Point(xL, yB), // 1 primary bottom
      new Point(xR, yT), // 2 secondary top
      new Point(xR, yB), // 3 secondary bottom
    ];
  }

  override stamp(sim: SimulationManager): void {
    const l1 = this.inductance;
    const l2 = this.inductance * this.ratio * this.ratio;
    const m = this.couplingCoef * Math.sqrt(l1 * l2);
    const deti = 1 / (l1 * l2 - m * m);
    const ts = sim.timeStep / 2; // trapezoidal
    this.a1 = l2 * deti * ts;
    this.a2 = -m * deti * ts;
    this.a3 = -m * deti * ts;
    this.a4 = l1 * deti * ts;
    sim.stampConductance(this.nodes[0], this.nodes[1], this.a1);
    sim.stampVCCurrentSource(this.nodes[0], this.nodes[1], this.nodes[2], this.nodes[3], this.a2);
    sim.stampVCCurrentSource(this.nodes[2], this.nodes[3], this.nodes[0], this.nodes[1], this.a3);
    sim.stampConductance(this.nodes[2], this.nodes[3], this.a4);
  }

  override startIteration(): void {
    const vd1 = this.volts[0] - this.volts[1];
    const vd2 = this.volts[2] - this.volts[3];
    this.curSourceValue1 = vd1 * this.a1 + vd2 * this.a2 + this.currents[0];
    this.curSourceValue2 = vd1 * this.a3 + vd2 * this.a4 + this.currents[1];
  }

  override doStep(sim: SimulationManager): void {
    sim.stampCurrentSource(this.nodes[0], this.nodes[1], this.curSourceValue1);
    sim.stampCurrentSource(this.nodes[2], this.nodes[3], this.curSourceValue2);
  }

  override calculateCurrent(): void {
    const vd1 = this.volts[0] - this.volts[1];
    const vd2 = this.volts[2] - this.volts[3];
    this.currents[0] = vd1 * this.a1 + vd2 * this.a2 + this.curSourceValue1;
    this.currents[1] = vd1 * this.a3 + vd2 * this.a4 + this.curSourceValue2;
    this.current = this.currents[0];
  }

  override reset(): void {
    super.reset();
    this.currents = [0, 0];
    this.curSourceValue1 = 0;
    this.curSourceValue2 = 0;
    this.curcount1 = 0;
    this.curcount2 = 0;
  }

  private drawCoil(g: Graphics, top: Point, bottom: Point, dir: number): void {
    const segs = 32;
    const humps = 4;
    const amp = 8 * dir;
    const xs: number[] = [];
    const ys: number[] = [];
    for (let i = 0; i <= segs; i++) {
      const f = i / segs;
      const off = Math.abs(Math.sin(f * humps * Math.PI)) * amp;
      xs.push(Math.round(top.x + off));
      ys.push(Math.round(top.y + (bottom.y - top.y) * f));
    }
    g.drawPolyline(xs, ys, xs.length);
  }

  override draw(g: Graphics): void {
    const xL = this.posts[0].x;
    const xR = this.posts[2].x;
    const yT = this.posts[0].y;
    const yB = this.posts[1].y;
    this.setBbox(xL, yT, xR, yB, 10);
    this.color(g);
    this.drawCoil(g, this.posts[0], this.posts[1], +1); // primary, humps toward center
    this.drawCoil(g, this.posts[2], this.posts[3], -1); // secondary
    // core lines
    const cx = Math.round((xL + xR) / 2);
    g.drawLine(cx - 3, yT, cx - 3, yB);
    g.drawLine(cx + 3, yT, cx + 3, yB);
    // current animation on each winding
    this.curcount1 = this.updateDotCount(this.currents[0], this.curcount1);
    this.curcount2 = this.updateDotCount(this.currents[1], this.curcount2);
    this.drawDots(g, this.posts[0], this.posts[1], this.curcount1);
    this.drawDots(g, this.posts[2], this.posts[3], this.curcount2);
    this.drawPosts(g);
  }

  override getEditInfo(n: number): EditInfo | null {
    if (n === 0) return new EditInfo("Primary Inductance (H)", this.inductance);
    if (n === 1) return new EditInfo("Turns Ratio", this.ratio);
    if (n === 2) return new EditInfo("Coupling Coefficient", this.couplingCoef);
    return null;
  }
  override setEditValue(n: number, value: number): void {
    if (n === 0 && value > 0) this.inductance = value;
    else if (n === 1 && value > 0) this.ratio = value;
    else if (n === 2 && value > 0 && value < 1) this.couplingCoef = value;
  }

  override getDumpAttributes(): number[] {
    return [this.inductance, this.ratio, this.couplingCoef];
  }
  override applyDumpAttributes(a: number[]): void {
    if (a.length > 0) this.inductance = a[0];
    if (a.length > 1) this.ratio = a[1];
    if (a.length > 2) this.couplingCoef = a[2];
  }

  override getInfo(): string[] {
    return [
      "Transformer",
      "L1 = " + getUnitText(this.inductance, "H"),
      "ratio = " + this.ratio.toFixed(3),
      "I1 = " + getUnitText(this.currents[0], "A"),
      "I2 = " + getUnitText(this.currents[1], "A"),
    ];
  }
}

registerElement({
  name: "TransformerElm",
  label: "Transformer",
  group: "Passive",
  dumpType: 121,
  ctor: (x, y) => new TransformerElm(x, y),
});
