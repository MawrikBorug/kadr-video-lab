from pathlib import Path
from zipfile import ZipFile, ZIP_DEFLATED

root = Path(__file__).resolve().parent.parent
if not (root / 'dist/index.html').is_file():
    raise SystemExit('Сначала выполните npm run build (в GitHub Actions это делается автоматически).')
out = root / 'artifacts'
out.mkdir(exist_ok=True)
archive = out / 'kadr-video-lab-3.3.zip'
folders = ['web', 'scripts', 'tests', 'docs', 'evidence', 'protocol', '.github', 'dist']
files = ['README.md', 'package.json', 'package-lock.json', 'playwright.config.mjs', '.gitignore']
with ZipFile(archive, 'w', ZIP_DEFLATED) as bundle:
    for name in folders:
        for file in sorted((root / name).rglob('*')):
            if file.is_file() and '__pycache__' not in file.parts:
                bundle.write(file, file.relative_to(root))
    for name in files:
        bundle.write(root / name, name)
print(archive)
