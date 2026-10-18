# GILGAMESH

Carry-on X-ray screening console for a hackathon demo. Light Apple-style UI with SF system fonts. It has two lanes:

- **Demo lane:** scripted bags slide into a dual-view 2D scan. Threats are boxed in red with a confidence score, a clear bag is marked green as **Safe to proceed**, and any bag opens as a 3D render.
- **Real X-rays:** drop real baggage X-ray images onto the console. A YOLO model runs in the browser on this laptop, boxes what it finds, and gives the same verdict.

A thin history API stores each bag’s passenger (anonymous photo, name, ID), flight ticket, and a 2D scan image so you can reopen past cases.

## Run

```bash
npm install
npm run dev
```

That starts both the Vite UI (`:5173`) and the history API (`:3001`). Open the printed local URL. Production build:

```bash
npm run build
npm run preview
```

## History server (the backend)

`server/index.js` is a small Express API that keeps one record per screened bag:

- **Bag ID**, plus the **traveler** (anonymous photo, name, ID number) and **that day's flight** (number, from, to, date)
- the **2D scan** the officer saw, with the models' boxes drawn on it, saved as a JPEG in `server/data/scans/`
- the **result**: verdict, held or cleared, top threat and score, and whether it was screened on the Lane or the Console

The console only sees X-rays, so each new bag gets a generated demo traveler and flight (stable per bag ID, marked "demo identity"; "DH" is a made-up carrier code). Records are stored in `server/data/records.json` (git-ignored), newest first, capped at 300.

```bash
npm run dev      # starts the console on :5173 and the history server on :3001 (Vite proxies /api)
npm run server   # the history server alone
```

| Method | Path | What it does |
|---|---|---|
| `GET` | `/api/records` | All records, newest first |
| `GET` | `/api/records/by-bag/:bagId` | One bag's record |
| `PUT` | `/api/bags/:bagId` | Create the bag's record (with traveler and flight) or update it: `{ scan: { dataUrl, caption }, screening: { verdict, action, threatLabel, confidence, source } }` |
| `POST` | `/api/records/reset` | Delete every record and stored scan |
| `GET` | `/api/scans/:file` | A stored scan image |

GitHub Pages only serves static files, so the public site can't run this server; there the History panel says the server isn't running and screening works as normal. To use History on a deployed site, host `server/` anywhere that runs Node (Render, Railway, Fly) and build the site with `VITE_API_URL=https://your-server.example`.

## The 3D lane

The console opens on **Lane**: a 3D belt and X-ray tunnel. Every bag carries a real scan, screened in the browser by the same models and thresholds as the console, and its scan builds on the monitor as it crosses the beam. Bags the models flag (threat or "look closer") are pushed off to a bag-search belt. Click the pulsing blue node beside a held bag, or its row in the Lane Log, to open a 3D density view of its scan: darker, denser pixels rise higher, with the models' boxes as 3D frames. It is a visualization of one 2D X-ray, not a CT scan.

The lane loops the scans in `public/samples/` (listed in `samples.json`); drop your own images on it or use **Add X-ray images** and they ride through next. The 3D bags are animation; their look is picked to match each scan's real result. Code: `src/components/LaneView.tsx`, `src/lib/laneScene.ts`, `src/lib/inspectScene.ts`.

Bundled samples come from public research datasets (SIXray, OPIXray) and are for demonstration only; some carry annotation marks from the original images. Swap in images from your own dataset's test split for a cleaner demo.

## Walk the demo lane

1. Bag `B-1842` enters. After the scan, a **gun** is boxed in red at `0.997`, with the laptop at `0.993`.
2. Click the gun box, or **Open 3D render**, and orbit the volume. The red wireframe is the threat. Drag to rotate, scroll to zoom, and use **Height clip** to slice the bag.
3. **Hold for search**, then clear the next bags. A clear bag gets a green plate and the **Safe to proceed** mark.
4. Later bags include a knife and a firearm component. **Override clear** asks before an officer sends a threat down the lane.

Keys: `H` hold, `C` clear, `3` open 3D, `Esc` back to the X-ray.

Open **History** in the top bar to browse stored passenger cards, flights, and 2D scans. Clearing or holding a demo bag writes the decision to the API.

## History API

| Method | Path | Purpose |
| --- | --- | --- |
| `GET` | `/api/records` | List luggage history |
| `GET` | `/api/records/by-bag/:bagId` | Passenger record for a bag |
| `PATCH` | `/api/records/by-bag/:bagId/decision` | Save cleared / held |
| `POST` | `/api/records` | Create a record |
| `POST` | `/api/records/reset` | Restore demo seed data |

Photos are anonymous placeholders. Seed data lives in `server/seed.js`; runtime writes go to `server/data/records.json`.

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

### A second model (optional)

If `public/models/xray-pretrained/` holds a `model.json` and `model.onnx`, the console runs both models on every scan, in parallel, and merges their boxes with cross-model Weighted Boxes Fusion (`mergeModelDetections` in `src/lib/yolo.ts`): overlapping boxes (IoU ≥ 0.45) are averaged by confidence, and the higher score and label are kept so agreement never inflates a score. A label is a threat if either model lists it. Remove the folder to go back to one model.

The bundled second model is the YOLOv8s from [tulsiprasadmohanty/Xray-luggage-and-suitcase-object-detection-system-](https://github.com/tulsiprasadmohanty/Xray-luggage-and-suitcase-object-detection-system-) (`model/best.pt`, MIT), trained at 480px on [X-ray baggage detection v1](https://universe.roboflow.com/malek-mhnrl/x-ray-baggage-detection/dataset/1) by Malek (CC BY 4.0), exported to ONNX at 640px:

```bash
yolo export model=best.pt format=onnx imgsz=640 simplify=True opset=17
```

## What's real and what isn't

- **Demo lane:** imagery and scores are scripted so the booth run is repeatable. `src/lib/analyze.ts` returns them.
- **History:** passenger photos are anonymous placeholders, not real faces. Flight and ID fields are demo data.
- **Real lane:** boxes, labels, and confidence come from the model (`src/lib/detector.ts`, decoding in `src/lib/yolo.ts`). Accuracy depends entirely on the training data; expect it to drop on scanners the model never saw.
- **Material** on real scans is an estimate from the pseudo-color inside each box: orange is organic, green is mixed, blue is metal. Grayscale scans show "material n/a", and the Organic and Metal filters turn off for them.
- **3D:** the demo lane renders its scripted bags in 3D. Real scans get a density view instead: darker, denser pixels rise higher. A single 2D X-ray has no depth to reconstruct, so this is a visualization, not a CT scan.
- **One view:** real images are screened as a single view. Dual-view fusion is a next step.
- This is a prototype. An officer makes the final call.

Color filters match a dual-energy reader: **Color**, **Organic**, and **Metal**. Orange is organic, green is mixed, blue is metal.
