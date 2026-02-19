import abc
import threading
import time
import datetime
import asyncio
import multiprocessing
import queue
import mido

# Try importing Bleak
try:
    from bleak import BleakScanner, BleakClient
    BLEAK_AVAILABLE = True
except ImportError:
    BLEAK_AVAILABLE = False

from midi_scanner import scan_loop

class MidiProvider(abc.ABC):
    def __init__(self, device_name, callback):
        self.target_name = device_name
        self.callback = callback
        self.is_connected = False
        self.last_error = None
        self.scanning_enabled = True

    def log(self, message):
        timestamp = datetime.datetime.now().strftime("%H:%M:%S")
        try:
            with open("debug.log", "a", encoding="utf-8") as f:
                f.write(f"[{timestamp}] [{self.__class__.__name__}] {message}\n")
        except: pass

    @abc.abstractmethod
    def start(self): pass

    @abc.abstractmethod
    def stop(self): pass

    def set_scanning(self, enabled):
        self.scanning_enabled = enabled
        self.log(f"Auto-Scan {'activé' if enabled else 'désactivé'}")

    def restart(self, new_name):
        self.log(f"Restarting for {new_name}")
        self.stop()
        self.target_name = new_name
        self.start()

    def force_rescan(self):
        """Optional method to force a hardware scan. Override if needed."""
        self.log("Force rescan triggered (Base: No-op)")

    @abc.abstractmethod
    def get_ports(self): return []

# ==========================================
# 1. MIDO PROVIDER (Legacy/USB)
# ==========================================
class MidoProvider(MidiProvider):
    def __init__(self, device_name, callback):
        super().__init__(device_name, callback)
        self.input_port = None
        self.running = False
        self.thread = None
        self.scanner_process = None
        self.scan_queue = None
        self.last_known_ports = []

    def _internal_callback(self, msg):
        if self.callback: self.callback(msg)

    def start(self):
        self.running = True
        # Subprocess Scanner
        self.scan_queue = multiprocessing.Queue()
        self.scanner_process = multiprocessing.Process(target=scan_loop, args=(self.scan_queue,), daemon=True)
        self.scanner_process.start()

        self.thread = threading.Thread(target=self._monitor_connection, daemon=True)
        self.thread.start()

    def stop(self):
        self.running = False
        if self.scanner_process:
            self.scanner_process.terminate()
        if self.input_port:
            try: self.input_port.close()
            except: pass
            self.input_port = None
        self.is_connected = False

    def force_rescan(self):
        self.log("Forcing Rescan (Clearing Cache)...")
        self.last_known_ports = []
        # We don't need to restart the process, the loop will refill it soon.

    def get_ports(self):
        return self.last_known_ports

    def _monitor_connection(self):
        self.log(f"Started. Target: '{self.target_name}'")
        while self.running:
            # Update ports
            if self.scan_queue:
                try:
                    while not self.scan_queue.empty():
                        self.last_known_ports = self.scan_queue.get_nowait()
                except: pass

            if self.is_connected:
                time.sleep(1.0)
                continue

            if not self.scanning_enabled:
                time.sleep(1.0)
                continue

            try:
                available_ports = self.last_known_ports
                target_port = None
                if self.target_name in available_ports:
                    target_port = self.target_name
                else:
                    target_port = next((p for p in available_ports if self.target_name in p), None)

                if target_port:
                    self.log(f"Found: '{target_port}'")
                    try:
                        self.input_port = mido.open_input(target_port, callback=self._internal_callback)
                        self.is_connected = True
                        self.last_error = None
                        self.log("Connected (Mido)!")
                    except Exception as ex:
                        self.log(f"Connection Error: {ex}")
                        self.last_error = str(ex)
            except Exception as e:
                self.log(f"Loop Error: {e}")

            time.sleep(1.0)

