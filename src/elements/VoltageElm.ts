import { SimElement, CurrentSense, CurrentSensePhasor } from "./SimElement";
import { Graphics } from "../ui/Graphics";
import { Point } from "../geom/Point";
import { EditInfo } from "./EditInfo";
import { getUnitText, formatPolar } from "../util/format";
import { Complex } from "../core/Complex";
import type { SimulationManager } from "../core/SimulationManager";

// Intermediate base for independent voltage sources (mirrors VoltageElm.java).
// Holds the waveform so DC/AC subclasses only differ in defaults + symbol.
// A voltage source adds one row/column to the MNA matrix; its current is solved
// as an extra unknown (delivered back via setCurrent()).
export class VoltageElm extends SimElement {
  static readonly WF_DC = 0;
  static readonly WF_AC = 1;

  waveform = VoltageElm.WF_DC;
  maxVoltage = 5;
  frequency = 100;
  phaseShift = 0; // radians
  bias = 0;

  override getType(): string {
    return "VoltageElm";
  }
  override getPostCount(): number {
    return 2;
  }
  override getVoltageSourceCount(): number {
    return 1;
  }
  override getPost(n: number): Point {
    return n === 0 ? this.point1 : this.point2;
  }

  // The positive reference is the (+) terminal — post 1, which the source
  // drives above post 0 (V(post1) - V(post0) = +getVoltage()). This keeps the
  // info panel showing a positive Vd for a normally-biased source.
  override getReferenceNode(): number {
    return 1;
  }

  override setPoints(): void {
    super.setPoints();
    this.calcLeads(36);
  }

  getVoltage(time: number): number {
    if (this.waveform === VoltageElm.WF_AC) {
      // Cosine reference: v(t) = Vm·cos(ωt+φ) ⟺ phasor Vm∠φ. This matches the
      // textbook (Sadiku) phasor convention, so the time-domain and phasor modes
      // agree and the user enters magnitude/phase straight from the book.
      return Math.cos(2 * Math.PI * this.frequency * time + this.phaseShift) * this.maxVoltage + this.bias;
    }
    return this.maxVoltage;
  }

  override stamp(sim: SimulationManager): void {
    if (this.waveform === VoltageElm.WF_DC) {
      sim.stampVoltageSource(this.nodes[0], this.nodes[1], this.voltSource, this.getVoltage(0));
    } else {
      // time-varying: stamp matrix coefficients once, push value each step
      sim.stampVoltageSource(this.nodes[0], this.nodes[1], this.voltSource);
    }
  }

  override doStep(sim: SimulationManager): void {
    if (this.waveform !== VoltageElm.WF_DC) {
      // Evaluate at the END of the step (t+h): the solve produces the state at
      // t+h, so the source constraint must hold there (SPICE convention).
      // Falstad evaluates at t, which just time-shifts everything by one step.
      sim.updateVoltageSource(this.nodes[0], this.nodes[1], this.voltSource, this.getVoltage(sim.time + sim.timeStep));
    }
  }

  /** The source phasor: magnitude (maxVoltage) ∠ phase (phaseShift). */
  getPhasor(): Complex {
    return Complex.fromPolar(this.maxVoltage, this.phaseShift);
  }

  // Phasor mode: an independent source is its phasor. The per-source frequency
  // is ignored here — the phasor solve uses the single global analysis frequency.
  // A DC source has no AC phasor, so it is killed (short circuit, 0 V) per
  // superposition; new DC sources are also blocked from insertion in phasor mode.
  override stampPhasor(sim: SimulationManager): void {
    const v = this.waveform === VoltageElm.WF_DC ? Complex.ZERO : this.getPhasor();
    sim.stampVoltageSourceC(this.nodes[0], this.nodes[1], this.voltSource, v);
  }

  // A voltage source's current is an MNA branch unknown — expose it so a
  // current-controlled source can bind to this element as its control.
  override currentSense(): CurrentSense {
    return { kind: "branch", vs: this.voltSource };
  }
  override currentSensePhasor(): CurrentSensePhasor {
    return { kind: "branch", vs: this.voltSource };
  }

