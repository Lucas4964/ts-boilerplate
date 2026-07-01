import { CurrentElm } from "./CurrentElm";
import { registerElement } from "./ElementRegistry";

// AC current source: a sinusoid. Same (empty) matrix structure as DC, but the
// value is pushed to the right-hand side every timestep (see CurrentElm.doStep).
export class ACCurrentElm extends CurrentElm {
  constructor(x: number, y: number) {
    super(x, y);
    this.waveform = CurrentElm.WF_AC;
    this.currentValue = 1;
    this.frequency = 100;
  }

  override getType(): string {
    return "ACCurrentElm";
  }
}

registerElement({
  name: "ACCurrentElm",
  label: "AC Current",
  group: "Sources",
  dumpType: 205,
  ctor: (x, y) => new ACCurrentElm(x, y),
});
