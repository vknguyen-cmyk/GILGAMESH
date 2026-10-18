# X-ray model

Put the detector here:

- `model.onnx`: a YOLO model exported to ONNX
- `model.json`: class names, threat classes, input size, and output format

`training/train_xray_yolo.ipynb` produces both and zips them as `xray-model.zip`. Unzip that zip into this folder.

See "Screen real X-ray images" in the main README for the `model.json` fields.
