import { CurrentElm } from "./CurrentElm";
import { registerElement } from "./ElementRegistry";

// DC current source: a constant independent current (waveform = DC).
export class DCCurrentElm extends CurrentElm {
  override getType(): string {
    return "DCCurrentElm";
  }
}

registerElement({
  name: "DCCurrentElm",
  label: "DC Current",
  group: "Sources",
  dumpType: 105,
  ctor: (x, y) => new DCCurrentElm(x, y),
});
