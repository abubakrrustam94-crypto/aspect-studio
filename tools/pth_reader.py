import zipfile, pickle, numpy as np, collections
class _S:  # заглушка хранилища
    def __init__(s, dtype): s.dtype = dtype
def load_pth(path):
    z = zipfile.ZipFile(path); names = z.namelist()
    pk = [n for n in names if n.endswith('data.pkl')][0]; root = pk[:-len('data.pkl')]
    class Storage:
        pass
    def rebuild(storage, offset, size, stride, *a):
        key, dt = storage
        buf = z.read(root + 'data/' + key)
        arr = np.frombuffer(buf, dtype=dt)
        n = int(np.prod(size)) if len(size) else 1
        out = np.lib.stride_tricks.as_strided(arr[offset:], shape=size, strides=[s * arr.itemsize for s in stride]) if len(size) else arr[offset:offset+1].reshape(())
        return np.array(out)
    class U(pickle.Unpickler):
        def find_class(self, mod, name):
            if name == '_rebuild_tensor_v2': return rebuild
            if name == 'OrderedDict': return collections.OrderedDict
            if mod == 'torch' and name.endswith('Storage'):
                return {'FloatStorage': np.float32, 'HalfStorage': np.float16, 'LongStorage': np.int64}[name]
            if mod == 'torch._utils' or mod == 'torch': return lambda *a, **k: None
            return super().find_class(mod, name)
        def persistent_load(self, pid):
            typ, storage_type, key, loc, n = pid
            return (key, storage_type)
    return U(z.open(root + 'data.pkl')).load()
if __name__ == '__main__':
    import sys
    sd = load_pth(sys.argv[1])
    print(list(sd.keys())[:5])
    for k in sd:
        if isinstance(sd[k], dict):
            sd = sd[k]; break
    for k, v in list(sd.items())[:12]: print(k, getattr(v, 'shape', v), getattr(v,'dtype',''))
    print(len(sd))
