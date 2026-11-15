// Turns a scene exported by the Babylon.js Editor (public/scene/<name>.babylon) into TypeScript that
// rebuilds it through the engine API, so a build needs neither babylonjs-editor-tools nor the
// .babylon loader and its parsers.
//
// What the generated code keeps from the editor runtime:
// - the same objects, with their names, ids, metadata, parents, materials and transforms;
// - mesh geometry stays in the export's .babylonbinarymeshdata files and loads on demand, exactly
//   like the .babylon loader does (all at once when SceneLoaderFlags.ForceFullSceneLoadingForIncremental);
// - scripts attached in the editor, with their inspector values.
//
// Anything it cannot translate stops the compilation with an error naming it (fail loud): a build
// that silently drops part of a scene is worse than no build.

const n = (x) => (Number.isInteger(x) ? String(x) : String(Math.round(x * 1e9) / 1e9));
const v = (a) => a.map(n).join(', ');
const s = (x) => JSON.stringify(x);

export class SceneCompileError extends Error {}

/** Collects the imports the generated code needs: module path → names (null for side effects). */
class Imports {
  constructor() {
    this.map = new Map();
  }
  use(path, name = null) {
    if (!this.map.has(path)) this.map.set(path, new Set());
    if (name) this.map.get(path).add(name);
    return name;
  }
  lines() {
    return [...this.map]
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([path, names]) => (names.size ? `import { ${[...names].sort().join(', ')} } from "${path}";` : `import "${path}";`));
  }
}

const CORE = '@babylonjs/core';

/**
 * Compiles one exported scene into the body of a function `(rootUrl, scene, attach) => Mesh[]`.
 * @param {object} src the parsed .babylon file
 * @param {string} label the scene file name, for error messages
 * @param {Imports} imports shared import collector
 * @param {string} fn name of the function to emit
 */
