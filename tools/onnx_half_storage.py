"""Уменьшает ONNX-модель вдвое: веса float32 хранятся как float16 и приводятся обратно (Cast) при загрузке.
Вычисления остаются в float32 (onnxruntime сворачивает Cast в константу), точность падает лишь на округлении весов.
python3 tools/onnx_half_storage.py in.onnx out.onnx [мин. число элементов, по умолчанию 256]"""
import sys, numpy as np, onnx
from onnx import helper as H, numpy_helper as N, TensorProto as T
src, dst = sys.argv[1:3]; minel = int(sys.argv[3]) if len(sys.argv) > 3 else 256
m = onnx.load(src); g = m.graph; keep = []; casts = []; used = set()
for n in g.node:
    for i in n.input: used.add(i)
for init in g.initializer:
    a = N.to_array(init)
    if a.dtype == np.float32 and a.size >= minel and init.name in used and np.all(np.abs(a) < 65000):
        h = N.from_array(a.astype(np.float16), init.name + '__h'); keep.append(h)
        casts.append(H.make_node('Cast', [h.name], [init.name], to=T.FLOAT, name='cast__' + init.name))
    else: keep.append(init)
del g.initializer[:]; g.initializer.extend(keep)
nodes = list(g.node); del g.node[:]; g.node.extend(casts + nodes)
onnx.checker.check_model(m); onnx.save(m, dst)
import os; print(dst, os.path.getsize(src), '→', os.path.getsize(dst))
