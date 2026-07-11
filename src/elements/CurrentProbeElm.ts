import { SimElement } from "./SimElement";
import { Graphics } from "../ui/Graphics";
import { Point, distanceSq } from "../geom/Point";
import { registerElement } from "./ElementRegistry";
import { getUnitText, formatPolar } from "../util/format";

// Clamp-on current probe: measures the current entering/leaving ONE specific
// terminal without inserting a series ammeter (no topology change). It has no
// electrical posts; instead it binds (by proximity, each analyze) to the nearest
// component terminal `(target, postIndex)` and reads target.getPostCurrent(i).
// Binding to a terminal (not just the component) matters for multi-terminal
// parts: clamping terminal B of a 3φ transformer reads B's current, not A's.
const PROBE_COLOR = "#ffaa44";

export class CurrentProbeElm extends SimElement {
  private target: SimElement | null = null;
  private targetPost = -1;

  override getType(): string {
    return "CurrentProbeElm";
  }
  override getPostCount(): number {
    return 0; // no electrical connection — it clamps, doesn't wire in
  }
  override getPost(_n: number): Point {
    return this.point1;
  }
  override currentMeasurable(): boolean {
    return false;
  }
  override getDefaultDragOffset(): { dx: number; dy: number } {
    return { dx: 22, dy: -22 }; // a short tail to the label
  }

  // Bind to the nearest current-carrying terminal of another element. Re-run each
  // analyze, so moving the probe (or the target) re-targets; only the probe's own
  // position is persisted (no fragile element reference in the dump).
  override bindMeasurement(elmList: SimElement[]): void {
    let best: SimElement | null = null;
    let bestPost = -1;
    let bestD = Infinity;
    let bestBody = Infinity;
    for (const el of elmList) {
      if (el === this || el.isWire() || el.isGround() || !el.currentMeasurable()) continue;
      const bcx = (el.x + el.x2) / 2;
      const bcy = (el.y + el.y2) / 2;
      const bodyD = distanceSq(this.x, this.y, bcx, bcy);
      for (let i = 0; i < el.getPostCount(); i++) {
        const p = el.getPost(i);
        const d = distanceSq(this.x, this.y, p.x, p.y);
        // nearest post; ties (coincident posts at a junction) go to the element
        // whose body centre is closer (the "real" component, not a stub).
        if (d < bestD - 1e-6 || (Math.abs(d - bestD) <= 1e-6 && bodyD < bestBody)) {
          best = el;
          bestPost = i;
          bestD = d;
          bestBody = bodyD;
        }
      }
    }
    this.target = best;
    this.targetPost = bestPost;
  }

  private hasTarget(): boolean {
    return this.target !== null && this.targetPost >= 0 && this.targetPost < this.target.getPostCount();
  }

  private reading(): string {
    if (!this.hasTarget()) return "—";
    const t = this.target!;
    return SimElement.analysisMode === "phasor"
      ? formatPolar(t.getPostCurrentPhasor(this.targetPost), "A")
      : getUnitText(t.getPostCurrent(this.targetPost), "A");
  }

  override draw(g: Graphics): void {
    // Anchor on the bound terminal (the clamp point); fall back to the click point.
    const at = this.hasTarget() ? this.target!.getPost(this.targetPost) : this.point1;
    g.setColor(this.needsHighlight() ? SimElement.selectColor : PROBE_COLOR);
    g.setLineWidth(this.needsHighlight() ? 2 : 1.5);
    g.drawCircle(at.x, at.y, 6); // clamp ring around the terminal
    // a short tail toward the probe's own point (for grabbing/moving + label)
    const lx = this.x2;
    const ly = this.y2;
    g.drawLine(at.x, at.y, lx, ly);
    g.setFontSize(10);
    g.drawString("A", at.x - 3, at.y + 4);
    this.setBbox(Math.min(at.x, lx), Math.min(at.y, ly), Math.max(at.x, lx), Math.max(at.y, ly), 8);
    // reading near the tail
    g.setColor(SimElement.valueColor);
    g.setFontSize(SimElement.valueFontSize);
    g.drawString(this.reading(), lx + 6, ly + 4);
  }

  override getInfo(): string[] {
    if (!this.hasTarget()) return ["Current Probe", "no branch under tip"];
    return ["Current Probe", "I = " + getUnitText(this.target!.getPostCurrent(this.targetPost), "A")];
  }
  override getInfoPhasor(): string[] {
    if (!this.hasTarget()) return ["Current Probe", "no branch under tip"];
    return ["Current Probe", "I = " + formatPolar(this.target!.getPostCurrentPhasor(this.targetPost), "A")];
  }
}

registerElement({
  name: "CurrentProbeElm",
  label: "I Probe",
  group: "Meters",
  dumpType: 142,
  ctor: (x, y) => new CurrentProbeElm(x, y),
});
