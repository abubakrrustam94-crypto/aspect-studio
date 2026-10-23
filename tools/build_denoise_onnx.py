"""Сборка моделей шумоподавления для Aspect Studio (нужны torch, onnx, onnxsim, einops, timm).
FFDNet (цветной, KAIR v1.0 ffdnet_color.pth) и SCUNet (scunet_color_real_psnr.pth) экспортируются под плитку 256×256,
упрощаются onnxsim и сохраняются с весами fp16 (tools/onnx_half_storage.py).
Запуск: python3 tools/build_denoise_onnx.py <папка с .pth> <папка репозитория KAIR> <папка репозитория SCUNet> <выходная папка>"""
import sys, types, importlib.util, os, torch, onnx, onnxsim
wd, kair, scu, out = sys.argv[1:5]
sys.path.insert(0, kair)
sys.modules['thop'] = types.ModuleType('thop'); sys.modules['thop'].profile = lambda *a, **k: None   # thop нужен SCUNet только для подсчёта FLOPs
from models.network_ffdnet import FFDNet
sp = importlib.util.spec_from_file_location('scn', os.path.join(scu, 'models/network_scunet.py')); scn = importlib.util.module_from_spec(sp); sp.loader.exec_module(scn)
x = torch.randn(1, 3, 256, 256)
m = FFDNet(in_nc=3, out_nc=3, nc=96, nb=12, act_mode='R'); m.load_state_dict(torch.load(os.path.join(wd, 'ffdnet_color.pth'), map_location='cpu')); m.eval()
torch.onnx.export(m, (x, torch.full((1, 1, 1, 1), 15 / 255.)), os.path.join(out, 'ffdnet.onnx'), input_names=['x', 'sigma'], output_names=['y'], opset_version=17, dynamo=False)
n = scn.SCUNet(in_nc=3, config=[4] * 7, dim=64); n.load_state_dict(torch.load(os.path.join(wd, 'scunet_color_real_psnr.pth'), map_location='cpu')); n.eval()
torch.onnx.export(n, x, os.path.join(out, 'scunet.onnx'), input_names=['x'], output_names=['y'], opset_version=17, dynamo=False)
for f in ('ffdnet', 'scunet'):
    ms, ok = onnxsim.simplify(onnx.load(os.path.join(out, f + '.onnx'))); assert ok; onnx.save(ms, os.path.join(out, f + '_s.onnx'))
    os.system(f'python3 {os.path.dirname(__file__)}/onnx_half_storage.py {out}/{f}_s.onnx {out}/{f}_h.onnx')
print('Готово: *_h.onnx; scunet_h.onnx режется пополам на dn-scunet.onnx.p1/.p2')
