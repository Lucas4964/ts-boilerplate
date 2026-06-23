import "./styles.css";
import { Simulator } from "./core/Simulator";
import { ElementRegistry } from "./elements/ElementRegistry";
import type { SimElement } from "./elements/SimElement";

// App bootstrap — the analog of circuitjs1.java's onModuleLoad(): grab the DOM
// shell, build the Simulator, load a demo circuit, and start.
const canvas = document.getElementById("canvas") as HTMLCanvasElement;
const toolbar = document.getElementById("toolbar") as HTMLElement;
const infobar = document.getElementById("infobar") as HTMLElement;
const infopanel = document.getElementById("infopanel") as HTMLElement;

const sim = new Simulator({ canvas, toolbar, infobar, infopanel });
sim.init();
loadDemoCircuit(sim);

// Dev-only: expose the simulator for debugging in the browser console.
if (import.meta.env.DEV) {
  (window as unknown as { sim: Simulator }).sim = sim;
}

// A small RC charging circuit so the app does something on first load.
// Two ground symbols share node 0, which closes the loop without a wire element
// (connections are made by overlapping posts — see README).
function loadDemoCircuit(s: Simulator): void {
  const make = (type: string, x: number, y: number, x2: number, y2: number): SimElement => {
    const e = ElementRegistry.createByName(type, x, y)!;
    e.setPosition(x, y, x2, y2);
    return e;
  };

  const src = make("DCVoltageElm", 192, 352, 192, 160); // 5 V, bottom=gnd, top=A
  const res = make("ResistorElm", 192, 160, 384, 160); // A -> B
  const cap = make("CapacitorElm", 384, 160, 384, 352); // B -> gnd
  const g1 = make("GroundElm", 192, 352, 192, 392);
  const g2 = make("GroundElm", 384, 352, 384, 392);

  s.elmList = [src, res, cap, g1, g2];
  s.needAnalyze();
}
