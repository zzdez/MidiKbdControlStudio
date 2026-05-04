import sys, pathlib, json
pdf_path = pathlib.Path(r'x:/AirstepStudio/OM_2274900000_Tone-Master-Pro_EN.pdf')
if not pdf_path.is_file():
    print('PDF not found')
    sys.exit(1)
try:
    from PyPDF2 import PdfReader
except Exception as e:
    print('PyPDF2 not available:', e)
    sys.exit(1)
reader = PdfReader(str(pdf_path))
text = ''
for page in reader.pages:
    try:
        txt = page.extract_text()
        if txt:
            text += txt + '\n'
    except Exception:
        continue
# Find section containing 'MIDI' (case‑insensitive)
lines = text.splitlines()
section = []
capture = False
for line in lines:
    if 'midi' in line.lower() and ('implementation' in line.lower() or 'chart' in line.lower()):
        capture = True
    if capture:
        section.append(line)
    # stop after blank line following some content
    if capture and line.strip() == '' and len(section) > 10:
        break
print('\n'.join(section[:200]))
