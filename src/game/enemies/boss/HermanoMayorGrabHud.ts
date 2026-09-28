/** DOM adapter for the repeated-interaction neck-grab escape prompt. */
export class HermanoMayorGrabHud {
  private readonly root = document.getElementById("hermanoMayorGrabHud");
  private readonly fill = document.getElementById("hermanoMayorGrabFill");
  private readonly progress = document.getElementById("hermanoMayorGrabProgress");
  private readonly count = document.getElementById("hermanoMayorGrabCount");
  private visible = false;

  public setState(
    active: boolean,
    progress: number,
    presses: number,
    requiredPresses: number
  ) {
    const safeProgress = Math.max(0, Math.min(1, progress));
    if (this.visible !== active) {
      this.visible = active;
      this.root?.classList.toggle("active", active);
      this.root?.setAttribute("aria-hidden", active ? "false" : "true");
    }
    this.fill?.style.setProperty("--grab-progress", String(safeProgress));
    this.progress?.setAttribute("aria-valuenow", String(Math.round(safeProgress * 100)));
    if (this.count) {
      this.count.textContent = `${Math.min(presses, requiredPresses)} / ${requiredPresses}`;
    }
  }

  public dispose() {
    this.setState(false, 0, 0, 1);
  }
}
