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

    @abc.abstractmethod
    def get_ports(self): return []
    
    @abc.abstractmethod
    def get_output_ports(self): return []

    @abc.abstractmethod
    def start_output(self, port_name): pass

    @abc.abstractmethod
    def send_message(self, msg): pass

# ==========================================
# 1. MIDO PROVIDER (Legacy/USB)
# ==========================================
class MidoProvider(MidiProvider):
    def __init__(self, device_name, callback):
        super().__init__(device_name, callback)
        self.input_port = None
        self.output_port = None # NEW: Output
        self.running = False
        self.thread = None
        self.scanner_process = None
        self.scan_queue = None
        self.last_known_ports = []
        self.last_known_outputs = [] # NEW

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
        
        # Close Output
        if self.output_port:
            try: self.output_port.close()
            except: pass
            self.output_port = None

        self.is_connected = False

    def get_ports(self):
        return self.last_known_ports
        
    def get_output_ports(self):
        try: return mido.get_output_names()
        except: return []

    def start_output(self, port_name):
        if self.output_port:
            try: self.output_port.close()
            except: pass
            self.output_port = None
            
        if not port_name: return

        try:
            self.log(f"Opening Output: {port_name}")
            self.output_port = mido.open_output(port_name)
            self.log("Output Opened successfully.")
        except Exception as e:
            self.log(f"Failed to open Output {port_name}: {e}")

    def send_message(self, msg):
        if self.output_port:
            try:
                self.output_port.send(msg)
                # self.log(f"SENT: {msg}")
            except Exception as e:
                self.log(f"Send Error: {e}")

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
        self.char_uuid = None # Stored for writing if needed

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
        
    def get_output_ports(self):
        # BLE acts as input/output same device usually
        return ["(BLE Device)"] 

    def start_output(self, port_name):
        # Implicitly handled by connection
        pass

    def send_message(self, msg):
        # TODO: Implement BLE Write if needed
        # Requires converting mido msg to bytes and writing to char_uuid
        # For now, advanced routing mainly targets PC Soft (Mido)
        pass

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

        while self.running:
            if self.is_connected:
                consecutive_adapter_errors = 0
                if self.client and self.client.is_connected:
                    await asyncio.sleep(1.0)
                    continue
                else:
                    self.log("Disconnected")
                    self.is_connected = False

            if not self.scanning_enabled:
                await asyncio.sleep(1.0)
                continue

            try:
                # Scan
                # Increase delay to reduce load on adapter
                await asyncio.sleep(2.0)

                devices = await scanner.discover(timeout=3.0)
                self.discovered_devices = devices
                # Reset error count if scan succeeds
                consecutive_adapter_errors = 0

                target_device = None
                for d in devices:
                    if d.name and self.target_name.lower() in d.name.lower():
                        target_device = d
                        break

                if target_device:
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
                                self.char_uuid = found_char # STORE UUID
                                self.is_connected = True
                                self.last_error = None
                                self.log("Connected (BLE) & Subscribed!")
                            except Exception as e:
                                self.log(f"Subscription Error: {e}")
                                await self.client.disconnect()
                        else:
                            self.log("Error: No known MIDI characteristic found in candidates.")
                            
                            # Fallback & Debug: Try ANY notify characteristic
                            fallback_char = None
                            for s in self.client.services:
                                for c in s.characteristics:
                                    props = c.properties
                                    # self.log(f" - Char: {c.uuid} | Props: {props}")
                                    if "notify" in props and not fallback_char:
                                        fallback_char = c.uuid

                            if fallback_char:
                                self.log(f"Trying Fallback Notify Char: {fallback_char}")
                                try:
                                    await self.client.start_notify(fallback_char, self._on_notify)
                                    self.char_uuid = fallback_char # STORE UUID
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
    @staticmethod
    def create(mode, device_name, callback):
        if mode == "BLE":
            return BleakProvider(device_name, callback)
        return MidoProvider(device_name, callback)
