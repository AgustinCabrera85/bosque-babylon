import { Engine } from "@babylonjs/core/Engines/engine";
import { Material } from "@babylonjs/core/Materials/material";
import { ShaderMaterial } from "@babylonjs/core/Materials/shaderMaterial";
import { StandardMaterial } from "@babylonjs/core/Materials/standardMaterial";
import "@babylonjs/core/Materials/Textures/Procedurals/noiseProceduralTexture";
import { Color3, Color4 } from "@babylonjs/core/Maths/math.color";
import { Vector3 } from "@babylonjs/core/Maths/math.vector";
import { Mesh } from "@babylonjs/core/Meshes/mesh";
import { MeshBuilder } from "@babylonjs/core/Meshes/meshBuilder";
import { TransformNode } from "@babylonjs/core/Meshes/transformNode";
import type { Particle } from "@babylonjs/core/Particles/particle";
import { ParticleHelper } from "@babylonjs/core/Particles/particleHelper";
import { ParticleSystem } from "@babylonjs/core/Particles/particleSystem";
import type { ParticleSystemSet } from "@babylonjs/core/Particles/particleSystemSet";
import type { Scene } from "@babylonjs/core/scene";
import type {
  BlackSmokeWrapEffect,
  BlackSmokeWrapSystem,
} from "../BlackSmokeWrapSystem";

const TAU = Math.PI * 2;

const VOID_VERTEX_SHADER = `
precision highp float;

attribute vec3 position;
attribute vec2 uv;

uniform mat4 worldViewProjection;

varying vec2 vUV;

void main(void) {
  vUV = uv;
  gl_Position = worldViewProjection * vec4(position, 1.0);
}
`;

const VOID_FRAGMENT_SHADER = `
precision highp float;

uniform float time;
uniform float strength;

varying vec2 vUV;

float hash21(vec2 p) {
  p = fract(p * vec2(123.34, 456.21));
  p += dot(p, p + 45.32);
  return fract(p.x * p.y);
}

float valueNoise(vec2 p) {
  vec2 cell = floor(p);
  vec2 local = fract(p);
  local = local * local * (3.0 - 2.0 * local);
  float a = hash21(cell);
  float b = hash21(cell + vec2(1.0, 0.0));
  float c = hash21(cell + vec2(0.0, 1.0));
  float d = hash21(cell + vec2(1.0, 1.0));
  return mix(mix(a, b, local.x), mix(c, d, local.x), local.y);
}

void main(void) {
  vec2 p = (vUV - 0.5) * 2.0;
  float radius = length(p);
  float angle = atan(p.y, p.x);
  float inwardCurl = (1.0 - clamp(radius, 0.0, 1.0)) * 8.5;
  float stormAngle = angle * 6.0 - time * 4.2 + inwardCurl;
  float broadNoise = valueNoise(
    vec2(angle * 1.9 + time * 0.38, radius * 8.0 - time * 0.72)
  );
  float spiralA = 0.5 + 0.5 * sin(stormAngle + radius * 18.0);
  float spiralB = 0.5 + 0.5 * sin(-angle * 9.0 - time * 2.6 + radius * 29.0);
  float filaments = pow(spiralA, 4.0) * 0.7 + pow(spiralB, 7.0) * 0.36;
  filaments *= 0.58 + broadNoise * 0.62;

  float centralVoid = 1.0 - smoothstep(0.04, 0.48, radius);
  float middleStorm = smoothstep(0.12, 0.42, radius) *
    (1.0 - smoothstep(0.72, 1.0, radius));
  float innerRim = smoothstep(0.44, 0.72, radius) *
    (1.0 - smoothstep(0.82, 0.98, radius));
  float edgeFade = 1.0 - smoothstep(0.78, 1.0, radius);
  float pulse = 0.88 + sin(time * 3.4 + radius * 11.0) * 0.12;

  vec3 color = vec3(0.0015, 0.00015, 0.00025);
  color += vec3(0.12, 0.0015, 0.0005) * middleStorm * filaments * pulse;
  color += vec3(0.34, 0.006, 0.0015) * innerRim *
    (0.28 + filaments * 0.72) * pulse;
  color *= 1.0 - centralVoid * 0.78;
  color *= 0.3 + strength * 0.7;
  color *= 0.34 + edgeFade * 0.66;

  gl_FragColor = vec4(color, 1.0);
}
`;

