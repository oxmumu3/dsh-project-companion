#!/usr/bin/env python3
"""Build and audit portable release artifacts; never install or publish them.

Maintainers need Python 3 and npm. Use one exact reviewed original or Dot
maintenance bridge archive, then run:
  python3 scripts/build-release.py --bridge /path/to/dsh-wechat-0.11.1-dot.2.tgz
See bridge-maintenance/ for the pinned source delta and rebuild instructions.

Users download the release ZIP, extract the whole directory and launch
Install.command. They do not run this developer build tool.
"""
import argparse
import hashlib
import io
import json
from pathlib import Path, PurePosixPath
import re
import shutil
import subprocess
import tarfile
import tempfile
import zipfile

RUNTIMES = ['0.2.0-rc.2', '0.2.1-rc.2']
REVIEWED_BRIDGES = {
    'dsh-wechat-0.11.0.tgz': {
        'name': 'dsh-wechat', 'version': '0.11.0', 'sourceKind': 'original_npm',
        'sha256': '993e1e1afce3c0dcd2610bf9e84ffbfd6d08768f5c4b4fa30eeec50dc2e97d3f',
    },
    'dsh-wechat-0.11.1-dot.1.tgz': {
        'name': 'dsh-wechat', 'version': '0.11.1-dot.1', 'sourceKind': 'dot_maintained_fork',
        'sourceCommit': '1f28de0f5a9d338db884ff5b84e90e9572eaf1cc',
        'deltaSha256': '6e34feef2dc29cb82fdfef0305c27ae4bf604962cd7ca43e616a53d8aedc2c64',
        'sha256': 'b40031cd0928c9df76a864d6ff15bc3fe7356b6298ad2758b6272f127f965878',
    },
    'dsh-wechat-0.11.1-dot.2.tgz': {
        'name': 'dsh-wechat', 'version': '0.11.1-dot.2', 'sourceKind': 'dot_maintained_fork',
        'sourceCommit': '19c3f40c85bcdd49525a09d07007978e61521f83',
        'deltaSha256': 'bbb6a1ab70a5b11bce72308a705813538ec15c53f462b009c2128d04d0775dee',
        'sha256': 'b0f811e7f3d4746fe27d12460f7f188d4ad8d0b5f6be44f442636ce6db3538f7',
    },
}
PROHIBITED = {'.dsh', '.git', '.agent', 'node_modules', '__MACOSX', '.DS_Store', 'credentials', 'tokens', 'secrets'}
MIT_PARTS = ['MIT License', 'Copyright', 'Permission is hereby granted', 'The above copyright notice and this permission notice', '"AS IS"', 'IN NO EVENT SHALL']


def digest(data):
    return hashlib.sha256(data).hexdigest()


def reviewed_bridge(archive_name, archive_sha256):
    spec = REVIEWED_BRIDGES.get(archive_name)
    if spec is None or archive_sha256 != spec['sha256']:
        raise ValueError('Bridge must match an exact reviewed filename and SHA256; arbitrary bridge archives are not supported')
    return dict(spec)


def json_bytes(value):
    return (json.dumps(value, ensure_ascii=False, indent=2) + '\n').encode()


def safe_name(name):
    path = PurePosixPath(name)
    if not name or path.is_absolute() or '..' in path.parts or '\\' in name or any(ord(char) < 32 for char in name):
        raise ValueError(f'Unsafe archive member: {name!r}')
    if any(part in PROHIBITED for part in path.parts):
        raise ValueError(f'Private/configuration/dependency member: {name}')
    base = path.name.lower()
    if base == '.env' or base.startswith('.env.') or base.endswith(('.sqlite', '.sqlite3', '.db', '.jsonl', '.log')) or base in {'auth.json', 'credentials.json', 'tokens.json', 'token.json'}:
        raise ValueError(f'Forbidden runtime/state member: {name}')


def mit(data, name):
    text = data.decode('utf-8')
    if not all(part in text for part in MIT_PARTS):
        raise ValueError(f'Missing full MIT text: {name}')


