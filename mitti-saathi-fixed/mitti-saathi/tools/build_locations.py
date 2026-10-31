"""
Builds data/locations.json from the official Local Government Directory (LGD)
CSV files (planemad/india-local-government-directory, a copy of lgdirectory.gov.in).
Coordinates are NOT in the LGD files, so only the coordinates that the original
project already had are carried over (marked approximate). Everything else is null.
"""
import csv, json, re, sys
from collections import OrderedDict

SRC = sys.argv[1]      # folder with 1-state.csv, 2-district.csv, 3-subdistrict.csv
OUT = sys.argv[2]

def rd(name):
    with open(f"{SRC}/{name}", encoding="utf-8-sig", newline="") as f:
        return list(csv.DictReader(f))

SMALL = {"and", "of", "the", "in"}
KEEP_UPPER = {"NTR", "HQ", "II", "III", "IV", "NCT", "UT", "DNH", "DD"}

def title(name):
    name = re.sub(r"\s+", " ", name.strip())
    out = []
    for i, word in enumerate(name.split(" ")):
        parts = []
        for piece in word.split("-"):
            if piece.upper() in KEEP_UPPER:
                parts.append(piece.upper())
            elif piece.lower() in SMALL and i > 0:
                parts.append(piece.lower())
            else:
                parts.append(piece[:1].upper() + piece[1:].lower())
        out.append("-".join(parts))
    return " ".join(out)

# Names the original project used that differ from the official LGD spelling
ALIASES = {
    ("MAHARASHTRA", "Yevla"): ["Yeola"],
    ("MAHARASHTRA", "Mawal"): ["Maval"],
}
# Coordinates carried over from the original project (approximate headquarters points)
ORIGINAL_COORDS = {
    ("MAHARASHTRA", "Niphad"):   (20.0811, 74.1139),
    ("MAHARASHTRA", "Dindori"):  (20.1976, 73.8211),
    ("MAHARASHTRA", "Yevla"):    (20.0432, 74.4874),
    ("MAHARASHTRA", "Sinnar"):   (19.8500, 73.9900),
    ("MAHARASHTRA", "Kalwan"):   (20.5000, 74.0000),
    ("MAHARASHTRA", "Haveli"):   (18.4500, 73.9500),
    ("MAHARASHTRA", "Mawal"):    (18.7500, 73.4700),
}

STATE_NAME_FIX = {
    "THE DADRA AND NAGAR HAVELI AND DAMAN AND DIU": "Dadra and Nagar Haveli and Daman and Diu",
}

states_rows = rd("1-state.csv")
dist_rows = rd("2-district.csv")
sub_rows = rd("3-subdistrict.csv")

# Group subdivisions by district code
subs_by_district = {}
for s in sub_rows:
    subs_by_district.setdefault(s["District Code"].strip(), []).append(s)

states = OrderedDict()
for s in states_rows:
    code = s["State Code"].strip()
    raw = s["State Name"].strip()
    states[code] = {
        "id": f"ST-{code}",
        "name": STATE_NAME_FIX.get(raw.upper(), title(raw)),
        "lgd_code": code,
        "type": "Union Territory" if s["State or UT"].strip() == "U" else "State",
        "districts": [],
    }

counts = {"states": 0, "union_territories": 0, "districts": 0,
          "subdivisions": 0, "subdivisions_with_coordinates": 0,
          "districts_without_subdivisions": 0}

missing_districts = []
for d in dist_rows:
    scode = d["State Code"].strip()
    dcode = d["District Code"].strip()
    state = states[scode]
    state_upper = state["name"].upper()
    dname = title(d["District Name"])
    district = {
        "id": f"DT-{dcode}",
        "name": dname,
        "lgd_code": dcode,
        "lgd_name": d["District Name"].strip(),
        "subdivision_type": "Sub-district",
        "subdivision_source": "LGD",
        "subdivisions": [],
    }
    seen_names = {}
    for s in sorted(subs_by_district.get(dcode, []), key=lambda r: r["Sub-district Name"].strip().upper()):
        scode2 = s["Sub-district Code"].strip()
        raw_name = s["Sub-district Name"].strip()
        name = title(raw_name)
        key = (state["name"].upper(), raw_name)
        coords = ORIGINAL_COORDS.get((state["name"].upper(), raw_name))
        sub = {
            "id": f"SD-{scode2}",
            "name": name,
            "lgd_code": scode2,
            "lgd_name": raw_name,
            "latitude": coords[0] if coords else None,
            "longitude": coords[1] if coords else None,
            "coordinate_type": "approximate" if coords else "missing",
        }
        if (state["name"].upper(), raw_name) in ALIASES:
            sub["aliases"] = ALIASES[(state["name"].upper(), raw_name)]
        # Two subdivisions can share a name inside one district (e.g. SONARI).
        # The LGD code keeps the id unique; the name is shown with the code for clarity.
        if name in seen_names:
            sub["name_note"] = "Same name as another sub-district in this district; LGD code " + scode2
        seen_names[name] = True
        district["subdivisions"].append(sub)
        counts["subdivisions"] += 1
        if coords:
            counts["subdivisions_with_coordinates"] += 1

    if not district["subdivisions"]:
        district["subdivision_status"] = "not_in_source"
        missing_districts.append(f"{state['name']} > {dname} ({dcode})")
        counts["districts_without_subdivisions"] += 1
    state["districts"].append(district)
    counts["districts"] += 1

# Sort districts and states by name for dropdowns
out_states = []
for code, st in states.items():
    st["districts"].sort(key=lambda x: x["name"].upper())
    out_states.append(st)
    if st["type"] == "Union Territory":
        counts["union_territories"] += 1
    else:
        counts["states"] += 1
out_states.sort(key=lambda x: x["name"].upper())

doc = OrderedDict([
    ("meta", OrderedDict([
        ("title", "Mitti Saathi location hierarchy (State > District > Sub-district)"),
        ("source", "Local Government Directory (LGD), Government of India: state, district and sub-district lists"),
        ("source_url", "https://lgdirectory.gov.in/downloadDirectory.do"),
        ("source_copy", "https://github.com/planemad/india-local-government-directory (CSV copy of LGD downloads)"),
        ("source_retrieved", "LGD copy dated 11 March 2022 (as recorded by the copy's maintainers); verify newer changes on lgdirectory.gov.in"),
        ("license", "Government Open Data License - India"),
        ("coordinates", "LGD does not publish coordinates for sub-districts. Only the coordinates the original project had are included, marked 'approximate'. All others are null (coordinate_type 'missing')."),
        ("subdivision_type_note", "subdivision_type is the generic LGD term 'Sub-district'. Local terms (Taluka, Taluk, Tehsil, Mandal, etc.) are not assigned in this file."),
        ("counts", counts),
        ("districts_without_subdivisions", missing_districts),
    ])),
    ("states", out_states),
])

with open(OUT, "w", encoding="utf-8") as f:
    json.dump(doc, f, ensure_ascii=False, indent=1)

print(json.dumps(counts, indent=1))
print("states:", len(out_states))
print("missing districts:", len(missing_districts))
