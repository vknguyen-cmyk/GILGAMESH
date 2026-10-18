"""
Train the GILGAMESH X-ray threat detector on your own computer.

Usage (from the repo folder):
    pip install ultralytics onnx onnxslim onnxruntime
    python training/train_local.py path/to/roboflow-dataset.zip

It uses your GPU when it can: Apple Silicon (M1–M4) or an NVIDIA card.
When it finishes, model.onnx and model.json are copied into
public/models/xray/, so `npm run dev` picks them up right away.
"""

import argparse
import collections
import glob
import json
import os
import shutil
import sys
import time
import zipfile

THREAT_WORDS = [
    "gun", "pistol", "firearm", "rifle", "revolver", "knife", "blade", "dagger", "cutter", "razor",
    "scissor", "bullet", "ammo", "ammunition", "explosive", "grenade", "baton", "hammer", "wrench",
    "plier", "shuriken", "handcuff", "axe", "screwdriver",
]

REPO = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
MODEL_DIR = os.path.join(REPO, "public", "models", "xray")


def parse_args():
    p = argparse.ArgumentParser(description="Train an X-ray threat detector for GILGAMESH.")
    p.add_argument("dataset", help="Roboflow YOLO zip, a dataset folder, or a data.yaml file")
    p.add_argument("--epochs", type=int, default=25, help="training rounds (default 25)")
    p.add_argument("--imgsz", type=int, default=640, help="image size (default 640; 416 is faster)")
    p.add_argument("--model", default="yolo11n.pt", help="base model (default yolo11n.pt, the fastest)")
    p.add_argument("--batch", type=int, default=16, help="images per step; lower it if you run out of memory")
    p.add_argument("--fraction", type=float, default=1.0, help="share of training images to use, e.g. 0.5 for half")
    p.add_argument("--threats", default="", help='comma-separated threat classes, e.g. "Gun,Knife" (default: guessed)')
    p.add_argument("--work", default=os.path.join(REPO, "training", "work"), help="where runs and the dataset go")
    return p.parse_args()


def pick_device():
    import torch

    if torch.cuda.is_available():
        return 0, f"NVIDIA GPU ({torch.cuda.get_device_name(0)})"
    if getattr(torch.backends, "mps", None) and torch.backends.mps.is_available():
        return "mps", "Apple Silicon GPU"
    return "cpu", "CPU only (no GPU found, this will be slow)"


def find_data_yaml(source, work):
    if source.lower().endswith(".zip"):
        target = os.path.join(work, "dataset")
        if os.path.isdir(target):
            shutil.rmtree(target)
        print(f"Unzipping {source} ...")
        zipfile.ZipFile(source).extractall(target)
        source = target
    if os.path.isdir(source):
        found = sorted(glob.glob(os.path.join(source, "**", "data.yaml"), recursive=True), key=len)
        if not found:
            sys.exit(f"No data.yaml inside {source}. Export the dataset from Roboflow in YOLO format.")
        return found[0]
    if os.path.isfile(source):
        return source
    sys.exit(f"Can't find {source}")


def fix_data_yaml(path):
    import yaml

    root = os.path.dirname(os.path.abspath(path))
    with open(path) as f:
        cfg = yaml.safe_load(f)
    base = cfg.get("path") or root
    if not os.path.isabs(base):
        base = os.path.normpath(os.path.join(root, base))
    for split in ("train", "val", "test"):
        value = cfg.get(split)
        if not value or not isinstance(value, str):
            continue
        trimmed = value.replace("../", "").replace("./", "")
        options = [value, os.path.join(base, value), os.path.join(root, value), os.path.join(root, trimmed), os.path.join(base, trimmed)]
        hit = next((os.path.normpath(o) for o in options if os.path.exists(o)), None)
        if hit:
            cfg[split] = hit
        elif split == "test":
            cfg.pop(split)
        else:
            sys.exit(f"Couldn't find the {split} folder. Tried: {options}")
    if "val" not in cfg:
        sys.exit("data.yaml needs a val (validation) split.")
    names = cfg["names"]
    if isinstance(names, dict):
        names = [names[k] for k in sorted(names, key=int)]
    cfg["names"] = names
    cfg["nc"] = len(names)
    cfg.pop("path", None)
    fixed = os.path.join(root, "data.fixed.yaml")
    with open(fixed, "w") as f:
        yaml.safe_dump(cfg, f, sort_keys=False)
    return fixed, cfg, [str(n) for n in names]


