export class DebugPanel {
  private readonly host = document.createElement("div");
  private readonly content: HTMLElement;

  public constructor(title: string) {
    this.host.dataset.bosqueDebugPanel = title;
    this.host.hidden = true;
    Object.assign(this.host.style, {
      position: "fixed",
      top: "12px",
      right: "12px",
      zIndex: "2147483000",
      pointerEvents: "auto",
    });

    const shadow = this.host.attachShadow({ mode: "open" });
    const style = document.createElement("style");
    style.textContent = `
      :host { color-scheme: dark; }
      .panel {
        width: min(360px, calc(100vw - 24px));
        box-sizing: border-box;
        padding: 14px;
        border: 1px solid rgba(170, 205, 190, .38);
        border-radius: 6px;
        background: rgba(8, 13, 12, .94);
        box-shadow: 0 12px 36px rgba(0, 0, 0, .5);
        color: #dce9e2;
        font: 12px/1.35 ui-monospace, SFMono-Regular, Consolas, monospace;
      }
      h1 { margin: 0 0 12px; color: #effaf4; font-size: 14px; letter-spacing: .08em; }
      section + section { margin-top: 14px; }
      h2 { margin: 0 0 7px; color: #91b9a6; font-size: 11px; letter-spacing: .1em; }
      .stack { display: grid; gap: 7px; }
      button {
        min-height: 30px;
        border: 1px solid rgba(145, 185, 166, .48);
        border-radius: 4px;
        padding: 5px 9px;
        background: #18241f;
        color: #eef8f3;
        font: inherit;
        cursor: pointer;
      }
      button:hover, button:focus-visible { border-color: #b9dbc9; background: #22332b; outline: none; }
      button:disabled { cursor: wait; opacity: .62; }
    `;

    const panel = document.createElement("aside");
    panel.className = "panel";
    panel.setAttribute("aria-label", title);
    const heading = document.createElement("h1");
    heading.textContent = title;
    this.content = document.createElement("div");
    panel.append(heading, this.content);
    shadow.append(style, panel);
    document.body.append(this.host);
  }

  public addSection(title: string) {
    const section = document.createElement("section");
    const heading = document.createElement("h2");
    heading.textContent = title;
    const body = document.createElement("div");
    body.className = "stack";
    section.append(heading, body);
    this.content.append(section);
    return body;
  }

  public addButton(
    parent: HTMLElement,
    label: string,
    action: () => void | Promise<void>
  ) {
    const button = document.createElement("button");
    button.type = "button";
    button.textContent = label;
    button.addEventListener("click", async () => {
      button.disabled = true;
      try {
        await action();
      } catch (error) {
        console.error(`[DebugPanel] ${label}`, error);
      } finally {
        button.disabled = false;
      }
    });
    parent.append(button);
    return button;
  }

  public toggle() {
    this.host.hidden = !this.host.hidden;
  }

  public dispose() {
    this.host.remove();
  }
}
