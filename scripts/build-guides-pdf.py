"""The guides in docs/, printed as one book.

Two passes, because a contents page cannot know its page numbers until the
document has been paginated:

  1. Build the HTML with the contents laid out and the numbers left blank,
     print it, and read the page each contents link actually landed on. The
     links are real PDF link annotations, so this is where the pages went
     rather than where an estimate says they went.
  2. Build the same HTML again with the numbers filled in and print it for
     keeps. Only the digits change, so the pagination cannot move under them,
     and the check at the end proves it did not.

Run with: npm run docs:pdf
"""

from __future__ import annotations

import json
import subprocess
import sys
from pathlib import Path

from playwright.sync_api import sync_playwright
from pypdf import PdfReader

ROOT = Path(__file__).resolve().parents[1]
OUT_PDF = ROOT / "docs" / "water-base-guides.pdf"
WORK = ROOT / "node_modules" / ".cache" / "guides-pdf"

RUNNING_HEAD = "Water Base"
RUNNING_FOOT = "Michigan Water Pros"

NAVY = (0.110, 0.212, 0.318)
MUTED = (0.478, 0.545, 0.600)
TEAL_DEEP = (0.114, 0.396, 0.502)

POINTS_PER_MM = 72 / 25.4


def build_html(out_html: Path, pages_json: Path | None) -> dict:
    """Run the Node builder, which owns the Markdown and the layout."""
    cmd = ["node", str(ROOT / "scripts" / "build-guides-html.mjs"), str(out_html)]
    if pages_json is not None:
        cmd.append(str(pages_json))

    done = subprocess.run(cmd, capture_output=True, text=True, cwd=ROOT)
    if done.returncode != 0:
        sys.stderr.write(done.stderr)
        raise SystemExit(f"the HTML build failed with code {done.returncode}")

    return json.loads(done.stdout.strip().splitlines()[-1])


def print_pdf(html: Path, pdf: Path) -> None:
    with sync_playwright() as play:
        browser = play.chromium.launch()
        page = browser.new_page()
        page.goto(html.as_uri(), wait_until="networkidle")
        # The fonts are fetched over the network. Without this the first page
        # can be laid out in the fallback face and the pagination shifts.
        page.evaluate("() => document.fonts.ready")
        page.emulate_media(media="print")
        page.pdf(
            path=str(pdf),
            prefer_css_page_size=True,
            print_background=True,
            outline=True,
            tagged=True,
        )
        browser.close()


def anchor_pages(pdf: Path, anchor_ids: list[str]) -> dict[str, int]:
    """Which page each contents entry points at.

    Chromium writes every in document link as a named destination, one per
    anchor id, so this reads where the sections really landed rather than
    estimating from heights.
    """
    reader = PdfReader(str(pdf))
    named = reader.named_destinations

    pages: dict[str, int] = {}
    missing: list[str] = []

    for anchor_id in anchor_ids:
        dest = named.get(anchor_id) or named.get(f"/{anchor_id}")
        if dest is None:
            missing.append(anchor_id)
            continue
        pages[anchor_id] = reader.get_destination_page_number(dest) + 1

    if missing:
        raise SystemExit(f"{len(missing)} contents entries have no destination: {missing[:4]}")

    return pages


def stamp_running_heads(pdf: Path, section_pages: list[tuple[str, int]]) -> None:
    """The running head and the page numbers, drawn into the margins.

    Chromium can print its own header and footer, but it prints them on every
    page, and on the cover they land on top of the navy band. Drawing them
    here also lets the head name the guide the reader is in, which Chromium
    has no way of knowing.

    The cover is left alone on purpose.
    """
    import pymupdf

    doc = pymupdf.open(str(pdf))
    total = doc.page_count
    starts = sorted(section_pages, key=lambda pair: pair[1])

    for index in range(1, total):
        page = doc[index]
        width = page.rect.width
        left = 17 * POINTS_PER_MM
        right = width - left

        here = ""
        for title, first in starts:
            if first <= index + 1:
                here = title

        top = 11 * POINTS_PER_MM
        bottom = page.rect.height - 8 * POINTS_PER_MM

        page.insert_text((left, top), RUNNING_HEAD, fontname="helv", fontsize=7.5, color=MUTED)
        if here:
            page.insert_text(
                (right - pymupdf.get_text_length(here, fontname="hebo", fontsize=7.5), top),
                here, fontname="hebo", fontsize=7.5, color=NAVY,
            )

        page.insert_text((left, bottom), RUNNING_FOOT, fontname="helv", fontsize=7.5, color=MUTED)

        label = f"page {index + 1} of {total}"
        page.insert_text(
            (right - pymupdf.get_text_length(label, fontname="helv", fontsize=7.5), bottom),
            label, fontname="helv", fontsize=7.5, color=TEAL_DEEP,
        )

        page.draw_line(
            pymupdf.Point(left, bottom - 4 * POINTS_PER_MM),
            pymupdf.Point(right, bottom - 4 * POINTS_PER_MM),
            color=(0.886, 0.910, 0.933), width=0.5,
        )

    doc.saveIncr()
    doc.close()


