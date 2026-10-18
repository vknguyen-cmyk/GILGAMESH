# GILGAMESH

Carry-on X-ray screening console for a hackathon demo. Light Apple-style UI with SF system fonts. It has two lanes:

- **Demo lane:** scripted bags slide into a dual-view 2D scan. Threats are boxed in red with a confidence score, a clear bag is marked green as **Safe to proceed**, and any bag opens as a 3D render.
- **Real X-rays:** drop real baggage X-ray images onto the console. A YOLO model runs in the browser on this laptop, boxes what it finds, and gives the same verdict. No server, no API key, no Wi-Fi needed at the booth.

## Run

```bash
npm install
npm run dev
```

Open the printed local URL. Production build:

```bash
npm run build
npm run preview
```

## Walk the demo lane

1. Bag `B-1842` enters. After the scan, a **gun** is boxed in red at `0.997`, with the laptop at `0.993`.
2. Click the gun box, or **Open 3D render**, and orbit the volume. The red wireframe is the threat. Drag to rotate, scroll to zoom, and use **Height clip** to slice the bag.
3. **Hold for search**, then clear the next bags. A clear bag gets a green plate and the **Safe to proceed** mark.
4. Later bags include a knife and a firearm component. **Override clear** asks before an officer sends a threat down the lane.

Keys: `H` hold, `C` clear, `3` open 3D, `Esc` back to the X-ray.

## Screen real X-ray images

### 1. Get a model

The console loads `public/models/xray/model.onnx` and `public/models/xray/model.json`. The repo doesn't ship a model. Make one with the Colab notebook:

1. Open `training/train_xray_yolo.ipynb` in [Google Colab](https://colab.research.google.com) (File → Upload notebook) and pick a **T4 GPU** runtime.
2. Point it at an X-ray dataset. The easiest source is a Roboflow Universe dataset (search `x-ray baggage`); a zip or a Google Drive folder in YOLO format also works.
3. Run all cells. Training a nano model takes about 30–60 minutes. The last cell downloads `xray-model.zip`.
4. Unzip it into `public/models/xray/`.

The dev server picks the files up without a restart. In the console, **Retry detector** or **Check again** reloads the model.

### 2. Screen images

1. Switch the queue to **Real X-rays**, or just drop images anywhere on the console. **Add X-ray images** opens a file picker. PNG, JPG, WebP, and BMP work; convert TIFF or DICOS exports first.
2. Each image joins the queue and runs through the detector, usually in well under a second with a nano model.
3. Red boxes are threat classes, blue boxes are other objects. Click a box or a row to select it.
4. **Alarm threshold** in the Assessment rail sets the minimum confidence for a box. Lower catches more and raises more false alarms. It doesn't re-run the model.
5. **Hold for search** or **Safe to proceed** moves to the next image. Switching back to the demo lane keeps each lane's progress.

If no model is loaded, an image is marked **Not screened** and can only be held. The console never shows **Safe to proceed** without a model result.

### `model.json`

```json
{
  "name": "X-ray threats · YOLO11N",
  "file": "model.onnx",
  "inputSize": 640,
  "labels": ["Gun", "Knife", "Laptop"],
  "threats": ["Gun", "Knife"],
  "format": "yolov8",
  "defaultThreshold": 0.35,
  "iou": 0.45
}
```

- `labels` must list every class in training order.
- `threats` decides which boxes are red and put a bag on hold. Matching ignores case.
- `format` is `yolov8` for YOLOv8, YOLO11, and most YOLO26 exports, `yolov5` for YOLOv5, or `end2end` for NMS-free exports. If it's missing, the console works it out from the output shape.
- `resize` is `letterbox` (default, what Ultralytics and the notebook use) or `stretch`. Use `stretch` for models trained on Roboflow with "Resize: Stretch to", so images are prepared the same way at screening time.

### Using a model trained on Roboflow

Roboflow's **Download Weights** gives a PyTorch `.pt` file. Convert it to ONNX once:

```bash
pip install ultralytics onnx onnxslim
yolo export model=weights.pt format=onnx imgsz=640 simplify=True
```

Copy the resulting `weights.onnx` to `public/models/xray/model.onnx`, then set `"resize": "stretch"` and the class names from Roboflow's **Classes & Tags** in `model.json`.

## What's real and what isn't

- **Demo lane:** imagery and scores are scripted so the booth run is repeatable. `src/lib/analyze.ts` returns them.
- **Real lane:** boxes, labels, and confidence come from the model (`src/lib/detector.ts`, decoding in `src/lib/yolo.ts`). Accuracy depends entirely on the training data; expect it to drop on scanners the model never saw.
- **Material** on real scans is an estimate from the pseudo-color inside each box: orange is organic, green is mixed, blue is metal. Grayscale scans show "material n/a", and the Organic and Metal filters turn off for them.
- **3D** is only for the demo lane. A single 2D X-ray has no depth to reconstruct; that needs a CT scan.
- **One view:** real images are screened as a single view. Dual-view fusion is a next step.
- This is a prototype. An officer makes the final call.

Color filters match a dual-energy reader: **Color**, **Organic**, and **Metal**. Orange is organic, green is mixed, blue is metal.
