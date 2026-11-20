# Tampering & Evasion Cases

Every way the Vendor or the transport vendors could exceed limits or hide activity.
**Source** column: **B** = named in a brief (PDF or deck); **E** = our extension (implied by the
threat model but not spelled out).
This file only lists attacks. Countermeasures are a separate step.

---

## 0. Threat model (draft assumptions, to confirm)

**The Vendor CAN:**
- Control site power, network, gates, roads and staff, including staff who look after
  the existing CCTV and weighbridges.
- Physically reach any device on site (cameras, weighbridges, sensors, and our nodes too).
- Run any number of vehicles, change plates and modify vehicles.
- Write and submit any records it likes.
- Use cheap jammers (RF/GPS), obstruct or redirect cameras, and cut cables.
- Collude with transport vendors and with low-level on-site staff (guards, operators).
- Learn where our sensors are and look for blind spots over time.

**The Vendor CANNOT (assumed):**
- Get into the Governing Body's off-site backend, keys or cloud.
- Alter satellite imagery from a third-party provider.
- Corrupt the Governing Body's senior decision-makers. (Collusion at that level is out of scope.)
- Stop material from physically leaving the site's real boundary, or hide terrain change, forever.

---

## A. Vehicle identity fraud
| # | Case | How it's done | What it defeats | Src |
|---|---|---|---|---|
| A1 | Unregistered / extra vehicles | Extra trucks run alongside the registered fleet | Fleet limit, trip limit | B |
| A2 | Plate cloning | Two or more trucks carry the same registered plate | ANPR-only identification; trip counts per vehicle | B |
| A3 | Plate swapping | Plates moved between trucks between trips or shifts | Vehicle-to-plate binding | B |
| A4 | Plate obscured | Mud, dust, a bent plate, a cover, a tow-hitch blocking it, or no plate | ANPR read rate | E |
| A5 | Fake / printed plates | Plates made to look like a registered vehicle's, or invented | Registry check | E |
| A6 | Tag cloning / transfer / shielding | RFID or FASTag cloned, moved to another truck, or wrapped in foil | Tag-based identification | E |
| A7 | Vehicle disguise | Repaint, tarps, or changed body to look like a registered truck | Visual re-identification | E |
| A8 | Capacity modification | A registered truck with raised sides or an extended body carries more than its rated load | Trips × rated capacity estimates | E |

## B. Trip count manipulation
| # | Case | How it's done | What it defeats | Src |
|---|---|---|---|---|
| B1 | Unmonitored exits / routes | Side roads, fence breaks, temporary tracks, or another gate | Gate-only monitoring | B |
| B2 | Tailgating / convoys | Trucks drive bumper to bumper so they're counted or read as one | Single-sensor counters, ANPR | E |
| B3 | Off-hours movement | Night trips with lights off, holidays, outside the permit window | Daytime cameras, manned checks | E |
| B4 | Boundary trans-shipment | Material passed over the fence to an outside vehicle (by loader, conveyor or chute) | Gate counting entirely | E |
| B5 | Sub-threshold vehicles | Tractors, trailers or small tippers that sensors or rules ignore | Counters tuned for heavy trucks | E |
| B6 | Trip loop / re-entry | Exit and re-entry staged as one trip, or a loaded truck logged as entering empty | Entry/exit pairing logic | E |
| B7 | Count laundering | Extra trips spread across many days or vehicles to stay under per-day or per-vehicle thresholds | Simple threshold alerts | E |

## C. Load / weight manipulation
| # | Case | How it's done | What it defeats | Src |
|---|---|---|---|---|
| C1 | Weighbridge bypass | Drive around the weighbridge, or use a route without one | Weight records | B |
| C2 | Partial weighing | Wheels or axles off the platform; weighing axle by axle | Gross weight | E |
| C3 | Calibration / load-cell tampering | Recalibration, shims, or a remote-controlled "chip" that offsets readings | Weight accuracy | B |
| C4 | Tare manipulation | Tare weighed heavy (water, extra fuel, people) then shed; stale tare reused | Net weight | E |
| C5 | Ticket reuse / swapping | One weighbridge slip reused for several trips or vehicles | Weight-to-trip binding | E |
| C6 | Material misdeclaration | High-value material declared as waste, overburden or a lower grade | Value or royalty accounting | E |
| C7 | Overloading | Loaded above declared or rated capacity on every trip | Trips × capacity estimates | E |

## D. Attacks on sensors and infrastructure (existing systems, and ours)
| # | Case | How it's done | What it defeats | Src |
|---|---|---|---|---|
| D1 | Power cut | Cut, unplug, or "maintenance" outages | Any device on site power | B |
| D2 | Network cut / RF jamming | Cut cables; jam Wi-Fi, LoRa or cellular | Live reporting | B |
| D3 | Camera blinding / obstruction | Cover, spray, mud, dust, redirect, defocus, IR or headlight glare | CCTV, ANPR | B |
| D4 | Camera avoidance | Learn the fields of view and drive around them | Fixed cameras | B |
| D5 | Feed replay / injection | Loop old footage; inject a fake stream into the NVR | Video evidence | E |
| D6 | Device spoofing | A fake node sends "all normal" heartbeats and data | Sensor networks | B |
| D7 | Firmware / config tampering | Physical access to change thresholds, clocks or settings | Device integrity | E |
| D8 | GPS jamming / spoofing / swapping | Jam it, feed fake positions, or move the tracker to a parked vehicle | Vehicle GPS | B |
| D9 | Clock manipulation | Device clocks skewed to move events outside or inside windows | Time-period checks, event correlation | E |
| D10 | Physical destruction / theft | "Accidental" damage, theft or vandalism | Any on-site node | E |
| D11 | Environmental cover | Use, or deliberately raise, dust, rain, fog or darkness | Vision-based sensing | B |

