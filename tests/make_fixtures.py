"""Генератор маленьких тестовых файлов разных форматов (64×48, четыре цветных квадранта).
Нужен один раз; готовые файлы лежат в tests/fixtures и закоммичены.
pip install pillow pillow-heif imagecodecs tifffile numpy OpenEXR"""
import struct, zlib, os, io
import numpy as np
from PIL import Image
import pillow_heif, tifffile, imagecodecs

W, H = 64, 48
OUT = os.path.join(os.path.dirname(__file__), 'fixtures'); os.makedirs(OUT, exist_ok=True)
# красный | синий  /  зелёный | жёлтый
a = np.zeros((H, W, 3), np.uint8)
a[:H//2, :W//2] = (255, 0, 0); a[:H//2, W//2:] = (0, 0, 255); a[H//2:, :W//2] = (0, 200, 0); a[H//2:, W//2:] = (255, 255, 0)
img = Image.fromarray(a)
def w(name, data, mode='wb'):
    with open(os.path.join(OUT, name), mode) as f: f.write(data)

img.save(os.path.join(OUT, 'quad.jpg'), quality=95)
img.resize((32, 24)).save(os.path.join(OUT, 'thumb.jpg'), quality=95)
img.save(os.path.join(OUT, 'quad.gif')); img.save(os.path.join(OUT, 'quad.bmp'))
img.resize((48, 48)).save(os.path.join(OUT, 'quad.ico'), sizes=[(48, 48)])
pillow_heif.register_heif_opener(); img.save(os.path.join(OUT, 'quad.heic'), quality=95)
w('quad.jxl', imagecodecs.jpegxl_encode(a, lossless=True))
tifffile.imwrite(os.path.join(OUT, 'quad_lzw.tif'), a, compression='lzw')
tifffile.imwrite(os.path.join(OUT, 'quad_16.tif'), (a.astype(np.uint16) * 257), compression='deflate')
img.save(os.path.join(OUT, 'quad_jpeg.tif'), compression='jpeg', quality=95)   # libtiff: JPEG-в-TIFF, YCbCr
tifffile.imwrite(os.path.join(OUT, 'quad_planar.tif'), a.transpose(2, 0, 1), planarconfig='separate', photometric='rgb')
tifffile.imwrite(os.path.join(OUT, 'quad_rot6.tif'), a, extratags=[(274, 'H', 1, 6, True)])   # Orientation=6: 64×48 → 48×64

# --- EXR (линейный свет; жёлтый заметно ярче 1, чтобы проверить тонмаппинг) ---
import OpenEXR, Imath
def lin(c): c = c / 255.0; return np.where(c <= 0.04045, c / 12.92, ((c + 0.055) / 1.055) ** 2.4).astype(np.float32)
f = lin(a.astype(np.float32))
for comp, name in [(Imath.Compression.ZIP_COMPRESSION, 'quad_zip.exr'), (Imath.Compression.PIZ_COMPRESSION, 'quad_piz.exr'), (Imath.Compression.NO_COMPRESSION, 'quad_none.exr')]:
    hdr = OpenEXR.Header(W, H); hdr['compression'] = Imath.Compression(comp)
    hdr['channels'] = {c: Imath.Channel(Imath.PixelType(Imath.PixelType.FLOAT)) for c in 'RGB'}
    o = OpenEXR.OutputFile(os.path.join(OUT, name), hdr)
    o.writePixels({c: f[:, :, i].tobytes() for i, c in enumerate('RGB')}); o.close()

# --- HDR (Radiance RGBE): плоский и RLE ---
def rgbe(px):
    m = max(px)
    if m < 1e-32: return (0, 0, 0, 0)
    import math
    e = math.frexp(m); s = e[0] * 256.0 / m
    return (int(px[0] * s), int(px[1] * s), int(px[2] * s), e[1] + 128)
rows = [[rgbe(tuple(f[y, x])) for x in range(W)] for y in range(H)]
hdr = b'#?RADIANCE\nFORMAT=32-bit_rle_rgbe\n\n-Y %d +X %d\n' % (H, W)
w('quad_flat.hdr', hdr + b''.join(bytes(p) for r in rows for p in r))
def rle_row(r):
    out = bytearray([2, 2, W >> 8, W & 255])
    for c in range(4):
        ch = bytes(p[c] for p in r); i = 0
        while i < W:
            j = i
            while j < W and ch[j] == ch[i] and j - i < 127: j += 1
            if j - i >= 3: out += bytes([128 + j - i, ch[i]]); i = j
            else:
                k = i
                while k < W and (k - i < 128) and not (k + 2 < W and ch[k] == ch[k+1] == ch[k+2]): k += 1
                k = max(k, i + 1); out += bytes([k - i]) + ch[i:k]; i = k
    return bytes(out)
w('quad_rle.hdr', hdr + b''.join(rle_row(r) for r in rows))

# --- PSD / PSB: собираем сами (композит) ---
def psd(name, ver=1, depth=8, comp=0, mode=3, alpha=False):
    planes = [a[:, :, c] for c in range(3)]
    arrs = [p.astype(np.uint8) for p in planes]
    if mode == 4:
        rr, gg, bb = [x.astype(np.float32) / 255 for x in (a[:, :, 0], a[:, :, 1], a[:, :, 2])]
        K = 1 - np.maximum(np.maximum(rr, gg), bb); d = np.maximum(1 - K, 1e-6)
        C = (1 - rr - K) / d; M = (1 - gg - K) / d; Y = (1 - bb - K) / d
        arrs = [np.round((1 - v) * 255).astype(np.uint8) for v in (C, M, Y, K)]   # храним инвертированно: 255 = нет краски
    if alpha: arrs.append(np.full((H, W), 255, np.uint8))
    if depth == 16: arrs = [(x.astype(np.uint16) * 257).astype('>u2') for x in arrs]
    ch = len(arrs)
    hd = b'8BPS' + struct.pack('>H', ver) + b'\0' * 6 + struct.pack('>HIIHH', ch, H, W, depth, mode)
    body = struct.pack('>I', 0) + struct.pack('>I', 0) + (struct.pack('>Q', 0) if ver == 2 else struct.pack('>I', 0))
    if comp == 0: data = struct.pack('>H', 0) + b''.join(x.tobytes() for x in arrs)
    else:
        counts = b''; rowsd = b''
        for x in arrs:
            for r in range(H):
                raw = x[r].tobytes(); enc = bytearray(); i = 0; bps = depth // 8
                # PackBits по байтам строки: только литералы по 128 — достаточно для проверки декодера
                while i < len(raw):
                    n = min(128, len(raw) - i); enc += bytes([n - 1]) + raw[i:i+n]; i += n
                rowsd += bytes(enc); counts += struct.pack('>I' if ver == 2 else '>H', len(enc))
        data = struct.pack('>H', 1) + counts + rowsd
    w(name, hd + body + data)
psd('quad.psd'); psd('quad_rle.psd', comp=1); psd('quad_16.psd', depth=16); psd('quad_alpha.psd', alpha=True); psd('quad_cmyk.psd', mode=4); psd('quad.psb', ver=2); psd('quad_rle.psb', ver=2, comp=1)

# --- XCF: v003 (4-байтные указатели, RLE и без сжатия) и v011 (8-байтные), два слоя ---
def xcf(name, ver, comp):
    def u32(v): return struct.pack('>I', v)
    def i32(v): return struct.pack('>i', v)
    def ptr(v): return struct.pack('>Q', v) if ver >= 11 else u32(v)
    def prop(t, payload): return u32(t) + u32(len(payload)) + payload
    def string(s): b = s.encode() + b'\0'; return u32(len(b)) + b
    def rle(plane):
        out = bytearray(); n = len(plane); i = 0
        while i < n:
            j = i
            while j < n and plane[j] == plane[i] and j - i < 127: j += 1
            if j - i >= 2: out += bytes([j - i - 1, plane[i]]); i = j
            else:
                k = min(i + 100, n); out += bytes([256 - (k - i)]) + bytes(plane[i:k]); i = k
        return bytes(out)
    def layer_bytes(rgba, lw, lh, lt, bpp, base_off):
        # раскладываем: layer header | hierarchy | level | tiles
        tx, ty = (lw + 63) // 64, (lh + 63) // 64; ntiles = tx * ty
        # размеры заголовков
        psz = 8 if ver >= 11 else 4
        layer_hdr_len = 4 * 3 + len(string('layer')) + len(prop(6, u32(255))) + len(prop(8, u32(1))) + len(prop(15, i32(0) + i32(0))) + len(prop(0, b'')) + 2 * psz
        hier_len = 12 + 2 * psz
        level_len = 8 + (ntiles + 1) * psz
        tiles = []
        for t in range(ntiles):
            x0, y0 = (t % tx) * 64, (t // tx) * 64; tw, th = min(64, lw - x0), min(64, lh - y0)
            blk = rgba[y0:y0+th, x0:x0+tw, :bpp].reshape(-1, bpp)
            if comp == 0: tiles.append(blk.tobytes())
            else: tiles.append(b''.join(rle(blk[:, c].tobytes()) for c in range(bpp)))
        hier_off = base_off + layer_hdr_len; level_off = hier_off + hier_len; tile_off = level_off + level_len
        offs = []; o = tile_off
        for t in tiles: offs.append(o); o += len(t)
        lay = u32(lw) + u32(lh) + u32(lt) + string('layer') + prop(6, u32(255)) + prop(8, u32(1)) + prop(15, i32(0) + i32(0)) + prop(0, b'') + ptr(hier_off) + ptr(0)
        hier = u32(lw) + u32(lh) + u32(bpp) + ptr(level_off) + ptr(0)
        lvl = u32(lw) + u32(lh) + b''.join(ptr(x) for x in offs) + ptr(0)
        assert len(lay) == layer_hdr_len and len(hier) == hier_len and len(lvl) == level_len
        return lay + hier + lvl + b''.join(tiles)
    rgb = np.dstack([a, np.full((H, W, 1), 255, np.uint8)])
    head = b'gimp xcf ' + (b'file' if ver == 0 else b'v%03d' % ver) + b'\0' + u32(W) + u32(H) + u32(0)
    if ver >= 4: head += u32(150 if ver >= 7 else 0)
    props = prop(17, bytes([comp])) + prop(0, b'')
    psz = 8 if ver >= 11 else 4
    hdr_len = len(head) + len(props) + 2 * psz + psz     # один слой + нуль + нуль каналов
    lay_off = hdr_len
    blob = layer_bytes(rgb, W, H, 1, 4, lay_off)
    w(name, head + props + ptr(lay_off) + ptr(0) + ptr(0) + blob)
xcf('quad_v003.xcf', 3, 1); xcf('quad_v003_raw.xcf', 3, 0); xcf('quad_v011.xcf', 11, 1)

# --- SVG, EPS, AI ---
w('quad.svg', b'<svg xmlns="http://www.w3.org/2000/svg" width="64" height="48" viewBox="0 0 64 48"><rect width="32" height="24" fill="#f00"/><rect x="32" width="32" height="24" fill="#00f"/><rect y="24" width="32" height="24" fill="#00c800"/><rect x="32" y="24" width="32" height="24" fill="#ff0"/></svg>')
w('quad_novb.svg', b'<svg xmlns="http://www.w3.org/2000/svg"><rect width="100" height="100" fill="#f00"/></svg>')
g = np.array(img.convert('L'))
hexrows = '\n'.join('%' + ''.join('%02x' % v for v in row) for row in g)
w('quad_epsi.eps', ('%!PS-Adobe-3.0 EPSF-3.0\n%%BoundingBox: 0 0 64 48\n%%BeginPreview: 64 48 8 48\n' + hexrows + '\n%%EndPreview\n%%EndComments\nshowpage\n').encode('latin1'))
buf = io.BytesIO(); tifffile.imwrite(buf, a, compression='lzw'); tiff = buf.getvalue()
ps = b'%!PS-Adobe-3.0 EPSF-3.0\n%%BoundingBox: 0 0 64 48\nshowpage\n'
w('quad_dos.eps', struct.pack('<IIIIIII', 0xC6D3D0C5, 30, len(ps), 0, 0, 30 + len(ps), len(tiff)) + b'\xff\xff' + ps + tiff)
img.save(os.path.join(OUT, 'quad.ai'), 'PDF')
w('noprev.eps', b'%!PS-Adobe-3.0 EPSF-3.0\n%%BoundingBox: 0 0 10 10\n0 0 moveto 10 10 lineto stroke\nshowpage\n')
print('готово:', sorted(os.listdir(OUT)))

# --- JPEG с EXIF: камера, дата и геолокация (для проверки удаления метаданных) ---
ex = Image.Exif()
ex[0x010F] = 'TestCam'; ex[0x0110] = 'Model X'; ex[0x0131] = 'SecretSoftware 1.0'
ex.get_ifd(0x8769)[0x9003] = '2024:05:01 10:20:30'
ex.get_ifd(0x8825).update({1: 'N', 2: (55.0, 45.0, 0.0), 3: 'E', 4: (37.0, 37.0, 0.0)})
img.save(os.path.join(OUT, 'exif_gps.jpg'), quality=95, exif=ex)

# --- PNG/JPEG с профилем «Display P3» (вручную собранный ICC: матрица Display P3 для D50, гамма 2,2) ---
def s15(v): return struct.pack('>i', int(round(v * 65536)))
def xyz_tag(x, y, z): return b'XYZ \0\0\0\0' + s15(x) + s15(y) + s15(z)
def text_tag(s): return b'text\0\0\0\0' + s.encode() + b'\0'
def desc_tag(s): b = s.encode() + b'\0'; return b'desc\0\0\0\0' + struct.pack('>I', len(b)) + b + struct.pack('>IIHB', 0, 0, 0, 0) + b'\0' * 67
curv = b'curv\0\0\0\0' + struct.pack('>IH', 1, 0x0233) + b'\0\0'
tags = [(b'desc', desc_tag('Display P3')), (b'wtpt', xyz_tag(0.9642, 1.0, 0.8249)),
        (b'rXYZ', xyz_tag(0.5151, 0.2412, -0.0011)), (b'gXYZ', xyz_tag(0.2920, 0.6922, 0.0419)), (b'bXYZ', xyz_tag(0.1571, 0.0666, 0.7841)),
        (b'rTRC', curv), (b'gTRC', curv), (b'bTRC', curv), (b'cprt', text_tag('test'))]
off = 128 + 4 + 12 * len(tags); body = b''; table = b''
for sig, data in tags:
    pad = (-len(data)) % 4; table += sig + struct.pack('>II', off + len(body), len(data)); body += data + b'\0' * pad
hdr = bytearray(128)
struct.pack_into('>I', hdr, 8, 0x02100000); hdr[12:16] = b'mntr'; hdr[16:20] = b'RGB '; hdr[20:24] = b'XYZ '; hdr[36:40] = b'acsp'
hdr[68:80] = s15(0.9642) + s15(1.0) + s15(0.8249)
icc = bytes(hdr[:0]) + bytes(hdr)
prof = struct.pack('>I', len(tags)) + table + body
icc = bytearray(hdr + prof); struct.pack_into('>I', icc, 0, len(icc)); icc = bytes(icc)
p3 = np.zeros((H, W, 3), np.uint8); p3[:] = (204, 102, 51)
Image.fromarray(p3).save(os.path.join(OUT, 'p3_orange.png'), icc_profile=icc)
Image.fromarray(p3).save(os.path.join(OUT, 'p3_orange.jpg'), quality=100, icc_profile=icc, subsampling=0)
print('exif/p3 ок')
