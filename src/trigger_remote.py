from src.gui import AirstepApp
app = AirstepApp()
app.update()
app.open_remote_control()
app.after(1000, app.destroy)
app.mainloop()
