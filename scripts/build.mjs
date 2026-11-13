// Bundle the Dot client into dist/client.js.
// React and the host UI primitives are provided by the host ModuleLoader, never bundled.
import { build } from 'esbuild';
import { execFileSync } from 'node:child_process';
import { mkdir } from 'node:fs/promises';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));

const pkg = JSON.parse(await readFile(new URL('../package.json', import.meta.url), 'utf8'));

let sha = 'dev';
try {
  sha = execFileSync('git', ['rev-parse', '--short', 'HEAD'], { encoding: 'utf8', cwd: root }).trim();
} catch {
  // A source export without git still builds; the banner then says "dev".
}

await mkdir(new URL('../dist', import.meta.url), { recursive: true });

const result = await build({
  absWorkingDir: root,
  entryPoints: ['client/index.jsx'],
  outfile: 'dist/client.js',
  bundle: true,
  format: 'cjs',
  platform: 'browser',
  target: 'chrome120',
  jsx: 'transform',
  jsxFactory: 'React.createElement',
  jsxFragment: 'React.Fragment',
  external: ['react', '@deepseek-ai/dsh-client-ui-primitives'],
  loader: { '.css': 'text' },
  minify: !process.argv.includes('--watch'),
  legalComments: 'none',
  metafile: true,
  define: { __DOT_BUILD__: JSON.stringify(sha) },
  logLevel: 'warning',
});

if (process.argv.includes('--watch')) {
  console.log(`watching client/ as ${pkg.name}; run a normal build for a released bundle`);
}

console.log(`dist/client.js built from ${pkg.version} at ${sha} (${Object.keys(result.metafile.inputs).length} inputs)`);
