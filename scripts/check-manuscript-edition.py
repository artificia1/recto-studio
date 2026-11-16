"""Check the exact interior PDF named by a Recto printer handoff."""

import hashlib
import json
from pathlib import Path
import re
import subprocess
import sys


def verify(folder: Path) -> None:
    handoff = json.loads((folder / "printer-handoff.json").read_text(encoding="utf-8"))
    interior = handoff["interior"]
    if interior["file"] != "interior.pdf" or interior["order"] != "reader":
        raise ValueError("The handoff must identify the reader-order interior.")
    pdf = folder / "interior.pdf"
    with pdf.open("rb") as stream:
        if hashlib.file_digest(stream, "sha256").hexdigest() != interior["sha256"]:
            raise ValueError("Interior PDF differs from the file named by the handoff.")
    pages = interior["pages"]
    if not isinstance(pages, int) or not 1 <= pages <= 500:
        raise ValueError("Invalid page count in the handoff.")
    info = subprocess.run(
        ["pdfinfo", "-box", "-f", "1", "-l", str(pages), str(pdf.resolve())],
        check=True, capture_output=True, text=True,
    ).stdout
    count = re.search(r"^Pages:\s+(\d+)\s*$", info, re.MULTILINE)
    if not count or int(count[1]) != pages:
        raise ValueError("Poppler found a different page count.")
    boxes = re.findall(r"^\s*(?:Page\s+\d+\s+)?TrimBox:\s+([\d.-]+)\s+([\d.-]+)\s+([\d.-]+)\s+([\d.-]+)", info, re.MULTILINE)
    if len(boxes) != pages:
        raise ValueError("Poppler did not report trim for every interior page.")
    expected_width, expected_height = handoff["trimMm"]
    for left, bottom, right, top in (tuple(map(float, box)) for box in boxes):
        if abs((right - left) * 25.4 / 72 - expected_width) > 0.05 or abs((top - bottom) * 25.4 / 72 - expected_height) > 0.05:
            raise ValueError("A page's TrimBox differs from the handoff.")
    print(f"Verified interior checksum and {pages} pages at {expected_width:g} × {expected_height:g} mm.")


if __name__ == "__main__":
    if len(sys.argv) != 2:
        sys.exit("Usage: python scripts/check-manuscript-edition.py <edition-folder>")
    verify(Path(sys.argv[1]))
