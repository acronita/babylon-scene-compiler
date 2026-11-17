# babylon-scene-compiler

Compiles scenes made in the [Babylon.js Editor](https://editor.babylonjs.com) (5.5) to plain Babylon.js code at build time. The build keeps the scene, its scripts and its look, and leaves out the editor runtime: `babylonjs-editor-tools`, the `.babylon` loader, and every parser and post-process pipeline they pull in.

In the game it was built for, the bundle that loads a match dropped from 581 KB gzip with the editor runtime to 243 KB gzip compiled. The same game in plain Babylon.js, with no editor, was 193 KB.

## How it works

1. The editor exports the scene to `public/scene/<name>.babylon`, with mesh geometry in `.babylonbinarymeshdata` files (File > Export, or Play).
2. On `vite build`, the Vite plugin turns each exported scene into TypeScript (`.babylon-compiled/scene.generated.ts`). The generated code rebuilds the scene through the engine API with the same names, ids, metadata, parents, transforms, materials, lights, cameras and shadow generators. Scripts attached in the editor are attached with their inspector values.
3. An alias makes that module replace `babylonjs-editor-tools`. The project's code doesn't change: it still calls `loadScene(rootUrl, "name.babylon", scene, scriptsMap)` from the editor-generated `src/scripts.ts`.

Mesh geometry stays in the export's binary files and loads on demand, as it does with the `.babylon` loader. With `SceneLoaderFlags.ForceFullSceneLoadingForIncremental`, all of it loads before `loadScene` resolves.

`vite` (dev) keeps the editor runtime, so in development the scene runs exactly as it does in the editor.

## Install

From a GitHub release, as a tarball over HTTPS:

```bash
npm install --save-dev https://github.com/acronita/babylon-scene-compiler/archive/refs/tags/0.1.2.tar.gz
```

The tarball form works on build machines without SSH keys, such as Cloudflare Workers Builds. A `github:acronita/babylon-scene-compiler#0.1.2` shorthand gets written to the lockfile as `git+ssh`.

Requirements: Node 20+, Vite 6+, `@babylonjs/core` 9, a project made with Babylon.js Editor 5.5.

## Vite plugin

```ts
// vite.config.ts
import { defineConfig } from 'vite';
import { babylonSceneCompiler } from 'babylon-scene-compiler/vite';

export default defineConfig({
  plugins: [babylonSceneCompiler({ lazyTextures: true })],
});
```

| Option | Default | What it does |
| --- | --- | --- |
| `scenes` | every `.babylon` in `sceneDir` | Exported scene files to compile |
| `sceneDir` | `public/scene` | Where the editor exports |
| `outDir` | `.babylon-compiled` | Where the generated module goes; the folder gets its own `.gitignore` |
| `lazyTextures` | `false` | A texture loads the first time a material that uses it is drawn, instead of with the scene |
| `enabled` | on for `vite build` | `BABYLON_SCENE_COMPILER=off` turns it off for one build |
| `images` | off | Re-encodes the images the scenes use in the build output (see below) |

### Images

```ts
babylonSceneCompiler({ images: { format: 'webp', quality: 80, keepOriginals: false } })
```

The project keeps its lossless art; the build ships each PNG/JPEG that the scenes use (material textures and the images inside GUI assets assigned to scripts) as WebP or AVIF, when that makes the file at least 20% smaller. The generated code and the GUI files in the output point at the new files. Encoding uses [sharp](https://sharp.pixelplumbing.com) from the project (`npm install --save-dev sharp`) and is cached in `<outDir>/images`, so unchanged art isn't encoded again.

| Option | Default | What it does |
| --- | --- | --- |
| `format` | `webp` | `webp` or `avif` |
| `quality` | `80` | Encoder quality |
| `minBytes` | `16384` | Smaller images stay as they are |
| `keepOriginals` | `true` | `false` deletes the original from the output, unless the project's own code names the file (a runtime image swap still needs it) |

Images that code builds at runtime from a pattern (`` `icon-${n}.png` ``) aren't seen by the compiler: keep them small or convert them in the project.

### Script assets

Inspector values set with `@visibleAsAsset` load before `onStart`, as with the editor runtime: a `.gui` file becomes a fullscreen `AdvancedDynamicTexture` (image URLs resolve from the scene root), a `.json` file its parsed content. Other asset types stop the build.

To compile without Vite, run `npx babylon-scene-compiler [project] [--scene name.babylon]`. It writes the module to `.babylon-compiled/`.

## Editor plugin

Add it to the project's `project.bjseditor`, then reopen the project:

```json
"plugins": [{ "nameOrPath": "babylon-scene-compiler/editor" }]
```

A **Compiler** tab appears next to the inspector. Its **Compiled build** button exports the project (the same as File > Export), runs `npm run build` and shows the output in the tab and in the editor's console. If the tab can't be added, the plugin falls back to a floating button.

The tab's **Version** field shows `version` from the project's `package.json`; edit it before a build and the plugin saves it there. After the build it zips the content of `dist/` (`index.html` at the zip root) into `builds/<name>-<platform>-<version>.zip`, ready to upload to a store. The platform comes from the build log line `[platform] target: <id>`, if the project prints one; without it, or for `local`, the name is `<name>-<version>.zip`. Zipping uses the system's bsdtar on Windows and macOS, and `zip` on Linux. Add `builds/` to the project's `.gitignore`.

## Fail loud

When the compiler meets something it can't translate, it stops the build with an error that names it. A build that silently drops part of a scene is worse than no build.

Not supported yet:

- fog and environment textures;
- particles, sprites and sounds;
- skeletons, morph targets and animations;
- physics, LODs, instances and multi-materials;
- post-process pipelines and spot lights;
- inline geometry;
- material textures other than diffuse, emissive and opacity (Standard) or albedo (PBR);
- material plugins other than a textureless PBR clear coat;
- script assets other than `.gui` (fullscreen) and `.json`.

It also checks imports from `babylonjs-editor-tools`, and stops the build if one has no compiled equivalent.

## Development

```bash
npm test
```

The tests use Node's built-in test runner and have no dependencies.

## License

[MIT](LICENSE)
