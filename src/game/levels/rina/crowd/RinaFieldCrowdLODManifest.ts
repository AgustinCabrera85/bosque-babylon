/** Field-only variants. The source fan manifest remains the authority for clip names and height. */
export const RINA_FIELD_CROWD_LODS = [
  { id: "fan_01", animated: "Fan_01_LOD1_Animated_512.glb",
    static: ["Fan_01_LOD2_Static_cheer_512.glb", "Fan_01_LOD2_Static_dance_512.glb"] },
  { id: "fan_02", animated: "Fan_02_LOD1_Animated_512.glb",
    static: ["Fan_02_LOD2_Static_cheer_512.glb", "Fan_02_LOD2_Static_clap_512.glb"] },
  { id: "fan_03", animated: "Fan_03_LOD1_Animated_512.glb",
    static: ["Fan_03_LOD2_Static_rally_512.glb", "Fan_03_LOD2_Static_cheer_512.glb"] },
  { id: "fan_04", animated: "Female_Fan_04_LOD1_Animated_512.glb",
    static: ["Female_Fan_04_LOD2_Static_cheer_512.glb", "Female_Fan_04_LOD2_Static_clap_512.glb"] },
  { id: "fan_05", animated: "Female_Fan_05_LOD1_Animated_512.glb",
    static: ["Female_Fan_05_LOD2_Static_cheer_512.glb", "Female_Fan_05_LOD2_Static_idle_512.glb"] },
] as const;

export const RINA_FIELD_CROWD_LOD_DIR = "assets/models/rina/crowd/lod/";