# ==========================================
# 2. BLEAK PROVIDER (Bluetooth Direct)
# ==========================================
class BleakProvider(MidiProvider):
    # Candidate Characteristics for MIDI Data (Notify)
    CANDIDATE_CHARS = [
        "7772e5db-3868-4112-a1a9-f2669d106bf3", # Standard BLE MIDI
        "77711512-ccc0-4cd0-97b7-4a06dc85ca9e", # XSonic Proprietary
        "6e400003-b5a3-f393-e0a9-e50e24dcca9e"  # Nordic UART TX
    ]

    def __init__(self, device_name, callback):
        super().__init__(device_name, callback)
        self.loop = None
        self.client = None
        self.running = False
        self.thread = None
        self.discovered_devices = []
        self.force_reset_scanner = False

    def force_rescan(self):
        self.log("Forcing Rescan (Clearing Cache)...")
        self.discovered_devices = []
        self.force_reset_scanner = True

    def start(self):
        self.log(f"Starting BleakProvider... (Available={BLEAK_AVAILABLE})")
        if not BLEAK_AVAILABLE:
            self.last_error = "Bleak (lib) manquant"
            self.log("ERROR: Bleak not available.")
            return
        self.running = True
        self.thread = threading.Thread(target=self._run_async_loop, daemon=True)
        self.thread.start()
        self.log("Bleak Thread launched.")

    def stop(self):
        self.running = False
        # Async cleanup relies on loop checking 'running'

    def get_ports(self):
        return [d.name for d in self.discovered_devices if d.name]

    def _run_async_loop(self):
        self.log("Async Loop Thread Entering...")
        try:
            # Fix for Windows Asyncio Policy in Thread
            if hasattr(asyncio, "WindowsSelectorEventLoopPolicy"):
                asyncio.set_event_loop_policy(asyncio.WindowsSelectorEventLoopPolicy())

            asyncio.run(self._main_loop())
        except Exception as e:
            self.log(f"Async Loop CRASH: {e}")

    async def _main_loop(self):
        self.log("Bleak Engine Started")
        scanner = BleakScanner()
        consecutive_adapter_errors = 0

        force_scan_iteration = False

        while self.running:
            if self.force_reset_scanner:
                self.log("Re-initializing BleakScanner...")
                scanner = BleakScanner()
                self.force_reset_scanner = False
                force_scan_iteration = True

            if self.is_connected and not force_scan_iteration:
                consecutive_adapter_errors = 0
                if self.client and self.client.is_connected:
                    await asyncio.sleep(1.0)
                    continue
                else:
                    self.log("Disconnected")
                    self.is_connected = False
            
            # If we are here, we scan (either not connected, or forced iteration)

            if not self.scanning_enabled and not force_scan_iteration:
                await asyncio.sleep(1.0)
                continue

            try:
                # Scan
                # Increase delay to reduce load on adapter
                if force_scan_iteration:
                     self.log("Forced Scan Iteration... (Fast Path)")
                     await asyncio.sleep(0.1)
                else:
                     await asyncio.sleep(2.0)

                devices = await scanner.discover(timeout=3.0)
                
                # Update Cache
                self.discovered_devices = devices
                
                # Reset error count if scan succeeds
                consecutive_adapter_errors = 0

                # Consume force flag
                force_scan_iteration = False

                target_device = None
                for d in devices:
                    # Generic Discovery: We just list them. Connection happens if target matches.
                    # But wait, this loop searches for target TO CONNECT.
                    # We need to separate Scanning from Connecting? 
                    # Actually, MidoProvider separates them. BleakProvider mixes them in _main_loop?
                    # Let's see: `if target_device: connect`.
                    # So we need to KEEP the target check for connection, 
                    # BUT `self.discovered_devices = devices` ensures `get_ports` returns everything.
                    # The filter was:
                    # if d.name and self.target_name.lower() in d.name.lower(): target_device = d
                    # This is correct for AUTO-CONNECTION to a specific target.
                    # But for DISCOVERY (get_ports), we just need `devices`.
                    # And `self.discovered_devices = devices` is already there!
                    # So `get_ports` works.
                    # The issue is `self.target_name` default "AIRSTEP" prevents connecting to others?
                    # No, if user selects "Korg", `restart("Korg")` updates target_name.
                    # So the loop is fine IF `get_ports` returns everything.
                    # Let's verify `get_ports`. It returns `[d.name for d in self.discovered_devices]`.
                    # BleakScanner.discover() returns all.
                    # So what is the change?
                    # The user said: "Supprime tous les filtres qui cherchent spécifiquement la chaîne de caractères Airstep".
                    # Ah, `MidiScanner.scan_loop` (for USB) had filters. `bleak_provider` didn't really? 
                    # Let's check the loop again.
                    if d.name and self.target_name.lower() in d.name.lower():
                         # This IS the connection logic. It connects if name matches target.
                         # This is fine. If target is "Korg", it connects to "Korg".
                         target_device = d
                         break


                if target_device and not self.is_connected:
                    self.log(f"Connecting BLE: {target_device.name} ({target_device.address})...")
                    self.client = BleakClient(target_device.address)
                    await self.client.connect()

                    if self.client.is_connected:
                        self.log("BLE Connected. Finding MIDI Characteristic...")

                        found_char = None
                        services_map = {c.uuid: c for s in self.client.services for c in s.characteristics}

                        for candidate in self.CANDIDATE_CHARS:
                            if candidate in services_map:
                                char = services_map[candidate]
                                if "notify" in char.properties:
                                    found_char = candidate
                                    break

                        if found_char:
                            try:
                                self.log(f"Subscribing to: {found_char}")
                                await self.client.start_notify(found_char, self._on_notify)
                                self.is_connected = True
                                self.last_error = None
                                self.log("Connected (BLE) & Subscribed!")
                            except Exception as e:
                                self.log(f"Subscription Error: {e}")
                                await self.client.disconnect()
                        else:
                            self.log("Error: No known MIDI characteristic found in candidates.")
                            self.log("Dumping available services to debug log...")
                            
                            # Fallback & Debug: Try ANY notify characteristic
                            fallback_char = None
                            for s in self.client.services:
                                for c in s.characteristics:
                                    props = c.properties
                                    self.log(f" - Char: {c.uuid} | Props: {props}")
                                    if "notify" in props and not fallback_char:
                                        fallback_char = c.uuid

                            if fallback_char:
                                self.log(f"Trying Fallback Notify Char: {fallback_char}")
                                try:
                                    await self.client.start_notify(fallback_char, self._on_notify)
                                    self.is_connected = True
                                    self.last_error = None
                                    self.log("Connected (BLE - Fallback)!")
                                except Exception as e:
                                     self.log(f"Fallback Failed: {e}")
                                     # HID MODE SUCCESS
                                     self.is_connected = True
                                     self.last_error = None
                                     self.log("Connected (HID Mode - No Notify)")
                            else:
                                # HID MODE SUCCESS (No Notify Chars found, but connected)
                                self.log("No Notify Char found. Assuming HID/Limited connection.")
                                self.is_connected = True
                                self.last_error = None

                    else:
                        self.log("Failed to connect (client.is_connected=False)")
            except Exception as e:
                err_str = str(e)
                self.log(f"BLE Error: {err_str}")
                self.last_error = err_str

                # Check for critical adapter failure
                if "No Bluetooth adapter found" in err_str:
                    consecutive_adapter_errors += 1
                    self.log(f"CRITICAL: Bluetooth Adapter Missing ({consecutive_adapter_errors}/3)")

                    if consecutive_adapter_errors >= 3:
                        self.log("EMERGENCY STOP: Stopping Scan to protect Hardware.")
                        self.last_error = "CRITICAL: Adapter Crashed. Restart PC."
                        self.running = False
                        break

                    # Wait longer before retrying to let hardware recover
                    await asyncio.sleep(5.0)

            await asyncio.sleep(2.0)

        if self.client:
            try: await self.client.disconnect()
            except: pass

    def _on_notify(self, sender, data):
        # Improved BLE MIDI Parser (Pattern Matching)
        try:
            bytes_list = list(data)
            # self.log(f"BLE RX: {[hex(b) for b in bytes_list]}")

            i = 0
            while i < len(bytes_list):
                b = bytes_list[i]

                # Check for CC (0xB0..0xBF) or NoteOn/Off (0x80..0x9F) -> 3 bytes
                if (b & 0xF0) in [0x80, 0x90, 0xB0, 0xE0]:
                    if i + 2 < len(bytes_list):
                        d1 = bytes_list[i+1]
                        d2 = bytes_list[i+2]
                        if d1 < 0x80 and d2 < 0x80:
                            # Valid 3-byte message pattern found (Status + Data + Data)
                            msg = mido.Message.from_bytes([b, d1, d2])
                            if self.callback: self.callback(msg)
                            i += 3
                            continue

                # Check for PC (0xC0..0xCF) or ChanPress (0xD0) -> 2 bytes
                elif (b & 0xF0) in [0xC0, 0xD0]:
                    if i + 1 < len(bytes_list):
                        d1 = bytes_list[i+1]
                        if d1 < 0x80:
                            # Valid 2-byte message pattern found
                            msg = mido.Message.from_bytes([b, d1])
                            if self.callback: self.callback(msg)
                            i += 2
                            continue

                i += 1
        except Exception as e:
            self.log(f"Parse Error: {e}")

