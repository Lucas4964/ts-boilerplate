import type { SimElement } from "../elements/SimElement";
import { luFactor, luSolve } from "./matrix/Lu";
import { Complex } from "./Complex";
import { luFactorComplex, luSolveComplex } from "./matrix/LuComplex";

export type AnalysisMode = "transient" | "phasor";

// The simulation engine — a focused port of CircuitJS's SimulationManager.
// It builds and solves the Modified Nodal Analysis (MNA) system:
//   analyzeCircuit() assigns nodes + voltage sources and sizes the matrix,
//   stampCircuit()   fills the constant matrix/right-side and factors it,
//   runCircuit()     steps time, updating companion sources and back-solving.
// See INTERNALS.md in the reference Java project for the underlying theory.
export class SimulationManager {
  elmList: SimElement[] = [];

  nodeCount = 0; // total nodes including the ground node (node 0)
  voltageSourceCount = 0;
  matrixSize = 0;

  private matrix: number[][] = []; // LU-factored (linear) circuit matrix
  private origMatrix: number[][] = []; // unfactored copy (for nonlinear re-solve)
  private rightSide: number[] = []; // working right-hand side (per step)
  private origRightSide: number[] = []; // constant part stamped once
  private ipvt: number[] = [];
  private circuitNonLinear = false;

  time = 0;
  timeStep = 5e-6; // seconds per simulation step
  stepsPerFrame = 80; // simulation steps advanced per animation frame
  needsStamp = true;
  stopMessage: string | null = null;

  // Minimum conductance from every node to ground (SPICE's GMIN). Keeps floating
  // subcircuits (e.g. a transformer's isolated secondary) from making the matrix
  // singular, with a negligible leakage (~nA). It does NOT rescue a loop of
  // ideal voltage sources — that singularity is in the source rows, not to ground.
  static readonly GMIN = 1e-9;

  // --- phasor (AC steady-state) analysis ------------------------------------
  analysisMode: AnalysisMode = "transient";
  analysisFrequency = 60; // Hz — global frequency for the phasor solve
  omega = 0; // 2π·analysisFrequency, set at the start of solvePhasor
  phasorDirty = true; // a re-solve is needed (topology, frequency or value changed)
  private matrixC: Complex[][] = []; // complex MNA matrix (phasor mode)
  private rightSideC: Complex[] = []; // complex right-hand side (phasor mode)

  // --- analysis -------------------------------------------------------------

