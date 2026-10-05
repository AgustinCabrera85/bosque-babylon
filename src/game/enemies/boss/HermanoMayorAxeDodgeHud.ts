import type { HermanoMayorAxeDodgePromptState } from "./HermanoMayorAxeAttack";

/** DOM adapter for the single-input axe dodge timing window. */
export class HermanoMayorAxeDodgeHud {
  private readonly root = document.getElementById("hermanoMayorAxeDodgeHud");
  private readonly title = document.getElementById("hermanoMayorAxeDodgeTitle");
  private readonly fill = document.getElementById("hermanoMayorAxeDodgeFill");
  private readonly progress = document.getElementById(
    "hermanoMayorAxeDodgeProgress"
  );
  private readonly interactButton = document.getElementById("interactButton");
  private state: HermanoMayorAxeDodgePromptState = "hidden";

  public setState(
    state: HermanoMayorAxeDodgePromptState,
    remaining: number,
    sanity: number
  ) {
    const safeRemaining = Math.max(0, Math.min(1, remaining));
    const safeSanity = Math.max(0, Math.min(1, sanity));
    if (this.state !== state) {
      this.state = state;
      this.root?.classList.toggle("active", state !== "hidden");
      this.root?.classList.toggle("success", state === "success");
      this.root?.setAttribute("aria-hidden", state === "hidden" ? "true" : "false");
      this.interactButton?.classList.toggle("dodge-window", state === "window");
    }

    this.root?.classList.toggle("low-sanity", safeSanity <= 0.35);
    this.fill?.style.setProperty("--axe-dodge-remaining", String(safeRemaining));
    this.progress?.setAttribute(
      "aria-valuenow",
      String(Math.round(safeRemaining * 100))
    );
    if (this.title) {
      this.title.textContent = state === "success" ? "¡ESQUIVADO!" : "¡ESQUIVA!";
    }
  }

  public dispose() {
    this.setState("hidden", 0, 1);
  }
}
