import { SimElement } from "./SimElement";
import { Graphics } from "../ui/Graphics";
import { Point } from "../geom/Point";
import { EditInfo } from "./EditInfo";
import { getUnitText, formatPolar } from "../util/format";
import { Complex } from "../core/Complex";
import type { SimulationManager } from "../core/SimulationManager";

// Intermediate base for independent current sources (the dual of VoltageElm).
// Holds the waveform so DC/AC subclasses only differ in defaults + symbol.
// A current source is the simplest MNA element: it contributes ONLY to the
// right-hand side (no extra matrix row/column). stampCurrentSource(n0,n1,i)
// injects -i at node0 and +i at node1, so conventional current inside the
// source flows post0 -> post1 (the arrow direction).
export class CurrentElm extends SimElement {
  static readonly WF_DC = 0;
  static readonly WF_AC = 1;

  waveform = CurrentElm.WF_DC;
  currentValue = 0.01; // amplitude (A)
  frequency = 100;
  phaseShift = 0; // radians

  override getType(): string {
    return "CurrentElm";
  }
  override getPostCount(): number {
    return 2;
  }
  override getPost(n: number): Point {
    return n === 0 ? this.point1 : this.point2;
  }

  // The arrow points post0 -> post1; post1 is driven positive when feeding a
  // resistive load, so the (+) reference is post 1 (matches VoltageElm).
  override getReferenceNode(): number {
    return 1;
  }

  override setPoints(): void {
    super.setPoints();
    this.calcLeads(36);
  }

  getCurrentAt(time: number): number {
    if (this.waveform === CurrentElm.WF_AC) {
      // Cosine reference: i(t) = Im·cos(ωt+φ) ⟺ phasor Im∠φ (Sadiku convention),
      // matching the AC voltage source so transient and phasor modes agree.
      return Math.cos(2 * Math.PI * this.frequency * time + this.phaseShift) * this.currentValue;
    }
    return this.currentValue;
  }

  // DC: inject into the constant RHS once (stamp runs at analyze). AC: nothing
  // constant — the value is pushed to the live RHS each step in doStep().
  override stamp(sim: SimulationManager): void {
    if (this.waveform === CurrentElm.WF_DC) {
      sim.stampCurrentSource(this.nodes[0], this.nodes[1], this.currentValue);
      this.current = this.currentValue;
    }
  }

  override doStep(sim: SimulationManager): void {
    if (this.waveform !== CurrentElm.WF_DC) {
      // Evaluate at the END of the step (t+h) — the injected current must match
      // the time point the solve produces (SPICE convention; see VoltageElm).
      const i = this.getCurrentAt(sim.time + sim.timeStep);
      sim.stampCurrentSource(this.nodes[0], this.nodes[1], i);
      this.current = i;
    }
  }

  /** The source phasor: magnitude (currentValue) ∠ phase (phaseShift). */
  getPhasor(): Complex {
    return Complex.fromPolar(this.currentValue, this.phaseShift);
  }

  // Phasor mode: an independent current source is its phasor. A DC current
  // source has no AC component, so it is killed — a dead current source is an
  // OPEN circuit (i = 0), the dual of a voltage source's short.
  override stampPhasor(sim: SimulationManager): void {
    const i = this.waveform === CurrentElm.WF_DC ? Complex.ZERO : this.getPhasor();
    sim.stampCurrentSourceC(this.nodes[0], this.nodes[1], i);
  }

  // The current of an ideal source is its own value (independent of the solved
  // node voltages), so we set it directly rather than derive it.
  override calculateCurrentPhasor(): void {
    this.currentPhasor = this.waveform === CurrentElm.WF_DC ? Complex.ZERO : this.getPhasor();
  }

  protected radius(): number {
    return Math.hypot(this.lead2.x - this.lead1.x, this.lead2.y - this.lead1.y) / 2;
  }

  // Hit area = the leads (segment) plus the round body, matching VoltageElm.
  override distanceTo(px: number, py: number): number {
    const seg = super.distanceTo(px, py);
    const c = this.interpPoint(this.lead1, this.lead2, 0.5);
    const circle = Math.max(0, Math.hypot(px - c.x, py - c.y) - this.radius());
    return Math.min(seg, circle);
  }