type LightningArc = {
  mesh: Mesh;
  phase: number;
  pulseSpeed: number;
  rotationSpeed: number;
  intensity: number;
};

type BorderSmokeParticleState = {
  angle: number;
  spinDirection: number;
};

export class SkyEyeDefeatPortalVortex {
  private readonly opacityDisc: Mesh;
  private readonly opacityMaterial: StandardMaterial;
  private readonly voidDisc: Mesh;
  private readonly voidMaterial: ShaderMaterial;
  private readonly lightningRoot: TransformNode;
  private readonly lightningMaterial: StandardMaterial;
  private readonly lightningArcs: LightningArc[];
  private readonly volumeSmoke: BlackSmokeWrapEffect;
  private readonly borderSmokeAnchor: Mesh;
  private readonly borderSmokePosition = Vector3.Zero();
  private readonly borderSmokeDirection = Vector3.Zero();
  private borderSmokeSet: ParticleSystemSet | null = null;
  private borderSmoke: ParticleSystem | null = null;
  private borderSmokeBaseEmitRate = 0;
  private borderSmokeRevealScale = 0.08;
  private enabled = false;
  private disposed = false;

  public constructor(
    scene: Scene,
    portalRoot: TransformNode,
    smokeSystem: BlackSmokeWrapSystem,
    diameter: number,
    quality: "low" | "high"
  ) {
    this.opacityMaterial = new StandardMaterial(
      "skyEyeDefeatPortalOpacityMaterial",
      scene
    );
    this.opacityMaterial.diffuseColor = new Color3(0.0015, 0, 0);
    this.opacityMaterial.emissiveColor = new Color3(0.003, 0.0001, 0.0001);
    this.opacityMaterial.specularColor = Color3.Black();
    this.opacityMaterial.disableLighting = true;
    this.opacityMaterial.alpha = 1;
    this.opacityMaterial.alphaMode = Engine.ALPHA_DISABLE;
    this.opacityMaterial.transparencyMode = Material.MATERIAL_OPAQUE;
    this.opacityMaterial.backFaceCulling = false;
    this.opacityMaterial.disableDepthWrite = false;
    this.opacityMaterial.forceDepthWrite = true;

    this.opacityDisc = MeshBuilder.CreateDisc(
      "skyEyeDefeatPortalOpacityDisc",
      {
        radius: diameter * 0.475,
        tessellation: quality === "high" ? 72 : 44,
        sideOrientation: Mesh.DOUBLESIDE,
      },
      scene
    );
    this.opacityDisc.parent = portalRoot;
    this.opacityDisc.position.x = -0.42;
    this.opacityDisc.rotation.y = Math.PI * 0.5;
    this.opacityDisc.material = this.opacityMaterial;
    this.opacityDisc.isPickable = false;
    this.opacityDisc.alwaysSelectAsActiveMesh = true;
    this.opacityDisc.applyFog = false;
    this.opacityDisc.renderingGroupId = 0;
    this.opacityDisc.setEnabled(false);

    this.voidMaterial = new ShaderMaterial(
      "skyEyeDefeatPortalVoidMaterial",
      scene,
      {
        vertexSource: VOID_VERTEX_SHADER,
        fragmentSource: VOID_FRAGMENT_SHADER,
      },
      {
        attributes: ["position", "uv"],
        uniforms: ["worldViewProjection", "time", "strength"],
        needAlphaBlending: false,
      }
    );
    this.voidMaterial.alphaMode = Engine.ALPHA_DISABLE;
    this.voidMaterial.transparencyMode = Material.MATERIAL_OPAQUE;
    this.voidMaterial.backFaceCulling = false;
    this.voidMaterial.disableDepthWrite = false;
    this.voidMaterial.forceDepthWrite = true;
    this.voidMaterial.setFloat("time", 0);
    this.voidMaterial.setFloat("strength", 0);

    this.voidDisc = MeshBuilder.CreateDisc(
      "skyEyeDefeatPortalVoidDisc",
      {
        radius: diameter * 0.455,
        tessellation: quality === "high" ? 72 : 44,
        sideOrientation: Mesh.DOUBLESIDE,
      },
      scene
    );
    this.voidDisc.parent = portalRoot;
    this.voidDisc.position.x = -0.24;
    this.voidDisc.rotation.y = Math.PI * 0.5;
    this.voidDisc.material = this.voidMaterial;
    this.voidDisc.isPickable = false;
    this.voidDisc.alwaysSelectAsActiveMesh = true;
    this.voidDisc.applyFog = false;
    this.voidDisc.renderingGroupId = 0;
    this.voidDisc.setEnabled(false);

    this.lightningMaterial = new StandardMaterial(
      "skyEyeDefeatPortalLightningMaterial",
      scene
    );
    this.lightningMaterial.diffuseColor = new Color3(0.012, 0, 0);
    this.lightningMaterial.emissiveColor = new Color3(0.82, 0.009, 0.002);
    this.lightningMaterial.specularColor = Color3.Black();
    this.lightningMaterial.disableLighting = true;
    this.lightningMaterial.backFaceCulling = false;
    this.lightningMaterial.disableDepthWrite = true;
    this.lightningMaterial.alpha = 0;
    this.lightningMaterial.alphaMode = Engine.ALPHA_ADD;
    this.lightningMaterial.transparencyMode = Material.MATERIAL_ALPHABLEND;

    this.lightningRoot = new TransformNode(
      "skyEyeDefeatPortalLightningRoot",
      scene
    );
    this.lightningRoot.parent = portalRoot;
    this.lightningRoot.position.x = 0.82;
    this.lightningRoot.setEnabled(false);
    this.lightningArcs = this.createLightningArcs(
      scene,
      diameter,
      quality === "high" ? 7 : 5
    );

    this.borderSmokeAnchor = new Mesh(
      "skyEyeDefeatPortalBorderSmokeAnchor",
      scene
    );
    this.borderSmokeAnchor.parent = portalRoot;
    this.borderSmokeAnchor.position.x = 0.64;
    this.borderSmokeAnchor.isVisible = false;
    this.borderSmokeAnchor.isPickable = false;
    this.borderSmokeAnchor.alwaysSelectAsActiveMesh = true;
    if (typeof XMLHttpRequest !== "undefined") {
      void this.prepareBorderSmoke(scene, diameter, quality);
    }

    this.volumeSmoke = smokeSystem.attach(portalRoot, {
      name: "skyEyeDefeatPortalVolumeSmoke",
      quality: quality === "high" ? "high" : "medium",
      offset: new Vector3(0.34, 0, 0),
      axis: Vector3.Right(),
      radiusX: diameter * 0.5,
      radiusZ: diameter * 0.46,
      innerRadiusRatio: 0.5,
      height: diameter * 0.28,
      particleSize: diameter * 0.2,
      elongation: 1.45,
      orbitSpeed: -2.85,
      radialTurbulence: 0.27,
      orbitTurbulence: 0.52,
      churnSpeed: 3.2,
      upwardDrift: 0.04,
      density: 1.75,
      opacity: 0.5,
      color: new Color3(0.055, 0.008, 0.009),
      renderingGroupId: 1,
      applyFog: false,
      enabled: false,
    });
  }