def count_boxes(cfg, names):
    for split in ("train", "val"):
        images = os.path.normpath(cfg[split])
        head, tail = os.path.split(images)
        labels = os.path.join(head, "labels") if tail == "images" else images.replace("images", "labels")
        counts = collections.Counter()
        files = glob.glob(os.path.join(labels, "*.txt"))
        for name in files:
            with open(name) as f:
                for line in f:
                    if line.strip():
                        counts[int(float(line.split()[0]))] += 1
        print(f"{split}: {len(files)} images")
        for i, n in enumerate(names):
            print(f"   {i:>2} {n:<24} {counts.get(i, 0):>6} boxes")


def main():
    args = parse_args()
    try:
        from ultralytics import YOLO
    except ImportError:
        sys.exit("Missing packages. Run: pip install ultralytics onnx onnxslim onnxruntime")

    os.makedirs(args.work, exist_ok=True)
    device, device_name = pick_device()
    print(f"\nTraining on: {device_name}\n")

    data_yaml, cfg, names = fix_data_yaml(find_data_yaml(args.dataset, args.work))
    count_boxes(cfg, names)

    if args.threats:
        wanted = {t.strip().lower() for t in args.threats.split(",") if t.strip()}
        threats = [n for n in names if n.lower() in wanted]
    else:
        threats = [n for n in names if any(w in n.lower() for w in THREAT_WORDS)]
    print("\nThreat classes:", threats)
    print("Other classes: ", [n for n in names if n not in threats])
    if not threats:
        print("Warning: no threat classes. Pass --threats \"Gun,Knife\" with your dataset's class names.")

    runs = os.path.join(args.work, "runs")
    print(f"\nTraining {args.model} for {args.epochs} epochs at {args.imgsz}px.")
    print("Tip: after epoch 1 finishes, multiply its time by the number of epochs to estimate the total.\n")
    started = time.time()
    model = YOLO(args.model)
    model.train(
        data=data_yaml,
        epochs=args.epochs,
        imgsz=args.imgsz,
        batch=args.batch,
        fraction=args.fraction,
        device=device,
        patience=10,
        flipud=0.5,
        cos_lr=True,
        plots=True,
        project=runs,
        name="xray",
        exist_ok=True,
        workers=4,
    )
    best_path = str(model.trainer.best)
    print(f"\nTraining took {(time.time() - started) / 60:.0f} min. Best weights: {best_path}")

    best = YOLO(best_path)
    metrics = best.val(data=data_yaml, imgsz=args.imgsz, batch=args.batch, device=device, project=runs, name="xray_val", exist_ok=True)
    print(f"\nmAP50 {metrics.box.map50:.3f}   mAP50-95 {metrics.box.map:.3f}")
    print(f"{'class':<24}{'precision':>10}{'recall':>8}{'AP50':>8}")
    for i, c in enumerate(metrics.box.ap_class_index):
        p, r, ap50, _ = metrics.box.class_result(i)
        tag = "  threat" if names[int(c)] in threats else ""
        print(f"{names[int(c)]:<24}{p:>10.3f}{r:>8.3f}{ap50:>8.3f}{tag}")

    import numpy as np
    import onnxruntime as ort

    onnx_file = best.export(format="onnx", imgsz=args.imgsz, simplify=True, dynamic=False, device="cpu")
    session = ort.InferenceSession(str(onnx_file))
    output = session.run(None, {session.get_inputs()[0].name: np.zeros((1, 3, args.imgsz, args.imgsz), dtype=np.float32)})[0]
    shape = list(output.shape)
    if shape[1] == len(names) + 4:
        fmt = "yolov8"
    elif shape[-1] == 6:
        fmt = "end2end"
    else:
        sys.exit(f"Unexpected output shape {shape} for {len(names)} classes")

    config = {
        "name": f"X-ray threats · {os.path.splitext(os.path.basename(args.model))[0].upper()}",
        "file": "model.onnx",
        "inputSize": args.imgsz,
        "labels": names,
        "threats": threats,
        "format": fmt,
        "defaultThreshold": 0.35,
        "iou": 0.45,
        "metrics": {"mAP50": round(float(metrics.box.map50), 3), "mAP50_95": round(float(metrics.box.map), 3)},
    }
    os.makedirs(MODEL_DIR, exist_ok=True)
    shutil.copy(onnx_file, os.path.join(MODEL_DIR, "model.onnx"))
    with open(os.path.join(MODEL_DIR, "model.json"), "w") as f:
        json.dump(config, f, indent=2)

    print(f"\nDone. Model saved to {MODEL_DIR}")
    print("Next: npm run dev, open the console, click Real X-rays, and drop in X-ray images.")
    print(f"Test images: {cfg['val']}")


if __name__ == "__main__":
    main()
