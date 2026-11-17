import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { applyImages, collectImages } from '../src/images.mjs';

test('collects textures and images used by GUI assets', () => {
  const dir = mkdtempSync(join(tmpdir(), 'bsc-'));
  mkdirSync(join(dir, 'assets'));
  writeFileSync(join(dir, 'assets/hud.gui'), JSON.stringify({ guiType: 'fullscreen', content: { root: { children: [{ source: 'assets/logo.png' }, { text: 'hi' }] } } }));
  const data = {
    materials: [{ name: 'm', albedoTexture: { name: 'assets/sand.png', url: 'assets/sand.png' }, diffuse: [1, 1, 1] }],
    transformNodes: [{ name: 'Root', metadata: { scripts: [{ key: 's.ts', values: { hud: { type: 'asset', value: 'assets/hud.gui' } } }] } }],
  };
  const { images, guis } = collectImages([{ data }], dir);
  assert.deepEqual([...images].sort(), ['assets/logo.png', 'assets/sand.png']);
  assert.deepEqual([...guis.get('assets/hud.gui')], ['assets/logo.png']);
});

test('applies encoded images to the build output and the GUI files', () => {
  const out = mkdtempSync(join(tmpdir(), 'bsc-out-'));
  const cache = mkdtempSync(join(tmpdir(), 'bsc-cache-'));
  mkdirSync(join(out, 'assets'));
  mkdirSync(join(cache, 'assets'));
  writeFileSync(join(out, 'assets/logo.png'), Buffer.alloc(1000));
  writeFileSync(join(out, 'assets/keep.png'), Buffer.alloc(1000));
  writeFileSync(join(cache, 'assets/logo.webp'), Buffer.alloc(100));
  writeFileSync(join(cache, 'assets/keep.webp'), Buffer.alloc(100));
  writeFileSync(join(out, 'assets/hud.gui'), JSON.stringify({ content: { source: 'assets/logo.png' } }));
  const result = applyImages({
    outSceneDir: out, cacheDir: cache, keepOriginals: false, code: 'img.source = "assets/keep.png"',
    map: { 'assets/logo.png': 'assets/logo.webp', 'assets/keep.png': 'assets/keep.webp' },
    guis: new Map([['assets/hud.gui', new Set(['assets/logo.png'])]]),
  });
  assert.equal(result.written, 2);
  assert.equal(result.removed, 1);
  assert.ok(existsSync(join(out, 'assets/logo.webp')));
  assert.ok(!existsSync(join(out, 'assets/logo.png')), 'unreferenced original removed');
  assert.ok(existsSync(join(out, 'assets/keep.png')), 'original still named by code is kept');
  assert.ok(readFileSync(join(out, 'assets/hud.gui'), 'utf8').includes('"assets/logo.webp"'));
});