  analyzeCircuit(elmList: SimElement[]): void {
    this.elmList = elmList;
    this.stopMessage = null;
    if (elmList.length === 0) {
      this.nodeCount = 0;
      this.voltageSourceCount = 0;
      this.matrixSize = 0;
      this.needsStamp = false;
      return;
    }

    // 1. Assign a circuit node to every post. Posts that share the same (x,y)
    //    grid point are the same node; wires additionally merge their two posts.
    //    This union-find is the boilerplate's stand-in for CircuitJS's
    //    calculateWireClosure() — connect elements by snapping endpoints or with
    //    a WireElm.
    const keyOf = (x: number, y: number): string => `${x},${y}`;
    const parent = new Map<string, string>();
    const ensure = (k: string): void => {
      if (!parent.has(k)) parent.set(k, k);
    };
    const find = (k: string): string => {
      let root = k;
      while (parent.get(root) !== root) root = parent.get(root)!;
      let cur = k;
      while (parent.get(cur) !== root) {
        const nxt = parent.get(cur)!;
        parent.set(cur, root);
        cur = nxt;
      }
      return root;
    };
    const union = (a: string, b: string): void => {
      ensure(a);
      ensure(b);
      const ra = find(a);
      const rb = find(b);
      if (ra !== rb) parent.set(ra, rb);
    };

    for (const ce of elmList) {
      for (let i = 0; i < ce.getPostCount(); i++) {
        const p = ce.getPost(i);
        ensure(keyOf(p.x, p.y));
      }
    }
    // merge wire endpoints
    for (const ce of elmList) {
      if (ce.isWire() && ce.getPostCount() >= 2) {
        union(keyOf(ce.getPost(0).x, ce.getPost(0).y), keyOf(ce.getPost(1).x, ce.getPost(1).y));
      }
    }
    // merge all ground posts into one group (-> node 0)
    let groundKey: string | null = null;
    for (const ce of elmList) {
      if (ce.isGround()) {
        for (let i = 0; i < ce.getPostCount(); i++) {
          const k = keyOf(ce.getPost(i).x, ce.getPost(i).y);
          if (groundKey === null) groundKey = k;
          else union(k, groundKey);
        }
      }
    }

    const rootToNode = new Map<string, number>();
    if (groundKey !== null) {
      rootToNode.set(find(groundKey), 0);
    } else {
      // No ground: pin the first post's group as the 0 V reference.
      const p = elmList[0].getPost(0);
      ensure(keyOf(p.x, p.y));
      rootToNode.set(find(keyOf(p.x, p.y)), 0);
      console.warn("No ground element: using the first node as the 0 V reference.");
    }

    let nextNode = 1;
    const nodeForKey = (k: string): number => {
      const r = find(k);
      let n = rootToNode.get(r);
      if (n === undefined) {
        n = nextNode++;
        rootToNode.set(r, n);
      }
      return n;
    };

    for (const ce of elmList) {
      ce.allocNodes();
      for (let i = 0; i < ce.getPostCount(); i++) {
        const p = ce.getPost(i);
        ce.setNode(i, nodeForKey(keyOf(p.x, p.y)));
      }
      for (let i = 0; i < ce.getInternalNodeCount(); i++) {
        ce.setNode(ce.getPostCount() + i, nextNode++);
      }
    }
    this.nodeCount = nextNode;

    // 2. Allocate voltage-source ids (each adds a row/col to the matrix).
    let vs = 0;
    for (const ce of elmList) {
      const n = ce.getVoltageSourceCount();
      for (let j = 0; j < n; j++) ce.setVoltageSource(j, vs++);
    }
    this.voltageSourceCount = vs;

    // 3. Size the system: drop the ground row/col, add one row per source.
    this.matrixSize = this.nodeCount - 1 + this.voltageSourceCount;
    this.circuitNonLinear = elmList.some((ce) => ce.nonLinear());
    this.needsStamp = true;
    this.phasorDirty = true;

    // 4. Let measurement elements (re)bind to what they measure now that posts
    //    and node assignments are settled (e.g. a current probe to a terminal).
    for (const ce of elmList) ce.bindMeasurement(elmList);
  }

  // --- stamping -------------------------------------------------------------

  stampCircuit(): void {
    const n = this.matrixSize;
    this.matrix = Array.from({ length: n }, () => new Array(n).fill(0));
    this.rightSide = new Array(n).fill(0);
    for (const ce of this.elmList) ce.stamp(this);
    // GMIN: a tiny conductance from each node row to ground (node rows are the
    // first nodeCount-1 indices; voltage-source rows are excluded).
    for (let i = 0; i < this.nodeCount - 1; i++) this.matrix[i][i] += SimulationManager.GMIN;

    this.origRightSide = this.rightSide.slice();
    this.origMatrix = this.matrix.map((row) => row.slice());

    if (!this.circuitNonLinear && n > 0) {
      this.ipvt = new Array(n).fill(0);
      if (!luFactor(this.matrix, n, this.ipvt)) {
        this.stop("Singular matrix — likely a loop of ideal voltage sources (add a series resistor) or a missing ground reference.");
        return;
      }
    }
    this.needsStamp = false;
  }

  // --- stamp primitives (mirror CircuitJS) ----------------------------------

  stampMatrix(i: number, j: number, x: number): void {
    if (i > 0 && j > 0) this.matrix[i - 1][j - 1] += x;
  }

  stampRightSide(i: number, x: number): void {
    if (i > 0) this.rightSide[i - 1] += x;
  }

  stampConductance(n1: number, n2: number, g: number): void {
    this.stampMatrix(n1, n1, g);
    this.stampMatrix(n2, n2, g);
    this.stampMatrix(n1, n2, -g);
    this.stampMatrix(n2, n1, -g);
  }

  stampResistor(n1: number, n2: number, r: number): void {
    this.stampConductance(n1, n2, 1 / r);
  }

  stampCurrentSource(n1: number, n2: number, i: number): void {
    this.stampRightSide(n1, -i);
    this.stampRightSide(n2, i);
  }

