import type { Simulator } from "../core/Simulator";
import { Serializer } from "../io/Serializer";

// Central command dispatch + keyboard shortcuts (mirrors CircuitJS's
// CommandManager.menuPerformed). The menu and key handlers funnel through
// perform(), keeping one place to add/rename actions. Also hosts a minimal
// snapshot-based undo (a stand-in for the full UndoManager).
export class CommandManager {
  private sim: Simulator;
  private undoStack: string[] = [];

  constructor(sim: Simulator) {
    this.sim = sim;
  }

  init(): void {
    window.addEventListener("keydown", (e) => this.onKey(e));
  }

  perform(cmd: string): void {
    if (cmd === "toggle-run") this.sim.setSimRunning(!this.sim.simRunning);
    else if (cmd === "reset") this.sim.resetSimulation();
    else if (cmd === "delete") {
      this.pushUndo();
      this.sim.deleteSelected();
    } else if (cmd === "clear") {
      this.pushUndo();
      this.sim.clearCircuit();
    } else if (cmd === "export") this.exportCircuit();
    else if (cmd === "import") this.importCircuit();
    else if (cmd === "undo") this.undo();
    else if (cmd.startsWith("mode:")) this.sim.setMouseMode(cmd.slice(5));
  }

  pushUndo(): void {
    this.undoStack.push(Serializer.dump(this.sim.elmList));
    if (this.undoStack.length > 50) this.undoStack.shift();
  }

  private undo(): void {
    const t = this.undoStack.pop();
    if (t !== undefined) {
      this.sim.elmList = Serializer.load(t);
      this.sim.clearSelection();
      this.sim.needAnalyze();
    }
  }

  private exportCircuit(): void {
    const text = Serializer.dump(this.sim.elmList);
    window.prompt("Circuit text (copy):", text);
  }

  private importCircuit(): void {
    const text = window.prompt("Paste circuit text:");
    if (text) {
      this.pushUndo();
      this.sim.elmList = Serializer.load(text);
      this.sim.clearSelection();
      this.sim.needAnalyze();
    }
  }

  private onKey(e: KeyboardEvent): void {
    // ignore keys while typing in an input (e.g. the speed slider has focus)
    const target = e.target as HTMLElement | null;
    if (target && (target.tagName === "INPUT" || target.tagName === "TEXTAREA")) return;

    if (e.key === "Delete" || e.key === "Backspace") {
      this.perform("delete");
      e.preventDefault();
    } else if (e.key === " ") {
      this.perform("toggle-run");
      e.preventDefault();
    } else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "z") {
      this.perform("undo");
      e.preventDefault();
    } else if (e.key === "Escape") {
      this.sim.setMouseMode("select");
    }
  }
}
