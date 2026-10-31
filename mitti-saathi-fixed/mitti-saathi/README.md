# Mitti Saathi - Taluka Weather and Wind Information

Mitti Saathi is a farming information website. A farmer selects a State or Union Territory, a District and a
Taluka / Tehsil, and sees the current weather, wind speed and wind direction, and a 7-day forecast for that area.

Weather data is provided by **Open-Meteo** (https://open-meteo.com/). No API key is needed.

## Technology

- HTML5, CSS3, vanilla JavaScript
- JSON file for location data
- No backend, no PHP, no frameworks, no build step

## Project structure

```
mitti-saathi/
├── index.html           Page structure (all sections)
├── css/style.css        Styling (approved palette and typography)
├── js/locations.js      Loads locations.json; State -> District -> Taluka / Tehsil dropdowns
├── js/weather.js        Open-Meteo request and data conversion helpers
├── js/app.js            Page rendering, wind compass, forecast, farming insights, refresh
├── data/locations.json  All-India location hierarchy (see "Location data" below)
├── assets/              Reserved for images (currently empty)
├── tools/build_locations.py  Rebuilds data/locations.json from the LGD CSV files
└── README.md
```

## Running the website (required)

The location dropdowns load `data/locations.json` with `fetch()`. Browsers block this when `index.html` is
opened directly from the file system (`file://`), which leaves the dropdowns empty. **Always run the site
through a local server.**

### Option A: VS Code Live Server
1. Open the `mitti-saathi` folder in VS Code.
2. Install the **Live Server** extension (by Ritwik Gupta).
3. Right-click `index.html` and choose **Open with Live Server**.
4. The site opens at an address such as `http://127.0.0.1:5500`.

### Option B: Python (any computer with Python 3)
```
cd mitti-saathi
python -m http.server 8000
```
Then open `http://localhost:8000` in the browser.

If you double-click `index.html`, the page shows "Location data is not available" with instructions.

## Using the selector

1. Choose a **State** (28 States and 8 Union Territories). Union Territories are marked "(UT)".
2. Choose a **District**. It stays disabled until a State is chosen.
3. Choose a **Taluka / Tehsil**. It stays disabled until a District is chosen.
4. The **View Weather** button is enabled once a valid sub-district with coordinates is chosen.
   Choosing a sub-district also loads its weather straight away.

Changing the State clears the District and Taluka. Changing the District clears the Taluka.
No location is pre-selected, so the page never shows a place as if it were the user's own location.

### Sub-districts without coordinates

Most sub-districts do not have coordinates yet (see "Location data"). Choosing one shows the message
"Weather is not available for ... yet", and the View Weather button stays disabled. No weather is requested
and no coordinates are invented.

## Weather behaviour

- Current: temperature, feels-like, humidity, current-hour precipitation (mm), wind speed, wind direction,
  weather condition, and the observation time reported by Open-Meteo for that location.
- 7-day forecast: min and max temperature, rain chance (probability, %), maximum wind speed, condition.
- Missing values from the API are shown as **N/A**. They are never converted to 0.
- Each selection starts a new request and cancels the previous one. A late response from an older request
  cannot overwrite the newer location.
- Weather refreshes automatically every 15 minutes for the selected location. Refreshes do not overlap.
  If a refresh fails, the last successful data stays on screen with a note saying so.
- If a request fails, the message is shown with a **Try again** button. The selected location is kept.
- Farming insights use only real current and forecast values, and show general suggestions only.
  Thresholds are at the top of `js/app.js`.

## Location data

File: `data/locations.json`

Structure:
```
meta     source, licence, counts, and the list of districts with no sub-district data
states[] id, name, type (State / Union Territory), districts[]
  districts[]    id, name, lgd_code, subdivision_type ("Sub-district"), subdivisions[]
    subdivisions[]  id, name, lgd_code, latitude, longitude, coordinate_type, aliases (optional)
```

- **Source:** Local Government Directory (LGD), Government of India, state, district and sub-district lists.
  The copy used is the CSV set in https://github.com/planemad/india-local-government-directory, which
  its maintainers recorded as retrieved on 11 March 2022. Check https://lgdirectory.gov.in/ for later changes.
  Licence: Government Open Data License - India.
- **Names:** LGD names are stored in title case for display. The official LGD spelling is kept in `lgd_name`.
  Old spellings used earlier in this project are kept as `aliases` (for example "Yeola" for "Yevla").
- **Subdivision term:** the file uses the generic LGD term "Sub-district" (Taluka, Taluk, Tehsil, Mandal, etc.
  are local names for the same level). The page label reads "Taluka / Tehsil".
- **Coordinates:** LGD does not publish coordinates for sub-districts, and no reliable coordinate source was
  available when the data was built. Only the seven coordinates the project already had (Nashik and Pune
  districts, Maharashtra) are included, marked `"coordinate_type": "approximate"`. They are headquarters-town
  points and should be verified. All other sub-districts have `latitude: null, longitude: null` and
  `"coordinate_type": "missing"`.

### Current coverage

| Item | Count |
|---|---|
| States | 28 |
| Union Territories | 8 |
| Districts | 763 |
| Sub-districts | 6,921 |
| Sub-districts with coordinates | 7 |
| Districts with no sub-district data in the source | 27 |

Districts with no sub-district data in the source (listed in `meta.districts_without_subdivisions`):
- Andhra Pradesh: Alluri Sitharama Raju, Anakapalli, Annamayya, Bapatla, Eluru, Kakinada, Konaseema, Nandyal,
  NTR, Palnadu, Parvathipuram Manyam, Sri Sathya Sai, Tirupati
- Assam: Tamulpur
- Chhattisgarh: Khairgarh Chhuikhadan Gandai, Manendragarh Chirimiri Bharatpur, Mohla Manpur Ambagarh Chouki,
  Sakti, Sarangarh Bilaigarh
- Maharashtra: Mumbai, Mumbai Suburban
- Meghalaya: Eastern West Khasi Hills
- Nagaland: Chumoukedima, Tseminyu
- Sikkim: Pakyong, Soreng
- West Bengal: Kolkata

These districts are in the dropdown with "No sub-districts in source data" and cannot be selected.

### Rebuilding the data

Download the LGD CSVs (`1-state.csv`, `2-district.csv`, `3-subdistrict.csv`) and run:
```
python tools/build_locations.py <folder-with-csvs> data/locations.json
```
The script keeps the seven existing coordinates. Re-check its output if the source files change.

### Adding coordinates

To add a sub-district's weather, set its `latitude` and `longitude` in `data/locations.json` (decimal degrees),
set `"coordinate_type": "approximate"` or `"exact"`, and reload the page. Use an official or otherwise verifiable
source. Do not guess coordinates.

## Farming insights

| Condition | Suggestion |
|---|---|
| Current wind at or above 20 km/h | Avoid pesticide spraying in windy conditions |
| Rain falling now, or a forecast day with rain chance of 50% or more | Review irrigation requirements |
| Current temperature at or above 35°C | Monitor soil moisture |

These are general rules of thumb, not agricultural advice.

## Known limitations

1. **Most sub-districts cannot show weather yet** because they have no coordinates (see above).
2. **Location names may be out of date.** The LGD copy is from 2022. Newer district or sub-district changes
   need the data updated from lgdirectory.gov.in.
3. **Weather is for a point, not a farm.** Values describe conditions at the chosen coordinates.
4. **Current rainfall is the current-hour amount** (mm), not a daily total.
5. **Forecast wind is the daily maximum**, not an average.
6. **Fonts and icons** load from Google Fonts, so an internet connection is needed for them to display correctly.
7. **Local terms are not assigned per State** (see "Subdivision term" above).

## Data attribution

Weather data powered by Open-Meteo. Website: https://open-meteo.com/

Location names: Local Government Directory (LGD), Government of India (Government Open Data License - India).