## E. Record / data manipulation
| # | Case | How it's done | What it defeats | Src |
|---|---|---|---|---|
| E1 | Under-reporting | Manifests and returns state fewer trips or tonnes | Self-reported compliance | B |
| E2 | Log editing / deletion | Change or delete DB rows, NVR footage or weighbridge logs | After-the-fact audits | B |
| E3 | Fabricated / duplicate entries | Fake "legit" records cover illegal trips, or one permit is reused | Record reconciliation | E |
| E4 | Backdating | Trips moved into another permit period | Period limits | E |
| E5 | Insider collusion | Guards, operators or weighbridge clerks paid to look away or edit | Human checks | E |
| E6 | Disputing evidence | "Your sensor was faulty" or "that wasn't our truck" during disputes | Enforcement and legal standing | E |

## F. Extraction-level evasion (volume, not trips)
| # | Case | How it's done | What it defeats | Src |
|---|---|---|---|---|
| F1 | Over-extraction | Digging beyond the permitted boundary, depth or bench | Trip-based accounting | B |
| F2 | Hidden stockpiles | Extract now, stockpile out of sight, move later | Period-based reconciliation | E |
| F3 | Old-stock claim | New material passed off as stock from an earlier period | Opening/closing balances | E |
| F4 | Mixing / blending | Permitted and unpermitted material combined in one load | Grade and volume checks | E |

## G. Attacks on the monitoring system itself
| # | Case | How it's done | What it defeats | Src |
|---|---|---|---|---|
| G1 | Blind-spot mapping | Probe sensor coverage over time and route through the gaps | Static deployments | E |
| G2 | Outage-window exploitation | Move only when nodes are down, unsynced or under maintenance | Systems that ignore data gaps | B |
| G3 | Alert fatigue | Trigger many false alarms so real ones are ignored or the system is tuned down | Alerting and response | E |
| G4 | Adversarial inputs to ML | Patterned stickers or plates that fool detection or recognition models | Vision models | E |
| G5 | Social engineering | Fake maintenance crews, or convincing staff to disable or relocate nodes | Operational security | E |

---

## Prioritization

Each case is scored on three things:
- **Brief weight:** how directly the PDF or deck names it.
- **Real-world prevalence:** how common it is in reported illegal mining, sand mining and
  quarrying (from general knowledge; to verify with sources before citing on a slide).
- **Impact:** how much unauthorized volume or how many trips it can hide.

### P0: core (must be solved AND shown in the PoC)
| # | Case | Why P0 |
|---|---|---|
| A1 | Unregistered / extra vehicles | The deck's headline case (100 → 200 trips). Very common in practice. |
| A2, A3 | Plate cloning / swapping | Named in the PDF. The usual way to make an extra truck look registered. Defeats plate recognition alone. |
| B1 | Unmonitored exits / routes | Named in the PDF. In practice, the main way trucks skip check posts. Gate-only designs fail. |
| E1, E3 | Under-reporting; reused or fake permits and passes | Named in both briefs. Reusing one transit pass for several trips is widespread. |
| D1, D2, D10, G2 | Power or network cut, destruction, moving during outages | The PDF explicitly says to "treat loss of data or signal as suspicious". The cheapest attack on any system. |

### P1: high (must be addressed in the design; show in the PoC if time allows)
| # | Case | Why P1 |
|---|---|---|
| C7, A8 | Overloading / modified truck bodies | Probably the most common real violation, but the deck centres on trips, so it's secondary for the PoC. Turns "100 legit trips" into far more tonnage. |
| C1, C3 | Weighbridge bypass or tampering (incl. remote chips) | Named in the PDF. Remote-controlled weighbridge chips are a documented fraud. |
| F1 | Over-extraction beyond the lease boundary or depth | The PDF's root concern. In practice it's caught by satellite or drone surveys, not gate data. |
| D3, D11 | Camera blinding, or dust / rain / night as cover | Both briefs. Harsh conditions are an explicit constraint. |
| B3 | Off-hours / night movement | Very common in practice. Overlaps with D11. |
| E5 | Insider collusion | Very common in practice. The reason our design must not depend on human gate checks. |
| E2 | Log editing / deletion | The PDF asks for a "tamper-evident audit trail". Cheap to solve with a hash chain, so worth stating. |

### P2: medium (state the defence in the deck; no PoC needed)
A4 obscured plates · B2 tailgating · D8 GPS spoofing or swapping (we simply don't rely on vehicle GPS) ·
D4 camera avoidance · D6 device spoofing · C4 tare tricks · C5 ticket reuse · B6 trip loops ·
E4 backdating · E6 evidence disputes · B4 boundary trans-shipment

### P3: low (one mention in the threat table, or out of scope)
A5, A6, A7, B5, B7, C2, C6, D5, D7, D9, F2, F3, F4, G1, G3, G4, G5.
These are either rare, expensive for the Vendor, or answered by design choices made for higher
tiers. For example, signed and attested nodes cover D5, D7 and D9, and volume reconciliation
covers F2 and F3.

---

## Coverage summary
- **48 cases** in 7 groups. 17 are named or directly implied in the briefs; 31 are our additions.
- Patterns that cut across the groups and should drive the design:
  1. **Any single sensor can be defeated.** Every source type has at least one case against it.
  2. **Silence is the attacker's friend.** D1, D2, D10 and G2 all produce "no data". The system must treat gaps as events.
  3. **Identity is the weak link.** A2–A7 attack the vehicle-to-plate binding, so identification needs more than one signal.
  4. **Gate counting alone fails.** B1, B4 and F1 move material without passing a gate, so a check on actual extracted volume is needed.
  5. **Evidence must hold up in disputes.** E2 and E6 mean the records need integrity that can be proven.
