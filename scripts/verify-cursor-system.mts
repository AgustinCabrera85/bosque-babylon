import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import {
  CURSORS,
  CURSOR_PRIORITY,
  resolveCursorType,
} from "../src/game/input/CursorController";
import { resolveInteractionCursorType } from "../src/game/InteractSystem";

assert.deepEqual(CURSOR_PRIORITY, [
  "menu",
  "pickup",
  "interact",
  "anomaly",
  "danger",
  "default",
]);
assert.equal(resolveCursorType(["default", "danger", "interact"]), "interact");
assert.equal(resolveCursorType(["pickup", "menu", "anomaly"]), "menu");
assert.equal(resolveCursorType([]), "default");

for (const [type, definition] of Object.entries(CURSORS)) {
  const publicPath = `public/${definition.url.replace(/^\//, "")}`;
  assert.ok(existsSync(publicPath), `${type} cursor asset must exist: ${publicPath}`);
  assert.ok(definition.hotspotX >= 0 && definition.hotspotX < definition.rasterSize);
  assert.ok(definition.hotspotY >= 0 && definition.hotspotY < definition.rasterSize);
  assert.ok(definition.fallback.length > 0);
}

for (const pickupType of ["key", "matches", "note", "photo"]) {
  assert.equal(resolveInteractionCursorType({ type: pickupType }), "pickup");
}
assert.equal(resolveInteractionCursorType({ type: "door" }), "interact");
assert.equal(
  resolveInteractionCursorType({ type: "clue", interactionCursor: "anomaly" }),
  "anomaly"
);

console.log(
  "Cursor system: assets, hotspots, priority and interaction classification OK"
);
