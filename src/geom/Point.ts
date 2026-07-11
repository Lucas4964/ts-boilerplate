// Minimal geometry helpers (port of the Point/Rectangle usage in CircuitJS).

export class Point {
  x: number;
  y: number;

  constructor(x = 0, y = 0) {
    this.x = x;
    this.y = y;
  }

  clone(): Point {
    return new Point(this.x, this.y);
  }
}

export class Rectangle {
  x: number;
  y: number;
  width: number;
  height: number;

  constructor(x = 0, y = 0, width = 0, height = 0) {
    this.x = x;
    this.y = y;
    this.width = width;
    this.height = height;
  }

  contains(px: number, py: number): boolean {
    return (
      px >= this.x &&
      px < this.x + this.width &&
      py >= this.y &&
      py < this.y + this.height
    );
  }

  /** True if this rectangle overlaps `o` (axis-aligned, touching edges count). */
  intersects(o: Rectangle): boolean {
    return (
      this.x <= o.x + o.width &&
      o.x <= this.x + this.width &&
      this.y <= o.y + o.height &&
      o.y <= this.y + this.height
    );
  }
}

/** Squared distance between two points (avoids a sqrt for hit-testing). */
export function distanceSq(x1: number, y1: number, x2: number, y2: number): number {
  const dx = x2 - x1;
  const dy = y2 - y1;
  return dx * dx + dy * dy;
}

/** Linear interpolation from a to b at fraction f, offset by g pixels perpendicular. */
export function interpPoint(a: Point, b: Point, f: number, g = 0): Point {
  const gx = b.y - a.y;
  const gy = a.x - b.x;
  const len = Math.sqrt(gx * gx + gy * gy) || 1;
  const r = new Point();
  r.x = Math.floor(a.x * (1 - f) + b.x * f + (g * gx) / len + 0.48);
  r.y = Math.floor(a.y * (1 - f) + b.y * f + (g * gy) / len + 0.48);
  return r;
}
