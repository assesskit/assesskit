"""Writes the ZIP fixtures: archives that Python's zipfile writes or reads, so that a second implementation vouches for them.

Valid archives (stored and deflated entries, UTF-8 names, directories, a streamed archive with data descriptors, a ZIP64
archive) come with the entries zipfile reads from them. The hostile archives are what a tool produces for the cases of
BPIG section 6.7: a path that leaves the package, an absolute path, a backslash, a symbolic link, two names that
normalize alike, and a zip bomb.
"""

import hashlib
import io
import json
import random
import struct
import zipfile
import zlib
from pathlib import Path

OUTPUT = Path(__file__).resolve().parent.parent / "packages" / "runtime" / "test" / "fixtures" / "zip"
SEED = 20260103
MANIFEST = (
    '<?xml version="1.0" encoding="UTF-8"?>\n'
    '<manifest xmlns="http://www.imsglobal.org/xsd/qti/qtiv3p0/imscp_v1p1" identifier="fixture">'
    "<metadata><schema>QTI Package</schema><schemaversion>3.0.0</schemaversion></metadata><organizations/>"
    '<resources><resource identifier="a" type="webcontent" href="a.txt"><file href="a.txt"/></resource></resources>'
    "</manifest>\n"
)
# The date every entry gets, so that the files do not change when the script runs again.
DATE_TIME = (1980, 1, 1, 0, 0, 0)
UNIX = 3
SYMLINK_MODE = 0o120777


def entry(name, data, method=zipfile.ZIP_DEFLATED):
    info = zipfile.ZipInfo(name, DATE_TIME)
    info.compress_type = method
    info.create_system = 0
    return info, data


def write_archive(entries, streamed=False):
    """Writes entries to an archive; a streamed archive is written to a stream that cannot seek, so it has data descriptors."""
    buffer = io.BytesIO()
    target = buffer
    if streamed:
        class Stream(io.RawIOBase):
            def writable(self):
                return True

            def write(self, data):
                buffer.write(data)
                return len(data)

        target = Stream()
    with zipfile.ZipFile(target, "w") as archive:
        for info, data in entries:
            if info.is_dir():
                archive.writestr(info, b"")
            elif streamed:
                with archive.open(info, "w") as file:
                    file.write(data)
            else:
                archive.writestr(info, data, compress_type=info.compress_type)
    return buffer.getvalue()


def zip64_archive(files):
    """Writes the archive with ZIP64 records by hand, as zip -fz does: markers in the headers, 64-bit values in the extra
    field, a ZIP64 end of central directory record and its locator (APPNOTE 4.3.14, 4.3.15, 4.5.3)."""
    marker = 0xFFFFFFFF
    out = bytearray()
    central = bytearray()
    for name, data in files:
        raw = name.encode()
        compressor = zlib.compressobj(6, zlib.DEFLATED, -15)
        compressed = compressor.compress(data) + compressor.flush()
        crc = zlib.crc32(data)
        extra = struct.pack("<HHQQ", 1, 16, len(data), len(compressed))
        offset = len(out)
        out += struct.pack("<IHHHHHIIIHH", 0x04034B50, 45, 0x800, 8, 0, 0x21, crc, marker, marker, len(raw), len(extra))
        out += raw + extra + compressed
        central_extra = struct.pack("<HHQQQ", 1, 24, len(data), len(compressed), offset)
        central += struct.pack(
            "<IHHHHHHIIIHHHHHII", 0x02014B50, 45, 45, 0x800, 8, 0, 0x21, crc, marker, marker, len(raw),
            len(central_extra), 0, 0, 0, 0, marker,
        )
        central += raw + central_extra
    directory_offset = len(out)
    out += central
    record_offset = len(out)
    out += struct.pack("<IQHHIIQQQQ", 0x06064B50, 44, 45, 45, 0, 0, len(files), len(files), len(central), directory_offset)
    out += struct.pack("<IIQI", 0x07064B50, 0, record_offset, 1)
    out += struct.pack("<IHHHHIIH", 0x06054B50, 0, 0, 0xFFFF, 0xFFFF, marker, marker, 0)
    return bytes(out)


def symlink_entry():
    info = zipfile.ZipInfo("link", DATE_TIME)
    info.create_system = UNIX
    info.external_attr = SYMLINK_MODE << 16
    return info, b"/etc/passwd"


def main():
    generator = random.Random(SEED)
    OUTPUT.mkdir(parents=True, exist_ok=True)
    noise = bytes(generator.randrange(256) for _ in range(300))
    text = ("<p>Which city is the capital of Indonesia?</p>\n" * 40).encode()
    valid = [
        entry("imsmanifest.xml", MANIFEST.encode()),
        entry("items/", b"", zipfile.ZIP_STORED),
        entry("items/a.xml", text),
        entry("media/", b"", zipfile.ZIP_STORED),
        entry("media/noise.bin", noise, zipfile.ZIP_STORED),
        entry("media/ünï.txt", "déjà vu".encode()),
        entry("empty.txt", b""),
    ]
    archives = {
        "valid.zip": write_archive(valid),
        "streamed.zip": write_archive([item for item in valid if not item[0].is_dir()], streamed=True),
        "zip64.zip": zip64_archive([("imsmanifest.xml", MANIFEST.encode()), ("items/a.xml", text), ("empty.txt", b"")]),
        "zip-slip.zip": write_archive([entry("imsmanifest.xml", MANIFEST.encode()), entry("../evil.txt", b"x")]),
        "absolute.zip": write_archive([entry("imsmanifest.xml", MANIFEST.encode()), entry("/etc/passwd", b"x")]),
        "backslash.zip": write_archive([entry("imsmanifest.xml", MANIFEST.encode()), entry("items\\a.xml", b"x")]),
        "symlink.zip": write_archive([entry("imsmanifest.xml", MANIFEST.encode()), symlink_entry()]),
        "duplicate.zip": write_archive([entry("imsmanifest.xml", MANIFEST.encode()), entry("a.xml", b"x"), entry("./a.xml", b"y")]),
        "bomb.zip": write_archive([entry("imsmanifest.xml", MANIFEST.encode()), entry("zeros.bin", bytes(40_000_000))]),
    }
    expected = {}
    for name, data in archives.items():
        (OUTPUT / name).write_bytes(data)
        with zipfile.ZipFile(io.BytesIO(data)) as archive:
            expected[name] = [
                {"name": info.filename, "size": info.file_size, "sha256": hashlib.sha256(archive.read(info)).hexdigest()}
                for info in archive.infolist()
                if not info.is_dir()
            ]
    (OUTPUT / "zips.json").write_text(json.dumps(expected, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")


main()
