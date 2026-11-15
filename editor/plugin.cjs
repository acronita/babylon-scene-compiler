// Babylon.js Editor (5.5) plugin: a "Compiler" tab next to the inspector with a "Compiled build"
// button. It exports the project (the same as the editor's own File > Export) and runs the
// project's `npm run build`, where the Vite plugin compiles the exported scenes to code.
//
// Add it to project.bjseditor:  "plugins": [{ "nameOrPath": "babylon-scene-compiler/editor" }]
// (installed in the project's node_modules), or with an absolute path to this folder.
//
// `react` resolves to the editor's own copy (the editor overrides module loading for plugins), so
// the tab is a plain React component without JSX or a build step.
const { spawn } = require('child_process');
const { existsSync, readdirSync, statSync } = require('fs');
const { dirname, join } = require('path');

exports.title = 'Babylon scene compiler';
exports.description = 'Compiles the exported scenes to Babylon.js code and builds the project without the editor runtime.';

const TAB_ID = 'babylon-scene-compiler-tab';
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

/** Exports, then runs `npm run build`; every line goes to `log` and to the editor's console. */
async function compiledBuild(editor, log) {
  const console = editor.layout.console;
  const say = (line, error = false) => {
    log(line);
    if (error) console.error(line);
    else console.log(line);
  };
  const project = dirname(editor.state.projectPath);
  say('[compiler] Exporting the project...');
  const before = exportedAt(project);
  // Same event as the editor's own export; it has no awaitable entry point for plugins.
  require('electron').ipcRenderer.emit('generate', {});
  if (!(await waitForExport(project, before))) throw new Error('the export did not finish');
  say('[compiler] Building (npm run build)...');
  const code = await new Promise((resolve) => {
    const child = spawn('npm', ['run', 'build'], { cwd: project, shell: true });
    const out = (data) =>
      String(data)
        .split(/\r?\n/)
        .filter(Boolean)
        .forEach((line) => say(line.replace(/\x1b\[[0-9;]*m/g, '')));
    child.stdout.on('data', out);
    child.stderr.on('data', out);
    child.on('close', resolve);
  });
  if (code !== 0) throw new Error(`npm run build exited with ${code}`);
  say('[compiler] Compiled build ready in dist/.');
}

function createTab(editor) {
  const React = require('react');
  const h = React.createElement;
  function CompilerTab() {
    const [running, setRunning] = React.useState(false);
    const [lines, setLines] = React.useState([]);
    const [result, setResult] = React.useState(null);
    const run = async () => {
      setRunning(true);
      setLines([]);
      setResult(null);
      try {
        await compiledBuild(editor, (line) => setLines((all) => [...all.slice(-400), line]));
        setResult({ ok: true, text: 'Compiled build ready in dist/.' });
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
        'button',
        {
          onClick: run,
          disabled: running,
          style: { padding: '8px 14px', borderRadius: 6, border: 0, background: running ? '#555' : '#3a8dff', color: 'white', fontWeight: 600, cursor: running ? 'default' : 'pointer' },
        },
        running ? 'Building...' : 'Compiled build',
      ),
      h('div', { style: { fontSize: 12, opacity: 0.7 } }, 'Exports the scene, compiles it to Babylon.js code and runs npm run build. The output goes to dist/.'),
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