def main() -> None:
    WORK.mkdir(parents=True, exist_ok=True)

    pass1_html = WORK / "guides-pass1.html"
    pass1_pdf = WORK / "guides-pass1.pdf"
    pass2_html = WORK / "guides.html"
    pages_json = WORK / "toc-pages.json"

    build_html(pass1_html, None)
    print_pdf(pass1_html, pass1_pdf)

    anchors = json.loads(
        subprocess.run(
            ["node", "-e", ANCHOR_SCRIPT],
            capture_output=True, text=True, cwd=ROOT, check=True,
        ).stdout
    )

    pages = anchor_pages(pass1_pdf, anchors)
    pages_json.write_text(json.dumps(pages, indent=2), encoding="utf8")

    build_html(pass2_html, pages_json)
    print_pdf(pass2_html, OUT_PDF)

    # The numbers are only true if the second print paginated the same way.
    settled = anchor_pages(OUT_PDF, anchors)
    moved = {k: (pages[k], settled[k]) for k in anchors if pages[k] != settled[k]}
    if moved:
        raise SystemExit(f"pagination moved between passes: {moved}")

    titles = json.loads(
        subprocess.run(
            ["node", "-e", TITLE_SCRIPT],
            capture_output=True, text=True, cwd=ROOT, check=True,
        ).stdout
    )
    stamp_running_heads(OUT_PDF, [(title, settled[anchor]) for anchor, title in titles])

    reader = PdfReader(str(OUT_PDF))
    size_kb = OUT_PDF.stat().st_size / 1024
    print(f"{OUT_PDF.relative_to(ROOT)}  {len(reader.pages)} pages  {size_kb:.0f} KB")
    print("contents: " + ", ".join(f"{k} p{v}" for k, v in pages.items() if k.count("-") == 1))


# The anchor ids, in contents order, straight from the builder so the two
# files cannot disagree about what the contents contains.
ANCHOR_SCRIPT = """
import { readFileSync } from 'node:fs'
import { parseMarkdown, titleOf } from './src/lib/markdown.js'

const SECTIONS = ['README', 'quotes', 'jobs', 'inventory', 'documents', 'schedule']
const slug = s => String(s).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')
const out = []

for (const name of SECTIONS) {
  const blocks = parseMarkdown(readFileSync(`docs/${name}.md`, 'utf8'))
  const id = `section-${slug(name === 'README' ? 'readme' : name)}`
  out.push(id)
  let seenTitle = false
  for (const block of blocks) {
    if (block.kind !== 'heading') continue
    if (!seenTitle && block.level === 1) { seenTitle = true; continue }
    if (block.level === 2) out.push(`${id}-${slug(block.text)}`)
  }
  void titleOf(blocks)
}

process.stdout.write(JSON.stringify(out))
"""


# The guide titles against their section anchors, for the running head.
TITLE_SCRIPT = """
import { readFileSync } from 'node:fs'
import { parseMarkdown, titleOf } from './src/lib/markdown.js'

const SECTIONS = ['README', 'quotes', 'jobs', 'inventory', 'documents', 'schedule']
const slug = s => String(s).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')

const out = SECTIONS.map(name => {
  const blocks = parseMarkdown(readFileSync(`docs/${name}.md`, 'utf8'))
  const id = `section-${slug(name === 'README' ? 'readme' : name)}`
  return [id, titleOf(blocks) || name]
})

process.stdout.write(JSON.stringify(out))
"""


if __name__ == "__main__":
    main()
