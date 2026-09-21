import { expect } from "chai";
import { getServerStateFiles } from "../testweb/serverui-test-state";

describe("Server UI test state", () => {
  it("keeps full and fast suite state files separate", () => {
    const fullState = getServerStateFiles("full");
    const fastState = getServerStateFiles("fast");

    expect(fullState.portFile).to.not.equal(fastState.portFile);
    expect(fullState.slotFile).to.not.equal(fastState.slotFile);
    expect(fullState.portFile).to.not.equal(fastState.slotFile);
    expect(fullState.slotFile).to.not.equal(fastState.portFile);
  });
});
