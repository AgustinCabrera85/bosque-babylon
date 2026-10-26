import { NodeIO } from "@gltf-transform/core";
import path from "node:path";

const io = new NodeIO();
const root = path.resolve("public/assets/models/rina/crowd/lod");
const variants = [
  ["fan_01", "Fan_01"],
  ["fan_02", "Fan_02"],
  ["fan_03", "Fan_03"],
  ["fan_04", "Female_Fan_04"],
  ["fan_05", "Female_Fan_05"],
];

function primitives(document) {
  return document.getRoot().listMeshes().flatMap(mesh => mesh.listPrimitives());
}

for (const [fanId, prefix] of variants) {
  const rigDoc = await io.read(path.join(root, `${prefix}_LOD1_Animated_512.glb`));
  const skin = rigDoc.getRoot().listSkins()[0];
  const joints = skin?.listJoints().map(joint => joint.getName()) ?? [];
  const rig = primitives(rigDoc)[0];
  const jointData = rig.getAttribute("JOINTS_0").getArray();
  const weightData = rig.getAttribute("WEIGHTS_0").getArray();
  const rigUV = rig.getAttribute("TEXCOORD_0").getArray();
  for (const pose of ["cheer", "clap", "rally"]) {
    const filename = `${prefix}_LOD2_Static_${pose}_512.glb`;
    let staticDoc;
    try { staticDoc = await io.read(path.join(root, filename)); }
    catch { continue; }
    const baked = primitives(staticDoc)[0];
    const xyz = baked.getAttribute("POSITION").getArray();
    const uv = baked.getAttribute("TEXCOORD_0").getArray();
    if (uv.length !== rigUV.length || uv.some((value, i) => Math.abs(value-rigUV[i]) > 1e-5)) {
      throw new Error(`${filename}: vertex correspondence changed`);
    }
    const allY = Array.from({ length: xyz.length / 3 }, (_, i) => xyz[i*3+1]);
    const minY = Math.min(...allY), maxY = Math.max(...allY);
    const height = maxY-minY;
    const regions = {};
    for (const side of ["Right", "Left"]) {
      for (const part of ["Hand", "HandIndex1", "HandIndex2", "HandThumb1", "HandThumb2"]) {
        const wanted = joints.findIndex(name => name.endsWith(`${side}${part}`));
        const points = [];
        for (let i = 0; i < xyz.length/3; i++) {
          let weight = 0;
          for (let j = 0; j < 4; j++) if (jointData[i*4+j] === wanted) {
            weight += weightData[i*4+j];
          }
          if (weight > 0.45) points.push([xyz[i*3],xyz[i*3+1],xyz[i*3+2]]);
        }
        if (!points.length) continue;
        const average = [0,0,0];
        for (const point of points) for (let i=0;i<3;i++) average[i]+=point[i]/points.length;
        regions[`${side}${part}`] = {
          n: points.length,
          at: average.map((value,i) => +(i===1 ? (value-minY)/height : value/height).toFixed(3)),
        };
      }
    }
    console.log(JSON.stringify({ fanId, pose, height:+height.toFixed(3), regions }));
  }
}