  /** Voltage-controlled current source: i from cn1->cn2 = g * (V(vn1)-V(vn2)). */
  stampVCCurrentSource(cn1: number, cn2: number, vn1: number, vn2: number, g: number): void {
    this.stampMatrix(cn1, vn1, g);
    this.stampMatrix(cn2, vn2, g);
    this.stampMatrix(cn1, vn2, -g);
    this.stampMatrix(cn2, vn1, -g);
  }

  /** Stamp an independent voltage source. Omit `v` for time-varying sources
   *  (stamp the matrix once, then push the value each step via updateVoltageSource). */
  stampVoltageSource(n1: number, n2: number, vs: number, v?: number): void {
    const vn = this.nodeCount + vs;
    this.stampMatrix(vn, n1, -1);
    this.stampMatrix(vn, n2, 1);
    this.stampMatrix(n1, vn, 1);
    this.stampMatrix(n2, vn, -1);
    if (v !== undefined) this.stampRightSide(vn, v);
  }

  updateVoltageSource(_n1: number, _n2: number, vs: number, v: number): void {
    const vn = this.nodeCount + vs;
    this.stampRightSide(vn, v);
  }

  // --- complex stamp primitives (phasor mode) -------------------------------
  // Twins of the real primitives above, operating on the complex matrix/RHS.
  // The ground node (0) is excluded the same way (i>0 && j>0).

  stampMatrixC(i: number, j: number, x: Complex): void {
    if (i > 0 && j > 0) this.matrixC[i - 1][j - 1] = this.matrixC[i - 1][j - 1].add(x);
  }

  stampRightSideC(i: number, x: Complex): void {
    if (i > 0) this.rightSideC[i - 1] = this.rightSideC[i - 1].add(x);
  }

  /** Stamp a complex admittance Y between two nodes (Y = 1/Z). */
  stampAdmittance(n1: number, n2: number, y: Complex): void {
    this.stampMatrixC(n1, n1, y);
    this.stampMatrixC(n2, n2, y);
    this.stampMatrixC(n1, n2, y.neg());
    this.stampMatrixC(n2, n1, y.neg());
  }

  stampCurrentSourceC(n1: number, n2: number, i: Complex): void {
    this.stampRightSideC(n1, i.neg());
    this.stampRightSideC(n2, i);
  }

  /** Complex twin of stampVCCurrentSource. The transconductance of a linear
   *  dependent source is frequency-independent, so `g` stays real — exactly how
   *  ngspice's AC load reuses the DC stamp for the E/G/F/H devices. */
  stampVCCurrentSourceC(cn1: number, cn2: number, vn1: number, vn2: number, g: number): void {
    const gc = new Complex(g, 0);
    this.stampMatrixC(cn1, vn1, gc);
    this.stampMatrixC(cn2, vn2, gc);
    this.stampMatrixC(cn1, vn2, gc.neg());
    this.stampMatrixC(cn2, vn1, gc.neg());
  }

  /** Stamp an independent voltage source with complex phasor `v` (V(n2)-V(n1)=v). */
  stampVoltageSourceC(n1: number, n2: number, vs: number, v: Complex): void {
    const vn = this.nodeCount + vs;
    this.stampMatrixC(vn, n1, Complex.ONE.neg());
    this.stampMatrixC(vn, n2, Complex.ONE);
    this.stampMatrixC(n1, vn, Complex.ONE);
    this.stampMatrixC(n2, vn, Complex.ONE.neg());
    this.stampRightSideC(vn, v);
  }

  // --- stepping -------------------------------------------------------------

  runCircuit(): void {
    const n = this.matrixSize;
    if (n === 0) {
      this.time += this.timeStep * this.stepsPerFrame;
      return;
    }

    for (let step = 0; step < this.stepsPerFrame; step++) {
      for (const ce of this.elmList) ce.startIteration();

      // right side = constant part + time-varying contributions
      for (let i = 0; i < n; i++) this.rightSide[i] = this.origRightSide[i];

      if (this.circuitNonLinear) {
        // Linear-only starter set; this branch keeps the engine honest for
        // future nonlinear elements (a real port adds a convergence subloop).
        this.matrix = this.origMatrix.map((row) => row.slice());
        for (const ce of this.elmList) ce.doStep(this);
        this.ipvt = new Array(n).fill(0);
        if (!luFactor(this.matrix, n, this.ipvt)) {
          this.stop("Singular matrix during step.");
          return;
        }
        luSolve(this.matrix, n, this.ipvt, this.rightSide);
      } else {
        for (const ce of this.elmList) ce.doStep(this);
        luSolve(this.matrix, n, this.ipvt, this.rightSide);
      }

      this.applySolution();
      this.time += this.timeStep;
    }
  }

