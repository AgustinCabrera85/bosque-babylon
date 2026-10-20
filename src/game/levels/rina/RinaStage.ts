import { Color3, Color4 } from "@babylonjs/core/Maths/math.color";
import { Vector3, Quaternion } from "@babylonjs/core/Maths/math.vector";
import { Engine } from "@babylonjs/core/Engines/engine";
import { StandardMaterial } from "@babylonjs/core/Materials/standardMaterial";
import { DynamicTexture } from "@babylonjs/core/Materials/Textures/dynamicTexture";
import { MeshBuilder } from "@babylonjs/core/Meshes/meshBuilder";
import type { AbstractMesh } from "@babylonjs/core/Meshes/abstractMesh";
import type { Mesh } from "@babylonjs/core/Meshes/mesh";
import { PointLight } from "@babylonjs/core/Lights/pointLight";
import { SpotLight } from "@babylonjs/core/Lights/spotLight";
import { ParticleSystem } from "@babylonjs/core/Particles/particleSystem";
import type { RenderTargetTexture } from "@babylonjs/core/Materials/Textures/renderTargetTexture";
import type { Scene } from "@babylonjs/core/scene";
import type { MusicPlaybackState } from "../../MusicPlayer";
import { RINA_CONCERT_SONG } from "./RinaConcertConfig";
import { RINA_LEVEL_QUALITY, RINA_STADIUM, RINA_STADIUM_SCALE } from "./RinaLevelConfig";

function material(
  scene: Scene,
  name: string,
  diffuse: Color3,
  emissive = Color3.Black()
) {
  const result = new StandardMaterial(name, scene);
  result.diffuseColor = diffuse;
  result.emissiveColor = emissive;
  result.specularColor = Color3.Black();
  return result;
}

