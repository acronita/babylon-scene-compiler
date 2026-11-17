import type { Plugin } from 'vite';

export interface BabylonSceneCompilerOptions {
  /** Exported scene files to compile (default: every .babylon in sceneDir). */
  scenes?: string[];
  /** Where the editor exports (default public/scene). */
  sceneDir?: string;
  /** Where the generated module goes (default .babylon-compiled). */
  outDir?: string;
  /** Default: on for `vite build` unless BABYLON_SCENE_COMPILER=off. */
  enabled?: boolean;
  /** A texture loads the first time a material that uses it is drawn. */
  lazyTextures?: boolean;
  /** Re-encode the images the scenes use (textures, GUI assets) in the build output. Needs sharp. */
  images?: {
    format?: 'webp' | 'avif';
    /** Encoder quality, default 80. */
    quality?: number;
    /** Smaller files stay as they are (default 16 KiB). */
    minBytes?: number;
    /** false: delete originals the emitted code doesn't name. Default true. */
    keepOriginals?: boolean;
  };
}

export function babylonSceneCompiler(options?: BabylonSceneCompilerOptions): Plugin;
export default babylonSceneCompiler;