  public update(elapsedSeconds: number, portalProgress: number) {
    if (this.disposed) return;
    const progress = Math.max(0, Math.min(1, portalProgress));
    const visible = progress > 0.001;
    if (visible !== this.enabled) {
      this.enabled = visible;
      this.opacityDisc.setEnabled(visible);
      this.voidDisc.setEnabled(visible);
      this.lightningRoot.setEnabled(visible);
      this.volumeSmoke.setEnabled(visible);
      if (visible) {
        this.borderSmoke?.start();
      } else if (this.borderSmoke) {
        this.borderSmoke.stop();
        this.borderSmoke.reset();
      }
    }
    if (!visible) return;

    const revealScale = 0.08 + progress * 0.92;
    this.borderSmokeRevealScale = revealScale;
    const stormPulse = 0.94 + Math.sin(elapsedSeconds * 4.1) * 0.035;
    this.opacityDisc.scaling.setAll(revealScale * 1.015);
    this.voidDisc.scaling.setAll(revealScale * stormPulse);
    this.voidDisc.rotation.x = elapsedSeconds * -0.72;
    this.voidMaterial.setFloat("time", elapsedSeconds);
    this.voidMaterial.setFloat("strength", progress);

    this.volumeSmoke.setEmissionMultiplier(0.62 + progress * 1.28);
    if (this.borderSmoke) {
      const borderPulse = 0.92 + Math.sin(elapsedSeconds * 3.7) * 0.08;
      this.borderSmoke.emitRate =
        this.borderSmokeBaseEmitRate *
        (0.24 + progress * 1.06) *
        borderPulse;
    }
    this.lightningRoot.scaling.setAll(revealScale);
    this.lightningRoot.rotation.x = elapsedSeconds * 2.35;
    this.lightningMaterial.alpha = progress * 0.72;

    for (const arc of this.lightningArcs) {
      const primary = Math.max(
        0,
        Math.sin(elapsedSeconds * arc.pulseSpeed + arc.phase)
      );
      const secondary = Math.max(
        0,
        Math.sin(elapsedSeconds * (arc.pulseSpeed * 0.43) - arc.phase * 1.7)
      );
      const flash = Math.pow(primary, 24) + Math.pow(secondary, 40) * 0.58;
      arc.mesh.visibility =
        progress * Math.min(1, flash * arc.intensity);
      arc.mesh.rotation.x = elapsedSeconds * arc.rotationSpeed;
    }
  }

