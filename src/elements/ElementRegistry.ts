import type { SimElement } from "./SimElement";

// Runtime element registry — the idiomatic TS replacement for CircuitJS's
// compile-time ElementFactoryGenerator (a GWT deferred-binding Generator that
// scanned CircuitElm subtypes because GWT has no reflection). Here each element
// module registers itself; the registry reproduces createCe()/constructElement():
//   - createByName  ↔ constructElement(name, x, y)
//   - createByDumpType ↔ createCe(dumpType, ...)
// and also drives the menu/toolbar element picker via list().

export interface ElementDefinition {
  /** Type name, also the serialization tag, e.g. "ResistorElm". */
  name: string;
  /** Human-readable label for menus, e.g. "Resistor". */
  label: string;
  /** Category for grouping in the UI. */
  group: string;
  /** Optional legacy numeric dump type (for compatibility-style loading). */
  dumpType?: number;
  /** Factory for a brand-new element at (x, y). */
  ctor: (x: number, y: number) => SimElement;
}

class Registry {
  private byName = new Map<string, ElementDefinition>();
  private byDumpType = new Map<number, string>();
  private order: string[] = [];

  register(def: ElementDefinition): void {
    if (this.byName.has(def.name)) {
      console.warn(`ElementRegistry: "${def.name}" registered twice`);
    }
    this.byName.set(def.name, def);
    this.order.push(def.name);
    if (def.dumpType != null) this.byDumpType.set(def.dumpType, def.name);
  }

  createByName(name: string, x: number, y: number): SimElement | null {
    const def = this.byName.get(name);
    if (!def) return null;
    const el = def.ctor(x, y);
    // Finish initialization here (not in the element constructor) so subclass
    // field initializers have already run — see SimElement's constructor note.
    el.allocNodes();
    el.setPoints();
    return el;
  }

  createByDumpType(dumpType: number, x: number, y: number): SimElement | null {
    const name = this.byDumpType.get(dumpType);
    return name ? this.createByName(name, x, y) : null;
  }

  getLabel(name: string): string {
    return this.byName.get(name)?.label ?? name;
  }

  list(): ElementDefinition[] {
    return this.order.map((n) => this.byName.get(n)!);
  }
}

export const ElementRegistry = new Registry();

/** Sugar used at the bottom of each element module. */
export function registerElement(def: ElementDefinition): void {
  ElementRegistry.register(def);
}
