import mido
import time
import os
from utils import get_app_dir

def scan_loop(queue, interval=0.5):
    """
    Processus indépendant pour scanner les ports MIDI.
    Évite de bloquer le thread principal si le driver (WinMM) gèle.
    """
    # Log startup
    try:
        log_path = os.path.join(get_app_dir(), "debug.log")
        with open(log_path, "a", encoding="utf-8") as f:
            f.write(f"[SCANNER] Starting Subprocess loop (Interval={interval}s)...\n")
    except: pass

    while True:
        try:
            # Cette opération peut bloquer si le driver est instable
            time.sleep(0.2) # Allow Windows to refresh inventory
            ports = mido.get_input_names()
            
            # Log ports if found (only occasionally or on change to avoid spam?)
            # Let's log every 10th scan or if not empty? 
            # Better: just put in queue. Subprocess logging is risky for perf.
            # But we need to know if it works.
            # Let's log only if ports are found.
            if ports:
                 pass # We rely on main process to log reception

            # On vide la queue pour ne garder que le dernier état
            while not queue.empty():
                try: queue.get_nowait()
                except: break

            queue.put(ports)
        except Exception as e:
            try:
                log_path = os.path.join(get_app_dir(), "debug.log")
                with open(log_path, "a", encoding="utf-8") as f:
                   f.write(f"[SCANNER] Error: {e}\n")
            except: pass
            
        time.sleep(interval)