  public reset() {
    if (this.disposed) return;
    this.enabled = false;
    this.opacityDisc.setEnabled(false);
    this.voidDisc.setEnabled(false);
    this.lightningRoot.setEnabled(false);
    this.volumeSmoke.setEnabled(false);
    if (this.borderSmoke) {
      this.borderSmoke.stop();
      this.borderSmoke.reset();
      this.borderSmoke.emitRate = 0;
    }
    this.borderSmokeRevealScale = 0.08;
    this.voidMaterial.setFloat("strength", 0);
    this.lightningMaterial.alpha = 0;
  }

  public dispose() {
    if (this.disposed) return;
    this.disposed = true;
    this.volumeSmoke.dispose();
    this.borderSmokeSet?.dispose();
    this.borderSmokeSet = null;
    this.borderSmoke = null;
    this.borderSmokeAnchor.dispose(false, false);
    this.opacityDisc.dispose(false, false);
    this.voidDisc.dispose(false, false);
    this.lightningRoot.dispose(false, false);
    this.opacityMaterial.dispose(false, false);
    this.voidMaterial.dispose(false, false);
    this.lightningMaterial.dispose(false, false);
    this.lightningArcs.length = 0;
  }

  private async prepareBorderSmoke(
    scene: Scene,
    diameter: number,
    quality: "low" | "high"
  ) {
    let smokeSet: ParticleSystemSet;
    try {
      smokeSet = await ParticleHelper.CreateAsync(
        "smoke",
        scene,
        false,
        quality === "high" ? 240 : 150
      );
    } catch (error) {
      console.warn(
        "Sky Eye defeat portal could not load Babylon's smoke preset.",
        error
      );
      return;
    }

    if (this.disposed) {
      smokeSet.dispose();
      return;
    }

    const smoke = smokeSet.systems[0];
    if (!(smoke instanceof ParticleSystem)) {
      smokeSet.dispose();
      return;
    }

    smoke.stop();
    smoke.reset();
    smoke.name = "skyEyeDefeatPortalBorderSmoke";
    smoke.id = smoke.name;
    smoke.emitter = this.borderSmokeAnchor;
    smoke.renderingGroupId = 0;
    smoke.applyFog = false;
    smoke.forceDepthWrite = false;
    smoke.disposeOnStop = false;
    smoke.isLocal = false;
    smoke.blendMode = ParticleSystem.BLENDMODE_STANDARD;
    smoke.minLifeTime = quality === "high" ? 2.45 : 2.15;
    smoke.maxLifeTime = quality === "high" ? 3.65 : 3.2;
    smoke.minEmitPower = 0.42;
    smoke.maxEmitPower = 0.72;
    smoke.minAngularSpeed = -0.58;
    smoke.maxAngularSpeed = 0.58;
    smoke.gravity.set(0, 0.025, 0);
    smoke.noiseStrength.set(0.16, 0.22, 0.22);
    smoke.preWarmCycles = quality === "high" ? 22 : 14;
    smoke.preWarmStepOffset = 1;
    this.borderSmokeBaseEmitRate = quality === "high" ? 58 : 38;
    smoke.emitRate = 0;

    for (const gradient of [0, 0.3, 0.7, 1]) {
      smoke.removeColorGradient(gradient);
    }
    smoke.addColorGradient(0, new Color4(0.12, 0.012, 0.016, 0));
    smoke.addColorGradient(
      0.14,
      new Color4(0.13, 0.018, 0.022, 0.44),
      new Color4(0.095, 0.008, 0.012, 0.52)
    );
    smoke.addColorGradient(
      0.58,
      new Color4(0.052, 0.004, 0.007, 0.46),
      new Color4(0.025, 0.001, 0.003, 0.34)
    );
    smoke.addColorGradient(1, new Color4(0.008, 0, 0.001, 0));

    smoke.removeSizeGradient(0);
    smoke.removeSizeGradient(1);
    smoke.addSizeGradient(0, diameter * 0.072, diameter * 0.092);
    smoke.addSizeGradient(0.48, diameter * 0.14, diameter * 0.18);
    smoke.addSizeGradient(1, diameter * 0.205, diameter * 0.245);

    smoke.startPositionFunction = (worldMatrix, position, particle) => {
      const angle = Math.random() * TAU;
      const radiusVariation = 0.93 + Math.random() * 0.12;
      const revealScale = this.borderSmokeRevealScale;
      particle.metadata = {
        angle,
        spinDirection: Math.random() < 0.2 ? -1 : 1,
      } satisfies BorderSmokeParticleState;
      this.borderSmokePosition.set(
        (Math.random() - 0.5) * diameter * 0.065,
        Math.cos(angle) * diameter * 0.49 * radiusVariation * revealScale,
        Math.sin(angle) * diameter * 0.455 * radiusVariation * revealScale
      );
      Vector3.TransformCoordinatesToRef(
        this.borderSmokePosition,
        worldMatrix,
        position
      );
    };
    smoke.startDirectionFunction = (worldMatrix, direction, particle) => {
      const state = particle.metadata as BorderSmokeParticleState | null;
      const angle = state?.angle ?? Math.random() * TAU;
      const spinDirection = state?.spinDirection ?? 1;
      const tangentialSpeed = (0.24 + Math.random() * 0.18) * spinDirection;
      const radialSpeed = 0.035 + Math.random() * 0.055;
      this.borderSmokeDirection.set(
        (Math.random() - 0.5) * 0.11,
        Math.cos(angle) * radialSpeed - Math.sin(angle) * tangentialSpeed,
        Math.sin(angle) * radialSpeed + Math.cos(angle) * tangentialSpeed
      );
      Vector3.TransformNormalToRef(
        this.borderSmokeDirection,
        worldMatrix,
        direction
      );
    };

    this.borderSmokeSet = smokeSet;
    this.borderSmoke = smoke;
    if (this.enabled) smoke.start();
  }