  // --- phasor solve ---------------------------------------------------------

  /**
   * Solve the circuit once in AC steady state at the global analysis frequency.
   * Reuses the node assignment from analyzeCircuit(); builds a complex MNA
   * system [Y]{V}={I}, factors and solves it, then distributes the node
   * phasors. No time-stepping — phasor results are a single linear solve.
   */
  solvePhasor(): void {
    this.phasorDirty = false;
    this.omega = 2 * Math.PI * this.analysisFrequency;
    const n = this.matrixSize;
    if (n <= 0) return;

    this.matrixC = Array.from({ length: n }, () => new Array<Complex>(n).fill(Complex.ZERO));
    this.rightSideC = new Array<Complex>(n).fill(Complex.ZERO);
    for (const ce of this.elmList) ce.stampPhasor(this, this.omega);
    // GMIN to ground on each node row (see stampCircuit) — keeps floating
    // subcircuits (e.g. a transformer secondary) solvable in phasor mode too.
    const gmin = new Complex(SimulationManager.GMIN, 0);
    for (let i = 0; i < this.nodeCount - 1; i++) this.matrixC[i][i] = this.matrixC[i][i].add(gmin);

    const ipvt = new Array(n).fill(0);
    if (!luFactorComplex(this.matrixC, n, ipvt)) {
      this.stop("Singular matrix (phasor) — likely a loop of ideal voltage sources (add a series resistor) or a missing ground reference.");
      return;
    }
    luSolveComplex(this.matrixC, n, ipvt, this.rightSideC);
    this.applyPhasorSolution();
  }

  private applyPhasorSolution(): void {
    const firstVsRow = this.nodeCount - 1;
    for (const ce of this.elmList) {
      for (let i = 0; i < ce.getNodeCount(); i++) {
        const gnode = ce.nodes[i];
        ce.voltsPhasor[i] = gnode <= 0 ? Complex.ZERO : this.rightSideC[gnode - 1];
      }
      // voltage-source / branch currents are solved as extra unknowns
      const vsc = ce.getVoltageSourceCount();
      for (let j = 0; j < vsc; j++) {
        ce.setCurrentPhasor(ce.voltSource + j, this.rightSideC[firstVsRow + ce.voltSource + j]);
      }
    }
    for (const ce of this.elmList) ce.calculateCurrentPhasor();
  }

  private applySolution(): void {
    const firstVsRow = this.nodeCount - 1;
    for (const ce of this.elmList) {
      // node voltages
      for (let i = 0; i < ce.getNodeCount(); i++) {
        const gnode = ce.nodes[i];
        ce.volts[i] = gnode <= 0 ? 0 : this.rightSide[gnode - 1];
      }
      // voltage-source currents (solved as extra unknowns)
      const vsc = ce.getVoltageSourceCount();
      for (let j = 0; j < vsc; j++) {
        ce.setCurrent(ce.voltSource + j, this.rightSide[firstVsRow + ce.voltSource + j]);
      }
    }
    for (const ce of this.elmList) ce.calculateCurrent();
  }

  reset(): void {
    this.time = 0;
    for (const ce of this.elmList) ce.reset();
    this.needsStamp = true;
    this.phasorDirty = true;
  }

  setAnalysisMode(m: AnalysisMode): void {
    if (m === this.analysisMode) return;
    this.analysisMode = m;
    this.phasorDirty = true;
    this.stopMessage = null;
  }

  setAnalysisFrequency(f: number): void {
    if (f > 0 && f !== this.analysisFrequency) {
      this.analysisFrequency = f;
      this.phasorDirty = true;
    }
  }

  stop(message: string): void {
    this.stopMessage = message;
    console.warn("Simulation stopped:", message);
  }
}
