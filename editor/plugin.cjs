// Babylon.js Editor (5.5) plugin: a "Compiler" tab next to the inspector with a "Compiled build"
// button. It exports the project (the same as the editor's own File > Export) and runs the
// project's `npm run build`, where the Vite plugin compiles the exported scenes to code. Then it
// zips dist/ into builds/<name>-<platform>-<version>.zip, ready to upload (index.html at the zip
// root). The version field edits package.json "version" before the build.
//
// Add it to project.bjseditor:  "plugins": [{ "nameOrPath": "babylon-scene-compiler/editor" }]
// (installed in the project's node_modules), or with an absolute path to this folder.
//
// `react` resolves to the editor's own copy (the editor overrides module loading for plugins), so
// the tab is a plain React component without JSX or a build step.
const { spawn } = require('child_process');
const { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } = require('fs');
const { dirname, join } = require('path');

exports.title = 'Babylon scene compiler';
exports.description = 'Compiles the exported scenes to Babylon.js code and builds the project without the editor runtime.';

const TAB_ID = 'babylon-scene-compiler-tab';
const VERSION_PATTERN = /^\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.-]+)?$/;

/** { name, version } from the project's package.json. */
function readPackage(project) {
  const pkg = JSON.parse(readFileSync(join(project, 'package.json'), 'utf8'));
  return { name: String(pkg.name || 'game'), version: String(pkg.version || '0.0.0') };
}

/** Rewrites only the top-level "version" value, keeping the file's formatting. */
function setPackageVersion(text, version) {
  if (!VERSION_PATTERN.test(version)) throw new Error(`"${version}" is not a version like 1.2.3`);
  const match = /^([ \t]*"version"\s*:\s*)"[^"]*"/m.exec(text);
  if (!match) throw new Error('package.json has no "version" field');
  return text.slice(0, match.index) + `${match[1]}"${version}"` + text.slice(match.index + match[0].length);
}

/** Platform the build targeted, from the platform layer's `[platform] target: <id>` log line. */
function platformFromLog(lines) {
  for (const line of lines) {
    const match = /\[platform\] target: ([a-z0-9]+)/.exec(line);
    if (match) return match[1];
  }
  return null;
}

/** fruit-pool-poki-1.2.3.zip: file-name-safe (YouTube/Poki only accept [A-Za-z0-9_.-]). */
function zipName(name, platform, version) {
  const safe = (part) => part.replace(/^@[^/]+\//, '').replace(/[^A-Za-z0-9_.-]+/g, '-');
  return [name, platform && platform !== 'local' ? platform : null, version].filter(Boolean).map(safe).join('-') + '.zip';
}

/** The system bsdtar: Windows ships it in System32 (the `tar` on PATH may be Git's GNU tar, which reads "C:" as a remote host); macOS has it on PATH. */
function bsdtar() {
  return process.platform === 'win32' ? join(process.env.SystemRoot || 'C:\\Windows', 'System32', 'tar.exe') : 'tar';
}

/** Zips the CONTENT of `dir` (index.html at the zip root) into `zipPath`. */
function zipDirectory(dir, zipPath) {
  if (existsSync(zipPath)) rmSync(zipPath);
  mkdirSync(dirname(zipPath), { recursive: true });
  // bsdtar (Windows 10+, macOS) writes zip with -a; elsewhere fall back to Info-ZIP.
  const [command, args, cwd] =
    process.platform === 'win32' || process.platform === 'darwin'
      ? [bsdtar(), ['-a', '-c', '-f', zipPath, '-C', dir, '.'], undefined]
      : ['zip', ['-r', '-q', zipPath, '.'], dir];
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { cwd });
    let errors = '';
    child.stderr.on('data', (data) => (errors += data));
    child.on('error', reject);
    child.on('close', (code) => (code === 0 ? resolve() : reject(new Error(`${command} exited with ${code}: ${errors.trim()}`))));
  });
}

let fallbackButton = null;

/** Newest modification time among the exported scenes, 0 if none. */
function exportedAt(project) {
  const dir = join(project, 'public', 'scene');
  if (!existsSync(dir)) return 0;
  return Math.max(0, ...readdirSync(dir).filter((f) => f.endsWith('.babylon')).map((f) => statSync(join(dir, f)).mtimeMs));
}

async function waitForExport(project, before) {
  // The export writes the .babylon last; wait until it is newer and has stopped changing.
  for (let i = 0; i < 600; i++) {
    await new Promise((r) => setTimeout(r, 250));
    const now = exportedAt(project);
    if (now > before) {
      await new Promise((r) => setTimeout(r, 500));
      if (exportedAt(project) === now) return true;
    }
  }
  return false;
}

