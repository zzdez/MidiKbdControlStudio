import sys
import os
sys.path.append(os.path.abspath('x:/AirstepStudio/src'))

import customtkinter as ctk
from remote_gui import RemoteControl

app = ctk.CTk()
try:
    print("Init RemoteControl")
    remote = RemoteControl(app, {"name": "Test", "buttons": []}, {"name": "TestProfile"}, lambda x: None, lambda: None)
    print("Success")
except Exception as e:
    import traceback
    traceback.print_exc()
