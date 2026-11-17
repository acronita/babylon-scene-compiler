import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const { setPackageVersion, platformFromLog, zipName, zipDirectory, bsdtar } = createRequire(import.meta.url)('../editor/plugin.cjs')._internal;

test('setPackageVersion rewrites only the version and keeps the formatting', () => {
  const text = '{\n\t"name": "fruit-pool",\n\t"version": "0.1.0",\n\t"dependencies": { "x": "1.0.0" }\n}\n';
  assert.equal(setPackageVersion(text, '0.2.0'), text.replace('"0.1.0"', '"0.2.0"'));
  assert.equal(setPackageVersion(text, '1.0.0-rc.1'), text.replace('"0.1.0"', '"1.0.0-rc.1"'));
});

test('setPackageVersion rejects anything that is not semver', () => {
  assert.throws(() => setPackageVersion('{"version": "1.0.0"}', '1.0'), /not a version/);
  assert.throws(() => setPackageVersion('{"name": "a"}', '1.0.0'), /no "version"/);
});

test('platformFromLog reads the platform layer line', () => {
  assert.equal(platformFromLog(['vite v6', '[platform] target: poki (node "PlatformPoki")', 'built']), 'poki');
  assert.equal(platformFromLog(['vite v6', 'built']), null);
});

test('zipName joins name, platform and version with safe characters', () => {
  assert.equal(zipName('fruit-pool', 'poki', '0.1.1'), 'fruit-pool-poki-0.1.1.zip');
  assert.equal(zipName('fruit-pool', 'local', '0.1.1'), 'fruit-pool-0.1.1.zip');
  assert.equal(zipName('@izy/My Game', null, '1.0.0'), 'My-Game-1.0.0.zip');
});

test('zipDirectory puts the content of the folder at the zip root', async () => {
  const root = mkdtempSync(join(tmpdir(), 'bsc-zip-'));
  const dist = join(root, 'dist');
  mkdirSync(join(dist, 'assets'), { recursive: true });
  writeFileSync(join(dist, 'index.html'), '<!doctype html>');
  writeFileSync(join(dist, 'assets', 'a.js'), 'x');
  const zip = join(root, 'builds', 'game-1.0.0.zip');
  await zipDirectory(dist, zip);
  assert.ok(existsSync(zip));
  const list = execFileSync(process.platform === 'linux' ? 'unzip' : bsdtar(), process.platform === 'linux' ? ['-Z1', zip] : ['-tf', zip], { encoding: 'utf8' }).split(/\r?\n/).filter(Boolean);
  assert.ok(!list.some((l) => l.startsWith('./')), `no "./" prefix: ${list.join(', ')}`);
  assert.ok(list.includes('index.html'), `index.html at the root: ${list.join(', ')}`);
  assert.ok(list.some((l) => l.startsWith('assets/')));
});
