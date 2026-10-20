import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const builder = fileURLToPath(new URL('../scripts/build-release.py', import.meta.url));
const originalHash = '993e1e1afce3c0dcd2610bf9e84ffbfd6d08768f5c4b4fa30eeec50dc2e97d3f';
const forkHash = 'b40031cd0928c9df76a864d6ff15bc3fe7356b6298ad2758b6272f127f965878';
function python(source) {
  const bootstrap = 'import importlib.util, sys\nsys.dont_write_bytecode=True\nspec=importlib.util.spec_from_file_location("release",sys.argv[1])\nrelease=importlib.util.module_from_spec(spec)\nspec.loader.exec_module(release)\n';
  const result = spawnSync('python3', ['-c', bootstrap + source, builder], { encoding: 'utf8', timeout: 10000 });
  assert.equal(result.status, 0, result.stderr || result.stdout);
  return result.stdout;
}

test('release builder accepts only the two reviewed exact bridge archive pins', () => {
  const rows = JSON.parse(python(`import json\nprint(json.dumps([release.reviewed_bridge("dsh-wechat-0.11.0.tgz","${originalHash}"),release.reviewed_bridge("dsh-wechat-0.11.1-dot.1.tgz","${forkHash}")]))\n`));
  assert.deepEqual(rows.map(row => [row.name, row.version]), [['dsh-wechat', '0.11.0'], ['dsh-wechat', '0.11.1-dot.1']]);
  assert.equal(rows[0].sourceKind, 'original_npm');
  assert.equal(rows[1].sourceKind, 'dot_maintained_fork');
  assert.equal(rows[1].sourceCommit, '1f28de0f5a9d338db884ff5b84e90e9572eaf1cc');
});

test('renaming, hash substitution and arbitrary bridge versions cannot bypass the builder pin', () => {
  const invalid = [
    ['dsh-wechat-0.11.0.tgz', forkHash], ['dsh-wechat-0.11.1-dot.1.tgz', originalHash],
    ['dsh-wechat-0.11.1-dot.2.tgz', forkHash], ['unreviewed.tgz', forkHash],
    ['dsh-wechat-0.11.1-dot.1.tgz', '0'.repeat(64)],
  ];
  python(`import json\nfor name,sha in json.loads(${JSON.stringify(JSON.stringify(invalid))}):\n try:\n  release.reviewed_bridge(name,sha)\n except ValueError:\n  pass\n else:\n  raise AssertionError("unreviewed archive accepted: "+name)\n`);
});

test('release archive audit rejects inner bridge metadata that differs from the reviewed version', () => {
  python('import io,json,tarfile,tempfile\nfrom pathlib import Path\nwith tempfile.TemporaryDirectory() as directory:\n path=Path(directory)/"synthetic.tgz"\n with tarfile.open(path,"w:gz") as archive:\n  raw=json.dumps({"name":"dsh-wechat","version":"0.12.0","license":"MIT","dsh":{"bundle":{"patch":"./cordis.patch.yml"}}}).encode()\n  member=tarfile.TarInfo("package/package.json");member.size=len(raw);archive.addfile(member,io.BytesIO(raw))\n try:\n  release.package_audit(path,"dsh-wechat","0.11.1-dot.1")\n except ValueError:\n  pass\n else:\n  raise AssertionError("unreviewed inner metadata accepted")\n');
});
