import type { SimElement } from "../elements/SimElement";
import { ElementRegistry } from "../elements/ElementRegistry";

// Plain-text circuit serialization. Each element is one line:
//   Type x y x2 y2 flags [attr...]
// (the same shape CircuitJS uses, minus the legacy numeric dump types). Loading
// rebuilds elements through the registry — the round-trip exercises every
// element's getDumpAttributes()/applyDumpAttributes().
export const Serializer = {
  dump(elms: SimElement[]): string {
    return elms.map((e) => e.dump()).join("\n");
  },

  load(text: string): SimElement[] {
    const out: SimElement[] = [];
    for (const raw of text.split(/\r?\n/)) {
      const line = raw.trim();
      if (!line || line.startsWith("#")) continue;
      const tok = line.split(/\s+/);
      const type = tok[0];
      const nums = tok.slice(1).map(Number);
      if (nums.length < 5 || nums.slice(0, 5).some(Number.isNaN)) {
        console.warn("Serializer: skipping malformed line:", line);
        continue;
      }
      const [x, y, x2, y2, flags] = nums;
      const attrs = nums.slice(5);
      const el = ElementRegistry.createByName(type, x, y);
      if (!el) {
        console.warn("Serializer: unknown element type:", type);
        continue;
      }
      el.load(x, y, x2, y2, flags, attrs);
      out.push(el);
    }
    return out;
  },
};
