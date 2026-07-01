import type { Simulator } from "../core/Simulator";

// Lightweight right-click popup (rotation actions). Mirrors EditDialog's mount/
// dismiss pattern: a positioned <ul> appended to document.body, closed on
// outside click, Escape, or wheel/scroll. Items dispatch through CommandManager
// so undo/analysis stay centralized.
const ITEMS: { label: string; cmd: string }[] = [
  { label: "Rotate 90° right", cmd: "rotate:cw" },
  { label: "Rotate 90° left", cmd: "rotate:ccw" },
  { label: "Rotate 180°", cmd: "rotate:180" },
];

export class ContextMenu {
  private static current: ContextMenu | null = null;

  static open(sim: Simulator, screenX: number, screenY: number): void {
    ContextMenu.current?.close();
    ContextMenu.current = new ContextMenu(sim, screenX, screenY);
  }

  private el: HTMLUListElement;
  private readonly onDocDown: (e: PointerEvent) => void;
  private readonly onKey: (e: KeyboardEvent) => void;
  private readonly onScroll: () => void;

  private constructor(
    private sim: Simulator,
    sx: number,
    sy: number,
  ) {
    const ul = document.createElement("ul");
    ul.className = "context-menu";
    for (const item of ITEMS) {
      const li = document.createElement("li");
      li.textContent = item.label;
      li.addEventListener("click", () => {
        this.sim.commands.perform(item.cmd);
        this.close();
      });
      ul.appendChild(li);
    }
    document.body.appendChild(ul);
    this.el = ul;

    // Clamp within the viewport so the menu never opens off-screen.
    const w = ul.offsetWidth;
    const h = ul.offsetHeight;
    ul.style.left = Math.max(0, Math.min(sx, window.innerWidth - w - 4)) + "px";
    ul.style.top = Math.max(0, Math.min(sy, window.innerHeight - h - 4)) + "px";

    this.onDocDown = (e: PointerEvent): void => {
      if (!ul.contains(e.target as Node)) this.close();
    };
    this.onKey = (e: KeyboardEvent): void => {
      if (e.key === "Escape") this.close();
    };
    this.onScroll = (): void => this.close();
    // Defer registration so the opening right-click's own events don't close it.
    setTimeout(() => {
      window.addEventListener("pointerdown", this.onDocDown, true);
      window.addEventListener("keydown", this.onKey, true);
      window.addEventListener("wheel", this.onScroll, true);
    }, 0);
  }

  private close(): void {
    window.removeEventListener("pointerdown", this.onDocDown, true);
    window.removeEventListener("keydown", this.onKey, true);
    window.removeEventListener("wheel", this.onScroll, true);
    this.el.remove();
    if (ContextMenu.current === this) ContextMenu.current = null;
  }
}
