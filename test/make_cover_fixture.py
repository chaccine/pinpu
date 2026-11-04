#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""生成 test/fixtures/cover_color.mp3：ID3v2.3 + 多色块 PNG 封面（无第三方依赖）。
用法： python3 test/make_cover_fixture.py
"""
import os
import struct
import zlib

HERE = os.path.dirname(os.path.abspath(__file__))
FIX = os.path.join(HERE, "fixtures")


def chunk(kind, data):
    return (struct.pack(">I", len(data)) + kind + data
            + struct.pack(">I", zlib.crc32(kind + data) & 0xffffffff))


def make_png(width=96, height=96):
    """四象限彩色 PNG：红/蓝/绿/洋红，保证取色可得到多个色相。"""
    quad = [
        (235, 30, 45),    # 红
        (35, 75, 220),    # 蓝
        (40, 210, 90),    # 绿
        (220, 40, 200),   # 洋红
    ]
    rows = []
    for y in range(height):
        row = bytearray(b"\x00")
        for x in range(width):
            idx = (0 if x < width // 2 else 1) + (0 if y < height // 2 else 2)
            row += bytes(quad[idx])
        rows.append(bytes(row))
    raw = b"".join(rows)
    return (b"\x89PNG\r\n\x1a\n"
            + chunk(b"IHDR", struct.pack(">IIBBBBB", width, height, 8, 2, 0, 0, 0))
            + chunk(b"IDAT", zlib.compress(raw, 9))
            + chunk(b"IEND", b""))


def synchsafe(n):
    return bytes([(n >> 21) & 0x7f, (n >> 14) & 0x7f, (n >> 7) & 0x7f, n & 0x7f])


def frame(fid, payload):
    return fid.encode("ascii") + struct.pack(">I", len(payload)) + b"\x00\x00" + payload


def text_frame(fid, text):
    return frame(fid, b"\x00" + text.encode("latin-1"))


def make_tag(png):
    apic = b"\x00" + b"image/png\x00" + b"\x03" + b"Cover\x00" + png
    body = (text_frame("TIT2", "Color Cover")
            + text_frame("TPE1", "Palette Test")
            + text_frame("TALB", "Fixture")
            + frame("APIC", apic))
    return b"ID3\x03\x00\x00" + synchsafe(len(body)) + body


def main():
    os.makedirs(FIX, exist_ok=True)
    source = os.path.join(FIX, "id3v23_cn.mp3")
    with open(source, "rb") as fh:
        data = fh.read()
    size = ((data[6] & 0x7f) << 21) | ((data[7] & 0x7f) << 14) \
        | ((data[8] & 0x7f) << 7) | (data[9] & 0x7f)
    audio = data[10 + size:]
    out = os.path.join(FIX, "cover_color.mp3")
    with open(out, "wb") as fh:
        fh.write(make_tag(make_png()) + audio)
    print(f"wrote {out} ({os.path.getsize(out)} bytes, audio {len(audio)} bytes)")


if __name__ == "__main__":
    main()
