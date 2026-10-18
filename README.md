# GILGAMESH

An AI-powered carry-on X-ray screening console for airport security. Officers upload X-ray scans, two YOLO models running in the browser flag knives and scissors, and each scan rides a 3D screening lane as a bag. Flagged bags are pushed aside to bag search, where officers can open a 3D density view of the scan and the owner's details.

## How It Works

1. Upload X-ray images or use the sample scans
2. Two AI models screen each image right in the browser
3. Each image rides the 3D belt as a bag through the X-ray machine
4. Flagged bags (threat or look closer) are pushed to the bag-search belt
5. Click a held bag to see its 3D density view and owner (photo, name, flight)
6. Decide on the Console: Clear or Hold, saved to History

## Architecture

```
Browser (React + Vite) ──▶ REST /api ──▶ Backend (Node + Express)
  │                                        │
  ├── onnxruntime-web (YOLO26s + YOLOv8s)  ├── records.json (one record per bag)
  └── three.js (3D lane, density view)     └── scans/*.jpg (2D scan with AI boxes)
```

Frontend: React app with two screens, the 3D Lane and the Console. Both read the same AI result for each scan. Deployed on GitHub Pages.

Backend: Node Express API that stores one record per bag: bag ID, anonymous photo, name, ID number, flight, and the 2D scan.

AI: Two ONNX models run in the browser; their boxes are merged with Weighted Boxes Fusion.

## Tech Stack

| Layer | Technology |
|---|---|
| Frontend | React, TypeScript, Vite |
| 3D | three.js |
| AI Inference | onnxruntime-web (in the browser) |
| Models | YOLO26s (Roboflow), YOLOv8s |
| Backend | Node.js, Express |
| Storage | JSON records, JPEG scans |
| Training | Roboflow, Ultralytics |
| Deployment | GitHub Pages (frontend) |

## Setup

### Prerequisites

- Node.js 18+
- Python 3.10+ (only for training models)

### Frontend + Backend

```bash
npm install
npm run dev
```

Starts the console on `:5173` and the history API on `:3001`.

### Model

```bash
pip install -U roboflow ultralytics onnx onnxslim onnxruntime
python training/pull_roboflow_model.py
```

## Environment Variables

Frontend:

- `VITE_API_URL`: hosted backend URL (optional; local dev uses `:3001`)

Backend:

- `PORT`: API port (default `3001`)

Model:

- `ROBOFLOW_API_KEY`: Roboflow API key

## Lane Flow

Each bag moves through four states:

- Waiting: the scan is analyzed and the bag lines up on the belt
- Scanning: the bag passes through the X-ray machine and its scan appears on the monitor
- Result: green means clear; red or orange pushes the bag to bag search
- Inspect: click the blue node on a held bag for its 3D view and owner

## Project Structure

```
src/
  App.tsx           # Screens, uploads, Console
  components/       # Lane, History, passenger card, scan view
  lib/              # Model loading, YOLO decoding, 3D scenes, history client
server/
  index.js          # History API
  data/             # Saved records and scans
public/
  models/           # ONNX models
  samples/          # Sample X-ray scans
training/           # Training and Roboflow scripts
```

## Testing

```bash
npm run build
```

## License

Hackathon project (DubHacks '26). Sample scans and the second model come from public datasets and an open-source repo; credits are in `docs/DETAILS.md`.
