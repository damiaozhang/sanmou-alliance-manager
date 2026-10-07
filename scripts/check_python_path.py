"""检查系统 PATH 中 python 的解析结果和 frida 可用性（模拟 Rust 应用环境）。"""
import subprocess
import sys

print("=== 本进程 python:", sys.executable, flush=True)
print("=== 本进程 frida:", flush=True)
try:
    import frida
    print("  frida", frida.__version__, flush=True)
except Exception as exc:
    print("  NO frida:", exc, flush=True)

# 模拟 Rust: Command::new("python") 的系统 PATH 解析
print("\n=== where python ===", flush=True)
r = subprocess.run(["where", "python"], capture_output=True, timeout=15)
print("  rc:", r.returncode, flush=True)
print("  stdout:", r.stdout.decode("gbk", errors="replace").strip(), flush=True)
print("  stderr:", r.stderr.decode("gbk", errors="replace").strip(), flush=True)

# 模拟 Rust: Command::new("py").args(["-3"])
print("\n=== py -3 ===", flush=True)
r2 = subprocess.run(["py", "-3", "-c", "import sys; print(sys.executable)"], capture_output=True, timeout=15)
print("  rc:", r2.returncode, flush=True)
print("  stdout:", r2.stdout.decode("gbk", errors="replace").strip(), flush=True)
print("  stderr:", r2.stderr.decode("gbk", errors="replace").strip(), flush=True)

# 系统 PATH 里 python 的 frida
print("\n=== 系统 PATH python 是否有 frida ===", flush=True)
r3 = subprocess.run(["python", "-c", "import frida; print(frida.__version__)"], capture_output=True, timeout=30)
print("  rc:", r3.returncode, flush=True)
print("  stdout:", r3.stdout.decode("gbk", errors="replace").strip(), flush=True)
print("  stderr:", r3.stderr.decode("gbk", errors="replace").strip()[:500], flush=True)
