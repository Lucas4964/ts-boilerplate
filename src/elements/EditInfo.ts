// Descriptor for one editable property of an element. Mirrors EditInfo.java but
// trimmed to the numeric case used by the starter elements. getEditInfo()/
// setEditValue() on SimElement form the editing contract; the UI iterates
// getEditInfo(0), getEditInfo(1), ... until it returns null.
export class EditInfo {
  name: string;
  value: number;

  constructor(name: string, value: number) {
    this.name = name;
    this.value = value;
  }
}
