from pathlib import Path
from zipfile import ZipFile, ZipInfo, ZIP_DEFLATED

root = Path(__file__).resolve().parent.parent
if not (root / 'dist/index.html').is_file():
    raise SystemExit('Сначала выполните npm run build (в GitHub Actions это делается автоматически).')
out = root / 'artifacts'
out.mkdir(exist_ok=True)
archive = out / 'kadr-video-lab-search-1.zip'
folders = ['web', 'scripts', 'tests', 'docs', 'evidence', 'protocol', 'history', '.github', 'dist']
files = ['README.md', 'package.json', 'package-lock.json', 'playwright.config.mjs', '.gitignore']
def add(bundle,file):
    info=ZipInfo(str(file.relative_to(root)),(2026,10,19,0,0,0));info.compress_type=ZIP_DEFLATED;info.external_attr=0o644 << 16;bundle.writestr(info,file.read_bytes())
with ZipFile(archive, 'w', ZIP_DEFLATED) as bundle:
    for name in folders:
        for file in sorted((root / name).rglob('*')):
            if file.is_file() and '__pycache__' not in file.parts and not file.name.startswith('.env') and file.suffix not in ['.pem','.key']:
                add(bundle,file)
    for name in files:
        add(bundle,root / name)
    info=ZipInfo('RELEASE.json',(2026,10,19,0,0,0));info.compress_type=ZIP_DEFLATED;info.external_attr=0o644 << 16
    bundle.writestr(info,(root / 'dist/build-info.json').read_bytes())
print(archive)
