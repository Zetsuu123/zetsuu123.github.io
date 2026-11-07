#!/usr/bin/env python3
"""Small always-on-top hardware overlay for Windows.

Reads sensor data from Open Hardware Monitor (or Libre Hardware Monitor)
through its built-in "Remote Web Server" (http://localhost:8085/data.json)
and shows CPU usage/temp/clock, GPU usage/temp/clock and RAM usage.

Only the Python standard library is used (tkinter + urllib).

Usage:
    pythonw hw_overlay.pyw                     # defaults
    python  hw_overlay.pyw --port 8086 --interval 0.5 --gpu "RTX"

Controls:
    Left-drag       move the overlay (position is remembered)
    Right-click     menu: opacity, always-on-top, reset position, exit
"""

import argparse
import json
import os
import re
import sys
import threading
import time
import urllib.request

# --------------------------------------------------------------------------
# Reading Open Hardware Monitor's data.json
# --------------------------------------------------------------------------

# Sensor group names used by Open/Libre Hardware Monitor (never localised).
GROUP_NAMES = {
    "Voltages", "Clocks", "Temperatures", "Load", "Fans", "Flows", "Controls",
    "Levels", "Factors", "Powers", "Data", "SmallData", "Throughput",
    "Currents", "Energy", "Noise", "Frequencies", "Timings", "Conductivities",
    "Humidities",
}


def parse_number(text):
    """Turn '45.0 °C', '3,6 GHz', '1,234.5 MHz' or '4523 MHz' into a float."""
    if text is None:
        return None
    if isinstance(text, (int, float)):
        return float(text)
    match = re.search(r"[-+]?\d[\d.,]*", str(text))
    if not match:
        return None
    num = match.group(0).rstrip(".,")
    if "." in num and "," in num:
        # Whichever separator comes last is the decimal one.
        if num.rfind(",") > num.rfind("."):
            num = num.replace(".", "").replace(",", ".")
        else:
            num = num.replace(",", "")
    elif "," in num:
        num = num.replace(",", "") if num.count(",") > 1 else num.replace(",", ".")
    elif num.count(".") > 1:
        num = num.replace(".", "")
    try:
        return float(num)
    except ValueError:
        return None


class Hardware:
    def __init__(self, node):
        self.name = node.get("Text", "")
        self.icon = (node.get("ImageURL") or "").lower()
        self.hwid = (node.get("HardwareId") or "").lower()
        self.sensors = {}  # group name -> list of (sensor name, float value)
        for child in node.get("Children") or []:
            group = child.get("Text", "")
            if group not in GROUP_NAMES:
                continue
            items = self.sensors.setdefault(group, [])
            for leaf in child.get("Children") or []:
                items.append((leaf.get("Text", ""), parse_number(leaf.get("Value"))))

    def get(self, group, *names):
        """Value of the first sensor whose name matches one of `names`."""
        sensors = self.sensors.get(group, [])
        for wanted in names:
            for name, value in sensors:
                if name.lower() == wanted.lower() and value is not None:
                    return value
        return None

    def matching(self, group, pattern):
        rx = re.compile(pattern, re.I)
        return [v for n, v in self.sensors.get(group, []) if rx.search(n) and v is not None]

    @property
    def is_cpu(self):
        return "cpu.png" in self.icon or bool(re.match(r"/(intel|amd)?cpu", self.hwid))

    @property
    def is_ram(self):
        if "virtual" in self.name.lower():
            return False
        return ("ram.png" in self.icon or self.hwid.startswith("/ram")
                or self.get("Load", "Memory") is not None)

    @property
    def is_gpu(self):
        return (any(k in self.icon for k in ("nvidia", "ati.png", "amd", "gpu"))
                or self.hwid.startswith("/gpu")
                or self.get("Load", "GPU Core") is not None)

    @property
    def gpu_priority(self):
        """Prefer a dedicated graphics card over integrated graphics."""
        if "integrated" in self.hwid:
            return 0
        if "nvidia" in self.icon or "nvidia" in self.hwid:
            return 3
        if "ati.png" in self.icon or "amd" in self.icon or "amd" in self.hwid:
            return 2
        return 1


