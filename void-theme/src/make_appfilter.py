"""Writes iconpack/appfilter.xml and iconpack/drawable.xml from icons.py.

Launcher component names are looked up in a large public appfilter (Arcticons, used only as a
list of package/activity names):
  curl -o ref/appfilter.xml https://raw.githubusercontent.com/Arcticons-Team/Arcticons/main/app/src/main/res/xml/appfilter.xml
usage: python3 make_appfilter.py <ref appfilter.xml>
"""
import re
import sys
from pathlib import Path
from xml.sax.saxutils import quoteattr

HERE = Path(__file__).parent
sys.path.insert(0, str(HERE))
from icons import ICONS  # noqa: E402

ref = Path(sys.argv[1]).read_text(encoding="utf-8", errors="replace")
found = re.findall(r"ComponentInfo\{([^/}]+)/([^}]+)\}", ref)
by_pkg = {}
for pkg, cls in found:
    if cls.startswith("."):
        cls = pkg + cls
    by_pkg.setdefault(pkg, set()).add(cls)

lines = ['<?xml version="1.0" encoding="utf-8"?>', "<resources>",
         '    <iconback img1="iconback" />', '    <iconmask img1="iconmask" />', '    <scale factor="0.62" />']
draw = ['<?xml version="1.0" encoding="utf-8"?>', "<resources>", '    <version>1</version>', '    <category title="Void" />']
total = 0
for row in ICONS:
    name, label, _, pkgs = row[:4]
    extra = row[4] if len(row) > 4 else []
    comps = set()
    for p in pkgs:
        comps |= {f"{p}/{c}" for c in by_pkg.get(p, ())}
    comps |= set(extra)
    if not comps:
        print("WARNING no components for", name)
    lines.append(f"    <!-- {label} -->")
    for c in sorted(comps):
        lines.append(f"    <item component={quoteattr('ComponentInfo{' + c + '}')} drawable=\"{name}\" />")
    total += len(comps)
    draw.append(f'    <item drawable="{name}" />')
lines.append("</resources>")
draw.append("</resources>")
(HERE / "iconpack/appfilter.xml").write_text("\n".join(lines) + "\n")
(HERE / "iconpack/drawable.xml").write_text("\n".join(draw) + "\n")
print(f"{len(ICONS)} icons, {total} components")
