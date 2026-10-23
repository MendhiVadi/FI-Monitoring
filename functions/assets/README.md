# Screening assets

Runtime data for `src/features/documents/screening`. Compiled code resolves this
folder as `lib/features/documents/screening/../../../../assets`, and it is
uploaded with the Functions source (it is not in the `firebase.json` ignore list).

## UIDAI Secure QR certificate (not committed)

The Aadhaar QR check verifies UIDAI's RSA signature only when a certificate is
present at:

```
functions/assets/uidai/uidai-secure-qr.pem
```

Download UIDAI's public certificate for Secure QR (offline verification) from
uidai.gov.in, convert it to PEM if it is DER (`openssl x509 -inform der -in
uidai_offline_publickey.cer -out uidai-secure-qr.pem`), and place it here.
A `-----BEGIN PUBLIC KEY-----` PEM is also accepted. Without it the check reports
"unavailable" instead of pass or fail. Tests never use it: they sign a synthetic
payload with a freshly generated key pair.

## OCR language data and face models

Both ship as npm packages, so nothing is downloaded at run time:

- OCR: `@tesseract.js-data/eng` (`4.0.0_best_int`). To use a different model,
  put `eng.traineddata` or `eng.traineddata.gz` in `functions/assets/tessdata/`.
- Faces: `@vladmandic/face-api/model` (SSD MobileNet v1, 68-point landmarks,
  recognition net). To override, copy those `*-weights_manifest.json` and `.bin`
  files into `functions/assets/face-models/`.

If either is missing the related checks report "unavailable"; screening still runs.
