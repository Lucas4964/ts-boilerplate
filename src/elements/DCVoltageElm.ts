import { VoltageElm } from "./VoltageElm";
import { registerElement } from "./ElementRegistry";

// DC voltage source: a constant independent source (waveform = DC).
export class DCVoltageElm extends VoltageElm {
  override getType(): string {
    return "DCVoltageElm";
  }
}

registerElement({
  name: "DCVoltageElm",
  label: "DC Source",
  group: "Sources",
  dumpType: 118,
  ctor: (x, y) => new DCVoltageElm(x, y),
});
