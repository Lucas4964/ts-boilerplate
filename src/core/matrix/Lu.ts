// Dense LU factorization with partial pivoting + back-substitution.
// Port of CircuitJS's lu_factor / lu_solve. A dense solver is plenty for the
// small matrices these starter circuits produce; swap in a sparse CSC solver
// (à la the matrix/ package in the Java app) if you scale up node counts.

/**
 * Factor matrix `a` (n x n) in place. `ipvt` receives the pivot row order.
 * Returns false if the matrix is singular (a zero pivot was found).
 */
export function luFactor(a: number[][], n: number, ipvt: number[]): boolean {
  // Use Crout's method with partial (row) pivoting.
  for (let i = 0; i < n; i++) {
    // find largest pivot in column i
    let pivot = i;
    let largest = Math.abs(a[i][i]);
    for (let j = i + 1; j < n; j++) {
      const x = Math.abs(a[j][i]);
      if (x > largest) {
        largest = x;
        pivot = j;
      }
    }
    ipvt[i] = pivot;
    if (largest === 0) {
      // singular matrix — no unique solution
      return false;
    }
    if (pivot !== i) {
      const tmp = a[i];
      a[i] = a[pivot];
      a[pivot] = tmp;
    }
    const diag = a[i][i];
    for (let j = i + 1; j < n; j++) {
      const f = (a[j][i] /= diag);
      if (f !== 0) {
        const ai = a[i];
        const aj = a[j];
        for (let k = i + 1; k < n; k++) {
          aj[k] -= f * ai[k];
        }
      }
    }
  }
  return true;
}

/**
 * Solve A x = b using the LU factors from {@link luFactor}. `b` is overwritten
 * with the solution x.
 */
export function luSolve(a: number[][], n: number, ipvt: number[], b: number[]): void {
  // forward substitution, applying row pivots
  for (let i = 0; i < n; i++) {
    const row = ipvt[i];
    const swap = b[row];
    b[row] = b[i];
    b[i] = swap;
    for (let j = i + 1; j < n; j++) {
      b[j] -= a[j][i] * swap;
    }
  }
  // back substitution
  for (let i = n - 1; i >= 0; i--) {
    let t = b[i];
    for (let j = i + 1; j < n; j++) {
      t -= a[i][j] * b[j];
    }
    b[i] = t / a[i][i];
  }
}
