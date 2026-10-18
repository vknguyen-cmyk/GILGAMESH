"""
Pull a model trained on Roboflow into the GILGAMESH console.

Downloads the trained weights with the Roboflow SDK, exports them to ONNX, checks the
output layout, and writes public/models/xray/model.onnx + model.json so `npm run dev`
(or the next Pages deploy) screens with the new model.

Usage (from the repo folder; needs internet access to Roboflow):
    pip install -U roboflow ultralytics onnx onnxslim onnxruntime
    export ROBOFLOW_API_KEY=your_private_key     # Roboflow → Settings → API Keys
    python training/pull_roboflow_model.py

Already have the weights (Roboflow → Models → Download Weights)? Skip the download:
    python training/pull_roboflow_model.py --weights path/to/weights.pt

Class names that are just numbers ("0", "1", …) can be renamed in training order:
    python training/pull_roboflow_model.py --labels "Scissors,Knife,Knife,Knife,Knife"

The previous model.onnx and model.json are kept in training/work/previous_model/.
"""

import argparse
import importlib.util
import json
import os
import shutil
import sys

REPO = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
MODEL_DIR = os.path.join(REPO, "public", "models", "xray")
WORK = os.path.join(REPO, "training", "work", "roboflow")

DEFAULTS = {
    "workspace": "kavis-workspace-ezute",
    "project": "x-ray-baggage-detection-rtoa2",
    "version": 1,
    "model_id": "x-ray-baggage-detection-rtoa2-1-yolo26s-t1",
}


def threat_words():
    """The same threat keywords train_local.py uses, so both scripts agree on what's a threat."""
    path = os.path.join(REPO, "training", "train_local.py")
    spec = importlib.util.spec_from_file_location("train_local", path)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module.THREAT_WORDS


def parse_args():
    p = argparse.ArgumentParser(description="Pull a Roboflow-trained model into the GILGAMESH console.")
    p.add_argument("--api-key", default=os.environ.get("ROBOFLOW_API_KEY"), help="Roboflow private API key (or set ROBOFLOW_API_KEY)")
    p.add_argument("--workspace", default=DEFAULTS["workspace"])
    p.add_argument("--project", default=DEFAULTS["project"])
    p.add_argument("--version", type=int, default=DEFAULTS["version"])
    p.add_argument("--weights", help="use this .pt instead of downloading")
    p.add_argument("--labels", help="comma-separated class names in training order, to replace numeric names")
    p.add_argument("--threats", help='comma-separated threat classes, e.g. "Gun,Knife" (default: matched by keyword)')
    p.add_argument("--resize", choices=["stretch", "letterbox"], default="stretch",
                   help='"stretch" for Roboflow\'s "Resize: Stretch to" preprocessing (default), else "letterbox"')
    p.add_argument("--name", default="Roboflow X-ray · YOLO26s", help="model name shown in the console")
    p.add_argument("--out", default=MODEL_DIR, help="output folder (default public/models/xray)")
    return p.parse_args()


def download_weights(args):
    if not args.api_key or "PASTE" in args.api_key:
        sys.exit("No Roboflow API key. Set ROBOFLOW_API_KEY or pass --api-key (Roboflow → Settings → API Keys).")
    try:
        from roboflow import Roboflow
    except ImportError:
        sys.exit("Missing package. Run: pip install -U roboflow")
    os.makedirs(WORK, exist_ok=True)
    print(f"Connecting to Roboflow: {args.workspace}/{args.project} v{args.version}")
    rf = Roboflow(api_key=args.api_key)
    version = rf.workspace(args.workspace).project(args.project).version(args.version)
    if version.model is None:
        sys.exit("This version has no trained model on Roboflow yet.")
    try:
        version.model.download("pt", location=WORK)
    except Exception as error:  # noqa: BLE001 - surface any SDK/HTTP failure with a next step
        sys.exit(
            f"Couldn't download the weights: {error}\n"
            "Download them from Roboflow (Models → your model → Download Weights) and rerun with --weights path/to/weights.pt"
        )
    path = os.path.join(WORK, "weights.pt")
    if not os.path.exists(path):
        sys.exit(f"Download finished but {path} is missing.")
    return path


