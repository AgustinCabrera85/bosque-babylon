import assert from "node:assert/strict";
import { NullEngine } from "@babylonjs/core/Engines/nullEngine";
import { Scene } from "@babylonjs/core/scene";
import { StandardMaterial } from "@babylonjs/core/Materials/standardMaterial";
import { PBRMaterial } from "@babylonjs/core/Materials/PBR/pbrMaterial";
import { SanctuaryPortalFloorLightPlugin } from "../src/game/levels/sanctuary/SanctuaryGeometry";
import { SanctuaryDistanceHazePlugin } from "../src/game/levels/sanctuary/SanctuaryDistanceHaze";

const engine = new NullEngine();
const scene = new Scene(engine);

try {
  const floor = new SanctuaryPortalFloorLightPlugin(new StandardMaterial("portal-floor", scene));
  const haze = new SanctuaryDistanceHazePlugin(new PBRMaterial("portal-haze", scene));
  assert.match(floor.getCustomCode("fragment")?.CUSTOM_FRAGMENT_BEFORE_FRAGCOLOR ?? "",
    /sanctuaryFloorStrength/);
  assert.match(haze.getCustomCode("fragment")?.CUSTOM_FRAGMENT_BEFORE_FRAGCOLOR ?? "",
    /sanctuaryPortalHazeStrength/);
  console.log("Sanctuary portal material plugins construct without errors");
} finally {
  scene.dispose();
  engine.dispose();
}
