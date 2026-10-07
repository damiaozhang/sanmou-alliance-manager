import frida, sys, time

target = int(sys.argv[1]) if len(sys.argv) > 1 else 8344
timeout = float(sys.argv[2]) if len(sys.argv) > 2 else 15

print(f"[{time.time():.1f}] Attaching to pid {target}...", flush=True)
t0 = time.time()
try:
    session = frida.attach(target)
    print(f"[{time.time():.1f}] attach OK in {time.time()-t0:.2f}s", flush=True)
    script = session.create_script("console.log('hello');")
    print(f"[{time.time():.1f}] script created", flush=True)
    script.load()
    print(f"[{time.time():.1f}] script loaded OK in {time.time()-t0:.2f}s", flush=True)
    script.unload()
    session.detach()
    print(f"[{time.time():.1f}] DONE total {time.time()-t0:.2f}s", flush=True)
except Exception as e:
    print(f"[{time.time():.1f}] ERROR after {time.time()-t0:.2f}s: {type(e).__name__}: {e}", flush=True)
    sys.exit(1)
