#!/usr/bin/env python3
"""Config-driven ComfyUI model downloader.

Reads model packs from models.json (next to this script) and downloads them
from HuggingFace Hub, using symlinks to the HF cache to avoid duplication.

Environment variables:
  MODELS_DIR        Target ComfyUI models root (default: /models)
  COMFYUI_PACKS     Comma-separated pack names to download (default: from models.json defaults)
  COMFYUI_QUANT     GGUF quantization level for {quant} templates (default: Q4_K_M)
  COMFYUI_CONFIG    Path to models.json override (default: <script_dir>/models.json)
"""
import json
import os
import sys
from pathlib import Path

SCRIPT_DIR = Path(__file__).resolve().parent
MODELS_DIR = Path(os.environ.get("MODELS_DIR", "/models"))
QUANT = os.environ.get("COMFYUI_QUANT", "Q4_K_M")
CONFIG_PATH = Path(os.environ.get("COMFYUI_CONFIG", SCRIPT_DIR / "models.json"))

ALL_SUBDIRS = ("unet", "checkpoints", "text_encoders", "loras", "latent_upscale_models", "vae")


def ensure_huggingface_hub():
    try:
        from huggingface_hub import hf_hub_download  # noqa: F401
    except ImportError:
        print("Installing huggingface_hub...", flush=True)
        import subprocess
        subprocess.check_call([sys.executable, "-m", "pip", "install", "-q", "huggingface_hub"])
        print("huggingface_hub installed.", flush=True)


def load_config():
    if not CONFIG_PATH.exists():
        print(f"ERROR: Config not found: {CONFIG_PATH}", flush=True)
        sys.exit(1)
    with open(CONFIG_PATH, encoding="utf-8") as f:
        return json.load(f)


def resolve_packs(config):
    """Determine which packs to download."""
    packs_env = os.environ.get("COMFYUI_PACKS", "").strip()
    if packs_env:
        requested = [p.strip() for p in packs_env.split(",") if p.strip()]
        if requested == ["all"]:
            return list(config["packs"].keys())
        unknown = [p for p in requested if p not in config["packs"]]
        if unknown:
            available = ", ".join(config["packs"].keys())
            print(f"ERROR: Unknown packs: {', '.join(unknown)}", flush=True)
            print(f"Available: {available}", flush=True)
            sys.exit(1)
        return requested
    return config.get("defaults", {}).get("packs", list(config["packs"].keys()))


def download_model(repo_id, filename, subdir, dest_name=None):
    from huggingface_hub import hf_hub_download

    filename = filename.format(quant=QUANT)
    dest_name = dest_name or os.path.basename(filename)
    dest_dir = MODELS_DIR / subdir
    dest_dir.mkdir(parents=True, exist_ok=True)
    dest_path = dest_dir / dest_name

    if dest_path.exists():
        print(f"  OK (exists): {subdir}/{dest_name}", flush=True)
        return True

    print(f"  Downloading: {dest_name} (from {repo_id})", flush=True)
    try:
        cached = hf_hub_download(repo_id=repo_id, filename=filename)
        try:
            os.symlink(cached, dest_path)
            print(f"  Linked: {subdir}/{dest_name}", flush=True)
        except OSError:
            import shutil
            shutil.copy2(cached, dest_path)
            print(f"  Copied: {subdir}/{dest_name}", flush=True)
        return True
    except Exception as e:
        print(f"  ERROR: {dest_name}: {e}", flush=True)
        return False


def main():
    config = load_config()
    quant = os.environ.get("COMFYUI_QUANT") or config.get("defaults", {}).get("quant", "Q4_K_M")
    global QUANT
    QUANT = quant

    pack_names = resolve_packs(config)
    packs = config["packs"]

    # Collect all models to download
    models = []
    for pack_name in pack_names:
        pack = packs[pack_name]
        for m in pack["models"]:
            models.append((pack_name, m))

    print(f"Packs: {', '.join(pack_names)} ({len(models)} models, quant={QUANT})", flush=True)
    print(f"Target: {MODELS_DIR}", flush=True)

    # Ensure subdirectories
    for sub in ALL_SUBDIRS:
        (MODELS_DIR / sub).mkdir(parents=True, exist_ok=True)

    ensure_huggingface_hub()

    ok = True
    for i, (pack_name, m) in enumerate(models, 1):
        print(f"[{i}/{len(models)}] {pack_name}:", flush=True)
        if not download_model(m["repo"], m["file"], m["dest"], m.get("name")):
            ok = False

    if ok:
        print(f"All {len(models)} ComfyUI models ready.", flush=True)
    else:
        print("Some downloads failed. Re-run to retry.", flush=True)
    return 0 if ok else 1


if __name__ == "__main__":
    sys.exit(main())
