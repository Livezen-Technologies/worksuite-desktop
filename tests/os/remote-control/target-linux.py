# The test window for check.mjs on Linux (X11): a pad for the mouse and a text
# box for the keyboard, reporting each thing that arrives as a line of JSON.
# Coordinates are X root-window pixels, as xdotool's are.
import json
import subprocess
import sys
import tkinter as tk


def say(o):
    sys.stdout.write(json.dumps(o) + "\n")
    sys.stdout.flush()


BUTTONS = {1: "left", 2: "middle", 3: "right"}
WHEEL = {4: "up", 5: "down", 6: "left", 7: "right"}
SHIFT, CONTROL, ALT, SUPER = 0x1, 0x4, 0x8, 0x40

root = tk.Tk()
root.title("rc-target")
root.geometry("640x420+200+150")
pad = tk.Frame(root, width=640, height=300, bg="lightsteelblue")
pad.place(x=0, y=0)
box = tk.Text(root, undo=False)
box.place(x=0, y=300, width=640, height=120)


def wheel(e):
    # Tk 8.6 hands X's sideways buttons (6, 7) over as 4 and 5 with Shift.
    sideways = e.num in (4, 5) and e.state & SHIFT
    say({"e": "wheel", "dir": {4: "left", 5: "right"}[e.num] if sideways else WHEEL[e.num], "dx": 0, "dy": 0})


def down(e, clicks=1):
    if e.num in WHEEL:
        wheel(e)
        return
    say({"e": "down", "button": BUTTONS.get(e.num, "other"), "clicks": clicks, "x": e.x_root, "y": e.y_root})


pad.bind("<ButtonPress>", down)
# The second press of a double-click comes here instead.
pad.bind("<Double-ButtonPress-1>", lambda e: down(e, 2))
pad.bind("<ButtonRelease>", lambda e: say({"e": "up", "button": BUTTONS.get(e.num, "other")}) if e.num in BUTTONS else None)
pad.bind("<B1-Motion>", lambda e: say({"e": "drag", "button": "left", "x": e.x_root, "y": e.y_root}))
box.bind("<ButtonPress>", lambda e: wheel(e) if e.num in WHEEL else None, add="+")


def key(e):
    say({"e": "key", "key": e.keysym.lower(), "shift": bool(e.state & SHIFT), "ctrl": bool(e.state & CONTROL), "alt": bool(e.state & ALT), "meta": bool(e.state & SUPER)})


box.bind("<KeyPress>", key, add="+")


def changed(_e):
    if box.edit_modified():
        say({"e": "text", "value": box.get("1.0", "end-1c")})
        box.edit_modified(False)


box.bind("<<Modified>>", changed)


def ready():
    root.update_idletasks()
    ids = subprocess.run(["xdotool", "search", "--name", "^rc-target$"], capture_output=True, text=True).stdout.split()
    rect = lambda w: {"x": w.winfo_rootx(), "y": w.winfo_rooty(), "width": w.winfo_width(), "height": w.winfo_height()}
    say({"ready": True, "window": ids[0] if ids else "", "frame": rect(root), "pad": rect(pad), "box": rect(box)})


box.focus_set()
root.after(800, ready)
root.mainloop()
