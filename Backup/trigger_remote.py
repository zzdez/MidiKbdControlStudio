from src.gui import MidiKbdApp
app = MidiKbdApp()
app.update()
app.open_remote_control()
app.after(1000, app.destroy)
app.mainloop()
