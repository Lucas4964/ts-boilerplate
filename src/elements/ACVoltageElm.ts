import { VoltageElm } from "./VoltageElm";
import { registerElement } from "./ElementRegistry";

// AC voltage source: a sinusoid. Same matrix structure as DC, but the value is
// pushed to the right-hand side every timestep (see VoltageElm.doStep).
export class ACVoltageElm extends VoltageElm {
  constructor(x: number, y: number) {
    super(x, y);
    this.waveform = VoltageElm.WF_AC;
    this.maxVoltage = 5;
    this.frequency = 100;
  }

  override getType(): string {
    return "ACVoltageElm";
  }
}

registerElement({
  name: "ACVoltageElm",
  label: "AC Source",
  group: "Sources",
  dumpType: 111,
  ctor: (x, y) => new ACVoltageElm(x, y),
});
