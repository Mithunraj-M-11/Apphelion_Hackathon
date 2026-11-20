"""Load test data into the registry (idempotent: does nothing if trucks already exist).

The registry is GROUND TRUTH: every record here is a correct, GB-verified truck. The only variation is legitimate
status (one suspended, one with an expired fitness certificate). Cheating scenarios (misreads, unregistered
trucks, clones) belong to the simulated gate events, never to the registry.

All names, plates, phone numbers, GSTINs, chassis numbers and FASTag IDs are MADE-UP test data.
Vehicle specs are approximate values for typical Indian tippers.

Run manually:  docker compose exec backend python -m app.seed
"""

import random
from datetime import date, datetime, timedelta, timezone

from sqlalchemy import func, select

from app.db import SessionLocal
from app.models import Contract, Driver, Officer, Transporter, Truck
from app.services.plates import validate_indian_plate
from app.services.registry import record_history, snapshot

rng = random.Random(42)  # deterministic: everyone gets the same data

OFFICERS = [
    ("Mithunraj", "inspector"),
    ("Adishesh", "approver"),
    ("Bhuvanesh", "reviewer"),
]

CONTRACT = {
    "code": "IOM-KJR-2026-01",
    "vendor_name": "Kalinga Minerals Pvt Ltd (test)",
    "site_name": "Joda East Iron Ore Block, Keonjhar, Odisha (test site)",
    "mineral": "Iron ore",
}

TRANSPORTERS = [
    {
        "name": "Maa Tarini Logistics",
        "address": "Station Road, Joda, Keonjhar, Odisha 758034",
        "gstin": "21AABCM1234F1Z5",
        "contact_person": "Rakesh Behera",
        "contact_phone": "9000000101",
        "phone_numbers": ["9000000101", "9000000102"],
        "drivers": [("Sanjay Nayak", "9000001101", "OD0920150012345"), ("Bikash Patra", "9000001102", None),
                    ("Manoj Sahu", "9000001103", "OD0920180045678")],
    },
    {
        "name": "Baitarani Carriers Pvt Ltd",
        "address": "NH-520, Barbil, Keonjhar, Odisha 758035",
        "gstin": "21AACCB5678K1Z2",
        "contact_person": "Sunita Mishra",
        "contact_phone": "9000000201",
        "phone_numbers": ["9000000201"],
        "drivers": [("Pradeep Munda", "9000002101", "JH0520160078901"), ("Ajay Kumar", "9000002102", None)],
    },
    {
        "name": "Eastern Haulage Co.",
        "address": "Industrial Estate, Jamshedpur, Jharkhand 831013",
        "gstin": "20AAFFE9012L1Z8",
        "contact_person": "Imran Ali",
        "contact_phone": "9000000301",
        "phone_numbers": ["9000000301", "9000000302"],
        "drivers": [("Ravi Tudu", "9000003101", "JH0520190011223"), ("Deepak Oraon", "9000003102", None)],
    },
]

# Approximate specs for common Indian tippers: (make, model, axles, length m, empty t, rated payload t, GVW t, VIN prefix)
MODELS = {
    "signa2823": ("Tata", "Signa 2823.K", 3, 8.3, 10.5, 17.5, 28.0, "MAT466"),
    "al2820": ("Ashok Leyland", "2820 Tipper", 3, 8.2, 10.8, 17.2, 28.0, "MB1PBE"),
    "bb2823": ("BharatBenz", "2823C", 3, 8.4, 10.2, 17.8, 28.0, "MEC2823"),
    "eicher6028": ("Eicher", "Pro 6028T", 3, 8.3, 10.6, 17.4, 28.0, "MC2C6D"),
    "signa3523": ("Tata", "Signa 3523.K", 4, 9.6, 12.8, 22.2, 35.0, "MAT468"),
    "al3520": ("Ashok Leyland", "3520 Tipper", 4, 9.7, 13.0, 22.0, 35.0, "MB1PBF"),
}

# (plate, model key, transporter index, colour, note)
TRUCKS = [
    ("OD09AB1234", "signa2823", 0, "Yellow", None),  # near-miss target for a simulated misread (B -> 8)
    ("OD09AC5678", "al2820", 0, "Orange", None),
    ("OD09AD0090", "bb2823", 0, "White", None),     # 0 / O / D confusion target
    ("OD09AE4521", "eicher6028", 0, "Yellow", None),
    ("OD09AF7733", "signa3523", 0, "Yellow", None),
    ("OD09AG1180", "al3520", 0, "Blue", None),
    ("OD09AH2468", "signa2823", 0, "Yellow", None),
    ("OD09AJ3579", "al2820", 1, "Orange", None),
    ("OD09AK6402", "bb2823", 1, "White", None),
    ("OD09AL9015", "signa3523", 1, "Yellow", None),
    ("OD02BQ4410", "eicher6028", 1, "White", None),
    ("OD02BR7120", "al3520", 1, "Blue", None),
    ("OD11CE3305", "signa2823", 1, "Yellow", None),
    ("OD14DF8821", "bb2823", 1, "White", None),
    ("JH05CK2290", "al2820", 2, "Orange", None),
    ("JH05CL6614", "signa3523", 2, "Yellow", None),
    ("CG04MN5507", "eicher6028", 2, "White", None),
    ("22BH4581AB", "bb2823", 2, "Silver", None),    # Bharat (BH) series plate
    ("OD09AM1111", "al2820", 0, "Orange", "suspended"),
    ("OD09AN2025", "signa2823", 2, "Yellow", "expired_fitness"),
]

