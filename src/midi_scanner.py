import mido
import time

def scan_loop(queue, interval=2.0):
    """
    Processus indépendant pour scanner les ports MIDI.
    Évite de bloquer le thread principal si le driver (WinMM) gèle.
    """
    while True:
        try:
            # Cette opération peut bloquer si le driver est instable
            ports = mido.get_input_names()

            # On vide la queue pour ne garder que le dernier état
            while not queue.empty():
                try: queue.get_nowait()
                except: break

            queue.put(ports)
        except Exception:
            pass

        time.sleep(interval)