/** Saves `version`, exports, runs `npm run build`, zips dist/; every line goes to `log` and to the editor's console. Returns the zip path. */
async function compiledBuild(editor, log, version) {
  const console = editor.layout.console;
  const say = (line, error = false) => {
    log(line);
    if (error) console.error(line);
    else console.log(line);
  };
  const project = dirname(editor.state.projectPath);
  if (version) {
    const file = join(project, 'package.json');
    const text = readFileSync(file, 'utf8');
    const next = setPackageVersion(text, version.trim());
    if (next !== text) {
      writeFileSync(file, next);
      say(`[compiler] package.json version -> ${version.trim()}`);
    }
  }
  say('[compiler] Exporting the project...');
  const before = exportedAt(project);
  // Same event as the editor's own export; it has no awaitable entry point for plugins.
  require('electron').ipcRenderer.emit('generate', {});
  if (!(await waitForExport(project, before))) throw new Error('the export did not finish');
  say('[compiler] Building (npm run build)...');
  const output = [];
  const code = await new Promise((resolve) => {
    const child = spawn('npm', ['run', 'build'], { cwd: project, shell: true });
    const out = (data) =>
      String(data)
        .split(/\r?\n/)
        .filter(Boolean)
        .forEach((line) => {
          const clean = line.replace(/\x1b\[[0-9;]*m/g, '');
          output.push(clean);
          say(clean);
        });
    child.stdout.on('data', out);
    child.stderr.on('data', out);
    child.on('close', resolve);
  });
  if (code !== 0) throw new Error(`npm run build exited with ${code}`);
  const pkg = readPackage(project);
  const zip = join(project, 'builds', zipName(pkg.name, platformFromLog(output), pkg.version));
  say('[compiler] Zipping dist/...');
  await zipDirectory(join(project, 'dist'), zip);
  say(`[compiler] Compiled build ready in dist/ and ${zip}`);
  return zip;
}

function createTab(editor) {
  const React = require('react');
  const h = React.createElement;
  function CompilerTab() {
    const [running, setRunning] = React.useState(false);
    const [lines, setLines] = React.useState([]);
    const [result, setResult] = React.useState(null);
    const [version, setVersion] = React.useState(() => {
      try {
        return readPackage(dirname(editor.state.projectPath)).version;
      } catch {
        return '';
      }
    });
    const validVersion = VERSION_PATTERN.test(version.trim());
    const run = async () => {
      setRunning(true);
      setLines([]);
      setResult(null);
      try {
        const zip = await compiledBuild(editor, (line) => setLines((all) => [...all.slice(-400), line]), version);
        setResult({ ok: true, text: `Build ready: dist/ and builds/${zip.split(/[\\/]/).pop()}` });
      } catch (error) {
        editor.layout.console.error(`[compiler] ${error.message}`);
        setResult({ ok: false, text: error.message });
      } finally {
        setRunning(false);
      }
    };
    return h(
      'div',
      { style: { display: 'flex', flexDirection: 'column', gap: 10, padding: 12, height: '100%', boxSizing: 'border-box' } },
      h(
        'label',
        { style: { display: 'flex', alignItems: 'center', gap: 8, fontSize: 12 } },
        'Version',
        h('input', {
          value: version,
          disabled: running,
          onChange: (event) => setVersion(event.target.value),
          style: { flex: 1, padding: '4px 6px', borderRadius: 4, border: `1px solid ${validVersion ? '#555' : '#ff5a5f'}`, background: 'transparent', color: 'inherit' },
        }),
      ),
      h(
        'button',
        {
          onClick: run,
          disabled: running || !validVersion,
          style: { padding: '8px 14px', borderRadius: 6, border: 0, background: running ? '#555' : '#3a8dff', color: 'white', fontWeight: 600, cursor: running ? 'default' : 'pointer' },
        },
        running ? 'Building...' : 'Compiled build',
      ),
      h('div', { style: { fontSize: 12, opacity: 0.7 } }, 'Saves the version to package.json, exports the scene, compiles it to Babylon.js code, runs npm run build and zips dist/ into builds/<name>-<platform>-<version>.zip.'),
      result && h('div', { style: { fontSize: 12, fontWeight: 600, color: result.ok ? '#36c9a0' : '#ff5a5f' } }, result.text),
      h('pre', { style: { flex: 1, margin: 0, overflow: 'auto', fontSize: 11, whiteSpace: 'pre-wrap', opacity: 0.85 } }, lines.join('\n')),
    );
  }
  editor.layout.addLayoutTab(h(CompilerTab), { id: TAB_ID, title: 'Compiler', neighborId: 'inspector', enableClose: false });
}

/** Floating button, if the layout tab could not be added. */
function createButton(editor) {
  fallbackButton = document.createElement('button');
  fallbackButton.textContent = 'Compiled build';
  fallbackButton.style.cssText =
    'position:fixed;right:16px;bottom:16px;z-index:99999;padding:8px 14px;border:0;border-radius:6px;background:#3a8dff;color:white;font:600 13px system-ui,sans-serif;cursor:pointer';
  fallbackButton.addEventListener('click', async () => {
    fallbackButton.disabled = true;
    editor.layout.selectTab('console');
    try {
      await compiledBuild(editor, () => {});
    } catch (error) {
      editor.layout.console.error(`[compiler] ${error.message}`);
    } finally {
      fallbackButton.disabled = false;
    }
  });
  document.body.append(fallbackButton);
}

// Pure helpers, exported for tests.
exports._internal = { setPackageVersion, platformFromLog, zipName, zipDirectory, bsdtar };

exports.main = (editor) => {
  if (!editor.state.projectPath) return;
  try {
    createTab(editor);
    editor.layout.console.log('[compiler] Compiler tab added next to the inspector.');
  } catch (error) {
    editor.layout.console.warn?.(`[compiler] Could not add the tab (${error.message}); using a floating button instead.`);
    createButton(editor);
  }
};

exports.close = (editor) => {
  try {
    editor.layout.removeLayoutTab(TAB_ID);
  } catch {
    // The tab may not exist.
  }
  fallbackButton?.remove();
  fallbackButton = null;
};
