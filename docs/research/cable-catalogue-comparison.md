# Cable catalogue research — 17 November 2026

This is a representative, non-exhaustive research set (the documents are linked at their sources, not stored here), not an approved product library. Sources are third-party copyright materials; confirm their current revision and permission before redistribution. Page numbers below are PDF page numbers. Product data must be checked against the exact supplier offer before use.

| Document | Source | Relevance |
| --- | --- | --- |
| Keystone Smart City Rev. 2024.1 | https://www.keystone-cable.com/wp-content/uploads/2025/03/Keystone-Smart-City-Catalogue-Rev.-2024.1.pdf | Control, instrument and other cables; bending table on PDF p. 54. |
| Prysmian LV Power Cable | https://asean.prysmian.com/sites/asean.prysmian.com/files/media/documents/241218%20-%20Prysmian%20LV%20Power%20Cable.pdf | Regional LV power products and handling information. |
| Eland RZ1MZ1-K | https://www.elandcables.com/media/i3ji024n/rz1mz1-k-xlpe-swa-lszh-cable-datasheet.pdf | Distributor datasheet for a flexible armoured LSZH cable; product data on PDF pp. 2–3. |
| Eland BS 5467 multicore | https://www.elandcables.com/eland/media/assets/product-pdf/bs-5467-copper-conductor-multi-core-swa-pvc-basec-0-6-1-kv-cable_2.pdf | Distributor datasheet, dated 2014; fixed bending radii on PDF p. 1. |
| Prysmian mining cables | https://nz.prysmian.com/sites/nz.prysmian.com/files/media/documents/2018-mining-cables-guide_0.pdf | 2018 specialist mining reference, not a general LV building cable rule; despatch barrel and use conditions on PDF p. 58. |

The user's Keystone bending-radius table is a separate document supplied by the user (not stored in this repository). The attempted Keystone Building catalogue returned HTML rather than a PDF; the Nexans rolling-stock catalogue URL returned HTTP 404. Nexans product pages remain useful references but were not downloaded in this set.

## Findings

- Keystone Smart City p. 54 distinguishes installation, fixed and occasional flexing and defines D as overall diameter but Dn as diameter over the polyamide layer. Its OD ≤25 and OD ≥25 categories overlap at exactly 25 mm; its solar category uses OD <12 and OD >12, leaving equality unspecified. Do not resolve boundaries silently.
- The user-provided table and Smart City catalogue use different construction categories and figures, including armoured instrument cable fixed bend (6D in the supplied table versus 8D in Smart City). They have not been established to cover the same product, edition or conditions: flag possible conflicts, not an automatic contradiction.
- Eland BS 5467 p. 1 specifies fixed bend 6D for 1.5–16 mm² and 8D for 25 mm² and above; this is not a drum barrel specification.
- Eland RZ1MZ1-K p. 2 lists product A9RM0316 as 3 core × 16 mm², nominal OD 21.1 mm, nominal mass 1,075 kg/km and minimum bending radius 215 mm. The table must not be relabelled as a dispatch-drum limit without confirmation of its condition.
- Prysmian mining p. 58 explicitly distinguishes despatch drum barrel, fixed, free flexing and repeated reeling. The values apply to the guide's stated cable classes, not all LV products.
- The mining guide also uses kg/100 m (p. 45), which equals 10 kg/km; units and original precision must be preserved. OD and weight are often nominal or approximate, not guaranteed maximums.
- Extracted document text can misorder table columns and lose merged headings, so PDF/OCR results need evidence, page references and human review. Never infer an absent drum specification from an installation value.

## Proposed feature decisions

1. Store separate documents, revisions, classifications, evidence and review status; support multiple documents per product.
2. Preserve cable identity, dimensions and weight including nominal/max qualifiers, and condition-specific bend requirements with radius/diameter basis and applicability.
3. Record drum geometry, weight, capacity conditions and product compatibility separately; report unknown, conflict or confirmed rather than silently assuming.
4. Compare estimated capacities and site lifting limits, preserve whole runs, and label estimates. Use manufacturer-specific barrel guidance for a definitive compatibility result.
5. Keep electrical sizing governed by the existing workbook. Do not replace its rating tables with imported catalogue numbers.
6. Validate with synthetic cases for merged headers, unit conversion, threshold equality, ambiguous conditions, conflicts, cross-product matching and user confirmation; compare additional real, reviewed supplier catalogues.
