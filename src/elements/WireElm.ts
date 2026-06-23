import { SimElement } from "./SimElement";
import { Graphics } from "../ui/Graphics";
import { Point } from "../geom/Point";
import { registerElement } from "./ElementRegistry";
import { getUnitText } from "../util/format";

// Ideal wire: zero resistance, so it stamps nothing. Instead the engine's
// node-assignment pass (SimulationManager.analyzeCircuit) merges a wire's two
// posts into the same node, letting you connect arbitrary points. Wire current
// is not derived here (a known simplification — see README).
export class WireElm extends SimElement {
  override getType(): string {
    return "WireElm";
  }
  override getPostCount(): number {
    return 2;
  }
  override getPost(n: number): Point {
    return n === 0 ? this.point1 : this.point2;
  }
  override isWire(): boolean {
    return true;
  }

  override draw(g: Graphics): void {
    this.setBbox(this.point1.x, this.point1.y, this.point2.x, this.point2.y, 4);
    g.setColor(this.selected ? SimElement.selectColor : "#7ee787");
    g.setLineWidth(this.selected ? 3 : 2);
    g.drawLineP(this.point1, this.point2);
    this.drawPosts(g);
  }

  override getInfo(): string[] {
    return ["Wire", "V = " + getUnitText(this.volts[0], "V")];
  }
}

registerElement({
  name: "WireElm",
  label: "Wire",
  group: "Basic",
  dumpType: 119,
  ctor: (x, y) => new WireElm(x, y),
});
