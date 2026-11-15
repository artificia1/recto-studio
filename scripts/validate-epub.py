"""Run a pinned official EPUBCheck distribution against Recto's EPUB fixtures."""
import argparse
import hashlib
import io
import os
import shutil
import subprocess
import urllib.request
import zipfile
from pathlib import Path


VERSION = '5.4.0'
CHECKSUM = '33350c61038e71dfb3d45a76aed04bf5481e6d5500cb780f6e98db8bbd15a28c'
NAME = f'epubcheck-{VERSION}'
URL = f'https://github.com/w3c/epubcheck/releases/download/v{VERSION}/{NAME}.zip'
FIXTURES = ('publication.epub', 'manuscript.epub', 'fixed-layout.epub')


def install(folder):
    cache = folder / f'{NAME}.zip'
    if not cache.is_file():
        folder.mkdir(parents=True, exist_ok=True)
        with urllib.request.urlopen(URL, timeout=60) as response:
            data = response.read(64 * 1024 * 1024 + 1)
    else:
        data = cache.read_bytes()
    if hashlib.sha256(data).hexdigest() != CHECKSUM:
        raise SystemExit(f'EPUBCheck distribution checksum failed. Check {cache}.')
    if not cache.is_file():
        cache.write_bytes(data)
    with zipfile.ZipFile(io.BytesIO(data)) as archive:
        archive.extractall(folder)
    return folder / NAME / 'epubcheck.jar'


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--java', default=os.environ.get('JAVA', 'java'))
    args = parser.parse_args()
    java = shutil.which(args.java)
    if not java:
        parser.error('A Java runtime is required. Supply its path with --java.')
    jar = install(Path('build/production-validator'))
    fixtures = Path('test-results/export-validation')
    reports = Path('build/production-benchmark')
    reports.mkdir(parents=True, exist_ok=True)
    for name in FIXTURES:
        path = fixtures / name
        if not path.is_file():
            raise SystemExit(f'Missing {path}. Run npm test to create the EPUB fixtures.')
        result = subprocess.run([java, '-jar', str(jar), str(path), '--failonwarnings',
                                 '--json', str(reports / f'{path.stem}-epubcheck.json')], timeout=120)
        if result.returncode:
            raise SystemExit(result.returncode)


if __name__ == '__main__':
    main()
