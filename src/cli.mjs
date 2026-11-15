#!/usr/bin/env node
// babylon-scene-compiler [project dir] [--scene name.babylon]...
// Writes <project>/.babylon-compiled/scene.generated.ts from the editor's exported scenes.
import { resolve } from 'node:path';
import { compileProject } from './project.mjs';

const args = process.argv.slice(2);
const scenes = [];
let root = '.';
for (let i = 0; i < args.length; i++) {
  if (args[i] === '--scene') scenes.push(args[++i]);
  else root = args[i];
}
try {
  const out = compileProject({ root: resolve(root), scenes: scenes.length ? scenes : undefined });
  console.log(`compiled ${out.scenes.join(', ')} -> ${out.module}`);
} catch (error) {
  console.error(error.message);
  process.exit(1);
}
