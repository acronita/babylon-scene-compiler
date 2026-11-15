// Vite plugin: in `vite build`, compiles the editor's exported scenes to code and swaps the editor
// runtime for it. `vite` (dev) keeps the real runtime, so the game runs exactly as in the editor.
import { compileProject } from './project.mjs';

/**
 * @param {{ scenes?: string[]; sceneDir?: string; outDir?: string; enabled?: boolean; lazyTextures?: boolean }} [options]
 *   enabled: defaults to `vite build` unless BABYLON_SCENE_COMPILER=off.
 */
export function babylonSceneCompiler(options = {}) {
  return {
    name: 'babylon-scene-compiler',
    enforce: 'pre',
    config(config, env) {
      const enabled = options.enabled ?? (env.command === 'build' && process.env.BABYLON_SCENE_COMPILER !== 'off');
      if (!enabled) return;
      const root = config.root ?? process.cwd();
      const out = compileProject({ root, scenes: options.scenes, sceneDir: options.sceneDir, outDir: options.outDir, lazyTextures: options.lazyTextures });
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
  };
}

export default babylonSceneCompiler;
