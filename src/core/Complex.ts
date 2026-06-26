// Minimal complex-number type for the phasor (AC steady-state) analysis mode.
// Immutable value object: every operation returns a new Complex. Kept tiny and
// explicit so the engine code reads like the phasor maths (Y·V = I in ℂ).
export class Complex {
  constructor(
    readonly re: number = 0,
    readonly im: number = 0,
  ) {}

  static readonly ZERO = new Complex(0, 0);
  static readonly ONE = new Complex(1, 0);
  /** Imaginary unit j. */
  static readonly J = new Complex(0, 1);

  /** Build a phasor from polar form: magnitude ∠ angle (angle in radians). */
  static fromPolar(magnitude: number, angleRad: number): Complex {
    return new Complex(magnitude * Math.cos(angleRad), magnitude * Math.sin(angleRad));
  }

  add(o: Complex): Complex {
    return new Complex(this.re + o.re, this.im + o.im);
  }
  sub(o: Complex): Complex {
    return new Complex(this.re - o.re, this.im - o.im);
  }
  mul(o: Complex): Complex {
    return new Complex(this.re * o.re - this.im * o.im, this.re * o.im + this.im * o.re);
  }
  div(o: Complex): Complex {
    const d = o.re * o.re + o.im * o.im;
    return new Complex((this.re * o.re + this.im * o.im) / d, (this.im * o.re - this.re * o.im) / d);
  }

  /** Multiply by a real scalar. */
  scale(k: number): Complex {
    return new Complex(this.re * k, this.im * k);
  }
  neg(): Complex {
    return new Complex(-this.re, -this.im);
  }
  conj(): Complex {
    return new Complex(this.re, -this.im);
  }

  /** Magnitude |z|. */
  abs(): number {
    return Math.hypot(this.re, this.im);
  }
  /** Argument (phase) in radians, in (-π, π]. */
  arg(): number {
    return Math.atan2(this.im, this.re);
  }
}
