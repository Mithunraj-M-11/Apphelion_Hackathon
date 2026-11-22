"""Simulator runs started from the dashboard. The backend launches the same simulator script a terminal would
(mounted at /simulator), and it talks to this API over HTTP exactly like a gate pole. One run at a time, because
the edge suite changes the site-wide edge state and would disturb a site run going on alongside it."""

import os
import subprocess
import sys
from pathlib import Path

SIMULATOR_DIR = Path(os.environ.get("SIMULATOR_DIR", "/simulator"))  # mounted from ./simulator (docker-compose)
_running: dict[str, subprocess.Popen] = {}  # what is running ("gate_cheats", "site brief_case") -> process


def busy() -> str | None:
    """What is running now, if anything."""
    for what, proc in list(_running.items()):
        if proc.poll() is None:
            return what
        del _running[what]
    return None


def start(args: list[str]) -> None:
    """Launch `python run.py <args>`. Raises RuntimeError when the simulator is missing or another run is going."""
    if not (SIMULATOR_DIR / "run.py").exists():
        raise RuntimeError(f"Simulator not found at {SIMULATOR_DIR}")
    running = busy()
    if running:
        raise RuntimeError(f"{running} is still running")
    env = {**os.environ, "BACKEND_URL": "http://localhost:8000"}
    _running[" ".join(args)] = subprocess.Popen([sys.executable, "run.py", *args], cwd=SIMULATOR_DIR, env=env,
                                                stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
