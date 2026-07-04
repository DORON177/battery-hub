#!/usr/bin/env python3
"""
Persistent battery reader for the MCHOSE V9 Turbo+ wireless headset.

Battery Hub spawns this as a long-lived subprocess. It mirrors the user's proven
hidapi widget logic: enumerate the device, open every interface, and continuously
read. The headset is event-driven — it only emits a 0x55 frame when the battery
level changes or the headset is powered off/on.

Important robustness detail learned from live testing: when the headset is power-
cycled, at least one interface (e.g. usage page 0xff22) starts throwing read errors
on every call, while the real battery frame arrives on a *different* interface. So a
per-handle read error must be tolerated (skip that handle and keep reading the
others) — NOT treated as a disconnect. We only re-enumerate when the device truly
disappears from hid.enumerate(). This matches the user's widget, whose read loop
does `except: continue`.

Output protocol (one JSON object per line on stdout, flushed):
  {"event": "ready"}
  {"event": "battery", "capacity": 95}
  {"event": "status",  "state": "disconnected" | "off"}
"""
import sys
import json
import time

try:
    import hid
except Exception as e:  # hidapi not installed
    print(json.dumps({"event": "fatal", "error": "python hid module missing: %s" % e}), flush=True)
    sys.exit(2)

VENDOR_ID = 0x3837
PRODUCT_ID = 0x600A
SKIP_LEVELS = (1, 2, 4)


def emit(obj):
    print(json.dumps(obj), flush=True)


def open_all():
    handles = []
    for d in hid.enumerate(VENDOR_ID, PRODUCT_ID):
        try:
            h = hid.device()
            h.open_path(d["path"])
            h.set_nonblocking(True)
            handles.append(h)
        except Exception:
            pass
    return handles


def run():
    emit({"event": "ready"})
    last_emitted = None
    last_enum_check = 0.0

    while True:
        handles = open_all()
        if not handles:
            if last_emitted != "disconnected":
                emit({"event": "status", "state": "disconnected"})
                last_emitted = "disconnected"
            time.sleep(2)
            continue

        # Inner loop: keep the same handles open, tolerate per-handle read errors.
        while True:
            got_read = False
            for h in handles:
                # keep-alive write; firmware refuses it (returns -1) but data still
                # arrives as spontaneous input frames
                try:
                    h.write([0x00, 0x55, 0x01, 0x01, 0x00, 0x00, 0x00, 0x00])
                except Exception:
                    pass
                try:
                    data = h.read(64)
                except Exception:
                    # this interface went bad after a power-cycle; skip it, keep others
                    continue
                if data:
                    got_read = True
                    if data[0] == 0x55:
                        level = data[2]
                        if level == 0:
                            if last_emitted != "off":
                                emit({"event": "status", "state": "off"})
                                last_emitted = "off"
                        elif level not in SKIP_LEVELS and 0 < level <= 100:
                            if last_emitted != level:
                                emit({"event": "battery", "capacity": level})
                                last_emitted = level

            # Only re-enumerate when the device genuinely disappears.
            now = time.time()
            if now - last_enum_check > 2:
                last_enum_check = now
                if not hid.enumerate(VENDOR_ID, PRODUCT_ID):
                    break  # -> outer loop closes handles and waits for reconnect

            time.sleep(0.4 if got_read else 0.15)

        for h in handles:
            try:
                h.close()
            except Exception:
                pass


if __name__ == "__main__":
    try:
        run()
    except KeyboardInterrupt:
        pass
