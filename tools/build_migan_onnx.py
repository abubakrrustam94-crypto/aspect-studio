"""Сборка migan.onnx для «Убрать лишнее» (нужны torch, onnx, onnxsim).
Вход: migan_traced.pt (https://github.com/Sanster/models/releases/download/migan/migan_traced.pt).
Запуск: python3 tools/build_migan_onnx.py migan_traced.pt migan.onnx   (затем tools/onnx_half_storage.py для fp16-хранения)"""
import sys, torch, onnx, onnxsim
src, dst = sys.argv[1:3]
m = torch.jit.load(src, map_location='cpu').eval()
torch.onnx.export(m, torch.randn(1, 4, 512, 512), dst, input_names=['x'], output_names=['y'], opset_version=17, dynamo=False)
ms, ok = onnxsim.simplify(onnx.load(dst)); assert ok; onnx.save(ms, dst)
print('Готово:', dst)
