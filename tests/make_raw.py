"""Делает синтетические DNG (Bayer RGGB, 16 бит, без сжатия) для теста LibRaw: четыре цветных квадранта.
Настоящих RAW в репозитории нет, поэтому проверяется весь путь «файл → проявление → холст».
pip install numpy scipy tifffile"""
import os, numpy as np, tifffile
from scipy.ndimage import gaussian_filter
OUT = os.path.join(os.path.dirname(__file__), 'fixtures')
W, H = 160, 120
rgb = np.zeros((H, W, 3), np.float64)       # красный | синий / зелёный | жёлтый, линейный свет
rgb[:H//2, :W//2] = (1, 0, 0); rgb[:H//2, W//2:] = (0, 0, 1); rgb[H//2:, :W//2] = (0, .6, 0); rgb[H//2:, W//2:] = (1, 1, 0)
for c in range(3): rgb[..., c] = gaussian_filter(rgb[..., c], 1.2)
mos = np.zeros((H, W), np.float64)          # RGGB
mos[0::2, 0::2] = rgb[0::2, 0::2, 0]; mos[0::2, 1::2] = rgb[0::2, 1::2, 1]; mos[1::2, 0::2] = rgb[1::2, 0::2, 1]; mos[1::2, 1::2] = rgb[1::2, 1::2, 2]
data = np.round(np.clip(mos, 0, 1) * 60000).astype(np.uint16)
X2S = [3.2404542, -1.5371385, -0.4985314, -0.9692660, 1.8760108, 0.0415560, 0.0556434, -0.2040259, 1.0572252]   # XYZ → линейный sRGB: «камера» = sRGB
def dng(name, orient=1):
    tags = [(33421, 'H', 2, (2, 2), True), (33422, 'B', 4, (0, 1, 1, 2), True), (50706, 'B', 4, (1, 4, 0, 0), True), (50707, 'B', 4, (1, 1, 0, 0), True),
            (50708, 's', 0, 'Aspect Test Camera', True), (50714, 'H', 1, 0, True), (50717, 'I', 1, 65535, True),
            (50721, 10, 9, tuple(v for x in X2S for v in (int(round(x * 10000)), 10000)), True),
            (50728, 5, 3, (1, 1, 1, 1, 1, 1), True), (50778, 'H', 1, 21, True), (274, 'H', 1, orient, True)]
    tifffile.imwrite(os.path.join(OUT, name), data, photometric=32803, extratags=tags, rowsperstrip=H)
dng('raw_quad.dng'); dng('raw_quad_rot6.dng', 6)
print('ok')
