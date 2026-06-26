import { SimElement } from "./SimElement";
import { Graphics } from "../ui/Graphics";
import { Point } from "../geom/Point";
import { registerElement } from "./ElementRegistry";
import { getUnitText, formatPolar } from "../util/format";

// Differential voltage probe: reads the potential difference between two nodes,
// Vab = V(a) − V(b). Its two tips join the nodes at A and B but it stamps
// nothing and never connects them (the span is drawn dashed to signal that).
// Placed with two clicks (A then B) — see MouseManager.usesTwoClickPlacement.
const PROBE_COLOR = "#66ff66";

export class DiffVoltageProbeElm extends SimElement {
  override getType(): string {
    return "DiffVoltageProbeElm";
  }
  override getPostCount(): number {
    return 2;
  }
  override getPost(n: number): Point {
    return n === 0 ? this.point1 : this.point2;
  }
  override currentMeasurable(): boolean {
    return false;
  }
  override usesTwoClickPlacement(): boolean {
    return true; // click A, then click B
  }

  private reading(): string {
    return SimElement.analysisMode === "phasor"
      ? formatPolar(this.voltsPhasor[0].sub(this.voltsPhasor[1]), "V")
      : getUnitText(this.volts[0] - this.volts[1], "V");
  }

  override draw(g: Graphics): void {
    this.setBbox(this.point1.x, this.point1.y, this.point2.x, this.point2.y, 8);
    // dashed span A—B (measurement only, not an electrical connection)
    g.setColor(this.selected ? SimElement.selectColor : PROBE_COLOR);
    g.setLineDash(4, 4);
    g.drawLineP(this.point1, this.point2);
    g.setLineDash(0, 0);
    // tips + a/b labels
    g.fillCircle(this.point1.x, this.point1.y, 3);
    g.fillCircle(this.point2.x, this.point2.y, 3);
    g.setFontSize(10);
    g.drawString("a", this.point1.x + 5, this.point1.y - 5);
    g.drawString("b", this.point2.x + 5, this.point2.y - 5);
    // reading at the midpoint
    const mx = Math.round((this.point1.x + this.point2.x) / 2);
    const my = Math.round((this.point1.y + this.point2.y) / 2);
    g.setColor(SimElement.valueColor);
    g.setFontSize(SimElement.valueFontSize);
    g.drawString(this.reading(), mx + 6, my - 4);
    this.drawPosts(g);
  }

  override getInfo(): string[] {
    return ["Diff Voltage Probe", "Vab = " + getUnitText(this.volts[0] - this.volts[1], "V")];
  }
  override getInfoPhasor(): string[] {
    return ["Diff Voltage Probe", "Vab = " + formatPolar(this.voltsPhasor[0].sub(this.voltsPhasor[1]), "V")];
  }
}

registerElement({
  name: "DiffVoltageProbeElm",
  label: "ΔV Probe",
  group: "Meters",
  dumpType: 141,
  ctor: (x, y) => new DiffVoltageProbeElm(x, y),
});
