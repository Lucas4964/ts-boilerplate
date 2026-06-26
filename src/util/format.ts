// Engineering-notation formatting (port of CircuitElm.getUnitText) plus a
// permissive parser for the edit dialog.

import type { Complex } from "../core/Complex";

/** Round to 4 decimal places, dropping trailing zeros (6.5000 → "6.5", 5 → "5").
 *  Number.toString() strips the trailing zeros for free. */
export function round4(v: number): string {
  return (Math.round(v * 1e4) / 1e4).toString();
}

function trim(v: number): string {
  return round4(v);
}

function unitText(v: number, unit: string, sp: string): string {
  const va = Math.abs(v);
  if (va < 1e-14) return "0" + sp + unit;
  if (va < 1e-9) return trim(v * 1e12) + sp + "p" + unit;
  if (va < 1e-6) return trim(v * 1e9) + sp + "n" + unit;
  if (va < 1e-3) return trim(v * 1e6) + sp + "µ" + unit;
  if (va < 1) return trim(v * 1e3) + sp + "m" + unit;
  if (va < 1e3) return trim(v) + sp + unit;
  if (va < 1e6) return trim(v * 1e-3) + sp + "k" + unit;
  if (va < 1e9) return trim(v * 1e-6) + sp + "M" + unit;
  return trim(v * 1e-9) + sp + "G" + unit;
}

/** Engineering notation with a space before the unit, e.g. "4.7 kΩ". */
export function getUnitText(v: number, unit: string): string {
  return unitText(v, unit, " ");
}

/** Compact engineering notation with no space, e.g. "4.7kΩ", "15µF", "1H".
 *  Used for on-canvas component labels (matches CircuitJS getShortUnitText). */
export function getShortUnitText(v: number, unit: string): string {
  return unitText(v, unit, "");
}

/**
 * Format a complex quantity in polar form for the info panel:
 *   "<magnitude> <unit> ∠ <angle>°"
 * Reuses {@link getUnitText} for the magnitude (engineering notation) and shows
 * the phase in degrees. A (near-)zero phasor drops the angle.
 */
export function formatPolar(c: Complex, unit: string): string {
  const mag = c.abs();
  const magText = getUnitText(mag, unit);
  if (mag < 1e-14) return magText;
  const deg = (c.arg() * 180) / Math.PI;
  return `${magText} ∠ ${round4(deg)}°`;
}

/**
 * Format a value for an editable text field: engineering suffix only when it
 * really helps (very small/large magnitudes), otherwise a plain decimal so
 * dimensionless values like a turns ratio or coupling coefficient read naturally.
 * The result round-trips through {@link parseUnit}.
 */
export function formatForEdit(v: number): string {
  if (!Number.isFinite(v) || v === 0) return "0";
  const a = Math.abs(v);
  if (a >= 1e-2 && a < 1e4) {
    return String(Math.round(v * 1e6) / 1e6);
  }
  let scaled = v;
  let suffix = "";
  if (a < 1e-9) {
    scaled = v * 1e12;
    suffix = "p";
  } else if (a < 1e-6) {
    scaled = v * 1e9;
    suffix = "n";
  } else if (a < 1e-3) {
    scaled = v * 1e6;
    suffix = "u";
  } else if (a < 1) {
    scaled = v * 1e3;
    suffix = "m";
  } else if (a < 1e6) {
    scaled = v / 1e3;
    suffix = "k";
  } else if (a < 1e9) {
    scaled = v / 1e6;
    suffix = "M";
  } else {
    scaled = v / 1e9;
    suffix = "G";
  }
  return Math.round(scaled * 1e6) / 1e6 + suffix;
}

const SUFFIXES: Record<string, number> = {
  p: 1e-12,
  n: 1e-9,
  u: 1e-6,
  "µ": 1e-6,
  m: 1e-3,
  k: 1e3,
  M: 1e6,
  G: 1e9,
};

/** Parse "4.7k", "100n", "2.2M", "0.001" etc. Returns NaN if unparseable. */
export function parseUnit(text: string): number {
  const m = text.trim().match(/^(-?[\d.]+(?:e-?\d+)?)\s*([pnumµkMG]?)/);
  if (!m) return NaN;
  const base = parseFloat(m[1]);
  if (Number.isNaN(base)) return NaN;
  const suffix = m[2];
  return suffix && SUFFIXES[suffix] ? base * SUFFIXES[suffix] : base;
}
