import { DracoDecoder } from "@babylonjs/core/Meshes/Compression/dracoDecoder";
import dracoFallbackUrl from "@babylonjs/core/assets/Draco/draco_decoder_gltf.js?url";
import dracoWasmBinaryUrl from "@babylonjs/core/assets/Draco/draco_decoder_gltf.wasm?url";
import dracoWasmWrapperUrl from "@babylonjs/core/assets/Draco/draco_wasm_wrapper_gltf.js?url";

let configured = false;

export function configureLocalDracoDecoder() {
  if (configured) return;
  configured = true;

  const hardwareConcurrency =
    typeof navigator === "undefined" ? 2 : navigator.hardwareConcurrency || 2;
  DracoDecoder.DefaultConfiguration = {
    wasmUrl: dracoWasmWrapperUrl,
    wasmBinaryUrl: dracoWasmBinaryUrl,
    fallbackUrl: dracoFallbackUrl,
    numWorkers: Math.min(2, Math.max(1, Math.floor(hardwareConcurrency / 2))),
  };
}
