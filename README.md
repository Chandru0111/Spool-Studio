# Spool Studio

A local web app for the supplied **Cable Sizing** workbook: one cable or a full load list, live electrical calculations, original-template Excel export, and adjustable cable-drum planning.

The user confirmed the current workbook-based version on **30 October 2026**. The earlier catalogue-first/IEC electrical workflow was retired and removed; it is not part of this build.

## Run locally

```sh
git clone https://github.com/Chandru0111/Spool-Studio.git
cd Spool-Studio
npm ci
npm run dev
```

Open **http://127.0.0.1:5173**. The server binds only to this computer. After dependencies are installed, runtime PDF/OCR libraries, language data, fonts and the Excel template are served locally. Files are processed in the browser; there is no upload API or cloud backend. Stop the server with Ctrl+C. Restart after changing files under `public/`.

## Use the app

- **Single cable:** fill the workbook row from left to right (the original 41 sizing columns A–AO, then the earth fault loop, RCD and CPC columns AP–BG and short-circuit columns BH–BO, for TN-S and TT systems to SS 638:2018 and IEC 60364; pick the earthing system per row, blank = TN-S). Yellow cells accept inputs, blue cells provide narrowing dropdowns, and grey cells calculate. Use the suggested cable size when appropriate.
- **Load list:** import XLSX, CSV, TSV or TXT; inspect the worksheet, header and column mapping. Formula-driven XLSX inputs use saved results, so recalculate and save the source workbook first. You can also paste blocks directly into the sheet. Blue italic suggestions fill blanks only; accept or override them after review.
- **From schematic:** on the Load list, choose *From schematic* (or drop the file) to read a single-line diagram, DB schematic or circuit schedule from PDF, ASCII DXF or PNG/JPG/WebP. Circuits are recognised from the drawing text: breaker ratings and poles, loads (kW, HP, kVA with PF), cable type, cores, size and run, equipment tags, board names and "fed from" notes, which build the From → To feeder chain for total voltage drop. A review lists every circuit with its page and source text; values that were worked out rather than read are shown in italics with the reason. Ticked rows become the load list, and the Cable Sizing sheet then calculates and suggests the blanks. Images and scans are cleaned up and read with on-device OCR in three orientations (vertical labels included), and the busbars and feeders are traced from the line work so each label joins the right circuit; vector PDFs are traced the same way under their text. Check OCR numbers in the review. The workbook's ratings are LV (230–690 V): medium-voltage drawings are read but their rows show as invalid until MV tables are added. DWG files must be exported as DXF or PDF first.
- **Excel:** export into the supplied workbook itself. Original formulas, dropdowns, colour rules and lookup sheets remain live. Lists longer than 196 rows extend the template, up to 2,000 rows. Excel recalculates on open.
- **Drums:** choose a cable group or type continuous run lengths. Import supplier drum dimensions from CSV/XLSX or explicitly labelled PDF/image specifications, review the candidates, and choose an option. Without supplier data, three clearly labelled basic options are available. Enter and confirm the exact cable's diameter, mass, bend radius and source. Adjust drum dimensions, allowance, payload and lifting limit; export the enquiry CSV.
- **Your work and backups:** every new tab or browser starts with a blank "Untitled project". Work is kept only in the open tab: it survives a reload, and closing the tab or browser clears it. Nothing is stored on the device or sent anywhere. The header's Save/Open icons download and restore a `.spool.json` project, including drum settings. Click the project name to rename it or start a new, empty project (Ctrl+Z undoes it until you reload). Browser autosave is tied to the exact origin; `localhost` and `127.0.0.1` have separate storage.

## Development knowledge graph

[`spool-studio.dkg`](spool-studio.dkg) is the requested **Development Knowledge Graph**, stored as readable JSON. This project-defined format contains scope decisions, workflows, units, formulas, module responsibilities, imports/exports, dependency edges, source hashes, test cases, validation status and change history. It is not an executable or a replacement for reading code being changed.

```sh
npm run dkg:summary
node scripts/dkg.mjs --module src/engine/sheet.ts
npm run dkg            # regenerate
npm run dkg:check      # fail if stale
npm run dkg:watch      # standalone watcher
npm run check          # typecheck, tests, build, vendor verification; record tested fingerprint
```

`npm run dev` automatically watches project source, tests and documentation and refreshes the graph. Builds also refresh it. Maintain the semantic descriptions in [`docs/project-knowledge.json`](docs/project-knowledge.json) when behaviour changes; hashes and syntax analysis alone cannot explain new engineering rules. Agent instructions in [`AGENTS.md`](AGENTS.md) require this workflow for future changes.

## Sources and verification

The engineer's step08 workbook (the original step05 plus 26 earthing system, earth fault loop, RCD, CPC, breaking capacity and short-circuit columns AP–BO, a FaultData lookup sheet and five Settings defaults; columns A–AO are unchanged) contains 196 blank circuit rows and 3,260 rating rows. The app shows and computes all of A–BO; the export keeps every column as live Excel formulas, and import reads the new input columns. Its Tai Sin references are preserved in generated `src/data/sizing-tables.json`; the original file is copied to `public/templates/cable-sizing.xlsx`. Do not hand-edit either. To deliberately regenerate from a revised workbook:

```sh
node scripts/extract-workbook.mjs /absolute/path/to/workbook.xlsx
npm run check
```

The regression fixture records **260 rows calculated in Microsoft Excel on 28 October 2026**, according to its embedded provenance. Tests compare the app's calculated cells against those stored values and check template extension/import round trips. They do not launch Excel afresh on each run. The DKG records the exact source fingerprint and results of the most recent full check, and marks that verification stale if code changes.

Electrical `PASS` means the workbook's current-capacity, voltage-drop, earth fault loop, CPC, breaking capacity and short-circuit checks that could be evaluated passed (a check with missing data stays blank or asks for the value). The fault checks cover TN-S and TT only (TT with an RCD: Ra × IΔn ≤ 50 V, or with an overcurrent device: Ra × Ia ≤ 50 V); TN-C, TN-C-S and IT, cable reactance, the IEC 60909 voltage factor, minimum fault currents and RCD discrimination are not modelled. Projects saved before step08 are moved to the new columns when opened. It is not an issued installation design. Workbook behaviour—including default factors, first-match upstream references and blank total VD when From is blank—is intentionally preserved. Protection coordination and discrimination, device-specific let-through and time-current data, neutral design and installation compliance require separate engineering review.

Single-core procurement counts three conductors per three-phase set or two per single-phase set; neutral and earth are excluded. Use explicit typed runs for additional conductors. Cable physical dimensions are never inferred from conductor area. Drum planning keeps runs whole and flags unplaced lengths; the packing heuristic does not guarantee the minimum drum count. Supplier capacities and site handling conditions must be confirmed before procurement.
