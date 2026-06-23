import { SimElement } from "./SimElement";
import { Graphics } from "../ui/Graphics";
import { Point } from "../geom/Point";
import { registerElement } from "./ElementRegistry";
import type { SimulationManager } from "../core/SimulationManager";

// Ground: a single-terminal element that pins its node to the 0 V reference.
// It contributes nothing to the matrix — the engine sees isGround() and maps
// its post to node 0 (the row/col excluded from the MNA system).
export class GroundElm extends SimElement {
  override getType(): string {
    return "GroundElm";
  }
  override getPostCount(): number {
    return 1;
  }
  override getPost(_n: number): Point {
    return this.point1;
  }
  override isGround(): boolean {
    return true;
  }

  override setPoints(): void {
    super.setPoints();
    // If created with a zero-length drag, give the symbol a default stub.
    if (this.dn === 0) {
      this.point2 = new Point(this.x, this.y + 24);
      const dx = this.point2.x - this.point1.x;
      const dy = this.point2.y - this.point1.y;
      this.dn = Math.sqrt(dx * dx + dy * dy);
      this.dpx1 = dy / this.dn;
      this.dpy1 = -dx / this.dn;
    }
    this.lead1 = this.interpPoint(this.point1, this.point2, 1 - 16 / this.dn);
  }

  override stamp(_sim: SimulationManager): void {
    // nothing: ground is just a label for node 0
  }

  override draw(g: Graphics): void {
    this.setBbox(this.point1.x, this.point1.y, this.point2.x, this.point2.y, 12);
    this.color(g);
    g.drawLineP(this.point1, this.lead1);
    // three decreasing horizontal bars perpendicular to the lead
    const widths = [10, 6, 2];
    for (let i = 0; i < widths.length; i++) {
      const c = this.interpPoint(this.point1, this.point2, 1 - (i * 4) / this.dn);
      const a = new Point(Math.round(c.x + this.dpx1 * widths[i]), Math.round(c.y + this.dpy1 * widths[i]));
      const b = new Point(Math.round(c.x - this.dpx1 * widths[i]), Math.round(c.y - this.dpy1 * widths[i]));
      g.drawLineP(a, b);
    }
    this.drawPosts(g);
  }

  override getInfo(): string[] {
    return ["Ground", "0 V reference"];
  }
}

registerElement({
  name: "GroundElm",
  label: "Ground",
  group: "Sources",
  dumpType: 103,
  ctor: (x, y) => new GroundElm(x, y),
});
