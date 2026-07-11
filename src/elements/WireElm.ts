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

  // Falstad's WireElm.getMouseDistance: a wire only claims the click when the
  // cursor is within 10 world units of its line — its long thin bounding box
  // must not steal clicks meant for elements it merely crosses.
  override getMouseDistance(gx: number, gy: number): number {
    const d2 = this.lineDistanceSq(this.x, this.y, this.x2, this.y2, gx, gy);
    return d2 <= 100 ? d2 : -1;
  }

  override draw(g: Graphics): void {
    this.setBboxP(this.point1, this.point2, 3);
    g.setColor(this.needsHighlight() ? SimElement.selectColor : "#7ee787");
    g.setLineWidth(this.needsHighlight() ? 3 : 2);
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