def package_audit(path, expected_name, expected_version):
    raw = path.read_bytes()
    if len(raw) > 20 * 1024 * 1024:
        raise ValueError('Package exceeds installer limit')
    files = {}
    with tarfile.open(fileobj=io.BytesIO(raw), mode='r:gz') as archive:
        expanded = 0
        for member in archive.getmembers():
            safe_name(member.name)
            if member.isdir():
                continue
            if not member.isfile() or member.name in files:
                raise ValueError(f'Link/non-file/duplicate archive member: {member.name}')
            expanded += member.size
            if expanded > 64 * 1024 * 1024:
                raise ValueError('Expanded package exceeds installer limit')
            files[member.name] = archive.extractfile(member).read()
    metadata = json.loads(files['package/package.json'])
    if metadata['name'] != expected_name or metadata['version'] != expected_version or metadata['license'] != 'MIT' or not isinstance(metadata.get('dsh', {}).get('bundle', {}).get('patch'), str):
        raise ValueError('Package metadata/license/bundle mismatch')
    patch = metadata['dsh']['bundle']['patch'].removeprefix('./')
    safe_name(patch)
    if f'package/{patch}' not in files:
        raise ValueError('Declared bundle patch is absent')
    mit(files['package/LICENSE'], f'{expected_name}/LICENSE')
    vendor_files = 0
    if expected_name == 'dsh-project-companion':
        for required in ['src/project-updates.js', 'src/project-update-model.js', 'src/project-memory.js', 'src/welcome-guard.js', 'src/wechat-recovery.js', 'src/installation.js', 'src/onboarding.js', 'src/client.js', 'src/news-service.js', 'src/news-model.js', 'src/news-feeds.js', 'src/context-config.js', 'src/context-google-auth.js', 'src/google-publisher.js', 'src/google-calendar-auth.js', 'src/google-calendar-rest.js', 'src/google-suite-auth.js', 'src/google-suite-rest.js', 'src/context-provider.js', 'src/news-topics.js', 'src/context-account-auth.js', 'src/context-transport.js', 'src/context-contracts.js', 'src/context-service.js', 'src/context-route.js', 'docs/context-sources.md', 'assets/news-feeds.json', 'docs/news.md', 'THIRD_PARTY_NOTICES.md', 'bridge-maintenance/README.md', 'bridge-maintenance/PROVENANCE.json']:
            if f'package/{required}' not in files:
                raise ValueError(f'Missing candidate component: {required}')
        for name in ['pan17-dsh-wechat', 'dsh-yolo', 'dsh-proactive']:
            mit(files[f'package/third-party-licenses/{name}.txt'], name)
        maintenance = json.loads(files['package/bridge-maintenance/PROVENANCE.json'])
        maintained = reviewed_bridge(maintenance['archive']['file'], maintenance['archive']['sha256'])
        patch_name = maintenance['delta']['file']
        safe_name(patch_name)
        if maintained['sourceKind'] != 'dot_maintained_fork' or maintained['sourceCommit'] != maintenance.get('sourceCommit') or maintained['deltaSha256'] != maintenance['delta']['sha256'] or digest(files[f'package/bridge-maintenance/{patch_name}']) != maintained['deltaSha256'] or digest(files['package/third-party-licenses/pan17-dsh-wechat.txt']) != maintenance['license']['sha256']:
            raise ValueError('Bridge maintenance source, delta or original license integrity mismatch')
        for vendor in ['yolo', 'proactive']:
            mit(files[f'package/vendor/{vendor}/LICENSE'], f'{vendor}/LICENSE')
            manifest = json.loads(files[f'package/vendor/{vendor}/SOURCE.json'])
            rows = manifest['files']
            pairs = rows.items() if isinstance(rows, dict) else [(row['runtimePath'], row['runtimeSha256']) for row in rows]
            for relative, expected in pairs:
                if digest(files[f'package/vendor/{vendor}/{relative}']) != expected:
                    raise ValueError(f'Vendor hash mismatch: {vendor}/{relative}')
                vendor_files += 1
    return {
        'name': expected_name, 'version': expected_version, 'file': path.name,
        'sha256': digest(raw), 'bytes': len(raw), 'archiveFiles': len(files),
        'fullMitPresent': True, 'pinnedVendorFilesVerified': vendor_files,
        'privateRuntimeMembers': 0, 'linksOrUnsafeMembers': 0,
    }, files


