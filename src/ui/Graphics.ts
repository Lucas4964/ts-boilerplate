import { Point } from "../geom/Point";

// Thin wrapper over CanvasRenderingContext2D — a near 1:1 port of the GWT
// Graphics.java, which wrapped GWT's Context2d. Keeping this seam means element
// draw() code is decoupled from the raw canvas API (and could target SVG, etc.).
export class Graphics {
  ctx: CanvasRenderingContext2D;
  fontSize = 12;

  constructor(ctx: CanvasRenderingContext2D) {
    this.ctx = ctx;
  }

  setColor(color: string): void {
    this.ctx.strokeStyle = color;
    this.ctx.fillStyle = color;
  }

  setLineWidth(w: number): void {
    this.ctx.lineWidth = w;
  }

  setLineDash(a: number, b: number): void {
    this.ctx.setLineDash(a === 0 ? [] : [a, b]);
  }

  save(): void {
    this.ctx.save();
  }

  restore(): void {
    this.ctx.restore();
  }

  translate(x: number, y: number): void {
    this.ctx.translate(x, y);
  }

  rotate(rad: number): void {
    this.ctx.rotate(rad);
  }

  fillRect(x: number, y: number, w: number, h: number): void {
    this.ctx.fillRect(x, y, w, h);
  }

  drawRect(x: number, y: number, w: number, h: number): void {
    this.ctx.strokeRect(x, y, w, h);
  }

  drawLine(x1: number, y1: number, x2: number, y2: number): void {
    this.ctx.beginPath();
    this.ctx.moveTo(x1, y1);
    this.ctx.lineTo(x2, y2);
    this.ctx.stroke();
  }

  drawLineP(a: Point, b: Point): void {
    this.drawLine(a.x, a.y, b.x, b.y);
  }

  drawPolyline(xs: number[], ys: number[], n: number): void {
    this.ctx.beginPath();
    for (let i = 0; i < n; i++) {
      if (i === 0) this.ctx.moveTo(xs[i], ys[i]);
      else this.ctx.lineTo(xs[i], ys[i]);
    }
    this.ctx.stroke();
  }

  fillPolygon(xs: number[], ys: number[]): void {
    this.ctx.beginPath();
    for (let i = 0; i < xs.length; i++) {
      if (i === 0) this.ctx.moveTo(xs[i], ys[i]);
      else this.ctx.lineTo(xs[i], ys[i]);
    }
    this.ctx.closePath();
    this.ctx.fill();
  }

  drawCircle(x: number, y: number, radius: number): void {
    this.ctx.beginPath();
    this.ctx.arc(x, y, radius, 0, 2 * Math.PI);
    this.ctx.stroke();
  }

  fillCircle(x: number, y: number, radius: number): void {
    this.ctx.beginPath();
    this.ctx.arc(x, y, radius, 0, 2 * Math.PI);
    this.ctx.fill();
  }

  drawArc(x: number, y: number, radius: number, start: number, end: number): void {
    this.ctx.beginPath();
    this.ctx.arc(x, y, radius, start, end);
    this.ctx.stroke();
  }

  setFontSize(size: number): void {
    this.fontSize = size;
    this.ctx.font = `${size}px sans-serif`;
  }

  drawString(s: string, x: number, y: number): void {
    this.ctx.font = `${this.fontSize}px sans-serif`;
    this.ctx.fillText(s, x, y);
  }

  measureWidth(s: string): number {
    this.ctx.font = `${this.fontSize}px sans-serif`;
    return this.ctx.measureText(s).width;
  }
}
