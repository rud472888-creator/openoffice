"""Package the wasm-bindgen web output and pin its digest."""
from hashlib import sha256
from pathlib import Path
from sys import argv
from zipfile import ZipFile, ZIP_DEFLATED, ZipInfo

root = Path(argv[1])
vendor = Path(__file__).parent
with ZipFile(vendor / 'runtime.zip', 'w') as archive:
    for path in sorted(root.rglob('*')):
        if path.is_file():
            info = ZipInfo(path.relative_to(root).as_posix())
            archive.writestr(info, path.read_bytes(), ZIP_DEFLATED, compresslevel=9)
(vendor / 'runtime.sha256').write_text(sha256((vendor / 'runtime.zip').read_bytes()).hexdigest() + '\n')
