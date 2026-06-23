import type { SimElement } from "../elements/SimElement";
import { luFactor, luSolve } from "./matrix/Lu";

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
  }

  // --- stamping -------------------------------------------------------------

  stampCircuit(): void {
    const n = this.matrixSize;
    this.matrix = Array.from({ length: n }, () => new Array(n).fill(0));
    this.rightSide = new Array(n).fill(0);
    for (const ce of this.elmList) ce.stamp(this);

    this.origRightSide = this.rightSide.slice();
    this.origMatrix = this.matrix.map((row) => row.slice());

    if (!this.circuitNonLinear && n > 0) {
      this.ipvt = new Array(n).fill(0);
      if (!luFactor(this.matrix, n, this.ipvt)) {
        this.stop("Singular matrix — check the circuit (add a ground / complete the loops).");
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
  }

  stop(message: string): void {
    this.stopMessage = message;
    console.warn("Simulation stopped:", message);
  }
}