TODAY = date(2026, 11, 20)


def _hex(n: int) -> str:
    return "".join(rng.choice("0123456789ABCDEF") for _ in range(n))


def _alnum(n: int) -> str:
    return "".join(rng.choice("ABCDEFGHJKLMNPRSTUVWXYZ0123456789") for _ in range(n))


def seed() -> None:
    db = SessionLocal()
    try:
        if db.scalar(select(func.count()).select_from(Truck)):
            print("seed: trucks already present, skipping")
            return

        officers = [Officer(name=n, role=r) for n, r in OFFICERS]
        db.add_all(officers)
        contract = Contract(**CONTRACT)
        db.add(contract)
        db.flush()
        inspectors = [o for o in officers if o.role == "inspector"]
        approver = next(o for o in officers if o.role == "approver")

        transporters = []
        for t in TRANSPORTERS:
            drivers = t["drivers"]
            tr = Transporter(**{k: v for k, v in t.items() if k != "drivers"}, contract_id=contract.id)
            db.add(tr)
            db.flush()
            record_history(db, entity="transporter", entity_id=tr.id, action="create", officer=inspectors[0],
                           reason="Initial enrollment (test data)", after=snapshot(tr))
            for name, phone, licence in drivers:
                d = Driver(transporter_id=tr.id, name=name, phone=phone, licence_no=licence)
                db.add(d)
                db.flush()
                record_history(db, entity="driver", entity_id=d.id, action="create", officer=inspectors[0],
                               reason="Initial enrollment (test data)", after=snapshot(d))
            transporters.append(tr)

        for i, (raw_plate, model_key, t_idx, colour, note) in enumerate(TRUCKS):
            plate, kind = validate_indian_plate(raw_plate)
            make, model, axles, length, empty, rated, gvw, vin = MODELS[model_key]
            inspector = inspectors[i % len(inspectors)]
            inspected = datetime(2026, 11, 2 + i % 10, 9 + i % 6, 15, tzinfo=timezone.utc)
            truck = Truck(
                plate=plate,
                plate_type=kind,
                fastag_tag_id="34161FA8" + _hex(16),
                fastag_chip_id="E28011" + _hex(18),
                length_m=round(length + rng.uniform(-0.1, 0.1), 2),
                axle_count=axles,
                make=make,
                model=model,
                body_type="Tipper",
                colour=colour,
                chassis_no=(vin + _alnum(17 - len(vin)))[:17],
                engine_no=_alnum(12),
                empty_weight_t=round(empty + rng.uniform(-0.3, 0.3), 2),
                rated_capacity_t=rated,
                gvw_t=gvw,
                rc_valid_until=TODAY + timedelta(days=365 * rng.randint(4, 12)),
                fitness_valid_until=(date(2026, 10, 31) if note == "expired_fitness"
                                     else TODAY + timedelta(days=rng.randint(120, 700))),
                insurance_valid_until=TODAY + timedelta(days=rng.randint(60, 360)),
                permit_valid_until=TODAY + timedelta(days=rng.randint(150, 1500)),
                vahan_verified=True,
                vahan_checked_at=inspected,
                status="suspended" if note == "suspended" else "active",
                status_reason=("Suspended pending re-inspection after body modification"
                               if note == "suspended" else None),
                valid_from=date(2026, 11, 1),
                valid_to=date(2027, 3, 31),
                transporter_id=transporters[t_idx].id,
                contract_id=contract.id,
                inspected_by=inspector.id,
                inspected_at=inspected,
                inspection_location="GB enrollment bay, Joda East site gate 1",
                approved_by=approver.id,
                approved_at=inspected + timedelta(hours=3),
            )
            db.add(truck)
            db.flush()
            record_history(db, entity="truck", entity_id=truck.id, action="create", officer=inspector,
                           reason="Enrolled after physical inspection (test data)", after=snapshot(truck))
            if note == "suspended":
                record_history(db, entity="truck", entity_id=truck.id, action="status", officer=approver,
                               reason=truck.status_reason, before={"status": "active"},
                               after={"status": "suspended", "status_reason": truck.status_reason})

        db.commit()
        print(f"seed: loaded {len(officers)} officers, {len(transporters)} transporters, {len(TRUCKS)} trucks")
    finally:
        db.close()


if __name__ == "__main__":
    seed()