export function compileScene(src, label, imports, fn, options = {}) {
  const fail = (msg) => {
    throw new SceneCompileError(`[babylon-scene-compiler] ${label}: ${msg}`);
  };
  const use = (path, name) => imports.use(`${CORE}/${path}`, name);
  const C3 = (a) => `new ${use('Maths/math.color', 'Color3')}(${v(a)})`;
  const C4 = (a) => `new ${use('Maths/math.color', 'Color4')}(${v(a)})`;
  const V3 = (a) => `new ${use('Maths/math.vector', 'Vector3')}(${v(a)})`;
  const V2 = (a) => `new ${use('Maths/math.vector', 'Vector2')}(${v(a)})`;
  /** An inspector value of a script, as code: plain values as they are, colours and vectors as their classes. */
  const scriptValue = (value, unsupported) => {
    switch (value.type) {
      case 'number':
      case 'boolean':
      case 'string':
        return s(value.value);
      case 'color3':
        return C3(value.value);
      case 'color4':
        return C4(value.value);
      case 'vector2':
        return V2(value.value);
      case 'vector3':
        return V3(value.value);
      default:
        return unsupported();
    }
  };
  const L = [];
  let k = 0;
  const byRef = new Map(); // id / uniqueId → variable

  // --- scene ------------------------------------------------------------------------------------
  if (src.clearColor) L.push(`scene.clearColor = ${C4(src.clearColor.length === 3 ? [...src.clearColor, 1] : src.clearColor)};`);
  if (src.ambientColor) L.push(`scene.ambientColor = ${C3(src.ambientColor)};`);
  if (src.useRightHandedSystem !== undefined) L.push(`scene.useRightHandedSystem = ${!!src.useRightHandedSystem};`);
  if (src.fogMode) fail('fog is not supported');
  if (src.environmentTexture) fail('environment textures are not supported');
  if (src.particleSystems?.length) fail('particle systems are not supported');
  if (src.skeletons?.length) fail('skeletons are not supported');
  if (src.morphTargetManagers?.length) fail('morph targets are not supported');
  if (src.multiMaterials?.length) fail('multi-materials are not supported');
  if (src.animationGroups?.length) fail('animation groups are not supported');
  if (src.sounds?.length) fail('sounds are not supported');
  if (src.spriteManagers?.length) fail('sprites are not supported');
  if (src.metadata) {
    for (const entry of src.metadata.rendering ?? []) {
      for (const [key, value] of Object.entries(entry)) {
        if (key !== 'cameraId' && value) fail(`rendering pipeline "${key}" is not supported`);
      }
    }
    if (src.metadata.scripts?.length) fail('scripts on the scene itself are not supported');
    L.push(`scene.metadata = ${s(src.metadata)};`);
  }

  const name = (prefix, o) => {
    const variable = `${prefix}${k++}`;
    byRef.set(o.id, variable);
    if (o.uniqueId !== undefined) byRef.set(o.uniqueId, variable);
    return variable;
  };
  const scripted = [];
  const common = (variable, o) => {
    if (o.metadata !== undefined && o.metadata !== null) L.push(`${variable}.metadata = ${s(o.metadata)};`);
    if (o.metadata?.scripts?.length) scripted.push({ variable, scripts: o.metadata.scripts, label: o.name });
    if (o.animations?.length) fail(`"${o.name}": animations are not supported`);
  };
  const transform = (variable, o) => {
    if (o.position) L.push(`${variable}.position.set(${v(o.position)});`);
    if (o.rotationQuaternion) L.push(`${variable}.rotationQuaternion = new ${use('Maths/math.vector', 'Quaternion')}(${v(o.rotationQuaternion)});`);
    else if (o.rotation?.some((x) => x !== 0)) L.push(`${variable}.rotation.set(${v(o.rotation)});`);
    if (o.scaling && o.scaling.some((x) => x !== 1)) L.push(`${variable}.scaling.set(${v(o.scaling)});`);
    // Serialized as a Float32Array: an object indexed 0..15.
    const local = o.localMatrix ? Array.from({ length: 16 }, (_, i) => o.localMatrix[i]) : null;
    if (local && !isIdentity(local)) {
      L.push(`${variable}.setPreTransformMatrix(${use('Maths/math.vector', 'Matrix')}.FromArray([${v(local)}]));`);
    }
    if (o.billboardMode) L.push(`${variable}.billboardMode = ${o.billboardMode};`);
    if (o.isEnabled === false) L.push(`${variable}.setEnabled(false);`);
  };

  // --- transform nodes ----------------------------------------------------------------------------
  for (const t of src.transformNodes ?? []) {
    const variable = name('node', t);
    L.push(`const ${variable} = new ${use('Meshes/transformNode', 'TransformNode')}(${s(t.name)}, scene);`, `${variable}.id = ${s(t.id)};`);
    transform(variable, t);
    common(variable, t);
  }

  // --- materials ----------------------------------------------------------------------------------
  const textures = new Map();
  const texture = (t, owner) => {
    if (!t) return null;
    if (t.isCube || t.isRenderTarget || t.customType) fail(`material "${owner}": texture "${t.name}" of this type is not supported`);
    const url = t.url ?? t.name;
    const key = s(t);
    if (textures.has(key)) return textures.get(key);
    const variable = `tex${k++}`;
    textures.set(key, variable);
    const create = `new ${use('Materials/Textures/texture', 'Texture')}(rootUrl + ${s(url)}, scene, ${!!t.noMipmap}, ${t.invertY !== false}, ${t.samplingMode ?? 3})`;
    // lazyTextures: fetched the first time a material that uses it is drawn (Babylon's delayed loading).
    L.push(options.lazyTextures ? `const ${variable} = delayed(scene, () => ${create});` : `const ${variable} = ${create};`, `${variable}.name = ${s(t.name)};`);
    const set = (prop, value, fallback) => value !== undefined && value !== fallback && L.push(`${variable}.${prop} = ${typeof value === 'number' ? n(value) : s(value)};`);
    set('hasAlpha', t.hasAlpha, false);
    set('getAlphaFromRGB', t.getAlphaFromRGB, false);
    set('level', t.level, 1);
    set('coordinatesIndex', t.coordinatesIndex, 0);
    set('uOffset', t.uOffset, 0);
    set('vOffset', t.vOffset, 0);
    set('uScale', t.uScale, 1);
    set('vScale', t.vScale, 1);
    set('uAng', t.uAng, 0);
    set('vAng', t.vAng, 0);
    set('wAng', t.wAng, 0);
    set('wrapU', t.wrapU, 1);
    set('wrapV', t.wrapV, 1);
    set('anisotropicFilteringLevel', t.anisotropicFilteringLevel, 4);
    set('gammaSpace', t.gammaSpace, true);
    return variable;
  };
  const materialRef = new Map();
  for (const m of src.materials ?? []) {
    const variable = name('mat', m);
    materialRef.set(m.id, variable);
    if (m.uniqueId !== undefined) materialRef.set(m.uniqueId, variable);
    const set = (prop, value) => value !== undefined && value !== null && L.push(`${variable}.${prop} = ${value};`);
    if (!m.customType || m.customType === 'BABYLON.StandardMaterial') {
      L.push(`const ${variable} = new ${use('Materials/standardMaterial', 'StandardMaterial')}(${s(m.name)}, scene);`, `${variable}.id = ${s(m.id)};`);
      if (m.diffuse) set('diffuseColor', C3(m.diffuse));
      if (m.specular) set('specularColor', C3(m.specular));
      if (m.emissive && m.emissive.some((x) => x)) set('emissiveColor', C3(m.emissive));
      if (m.ambient && m.ambient.some((x) => x)) set('ambientColor', C3(m.ambient));
      if (m.specularPower !== undefined && m.specularPower !== 64) set('specularPower', n(m.specularPower));
      if (m.disableLighting) set('disableLighting', 'true');
      if (m.useAlphaFromDiffuseTexture) set('useAlphaFromDiffuseTexture', 'true');
      if (m.alphaCutOff !== undefined && m.alphaCutOff !== 0.4) set('alphaCutOff', n(m.alphaCutOff));
      set('diffuseTexture', texture(m.diffuseTexture, m.name));
      set('emissiveTexture', texture(m.emissiveTexture, m.name));
      set('opacityTexture', texture(m.opacityTexture, m.name));
      for (const key of ['bumpTexture', 'specularTexture', 'reflectionTexture', 'refractionTexture', 'lightmapTexture', 'ambientTexture']) {
        if (m[key]) fail(`material "${m.name}": ${key} is not supported`);
      }
    } else if (m.customType === 'BABYLON.PBRMaterial') {
      L.push(`const ${variable} = new ${use('Materials/PBR/pbrMaterial', 'PBRMaterial')}(${s(m.name)}, scene);`, `${variable}.id = ${s(m.id)};`);
      if (m.albedo) set('albedoColor', C3(m.albedo));
      if (m.metallic !== undefined && m.metallic !== null) set('metallic', n(m.metallic));
      if (m.roughness !== undefined && m.roughness !== null) set('roughness', n(m.roughness));
      if (m.emissive && m.emissive.some((x) => x)) set('emissiveColor', C3(m.emissive));
      set('albedoTexture', texture(m.albedoTexture, m.name));
      for (const key of ['bumpTexture', 'metallicTexture', 'reflectivityTexture', 'emissiveTexture', 'opacityTexture', 'reflectionTexture', 'lightmapTexture', 'ambientTexture']) {
        if (m[key]) fail(`material "${m.name}": ${key} is not supported`);
      }
    } else {
      fail(`material "${m.name}": type ${m.customType} is not supported`);
    }
    for (const [plugin, data] of Object.entries(m.plugins ?? {})) {
      if (data?.isEnabled) fail(`material "${m.name}": plugin ${plugin} is not supported`);
    }
    if (m.alpha !== undefined && m.alpha !== 1) set('alpha', n(m.alpha));
    if (m.backFaceCulling === false) set('backFaceCulling', 'false');
    if (m.transparencyMode !== undefined && m.transparencyMode !== null) set('transparencyMode', m.transparencyMode);
    if (m.disableDepthWrite) set('disableDepthWrite', 'true');
    if (m.wireframe) set('wireframe', 'true');
    if (m.zOffset) set('zOffset', n(m.zOffset));
  }

  // --- meshes ---------------------------------------------------------------------------------------
  const meshVars = [];
  const vertexData = new Map((src.geometries?.vertexData ?? []).map((g) => [g.id, g]));
  for (const m of src.meshes ?? []) {
    if (m.type && m.type !== 'Mesh') fail(`mesh "${m.name}": type ${m.type} is not supported`);
    if (m.instances?.length) fail(`mesh "${m.name}": instances are not supported`);
    if (m.skeletonId !== undefined && m.skeletonId !== null && m.skeletonId !== -1) fail(`mesh "${m.name}": skeletons are not supported`);
    if (m.lodMeshIds?.length) fail(`mesh "${m.name}": LODs are not supported`);
    if (m.actions) fail(`mesh "${m.name}": actions are not supported`);
    if (m.physicsImpostor || m.metadata?.physicsAggregate) fail(`mesh "${m.name}": physics is not supported`);
    if (m.positions || (m.geometryId && vertexData.has(m.geometryId))) {
      fail(`mesh "${m.name}": inline geometry is not supported, export the scene from the Babylon.js Editor (binary geometry)`);
    }
    const variable = name('mesh', m);
    meshVars.push(variable);
    L.push(`const ${variable} = new ${use('Meshes/mesh', 'Mesh')}(${s(m.name)}, scene);`, `${variable}.id = ${s(m.id)};`);
    transform(variable, m);
    common(variable, m);
    if (m.isVisible === false) L.push(`${variable}.isVisible = false;`);
    if (m.pickable === false) L.push(`${variable}.isPickable = false;`);
    if (m.receiveShadows) L.push(`${variable}.receiveShadows = true;`);
    if (m.checkCollisions) L.push(`${variable}.checkCollisions = true;`);
    if (m.visibility !== undefined && m.visibility !== 1) L.push(`${variable}.visibility = ${n(m.visibility)};`);
    if (m.alphaIndex !== undefined && m.alphaIndex !== null && m.alphaIndex < 1e300) L.push(`${variable}.alphaIndex = ${m.alphaIndex};`);
    if (m.renderingGroupId) L.push(`${variable}.renderingGroupId = ${m.renderingGroupId};`);
    if (m.layerMask !== undefined && m.layerMask !== 0x0fffffff) L.push(`${variable}.layerMask = ${m.layerMask};`);
    if (m.sideOrientation !== undefined) L.push(`${variable}.sideOrientation = ${m.sideOrientation};`);
    const materialRefId = m.materialUniqueId ?? m.materialId;
    if (materialRefId !== undefined && materialRefId !== null) {
      const material = materialRef.get(materialRefId) ?? materialRef.get(m.materialId);
      if (!material) fail(`mesh "${m.name}": material ${m.materialId} missing`);
      L.push(`${variable}.material = ${material};`);
    }
    if (m.delayLoadingFile) {
      const kinds = [];
      if (m.hasUVs) kinds.push('UVKind');
      if (m.hasUVs2) kinds.push('UV2Kind');
      if (m.hasColors) kinds.push('ColorKind');
      for (const key of ['hasUVs3', 'hasUVs4', 'hasUVs5', 'hasUVs6', 'hasMatricesIndices', 'hasMatricesWeights']) {
        if (m[key]) fail(`mesh "${m.name}": ${key} is not supported`);
      }
      const kindList = kinds.map((kind) => `${use('Buffers/buffer', 'VertexBuffer')}.${kind}`).join(', ');
      L.push(
        `lazy(${variable}, rootUrl + ${s(m.delayLoadingFile)}, ${s(m._binaryInfo ?? null)}, [${v(m.boundingBoxMinimum)}], [${v(m.boundingBoxMaximum)}], [${kindList}]);`,
      );
    }
  }

  // --- lights ------------------------------------------------------------------------------------
  for (const l of src.lights ?? []) {
    const variable = name('light', l);
    if (l.type === 1) {
      L.push(`const ${variable} = new ${use('Lights/directionalLight', 'DirectionalLight')}(${s(l.name)}, ${V3(l.direction)}, scene);`);
      if (l.position) L.push(`${variable}.position = ${V3(l.position)};`);
    } else if (l.type === 3) {
      L.push(`const ${variable} = new ${use('Lights/hemisphericLight', 'HemisphericLight')}(${s(l.name)}, ${V3(l.direction)}, scene);`);
      if (l.groundColor) L.push(`${variable}.groundColor = ${C3(l.groundColor)};`);
    } else if (l.type === 0) {
      L.push(`const ${variable} = new ${use('Lights/pointLight', 'PointLight')}(${s(l.name)}, ${V3(l.position)}, scene);`);
    } else {
      fail(`light "${l.name}": type ${l.type} is not supported`);
    }
    L.push(`${variable}.id = ${s(l.id)};`);
    if (l.diffuse) L.push(`${variable}.diffuse = ${C3(l.diffuse)};`);
    if (l.specular) L.push(`${variable}.specular = ${C3(l.specular)};`);
    if (l.intensity !== undefined) L.push(`${variable}.intensity = ${n(l.intensity)};`);
    if (l.range !== undefined && l.range < 1e300) L.push(`${variable}.range = ${n(l.range)};`);
    if (l.isEnabled === false) L.push(`${variable}.setEnabled(false);`);
    if (l.includedOnlyMeshesIds?.length || l.excludedMeshesIds?.length) fail(`light "${l.name}": mesh include/exclude lists are not supported`);
    common(variable, l);
  }

  // --- shadow generators (same filter precedence as ShadowGenerator.Parse) -------------------------
  for (const g of src.shadowGenerators ?? []) {
    if (g.className && g.className !== 'ShadowGenerator') fail(`${g.className} is not supported`);
    const variable = `shadows${k++}`;
    const light = byRef.get(g.lightId) ?? fail(`shadow generator: light ${g.lightId} missing`);
    use('Lights/Shadows/shadowGeneratorSceneComponent');
    L.push(
      `const ${variable} = new ${use('Lights/Shadows/shadowGenerator', 'ShadowGenerator')}(${g.mapSize}, ${light});`,
      `${variable}.bias = ${n(g.bias ?? 0.00005)}; ${variable}.normalBias = ${n(g.normalBias ?? 0)}; ${variable}.darkness = ${n(g.darkness ?? 0)};`,
    );
    const filter = ['usePercentageCloserFiltering', 'useContactHardeningShadow', 'usePoissonSampling', 'useExponentialShadowMap',
      'useBlurExponentialShadowMap', 'useCloseExponentialShadowMap', 'useBlurCloseExponentialShadowMap'].find((f) => g[f]);
    if (filter) L.push(`${variable}.${filter} = true;`);
    if (g.filteringQuality !== undefined) L.push(`${variable}.filteringQuality = ${g.filteringQuality};`);
    for (const id of g.renderList ?? []) L.push(`${variable}.addShadowCaster(${byRef.get(id) ?? fail(`shadow caster ${id} missing`)}, false);`);
  }

  // --- cameras ---------------------------------------------------------------------------------------
  for (const c of src.cameras ?? []) {
    const types = { FreeCamera: ['Cameras/freeCamera', 'FreeCamera'], UniversalCamera: ['Cameras/universalCamera', 'UniversalCamera'], TargetCamera: ['Cameras/targetCamera', 'TargetCamera'] };
    const type = types[c.type] ?? fail(`camera "${c.name}": type ${c.type} is not supported`);
    const variable = name('camera', c);
    L.push(`const ${variable} = new ${use(...type)}(${s(c.name)}, ${V3(c.position)}, scene);`, `${variable}.id = ${s(c.id)};`);
    if (c.rotationQuaternion) L.push(`${variable}.rotationQuaternion = new ${use('Maths/math.vector', 'Quaternion')}(${v(c.rotationQuaternion)});`);
    else if (c.rotation) L.push(`${variable}.rotation.set(${v(c.rotation)});`);
    L.push(`${variable}.fov = ${n(c.fov)}; ${variable}.minZ = ${n(c.minZ)}; ${variable}.maxZ = ${n(c.maxZ)};`);
    if (c.mode) {
      L.push(`${variable}.mode = ${c.mode};`);
      for (const key of ['orthoLeft', 'orthoRight', 'orthoTop', 'orthoBottom']) if (c[key] !== undefined && c[key] !== null) L.push(`${variable}.${key} = ${n(c[key])};`);
    }
    if (c.isEnabled === false) L.push(`${variable}.setEnabled(false);`);
    common(variable, c);
  }
  const active = (src.cameras ?? []).find((c) => c.id === src.activeCameraID) ?? src.cameras?.[0];
  if (active) L.push(`scene.activeCamera = ${byRef.get(active.id)};`);

  // --- parents (once everything exists) --------------------------------------------------------------
  for (const o of [...(src.transformNodes ?? []), ...(src.meshes ?? []), ...(src.lights ?? []), ...(src.cameras ?? [])]) {
    if (o.parentId === undefined || o.parentId === null) continue;
    L.push(`${byRef.get(o.id)}.parent = ${byRef.get(o.parentId) ?? fail(`"${o.name}": parent ${o.parentId} missing`)};`);
  }

  // --- scripts --------------------------------------------------------------------------------------
  for (const { variable, scripts, label } of scripted) {
    for (const script of scripts) {
      if (!script.enabled) continue;
      const values = Object.entries(script.values ?? {}).map(([key, value]) => {
        return `${s(key)}: ${scriptValue(value, () => fail(`"${label}": script value ${script.key}.${key} of type ${value.type} is not supported`))}`;
      });
      L.push(`attach(${variable}, ${s(script.key)}, { ${values.join(', ')} });`);
    }
  }

  return `function ${fn}(rootUrl: string, scene: Scene, attach: Attach): Mesh[] {\n\t${L.join('\n\t')}\n\treturn [${meshVars.join(', ')}];\n}`;
}

