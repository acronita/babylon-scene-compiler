import { test } from 'node:test';
import assert from 'node:assert/strict';
import { SceneCompileError, compileModule } from '../src/compile.mjs';

const scene = (extra = {}) => ({
  clearColor: [0, 0, 0, 1],
  useRightHandedSystem: false,
  materials: [{ id: 'm1', uniqueId: 11, name: 'Paper', diffuse: [1, 0.5, 0], specular: [0, 0, 0], alpha: 1 }],
  transformNodes: [{ id: 'n1', uniqueId: 1, name: 'Root', position: [0, 0, 0], scaling: [1, 1, -1], metadata: { scripts: [{ enabled: true, key: 'scripts/a.ts', values: { speed: { type: 'number', value: 2 } } }] } }],
  meshes: [{
    id: 'mesh1', uniqueId: 2, name: 'Box', parentId: 1, position: [1, 2, 3], scaling: [1, 1, 1], materialId: 'm1', materialUniqueId: 11,
    delayLoadingFile: 'scene/g1.babylonbinarymeshdata', _binaryInfo: { positionsAttrDesc: { count: 9, stride: 3, offset: 0, dataType: 1 } },
    boundingBoxMinimum: [-1, -1, -1], boundingBoxMaximum: [1, 1, 1], hasUVs: true, sideOrientation: 1, isEnabled: false,
  }],
  lights: [{ id: 'l1', name: 'Sun', type: 1, direction: [0, -1, 0], position: [0, 10, 0], diffuse: [1, 1, 1], specular: [0, 0, 0], intensity: 0.7 }],
  cameras: [{ id: 'c1', name: 'Camera', type: 'FreeCamera', position: [0, 5, -10], rotation: [0.5, 0, 0], fov: 0.8, minZ: 0.1, maxZ: 100 }],
  activeCameraID: 'c1',
  ...extra,
});

test('rebuilds names, ids, parents, materials, lights, camera and scripts', () => {
  const code = compileModule([{ file: 'a.babylon', data: scene() }], '// test');
  for (const expected of [
    'new TransformNode("Root", scene)',
    '.scaling.set(1, 1, -1)',
    'new Mesh("Box", scene)',
    'new StandardMaterial("Paper", scene)',
    '.diffuseColor = new Color3(1, 0.5, 0)',
    '.parent = node0',
    '.setEnabled(false)',
    '.sideOrientation = 1',
    'lazy(mesh',
    'rootUrl + "scene/g1.babylonbinarymeshdata"',
    'new DirectionalLight("Sun"',
    'new FreeCamera("Camera"',
    'scene.activeCamera = camera',
    'attach(node0, "scripts/a.ts", { "speed": 2 })',
    '"a.babylon": scene0',
  ]) {
    assert.ok(code.includes(expected), `missing: ${expected}`);
  }
  assert.ok(!code.includes('babylonFileLoader'));
});

test('script values of colour and vector types become their classes', () => {
  const values = {
    tint: { type: 'color3', value: [0.1, 0.2, 0.3] },
    glow: { type: 'color4', value: [1, 0, 0, 0.5] },
    offset: { type: 'vector3', value: [1, 2, 3] },
    size: { type: 'vector2', value: [4, 5] },
  };
  const data = scene({ transformNodes: [{ id: 'n1', uniqueId: 1, name: 'Root', position: [0, 0, 0], scaling: [1, 1, 1], metadata: { scripts: [{ enabled: true, key: 'scripts/a.ts', values }] } }] });
  const code = compileModule([{ file: 'a.babylon', data }], '// test');
  assert.ok(
    code.includes('attach(node0, "scripts/a.ts", { "tint": new Color3(0.1, 0.2, 0.3), "glow": new Color4(1, 0, 0, 0.5), "offset": new Vector3(1, 2, 3), "size": new Vector2(4, 5) })'),
    'colour and vector values',
  );
  assert.match(code, /import \{[^}]*Vector2[^}]*\} from "@babylonjs\/core\/Maths\/math\.vector"/);
});

test('textures load with the scene unless lazyTextures', () => {
  const data = scene();
  data.materials[0].diffuseTexture = { name: 'assets/a.png', url: 'assets/a.png', hasAlpha: true, uScale: 2 };
  const eager = compileModule([{ file: 'a.babylon', data }], '// test');
  const lazy = compileModule([{ file: 'a.babylon', data }], '// test', { lazyTextures: true });
  assert.ok(eager.includes('= new Texture(rootUrl + "assets/a.png"'));
  assert.ok(lazy.includes('= delayed(scene, () => new Texture(rootUrl + "assets/a.png"'));
  assert.ok(lazy.includes('.uScale = 2'));
});

test('fails loud on what it cannot translate', () => {
  const cases = [
    scene({ fogMode: 1 }),
    scene({ meshes: [{ id: 'x', name: 'Inline', positions: [0, 0, 0], position: [0, 0, 0] }] }),
    scene({ lights: [{ id: 'l', name: 'Spot', type: 2 }] }),
    scene({ metadata: { rendering: [{ cameraId: 'c1', defaultRenderingPipeline: { bloom: true } }] } }),
  ];
  for (const data of cases) assert.throws(() => compileModule([{ file: 'a.babylon', data }], '// test'), SceneCompileError);
});
