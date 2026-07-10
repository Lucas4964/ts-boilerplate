import type { SimulationManager } from "../core/SimulationManager";

// Reusable inductor companion model (port of CircuitJS's Inductor helper).
// Trapezoidal integration: companion resistor R = 2L/dt in parallel with a
// current source. Shared by InductorElm and (conceptually) by coupled models.
export class Inductor {
  inductance = 1;
  private compResistance = 0;
  private curSourceValue = 0;
  current = 0;
  private nodes: [number, number] = [0, 0];

  stamp(sim: SimulationManager, n0: number, n1: number): void {
    this.nodes = [n0, n1];
    this.compResistance = (2 * this.inductance) / sim.timeStep;
    sim.stampResistor(n0, n1, this.compResistance);
  }

  startIteration(voltdiff: number): void {
    this.curSourceValue = voltdiff / this.compResistance + this.current;
  }

  doStep(sim: SimulationManager): void {
    sim.stampCurrentSource(this.nodes[0], this.nodes[1], this.curSourceValue);
  }

  calculateCurrent(voltdiff: number): number {
    if (this.compResistance > 0) this.current = voltdiff / this.compResistance + this.curSourceValue;
    return this.current;
  }

  /** Companion history term (the per-step constant in i = vd/R + iConst) —
   *  read by a current-controlled source bound to this inductor. */
  companionCurrent(): number {
    return this.curSourceValue;
  }

  reset(): void {
    this.current = 0;
    this.curSourceValue = 0;
  }
}
