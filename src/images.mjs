// Build-time image re-encoding for compiled scenes. The project keeps its lossless art; the build
// ships each image the scene uses (material textures, images inside GUI assets) as WebP/AVIF when
// that is clearly smaller. Encodes with `sharp`, resolved from the project, and caches the results
// in <outDir>/images so unchanged art isn't re-encoded on every build.
import { copyFileSync, existsSync, mkdirSync, readFileSync, statSync, unlinkSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { SceneCompileError, assetKind } from './compile.mjs';

const IMAGE = /\.(png|jpe?g)$/i;
const TEXTURE_KEYS = /Texture$/;

/**
 * Images the exported scenes reference, as paths relative to the scene folder (= rootUrl).
 * @param {{ data: object }[]} scenes parsed .babylon files
 * @param {string} sceneDir absolute scene folder
 * @returns {{ images: Set<string>; guis: Map<string, Set<string>> }} guis: GUI asset → images it uses
 */
export function collectImages(scenes, sceneDir) {
  const images = new Set();
  const guis = new Map();
  for (const { data } of scenes) {
    for (const m of data.materials ?? []) {
      for (const [key, t] of Object.entries(m)) {
        const url = TEXTURE_KEYS.test(key) && t && typeof t === 'object' ? (t.url ?? t.name) : null;
        if (typeof url === 'string' && IMAGE.test(url)) images.add(url);
      }
    }
    for (const list of Object.values(data)) {
      if (!Array.isArray(list)) continue;
      for (const node of list) {
        for (const script of node?.metadata?.scripts ?? []) {
          for (const value of Object.values(script.values ?? {})) {
            if (value?.type !== 'asset' || assetKind(value.value) !== 'gui' || guis.has(value.value)) continue;
            const file = join(sceneDir, value.value);
            if (!existsSync(file)) continue;
            const used = new Set();
            (function walk(o) {
              if (typeof o === 'string') { if (IMAGE.test(o)) used.add(o); return; }
              if (o && typeof o === 'object') for (const x of Object.values(o)) walk(x);
            })(JSON.parse(readFileSync(file, 'utf8')));
            guis.set(value.value, used);
            for (const image of used) images.add(image);
          }
        }
      }
    }
  }
  return { images, guis };
}

/**
 * Encodes every referenced image that gets at least 20% smaller.
 * @param {{ root: string; sceneDir: string; cacheDir: string; images: Set<string>;
 *   format?: 'webp' | 'avif'; quality?: number; minBytes?: number }} options
 * @returns {Promise<Record<string, string>>} original relative path → encoded relative path
 */
export async function encodeImages(options) {
  const { root, sceneDir, cacheDir, images } = options;
  const format = options.format ?? 'webp';
  const quality = options.quality ?? 80;
  const minBytes = options.minBytes ?? 16 * 1024;
  if (format !== 'webp' && format !== 'avif') throw new SceneCompileError(`[babylon-scene-compiler] images.format "${format}": use "webp" or "avif"`);
  let sharp;
  try {
    sharp = createRequire(join(root, 'package.json'))('sharp');
  } catch {
    throw new SceneCompileError('[babylon-scene-compiler] the "images" option needs sharp in the project: npm install --save-dev sharp');
  }
  const map = {};
  for (const rel of images) {
    const source = join(sceneDir, rel);
    if (!existsSync(source)) continue; // missing art is the scene's problem, reported by the loader
    const stat = statSync(source);
    if (stat.size < minBytes) continue;
    const target = rel.replace(IMAGE, `.${format}`);
    const cached = join(cacheDir, target);
    const metaFile = `${cached}.json`;
    const stamp = { size: stat.size, mtimeMs: stat.mtimeMs, format, quality };
    let meta = existsSync(metaFile) ? JSON.parse(readFileSync(metaFile, 'utf8')) : null;
    if (!meta || JSON.stringify(meta.stamp) !== JSON.stringify(stamp) || (meta.used && !existsSync(cached))) {
      const encoded = await sharp(source)[format]({ quality, effort: format === 'webp' ? 6 : 4 }).toBuffer();
      const used = encoded.length <= stat.size * 0.8;
      mkdirSync(dirname(cached), { recursive: true });
      if (used) writeFileSync(cached, encoded);
      meta = { stamp, used, bytes: encoded.length };
      writeFileSync(metaFile, JSON.stringify(meta));
    }
    if (meta.used) map[rel] = target;
  }
  return map;
}

/**
 * Puts the encoded images in the build output and points the GUI assets at them.
 * @param {{ outSceneDir: string; cacheDir: string; map: Record<string, string>; guis: Map<string, Set<string>>;
 *   keepOriginals?: boolean; code?: string }} options code: emitted JS, to keep originals it still names
 * @returns {{ written: number; removed: number; savedBytes: number }}
 */
export function applyImages(options) {
  const { outSceneDir, cacheDir, map, guis } = options;
  let written = 0, removed = 0, savedBytes = 0;
  for (const [rel, target] of Object.entries(map)) {
    const original = join(outSceneDir, rel);
    if (!existsSync(original)) continue;
    copyFileSync(join(cacheDir, target), join(outSceneDir, target));
    savedBytes += statSync(original).size - statSync(join(outSceneDir, target)).size;
    written++;
  }
  for (const [gui, used] of guis) {
    const file = join(outSceneDir, gui);
    if (!existsSync(file)) continue;
    let text = readFileSync(file, 'utf8');
    for (const image of used) if (map[image]) text = text.split(JSON.stringify(image)).join(JSON.stringify(map[image]));
    writeFileSync(file, text);
  }
  if (options.keepOriginals === false) {
    const code = options.code ?? '';
    for (const rel of Object.keys(map)) {
      // Code that names the file (e.g. a runtime image swap) still needs the original.
      if (code.includes(rel) || code.includes(rel.split('/').pop())) continue;
      const original = join(outSceneDir, rel);
      if (existsSync(original)) { unlinkSync(original); removed++; }
    }
  }
  return { written, removed, savedBytes };
}
