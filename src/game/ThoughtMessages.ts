export type ThoughtMessage = {
  text: string;
  durationSeconds?: number;
};

export type ThoughtMessageInput = string | ThoughtMessage;

export type ThoughtSequenceOptions = {
  leadInSeconds?: number;
  gapSeconds?: number;
};

export type ThoughtMessagesHandle = {
  showSequence: (
    messages: readonly ThoughtMessageInput[],
    options?: ThoughtSequenceOptions
  ) => Promise<void>;
  isActive: () => boolean;
  dispose: () => void;
};

const MIN_MESSAGE_SECONDS = 2.4;
const MAX_MESSAGE_SECONDS = 5.5;
const SECONDS_PER_CHARACTER = 0.047;

/**
 * Reusable, queued presentation layer for internal monologue and short
 * narrative messages. Sequences never overlap, so later game events can use
 * the same handle without replacing a thought that is already being read.
 */
export function createThoughtMessages(): ThoughtMessagesHandle {
  const root = document.createElement("div");
  root.id = "thoughtMessages";
  root.className = "thought-messages hidden";
  root.setAttribute("role", "status");
  root.setAttribute("aria-live", "polite");
  root.setAttribute("aria-atomic", "true");

  const panel = document.createElement("div");
  panel.className = "thought-messages-panel";

  const label = document.createElement("span");
  label.className = "thought-messages-label";
  label.textContent = "Pensamiento";

  const text = document.createElement("p");
  text.className = "thought-messages-text";

  panel.append(label, text);
  root.append(panel);
  document.body.append(root);

  let disposed = false;
  let active = false;
  let generation = 0;
  let queue: Promise<void> = Promise.resolve();

  const wait = (seconds: number) =>
    new Promise<void>((resolve) => {
      window.setTimeout(resolve, Math.max(0, seconds) * 1000);
    });

  const getDuration = (message: ThoughtMessage) =>
    message.durationSeconds ??
    Math.min(
      MAX_MESSAGE_SECONDS,
      Math.max(MIN_MESSAGE_SECONDS, 1.15 + message.text.length * SECONDS_PER_CHARACTER)
    );

  const runSequence = async (
    inputs: readonly ThoughtMessageInput[],
    options: ThoughtSequenceOptions
  ) => {
    if (disposed || !inputs.length) return;
    const token = generation;
    const messages = inputs.map((input) =>
      typeof input === "string" ? { text: input } : input
    );

    active = true;
    root.classList.remove("hidden");
    await wait(options.leadInSeconds ?? 0.18);

    for (let index = 0; index < messages.length; index += 1) {
      if (disposed || token !== generation) break;
      const message = messages[index];
      text.textContent = message.text;
      root.classList.add("is-visible");
      await wait(getDuration(message));
      root.classList.remove("is-visible");
      if (index < messages.length - 1) {
        await wait(options.gapSeconds ?? 0.32);
      }
    }

    if (!disposed && token === generation) {
      await wait(0.22);
      root.classList.add("hidden");
      text.textContent = "";
    }
    active = false;
  };

  const showSequence: ThoughtMessagesHandle["showSequence"] = (messages, options = {}) => {
    const sequence = queue.then(() => runSequence(messages, options));
    queue = sequence.catch(() => undefined);
    return sequence;
  };

  return {
    showSequence,
    isActive: () => active,
    dispose: () => {
      if (disposed) return;
      disposed = true;
      generation += 1;
      active = false;
      root.remove();
    },
  };
}
