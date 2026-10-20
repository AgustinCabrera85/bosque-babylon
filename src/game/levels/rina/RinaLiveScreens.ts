import { FreeCamera } from "@babylonjs/core/Cameras/freeCamera";
import { Color4 } from "@babylonjs/core/Maths/math.color";
import { Vector3 } from "@babylonjs/core/Maths/math.vector";
import { RenderTargetTexture } from "@babylonjs/core/Materials/Textures/renderTargetTexture";
import type { Scene } from "@babylonjs/core/scene";
import type { RinaController } from "../../enemies/rina";

/** A single close-up camera supplies both side screens during the concert. */
export function createRinaLiveScreens(
  scene: Scene,
  rina: RinaController,
  performanceTier: "desktop" | "mobile"
) {
  const camera = new FreeCamera("rinaSingerScreenCamera", Vector3.Zero(), scene);
  camera.fov = 0.56;
  camera.minZ = 0.1;
  camera.maxZ = 30;

  const feed = new RenderTargetTexture(
    "rinaSingerLiveFeed",
    performanceTier === "mobile"
      ? { width: 512, height: 384 }
      : { width: 1024, height: 768 },
    scene,
    { generateMipMaps: false, doNotChangeAspectRatio: false }
  );
  feed.activeCamera = camera;
  feed.clearColor = new Color4(0.012, 0.005, 0.025, 1);
  const singerMeshes = rina.root.getChildMeshes(false).filter(
    (mesh) => mesh.getTotalVertices() > 0
  );
  feed.renderList = singerMeshes;
  feed.refreshRate = performanceTier === "mobile"
    ? RenderTargetTexture.REFRESHRATE_RENDER_ONEVERYTWOFRAMES
    : RenderTargetTexture.REFRESHRATE_RENDER_ONEVERYFRAME;
  scene.customRenderTargets.push(feed);

  const target = new Vector3();
  const update = () => {
    const singer = rina.root.position;
    const height = rina.height;
    const yaw = rina.root.rotation.y;
    const frontX = Math.sin(yaw);
    const frontZ = Math.cos(yaw);
    let minX = Infinity;
    let maxX = -Infinity;
    let minZ = Infinity;
    let maxZ = -Infinity;
    for (const mesh of singerMeshes) {
      const bounds = mesh.getBoundingInfo().boundingBox;
      minX = Math.min(minX, bounds.minimumWorld.x);
      maxX = Math.max(maxX, bounds.maximumWorld.x);
      minZ = Math.min(minZ, bounds.minimumWorld.z);
      maxZ = Math.max(maxZ, bounds.maximumWorld.z);
    }
    const centerX = Number.isFinite(minX) ? (minX + maxX) * 0.5 : singer.x;
    const centerZ = Number.isFinite(minZ) ? (minZ + maxZ) * 0.5 : singer.z;
    // The singing clip leans off the mesh pivot, so compose the camera slightly
    // toward its right to keep the animated face in the middle of the panel.
    const frameX = centerX - frontZ * 0.65;
    const frameZ = centerZ + frontX * 0.65;
    camera.position.set(
      frameX + frontX * 3.2,
      singer.y + height * 0.65,
      frameZ + frontZ * 3.2
    );
    target.set(frameX, singer.y + height * 0.62, frameZ);
    camera.setTarget(target);
  };
  update();
  return { feed, update };
}