  /** Directional arrow along the lead axis (tail at post0 side, head toward post1). */
  protected drawArrow(g: Graphics): void {
    const tail = this.interpPoint(this.lead1, this.lead2, 0.28);
    const tip = this.interpPoint(this.lead1, this.lead2, 0.72);
    g.drawLine(tail.x, tail.y, tip.x, tip.y);
    // arrowhead: two short strokes from the tip, angled back along the axis
    const dx = tip.x - tail.x;
    const dy = tip.y - tail.y;
    const len = Math.hypot(dx, dy) || 1;
    const ux = dx / len;
    const uy = dy / len;
    const h = 6; // head length
    const w = 4; // head half-width
    // perpendicular unit vector
    const px = -uy;
    const py = ux;
    g.drawLine(tip.x, tip.y, tip.x - ux * h + px * w, tip.y - uy * h + py * w);
    g.drawLine(tip.x, tip.y, tip.x - ux * h - px * w, tip.y - uy * h - py * w);
  }

  override draw(g: Graphics): void {
    this.setBbox(this.point1.x, this.point1.y, this.point2.x, this.point2.y, 20);
    this.draw2Leads(g);
    const center = this.interpPoint(this.lead1, this.lead2, 0.5);
    this.color(g);
    g.drawCircle(center.x, center.y, this.radius());
    this.drawArrow(g);
    this.doDots(g);
    this.drawReferenceMark(g); // white "*" on the (+) terminal (post 1)
    this.drawPosts(g);
  }

  override getEditInfo(n: number): EditInfo | null {
    if (this.waveform === CurrentElm.WF_DC) {
      return n === 0 ? new EditInfo("Current (A)", this.currentValue) : null;
    }
    const phasor = SimElement.analysisMode === "phasor";
    if (n === 0) return new EditInfo(phasor ? "Magnitude (A)" : "Max Current (A)", this.currentValue);
    if (n === 1) {
      if (phasor) {
        // Locked to the global analysis frequency in phasor mode (read-only).
        const ei = new EditInfo("Frequency (Hz)", SimElement.analysisFrequency);
        ei.disabled = true;
        return ei;
      }
      return new EditInfo("Frequency (Hz)", this.frequency);
    }
    if (n === 2) return new EditInfo("Phase (deg)", (this.phaseShift * 180) / Math.PI);
    return null;
  }
  override setEditValue(n: number, value: number): void {
    if (this.waveform === CurrentElm.WF_DC) {
      if (n === 0) this.currentValue = value;
      return;
    }
    if (n === 0) this.currentValue = value;
    else if (n === 1 && value > 0) this.frequency = value;
    else if (n === 2) this.phaseShift = (value * Math.PI) / 180;
  }

  override getDumpAttributes(): number[] {
    return [this.currentValue, this.frequency, this.phaseShift];
  }
  override applyDumpAttributes(a: number[]): void {
    if (a.length > 0) this.currentValue = a[0];
    if (a.length > 1) this.frequency = a[1];
    if (a.length > 2) this.phaseShift = a[2];
  }

  override getOscillationFrequency(): number {
    return this.waveform === CurrentElm.WF_AC ? this.frequency : 0;
  }

  override getInfo(): string[] {
    const info = [
      this.waveform === CurrentElm.WF_AC ? "AC Current Source" : "DC Current Source",
      this.currentInfo(),
      this.voltageDiffInfo(),
      this.powerInfo(),
    ];
    if (this.waveform === CurrentElm.WF_AC) {
      info.push("f = " + getUnitText(this.frequency, "Hz"));
    }
    return info;
  }

  override getInfoPhasor(): string[] {
    return [
      this.waveform === CurrentElm.WF_AC ? "AC Current Source" : "DC Current Source",
      "I = " + formatPolar(this.getPhasor(), "A"),
      this.voltageDiffInfoPhasor(),
      this.powerInfoPhasor(),
    ];
  }
}
