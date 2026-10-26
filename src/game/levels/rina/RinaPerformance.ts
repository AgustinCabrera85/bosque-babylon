import type { Vector3 } from "@babylonjs/core/Maths/math.vector";
import type { MusicPlaybackState } from "../../MusicPlayer";
import type { RinaController } from "../../enemies/rina";
import { RINA_CONCERT_SONG } from "./RinaConcertConfig";
import type { RinaSingingPointAction } from "./RinaSingingPointAction";

function clamp01(value: number) {
  return Math.max(0, Math.min(1, value));
}

function smoothstep(value: number) {
  const t = clamp01(value);
  return t * t * (3 - 2 * t);
}

/** Song-time choreography so seeking or a restarted track stays in sync. */
export function createRinaPerformance(
  rina: RinaController,
  stagePosition: Vector3,
  catwalkPosition: Vector3,
  pointAction: RinaSingingPointAction
) {
  let mouthOpen = 0;
  let mouthO = 0;
  let mouthWide = 0;
  let heldPosition: Vector3 | null = null;

  return {
    /** Called at the fan's shutter event with that fan's world foot position. */
    pointAtPhotographer(target: Vector3, force = false) {
      if (!pointAction.pointAtPhotographer(target, force)) return false;
      heldPosition = rina.root.position.clone();
      return true;
    },
    update(dt: number, music: MusicPlaybackState | null) {
      const validTrack = music?.track === RINA_CONCERT_SONG.track;
      const time = validTrack ? music.currentTime : 0;
      let progress = 0;
      let movement: "approach" | "return" | null = null;
      let returnProgress = 0;

      for (const chorus of RINA_CONCERT_SONG.choruses) {
        const approachStart = chorus.start - RINA_CONCERT_SONG.approachSeconds;
        const returnEnd = chorus.end + RINA_CONCERT_SONG.returnSeconds;
        if (time >= approachStart && time < chorus.start) {
          progress = smoothstep(
            (time - approachStart) / RINA_CONCERT_SONG.approachSeconds
          );
          movement = "approach";
          break;
        }
        if (time >= chorus.start && time < chorus.end) {
          progress = 1;
          break;
        }
        if (time >= chorus.end && time < returnEnd) {
          returnProgress = (time - chorus.end) / RINA_CONCERT_SONG.returnSeconds;
          progress = 1 - smoothstep(returnProgress);
          movement = "return";
          break;
        }
      }

      const timedX =
        stagePosition.x + (catwalkPosition.x - stagePosition.x) * progress;
      const timedZ = stagePosition.z +
        (catwalkPosition.z - stagePosition.z) * progress;
      if (heldPosition) {
        if (!pointAction.active) {
          const dx = timedX - heldPosition.x;
          const dz = timedZ - heldPosition.z;
          const distance = Math.hypot(dx, dz);
          if (distance < 0.04) {
            heldPosition = null;
          } else {
            const step = Math.min(distance, Math.max(0, dt) * 3.2);
            heldPosition.x += dx / distance * step;
            heldPosition.z += dz / distance * step;
          }
        }
      }
      rina.root.position.set(heldPosition?.x ?? timedX,
        stagePosition.y, heldPosition?.z ?? timedZ);
      // Face the audience when singing. Turn toward the stage for the return
      // walk, then face the audience again before the next verse.
      const recovering = !pointAction.active && heldPosition !== null;
      const baseYaw = recovering &&
        Math.hypot(timedX - rina.root.position.x, timedZ - rina.root.position.z) > 0.3
        ? Math.atan2(timedX - rina.root.position.x,
            timedZ - rina.root.position.z)
        : movement === "return"
        ? Math.PI * (1 - smoothstep(returnProgress / 0.13) +
            smoothstep((returnProgress - 0.87) / 0.13))
        : Math.PI;
      rina.root.rotation.y = baseYaw;
      pointAction.update(dt, baseYaw);

      if (!pointAction.active && ((movement && music?.playing) || recovering)) {
        rina.animations.playWalkAndSing();
      } else if (rina.animations.current !== "sing") {
        rina.animations.play("sing", {
          loop: true,
          blendingSpeed: 0.1,
          speedRatio: 0.96,
        });
      }

      const singing = validTrack && music.playing;
      const vocalEnergy = singing
        ? clamp01((music.voice - 0.13) * 1.55)
        : 0;
      const syllable = singing
        ? 0.45 + 0.3 * Math.sin(time * 13.4) +
          0.25 * Math.sin(time * 8.2 + 1.1)
        : 0;
      const vowel = 0.5 + 0.5 * Math.sin(time * 5.9 + 0.7);
      const openTarget = clamp01(vocalEnergy * (0.18 + syllable * 0.68));
      const oTarget = clamp01(vocalEnergy * vowel * 0.32);
      const wideTarget = clamp01(vocalEnergy * (1 - vowel) * 0.38);
      const follow = Math.min(1, dt * (singing ? 15 : 9));
      mouthOpen += (openTarget - mouthOpen) * follow;
      mouthO += (oTarget - mouthO) * follow;
      mouthWide += (wideTarget - mouthWide) * follow;
      rina.face.setWeights({
        Mouth_Open: mouthOpen,
        Mouth_O: mouthO,
        Mouth_Wide: mouthWide,
      });
    },
  };
}
