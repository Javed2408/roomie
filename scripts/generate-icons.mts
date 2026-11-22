/**
 * Builds the app's PNG icons from `public/icon.svg`.
 * Run after changing the icon: `npm run icons`.
 *
 * - icon-192.png, icon-512.png: the standard install icons (rounded corners).
 * - icon-maskable-512.png: full-bleed, artwork shrunk into the centre "safe
 *   zone", so Android can crop it to a circle or squircle without cutting
 *   the house off.
 * - apple-touch-icon.png: full-bleed 180px for iOS (iOS rounds the corners
 *   itself, and would show transparent corners as black).
 */
import { readFile } from "node:fs/promises";

import sharp from "sharp";

const source = await readFile("public/icon.svg", "utf8");
// The house and heart (everything drawn on top of the background).
const artwork = (source.match(/<path [^>]*\/>/g) ?? []).join("");
const background = /<rect [^>]*fill="(#[0-9A-Fa-f]{6})"/.exec(source)?.[1] ?? "#1A1A1A";

/** The artwork on a square, full-bleed background, scaled about the centre. */
function fullBleed(scale: number): string {
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512"><rect width="512" height="512" fill="${background}"/><g transform="translate(256 256) scale(${scale}) translate(-256 -256)">${artwork}</g></svg>`;
}

async function png(svg: string, size: number, file: string) {
  await sharp(Buffer.from(svg), { density: 300 })
    .resize(size, size)
    .png({ compressionLevel: 9 })
    .toFile(`public/${file}`);
  console.log(`  public/${file}`);
}

console.log("Writing icons:");
await png(source, 192, "icon-192.png");
await png(source, 512, "icon-512.png");
await png(fullBleed(0.74), 512, "icon-maskable-512.png");
await png(fullBleed(0.9), 180, "apple-touch-icon.png");