export function createRinaStage(
  scene: Scene,
  performanceTier: "desktop" | "mobile"
) {
  const quality = RINA_LEVEL_QUALITY[performanceTier];
  const stageMaterial = material(
    scene,
    "rinaStageBlack",
    new Color3(0.055, 0.06, 0.074)
  );
  const trussMaterial = material(
    scene,
    "rinaStageTruss",
    new Color3(0.11, 0.115, 0.13)
  );
  const pinkLed = material(
    scene,
    "rinaStagePinkLed",
    new Color3(0.08, 0.01, 0.08),
    new Color3(0.82, 0.045, 0.67)
  );
  const cyanLed = material(
    scene,
    "rinaStageCyanLed",
    new Color3(0.01, 0.045, 0.07),
    new Color3(0.05, 0.52, 0.88)
  );
  const pinkScreen = material(
    scene,
    "rinaStagePinkScreen",
    new Color3(0.025, 0.004, 0.025),
    new Color3(0.5, 0.025, 0.4)
  );
  const cyanScreen = material(
    scene,
    "rinaStageCyanScreen",
    new Color3(0.004, 0.02, 0.025),
    new Color3(0.03, 0.32, 0.52)
  );
  const singerScreen = material(
    scene,
    "rinaSingerLiveScreen",
    Color3.Black()
  );
  singerScreen.disableLighting = true;
  const fireMaterial = material(
    scene,
    "rinaPyroFire",
    new Color3(0.9, 0.24, 0.02),
    new Color3(1.25, 0.2, 0.01)
  );

  const deck = MeshBuilder.CreateBox(
    "rinaMainStage",
    {
      width: RINA_STADIUM.stage.width,
      depth: RINA_STADIUM.stage.depth,
      height: RINA_STADIUM.stage.height,
    },
    scene
  );
  deck.position.set(
    0,
    RINA_STADIUM.stage.height / 2,
    RINA_STADIUM.stage.centerZ
  );
  deck.material = stageMaterial;

  const catwalk = MeshBuilder.CreateBox(
    "rinaStageCatwalk",
    {
      width: RINA_STADIUM.stage.catwalk.width,
      depth: RINA_STADIUM.stage.catwalk.depth,
      height: RINA_STADIUM.stage.catwalk.height,
    },
    scene
  );
  catwalk.position.set(
    0,
    RINA_STADIUM.stage.height - RINA_STADIUM.stage.catwalk.height / 2,
    RINA_STADIUM.stage.catwalk.centerZ
  );
  catwalk.material = stageMaterial;

  const screenWidth = 17;
  const screenHeight = 12.5;
  for (const side of [-1, 1]) {
    const screen = MeshBuilder.CreateBox(
      `rinaStageScreen_${side}`,
      { width: screenWidth, height: screenHeight, depth: 0.5 },
      scene
    );
    screen.position.set(
      side * 20,
      RINA_STADIUM.stage.height + screenHeight / 2 + 1.1,
      RINA_STADIUM.stage.centerZ + 6.5
    );
    screen.material = side < 0 ? pinkScreen : cyanScreen;
    const picture = MeshBuilder.CreateBox(
      `rinaStageSingerScreen_${side}`,
      {
        width: screenWidth - 0.8,
        height: screenHeight - 0.8,
        depth: 0.025,
      },
      scene
    );
    picture.position.copyFrom(screen.position);
    picture.position.z -= 0.29;
    picture.material = singerScreen;
    picture.isPickable = false;
  }

  const centerTower = MeshBuilder.CreateBox(
    "rinaStageCenterTower",
    { width: 8, height: 16, depth: 1.5 },
    scene
  );
  centerTower.position.set(
    0,
    RINA_STADIUM.stage.height + 8,
    RINA_STADIUM.stage.centerZ + 7.1
  );
  centerTower.material = stageMaterial;

  for (let strip = -2; strip <= 2; strip += 1) {
    const led = MeshBuilder.CreateBox(
      `rinaStageCenterLed_${strip}`,
      { width: 0.55, height: 13.5, depth: 0.24 },
      scene
    );
    led.position.set(
      strip * 1.2,
      RINA_STADIUM.stage.height + 8,
      RINA_STADIUM.stage.centerZ + 6.25
    );
    led.material = strip % 2 === 0 ? pinkLed : cyanLed;
  }

  const trussY = 17.2;
  const truss = MeshBuilder.CreateBox(
    "rinaStageUpperTruss",
    {
      width: RINA_STADIUM.stage.width + 4,
      height: 0.7,
      depth: 0.7,
    },
    scene
  );
  truss.position.set(0, trussY, RINA_STADIUM.stage.centerZ + 3.7);
  truss.material = trussMaterial;

  for (const side of [-1, 1]) {
    const tower = MeshBuilder.CreateBox(
      `rinaStageTower_${side}`,
      { width: 0.8, height: 17, depth: 0.8 },
      scene
    );
    tower.position.set(
      side * (RINA_STADIUM.stage.width / 2 + 1.1),
      8.5,
      RINA_STADIUM.stage.centerZ + 3.7
    );
    tower.material = trussMaterial;
  }

  // Emissive fixture bodies give the stage visual density without requiring
  // dozens of realtime Babylon lights.
  for (let index = 0; index < 12; index += 1) {
    const t = index / 11;
    const fixture = MeshBuilder.CreateBox(
      `rinaStageFixture_${index}`,
      { width: 1.05, height: 0.42, depth: 0.6 },
      scene
    );
    fixture.position.set(
      -27 + t * 54,
      trussY - 0.55,
      RINA_STADIUM.stage.centerZ + 3.15
    );
    fixture.material = index % 2 === 0 ? pinkLed : cyanLed;
  }

  // A shared opacity ramp lets the shafts dissolve into the haze instead of
  // ending in a bright, flat polygon over the audience and side screens.
  const beamFade = new DynamicTexture(
    "rinaSpotBeamFade", { width: 4, height: 128 }, scene, false
  );
  const beamFadeContext = beamFade.getContext();
  const beamFadePixels = beamFadeContext.getImageData(0, 0, 4, 128);
  for (let row = 0; row < 128; row += 1) {
    const along = row / 127;
    const near = Math.min(1, along / 0.12);
    const far = Math.min(1, (1 - along) / 0.38);
    const haze = 0.84 + 0.1 * Math.sin(row * 0.31) +
      0.06 * Math.sin(row * 0.79);
    const opacity = Math.max(0, near * near * far * far * haze);
    for (let column = 0; column < 4; column += 1) {
      const pixel = (row * 4 + column) * 4;
      beamFadePixels.data[pixel] = 255;
      beamFadePixels.data[pixel + 1] = 255;
      beamFadePixels.data[pixel + 2] = 255;
      beamFadePixels.data[pixel + 3] = Math.round(opacity * 255);
    }
  }
  beamFadeContext.putImageData(beamFadePixels, 0, 0);
  beamFade.hasAlpha = true;
  beamFade.update(false);

  const spotlights: SpotLight[] = [];
  const beamMeshes: Mesh[][] = [];
  const beamMaterials: StandardMaterial[][] = [];
  for (let index = 0; index < quality.movingSpotlights; index += 1) {
    const t = index / (quality.movingSpotlights - 1);
    const x = -24 + t * 48;
    const position = new Vector3(
      x,
      trussY - 0.55,
      RINA_STADIUM.stage.centerZ + 3.1
    );
    const light = new SpotLight(
      `rinaMovingSpot_${index}`,
      position,
      new Vector3(0, -0.35, -1),
      index % 2 === 0 ? Math.PI / 12 : Math.PI / 10,
      10,
      scene
    );
    light.diffuse =
      index % 4 === 0 || index % 4 === 3
        ? new Color3(0.94, 0.08, 0.72)
        : new Color3(0.08, 0.62, 1);
    light.specular = Color3.Black();
    light.intensity = performanceTier === "mobile" ? 10 : 14;
    light.range = 145;
    // The crowd-facing pair must reach the player's materials even when the
    // stage wash and screen lights are also active.
    light.renderPriority = index % 2 === 0 ? 1 : 3;
    spotlights.push(light);

    // Nested, faint shells approximate the radial falloff of light in smoke.
    // Their widths follow the real spotlight's spread as the shaft length changes.
    const layers: Mesh[] = [];
    const materials: StandardMaterial[] = [];
    const beamWidths = [5.2, 3.8, 2.4, 1.1];
    for (let layer = 0; layer < beamWidths.length; layer += 1) {
      const beamMaterial = material(
        scene,
        `rinaSpotBeamMaterial_${index}_${layer}`,
        Color3.Black(),
        light.diffuse.scale(0.72 + layer * 0.04)
      );
      beamMaterial.disableLighting = true;
      beamMaterial.backFaceCulling = false;
      beamMaterial.disableDepthWrite = true;
      beamMaterial.fogEnabled = false;
      beamMaterial.alphaMode = Engine.ALPHA_ADD;
      beamMaterial.opacityTexture = beamFade;
      beamMaterial.alpha = 0.03;
      const beam = MeshBuilder.CreateCylinder(
        layer === 0 ? `rinaSpotBeam_${index}` : `rinaSpotBeamCore_${index}_${layer}`,
        {
          height: 1,
          diameterTop: beamWidths[layer],
          diameterBottom: 0.08,
          tessellation: 32,
          subdivisions: 12,
          cap: 0,
        },
        scene
      );
      beam.material = beamMaterial;
      beam.isPickable = false;
      beam.checkCollisions = false;
      layers.push(beam);
      materials.push(beamMaterial);
    }
    beamMeshes.push(layers);
    beamMaterials.push(materials);
  }

  // The stage-facing spots hit the front of the player model. A small bounce
  // reveals its silhouette from the gameplay camera only while a crowd spot
  // actually crosses the character.
  const playerSpotBounce = new PointLight(
    "rinaPlayerSpotBounce", new Vector3(0, 4, 0), scene
  );
  playerSpotBounce.diffuse = new Color3(0.08, 0.62, 1);
  playerSpotBounce.specular = Color3.Black();
  playerSpotBounce.intensity = 0;
  playerSpotBounce.range = 8;
  playerSpotBounce.renderPriority = 4;
  playerSpotBounce.setEnabled(false);
  const playerBounceFill = new Color3(0.38, 0.38, 0.38);

  const audienceSpill = new SpotLight(
    "rinaAudienceSpill",
    new Vector3(0, trussY - 0.6, RINA_STADIUM.stage.centerZ + 3),
    new Vector3(0, -0.16, -1),
    Math.PI / 3,
    5,
    scene
  );
  audienceSpill.diffuse = new Color3(0.27, 0.46, 0.66);
  audienceSpill.specular = Color3.Black();
  audienceSpill.intensity = performanceTier === "mobile" ? 30 : 45;
  audienceSpill.range = 170;
  audienceSpill.renderPriority = 2;

  const screenLights = [-1, 1].map((side) => {
    const light = new PointLight(
      `rinaScreenLight_${side}`,
      new Vector3(side * 20, RINA_STADIUM.stage.height + 7, RINA_STADIUM.stage.centerZ + 5.8),
      scene
    );
    light.diffuse = side < 0
      ? new Color3(0.85, 0.05, 0.62)
      : new Color3(0.05, 0.58, 0.92);
    light.specular = Color3.Black();
    light.intensity = 0;
    light.range = 27;
    light.renderPriority = 2;
    return light;
  });

  const stageWash = new PointLight(
    "rinaStageWash",
    new Vector3(0, 10, RINA_STADIUM.stage.centerZ + 2),
    scene
  );
  stageWash.diffuse = new Color3(0.62, 0.08, 0.52);
  stageWash.specular = Color3.Black();
  stageWash.intensity = performanceTier === "mobile" ? 24 : 35;
  stageWash.range = 54;
  stageWash.renderPriority = 2;

  const rinaKeyLight = new PointLight(
    "rinaRinaKeyLight",
    new Vector3(0, RINA_STADIUM.stage.height + 1.8, RINA_STADIUM.stage.rinaZ - 3),
    scene
  );
  rinaKeyLight.diffuse = new Color3(0.94, 0.84, 0.76);
  rinaKeyLight.specular = new Color3(0.04, 0.04, 0.04);
  rinaKeyLight.intensity = performanceTier === "mobile" ? 20 : 24;
  rinaKeyLight.range = 26;
  rinaKeyLight.renderPriority = 3;

  const pyroLights = [
    new PointLight(
      "rinaPyroLightLeft",
      new Vector3(-17, 5, RINA_STADIUM.stage.frontZ + 1),
      scene
    ),
    new PointLight(
      "rinaPyroLightRight",
      new Vector3(17, 5, RINA_STADIUM.stage.frontZ + 1),
      scene
    ),
  ];
  for (const light of pyroLights) {
    light.diffuse = new Color3(1, 0.2, 0.025);
    light.intensity = 0;
    light.range = 22;
    light.renderPriority = 4;
    light.setEnabled(false);
  }

  const smokeTexture = new DynamicTexture(
    "rinaStageSmokeTexture", { width: 64, height: 64 }, scene, false
  );
  const smokeContext = smokeTexture.getContext();
  const smokeGradient = smokeContext.createRadialGradient(32, 32, 3, 32, 32, 31);
  smokeGradient.addColorStop(0, "rgba(255,255,255,0.72)");
  smokeGradient.addColorStop(0.45, "rgba(225,235,255,0.34)");
  smokeGradient.addColorStop(1, "rgba(180,210,255,0)");
  smokeContext.fillStyle = smokeGradient;
  smokeContext.fillRect(0, 0, 64, 64);
  smokeTexture.hasAlpha = true;
  smokeTexture.update(false);

  const smokeEmitter = MeshBuilder.CreateBox(
    "rinaStageSmokeEmitter", { size: 0.01 }, scene
  );
  smokeEmitter.position.set(
    0, RINA_STADIUM.stage.height + 0.2, RINA_STADIUM.stage.frontZ + 4
  );
  smokeEmitter.isVisible = false;
  smokeEmitter.isPickable = false;
  const smoke = new ParticleSystem(
    "rinaStageSmoke", performanceTier === "mobile" ? 75 : 175, scene
  );
  smoke.particleTexture = smokeTexture;
  smoke.emitter = smokeEmitter;
  smoke.minEmitBox = new Vector3(-22, 0, -3);
  smoke.maxEmitBox = new Vector3(22, 1.5, 3);
  smoke.direction1 = new Vector3(-0.12, 0.08, -0.1);
  smoke.direction2 = new Vector3(0.12, 0.24, 0.1);
  smoke.minEmitPower = 0.08;
  smoke.maxEmitPower = 0.25;
  smoke.minLifeTime = 3;
  smoke.maxLifeTime = 5;
  smoke.emitRate = performanceTier === "mobile" ? 15 : 38;
  smoke.minSize = performanceTier === "mobile" ? 3 : 4.4;
  smoke.maxSize = performanceTier === "mobile" ? 6 : 8.5;
  smoke.minAngularSpeed = -0.18;
  smoke.maxAngularSpeed = 0.18;
  smoke.gravity = new Vector3(0, 0.035, 0);
  smoke.color1 = new Color4(0.6, 0.82, 1, 0.48);
  smoke.color2 = new Color4(1, 0.58, 0.86, 0.4);
  smoke.colorDead = new Color4(0.2, 0.25, 0.42, 0);
  smoke.blendMode = ParticleSystem.BLENDMODE_STANDARD;
  smoke.applyFog = false;
  smoke.preWarmCycles = performanceTier === "mobile" ? 18 : 30;
  smoke.start();

  const pyroJets = Array.from(
    { length: quality.pyroJets },
    (_, index) => {
      const t = index / (quality.pyroJets - 1);
      const x = -24 + t * 48;
      const jet = MeshBuilder.CreateCylinder(
        `rinaPyroJet_${index}`,
        {
          height: 1,
          diameterTop: 0.05,
          diameterBottom: 1.25,
          tessellation: 12,
        },
        scene
      );
      jet.position.set(
        x,
        RINA_STADIUM.stage.height + 0.4,
        RINA_STADIUM.stage.frontZ + 1.2
      );
      jet.material = fireMaterial;
      jet.scaling.y = 0.02;
      jet.setEnabled(false);
      return jet;
    }
  );

  let elapsed = 0;
  let screenPulse = 0.22;
  let beatPulse = 0;
  let bassBaseline = 0;
  let energyBaseline = 0;
  let musicPresence = 0;
  let fireBurst = 0;
  let beatCooldown = 0;
  let lastChorus = -1;
  let liveFeed: RenderTargetTexture | null = null;
  const update = (
    dt: number,
    music: MusicPlaybackState | null,
    singerLocalZ: number,
    singerYaw: number,
    playerWorldPosition: Vector3
  ) => {
    elapsed += dt;

    const playing = music?.playing && music.track === RINA_CONCERT_SONG.track;
    const energy = playing ? music.energy : 0;
    const bass = playing ? music.bass : 0;
    bassBaseline += (bass - bassBaseline) * Math.min(1, dt * 2.2);
    energyBaseline += (energy - energyBaseline) * Math.min(1, dt * 2.6);
    const bassAttack = Math.max(0, bass - bassBaseline);
    const energyAttack = Math.max(0, energy - energyBaseline);
    const presenceTarget = playing
      ? Math.max(0, Math.min(1, (energy - 0.055) * 1.8 + bass * 0.12))
      : 0;
    musicPresence += (presenceTarget - musicPresence) *
      Math.min(1, dt * (presenceTarget > musicPresence ? 12 : 2.5));
    beatCooldown = Math.max(0, beatCooldown - dt);
    beatPulse = Math.max(0, beatPulse - dt * 3.8);
    const beatDetected = playing && beatCooldown === 0 &&
      ((bass > 0.38 && bassAttack > 0.045) ||
        (energy > 0.32 && energyAttack > 0.04));
    if (beatDetected) {
      beatPulse = 1;
      beatCooldown = 0.22;
    }

    const screenTarget = Math.min(1.75,
      0.08 + musicPresence * (0.35 + energy * 0.35) +
      beatPulse * (0.65 + musicPresence * 0.4)
    );
    screenPulse += (screenTarget - screenPulse) *
      Math.min(1, dt * (screenTarget > screenPulse ? 32 : 7));
    if (liveFeed) liveFeed.level = 1.08 + screenPulse * 0.28;
    pinkScreen.emissiveColor.copyFromFloats(
      0.65 * screenPulse, 0.03 * screenPulse, 0.55 * screenPulse
    );
    cyanScreen.emissiveColor.copyFromFloats(
      0.045 * screenPulse, 0.44 * screenPulse, 0.73 * screenPulse
    );
    const ledPulse = 0.12 + musicPresence * 0.44 +
      screenPulse * 0.2 + beatPulse * 0.28;
    pinkLed.emissiveColor.copyFromFloats(
      0.82 * ledPulse, 0.045 * ledPulse, 0.67 * ledPulse
    );
    cyanLed.emissiveColor.copyFromFloats(
      0.05 * ledPulse, 0.52 * ledPulse, 0.88 * ledPulse
    );
    for (const light of screenLights) {
      light.intensity = (performanceTier === "mobile" ? 5 : 8) *
        (0.1 + musicPresence * 0.65 + beatPulse * 0.6);
    }
    audienceSpill.intensity = (performanceTier === "mobile" ? 30 : 45) *
      (0.08 + musicPresence * 0.85 + beatPulse * 0.1);

    const playerLocalPosition = playerWorldPosition.scale(1 / RINA_STADIUM_SCALE);
    let playerSpotHit = 0;
    let playerSpotColor: Color3 | null = null;
    for (let index = 0; index < spotlights.length; index += 1) {
      const light = spotlights[index];
      const phase = elapsed * (0.34 + index * 0.04) + index * 0.85;
      const onStage = index % 2 === 0;
      const target = new Vector3(
        onStage
          ? light.position.x * 0.58 + Math.sin(phase) * 6
          : Math.sin(phase) * 20,
        onStage ? RINA_STADIUM.stage.height + 0.6 : 0,
        onStage
          ? RINA_STADIUM.stage.centerZ - 5 + Math.cos(phase * 0.7) * 4
          : RINA_STADIUM.stage.frontZ - 27 + Math.cos(phase * 0.7) * 23
      );
      const offset = target.subtract(light.position);
      const distance = offset.length();
      const direction = offset.scale(1 / distance);
      light.direction.copyFrom(direction);
      light.intensity = onStage
        ? (performanceTier === "mobile" ? 10 : 14) *
          (0.1 + musicPresence * 0.7 + beatPulse * 0.55)
        : (performanceTier === "mobile" ? 22 : 32) *
          (0.025 + musicPresence * 0.35 + beatPulse * 1.15);

      if (!onStage) {
        const toPlayer = playerLocalPosition.subtract(light.position);
        const along = Vector3.Dot(toPlayer, direction);
        if (along > 0) {
          const across = Math.sqrt(Math.max(0,
            toPlayer.lengthSquared() - along * along
          ));
          const radius = along * Math.tan(light.angle * 0.5);
          const hit = Math.max(0, 1 - across / Math.max(1, radius));
          if (hit > playerSpotHit) {
            playerSpotHit = hit;
            playerSpotColor = light.diffuse;
          }
        }
      }

      const axis = Vector3.Cross(Vector3.Up(), direction).normalize();
      const angle = Math.acos(Math.max(-1, Math.min(1,
        Vector3.Dot(Vector3.Up(), direction)
      )));
      const visibleLength = Math.min(distance, onStage ? 24 : 19 + beatPulse * 13);
      const beamMidpoint = light.position.add(direction.scale(visibleLength * 0.5));
      const beamWidthScale = visibleLength / 20;
      for (let layer = 0; layer < beamMeshes[index].length; layer += 1) {
        const beam = beamMeshes[index][layer];
        beam.position.copyFrom(beamMidpoint);
        beam.scaling.set(beamWidthScale, visibleLength, beamWidthScale);
        beam.rotationQuaternion = Quaternion.RotationAxis(axis, angle);
        beamMaterials[index][layer].alpha = (0.06 + layer * 0.018) *
          (0.18 + musicPresence * 0.82 + beatPulse * (onStage ? 0.55 : 1.1));
      }
    }
    playerSpotBounce.position.set(
      playerLocalPosition.x + 0.7,
      playerLocalPosition.y + 2,
      playerLocalPosition.z - 1.3
    );
    if (playerSpotColor) {
      playerSpotBounce.diffuse.copyFrom(playerSpotColor)
        .scaleInPlace(0.62).addInPlace(playerBounceFill);
    }
    playerSpotBounce.intensity = (performanceTier === "mobile" ? 26 : 38) *
      playerSpotHit * playerSpotHit *
      (musicPresence * 0.35 + beatPulse * 0.9);

    const chorus = playing
      ? RINA_CONCERT_SONG.choruses.findIndex(
          ({ start, end }) => music.currentTime >= start && music.currentTime < end
        )
      : -1;
    if (chorus >= 0 && chorus !== lastChorus) fireBurst = 1;
    lastChorus = chorus;
    if (chorus >= 0 && beatDetected) {
      fireBurst = Math.max(fireBurst, 0.82);
    }
    fireBurst = Math.max(0, fireBurst - dt * 1.65);
    const firePulse = chorus >= 0
      ? Math.min(1, Math.max(fireBurst, (0.05 + bass * 0.27) * musicPresence))
      : 0;

    for (let index = 0; index < pyroJets.length; index += 1) {
      const jet = pyroJets[index];
      const localPulse = Math.max(
        0,
        firePulse -
          Math.abs(
            (index / Math.max(1, pyroJets.length - 1) - 0.5) * 0.18
          )
      );
      jet.setEnabled(localPulse > 0.03);
      const height = 0.3 + localPulse * 6.8;
      jet.scaling.y = height;
      jet.position.y =
        RINA_STADIUM.stage.height + 0.18 + height * 0.5;
    }

    for (const light of pyroLights) {
      light.setEnabled(firePulse > 0.03);
      light.intensity = firePulse * 18;
    }
    stageWash.intensity =
      (performanceTier === "mobile" ? 24 : 35) *
      (0.1 + musicPresence * 0.7 + beatPulse * 0.45);
    rinaKeyLight.position.x = Math.sin(singerYaw) * 3;
    rinaKeyLight.position.z = singerLocalZ + Math.cos(singerYaw) * 3;
    rinaKeyLight.intensity =
      (performanceTier === "mobile" ? 20 : 24) *
      (0.14 + musicPresence * 0.75 + beatPulse * 0.18);
    return beatPulse;
  };

  return {
    rinaPosition: new Vector3(
      RINA_STADIUM.stage.rinaX,
      RINA_STADIUM.stage.height,
      RINA_STADIUM.stage.rinaZ
    ),
    catwalkSingerPosition: new Vector3(
      RINA_STADIUM.stage.rinaX,
      RINA_STADIUM.stage.height,
      RINA_STADIUM.stage.catwalk.singerZ
    ),
    setLiveFeed(feed: RenderTargetTexture) {
      liveFeed = feed;
      singerScreen.emissiveTexture = feed;
    },
    setPlayerLightMeshes(meshes: AbstractMesh[]) {
      playerSpotBounce.includedOnlyMeshes = meshes;
      playerSpotBounce.setEnabled(meshes.length > 0);
    },
    singerLight: rinaKeyLight,
    update,
  };
}
