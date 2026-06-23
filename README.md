# Canvas Simulator Boilerplate (TypeScript)

A reusable starting point for building **interactive canvas simulators** with a
**pluggable element model**. It is an architectural port of
[CircuitJS1](https://github.com/sharpie7/circuitjs1) (originally Java + GWT) to
modern **TypeScript + HTML + Canvas**, preserving the *patterns* — orchestrator,
managers, element base + registry, MNA engine, render loop — without the GWT
toolchain.

The included reference domain is a small **circuit simulator** with seven
elements (resistor, capacitor, inductor, transformer, DC/AC sources, ground).
Swap the domain by replacing the engine + elements behind the same seams.

## Quick start

Requires Node.js 18+.

```bash
npm install
npm run dev        # Vite dev server with HMR -> http://localhost:5173
npm run build      # type-check (tsc --noEmit) + production build to dist/
npm run preview    # serve the production build
npm run electron   # optional desktop wrapper (after build; needs `npm i -D electron`)
```

On load you get a demo RC circuit. Press **Run** to watch the capacitor charge.

## Using it

- **Toolbar:** Run/Stop, Reset, a **Select** tool, one button per element, Delete,
  Clear, Export/Import (plain text), **Zoom +/−/Reset View**, and a Speed slider.
- **Place an element:** click its toolbar button, then drag on the canvas
  (a plain click drops a default-sized one). The tool reverts to Select after.
- **Connect elements** by overlapping their endpoints on the same grid point,
  or run a **Wire** between them (a wire merges its two endpoints into one node).
  Multiple **Ground** symbols also all share node 0.
- **Select/move:** Select tool, click an element, drag the body to move it.
- **Expand/compress:** drag an element's **endpoint handle** to lengthen or
  shorten it (resize one terminal while the other stays put). Ground is a
  single-terminal symbol but still exposes both ends, so you can stretch and
  reorient it too.
- **Zoom & pan:** the **mouse wheel** zooms toward the cursor; **middle- or
  right-drag** pans the view. Zoom buttons / keys zoom around the canvas centre.
- **Info panel:** select an element to show its live electrical quantities
  (current, voltage drop, value, power, and the circuit operating frequency `fo`
  when an AC source is present) in a panel at the bottom-right — the analog of
  CircuitJS's info overlay.
- **Voltage reference dot:** R/L/C draw a small **white dot** beside one
  terminal — the *positive* reference node. The panel shows
  `Vd = V(dot terminal) − V(other)`, so a sign tells you the orientation
  relative to the dot. For sources the reference is the `+` terminal, so a
  normally-biased source reads a positive voltage.
- **Edit properties:** double-click an element to open the edit dialog. Changes
  preview live; **OK** commits, **Cancel**/**Esc** reverts. Fields accept unit
  strings like `4.7k`, `100n`, `2.2M`.
- **Keys:** Space = run/stop, Delete = remove selected, Ctrl/Cmd+Z = undo,
  `+`/`−` = zoom, `0`/Home = reset view, Esc = Select tool.

## Architecture

| Concern | File | Notes |
|---|---|---|
| Bootstrap | `src/index.ts` | builds the `Simulator`, loads a demo |
| Orchestrator | `src/core/Simulator.ts` | owns the element list + managers (the `CirSim` analog); holds the pan/zoom view transform |
| MNA engine | `src/core/SimulationManager.ts` | `analyzeCircuit` / `stampCircuit` / `runCircuit` + `stamp*` |
| Linear solver | `src/core/matrix/Lu.ts` | dense LU factor/solve |
| Render loop | `src/ui/UIManager.ts` | `requestAnimationFrame`: analyze → stamp → run → draw; applies the view transform + draws the info panel |
| Canvas wrapper | `src/ui/Graphics.ts` | thin layer over `CanvasRenderingContext2D` |
| Input | `src/ui/MouseManager.ts` | place / select / move / resize (endpoint drag) / pan / wheel-zoom / edit |
| Edit dialog | `src/ui/EditDialog.ts` | modal property editor (live preview) |
| Commands + keys | `src/ui/CommandManager.ts` | one dispatch point; minimal undo |
| Toolbar | `src/ui/Menus.ts` | builds toolbar from the registry |
| Element base | `src/elements/SimElement.ts` | the lifecycle contract |
| Element registry | `src/elements/ElementRegistry.ts` | runtime replacement for the GWT generator |
| Elements | `src/elements/*Elm.ts` | the 8 starter elements (incl. an ideal Wire) |
| Serialization | `src/io/Serializer.ts` | text dump/load round-trip |
| i18n | `src/i18n/Locale.ts` | string-catalog shim |

### The simulation loop

Each frame `UIManager` runs the CircuitJS-style cycle: if the topology changed,
`analyzeCircuit()` assigns nodes (posts sharing a grid point = one node) and
voltage-source rows, then `stampCircuit()` fills and LU-factors the constant
matrix. While running, `runCircuit()` advances time: per step it calls
`startIteration()` (refresh companion sources), rebuilds the right-hand side via
each element's `doStep()`, back-solves, and distributes node voltages.

### The element contract (how the engine talks to elements)

`SimElement` defines: `getPostCount()/getPost()`, `setPoints()` (geometry),
`stamp()` (constant matrix), `startIteration()` + `doStep()` (time-varying),
`calculateCurrent()`, `draw()`, `getEditInfo()/setEditValue()` (properties), and
`dump()/applyDumpAttributes()` (serialization).

## Adding a new element

1. Create `src/elements/MyElm.ts` extending `SimElement` (or `VoltageElm`).
2. Implement `getType()`, `getPostCount()`, `getPost()`, `draw()`, and the
   simulation hooks you need:
   - purely linear (like `ResistorElm`): just `stamp()` + `calculateCurrent()`.
   - reactive/stateful (like `CapacitorElm`): add `startIteration()` + `doStep()`.
3. Add editable properties via `getEditInfo()/setEditValue()` and persistence via
   `getDumpAttributes()/applyDumpAttributes()`.
4. Register it at the bottom of the file:
   ```ts
   registerElement({ name: "MyElm", label: "My Element", group: "Custom",
     ctor: (x, y) => new MyElm(x, y) });
   ```
5. Add `import "./MyElm";` to `src/elements/index.ts`.

It now appears in the toolbar, serializes, and participates in the simulation —
no central switch to edit (the registry is the runtime analog of CircuitJS's
compile-time `ElementFactoryGenerator`).

## Swapping the simulation domain

Keep the managers/registry/render loop; replace `SimulationManager` (and its
`stamp*` API) plus the elements with your domain (springs/masses, fluids, logic,
…). `SimElement`'s geometry/draw/edit/serialize parts are domain-agnostic.

## Scope / known simplifications

This is a boilerplate, not a full circuit simulator. Known simplifications and
good exercises to add: wire current is not computed (wires only merge nodes —
node voltages are still correct), scopes/graphing, nonlinear elements (the engine
has a guarded re-factor branch but no convergence subloop), rotation for the
transformer, and matrix simplification. See the reference project's
`INTERNALS.md` for the deeper theory.

## License

Derived from CircuitJS1 (GPL-2.0-or-later); this boilerplate inherits GPL.
