import sys, numpy as np, onnx
from onnx import helper as H, TensorProto as T, numpy_helper as N
from pth_reader import load_pth

class G:
    def __init__(s, half): s.nodes = []; s.inits = []; s.n = 0; s.half = half
    def name(s, p): s.n += 1; return f'{p}{s.n}'
    def w(s, arr, nm):
        arr = np.asarray(arr, np.float32)
        if s.half:
            s.inits.append(N.from_array(arr.astype(np.float16), nm + '_h'))
            s.nodes.append(H.make_node('Cast', [nm + '_h'], [nm], to=T.FLOAT, name='cast_' + nm)); return nm
        s.inits.append(N.from_array(arr, nm)); return nm
    def conv(s, x, W, b):
        n = s.name('c'); o = n + '_o'
        s.nodes.append(H.make_node('Conv', [x, s.w(W, n + '_w'), s.w(b, n + '_b')], [o], pads=[1, 1, 1, 1], kernel_shape=[3, 3], name=n)); return o
    def lrelu(s, x):
        o = s.name('l'); s.nodes.append(H.make_node('LeakyRelu', [x], [o], alpha=0.2)); return o
    def prelu(s, x, slope):
        n = s.name('p'); o = n + '_o'; s.nodes.append(H.make_node('PRelu', [x, s.w(slope.reshape(-1, 1, 1), n + '_s')], [o])); return o
    def add(s, a, b): o = s.name('a'); s.nodes.append(H.make_node('Add', [a, b], [o])); return o
    def mulc(s, a, v):
        n = s.name('m'); s.inits.append(N.from_array(np.array(v, np.float32), n + '_k')); o = n + '_o'; s.nodes.append(H.make_node('Mul', [a, n + '_k'], [o])); return o
    def cat(s, xs): o = s.name('t'); s.nodes.append(H.make_node('Concat', xs, [o], axis=1)); return o
    def up(s, x, f):
        n = s.name('u'); s.inits.append(N.from_array(np.array([1, 1, f, f], np.float32), n + '_sc')); s.inits.append(N.from_array(np.array([], np.float32), n + '_roi')); o = n + '_o'
        s.nodes.append(H.make_node('Resize', [x, n + '_roi', n + '_sc'], [o], mode='nearest', coordinate_transformation_mode='asymmetric', nearest_mode='floor')); return o
    def shuffle(s, x, r): o = s.name('d'); s.nodes.append(H.make_node('DepthToSpace', [x], [o], blocksize=r, mode='CRD')); return o

def finish(g, out, name):
    inp = H.make_tensor_value_info('input', T.FLOAT, [1, 3, 'h', 'w']); outv = H.make_tensor_value_info(out, T.FLOAT, [1, 3, 'H', 'W'])
    for nd in g.nodes:
        pass
    graph = H.make_graph(g.nodes, name, [inp], [outv], g.inits)
    m = H.make_model(graph, opset_imports=[H.make_opsetid('', 13)]); m.ir_version = 8
    onnx.checker.check_model(m); return m

def compact(sd, half):
    g = G(half); x = 'input'; h = x; i = 0
    while f'body.{i}.weight' in sd:
        W = sd[f'body.{i}.weight']
        if W.ndim == 4: h = g.conv(h, W, sd[f'body.{i}.bias'])
        else: h = g.prelu(h, W)
        i += 1
    h = g.shuffle(h, 4); base = g.up(x, 4); out = g.add(h, base)
    return finish(g, out, 'compact4x'), g

def rrdb(sd, half):
    g = G(half); x = 'input'
    feat = g.conv(x, sd['conv_first.weight'], sd['conv_first.bias'])
    h = feat; nb = 0
    while f'body.{nb}.rdb1.conv1.weight' in sd: nb += 1
    for b in range(nb):
        inp = h; t = h
        for r in (1, 2, 3):
            p = f'body.{b}.rdb{r}.'; xs = [t]
            for k in range(1, 5):
                y = g.lrelu(g.conv(g.cat(xs) if len(xs) > 1 else xs[0], sd[p + f'conv{k}.weight'], sd[p + f'conv{k}.bias'])); xs.append(y)
            y5 = g.conv(g.cat(xs), sd[p + 'conv5.weight'], sd[p + 'conv5.bias'])
            t = g.add(g.mulc(y5, 0.2), t)
        h = g.add(g.mulc(t, 0.2), inp)
    body = g.conv(h, sd['conv_body.weight'], sd['conv_body.bias']); feat = g.add(feat, body)
    feat = g.lrelu(g.conv(g.up(feat, 2), sd['conv_up1.weight'], sd['conv_up1.bias']))
    feat = g.lrelu(g.conv(g.up(feat, 2), sd['conv_up2.weight'], sd['conv_up2.bias']))
    out = g.conv(g.lrelu(g.conv(feat, sd['conv_hr.weight'], sd['conv_hr.bias'])), sd['conv_last.weight'], sd['conv_last.bias'])
    return finish(g, out, 'rrdb4x'), g

if __name__ == '__main__':
    src, kind, dst = sys.argv[1:4]; half = len(sys.argv) > 4 and sys.argv[4] == 'half'
    sd = load_pth(src); sd = sd.get('params_ema') or sd.get('params') or sd
    m, g = (compact if kind == 'compact' else rrdb)(sd, half)
    onnx.save(m, dst); import os; print(dst, os.path.getsize(dst), 'байт, узлов', len(m.graph.node))
