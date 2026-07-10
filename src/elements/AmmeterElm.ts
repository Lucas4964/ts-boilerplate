import { SimElement, CurrentSense, CurrentSensePhasor } from "./SimElement";
import { Graphics } from "../ui/Graphics";
import { Point } from "../geom/Point";
import { getUnitText, formatPolar } from "../util/format";
import { Complex } from "../core/Complex";
import { registerElement } from "./ElementRegistry";
import type { SimulationManager } from "../core/SimulationManager";

// Series ammeter: an IDEAL 0 V voltage source inserted into the branch. Its
// branch current is solved as an extra MNA unknown and delivered back by the
// engine (setCurrent / setCurrentPhasor), so the reading is the exact series
// current with zero inserted voltage drop. This is the same trick Falstad's
// AmmeterElm and SPICE (a dummy `Vdummy … 0` source) use. Unlike the clamp-on
// CurrentProbeElm (0 posts, no topology change), this wires INTO the circuit.
const METER_COLOR = "#66ccff";

export class AmmeterElm extends SimElement {
  override getType(): string {
    return "AmmeterElm";
  }
  override getPostCount(): number {
    return 2;
  }
  override getPost(n: number): Point {
    return n === 0 ? this.point1 : this.point2;
  }

  // One voltage-source row (the 0 V constraint); its solved branch current is
  // the meter reading. The inherited setVoltageSource stores it in voltSource.
  override getVoltageSourceCount(): number {
    return 1;
  }

  override setPoints(): void {
    super.setPoints();
    this.calcLeads(24);
  }

  override stamp(sim: SimulationManager): void {
    sim.stampVoltageSource(this.nodes[0], this.nodes[1], this.voltSource, 0);
  }

  override stampPhasor(sim: SimulationManager): void {
    sim.stampVoltageSourceC(this.nodes[0], this.nodes[1], this.voltSource, Complex.ZERO);
  }

  // The meter's 0 V row is a branch unknown — bindable as a current control.
  override currentSense(): CurrentSense {
    return { kind: "branch", vs: this.voltSource };
  }
  override currentSensePhasor(): CurrentSensePhasor {
    return { kind: "branch", vs: this.voltSource };
  }

  private reading(): string {
    return SimElement.analysisMode === "phasor"
      ? formatPolar(this.getCurrentPhasor(), "A")
      : getUnitText(this.getCurrent(), "A");
  }

  override draw(g: Graphics): void {
    this.setBbox(this.point1.x, this.point1.y, this.point2.x, this.point2.y, 12);
    this.draw2Leads(g);
    const center = this.interpPoint(this.lead1, this.lead2, 0.5);
    const r = 10;
    g.setColor(this.selected ? SimElement.selectColor : METER_COLOR);
    g.drawCircle(center.x, center.y, r);
    g.setFontSize(12);
    const w = g.measureWidth("A");
    g.drawString("A", center.x - w / 2, center.y + 4);
    this.doDots(g);
    this.drawPosts(g);
    // reading beside the body (horizontal, like the value labels)
    this.drawValues(g, this.reading(), r + 4);
  }

  override getInfo(): string[] {
    return ["Ammeter", "I = " + getUnitText(this.getCurrent(), "A")];
  }
  override getInfoPhasor(): string[] {
    return ["Ammeter", "I = " + formatPolar(this.getCurrentPhasor(), "A")];
  }
}

registerElement({
  name: "AmmeterElm",
  label: "Ammeter",
  group: "Meters",
  dumpType: 370,
  ctor: (x, y) => new AmmeterElm(x, y),
});
