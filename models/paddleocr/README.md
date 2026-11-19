# PaddleOCR models

The scanned-page reader (`src/import/ocr.ts`) uses these PP-OCRv5 mobile models from PaddlePaddle, unchanged.
They are licensed under Apache-2.0 (see `LICENSE`; Copyright PaddlePaddle Authors). `scripts/build.mjs` copies
them to `dist/vendor/ocr/` and the release pins their SHA-256 in `scripts/vendor-checksums.txt`.

| Folder | Role | Hugging Face repository | Commit |
|---|---|---|---|
| `det` | finds lines of text | `PaddlePaddle/PP-OCRv5_mobile_det_onnx` | `e6f4fa85f00e168c862bc462aebca69eef9b3d3d` |
| `latin` | reads Latin-script text (English, German, French, Spanish, Italian, Portuguese, Dutch, Polish, Turkish…) | `PaddlePaddle/latin_PP-OCRv5_mobile_rec_onnx` | `89d3a50e2c27e2e7cceeab0e944c25c807d5db4f` |
| `cyrillic` | reads Cyrillic text | `PaddlePaddle/cyrillic_PP-OCRv5_mobile_rec_onnx` | `2cef88145434beb8afa9dd82d77d799eb1ad7b29` |
| `chinese` | reads Chinese (and English, Japanese) | `PaddlePaddle/PP-OCRv5_mobile_rec_onnx` | `ed152b8b495f84de93cda5709d768548a9127622` |

Each folder holds that repository's `inference.onnx` (the model) and `inference.yml` (its settings and, for the
readers, the character list). The `inference.onnx` hashes match the repositories' published LFS SHA-256.

To update a model, download both files from the repository at a reviewed commit, record the commit here, rebuild,
and review the new hashes before running `node scripts/verify-vendor.mjs --update`.
