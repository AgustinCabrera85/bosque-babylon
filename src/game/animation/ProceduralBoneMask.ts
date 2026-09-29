import { normalizeMixamoBoneName } from "./MixamoProceduralRig";

export type ProceduralBoneMask = {
  id: string;
  bones: string[];
};

export type ProceduralBoneDescriptor = {
  name: string;
  parentName: string | null;
};

export const MIXAMO_BODY_REGION_PRESET_IDS = [
  "fullBody",
  "upperBody",
  "lowerBody",
  "torso",
  "head",
  "leftArm",
  "rightArm",
  "arms",
  "hands",
  "leftLeg",
  "rightLeg",
  "legs",
] as const;

export type MixamoBodyRegionPresetId =
  (typeof MIXAMO_BODY_REGION_PRESET_IDS)[number];

export function resolveMixamoBoneMaskPresets(
  bones: readonly ProceduralBoneDescriptor[]
) {
  const find = (suffix: string) =>
    bones.find((bone) =>
      normalizeMixamoBoneName(bone.name).endsWith(suffix)
    )?.name ?? null;

  const hips = find("hips");
  const spine = find("spine");
  const neck = find("neck");
  const head = find("head");
  const leftArm = find("leftarm");
  const rightArm = find("rightarm");
  const leftUpLeg = find("leftupleg");
  const rightUpLeg = find("rightupleg");
  if (
    !hips ||
    !spine ||
    !head ||
    !leftArm ||
    !rightArm ||
    !leftUpLeg ||
    !rightUpLeg
  ) {
    return [];
  }

  const leftShoulder = find("leftshoulder") ?? leftArm;
  const rightShoulder = find("rightshoulder") ?? rightArm;
  const leftHand = find("lefthand");
  const rightHand = find("righthand");
  const descendants = createDescendantResolver(bones);
  const orderedNames = bones.map((bone) => bone.name);
  const ordered = (...groups: Iterable<string>[]) => {
    const included = new Set<string>();
    for (const group of groups) {
      for (const name of group) included.add(name);
    }
    return orderedNames.filter((name) => included.has(name));
  };
  const mask = (
    id: MixamoBodyRegionPresetId,
    boneNames: Iterable<string>
  ): ProceduralBoneMask => ({ id, bones: ordered(boneNames) });

  const leftArmBones = descendants(leftShoulder);
  const rightArmBones = descendants(rightShoulder);
  const leftHandBones = leftHand ? descendants(leftHand) : new Set<string>();
  const rightHandBones = rightHand ? descendants(rightHand) : new Set<string>();
  const leftLegBones = descendants(leftUpLeg);
  const rightLegBones = descendants(rightUpLeg);
  const torsoBones = new Set(
    ["spine", "spine1", "spine2", "spine3"]
      .map(find)
      .filter((name): name is string => Boolean(name))
  );

  return [
    mask("fullBody", orderedNames),
    mask("upperBody", descendants(spine)),
    mask("lowerBody", ordered([hips], leftLegBones, rightLegBones)),
    mask("torso", torsoBones),
    mask("head", neck ? descendants(neck) : [head]),
    mask("leftArm", leftArmBones),
    mask("rightArm", rightArmBones),
    mask("arms", ordered(leftArmBones, rightArmBones)),
    mask("hands", ordered(leftHandBones, rightHandBones)),
    mask("leftLeg", leftLegBones),
    mask("rightLeg", rightLegBones),
    mask("legs", ordered(leftLegBones, rightLegBones)),
  ];
}

function createDescendantResolver(
  bones: readonly ProceduralBoneDescriptor[]
) {
  const children = new Map<string, string[]>();
  for (const bone of bones) {
    if (!bone.parentName) continue;
    const siblings = children.get(bone.parentName);
    if (siblings) siblings.push(bone.name);
    else children.set(bone.parentName, [bone.name]);
  }

  return (root: string) => {
    const result = new Set<string>();
    const pending = [root];
    while (pending.length > 0) {
      const name = pending.pop()!;
      if (result.has(name)) continue;
      result.add(name);
      const directChildren = children.get(name);
      if (directChildren) pending.push(...directChildren);
    }
    return result;
  };
}
