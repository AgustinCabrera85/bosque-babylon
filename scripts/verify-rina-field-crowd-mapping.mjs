import assert from "node:assert/strict";
import { build } from "esbuild";

// Compile in memory so verification leaves no generated file in the project.
const result = await build({
  entryPoints: ["src/game/levels/rina/RinaFieldCrowdMusic.ts"],
  bundle: true,
  write: false,
  platform: "node",
  format: "esm",
});
const source = Buffer.from(result.outputFiles[0].contents).toString("base64");
const { getRinaFieldCrowdCue, getRinaFieldCrowdClipPools } =
  await import(`data:text/javascript;base64,${source}`);

const song = time => getRinaFieldCrowdCue({
  track: "assets/audio/music/Rina - Si Me Miras.mp3",
  currentTime: time,
  playing: true,
  energy: 0.5,
  bass: 0.5,
  voice: 0.5,
});
const groove = song(40);
const chorus = song(60);
const breakCue = song(151);
const extended = song(145);
const final = song(215);
const tail = song(232);

assert.ok(chorus.chorus > 0.95 && chorus.activity > groove.activity + 0.4);
assert.ok(extended.chorus > 0.95 && breakCue.chorus < 0.05);
assert.ok(final.chorus > 0.95 && tail.chorus === 0);
assert.equal(getRinaFieldCrowdCue(null).chorus, 0);
assert.equal(getRinaFieldCrowdCue({
  track: "other.mp3", currentTime: 60, playing: true,
  energy: 1, bass: 1, voice: 1,
}).chorus, 0);

const clips = getRinaFieldCrowdClipPools([
  "fan_01_happy_idle_inplace",
  "fan_01_cheering_inplace",
  "fan_01_silly_dancing_inplace",
]);
assert.deepEqual(clips.calm, [0]);
assert.deepEqual(clips.chorus, [2, 1]);

const motionBuild = await build({
  entryPoints: ["src/game/levels/rina/RinaFieldCrowdMotion.ts"],
  bundle: true,
  write: false,
  platform: "node",
  format: "esm",
});
const motionSource = Buffer.from(motionBuild.outputFiles[0].contents).toString("base64");
const { RinaFieldCrowdMotionController } =
  await import(`data:text/javascript;base64,${motionSource}`);
function sampleMovement(songStart) {
  const matrices = new Float32Array(16);
  const mesh = {
    name: "field-crowd-check",
    isDisposed: () => false,
    isEnabled: () => true,
    thinInstanceBufferUpdated: () => {},
  };
  const controller = new RinaFieldCrowdMotionController("desktop");
  controller.trackCore(mesh, [{ x: 3, y: 0, z: -4, yaw: 0, scale: 1 }], matrices);
  let maxJump = 0;
  for (let frame = 0; frame < 40; frame++) {
    const elapsed = frame * 0.05;
    controller.update(elapsed, 0, song(songStart + elapsed));
    maxJump = Math.max(maxJump, matrices[13]);
    assert.equal(matrices[12], 3, "Crowd motion moved a fan off its collider X");
    assert.equal(matrices[14], -4, "Crowd motion moved a fan off its collider Z");
  }
  controller.dispose();
  return maxJump;
}
assert.ok(sampleMovement(60) > sampleMovement(40) + 0.08,
  "Field fans must jump visibly higher during the chorus than in a groove");
console.log("Rina field crowd mapping: chorus, cut, finale and clip choices verified.");
