// Tiny i18n shim (port of util/Locale.java). Wrap user-facing strings in LS()
// so a future build can swap in a translation map, exactly like the original
// app's locale_*.txt catalogs. Kept minimal on purpose.
export const Locale = {
  map: {} as Record<string, string>,

  setMap(map: Record<string, string>): void {
    this.map = map;
  },

  /** Localize string. */
  LS(s: string): string {
    return this.map[s] ?? s;
  },
};
