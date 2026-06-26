import { SimElement } from "./SimElement";
import { Graphics } from "../ui/Graphics";
import { Point, distanceSq } from "../geom/Point";
import { registerElement } from "./ElementRegistry";
import { getUnitText, formatPolar } from "../util/format";

// Absolute voltage probe: a single-terminal meter that reads the voltage of the
// node under its tip, referenced to ground (V = V(node) − 0). It does not stamp
// anything — its post just joins the node it sits on, and it reads the solved
// node voltage. Place the tip on a junction/wire; the reading shows on canvas.
const PROBE_COLOR = "#66ff66";

export class VoltageProbeElm extends SimElement {
  override getType(): string {
    return "VoltageProbeElm";
  }
  override getPostCount(): number {
    return 1;
  }
  override getPost(_n: number): Point {
    return this.point1;
  }
  override currentMeasurable(): boolean {
    return false; // a probe carries no branch current
  }

  override setPoints(): void {
    super.setPoints();
    // Collapsed to a point (plain click): give it an upward stem to draw/grab.
    if (this.dn === 0) {
      this.point2 = new Point(this.x, this.y - 40);
      const dx = this.point2.x - this.point1.x;
      const dy = this.point2.y - this.point1.y;
      this.dn = Math.hypot(dx, dy);
      this.dpx1 = dy / this.dn;
      this.dpy1 = -dx / this.dn;
    }
  }
  override getDefaultDragOffset(): { dx: number; dy: number } {
    return { dx: 0, dy: -40 }; // points up by default
  }
  // Only the body end (point2) reorients; grabbing the tip/lead moves the whole probe.
  override nearestHandle(wx: number, wy: number, hitDist: number): number {
    return distanceSq(wx, wy, this.x2, this.y2) <= hitDist * hitDist ? 1 : -1;
  }

  private reading(): string {
    return SimElement.analysisMode === "phasor"
      ? formatPolar(this.voltsPhasor[0], "V")
      : getUnitText(this.volts[0], "V");
  }

  override draw(g: Graphics): void {
    this.color(g);
    g.drawLineP(this.point1, this.point2); // lead from tip (node) to the body
    g.fillCircle(this.point1.x, this.point1.y, 3); // tip on the measured node
    // body disk with a "V"
    g.setColor(this.selected ? SimElement.selectColor : PROBE_COLOR);
    g.drawCircle(this.point2.x, this.point2.y, 7);
    g.setFontSize(10);
    g.drawString("V", this.point2.x - 3, this.point2.y + 4);
    this.setBbox(this.point1.x, this.point1.y, this.point2.x, this.point2.y, 10);
    // reading next to the body
    g.setColor(SimElement.valueColor);
    g.setFontSize(SimElement.valueFontSize);
    g.drawString(this.reading(), this.point2.x + 11, this.point2.y + 4);
    this.drawPosts(g);
  }

  override getInfo(): string[] {
    return ["Voltage Probe", "V = " + getUnitText(this.volts[0], "V")];
  }
  override getInfoPhasor(): string[] {
    return ["Voltage Probe", "V = " + formatPolar(this.voltsPhasor[0], "V")];
  }
}

registerElement({
  name: "VoltageProbeElm",
  label: "V Probe",
  group: "Meters",
  dumpType: 140,
  ctor: (x, y) => new VoltageProbeElm(x, y),
});
