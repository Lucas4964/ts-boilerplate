import { Complex } from "../Complex";

// Dense complex LU factorization with partial pivoting + back-substitution.
// This is the complex twin of Lu.ts, used by the phasor (AC steady-state)
// analysis path: the MNA system becomes [Y]{V} = {I} over ℂ and is solved once
// (no time-stepping). The real Lu.ts is kept for the transient mode.

/**
 * Factor complex matrix `a` (n x n) in place. `ipvt` receives the pivot order.
 * Returns false if the matrix is singular (no usable pivot was found).
 */
export function luFactorComplex(a: Complex[][], n: number, ipvt: number[]): boolean {
  for (let i = 0; i < n; i++) {
    // find the largest-magnitude pivot in column i
    let pivot = i;
    let largest = a[i][i].abs();
    for (let j = i + 1; j < n; j++) {
      const x = a[j][i].abs();
      if (x > largest) {
        largest = x;
        pivot = j;
      }
    }
    ipvt[i] = pivot;
    if (largest === 0) return false; // singular
    if (pivot !== i) {
      const tmp = a[i];
      a[i] = a[pivot];
      a[pivot] = tmp;
    }
    const diag = a[i][i];
    for (let j = i + 1; j < n; j++) {
      const f = a[j][i].div(diag);
      a[j][i] = f;
      if (f.re !== 0 || f.im !== 0) {
        const ai = a[i];
        const aj = a[j];
        for (let k = i + 1; k < n; k++) {
          aj[k] = aj[k].sub(f.mul(ai[k]));
        }
      }
    }
  }
  return true;
}

/**
 * Solve A x = b using the factors from {@link luFactorComplex}. `b` is
 * overwritten with the solution x.
 */
export function luSolveComplex(a: Complex[][], n: number, ipvt: number[], b: Complex[]): void {
  // forward substitution (L y = P b), row-oriented with the interchanges folded
  // in — see the note in Lu.ts.luSolve for why this must not be column-oriented.
  for (let i = 0; i < n; i++) {
    const row = ipvt[i];
    let tot = b[row];
    b[row] = b[i];
    for (let j = 0; j < i; j++) {
      tot = tot.sub(a[i][j].mul(b[j]));
    }
    b[i] = tot;
  }
  // back substitution (U x = y)
  for (let i = n - 1; i >= 0; i--) {
    let t = b[i];
    for (let j = i + 1; j < n; j++) {
      t = t.sub(a[i][j].mul(b[j]));
    }
    b[i] = t.div(a[i][i]);
  }
}
