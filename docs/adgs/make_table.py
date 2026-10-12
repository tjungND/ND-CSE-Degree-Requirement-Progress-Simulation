#!/usr/bin/env python3
"""The one-page MSCSE rule table for the ADGS to sign (DGS 2026-10-11, item 5).

Each row: an MSCSE requirement the app checks, the handbook sentence it implements,
how the app reads it (written from the code, then checked against the code by an
independent reviewer in policy review round 4) and the docs/DECISIONS.md rows that
interpret it. When a rule changes, edit docs/adgs/mscse-rule-table.json (the
"stamp" line comes from the app's footer, "Checked with: …") and rebuild:

  python3 docs/adgs/make_table.py docs/adgs/mscse-rule-table.json /tmp/mscse-rule-table.html
  "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" --headless=new \
      --no-pdf-header-footer --print-to-pdf=docs/adgs/MSCSE-rule-table.pdf \
      file:///tmp/mscse-rule-table.html

and check it is still ONE page (pdfinfo docs/adgs/MSCSE-rule-table.pdf | grep Pages);
if not, shorten the longest cells rather than the type.

table.json: {"stamp": str, "prepared": str, "rows": [{"requirement", "cse", "reading", "decisions"}], "footnote": str}
"""
import html, json, sys
t = json.load(open(sys.argv[1], encoding="utf-8"))
e = lambda s: html.escape(str(s or ""), quote=False)
rows = "".join(
    f'<tr><td class="n">{i + 1}</td><td class="req">{e(r["requirement"])}</td><td class="cse">{e(r["cse"])}</td>'
    f'<td class="app">{e(r["reading"])}</td><td class="dec">{e(r["decisions"])}</td></tr>'
    for i, r in enumerate(t["rows"])
)
page = f"""<!doctype html><html lang="en"><head><meta charset="utf-8"><title>MSCSE rule table</title>
<style>
@page {{ size: letter landscape; margin: 0.2in 0.3in 0.16in; }}
* {{ box-sizing: border-box; }}
body {{ margin: 0; font-family: "Helvetica Neue", Helvetica, Arial, sans-serif; color: #111; font-size: 6.3pt; line-height: 1.14; }}
h1 {{ font-size: 10.5pt; margin: 0 0 1px; }}
.sub {{ font-size: 6.3pt; color: #333; margin: 0 0 3px; }}
table {{ width: 100%; border-collapse: collapse; table-layout: fixed; }}
th {{ text-align: left; font-size: 6.2pt; text-transform: uppercase; letter-spacing: .04em; border-bottom: 1.2px solid #111; padding: 2px 4px; }}
td {{ vertical-align: top; border-bottom: .5px solid #999; padding: 1.3px 3px; }}
td.n {{ width: 1.6em; color: #555; font-variant-numeric: tabular-nums; }}
col.c1 {{ width: 1.8%; }} col.c2 {{ width: 10.4%; }} col.c3 {{ width: 31%; }} col.c4 {{ width: 35%; }} col.c5 {{ width: 21.8%; }}
td.req {{ font-weight: 600; }}
td.cse {{ font-style: italic; }}
td.dec {{ font-size: 5.9pt; color: #222; }}
tr {{ page-break-inside: avoid; }}
.foot {{ margin-top: 3px; font-size: 6pt; color: #333; }}
.sign {{ display: grid; grid-template-columns: 3.4fr 1.5fr 0.8fr; gap: 16px; margin-top: 24px; font-size: 6.6pt; }}
.sign div {{ border-top: .8px solid #111; padding-top: 2px; }}
</style></head><body>
<h1>MSCSE requirements as the degree self-check reads them</h1>
<p class="sub">For the Assistant DGS (ADGS) to review and sign: each MSCSE requirement, the handbook sentence it implements, how the app reads it (checked against the code by an independent reviewer) and the decision that interprets it (docs/DECISIONS.md). Prepared {e(t["prepared"])}. Checked with: {e(t["stamp"])}.</p>
<table><colgroup><col class="c1"><col class="c2"><col class="c3"><col class="c4"><col class="c5"></colgroup>
<thead><tr><th>#</th><th>Requirement</th><th>Handbook sentence</th><th>How the app reads it</th><th>Decision record</th></tr></thead>
<tbody>{rows}</tbody></table>
<p class="foot">{e(t.get("footnote", ""))}</p>
<div class="sign"><div>Reviewed: the readings above implement the handbook as the department applies it, except as noted beside a row.</div><div>Assistant Director of Graduate Studies (signature)</div><div>Date</div></div>
</body></html>"""
open(sys.argv[2], "w", encoding="utf-8").write(page)
print("wrote", sys.argv[2], len(t["rows"]), "rows")
