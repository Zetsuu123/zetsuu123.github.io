#!/usr/bin/env bash
# Builds every Void theme download into void-theme/.
#   ANDROID_SDK   Android SDK with platforms;android-36 and build-tools;36.0.0
#   NODE_MODULES  node_modules containing lucide-static@0.460.0 and simple-icons@13.21.0
#   playwright must be resolvable by node (NODE_PATH), plus python3 numpy+pillow, imagemagick, pngquant,
#   ffmpeg (libvorbis), zip and a JDK.
#   KEYSTORE      optional signing keystore (password "android"); a local one is made if missing.
set -euo pipefail
cd "$(dirname "$0")"
OUT=$(cd .. && pwd)
SDK=${ANDROID_SDK:?set ANDROID_SDK}
NM=${NODE_MODULES:?set NODE_MODULES}
KEYSTORE=${KEYSTORE:-$HOME/.android/void-icons.jks}
BT=$SDK/build-tools/36.0.0
JAR=$SDK/platforms/android-36/android.jar
WORK=$(mktemp -d)
trap 'rm -rf "$WORK"' EXIT

echo "== icons"
python3 build_icons.py "$NM" "$WORK/icons.html"
node render.mjs "$WORK/icons.html" "$WORK/png512"

echo "== icon pack apk"
mkdir -p "$WORK/res/drawable-nodpi" "$WORK/res/xml" "$WORK/res/values" "$WORK/assets" "$WORK/classes" "$WORK/dex"
for f in "$WORK"/png512/*.png; do
  convert "$f" -filter Lanczos -resize 320x320 -strip "$WORK/res/drawable-nodpi/$(basename "$f")"
done
pngquant --quality 75-95 --speed 1 --force --ext .png "$WORK"/res/drawable-nodpi/*.png
pngquant --quality 75-95 --speed 1 --force --ext .png "$WORK"/png512/*.png
cp iconpack/appfilter.xml iconpack/drawable.xml "$WORK/res/xml/"
cp iconpack/appfilter.xml iconpack/drawable.xml "$WORK/assets/"
cp iconpack/strings.xml "$WORK/res/values/"
"$BT/aapt2" compile --no-crunch --dir "$WORK/res" -o "$WORK/res.zip"
"$BT/aapt2" link -o "$WORK/base.apk" -I "$JAR" --manifest iconpack/AndroidManifest.xml \
  -A "$WORK/assets" --java "$WORK/gen" "$WORK/res.zip"
javac -nowarn --release 11 -classpath "$JAR" -d "$WORK/classes" \
  iconpack/MainActivity.java "$WORK/gen/io/github/zetsuu123/voidicons/R.java"
"$BT/d8" --release --lib "$JAR" --min-api 26 --output "$WORK/dex" $(find "$WORK/classes" -name '*.class')
cp "$WORK/base.apk" "$WORK/unsigned.apk"
(cd "$WORK/dex" && zip -q "$WORK/unsigned.apk" classes.dex)
"$BT/zipalign" -f -p 4 "$WORK/unsigned.apk" "$WORK/aligned.apk"
if [ ! -f "$KEYSTORE" ]; then
  mkdir -p "$(dirname "$KEYSTORE")"
  keytool -genkeypair -keystore "$KEYSTORE" -storepass android -keypass android -alias void \
    -keyalg RSA -keysize 2048 -validity 10000 -dname "CN=Void Icons" >/dev/null
fi
"$BT/apksigner" sign --ks "$KEYSTORE" --ks-pass pass:android --key-pass pass:android \
  --out "$OUT/void-icons.apk" "$WORK/aligned.apk"
rm -f "$OUT/void-icons.apk.idsig"

echo "== png set (for Theme Park > Change icons > Gallery)"
mkdir -p "$WORK/zip/Void icons"
python3 - "$WORK/png512" "$WORK/zip/Void icons" <<'EOF'
import shutil, sys
sys.path.insert(0, '.')
from icons import ICONS
src, dst = sys.argv[1:]
for row in ICONS:
    shutil.copy(f"{src}/{row[0]}.png", f"{dst}/{row[1]}.png")
shutil.copy(f"{src}/iconback.png", f"{dst}/_Blank portal.png")
EOF
rm -f "$OUT/void-icons-png.zip"
(cd "$WORK/zip" && zip -qr "$OUT/void-icons-png.zip" "Void icons")

echo "== previews"
python3 - "$WORK/png512" "$OUT/preview-icons.png" <<'EOF'
import sys
from PIL import Image
sys.path.insert(0, '.')
from icons import ICONS
src, out = sys.argv[1:]
names = [r[0] for r in ICONS]
cols, cell, gap = 8, 128, 20
rows = -(-len(names) // cols)
sheet = Image.new("RGBA", (cols * (cell + gap) + gap, rows * (cell + gap) + gap), (4, 3, 10, 255))
for i, n in enumerate(names):
    ic = Image.open(f"{src}/{n}.png").convert("RGBA").resize((cell, cell), Image.LANCZOS)
    sheet.alpha_composite(ic, (gap + (i % cols) * (cell + gap), gap + (i // cols) * (cell + gap)))
sheet.convert("RGB").save(out, optimize=True)
EOF
pngquant --quality 75-95 --speed 1 --force --ext .png "$OUT/preview-icons.png"

echo "== always on display"
python3 make_aod.py "$WORK/aod"
ffmpeg -hide_banner -loglevel error -y -framerate 12 -i "$WORK/aod/f%03d.png" \
  -vf "split[a][b];[a]palettegen=max_colors=96:stats_mode=full[p];[b][p]paletteuse=dither=bayer:bayer_scale=4" \
  -loop 0 "$OUT/void-portal-aod.gif"
# GitHub serves .gif as an image (it opens instead of downloading), so also ship it zipped
rm -f "$OUT/void-portal-aod.zip"
zip -q -j "$OUT/void-portal-aod.zip" "$OUT/void-portal-aod.gif"

echo "== sounds"
python3 make_sounds.py "$WORK/snd"
for f in void-whisper void-call; do
  ffmpeg -hide_banner -loglevel error -y -i "$WORK/snd/$f.wav" -c:a libvorbis -q:a 6 "$OUT/$f.ogg"
done

ls -la "$OUT" | grep -vE ' (src|\.|\.\.)$'
