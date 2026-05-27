const fs = require('node:fs');
const path = require('node:path');
const screenshot = require('screenshot-desktop');
const sharp = require('sharp');
const { getWindowRect } = require('./capture');

async function main() {
  const outDir = path.resolve(process.cwd(), 'data');
  fs.mkdirSync(outDir, { recursive: true });
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');

  console.log('Click/focus the Pantheon window you want to calibrate within 5 seconds...');
  await new Promise((resolve) => setTimeout(resolve, 5000));

  const image = await screenshot({ format: 'png' });
  const rect = getWindowRect({
    processName: 'Pantheon',
    titleContains: 'Pantheon',
    useClientArea: true,
    useForeground: true
  });

  const fullPath = path.join(outDir, `calibration-full-${stamp}.png`);
  const gridPath = path.join(outDir, `calibration-grid-${stamp}.png`);
  const latestFullPath = path.join(outDir, 'calibration-full.latest.png');
  const latestGridPath = path.join(outDir, 'calibration-grid.latest.png');

  const full = await sharp(image)
    .extract({ left: rect.x, top: rect.y, width: rect.width, height: rect.height })
    .png()
    .toBuffer();

  fs.writeFileSync(fullPath, full);
  fs.writeFileSync(latestFullPath, full);

  const overlays = [];
  for (let x = 0; x < rect.width; x += 100) {
    overlays.push({
      input: Buffer.from(`<svg width="2" height="${rect.height}"><rect width="2" height="${rect.height}" fill="red" opacity="0.55"/></svg>`),
      left: x,
      top: 0
    });
  }
  for (let y = 0; y < rect.height; y += 100) {
    overlays.push({
      input: Buffer.from(`<svg width="${rect.width}" height="2"><rect width="${rect.width}" height="2" fill="red" opacity="0.55"/></svg>`),
      left: 0,
      top: y
    });
  }

  await sharp(full).composite(overlays).png().toFile(gridPath);
  fs.copyFileSync(gridPath, latestGridPath);

  console.log(`Pantheon window: ${rect.width}x${rect.height} at ${rect.x},${rect.y}`);
  console.log(`Saved: ${fullPath}`);
  console.log(`Saved: ${gridPath}`);
  console.log(`Latest: ${latestFullPath}`);
  console.log(`Latest: ${latestGridPath}`);
  console.log('Use the grid image to estimate windowAbsolute x/y/width/height in config.json.');
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
