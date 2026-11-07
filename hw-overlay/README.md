# HW Overlay

A small always-on-top overlay for Windows that shows live readings from
[Open Hardware Monitor](https://openhardwaremonitor.org/) (also works with
[Libre Hardware Monitor](https://github.com/LibreHardwareMonitor/LibreHardwareMonitor)):

```
CPU  23%  61°C  4.60 GHz
GPU  97%  67°C  1.91 GHz
RAM  49%     7.8/16 GB
```

Values turn yellow or red as usage and temperatures climb.

## Setup

1. Install [Python 3](https://www.python.org/downloads/) (tick "Add python.exe to PATH").
   No extra packages are needed.
2. Start Open Hardware Monitor **as administrator** (it needs admin rights to read most sensors).
3. In Open Hardware Monitor, turn on **Options → Remote Web Server → Run**.
   It serves the sensor data at `http://localhost:8085/data.json`.
   (In Libre Hardware Monitor: **Options → Remote Web Server → Run**.)
4. Double-click `start-overlay.bat` (or `hw_overlay.pyw`).

## Using it

- **Drag** with the left mouse button to move it. The position is remembered.
- **Right-click** for opacity, always-on-top, reset position and exit.
- Games need to run in **borderless / windowed** mode for the overlay to show on top;
  exclusive fullscreen draws over every other window.

## Options

```
pythonw hw_overlay.pyw --interval 0.5      # refresh twice a second
pythonw hw_overlay.pyw --port 8086         # if you changed the web server port
pythonw hw_overlay.pyw --gpu RTX           # pick a GPU by name (if you have several)
pythonw hw_overlay.pyw --font-size 12      # bigger text
python  hw_overlay.pyw --once              # print the readings in the console and exit
```

## What is shown

| Row | Value | Sensor used |
| --- | --- | --- |
| CPU | usage | Load → CPU Total |
| CPU | temp | Temperatures → CPU Package (Intel) or Core (Tctl/Tdie) (AMD), else the hottest core |
| CPU | clock | Clocks → average of all CPU Core #n |
| GPU | usage / temp / clock | GPU Core under Load / Temperatures / Clocks |
| RAM | usage | Load → Memory, plus used / total GB |

A dedicated NVIDIA or AMD card is picked over integrated graphics.
