"""Convert a meta scratchpad markdown file to PDF.

Rendering shells out to ``wkhtmltopdf`` or ``pandoc`` when one of them is
installed.  The HTML handed to the renderer contains user-run LLM output, so
the renderer is started with local file and network access disabled.  When no
renderer is available the caller falls back to plain text.
"""

from __future__ import annotations

import base64
import logging
import re
import shutil
import subprocess
import tempfile
from pathlib import Path
from typing import Optional

logger = logging.getLogger("shinka.webui")

PDF_STYLE = """
@media print { @page { margin: 2cm; size: A4; } body { font-size: 12pt; } }
body { font-family: 'Times New Roman', Times, serif; line-height: 1.6; color: #333;
       max-width: 800px; margin: 0 auto; padding: 20px; }
h1 { color: #2c3e50; border-bottom: 2px solid #e74c3c; padding-bottom: 10px; margin-top: 0; }
h2, h3 { color: #2c3e50; margin-top: 1.5em; margin-bottom: 0.5em; }
pre { background-color: #f8f9fa; padding: 15px; border-radius: 5px; overflow-x: auto;
      border: 1px solid #e9ecef; font-family: 'Courier New', monospace; font-size: 11pt; }
code { background-color: #f8f9fa; padding: 2px 4px; border-radius: 3px;
       font-family: 'Courier New', monospace; font-size: 90%; }
blockquote { border-left: 4px solid #e74c3c; margin: 1em 0; padding-left: 1em;
             color: #6c757d; font-style: italic; }
p { margin-bottom: 1em; line-height: 1.6; text-align: justify; }
ul, ol { margin-bottom: 1em; }
li { margin-bottom: 0.5em; line-height: 1.5; }
strong { font-weight: bold; color: #2c3e50; }
em { font-style: italic; color: #34495e; }
.header-container { text-align: center; margin-bottom: 2em; padding-bottom: 1em;
                    border-bottom: 2px solid #e74c3c; }
.header-logo { width: 150px; height: 150px; margin: 0 auto 15px auto; display: block; }
.header-title { margin: 0; color: #2c3e50; font-size: 24pt; font-weight: bold; text-align: center; }
.program-box { border: 2px solid #e74c3c; border-radius: 10px; margin: 0.8em 0;
               padding: 0.1em 0.8em; background-color: #f8f9fa; page-break-inside: avoid; }
.program-name { font-weight: bold; color: #2c3e50; font-size: 16pt; margin-bottom: 1em;
                border-bottom: 1px solid #bdc3c7; padding-bottom: 0.5em; }
.program-field { margin-top: 1em; margin-bottom: 0.5em; }
.program-field strong { color: #34495e; font-weight: bold; }
"""

_PROGRAM_BOX_PATTERN = re.compile(
    r"(<p><strong>Program Name:[^<]*</strong>[\s\S]*?</p>)", re.MULTILINE | re.DOTALL
)


def available_renderers() -> list[str]:
    return [tool for tool in ("wkhtmltopdf", "pandoc") if shutil.which(tool)]


def fix_line_breaks(content: str) -> str:
    """Insert paragraph breaks between consecutive prose sentences."""
    content = content.replace("\r\n", "\n").replace("\r", "\n")
    lines = content.split("\n")
    result: list[str] = []
    for index, raw in enumerate(lines):
        current = raw.strip()
        result.append(current)
        if index < len(lines) - 1:
            following = lines[index + 1].strip()
            if (
                current
                and following
                and len(current) > 30
                and current.endswith((".", "!", "?", ";"))
                and following[0].isupper()
                and not following.startswith(("#", "-", "*", "+"))
                and not re.match(r"^\*\*\w+:\*\*", following)
            ):
                result.append("")
    return "\n".join(result)


def add_program_boxes(html_content: str) -> str:
    return _PROGRAM_BOX_PATTERN.sub(
        lambda match: f'<div class="program-box">{match.group(1).strip()}</div>',
        html_content,
    )


def logo_data_uri(logo_path: Path) -> str:
    try:
        encoded = base64.b64encode(logo_path.read_bytes()).decode("ascii")
    except OSError:
        return ""
    return f"data:image/png;base64,{encoded}"


def markdown_to_html(content: str) -> str:
    import markdown  # imported lazily: only needed for PDF export

    processed = fix_line_breaks(content)
    try:
        html = markdown.markdown(processed, extensions=["extra", "nl2br"])
    except Exception:
        html = markdown.markdown(processed, extensions=["extra"]).replace(
            "\n", "<br>\n"
        )
    return add_program_boxes(html)


def build_document(content: str, title: str, logo_path: Optional[Path] = None) -> str:
    logo = logo_data_uri(logo_path) if logo_path else ""
    logo_tag = (
        f'<img src="{logo}" alt="Shinka Logo" class="header-logo">' if logo else ""
    )
    body = markdown_to_html(content)
    return (
        '<!DOCTYPE html>\n<html>\n<head>\n<meta charset="utf-8">\n'
        f"<title>{title}</title>\n<style>{PDF_STYLE}</style>\n</head>\n<body>\n"
        f'<div class="header-container">{logo_tag}'
        f'<h1 class="header-title">ShinkaEvolve Meta-Scratchpad: {title}</h1></div>\n'
        f"{body}\n</body>\n</html>"
    )


def _run_renderer(command: list[str]) -> bool:
    try:
        result = subprocess.run(command, capture_output=True, text=True, timeout=30)
    except (subprocess.TimeoutExpired, FileNotFoundError, OSError) as error:
        logger.info("PDF renderer %s unavailable: %s", command[0], error)
        return False
    if result.returncode != 0:
        logger.info(
            "PDF renderer %s failed: %s", command[0], result.stderr.strip()[:500]
        )
        return False
    return True


def render_pdf(html_document: str) -> Optional[bytes]:
    """Render HTML to PDF bytes, or return ``None`` when no renderer works."""
    with tempfile.TemporaryDirectory(prefix="shinka-pdf-") as tmp:
        html_path = Path(tmp) / "meta.html"
        pdf_path = Path(tmp) / "meta.pdf"
        html_path.write_text(html_document, encoding="utf-8")
        commands = [
            [
                "wkhtmltopdf",
                "--disable-local-file-access",
                "--disable-javascript",
                "--disable-external-links",
                "--page-size",
                "A4",
                "--margin-top",
                "20mm",
                "--margin-bottom",
                "20mm",
                "--margin-left",
                "20mm",
                "--margin-right",
                "20mm",
                str(html_path),
                str(pdf_path),
            ],
            ["pandoc", "--sandbox", str(html_path), "-o", str(pdf_path)],
        ]
        for command in commands:
            if shutil.which(command[0]) is None:
                continue
            if _run_renderer(command) and pdf_path.is_file():
                return pdf_path.read_bytes()
    return None


def meta_to_pdf(
    content: str, title: str, logo_path: Optional[Path] = None
) -> Optional[bytes]:
    try:
        document = build_document(content, title, logo_path)
    except Exception as error:  # markdown conversion is best effort
        logger.warning("Could not build PDF document: %s", error)
        return None
    return render_pdf(document)