class MidiManager:
    _active_ports = [] # List of (name, mido_port) tuples
    _target_port_names = [] # List of strings (config)

    @staticmethod
    def create(mode, device_name, callback):
        if mode == "BLE":
            return BleakProvider(device_name, callback)
        return MidoProvider(device_name, callback)

    @classmethod
    def get_available_outputs(cls):
        try:
            return mido.get_output_names()
        except:
            return []

    @classmethod
    def set_output_ports(cls, port_names):
        """
        Configures the list of output ports.
        Attempt to open each port. If a port fails or is missing,
        it is skipped for sending but WRITTEN to config/memory as 'target'.
        """
        if not isinstance(port_names, list):
            port_names = [port_names] if port_names else []

        # 1. Store the target configuration (Persistence Rule #2)
        cls._target_port_names = port_names

        # 2. Close existing ports
        for name, port in cls._active_ports:
            try:
                port.close()
            except: pass
        cls._active_ports = []

        # 3. Open new ports (Robustness Rule #1)
        available = cls.get_available_outputs()
        
        for name in port_names:
            if not name: continue
            
            # Fuzzy match or exact match logic could go here, 
            # for now we assume exact match or simple containment if needed, 
            # but mido.open_output usually expects exact name or strict prefix.
            
            # Check if physically present (optional, but avoids mido error if we know it's gone)
            # However, mido might handle "virtual" ports differently. 
            # We try to open it inside a try/except.
            
            try:
                # If name is not in available, mido might raise IOError
                # We attempt to open it anyway.
                out = mido.open_output(name)
                cls._active_ports.append((name, out))
                print(f"[MidiManager] Connected output: '{name}'")
            except Exception as e:
                # Robustness: Log and continue
                print(f"[MidiManager] Could not open output '{name}': {e}")

        print(f"[MidiManager] Active Outputs: {len(cls._active_ports)} / Configured: {len(cls._target_port_names)}")

    @classmethod
    def send_message(cls, channel, cc, value):
        if not cls._active_ports:
            print("[MIDI OUT] ERREUR : Tentative d'envoi mais aucun port de sortie n'est actif dans le Manager.")
            return
        
        # Debug Log for Port List
        port_names = [p[0] for p in cls._active_ports]
        print(f"[MIDI OUT] Tentative d'envoi vers {port_names}")
        
        # Clamp values
        ch = max(0, min(15, int(channel) - 1)) # 1-16 -> 0-15
        cc_val = max(0, min(127, int(cc)))
        val = max(0, min(127, int(value)))
        
        msg = mido.Message('control_change', channel=ch, control=cc_val, value=val)
        
        for name, port in cls._active_ports:
            try:
                port.send(msg)
                # Logging Rule #3: Specific port log (User Requested Format)
                print(f"[MIDI OUT] Message envoyé avec SUCCÈS vers le port : '{name}' (CC {cc_val}, Val {val}, Ch {int(channel)})")
            except Exception as e:
                print(f"[MIDI OUT] ÉCHEC d'envoi vers '{name}' : {e}")
    
    @classmethod
    def get_ports_status(cls):
        """
        Returns a list of dicts for the GUI/API:
        [
            {"name": "LoopMIDI Port", "active": True, "connected": True},
            {"name": "Fender", "active": True, "connected": False}, # specific case where we want to show it's missing?
            {"name": "Microsoft GS", "active": False, "connected": True} 
        ]
        """
        available = cls.get_available_outputs()
        status_list = []
        
        # We want to list ALL available ports AND any configured ports that are missing
        all_names = set(available) | set(cls._target_port_names)
        
        for name in sorted(list(all_names)):
            is_configured = name in cls._target_port_names
            is_connected = any(p[0] == name for p in cls._active_ports)
            is_available = name in available
            
            status_list.append({
                "name": name,
                "selected": is_configured,
                "connected": is_connected, # Successfully opened
                "available": is_available  # Physically present
            })
            
        return status_list
