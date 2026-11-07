@echo off
rem Starts the overlay without a console window. Extra arguments are passed on,
rem e.g.  start-overlay.bat --interval 0.5 --gpu RTX
start "" pythonw "%~dp0hw_overlay.pyw" %*
