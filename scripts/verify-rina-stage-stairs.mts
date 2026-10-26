import assert from "node:assert/strict";
import { RinaStadiumWorld } from "../src/game/levels/rina/RinaStadiumWorld";
import { RINA_STAGE_STAIRS, RINA_STADIUM, RINA_STADIUM_SCALE } from "../src/game/levels/rina/RinaLevelConfig";

const worldCoordinate = (local: number) => local * RINA_STADIUM_SCALE;
const collision = (world: RinaStadiumWorld, localX: number, localZ: number, feetY: number) =>
  world.isColliding(worldCoordinate(localX), worldCoordinate(localZ), 0,
    feetY, feetY + RINA_STADIUM.playerEyeHeight + 0.25);
const height = (world: RinaStadiumWorld, localX: number, localZ: number) =>
  world.getWalkableSurfaceHeight(worldCoordinate(localX), worldCoordinate(localZ));

for (const tier of ["desktop", "mobile"] as const) {
  const world = new RinaStadiumWorld([], null, tier);
  const count = RINA_STAGE_STAIRS.steps[tier];
  const rise = RINA_STADIUM.stage.height * RINA_STADIUM_SCALE / count;
  const firstZ = RINA_STADIUM.stage.frontZ - count * RINA_STAGE_STAIRS.stepDepth;
  for (const side of [-1, 1]) {
    const x = side * RINA_STAGE_STAIRS.centerX;
    assert.equal(collision(world, x, firstZ - 0.2, 0), false);
    let feet = 0;
    for (let step = 0; step < count; step++) {
      const z = firstZ + (step + 0.5) * RINA_STAGE_STAIRS.stepDepth;
      assert.equal(collision(world, x, z, feet), false,
        `${tier} ${side}: step ${step} blocked`);
      const nextFeet = height(world, x, z);
      assert.ok(Math.abs(nextFeet - (step + 1) * rise) < 1e-5);
      assert.ok(nextFeet - feet <= 0.65,
        `${tier} ${side}: riser too high for stair locomotion`);
      assert.equal(world.getStairSurfaceInfo(worldCoordinate(x), worldCoordinate(z))?.stepIndex,
        step);
      feet = nextFeet;
    }
    assert.equal(collision(world, x, RINA_STADIUM.stage.frontZ + 0.2, feet), false);
    assert.equal(height(world, x, RINA_STADIUM.stage.frontZ + 0.2),
      RINA_STADIUM.stage.height * RINA_STADIUM_SCALE);
  }
  const deckFeet = RINA_STADIUM.stage.height * RINA_STADIUM_SCALE;
  assert.equal(collision(world, 0, RINA_STADIUM.stage.frontZ - 1, deckFeet), false,
    `${tier}: catwalk should connect to the stage`);
  assert.equal(collision(world, 0, RINA_STADIUM.stage.frontZ - 1, 0), true,
    `${tier}: field player should remain below the catwalk`);
  assert.equal(collision(world, 18, RINA_STADIUM.stage.frontZ + 0.2, 0), true,
    `${tier}: field player should not bypass the stairs`);
  assert.equal(collision(world, RINA_STADIUM.stage.width / 2 + 1, 40, deckFeet), true,
    `${tier}: stage edge should remain solid`);
}

console.log("Rina stage stairs: both sides and LOD tiers are walkable; deck and catwalk connect.");
