# Sample scans

Images listed in `samples.json` appear as a "Try sample scans" button on the Real X-rays screen,
so judges can test the console without their own X-rays.

1. Copy 3–5 X-ray images into this folder. Use images from your dataset's **test** split
   (the model never trained on them), with no annotation marks drawn on them.
2. List them in `samples.json`:

```json
[{ "file": "bag1.jpg" }, { "file": "bag2.jpg", "name": "Bag with scissors" }]
```
