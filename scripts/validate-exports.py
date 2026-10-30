"""Check generated fixtures with independent PDF, ZIP, and XML parsers.

Run after npm test. Requires pypdf; optional --render also requires pypdfium2.
These structural checks do not certify PDF/X, PDF/UA, or EPUB conformance.
"""
import argparse
import io
from pathlib import Path
import posixpath
import xml.etree.ElementTree as ET
import zipfile

from pypdf import PdfReader


def close(actual, expected):
    assert abs(float(actual) - expected) < 0.02, (actual, expected)


def validate_pdf(source, width, height, print_mode):
    reader = PdfReader(source, strict=True)
    assert len(reader.pages) == 1
    page = reader.pages[0]
    points = 72 / 25.4
    inset = 17 if print_mode else 0
    close(page.mediabox.width, (width + 2 * inset) * points)
    close(page.mediabox.height, (height + 2 * inset) * points)
    assert '/TrimBox' in page and '/BleedBox' in page
    close(page.trimbox.left, inset * points)
    close(page.trimbox.bottom, inset * points)
    close(page.trimbox.width, width * points)
    close(page.trimbox.height, height * points)
    close(page.bleedbox.left, (14 if print_mode else 0) * points)
    close(page.bleedbox.bottom, (14 if print_mode else 0) * points)
    close(page.bleedbox.width, (width + (6 if print_mode else 0)) * points)
    close(page.bleedbox.height, (height + (6 if print_mode else 0)) * points)
    assert 'Studio export validation' in page.extract_text()
    operations = page.get_contents().operations
    colors = [values for values, operator in operations if operator in (b'k', b'K')]
    assert colors and all(0 <= float(value) <= 1 for values in colors for value in values)
    assert any(operator == b're' and abs(float(values[2]) - 60 * points) < 0.02 for values, operator in operations)
    states = page['/Resources'].get('/ExtGState', {})
    assert all(values[0] in states for values, operator in operations if operator == b'gs')
    root = reader.trailer['/Root']
    assert '/MarkInfo' not in root and '/StructTreeRoot' not in root
    assert '/OutputIntents' not in root


def validate_epub(path):
    ns = {'c': 'urn:oasis:names:tc:opendocument:xmlns:container', 'o': 'http://www.idpf.org/2007/opf'}
    with zipfile.ZipFile(path) as book:
        assert book.testzip() is None
        first = book.infolist()[0]
        assert first.filename == 'mimetype' and first.header_offset == 0
        assert first.compress_type == zipfile.ZIP_STORED and not first.extra
        assert book.read('mimetype') == b'application/epub+zip'
        container = ET.fromstring(book.read('META-INF/container.xml'))
        package_path = container.find('c:rootfiles/c:rootfile', ns).attrib['full-path']
        package = ET.fromstring(book.read(package_path))
        manifest = {item.attrib['id']: item for item in package.findall('o:manifest/o:item', ns)}
        assert any('nav' in item.get('properties', '').split() for item in manifest.values())
        assert any(item.get('media-type', '').startswith('font/') for item in manifest.values())
        for item in manifest.values():
            target = posixpath.join(posixpath.dirname(package_path), item.attrib['href'])
            assert target in book.namelist(), target
            if item.get('media-type') == 'application/xhtml+xml':
                document = ET.fromstring(book.read(target))
                if document.findall('.//{http://www.w3.org/2000/svg}svg'):
                    assert 'svg' in item.get('properties', '').split()
        for item in package.findall('o:spine/o:itemref', ns):
            assert item.attrib['idref'] in manifest


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--render', action='store_true')
    args = parser.parse_args()
    folder = Path('test-results/export-validation')
    for landscape in (False, True):
        width, height = (297, 210) if landscape else (210, 297)
        for print_mode in (False, True):
            path = folder / f'{"landscape" if landscape else "portrait"}-{"print" if print_mode else "clean"}.pdf'
            validate_pdf(path, width, height, print_mode)
            if args.render:
                import pypdfium2 as pdfium
                pdf = pdfium.PdfDocument(path)
                pdf[0].render(scale=1).to_pil().save(path.with_suffix('.png'))
                pdf.close()
    validate_epub(folder / 'publication.epub')
    manuscript = PdfReader(folder / 'manuscript.pdf', strict=True)
    assert len(manuscript.pages) == 1
    extracted = manuscript.pages[0].extract_text()
    assert 'Heading' in extracted and 'bold' in extracted and 'italic' in extracted
    fonts = manuscript.pages[0]['/Resources']['/Font']
    font_names = [str(font.get_object().get('/BaseFont', '')) for font in fonts.values()]
    assert any('Bold' in name for name in font_names)
    assert any('Italic' in name for name in font_names)
    with zipfile.ZipFile(folder / 'manuscript.epub') as book:
        assert book.testzip() is None
        ns = {'x': 'http://www.w3.org/1999/xhtml'}
        bold_count = 0
        for name in book.namelist():
            if name.endswith('.xhtml'):
                document = ET.fromstring(book.read(name))
                bold_count += len(document.findall('.//x:strong', ns))
                if document.findall('.//x:strong', ns):
                    assert document.find('.//x:h1', ns) is not None
                    assert document.find('.//x:em', ns).text == 'italic'
        assert bold_count == 1
    with zipfile.ZipFile(folder / 'publication.zip') as package:
        assert package.testzip() is None
        names = package.namelist()
        assert any(name.endswith('.recto') for name in names)
        validate_pdf(io.BytesIO(package.read(next(name for name in names if name.endswith('.pdf')))), 297, 210, True)
        assert 'not certified PDF/X' in package.read('Instructions.txt').decode()
    print('Validated four PDF variants, custom-font EPUB structure, packaged PDF, and formatted manuscript PDF/EPUB.')


if __name__ == '__main__':
    main()