  private createLightningArcs(
    scene: Scene,
    diameter: number,
    count: number
  ) {
    const arcs: LightningArc[] = [];
    const pointCount = 12;
    for (let index = 0; index < count; index++) {
      const phase = (index / count) * TAU + (index % 2) * 0.19;
      const direction = index % 2 === 0 ? 1 : -1;
      const outerRadius = diameter * (0.39 + (index % 3) * 0.018);
      const innerRadius = diameter * (0.1 + (index % 4) * 0.025);
      const pulseSpeed = 6.9 + (index % 4) * 0.93;
      const rotationSpeed = direction * (0.12 + (index % 3) * 0.055);
      const points: Vector3[] = [];
      for (let pointIndex = 0; pointIndex < pointCount; pointIndex++) {
        const t = pointIndex / (pointCount - 1);
        const taper = Math.sin(t * Math.PI);
        const angle =
          phase +
          direction * t * (0.34 + (index % 3) * 0.08) +
          Math.sin(pointIndex * 8.73 + index * 2.41) * 0.075 * taper;
        const jagged =
          Math.sin(pointIndex * 13.17 + index * 5.31) * diameter * 0.017 * taper;
        const radius = outerRadius + (innerRadius - outerRadius) * t + jagged;
        points.push(
          new Vector3(
            Math.sin(t * 15.0 + phase) * diameter * 0.012 * taper,
            Math.cos(angle) * radius,
            Math.sin(angle) * radius
          )
        );
      }

      const mainRadius = diameter * (0.00175 + (index % 3) * 0.00038);
      const mesh = this.createLightningMesh(
        scene,
        `skyEyeDefeatPortalLightning_${index}`,
        points,
        mainRadius,
        false,
        8 + index
      );
      arcs.push({
        mesh,
        phase,
        pulseSpeed,
        rotationSpeed,
        intensity: 1,
      });

      const branchCount = 1 + (index % 2);
      for (let branchIndex = 0; branchIndex < branchCount; branchIndex++) {
        const startIndex = Math.min(
          pointCount - 3,
          4 + branchIndex * 2 + (index % 2)
        );
        const start = points[startIndex];
        const startRadius = Math.hypot(start.y, start.z);
        const startAngle = Math.atan2(start.z, start.y);
        const branchDirection =
          (index + branchIndex) % 2 === 0 ? 1 : -1;
        const branchPoints: Vector3[] = [];
        const branchPointCount = 7;
        for (
          let branchPointIndex = 0;
          branchPointIndex < branchPointCount;
          branchPointIndex++
        ) {
          const t = branchPointIndex / (branchPointCount - 1);
          const taper = Math.sin(t * Math.PI);
          const angle =
            startAngle +
            branchDirection * t * (0.32 + branchIndex * 0.11) +
            Math.sin(
              branchPointIndex * 11.37 + index * 3.17 + branchIndex * 5.2
            ) *
              0.085 *
              taper;
          const radius =
            startRadius -
            diameter * (0.105 + branchIndex * 0.025) * t +
            Math.sin(branchPointIndex * 9.7 + phase) *
              diameter *
              0.01 *
              taper;
          branchPoints.push(
            new Vector3(
              start.x +
                Math.sin(t * 12.5 + phase) * diameter * 0.007 * taper,
              Math.cos(angle) * radius,
              Math.sin(angle) * radius
            )
          );
        }

        const branch = this.createLightningMesh(
          scene,
          `skyEyeDefeatPortalLightning_${index}_branch_${branchIndex}`,
          branchPoints,
          mainRadius * 0.58,
          true,
          24 + index * 2 + branchIndex
        );
        arcs.push({
          mesh: branch,
          phase: phase + branchIndex * 0.018,
          pulseSpeed,
          rotationSpeed,
          intensity: 0.68,
        });
      }
    }
    return arcs;
  }

  private createLightningMesh(
    scene: Scene,
    name: string,
    points: Vector3[],
    radius: number,
    branch: boolean,
    alphaIndex: number
  ) {
    const mesh = MeshBuilder.CreateTube(
      name,
      {
        path: points,
        radiusFunction: (pathIndex) => {
          const t = pathIndex / Math.max(1, points.length - 1);
          if (branch) return radius * Math.max(0.14, 1 - t * 0.86);
          return radius * (0.62 + Math.sin(t * Math.PI) * 0.38);
        },
        tessellation: 4,
        cap: Mesh.CAP_ALL,
        sideOrientation: Mesh.DOUBLESIDE,
      },
      scene
    );
    mesh.parent = this.lightningRoot;
    mesh.material = this.lightningMaterial;
    mesh.isPickable = false;
    mesh.alwaysSelectAsActiveMesh = true;
    mesh.applyFog = false;
    mesh.renderingGroupId = 1;
    mesh.alphaIndex = alphaIndex;
    mesh.visibility = 0;
    return mesh;
  }
}
