---
name: markdown-to-pdf
description: Convert Markdown files to PDF using pandoc and wkhtmltopdf.
homepage: https://pandoc.org/
metadata:
  {
    "openclaw":
      {
        "emoji": "🎨",
        "requires": { "bins": ["pandoc", "wkhtmltopdf"] },
        "install":
          [
            {
              "id": "apt",
              "kind": "shell",
              "command": "sudo apt-get update && sudo apt-get install -y pandoc wkhtmltopdf",
              "label": "Install pandoc and wkhtmltopdf (apt)",
            },
          ],
      },
  }
---

# markdown-to-pdf

Use `pandoc` to convert Markdown files to PDF. This skill requires `wkhtmltopdf` as the PDF engine.

## Quick start

```bash
# Basic conversion
pandoc input.md -o output.pdf --pdf-engine=wkhtmltopdf

# With custom styling (if available)
pandoc input.md -o output.pdf --pdf-engine=wkhtmltopdf -c style.css
```

Notes:

- Ensure the input file exists before running the command.
- The output file will be created in the same directory unless a path is specified.
- If `wkhtmltopdf` is missing, the conversion will fail.
