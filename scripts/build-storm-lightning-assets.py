#!/usr/bin/env python3
"""Build one Storm FX variant from one complete transparent RGBA drawing.

Requires Pillow, numpy, scipy and scikit-image at asset-build time only.
LGT_01 is the byte-identical approved reference and should not be regenerated.
"""
import argparse
import heapq
import json
import math
from pathlib import Path

import numpy as np
from PIL import Image
from scipy import ndimage as ndi
from skimage.morphology import skeletonize


def build(source: Path, output: Path, slug: str, root_xy, tip_xy, width=768, height=1024):
    if slug == "lgt_01_vertical_classic":
        raise ValueError("LGT_01 is the approved golden reference; use its original files")
    image = Image.open(source)
    if image.format != "PNG" or image.mode != "RGBA":
        raise ValueError("Source must be a PNG in RGBA mode")
    rgba = np.asarray(image)
    if not np.any(rgba[:, :, 3] == 0):
        raise ValueError("Source PNG must include transparent background pixels")
    if rgba.shape[0] < 32 or rgba.shape[1] < 32 or np.count_nonzero(rgba[:, :, 3] > 32) < 100:
        raise ValueError("Source must contain a full transparent RGBA lightning drawing")
    opaque = rgba[:, :, 3] > 48
    labels, count = ndi.label(opaque, structure=np.ones((3, 3), np.uint8))
    sizes = np.bincount(labels.ravel())
    sizes[0] = 0
    if count == 0 or sizes.max() < 100:
        raise ValueError("No connected lightning silhouette found")
    component = labels == np.argmax(sizes)
    ys, xs = np.where(component)
    pad = 16
    x0, x1 = max(0, int(xs.min()) - pad), min(rgba.shape[1], int(xs.max()) + pad + 1)
    y0, y1 = max(0, int(ys.min()) - pad), min(rgba.shape[0], int(ys.max()) + pad + 1)
    cropped = rgba[y0:y1, x0:x1].copy()
    cropped[~component[y0:y1, x0:x1]] = 0
    scale = min((width - 48) / cropped.shape[1], (height - 88) / cropped.shape[0])
    rw, rh = max(1, round(cropped.shape[1] * scale)), max(1, round(cropped.shape[0] * scale))
    resized = Image.fromarray(cropped).resize((rw, rh), Image.Resampling.LANCZOS)
    offx, offy = (width - rw) // 2, (height - rh) // 2
    canvas = Image.new("RGBA", (width, height), (0, 0, 0, 0))
    canvas.paste(resized, (offx, offy))
    arr = np.asarray(canvas)
    solid = arr[:, :, 3] > 75
    connected, _ = ndi.label(solid, structure=np.ones((3, 3), np.uint8))
    component_sizes = np.bincount(connected.ravel())
    component_sizes[0] = 0
    skeleton = skeletonize(connected == np.argmax(component_sizes))
    sy, sx = np.where(skeleton)
    if len(sx) < 20:
        raise ValueError("Lightning skeleton is too small")

    def mapped(point):
        return (offx + (point[0] - x0) * scale, offy + (point[1] - y0) * scale)

    if root_xy is None:
        near = sy <= sy.min() + max(10, int(.023 * height))
        root_point = (float(np.median(sx[near])), float(sy[near].min()))
    else:
        root_point = mapped(root_xy)
    root = int(np.argmin((sx - root_point[0]) ** 2 + (sy - root_point[1]) ** 2))
    if math.hypot(sx[root] - root_point[0], sy[root] - root_point[1]) > 35:
        raise ValueError("Root point is too far from the lightning skeleton")
    lookup = {(int(y), int(x)): i for i, (y, x) in enumerate(zip(sy, sx))}
    distance = np.full(len(sx), np.inf)
    previous = np.full(len(sx), -1, np.int32)
    distance[root] = 0
    queue = [(0., root)]
    directions = [(dy, dx, math.hypot(dx, dy)) for dy in (-1, 0, 1)
                  for dx in (-1, 0, 1) if dx or dy]
    while queue:
        value, index = heapq.heappop(queue)
        if value > distance[index]:
            continue
        for dy, dx, cost in directions:
            other = lookup.get((int(sy[index]) + dy, int(sx[index]) + dx))
            if other is not None and value + cost < distance[other]:
                distance[other] = value + cost
                previous[other] = index
                heapq.heappush(queue, (distance[other], other))
    finite = np.isfinite(distance)
    if np.count_nonzero(finite) < 20:
        raise ValueError("Root does not connect to the lightning skeleton")
    maximum = float(np.max(distance[finite]))
    if tip_xy is None:
        finish = int(np.argmax(np.where(finite, distance, -1)))
    else:
        tx, ty = mapped(tip_xy)
        candidates = np.where(finite)[0]
        finish = int(candidates[np.argmin((sx[candidates] - tx) ** 2 + (sy[candidates] - ty) ** 2)])
        if math.hypot(sx[finish] - tx, sy[finish] - ty) > 35:
            raise ValueError("Tip point is too far from the lightning skeleton")
    trace = []
    index = finish
    while index >= 0:
        trace.append(index)
        index = int(previous[index])
    trace.reverse()
    trunk_progress = distance[finish] / maximum
    if trunk_progress < .5:
        raise ValueError("Tip path covers less than half the geodesic reveal")
    path_distances = distance[trace]
    samples = []
    for p in np.linspace(0, 1, 129):
        index = trace[int(np.argmin(np.abs(path_distances - p * distance[finish])))]
        samples.append({"p": round(float(p), 4), "u": round(float(sx[index] / width), 5),
                        "v": round(float(sy[index] / height), 5)})
    if any(not 0 <= point[axis] <= 1 for point in samples for axis in ("u", "v")):
        raise ValueError("Generated UV leaves the texture")

    connected_skeleton = np.zeros((height, width), bool)
    connected_skeleton[sy[finite], sx[finite]] = True
    near_y, near_x = ndi.distance_transform_edt(~connected_skeleton,
                                                 return_distances=False, return_indices=True)
    distance_map = np.zeros((height, width), np.float32)
    distance_map[sy[finite], sx[finite]] = distance[finite]
    growth = np.asarray(np.round(np.clip(distance_map[near_y, near_x] / maximum, 0, 1) * 255), np.uint8)
    opacity = arr[:, :, 3].astype(np.float32) / 255
    halo_alpha = np.clip((ndi.gaussian_filter(opacity, 9) * 1.45 +
                          ndi.gaussian_filter(opacity, 23) * 1.15) * .85, 0, .75)
    halo = np.zeros_like(arr)
    halo[:, :, :3] = [242, 109, 249]
    halo[:, :, 3] = (halo_alpha * 255).astype(np.uint8)
    output.mkdir(parents=True, exist_ok=True)
    bolt_name = f"{slug}_bolt.png"
    canvas.save(output / bolt_name, optimize=True)
    Image.fromarray(growth, "L").save(output / f"{slug}_growth.png", optimize=True)
    Image.fromarray(halo, "RGBA").save(output / f"{slug}_halo.png", optimize=True)
    (output / f"{slug}_head-path.json").write_text(json.dumps({
        "schema": "lo-realy-lo-otro/lightning-headpath/v1", "asset": bolt_name,
        "rootUv": samples[0], "mainTrunkMaxProgress": round(float(trunk_progress), 4),
        "samples": samples,
    }, indent=2) + "\n", encoding="utf-8")
    print(f"Built {slug}: {width}x{height}, {len(trace)} path pixels, 4 files")


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--source", type=Path, required=True, help="Complete transparent RGBA PNG")
    parser.add_argument("--slug", required=True, choices=[
        "lgt_02_forked_crown", "lgt_03_needle_strike", "lgt_04_oblique_arc"])
    parser.add_argument("--output", type=Path, required=True, help="Variant output directory")
    parser.add_argument("--root-x", type=float)
    parser.add_argument("--root-y", type=float)
    parser.add_argument("--tip-x", type=float)
    parser.add_argument("--tip-y", type=float)
    args = parser.parse_args()
    if (args.root_x is None) != (args.root_y is None) or (args.tip_x is None) != (args.tip_y is None):
        parser.error("Root and tip each require both X and Y")
    build(args.source, args.output, args.slug,
          None if args.root_x is None else (args.root_x, args.root_y),
          None if args.tip_x is None else (args.tip_x, args.tip_y))