def collect_hardware(node, out=None):
    if out is None:
        out = []
    children = node.get("Children") or []
    if any(c.get("Text") in GROUP_NAMES and c.get("Children") for c in children):
        out.append(Hardware(node))
    for child in children:
        collect_hardware(child, out)
    return out


def average(values):
    return sum(values) / len(values) if values else None


def read_stats(data, gpu_filter=None):
    """Extract the values the overlay shows from a parsed data.json tree."""
    hardware = collect_hardware(data)
    stats = {}

    cpu = next((h for h in hardware if h.is_cpu), None)
    if cpu:
        stats["cpu_load"] = cpu.get("Load", "CPU Total")
        stats["cpu_temp"] = cpu.get(
            "Temperatures", "CPU Package", "Core (Tctl/Tdie)", "CPU (Tctl/Tdie)",
            "Core (Tctl)", "Core (Tdie)", "Tdie", "Tctl", "Core Average", "CPU Cores",
            "Core Max",
        )
        if stats["cpu_temp"] is None:
            temps = cpu.matching("Temperatures", r"core|cpu|ccd") or cpu.matching("Temperatures", r".")
            stats["cpu_temp"] = max(temps) if temps else None
        clock = average(cpu.matching("Clocks", r"^(cpu )?core #\d+$"))
        if clock is None:
            clock = cpu.get("Clocks", "Cores (Average)", "Cores (Average Effective)")
        stats["cpu_clock"] = clock

    gpus = [h for h in hardware if h.is_gpu and not h.is_cpu]
    if gpu_filter:
        gpus = [h for h in gpus if gpu_filter.lower() in h.name.lower()] or gpus
    gpus.sort(key=lambda h: h.gpu_priority, reverse=True)
    if gpus:
        gpu = gpus[0]
        stats["gpu_name"] = gpu.name
        stats["gpu_load"] = gpu.get("Load", "GPU Core", "D3D 3D")
        stats["gpu_temp"] = gpu.get("Temperatures", "GPU Core", "GPU Hot Spot", "GPU Package")
        stats["gpu_clock"] = gpu.get("Clocks", "GPU Core", "GPU Shader")

    ram = next((h for h in hardware if h.is_ram and not h.is_cpu and not h.is_gpu), None)
    if ram:
        used = ram.get("Data", "Used Memory", "Memory Used")
        free = ram.get("Data", "Available Memory", "Memory Available")
        load = ram.get("Load", "Memory")
        total = used + free if used is not None and free is not None else None
        if load is None and total:
            load = used / total * 100
        stats["ram_load"] = load
        stats["ram_used"] = used
        stats["ram_total"] = total

    return stats


def fetch(url, timeout=2.0):
    with urllib.request.urlopen(url, timeout=timeout) as resp:
        return json.loads(resp.read().decode("utf-8-sig"))


# --------------------------------------------------------------------------
# Formatting
# --------------------------------------------------------------------------

def fmt_pct(v):
    return "--" if v is None else f"{v:.0f}%"


def fmt_temp(v):
    return "--" if v is None else f"{v:.0f}°C"


def fmt_clock(mhz):
    if mhz is None:
        return "--"
    return f"{mhz / 1000:.2f} GHz" if mhz >= 1000 else f"{mhz:.0f} MHz"


def fmt_ram(used, total):
    if used is None:
        return "--"
    if total:
        return f"{used:.1f}/{total:.0f} GB"
    return f"{used:.1f} GB"


GREEN, YELLOW, RED, DIM = "#7ee0a0", "#f0d060", "#ff6b6b", "#8a8aa0"


def level_color(v, warn, crit):
    if v is None:
        return DIM
    if v >= crit:
        return RED
    if v >= warn:
        return YELLOW
    return GREEN


# --------------------------------------------------------------------------
# Overlay window
# --------------------------------------------------------------------------

def config_path():
    base = os.environ.get("APPDATA") or os.path.expanduser("~")
    return os.path.join(base, "hw-overlay.json")


def load_config():
    try:
        with open(config_path(), "r", encoding="utf-8") as f:
            return json.load(f)
    except (OSError, ValueError):
        return {}


