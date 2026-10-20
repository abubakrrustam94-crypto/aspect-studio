#!/usr/bin/env python3
"""Сборка модели удаления фона для Aspect Studio из U²-Net-P (u2netp.onnx, Apache-2.0, https://github.com/xuebinqin/U-2-Net).

ONNX → упрощённый граф (только Conv/Relu/MaxPool/Resize/Concat/Add/Sigmoid с готовыми размерами) + веса float16.
Выход: vendor/cutout/u2netp.json и vendor/cutout/u2netp.f16.bin; их читает js/cutout-worker.js (tfjs).
Зависимости: pip install onnx onnxsim numpy
Исходник: https://github.com/danielgatis/rembg/releases/download/v0.0.0/u2netp.onnx
"""
import sys, json, os
import numpy as np, onnx
from onnx import numpy_helper, shape_inference
from onnxsim import simplify

src = sys.argv[1] if len(sys.argv) > 1 else 'u2netp.onnx'
out = sys.argv[2] if len(sys.argv) > 2 else 'vendor/cutout'
os.makedirs(out, exist_ok=True)

m, ok = simplify(onnx.load(src)); assert ok
m = shape_inference.infer_shapes(m)
g = m.graph
inits = {i.name: numpy_helper.to_array(i) for i in g.initializer}
for n in g.node:                                     # одиночный Constant → в таблицу весов
    if n.op_type == 'Constant': inits[n.output[0]] = numpy_helper.to_array(n.attribute[0].t)
shapes = {v.name: [d.dim_value for d in v.type.tensor_type.shape.dim] for v in list(g.value_info) + list(g.output)}
OUT = g.output[0].name                                # d0 — итоговая маска; боковые выходы не нужны
nodes = {o: n for n in g.node if n.op_type != 'Constant' for o in n.output}

# обход назад: только то, что нужно для OUT
need, order, seen = [], [], set()
def visit(name):
    if name in seen or name in inits or name == g.input[0].name: return
    seen.add(name); n = nodes[name]
    for i in n.input:
        if i: visit(i)
    order.append(n)
visit(OUT)

W, blob, off = {}, [], 0
def add_w(name, arr):
    global off
    if name in W: return
    a = np.ascontiguousarray(arr.astype(np.float16)); W[name] = {'o': off, 'n': int(a.size), 's': list(a.shape)}
    blob.append(a.tobytes()); off += a.nbytes
def attrs(n): return {a.name: (list(a.ints) if a.ints else (a.f if a.type == 1 else a.i if a.type == 2 else a.s)) for a in n.attribute}

ops = []
for n in order:
    a, t = attrs(n), n.op_type
    if t == 'Conv':
        assert a.get('strides', [1, 1]) == [1, 1] and a.get('group', 1) == 1
        w = inits[n.input[1]]; add_w(n.input[1], w.transpose(2, 3, 1, 0))       # OIHW → HWIO
        if len(n.input) > 2: add_w(n.input[2], inits[n.input[2]])
        ops.append({'t': 'conv', 'i': n.input[0], 'o': n.output[0], 'w': n.input[1], 'b': n.input[2] if len(n.input) > 2 else None, 'd': a.get('dilations', [1, 1])[0], 'p': a.get('pads', [0, 0, 0, 0])[0], 'k': w.shape[2]})
    elif t == 'Relu': ops.append({'t': 'relu', 'i': n.input[0], 'o': n.output[0]})
    elif t == 'Sigmoid': ops.append({'t': 'sigmoid', 'i': n.input[0], 'o': n.output[0]})
    elif t == 'MaxPool':
        assert a['kernel_shape'] == [2, 2] and a['strides'] == [2, 2]
        ops.append({'t': 'pool', 'i': n.input[0], 'o': n.output[0]})
    elif t == 'Add': ops.append({'t': 'add', 'i': list(n.input), 'o': n.output[0]})
    elif t == 'Concat':
        assert a['axis'] == 1; ops.append({'t': 'cat', 'i': list(n.input), 'o': n.output[0]})
    elif t == 'Resize':
        assert a['mode'] == b'linear' and a['coordinate_transformation_mode'] == b'pytorch_half_pixel'
        s = shapes[n.output[0]]; ops.append({'t': 'resize', 'i': n.input[0], 'o': n.output[0], 'h': s[2], 'w': s[3]})
    else: raise SystemExit('неизвестная операция ' + t)

json.dump({'input': g.input[0].name, 'output': OUT, 'size': 320, 'ops': ops, 'w': W}, open(os.path.join(out, 'u2netp.json'), 'w'), separators=(',', ':'))
open(os.path.join(out, 'u2netp.f16.bin'), 'wb').write(b''.join(blob))
print('операций', len(ops), 'весов', len(W), 'байт', off)