def main():
    args = parse_args()
    try:
        from ultralytics import YOLO
        import numpy as np
        import onnxruntime as ort
    except ImportError:
        sys.exit("Missing packages. Run: pip install -U ultralytics onnx onnxslim onnxruntime")

    weights = args.weights or download_weights(args)
    if not os.path.exists(weights):
        sys.exit(f"Can't find {weights}")

    # 1. Load the weights and read the class names.
    model = YOLO(weights)
    names = model.names
    labels = [str(names[k]) for k in sorted(names, key=int)] if isinstance(names, dict) else [str(n) for n in names]
    print(f"Classes ({len(labels)}): {labels}")
    if args.labels:
        new = [s.strip() for s in args.labels.split(",")]
        if len(new) != len(labels):
            sys.exit(f"--labels has {len(new)} names but the model has {len(labels)} classes.")
        labels = new
        print(f"Renamed to: {labels}")
    elif all(label.isdigit() for label in labels):
        print("Warning: class names are only numbers. Rerun with --labels \"Name0,Name1,...\" so the console can name threats.")

    # 2. Export to ONNX at 640 for onnxruntime-web.
    onnx_path = model.export(format="onnx", imgsz=640, simplify=True, dynamic=False, device="cpu")
    print(f"Exported: {onnx_path}")

    # 3. Inspect the output layout.
    session = ort.InferenceSession(str(onnx_path))
    input_shape = session.get_inputs()[0].shape
    output = session.run(None, {session.get_inputs()[0].name: np.zeros((1, 3, 640, 640), dtype=np.float32)})[0]
    shape = list(output.shape)
    n = len(labels)
    if len(shape) == 3 and shape[-1] == 6 and shape[1] != n + 4:
        fmt = "end2end"
    elif len(shape) == 3 and (shape[1] == n + 4 or shape[2] == n + 4):
        fmt = "yolov8"
    else:
        sys.exit(f"Unexpected output shape {shape} for {n} classes.")
    print(f"Input {input_shape} · output {shape} · format {fmt}")

    # 4. Threat classes: explicit list, or the same keyword match as train_local.py.
    if args.threats:
        wanted = {t.strip().lower() for t in args.threats.split(",") if t.strip()}
        threats = sorted({l for l in labels if l.lower() in wanted})
    else:
        words = threat_words()
        threats = sorted({l for l in labels if any(w in l.lower() for w in words)})
    print(f"Threat classes: {threats or 'none'}")
    if not threats:
        print('Warning: no threat classes. Rerun with --threats "Knife,Gun" using the model\'s class names.')

    # 5. Write model.onnx + model.json, keeping the previous model.
    os.makedirs(args.out, exist_ok=True)
    backup = os.path.join(REPO, "training", "work", "previous_model")
    for file in ("model.onnx", "model.json"):
        src = os.path.join(args.out, file)
        if os.path.exists(src):
            os.makedirs(backup, exist_ok=True)
            shutil.copy(src, os.path.join(backup, file))
    shutil.copy(onnx_path, os.path.join(args.out, "model.onnx"))
    config = {
        "name": args.name,
        "file": "model.onnx",
        "inputSize": 640,
        "labels": labels,
        "threats": threats,
        "format": fmt,
        "resize": args.resize,
        "defaultThreshold": 0.35,
        "iou": 0.45,
        "source": {
            "workspace": args.workspace,
            "project": args.project,
            "version": args.version,
            "weights": os.path.basename(weights),
        },
    }
    with open(os.path.join(args.out, "model.json"), "w") as f:
        json.dump(config, f, indent=2, ensure_ascii=False)
        f.write("\n")
    size = os.path.getsize(os.path.join(args.out, "model.onnx")) / 1e6
    print(f"\nDone: {args.out}/model.onnx ({size:.0f} MB) and model.json")
    if os.path.exists(backup):
        print(f"Previous model kept in {backup}")
    print("Next: restart npm run dev and screen a few X-rays.")


if __name__ == "__main__":
    main()