def save_config(cfg):
    try:
        with open(config_path(), "w", encoding="utf-8") as f:
            json.dump(cfg, f)
    except OSError:
        pass


class Poller(threading.Thread):
    """Fetches data.json in the background so the window never freezes."""

    def __init__(self, url, interval, gpu_filter):
        super().__init__(daemon=True)
        self.url, self.interval, self.gpu_filter = url, interval, gpu_filter
        self.lock = threading.Lock()
        self.stats, self.error = None, "connecting…"

    def run(self):
        while True:
            try:
                stats, error = read_stats(fetch(self.url), self.gpu_filter), None
            except Exception as exc:  # network errors, bad JSON, …
                stats, error = None, str(getattr(exc, "reason", exc))
            with self.lock:
                self.stats, self.error = stats, error
            time.sleep(self.interval)

    def latest(self):
        with self.lock:
            return self.stats, self.error


class Overlay:
    BG = "#101018"
    FG = "#e8e8f0"
    LABEL = "#9aa0ff"

    def __init__(self, args):
        import tkinter as tk
        self.tk = tk
        self.args = args
        self.cfg = load_config()
        self.poller = Poller(args.url, args.interval, args.gpu)
        self.poller.start()

        root = self.root = tk.Tk()
        root.title("HW Overlay")
        root.overrideredirect(True)
        root.configure(bg=self.BG)
        self.topmost = tk.BooleanVar(value=self.cfg.get("topmost", True))
        self.opacity = tk.DoubleVar(value=args.opacity or self.cfg.get("opacity", 0.85))
        root.attributes("-topmost", self.topmost.get())
        root.attributes("-alpha", self.opacity.get())

        size = args.font_size
        font = ("Consolas", size)
        bold = ("Consolas", size, "bold")
        frame = tk.Frame(root, bg=self.BG, padx=8, pady=5)
        frame.pack()

        self.cells = {}

        def cell(key, row, col, colspan=1):
            lbl = tk.Label(frame, text="--", font=font, bg=self.BG, fg=self.FG, anchor="e")
            lbl.grid(row=row, column=col, columnspan=colspan, sticky="e", padx=(10, 0))
            self.cells[key] = lbl

        for row, name in enumerate(("CPU", "GPU", "RAM")):
            tk.Label(frame, text=name, font=bold, bg=self.BG, fg=self.LABEL,
                     anchor="w").grid(row=row, column=0, sticky="w")
        cell("cpu_load", 0, 1); cell("cpu_temp", 0, 2); cell("cpu_clock", 0, 3)
        cell("gpu_load", 1, 1); cell("gpu_temp", 1, 2); cell("gpu_clock", 1, 3)
        cell("ram_load", 2, 1); cell("ram_used", 2, 2, colspan=2)

        self.status = tk.Label(frame, text="", font=("Consolas", max(size - 2, 7)),
                               bg=self.BG, fg=RED, anchor="w", justify="left",
                               wraplength=400)
        self.status.grid(row=3, column=0, columnspan=4, sticky="w")

        # Dragging, menu.
        for widget in [root, frame, *frame.winfo_children()]:
            widget.bind("<ButtonPress-1>", self.start_drag)
            widget.bind("<B1-Motion>", self.drag)
            widget.bind("<ButtonRelease-1>", self.end_drag)
            widget.bind("<Button-3>", self.show_menu)

        menu = self.menu = tk.Menu(root, tearoff=0)
        opac = tk.Menu(menu, tearoff=0)
        for pct in (100, 90, 80, 70, 60, 50, 40):
            opac.add_radiobutton(label=f"{pct}%", value=pct / 100, variable=self.opacity,
                                 command=self.apply_opacity)
        menu.add_cascade(label="Opacity", menu=opac)
        menu.add_checkbutton(label="Always on top", variable=self.topmost,
                             command=self.apply_topmost)
        menu.add_command(label="Reset position", command=self.reset_position)
        menu.add_separator()
        menu.add_command(label="Exit", command=self.quit)

        x, y = self.cfg.get("x", 20), self.cfg.get("y", 20)
        root.geometry(f"+{x}+{y}")
        root.after(100, self.refresh)

    # --- window behaviour -------------------------------------------------
    def start_drag(self, event):
        self._drag = (event.x_root - self.root.winfo_x(), event.y_root - self.root.winfo_y())

    def drag(self, event):
        dx, dy = self._drag
        self.root.geometry(f"+{event.x_root - dx}+{event.y_root - dy}")

    def end_drag(self, _event):
        self.cfg["x"], self.cfg["y"] = self.root.winfo_x(), self.root.winfo_y()
        save_config(self.cfg)

    def show_menu(self, event):
        self.menu.tk_popup(event.x_root, event.y_root)

    def apply_opacity(self):
        self.root.attributes("-alpha", self.opacity.get())
        self.cfg["opacity"] = self.opacity.get()
        save_config(self.cfg)

    def apply_topmost(self):
        self.root.attributes("-topmost", self.topmost.get())
        self.cfg["topmost"] = self.topmost.get()
        save_config(self.cfg)

    def reset_position(self):
        self.root.geometry("+20+20")
        self.cfg["x"], self.cfg["y"] = 20, 20
        save_config(self.cfg)

    def quit(self):
        self.root.destroy()

    # --- data -------------------------------------------------------------
    def set(self, key, text, color=None):
        if text == "--":
            color = DIM
        self.cells[key].config(text=text, fg=color or self.FG)

    def refresh(self):
        stats, error = self.poller.latest()
        s = stats or {}
        self.set("cpu_load", fmt_pct(s.get("cpu_load")), level_color(s.get("cpu_load"), 70, 90))
        self.set("cpu_temp", fmt_temp(s.get("cpu_temp")), level_color(s.get("cpu_temp"), 70, 85))
        self.set("cpu_clock", fmt_clock(s.get("cpu_clock")))
        self.set("gpu_load", fmt_pct(s.get("gpu_load")), level_color(s.get("gpu_load"), 80, 95))
        self.set("gpu_temp", fmt_temp(s.get("gpu_temp")), level_color(s.get("gpu_temp"), 75, 85))
        self.set("gpu_clock", fmt_clock(s.get("gpu_clock")))
        self.set("ram_load", fmt_pct(s.get("ram_load")), level_color(s.get("ram_load"), 75, 90))
        self.set("ram_used", fmt_ram(s.get("ram_used"), s.get("ram_total")))

        if error:
            self.status.config(text="No sensor data. Is Open Hardware Monitor\n"
                                    "running with Remote Web Server on?\n"
                                    f"({error})")
            self.status.grid()
        else:
            self.status.grid_remove()

        # Games and other topmost windows can push us down; re-assert.
        if self.topmost.get():
            self.root.attributes("-topmost", True)
        self.root.after(int(self.args.interval * 1000), self.refresh)

    def run(self):
        self.root.mainloop()


