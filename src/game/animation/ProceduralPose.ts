export type SerializedQuaternion = [number, number, number, number];

export type ProceduralPoseBone = {
  rotationOffset: SerializedQuaternion;
};

export type ProceduralPose = {
  id: string;
  source?: {
    model?: string;
    animation?: string;
    time?: number;
  };
  bones: Record<string, ProceduralPoseBone>;
};