function isIdentity(m) {
  return m.every((x, i) => x === (i % 5 === 0 ? 1 : 0));
}

/**
 * The module that replaces babylonjs-editor-tools in a build: `loadScene` builds the compiled scenes,
 * the rest of what an editor project's src/scripts.ts imports is stubbed.
 * @param {{ file: string; data: object }[]} scenes exported scenes, by file name
 * @param {string} header comment naming the sources
 */
export function compileModule(scenes, header, options = {}) {
  const imports = new Imports();
  imports.use(`${CORE}/Meshes/mesh`, 'Mesh');
  imports.use(`${CORE}/Meshes/geometry`, 'Geometry');
  imports.use(`${CORE}/Maths/math.vector`, 'Vector3');
  imports.use(`${CORE}/Engines/constants`, 'Constants');
  imports.use(`${CORE}/Loading/sceneLoaderFlags`, 'SceneLoaderFlags');
  const functions = scenes.map((scene, i) => compileScene(scene.data, scene.file, imports, `scene${i}`, options));
  const table = scenes.map((scene, i) => `\t${s(scene.file)}: scene${i},`).join('\n');
  return `${header}
// Do not edit: change the scene in the Babylon.js Editor, export it, and build again.
/* eslint-disable */
// @ts-nocheck
import type { Scene } from "${CORE}/scene";
${imports.lines().join('\n')}

type ScriptInstance = Record<string, unknown> & { onStart?(): void; onUpdate?(): void; onStop?(): void };
type ScriptModule = { default?: new (object: unknown) => ScriptInstance };
type Attach = (object: { onDisposeObservable: { addOnce(cb: () => void): void } }, key: string, values: Record<string, unknown>) => void;

/** Geometry left in its own file until the mesh needs it, as the .babylon loader does. */
function lazy(mesh: Mesh, file: string, binaryInfo: unknown, min: number[], max: number[], kinds: string[]): void {
\tconst m = mesh as any;
\tm.delayLoadState = Constants.DELAYLOADSTATE_NOTLOADED;
\tm.delayLoadingFile = file;
\tmesh.buildBoundingInfo(Vector3.FromArray(min), Vector3.FromArray(max));
\tif (binaryInfo) m._binaryInfo = binaryInfo;
\tm._delayInfo = kinds;
\tm._delayLoadingFunction = (Geometry as any)._ImportGeometry;
}

${functions.join('\n\n')}

/** Creates a texture without fetching it until a material needs it. */
function delayed<T>(scene: Scene, create: () => T): T {
\tconst previous = scene.useDelayedTextureLoading;
\tscene.useDelayedTextureLoading = true;
\ttry {
\t\treturn create();
\t} finally {
\t\tscene.useDelayedTextureLoading = previous;
\t}
}

const SCENES: Record<string, (rootUrl: string, scene: Scene, attach: Attach) => Mesh[]> = {
${table}
};

export async function loadScene(rootUrl: string, sceneFilename: string, scene: Scene, scriptsMap: Record<string, ScriptModule>, options?: { onProgress?: (p: number) => void }): Promise<void> {
\tconst build = SCENES[sceneFilename];
\tif (!build) throw new Error(\`[babylon-scene-compiler] scene "\${sceneFilename}" was not compiled into this build\`);
\tconst started: ScriptInstance[] = [];
\tconst attach: Attach = (object, key, values) => {
\t\tconst ctor = scriptsMap[key]?.default;
\t\tif (!ctor) throw new Error(\`[babylon-scene-compiler] script \${key} is not in the scripts map\`);
\t\tconst instance = Object.assign(new ctor(object), values);
\t\tstarted.push(instance);
\t\tconst update = instance.onUpdate ? scene.onBeforeRenderObservable.add(() => instance.onUpdate!()) : null;
\t\tobject.onDisposeObservable.addOnce(() => {
\t\t\tupdate?.remove();
\t\t\tinstance.onStop?.();
\t\t});
\t};
\tconst meshes = build(rootUrl, scene, attach);
\tif (SceneLoaderFlags.ForceFullSceneLoadingForIncremental) {
\t\tfor (const mesh of meshes) mesh._checkDelayState();
\t\twhile (!scene.isDisposed && meshes.some((mesh) => mesh.delayLoadState === Constants.DELAYLOADSTATE_LOADING)) await new Promise((r) => setTimeout(r, 16));
\t}
\tawait new Promise<void>((resolve) => scene.executeWhenReady(() => resolve()));
\tfor (const instance of started) instance.onStart?.();
\toptions?.onProgress?.(1);
}

// Inspector and scene decorators only carry editor metadata; values come from the scene above.
const decorator = () => () => {};
export const visibleAsNumber = decorator, visibleAsBoolean = decorator, visibleAsString = decorator, visibleAsVector2 = decorator,
\tvisibleAsVector3 = decorator, visibleAsColor3 = decorator, visibleAsColor4 = decorator, visibleAsEntity = decorator,
\tvisibleAsTexture = decorator, visibleAsKeyMap = decorator, visibleAsAsset = decorator;
export type IScript = Record<string, unknown>;
// Exported by the editor-generated src/scripts.ts; nothing uses them once the scene is code.
export const scriptsDictionary = new Map(), scriptAssetsCache = new Map();
export const _applyScriptsForObject = () => {}, _removeRegisteredScriptInstance = () => {}, _preloadScriptsAssets = async () => 0;
const none = () => null;
export const getDefaultRenderingPipeline = none, getSSAO2RenderingPipeline = none, getMotionBlurPostProcess = none,
\tgetSSRRenderingPipeline = none, getTAARenderingPipeline = none, getVLSPostProcess = none, getVolumetricLightingRenderingPipeline = none;
`;
}

/** Names the generated module provides; other imports from babylonjs-editor-tools stop the build. */
export const PROVIDED = new Set([
  'loadScene', 'scriptsDictionary', 'scriptAssetsCache', '_applyScriptsForObject', '_removeRegisteredScriptInstance', '_preloadScriptsAssets',
  'getDefaultRenderingPipeline', 'getSSAO2RenderingPipeline', 'getMotionBlurPostProcess', 'getSSRRenderingPipeline', 'getTAARenderingPipeline',
  'getVLSPostProcess', 'getVolumetricLightingRenderingPipeline', 'visibleAsNumber', 'visibleAsBoolean', 'visibleAsString', 'visibleAsVector2',
  'visibleAsVector3', 'visibleAsColor3', 'visibleAsColor4', 'visibleAsEntity', 'visibleAsTexture', 'visibleAsKeyMap', 'visibleAsAsset', 'IScript',
]);
