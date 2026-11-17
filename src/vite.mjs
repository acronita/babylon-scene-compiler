// Vite plugin: in `vite build`, compiles the editor's exported scenes to code and swaps the editor
// runtime for it. `vite` (dev) keeps the real runtime, so the game runs exactly as in the editor.
import { isAbsolute, join, relative, resolve } from 'node:path';
import { applyImages, collectImages, encodeImages } from './images.mjs';
import { DEFAULT_OUT_DIR, compileProject, readScenes } from './project.mjs';

/**
 * @param {{ scenes?: string[]; sceneDir?: string; outDir?: string; enabled?: boolean; lazyTextures?: boolean;
 *   images?: { format?: 'webp' | 'avif'; quality?: number; minBytes?: number; keepOriginals?: boolean } }} [options]
 *   enabled: defaults to `vite build` unless BABYLON_SCENE_COMPILER=off.
 *   images: re-encode the images the scenes use (textures, GUI assets) in the build output.
 */
export function babylonSceneCompiler(options = {}) {
  let images = null; // { map, guis, cacheDir, sceneDir }
  let viteConfig = null;
  let code = '';
  return {
    name: 'babylon-scene-compiler',
    enforce: 'pre',
    async config(config, env) {
      const enabled = options.enabled ?? (env.command === 'build' && process.env.BABYLON_SCENE_COMPILER !== 'off');
      if (!enabled) return;
      const root = resolve(config.root ?? process.cwd());
      let map;
      if (options.images) {
        const { sceneDir, scenes } = readScenes({ root, scenes: options.scenes, sceneDir: options.sceneDir });
        const found = collectImages(scenes, sceneDir);
        const cacheDir = join(root, options.outDir ?? DEFAULT_OUT_DIR, 'images');
        map = await encodeImages({ root, sceneDir, cacheDir, images: found.images, ...options.images });
        images = { map, guis: found.guis, cacheDir, sceneDir };
      }
      const out = compileProject({ root, scenes: options.scenes, sceneDir: options.sceneDir, outDir: options.outDir, lazyTextures: options.lazyTextures, images: map });
      console.log(`[babylon-scene-compiler] compiled ${out.scenes.join(', ')}; the editor runtime is left out of this build`);
      return {
        resolve: {
          alias: [
            { find: /^babylonjs-editor-tools$/, replacement: out.module },
            { find: /^babylonjs-editor-tools\/.+$/, replacement: out.empty },
            { find: /^@babylonjs\/core\/Loading\/Plugins\/babylonFileLoader(\.pure)?(\.js)?$/, replacement: out.empty },
          ],
        },
      };
    },
    configResolved(config) {
      viteConfig = config;
    },
    generateBundle(_, bundle) {
      if (!images) return;
      // Project code only: the generated scene module names every texture by its editor path.
      const parts = [];
      for (const chunk of Object.values(bundle)) {
        if (chunk.type !== 'chunk') continue;
        for (const [id, module] of Object.entries(chunk.modules)) {
          if (!id.replaceAll('\\', '/').endsWith('/scene.generated.ts')) parts.push(module.code ?? '');
        }
      }
      code = parts.join('\n');
    },
    closeBundle() {
      if (!images || !viteConfig) return;
      const fromPublic = relative(viteConfig.publicDir, images.sceneDir);
      if (fromPublic.startsWith('..') || isAbsolute(fromPublic)) {
        throw new Error(`[babylon-scene-compiler] images: the scene folder ${images.sceneDir} is not inside the public folder ${viteConfig.publicDir}`);
      }
      const outSceneDir = join(resolve(viteConfig.root, viteConfig.build.outDir), fromPublic);
      const result = applyImages({ outSceneDir, ...images, keepOriginals: options.images.keepOriginals, code });
      const kib = (result.savedBytes / 1024).toFixed(0);
      console.log(`[babylon-scene-compiler] images: ${result.written} re-encoded (${kib} KiB less), ${result.removed} originals removed`);
    },
  };
}

export default babylonSceneCompiler;
