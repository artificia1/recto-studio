"""Check a Recto IDML container and optionally record a native InDesign round trip."""
import argparse
import hashlib
import json
import xml.etree.ElementTree as ET
from pathlib import Path
from zipfile import ZIP_STORED, ZipFile


MIMETYPE = b'application/vnd.adobe.indesign-idml-package'
PACKAGING = '{http://ns.adobe.com/AdobeInDesign/idml/1.0/packaging}'
CONTAINER = '{urn:oasis:names:tc:opendocument:xmlns:container}'
NATIVE_GROUPS = {'pages', 'spreads', 'parents', 'layers', 'stories', 'artwork',
                 'paragraphStyles', 'characterStyles', 'swatches'}


def sha256(path):
    with path.open('rb') as file:
        return hashlib.file_digest(file, 'sha256').hexdigest()


def verify_container(path):
    with ZipFile(path) as archive:
        entries = archive.infolist()
        assert entries, f'{path} is empty'
        first = entries[0]
        assert first.filename == 'mimetype' and first.header_offset == 0, path
        assert first.compress_type == ZIP_STORED and not (first.flag_bits & 1), path
        assert archive.read(first) == MIMETYPE and archive.testzip() is None, path
        names = set(archive.namelist())
        assert len(names) == len(entries), f'{path} has duplicate ZIP entries'
        container = ET.fromstring(archive.read('META-INF/container.xml'))
        rootfile = container.find(f'{CONTAINER}rootfiles/{CONTAINER}rootfile')
        assert rootfile is not None and rootfile.get('full-path') == 'designmap.xml', path
        document = ET.fromstring(archive.read('designmap.xml'))
        assert document.tag == 'Document', path
        resources = [child.attrib['src'] for child in document if child.tag.startswith(PACKAGING) and 'src' in child.attrib]
        assert resources and len(set(resources)) == len(resources) and set(resources) <= names, path
        for resource in resources:
            ET.fromstring(archive.read(resource))
    return {'file': path.name, 'sha256': sha256(path), 'referencedParts': len(resources)}


def verify_native(source, folder):
    report_path = folder / 'roundtrip-report.json'
    report = json.loads(report_path.read_text(encoding='utf-8-sig'))
    assert report.get('version') == 1 and report.get('application') == 'Adobe InDesign', report_path
    assert report.get('source') == source.name and report.get('roundTrip') == 'indesign-roundtrip.idml', report_path
    assert report.get('sourceBytes') == source.stat().st_size, f'{source} length differs from the report'
    if report.get('status') != 'PASS':
        raise SystemExit(f'InDesign reported {report.get("status")}. Review {report_path}.')
    checks = report['checks']
    assert len(checks) == len(NATIVE_GROUPS) and {check['group'] for check in checks} == NATIVE_GROUPS, report_path
    assert all(check['matches'] is True and check['opened'] == check['reopened'] for check in checks), report_path
    review = report['review']
    assert not any(review[key] for key in ('missingFonts', 'links', 'oversetOpened', 'oversetReopened')), report_path
    return {'applicationVersion': report['applicationVersion'], 'reportSha256': sha256(report_path),
            'nativeExport': verify_container(folder / 'indesign-roundtrip.idml')}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    artifacts = Path('build/production-benchmark')
    parser.add_argument('source', nargs='?', type=Path, default=artifacts / 'editorial-interchange.idml')
    parser.add_argument('--native-results', type=Path)
    parser.add_argument('--report', type=Path, default=artifacts / 'idml-checks.json')
    args = parser.parse_args()
    result = {'version': 1, 'source': verify_container(args.source)}
    if args.native_results:
        result['nativeRoundTrip'] = verify_native(args.source, args.native_results)
    args.report.parent.mkdir(parents=True, exist_ok=True)
    args.report.write_text(json.dumps(result, indent=2) + '\n', encoding='utf-8')
    print(f'Checked {args.source.name}. Results saved to {args.report}.')


if __name__ == '__main__':
    main()