def enable_dpi_awareness():
    if sys.platform == "win32":
        try:
            import ctypes
            ctypes.windll.shcore.SetProcessDpiAwareness(1)
        except Exception:
            pass


def main(argv=None):
    p = argparse.ArgumentParser(description="Always-on-top overlay for Open Hardware Monitor.")
    p.add_argument("--host", default="localhost", help="hardware monitor host (default: localhost)")
    p.add_argument("--port", type=int, default=8085, help="Remote Web Server port (default: 8085)")
    p.add_argument("--url", help="full data.json URL (overrides --host/--port)")
    p.add_argument("--interval", type=float, default=1.0, help="refresh interval in seconds (default: 1)")
    p.add_argument("--opacity", type=float, help="window opacity 0.1-1.0 (default: last used, or 0.85)")
    p.add_argument("--font-size", type=int, default=10, help="text size (default: 10)")
    p.add_argument("--gpu", help="pick the GPU whose name contains this text, e.g. RTX")
    p.add_argument("--once", action="store_true",
                   help="print the readings once to the console and exit (for testing)")
    args = p.parse_args(argv)
    args.url = args.url or f"http://{args.host}:{args.port}/data.json"
    args.interval = max(args.interval, 0.2)

    if args.once:
        print(json.dumps(read_stats(fetch(args.url), args.gpu), indent=2))
        return

    enable_dpi_awareness()
    Overlay(args).run()


if __name__ == "__main__":
    main()
