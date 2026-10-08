import path from "node:path";
import sharp from "sharp";

const source = path.resolve(".tmp/game-icon-review/source-256-dib.png");
const resourceRoot = "F:/ProyectoYT/Juego/bosque-babylon-android/android/app/src/main/res";
const densities = {
  mdpi: [48, 108],
  hdpi: [72, 162],
  xhdpi: [96, 216],
  xxhdpi: [144, 324],
  xxxhdpi: [192, 432],
};
const jobs = [];

for (const [density, [legacySize, foregroundSize]] of Object.entries(densities)) {
  const directory = path.join(resourceRoot, `mipmap-${density}`);
  jobs.push(
    sharp(source)
      .resize(legacySize, legacySize, { fit: "fill", kernel: sharp.kernel.lanczos3 })
      .png()
      .toFile(path.join(directory, "ic_launcher.png"))
  );

  const roundMask = Buffer.from(`
    <svg width="${legacySize}" height="${legacySize}" xmlns="http://www.w3.org/2000/svg">
      <circle cx="${legacySize / 2}" cy="${legacySize / 2}" r="${legacySize / 2}" fill="white" />
    </svg>
  `);
  jobs.push(
    sharp(source)
      .resize(legacySize, legacySize, { fit: "fill", kernel: sharp.kernel.lanczos3 })
      .composite([{ input: roundMask, blend: "dest-in" }])
      .png()
      .toFile(path.join(directory, "ic_launcher_round.png"))
  );

  const artworkSize = Math.round(foregroundSize * 0.88);
  jobs.push(
    sharp({
      create: {
        width: foregroundSize,
        height: foregroundSize,
        channels: 4,
        background: { r: 0, g: 0, b: 0, alpha: 0 },
      },
    })
      .composite([
        {
          input: await sharp(source)
            .resize(artworkSize, artworkSize, { fit: "fill", kernel: sharp.kernel.lanczos3 })
            .png()
            .toBuffer(),
          gravity: "center",
        },
      ])
      .png()
      .toFile(path.join(directory, "ic_launcher_foreground.png"))
  );
}

await Promise.all(jobs);
