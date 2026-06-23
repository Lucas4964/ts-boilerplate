import { SimElement } from "./SimElement";
import { Graphics } from "../ui/Graphics";
import { Point, distanceSq } from "../geom/Point";
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
    // If collapsed to a point (created with a plain click), give the symbol a
    // downward stub so it has an orientation to draw and a handle to grab.
    if (this.dn === 0) {
      this.point2 = new Point(this.x, this.y + 32);
      const dx = this.point2.x - this.point1.x;
      const dy = this.point2.y - this.point1.y;
      this.dn = Math.sqrt(dx * dx + dy * dy);
      this.dpx1 = dy / this.dn;
      this.dpy1 = -dx / this.dn;
    }
  }

  override getDefaultDragOffset(): { dx: number; dy: number } {
    return { dx: 0, dy: 32 }; // a ground points downward by default
  }

  // Only the symbol tip (point2) is a rotate/resize handle; grabbing the post
  // or the lead moves the whole element. This keeps "move" the default action
  // and makes "rotate" a deliberate gesture (drag the bars at the tip), instead
  // of the post doubling as a handle and turning every move into a rotation.
  override nearestHandle(wx: number, wy: number, hitDist: number): number {
    return distanceSq(wx, wy, this.x2, this.y2) <= hitDist * hitDist ? 1 : -1;
  }

  override stamp(_sim: SimulationManager): void {
    // nothing: ground is just a label for node 0
  }

  override draw(g: Graphics): void {
    this.color(g);
    // lead runs from the post (point1) down to the symbol at point2
    g.drawLineP(this.point1, this.point2);
    // three horizontal bars: widest next to the post, narrower past point2
    // (the standard ground symbol, matching CircuitJS's GroundElm)
    for (let i = 0; i < 3; i++) {
      const halfW = 10 - i * 4; // 10, 6, 2
      const c = this.interpPoint(this.point1, this.point2, 1 + (i * 5) / this.dn);
      const a = new Point(Math.round(c.x + this.dpx1 * halfW), Math.round(c.y + this.dpy1 * halfW));
      const b = new Point(Math.round(c.x - this.dpx1 * halfW), Math.round(c.y - this.dpy1 * halfW));
      g.drawLineP(a, b);
    }
    const tip = this.interpPoint(this.point1, this.point2, 1 + 10 / this.dn);
    this.setBbox(this.point1.x, this.point1.y, tip.x, tip.y, 11);
    this.doDots(g);
    this.drawPosts(g);
  }

  override getInfo(): string[] {
    return ["Ground", "0 V reference", this.currentInfo()];
  }
}

registerElement({
  name: "GroundElm",
  label: "Ground",
  group: "Sources",
  dumpType: 103,
  ctor: (x, y) => new GroundElm(x, y),
});