  protected radius(): number {
    return Math.hypot(this.lead2.x - this.lead1.x, this.lead2.y - this.lead1.y) / 2;
  }

  protected drawSymbol(g: Graphics): void {
    const r = this.radius();
    if (this.waveform === VoltageElm.WF_AC) {
      const xs: number[] = [];
      const ys: number[] = [];
      const m = 20;
      for (let i = 0; i <= m; i++) {
        const f = 0.5 + (i / m - 0.5) * 0.7;
        const off = Math.sin((i / m - 0.5) * 2 * Math.PI) * r * 0.5;
        const p = this.interpPoint(this.lead1, this.lead2, f, off);
        xs.push(p.x);
        ys.push(p.y);
      }
      g.drawPolyline(xs, ys, xs.length);
    } else {
      // The source drives post 1 above post 0, so "+" belongs on the post-1
      // (lead2) side and "−" on the post-0 (lead1) side.
      const plus = this.interpPoint(this.lead1, this.lead2, 0.5 + 9 / (2 * r), 0);
      const minus = this.interpPoint(this.lead1, this.lead2, 0.5 - 9 / (2 * r), 0);
      g.drawLine(plus.x - 4, plus.y, plus.x + 4, plus.y);
      g.drawLine(plus.x, plus.y - 4, plus.x, plus.y + 4);
      g.drawLine(minus.x - 4, minus.y, minus.x + 4, minus.y);
    }
  }

  override draw(g: Graphics): void {
    // Tight Falstad-style bbox: post span widened by the circle radius.
    this.setBboxP(this.point1, this.point2, this.radius());
    this.draw2Leads(g);
    const center = this.interpPoint(this.lead1, this.lead2, 0.5);
    this.color(g);
    g.drawCircle(center.x, center.y, this.radius());
    this.drawSymbol(g);
    this.doDots(g);
    this.drawReferenceMark(g); // white dot on the (+) terminal (post 1)
    this.drawPosts(g);
  }

  override getEditInfo(n: number): EditInfo | null {
    if (this.waveform === VoltageElm.WF_DC) {
      return n === 0 ? new EditInfo("Voltage (V)", this.maxVoltage) : null;
    }
    const phasor = SimElement.analysisMode === "phasor";
    if (n === 0) return new EditInfo(phasor ? "Magnitude (V)" : "Max Voltage (V)", this.maxVoltage);
    if (n === 1) {
      if (phasor) {
        // Locked to the global analysis frequency in phasor mode (all AC sources
        // share it). Shown for context but read-only; never written back.
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
    if (this.waveform === VoltageElm.WF_DC) {
      if (n === 0) this.maxVoltage = value;
      return;
    }
    if (n === 0) this.maxVoltage = value;
    else if (n === 1 && value > 0) this.frequency = value;
    else if (n === 2) this.phaseShift = (value * Math.PI) / 180;
  }

  override getDumpAttributes(): number[] {
    return [this.maxVoltage, this.frequency, this.phaseShift, this.bias];
  }
  override applyDumpAttributes(a: number[]): void {
    if (a.length > 0) this.maxVoltage = a[0];
    if (a.length > 1) this.frequency = a[1];
    if (a.length > 2) this.phaseShift = a[2];
    if (a.length > 3) this.bias = a[3];
  }

  override getOscillationFrequency(): number {
    return this.waveform === VoltageElm.WF_AC ? this.frequency : 0;
  }

  override getInfo(): string[] {
    const info = [
      this.waveform === VoltageElm.WF_AC ? "AC Source" : "DC Source",
      this.currentInfo(),
      this.voltageDiffInfo(),
      this.powerInfo(),
    ];
    if (this.waveform === VoltageElm.WF_AC) {
      info.push("f = " + getUnitText(this.frequency, "Hz"));
    }
    return info;
  }

  override getInfoPhasor(): string[] {
    return [
      this.waveform === VoltageElm.WF_AC ? "AC Source" : "DC Source",
      "V = " + formatPolar(this.getPhasor(), "V"),
      this.currentInfoPhasor(),
      this.powerInfoPhasor(),
    ];
  }
}
