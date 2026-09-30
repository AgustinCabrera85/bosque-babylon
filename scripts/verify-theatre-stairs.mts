import assert from "node:assert/strict";
import { existsSync, readFileSync, statSync } from "node:fs";
import {
  computeStairLegPose,
  dampStairPresentation,
  resolveStairLocomotion,
  shouldKeepStairGrounded,
  shouldUseProceduralStairPose,
} from "../src/game/animation/StairLocomotion";
import { TheatrePlayerWorld } from "../src/game/levels/theatre/TheatrePlayerWorld";
import { STAIR_CONFIG, type StaircaseHandle } from "../src/game/levels/theatre/Staircase";
import type { PlayerStairSurfaceInfo } from "../src/game/PlayerWorldQuery";
import {
  resolveJumpRequest,
  resolveRunningRequest,
} from "../src/game/PlayerController";
import { THEATRE_LOCOMOTION } from "../src/game/levels/theatre/TheatreLocomotion";
import {
  EXPRESSIONIST_ASCENT_GRADE_DELTA,
  EXPRESSIONIST_BASE_GRADE,
  resolveExpressionistAscentMood,
} from "../src/game/levels/theatre/ExpressionistPostProcess";
import { PORTAL_FOG_STYLE } from "../src/game/levels/theatre/PortalSideFog";
import { STAIRCASE_DEFAULT_SETTINGS } from "../src/game/levels/theatre/TheatreStaircaseMaterial";

const staircase = {
  endZ: STAIR_CONFIG.stepCount * STAIR_CONFIG.stepDepth,
  getHeightAt(z: number) {
    if (z <= STAIR_CONFIG.startZ) return 0;
    const index = Math.floor(
      (z - STAIR_CONFIG.startZ) / STAIR_CONFIG.stepDepth
    );
    return Math.max(0, Math.min(STAIR_CONFIG.stepCount, index + 1)) *
      STAIR_CONFIG.stepRise;
  },
} as StaircaseHandle;
const world = new TheatrePlayerWorld(staircase);

const edge = STAIR_CONFIG.stepDepth;
const beforeEdge = world.getStairSurfaceInfo(0, edge - 0.00001);
const afterEdge = world.getStairSurfaceInfo(0, edge + 0.00001);
assert.ok(beforeEdge && afterEdge);
assert.ok(
  Math.abs(beforeEdge.presentationHeight - afterEdge.presentationHeight) < 0.001,
  "the presentation height must remain continuous across a physical riser"
);
assert.ok(
  afterEdge.surfaceHeight - beforeEdge.surfaceHeight > STAIR_CONFIG.stepRise * 0.9,
  "the collision surface must remain a real discrete step"
);

const middleStep: PlayerStairSurfaceInfo = {
  stepIndex: 3,
  stepProgress: 0.5,
  surfaceHeight: STAIR_CONFIG.stepRise * 4,
  presentationHeight: STAIR_CONFIG.stepRise * 3.5,
  ascentDirectionX: 0,
  ascentDirectionZ: 1,
};
const ascending = resolveStairLocomotion(middleStep, 0.05, 1 / 60, -0.15);
const ascendingPose = computeStairLegPose(ascending, 1);
assert.equal(ascending.direction, "up");
assert.equal(ascending.leadLeg, "left");
assert.ok(ascendingPose.leftKneeFlex > ascendingPose.rightKneeFlex * 3);
assert.ok(
  ascendingPose.leftThighPitch > (85 * Math.PI) / 180,
  "the leading thigh must reach approximately 90 degrees"
);
assert.ok(
  ascendingPose.torsoForwardLean > (6 * Math.PI) / 180 &&
    ascendingPose.torsoForwardLean < (8 * Math.PI) / 180,
  "ascending must add a slight forward torso lean"
);
assert.equal(shouldUseProceduralStairPose(ascending), true);

const descending = resolveStairLocomotion(middleStep, -0.05, 1 / 60, -0.15);
const descendingPose = computeStairLegPose(descending, 1);
assert.equal(descending.direction, "down");
assert.equal(descending.leadLeg, "right");
assert.equal(shouldUseProceduralStairPose(descending), false);
assert.ok(
  Object.values(descendingPose).every((value) => Math.abs(value) < 1e-8),
  "descending must leave the authored walking animation untouched"
);

assert.equal(shouldKeepStairGrounded(true, 0, 0.43, 0.05, true), true);
assert.equal(shouldKeepStairGrounded(false, 0, 0.43, 0.05, true), false);
assert.equal(shouldKeepStairGrounded(true, 0, 1.2, 0.05, true), false);

assert.equal(
  resolveRunningRequest(true, THEATRE_LOCOMOTION.runningEnabled),
  false
);
assert.equal(resolveRunningRequest(true, true), true);
assert.equal(
  resolveJumpRequest(true, THEATRE_LOCOMOTION.jumpingEnabled),
  false
);
assert.equal(resolveJumpRequest(true, true), true);
const theatreFootstepPath = `public/${THEATRE_LOCOMOTION.walkFootstepTrack}`;
assert.ok(existsSync(theatreFootstepPath), "the theatre footstep audio must exist");
assert.ok(
  statSync(theatreFootstepPath).size > 0,
  "the theatre footstep audio must not be empty"
);

assert.equal(resolveExpressionistAscentMood(0), 0);
assert.equal(resolveExpressionistAscentMood(1), 1);
assert.ok(resolveExpressionistAscentMood(0.5) > 0);
assert.ok(
  EXPRESSIONIST_BASE_GRADE.desaturate +
    EXPRESSIONIST_ASCENT_GRADE_DELTA.desaturate >
    EXPRESSIONIST_BASE_GRADE.desaturate,
  "the ascent must progressively mute the palette"
);
assert.ok(
  STAIRCASE_DEFAULT_SETTINGS.brightness < 0.5,
  "the staircase texture must be rendered with a darker multiplier"
);
assert.ok(PORTAL_FOG_STYLE.desktopDensity >= 0.7);
assert.ok(PORTAL_FOG_STYLE.mobileDensity >= 0.48);
assert.ok(PORTAL_FOG_STYLE.downwardFlowSpeed > 0.19);
const staircaseMaterialSource = readFileSync(
  "src/game/levels/theatre/TheatreStaircaseMaterial.ts",
  "utf8"
);
assert.doesNotMatch(
  staircaseMaterialSource,
  /Textura_escalera_(?:normal|ambient|specular|displacement)\.png/,
  "the staircase material must use only the common color texture"
);

const cameraStep = dampStairPresentation(1, 2, 6.5, 1 / 60);
assert.ok(cameraStep > 1 && cameraStep < 2);

console.log(
  "Theatre: procedural uphill climb, authored walk descent, dark stairs, fog and damped camera OK"
);
