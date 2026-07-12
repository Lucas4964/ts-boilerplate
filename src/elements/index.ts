// Barrel module: importing it for side effects registers every element with
// the ElementRegistry. This is the single place to add a new element's import
// — the runtime analog of the GWT generator scanning CircuitElm subtypes.
import "./WireElm";
import "./ResistorElm";
import "./CapacitorElm";
import "./InductorElm";
import "./TransformerElm";
import "./IdealTransformerElm";
import "./ThreePhaseTransformerElm";
import "./DCVoltageElm";
import "./ACVoltageElm";
import "./DCCurrentElm";
import "./ACCurrentElm";
import "./ControlledSourceElm";
import "./GroundElm";
import "./VoltageProbeElm";
import "./DiffVoltageProbeElm";
import "./CurrentProbeElm";
import "./AmmeterElm";

export { ElementRegistry, registerElement } from "./ElementRegistry";
export { SimElement } from "./SimElement";
