# ESP32-C3 — Pin & LED Reference

FloodGuard secondary sensor module (firmware_C3_sensor_L2).  
Board: ESP32-C3-DevKitM-1

---

## GPIO Pin Map

| GPIO | Direction | Connected To | Purpose |
|------|-----------|--------------|---------|
| 20 | INPUT | DYP-A01CNYUB-2.1 **TX** | Sensor UART RX — receives distance frames (9600 baud, 3.3 V TTL) |
| 21 | OUTPUT | DYP-A01CNYUB-2.1 **RX** | Sensor UART TX — optional in auto-trigger mode |
| 4 | OUTPUT | Relay module **IN1** | Level 1 / Alert relay control (active-LOW) |
| 5 | OUTPUT | Relay module **IN2** | Level 2 / Danger relay control (active-LOW) |
| 8 | OUTPUT | Onboard blue LED | Status indicator (active-HIGH, built-in on DevKitM-1) |

> **Relay logic:** Both relay pins are **active-LOW** — firmware drives the pin LOW to energise the relay coil, HIGH to release it. Most dual-channel relay boards follow this convention.

---

## Relay Output Contacts (to ESP32-S3 Main Panel)

| Relay | Dry-Contact Wiring | Alarm Level |
|-------|--------------------|-------------|
| Relay 1 (IN1 / GPIO 4) | COM + NO → S3 Level-1 input | Alert |
| Relay 2 (IN2 / GPIO 5) | COM + NO → S3 Level-2 input | Danger |

---

## Power Pins

| Pin | Purpose |
|-----|---------|
| 5 V (VIN / VBUS) | Sensor VCC, Relay VCC |
| 3.3 V | Sensor VCC alternative (if sensor supports 3.3 V) |
| GND | Common ground for sensor + relay + ESP32 |

> If your sensor TX output is 5 V TTL (not 3.3 V), add a voltage divider before GPIO 20:  
> `Sensor TX → 1 kΩ → GPIO 20 → 2 kΩ → GND`

---

## LED Behaviour (GPIO 8)

| LED Pattern | Meaning |
|-------------|---------|
| 3 fast blinks on power-up | Firmware started successfully |
| Fast blink — 10 Hz (100 ms ON / 100 ms OFF) | Relay 2 (Danger) is **active** |
| Slow blink — 0.5 Hz (500 ms ON / 500 ms OFF) | Relay 1 (Alert) is **active** |
| Solid ON for 30 seconds | Config or zero-calibration just **saved** |
| OFF | Idle — both relays off, sensor running normally |

Priority order (highest first): Danger blink > Alert blink > Config-saved solid > Off.

---

## Sensor Frame Format (DYP-A01CNYUB-2.1)

```
Byte 0 : 0xFF  (start byte)
Byte 1 : H     (distance high byte)
Byte 2 : L     (distance low byte)
Byte 3 : SUM   ((0xFF + H + L) & 0xFF)

Distance mm = H × 256 + L
Valid range : 280 mm – 2500 mm
```

---

## Default Values (stored in NVS, survives power cycle)

| Parameter | Default | NVS Key |
|-----------|---------|---------|
| Level 1 threshold | 200 mm | `l1_mm` |
| Level 2 threshold | 400 mm | `l2_mm` |
| Zero reference distance | 1200 mm | `zero_mm` |
| Trigger delay | 60 s | `trig_s` |
| Clear delay | 300 s | `clr_s` |
| Relay 1 hysteresis | 30 mm | — (compile-time) |
| Relay 2 hysteresis | 50 mm | — (compile-time) |
| HTTP login password | `Hanuman#2026` | — (compile-time) |