def runtime_fingerprints(files):
    return {
        name.removeprefix('package/'): digest(data)
        for name, data in sorted(files.items())
        if name in {'package/index.js', 'package/cordis.patch.yml'} or name.startswith(('package/src/', 'package/vendor/', 'package/assets/'))
    }


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    source_root = Path(__file__).resolve().parent.parent
    parser.add_argument('--bridge', type=Path, required=True, help='One exact reviewed original 0.11.0 or Dot maintenance 0.11.1-dot.1/0.11.1-dot.2 archive')
    parser.add_argument('--output', type=Path, default=source_root / 'dist', help='Artifact directory; defaults to this source checkout/dist')
    parser.add_argument('--runtime-reference', type=Path, help='Optional previously tested companion tgz; require identical index/src/vendor/bundle runtime bytes')
    args = parser.parse_args()
    repo, bridge, output = source_root, args.bridge.resolve(), args.output.resolve()
    metadata = json.loads((repo / 'package.json').read_bytes())
    version = metadata.get('version')
    if metadata.get('name') != 'dsh-project-companion' or not isinstance(version, str) or not re.fullmatch(r'(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)(?:-[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?', version):
        raise ValueError('Source package must declare dsh-project-companion and one exact supported SemVer')
    kit = f'dsh-dot-{version}-macos'
    bridge_spec = reviewed_bridge(bridge.name, digest(bridge.read_bytes()))
    output.mkdir(parents=True, exist_ok=True)
    with tempfile.TemporaryDirectory(prefix='dsh-dot-kit-pack-') as pack_dir:
        command = ['npm', 'pack', '--json', '--ignore-scripts', '--pack-destination', pack_dir]
        packed = json.loads(subprocess.run(command, cwd=repo, check=True, capture_output=True, text=True).stdout)
        if len(packed) != 1 or Path(packed[0]['filename']).name != packed[0]['filename']:
            raise ValueError('Unexpected npm pack response')
        companion = Path(pack_dir) / packed[0]['filename']
        bridge_audit, bridge_files = package_audit(bridge, bridge_spec['name'], bridge_spec['version'])
        companion_audit, companion_files = package_audit(companion, 'dsh-project-companion', version)
        runtime = runtime_fingerprints(companion_files)
        runtime_reference = None
        if args.runtime_reference:
            reference_audit, reference_files = package_audit(args.runtime_reference.resolve(), 'dsh-project-companion', version)
            if runtime_fingerprints(reference_files) != runtime:
                raise ValueError('Release runtime differs from the previously tested companion index/src/vendor/bundle')
            runtime_reference = {'archiveSha256': reference_audit['sha256'], 'matchedRuntimeFiles': len(runtime)}
        stage = Path(tempfile.mkdtemp(prefix='.dsh-dot-kit-stage-', dir=output))
        try:
            for relative in ['Install.command', 'scripts/install.mjs', 'src/installation.js', 'LICENSE', 'THIRD_PARTY_NOTICES.md']:
                target = stage / relative
                target.parent.mkdir(parents=True, exist_ok=True)
                shutil.copyfile(repo / relative, target)
            shutil.copytree(repo / 'third-party-licenses', stage / 'third-party-licenses')
            shutil.copytree(repo / 'bridge-maintenance', stage / 'bridge-maintenance')
            # This copy lives at the kit root rather than inside docs/.
            # Keep source-doc links unchanged and rebase only its copied links.
            install_doc = (repo / 'docs/install.md').read_text(encoding='utf-8')
            install_doc = install_doc.replace('](first-use.md)', '](https://github.com/piggy00544/dsh-project-companion/blob/main/docs/first-use.md)')
            install_doc = install_doc.replace('](../THIRD_PARTY_NOTICES.md)', '](THIRD_PARTY_NOTICES.md)')
            (stage / '安装说明.md').write_text(install_doc, encoding='utf-8')
            (stage / 'package.json').write_bytes(json_bytes({'private': True, 'type': 'module'}))
            (stage / 'Install.command').chmod(0o755)
            for archive in [bridge, companion]:
                shutil.copyfile(archive, stage / archive.name)
            if (stage / 'third-party-licenses/pan17-dsh-wechat.txt').read_bytes() != bridge_files['package/LICENSE']:
                raise ValueError('External WeChat attribution differs from shipped archive license')
            packages = [bridge_audit, companion_audit]
            manifest = {
                'schemaVersion': 1, 'runtimeVersions': RUNTIMES,
                'packages': [{key: row[key] for key in ['name', 'version', 'file', 'sha256']} for row in packages],
            }
            (stage / 'bundle-manifest.json').write_bytes(json_bytes(manifest))
            for path in stage.rglob('*'):
                safe_name(path.relative_to(stage).as_posix())
                if path.is_symlink():
                    raise ValueError('Symlink in distribution')
            for relative in ['LICENSE', 'third-party-licenses/pan17-dsh-wechat.txt', 'third-party-licenses/dsh-yolo.txt', 'third-party-licenses/dsh-proactive.txt']:
                mit((stage / relative).read_bytes(), relative)
            kit_files = [{'file': path.relative_to(stage).as_posix(), 'bytes': path.stat().st_size, 'sha256': digest(path.read_bytes())} for path in sorted(stage.rglob('*')) if path.is_file()]
            audit = {
                'schemaVersion': 1, 'releaseVersion': version, 'distribution': 'github_release',
                'packages': packages, 'filesBeforeAuditAndChecksums': kit_files,
                'bridgeProvenance': bridge_spec,
                'runtimeFiles': runtime,
                'audit': {'fullMitAndCredits': True, 'filenamesAndPackageSchema': True, 'pinnedVendorIntegrity': True, 'personalConfigsOrStateIncluded': False, 'nodeModulesIncluded': False, 'linksIncluded': False},
                'limits': ['External dependency closure is not bundled; installation may access the network.', 'No app installation, plugin installation, account import, host shutdown or WeChat send was performed by this build.', 'Current documentation is a build snapshot; rebuild after verification/docs updates.'],
            }
            (stage / 'kit-audit.json').write_bytes(json_bytes(audit))
            sums = ''.join(f'{digest(path.read_bytes())}  {path.relative_to(stage).as_posix()}\n' for path in sorted(stage.rglob('*')) if path.is_file())
            (stage / 'SHA256SUMS').write_text(sums, encoding='utf-8')
            destination = output / kit
            if destination.exists():
                previous_manifest = json.loads((destination / 'bundle-manifest.json').read_bytes())
                if destination.is_symlink() or previous_manifest.get('packages', [{}, {}])[-1].get('version') != version:
                    raise ValueError('Refusing to replace an unrelated existing directory')
                shutil.rmtree(destination)
            stage.rename(destination)
            release_package = output / companion.name
            shutil.copyfile(companion, release_package)
            zip_path = output / f'{kit}.zip'
            with zipfile.ZipFile(zip_path, 'w', compression=zipfile.ZIP_DEFLATED, compresslevel=9) as archive:
                for path in sorted(destination.rglob('*')):
                    if not path.is_file():
                        continue
                    name = f'{kit}/{path.relative_to(destination).as_posix()}'
                    # Fixed metadata makes two builds with the same source and
                    # npm archive byte-identical, independent of checkout mtimes.
                    info = zipfile.ZipInfo(name, date_time=(2000, 1, 1, 0, 0, 0))
                    info.create_system = 3
                    info.external_attr = ((0o100755 if path.name == 'Install.command' else 0o100644) << 16)
                    info.compress_type = zipfile.ZIP_DEFLATED
                    archive.writestr(info, path.read_bytes())
            with zipfile.ZipFile(zip_path) as archive:
                if archive.testzip() is not None:
                    raise ValueError('Zip integrity failed')
                for member in archive.infolist():
                    safe_name(member.filename)
                    if (member.external_attr >> 16) & 0o170000 == 0o120000:
                        raise ValueError('Zip contains a symlink')
            zip_hash = digest(zip_path.read_bytes())
            (output / f'{kit}.zip.sha256').write_text(f'{zip_hash}  {zip_path.name}\n')
            (output / 'SHA256SUMS').write_text(f'{companion_audit["sha256"]}  {release_package.name}\n{zip_hash}  {zip_path.name}\n')
            print(json.dumps({'directory': str(destination), 'zip': str(zip_path), 'zipBytes': zip_path.stat().st_size, 'zipSha256': zip_hash, 'releasePackage': str(release_package), 'packages': packages, 'outerFiles': len([p for p in destination.rglob('*') if p.is_file()]), 'audit': audit['audit'], 'runtimeReference': runtime_reference}, ensure_ascii=False, indent=2))
        finally:
            if stage.exists():
                shutil.rmtree(stage)


if __name__ == '__main__':
    main()
