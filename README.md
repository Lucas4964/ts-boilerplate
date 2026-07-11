# Canvas Simulator Boilerplate (TypeScript)

A reusable starting point for building **interactive canvas simulators** with a
**pluggable element model**. It is an architectural port of
[CircuitJS1](https://github.com/sharpie7/circuitjs1) (originally Java + GWT) to
modern **TypeScript + HTML + Canvas**, preserving the *patterns* — orchestrator,
managers, element base + registry, MNA engine, render loop — without the GWT
toolchain.

The included reference domain is a small **circuit simulator** with a dozen-plus
elements (wire, resistor, capacitor, inductor, single- and three-phase
transformers, DC/AC voltage sources, DC/AC current sources, ground, a series
ammeter, and voltage/differential/current probes). Swap the domain by replacing
the engine + elements behind the same seams.

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
  Clear, Export/Import (plain text), **Zoom +/−/Reset View**, an **analysis mode
  toggle (Transient / Phasor)** with a frequency field, and a Speed slider.
- **Place an element:** click its toolbar button (or press its **shortcut key**,
  below), then drag on the canvas (a plain click drops a default-sized one). The
  tool reverts to Select after — except **Wire**, which stays active so you can
  chain many segments; leave it with **Esc** or a **right-click**.
- **Connect elements** by overlapping their endpoints on the same grid point,
  or run a **Wire** between them (a wire merges its two endpoints into one node).
  Multiple **Ground** symbols also all share node 0.
- **Select/move:** Select tool, click an element, drag the body to move it. Hit
  areas hug each component's **real shape** — the line/leads for R/L/C and wires,
  the circle for a source, the box for a transformer — so adjacent parts don't
  steal each other's clicks. Drag on **empty space** to rubber-band a **selection
  box** — every element it touches is selected (then **Delete** removes them all).
- **Expand/compress:** drag an element's **endpoint handle** to lengthen or
  shorten it (resize one terminal while the other stays put). Ground is a
  single-terminal symbol but still exposes both ends, so you can stretch and
  reorient it too.
- **Rotate:** **right-click a component** for a context menu with **Rotate 90°
  right / left / 180°** (grid-based, so terminals stay on the grid — no arbitrary
  angles). A single component spins around its own centre; a multi-selection
  rotates rigidly around the group centre (connections are preserved). Linear
  parts (R/L/C, sources, meters, wires, ground, probes) rotate by transforming
  their two endpoints; the **transformers** carry a persisted orientation and
  redraw via a canvas transform, so coils/terminals/hitbox all follow while the
  labels stay horizontal. Rotation never changes the electrical result (the
  solver depends only on terminal topology) and is undoable.
- **Zoom & pan:** the **mouse wheel** zooms toward the cursor; **middle- or
  right-drag empty space** pans the view (a right-click on a component opens the
  rotate menu instead). Zoom buttons / keys zoom around the canvas centre.
- **Info panel:** select an element to show its live electrical quantities
  (current, voltage drop, value, power, and the circuit operating frequency `fo`
  when an AC source is present) in a panel at the bottom-right — the analog of
  CircuitJS's info overlay.
- **Value labels:** R/L/C print their value next to the body (always drawn
  horizontally, so they stay legible at any orientation). Transient mode shows
  the physical value with its unit (`1H`, `15µF`, `10`); phasor mode shows the
  impedance in ohms, with a `j` prefix on inductors (`j377`) and `-j` on
  capacitors (`-j265`) to flag the complex reactance.
- **Voltage reference mark:** R/L/C draw a small white **`*`** beside one
  terminal — the *positive* reference node. The panel shows
  `Vd = V(* terminal) − V(other)`, so a sign tells you the orientation
  relative to the mark. **Sources** also mark their `+` terminal (so an AC
  source's polarity is visible, not just the DC `+/−` glyphs), and a
  normally-biased source reads a positive voltage. The **transformer** marks
  each winding's reference terminal (primary and secondary), i.e. the classic
  **dot convention**: `V1`/`V2` are measured `*`→un-`*`, so if a primary `*` is
  wired to a source's `−` terminal you'll read `V1 = −V_source` (`5 ∠ 180°`) —
  flip the connection (now visible) to read it in phase.
- **Measurement probes** (no series insertion, no topology change):
  - **V Probe** (1 click): absolute node voltage, `V = V(point) − ground`.
  - **ΔV Probe** (two clicks, point A then B): differential `Vab = V(a) − V(b)`;
    the A—B span is drawn dashed because it is a *measurement*, not a wire.
  - **I Probe** (1 click): a clamp that reads the current of the **specific
    terminal** it sits on — so clamping terminal B of a 3φ transformer reads B's
    line current, not A's. It binds to the nearest current-carrying terminal
    (wires/ground carry no measurable branch current, so they're skipped).
  All probes show the reading on canvas and in the info panel, in polar form in
  phasor mode.
  - **Ammeter** (series): unlike the clamp-on I Probe, this one wires **into**
    the branch. It is an **ideal 0 V source** whose branch current is solved as
    an extra unknown — zero inserted voltage drop, exact series current. Same
    model as Falstad's ammeter and SPICE's dummy-`V 0` trick. Works in both modes.
- **Controlled (dependent) sources:** `Sources → Controlled` offers the four
  linear dependent sources — **VCVS** (V→V, gain μ), **VCCS** (V→I,
  transconductance gm), **CCVS** (I→V, transresistance r) and **CCCS** (I→I,
  gain β) — modelled exactly on ngspice's `E/G/H/F` devices (same MNA stamps,
  linear, frequency-independent, valid in both transient and phasor modes).
  Each is a 4-terminal block: the **control pair `c+/c−`** on the left, the
  **output pair** on the right (diamond symbol: `+/−` for a voltage output, an
  arrow for a current output). **Wiring the control**: for voltage control
  (VCVS/VCCS) connect `c+/c−` **in parallel** with the sensed component — the
  pair is ideal and draws no current; for current control (CCVS/CCCS) insert
  `c+/c−` **in series** into the sensed branch — internally it is a 0 V source
  (an ideal ammeter), exactly SPICE's "control through a named V source" made
  self-contained (as Falstad's chips do). Positive output current exits the
  `out+` terminal. **Bound control (no extra wiring):** instead of wiring
  `c+/c−`, double-click the source and set **Control → Pick element on
  canvas…**, then click the component whose quantity should drive it — a dashed
  `ctrl` link shows the binding, and the control equals **exactly the value that
  component's info panel shows** (its `Vd` with its own `*` polarity, or its `I`
  with its own direction). Voltage control binds to any 2-terminal element;
  current control binds to anything whose current is expressible during the
  solve — voltage sources and the ammeter (their branch current is already an
  MNA unknown), R (Ohm's law), L/C (their trapezoidal companion — still exact),
  and current sources; **wires can't be bound** (their current isn't computed).
  The binding survives save/load and undo; deleting the target falls back to
  the wired pair. The bound coupling stays **inside the matrix** (simultaneous,
  no one-step lag), so results are identical to the wired equivalent.
  **Complex transresistance (CCVS):** the CCVS also takes a **Reactance x (Ω)**,
  making its gain `Z = r + jx` in **phasor mode** (in transient there is no `jX`
  operator, so only `r` applies). This enables the classic **mutually-coupled
  line** model in the phase domain: per phase, wire the self impedance as
  `R_s + L_s` in series, then one CCVS per mutual, bound to the *other* phase's
  ammeter, with `x = X_m` (and `r = R_m` if there is a Carson earth-return
  resistance). Because it implements the full phase-domain Z matrix
  (`V_a = Z_aa·I_a + Z_ab·I_b + …`), it is exact for **unbalanced** systems and
  **untransposed** lines (validated against a hand-solved 2×2 complex system to
  ~1e-8). Note this is the lumped series (short-line) model — no shunt C. A high-gain VCVS makes an ideal-op-amp macro (validated: an
  inverting amp with μ=1e5, R1=1k, Rf=10k reads −9.9989 V — the exact
  finite-gain value). Caveats: a loop of ideal V-outputs is singular (add a
  series resistor), and positive-feedback loops with gain ≥ 1 blow up — physics,
  not a bug.
- **Sources:** the **Sources** menu splits into **Voltage** (AC/DC voltage
  sources) and **Current** (AC/DC current sources). A **current source** is the
  dual of a voltage source: it stamps only the right-hand side (`stampCurrentSource`),
  drives a fixed current with the arrow marking its direction (post 0 → post 1),
  and its terminal voltage is set by the circuit. In **phasor** mode a *DC*
  current source is **open** (a dead current source, the dual of a dead voltage
  source's short), so — like the DC voltage source — it can't be inserted there.
  A current source into an **open** circuit is an ideal singularity; here the
  GMIN-to-ground keeps the matrix solvable, so you'll see a very large (not
  infinite) terminal voltage rather than a crash.
- **Analysis modes:** **Transient** (default) runs the time-domain solver
  described below. **Phasor** does a single AC steady-state solve at the global
  frequency in the toolbar: R/L/C become complex impedances (`Z_L = jωL`,
  `Z_C = 1/jωC`), sources are phasors (magnitude ∠ phase), and the info panel
  shows every quantity in **polar form** (`mag ∠ angle°`), including complex
  power `S = V·conj(I)`. Switching modes keeps the same circuit. All elements
  (including the transformer) work in both modes. Mode-specific behaviour:
  - **Cosine convention:** the AC source is `v(t) = Vm·cos(ωt+φ)`, so its phasor
    is `Vm∠φ` — matching textbooks (Sadiku). Enter magnitude/phase straight from
    the book; transient and phasor agree.
  - **Frequency field** (`f (Hz)`) is editable only in phasor mode; in transient
    it is disabled. All AC sources share this one global frequency, so an AC
    source's own frequency field shows it read-only while in phasor mode.
  - **DC sources** can't be inserted in phasor mode (a DC source has no phasor);
    any existing one is treated as a short circuit (0 V) per superposition.
  - **Inductors/capacitors** can be edited by **impedance (Ω)** or physical value
    (H/F) via a unit combobox in the edit dialog (phasor mode only, default Ω).
    The stored value is always physical; the Ω view is derived from the global
    frequency. Transient mode shows the dialog exactly as before (no combobox).
- **Edit properties:** double-click an element to open the edit dialog. Changes
  preview live; **OK** commits, **Cancel**/**Esc** reverts. Fields accept unit
  strings like `4.7k`, `100n`, `2.2M`. The **coupling coefficient** is shown at
  **full precision** (no rounding) — it is sensitive enough that `0.9999999` must
  not collapse to `1`.
- **Number display:** computed quantities show **up to 4 decimal places** with
  trailing zeros trimmed (`6.5000` → `6.5`, `5.0000` → `5`), in the info panel,
  the on-canvas value labels, and the polar readouts.
- **Keys:** Space = run/stop, Delete = remove selected, Ctrl/Cmd+Z = undo,
  `+`/`−` = zoom, `0`/Home = reset view, Esc = Select tool. **Insertion shortcuts**
  (case-insensitive): **W** = Wire, **R** = Resistor, **L** = Inductor,
  **C** = Capacitor, **T** = Transformer, **G** = Ground, **V** = DC source,
  **A** = Ammeter (DC sources are ignored in phasor mode, and all shortcuts are
  ignored while typing in a field).

## Architecture

| Concern | File | Notes |
|---|---|---|
| Bootstrap | `src/index.ts` | builds the `Simulator`, loads a demo |
| Orchestrator | `src/core/Simulator.ts` | owns the element list + managers (the `CirSim` analog); holds the pan/zoom view transform |
| MNA engine | `src/core/SimulationManager.ts` | transient: `analyzeCircuit` / `stampCircuit` / `runCircuit` + `stamp*`; phasor: `solvePhasor` + complex `stamp*C` |
| Linear solver | `src/core/matrix/Lu.ts`, `LuComplex.ts` | dense LU factor/solve — real (transient) and complex (phasor) |
| Complex numbers | `src/core/Complex.ts` | immutable complex type for the phasor mode |
| Render loop | `src/ui/UIManager.ts` | `requestAnimationFrame`: analyze → stamp → run → draw; applies the view transform + draws the info panel |
| Canvas wrapper | `src/ui/Graphics.ts` | thin layer over `CanvasRenderingContext2D` |
| Input | `src/ui/MouseManager.ts` | place / select / move / resize (endpoint drag) / pan / wheel-zoom / edit |
| Edit dialog | `src/ui/EditDialog.ts` | modal property editor (live preview) |
| Commands + keys | `src/ui/CommandManager.ts` | one dispatch point; minimal undo |
| Toolbar | `src/ui/Menus.ts` | builds toolbar from the registry |
| Element base | `src/elements/SimElement.ts` | the lifecycle contract |
| Element registry | `src/elements/ElementRegistry.ts` | runtime replacement for the GWT generator |
| Elements | `src/elements/*Elm.ts` | the starter elements (incl. an ideal Wire and measurement probes) |
| Serialization | `src/io/Serializer.ts` | text dump/load round-trip |
| i18n | `src/i18n/Locale.ts` | string-catalog shim |

### The simulation loop

Each frame `UIManager` runs the CircuitJS-style cycle: if the topology changed,
`analyzeCircuit()` assigns nodes (posts sharing a grid point = one node) and
voltage-source rows, then `stampCircuit()` fills and LU-factors the constant
matrix. While running, `runCircuit()` advances time: per step it calls
`startIteration()` (refresh companion sources), rebuilds the right-hand side via
each element's `doStep()`, back-solves, and distributes node voltages.

In **phasor mode** the same `analyzeCircuit()` node assignment is reused, but
instead of time-stepping, `solvePhasor()` builds a **complex** MNA system
(`[Y]{V}={I}` via each element's `stampPhasor(ω)`), factors/solves it once with
the complex LU, and distributes complex node phasors. It re-solves only when the
circuit, the global frequency, or a value changes (`phasorDirty`).

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
has a guarded re-factor branch but no convergence subloop), and matrix
simplification. See the reference project's `INTERNALS.md` for the deeper theory.

For numerical robustness the engine adds a small **GMIN** conductance (1e-9 S)
from every node to ground (as SPICE does), so a floating subcircuit — e.g. a
transformer's galvanically-isolated secondary — stays solvable instead of
producing a singular matrix. A loop of *ideal* voltage sources is still singular
(its indeterminacy is in the source rows, not to ground) and is reported as
such — add a series resistance, as you would in SPICE.

The transformer follows SPICE's model (ngspice's coupled mutual inductors): the
*branch-current* formulation — each winding is a current unknown with a branch
equation `V = jωL·I + jωM·I_other` (phasor) / trapezoidal companion (transient),
`M = k·√(L1·L2)`. Because it never inverts `[L]`, it stays well-conditioned up to
ideal coupling (`k = 1`).

### Fidelity notes (validated against analytic solutions)

Two deliberate deviations from Falstad, both *toward* SPICE:
- **Time-varying sources are evaluated at the end of the step (`t+h`)**, the time
  point the solve actually produces — Falstad evaluates at `t`, which time-shifts
  every waveform by one step. With this, the transient AC steady state matches the
  phasor solve to ~1e-6 relative (measured), instead of lagging by `ωh`.
- **Capacitor `Initial Voltage`** (transient only, applied on Reset/load) — same
  parameter Falstad exposes.

The whole numeric path was audited against CircuitJS1's Java source (LU solvers,
MNA stamps, companion models, sign conventions) and validated end-to-end against
closed-form solutions: DC divider (exact to GMIN), RC/RL step and RC discharge
(&lt;0.03% at t=τ with the default 5 µs step), series-RC phasor vs the complex
divider (~1e-7), transient-vs-phasor AC agreement (~1e-6), a loaded single-phase
transformer vs the coupled-inductor equations (~1e-10), the 3φ vector groups
(ratios 1, √3, 1/√3 and shifts 0°/±30° exact), and ammeter ≡ clamp probe ≡
analytic current.

### Three-phase transformer

`3φ Transformer` is a single **6-terminal** block (posts 0–2 = primary A/B/C on
the left, 3–5 = secondary a/b/c on the right). The winding topology is **not**
drawn — it is chosen in the edit dialog by a **vector-group** combobox (connection
+ clock number: `Yy0, Dy11, Dy1, Yd11, Dd0`). Internally it is a *bank* of three
coupled single-phase units reusing the same branch-current model, so each phase is
**exactly** the single-phase transformer above (verified: the block is numerically
identical to three discrete single-phase transformers wired the same way). The
connection only decides how each winding's two ends map onto the line terminals /
neutral:

- **Y**: `line_i ↔ neutral` (neutral = ground when grounded, else an internal
  floating node kept solvable by GMIN);
- **Δ⁺**: `line_i ↔ line_(i+1)`, **Δ⁻**: `line_i ↔ line_(i+2)` — the two delta
  orientations are what produce the ±30° clock shift (Δ puts the *line-to-line*
  voltage across the winding).

- **Neutral grounding** is a separate per-Y-side toggle in the dialog
  (`Primary/Secondary neutral = Grounded | Isolated`, shown only for a Y side;
  **default Grounded**). The drawn name reflects it — `Yy0` with both neutrals
  grounded shows as **`YNyn0`**. An **isolated** Y neutral floats: with an
  *unbalanced* load it shifts (the classic Yy neutral instability), so the phase
  voltages go unbalanced even at 1:1 — that is correct physics, not a bug (the
  discrete-transformer bank does the same). Grounding the neutral makes each phase
  independent, so a grounded 1:1 holds the secondary at the primary.
- **Info panel:** every phase, grouped by side — `Vp/Vs` (line-to-ground) and
  `Ip/Is` (line currents) for A/B/C, in polar form in phasor mode.

The editable **ratio is the per-winding turns ratio `N1:N2`** — the *same*
quantity as the single-phase transformer, so each phase of the block is
numerically identical to a discrete single-phase unit (the SPICE / Falstad model,
which has no "nameplate line ratio" concept). The √3 between line and winding
voltage is **not** folded in; it falls out of the connection itself (a Y winding
is wired line-to-neutral and sees `V_line/√3`, a Δ winding sees the full
line-to-line). So a **`1:1` Y–Δ steps the line voltage by √3** (e.g. 220 V line in
→ 127 V line out), exactly like a bank of three single-phase units — the √3 is a
real connection effect, not hidden. `Y–Y` and `Δ–Δ` keep line = line.
Limitations: it is a *bank* model (no zero-sequence
magnetic coupling of a 3-limb core); leakage is tied to the coupling coefficient
(`L_sc = L·(1−k²)`), so with small loads a low `k` noticeably loads the secondary —
raise `k` toward 1 for a near-ideal 1:1. A **Δ–Δ at exactly `k = 1`** leaves the
delta circulating current indeterminate (singular) — use a realistic `k < 1`.

## License

Derived from CircuitJS1 (GPL-2.0-or-later); this boilerplate inherits GPL.
