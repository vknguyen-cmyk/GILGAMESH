# GILGAMESH

An AI-powered carry-on screening console for airport security. Officers drop in X-ray scans, two YOLO models running entirely in the browser flag knives and scissors, and every scan rides a 3D screening lane as a bag: flagged bags are pushed off to bag search, where a click opens a 3D density view of the scan and the bag owner's details. Nothing leaves the laptop except the history records the officer chooses to keep.

## How It Works

1. **Add X-ray images:** upload or drag in scans, or use the bundled sample scans
2. **The models screen each image:** two YOLO detectors run in the browser and their boxes are merged
3. **Watch the lane:** each image rides the belt as one bag, and its scan builds on the monitor as it crosses the beam
4. **Flagged bags are diverted:** a red result (threat) or orange one (look closer) pushes the bag to the bag-search belt
5. **Inspect a held bag:** click its blue node to see the scan as a 3D density model with the owner's photo, name and flight
6. **Decide on the Console:** review one scan at a time, then Clear or Hold; every decision is saved to History

## Architecture

```
Browser (React + Vite)  ──────────────▶  History server (Node + Express)
  │                         REST /api       │
  ├── onnxruntime-web                       ├── records.json (one record per bag)
  │     ├── YOLO26s (Roboflow-trained)      └── scans/*.jpg (2D scan the officer saw)
  │     └── YOLOv8s (second model, WBF merge)
  ├── three.js (3D lane, density view)
  └── sample scans (public/samples)
```

**Frontend:** React and TypeScript app with two screens. **Lane** is the 3D belt, X-ray tunnel, diverter and bag-search belt. **Console** shows one scan at a time with findings, an alarm-threshold slider and Clear / Hold. Both screens read the same analysis of each upload, so a bag is held on the lane exactly when the console flags it. Deployed on GitHub Pages.

**AI:** Two ONNX models run on the laptop with onnxruntime-web. Their detections are fused with cross-model Weighted Boxes Fusion, and weak threat hits (0.15 up to the alarm threshold) are shown as "look closer" instead of being hidden.

**Backend:** A thin Express API stores one record per bag: bag ID, an anonymous traveler (photo, name, ID number), that day's flight, the 2D scan with the AI's boxes, and the result. Travelers are generated demo identities, since the console only sees the X-ray.

## Tech Stack

| Layer | Technology |
|---|---|
| Frontend | React 19, TypeScript, Vite |
| 3D | three.js (screening lane, density view) |
| AI inference | onnxruntime-web (WASM), in the browser |
| Models | YOLO26s trained on Roboflow, plus a YOLOv8s from an open-source X-ray project |
| Model merge | Cross-model Weighted Boxes Fusion (`src/lib/yolo.ts`) |
| Backend | Node.js, Express |
| Storage | JSON records + JPEG scans on disk (`server/data/`) |
| Training | Roboflow, Ultralytics YOLO, Python scripts in `training/` |
| Deployment | GitHub Pages (frontend); backend runs locally or on any Node host |

## Setup

### Prerequisites

- Node.js 18+
- Python 3.10+ (only to train or pull models)

### App and backend

```bash
npm install
npm run dev      # console on http://localhost:5173, history API on :3001
```

`npm run client` starts only the console, and `npm run server` only the history API.

### Models

The trained models ship in `public/models/`. To pull a newer model trained on Roboflow:

```bash
pip install -U roboflow ultralytics onnx onnxslim onnxruntime
export ROBOFLOW_API_KEY=your_private_key
python training/pull_roboflow_model.py
```

## Environment Variables

Frontend (build time):

- `VITE_API_URL`: URL of a hosted history server. Leave it unset in development, where Vite proxies `/api` to `:3001`.

Backend:

- `PORT`: history API port (default `3001`)

Model scripts:

- `ROBOFLOW_API_KEY`: Roboflow private API key, used by `training/pull_roboflow_model.py`

## Lane Flow

Each uploaded image moves through the lane in five states:

- **Waiting:** the scan is analyzed as soon as it's added, and bags board in upload order
- **Scanning:** the bag crosses the beam, turns see-through, and its X-ray builds line by line on the monitor
- **Result:** the light on the machine turns green (clear), orange (look closer) or red (threat)
- **Diverted:** flagged bags are pushed onto the bag-search belt with a tag and a pulsing blue node
- **Inspect:** clicking the node opens the 3D density view, the scan with boxes, and the owner card

## Project Structure

```
src/                    # React app
  App.tsx               # Screens, uploads, shared analysis, Console
  components/
    LaneView.tsx        # 3D lane screen, inspect panel, owner card
    HistorySheet.tsx    # History panel
    XrayPane.tsx        # Scan with detection boxes (Console)
  lib/
    detector.ts         # Loads both ONNX models and runs them
    yolo.ts             # YOLO decoding, NMS, Weighted Boxes Fusion
    laneScene.ts        # three.js belt, tunnel, diverter, bags
    inspectScene.ts     # 3D density model of a scan
    historyApi.ts       # Client for the history API

server/
  index.js              # History API (Express)
  data/                 # records.json and scans/ (git-ignored)

public/
  models/xray/          # Primary model (model.onnx + model.json)
  models/xray-pretrained/  # Second model
  samples/              # Sample X-ray scans

training/               # Train locally, notebook, pull from Roboflow
docs/DETAILS.md         # Model config, training and API details
```

## Testing

```bash
npm run build    # type-checks the app, then builds it for production
```

## License

Hackathon project for DubHacks '26. Sample scans come from public research datasets (SIXray, OPIXray) and are for demonstration only. The second model is from [tulsiprasadmohanty/Xray-luggage-and-suitcase-object-detection-system-](https://github.com/tulsiprasadmohanty/Xray-luggage-and-suitcase-object-detection-system-) (MIT), trained on Malek's X-ray baggage detection dataset (CC BY 4.0). YOLO models are built with Ultralytics (AGPL-3.0). This is a prototype: an officer makes the final call.
