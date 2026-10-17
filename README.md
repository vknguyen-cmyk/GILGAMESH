# GILGAMESH

Carry-on X-ray screening console for a hackathon demo. Each bag slides into a dual-view 2D scan. The assessment highlights dangerous items in red with a confidence score. A clear bag is marked green as **Safe to proceed**. Click a box, a detection, or the bag itself to open a 3D render of the luggage.

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

## Walk the lane

1. Bag `B-1842` enters. After the scan, a **gun** is boxed in red at `0.997`, with the laptop at `0.993`.
2. Click the gun box, or **Open 3D render**, and orbit the volume. The red wireframe is the threat. Drag to rotate, scroll to zoom, and use **Height clip** to slice the bag.
3. **Hold for search**, then clear the next bags. A clear bag gets a green plate and the **Safe to proceed** mark.
4. Later bags include a knife and a firearm component. **Override clear** asks before an officer sends a threat down the lane.

Keys: `H` hold, `C` clear, `3` open 3D, `Esc` back to the X-ray.

## What is simulated

Imagery and scores are scripted so the booth run is repeatable. The console never reads threat flags itself. `src/lib/analyze.ts` (`analyzeBag`) is the seam to replace with a real detector: it returns object labels, confidence, material, and a bag verdict.

Color filters match a dual-energy reader: **Color**, **Organic**, and **Metal**. Orange is organic, green is mixed, blue is metal.
