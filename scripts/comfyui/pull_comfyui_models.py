#!/usr/bin/env python3
"""Download LTX-2.3 models for ComfyUI from Hugging Face.

Model choices for RTX 5090 (32 GB VRAM):
  Q8_0 (22.8 GB) — near-lossless quality, fits comfortably in 32 GB VRAM.
  Distilled Q8_0 included for fast draft/preview generation.
"""
import os
import shutil
import sys

MODELS_DIR = os.environ.get("MODELS_DIR", "/models")

DOWNLOADS = [
    # (repo_id, filename, subdir, [dest_name], [min_size_gb])

    # --- LTX-2.3 dev model (Q8_0 — best quality, 22.8 GB, fits in 32 GB VRAM) ---
    ("unsloth/LTX-2.3-GGUF", "ltx-2.3-22b-dev-Q8_0.gguf", "checkpoints", None, 22.0),

    # --- LTX-2.3 distilled model (Q8_0 — faster generation / drafts) ---
    ("unsloth/LTX-2.3-GGUF", "distilled/ltx-2.3-22b-distilled-Q8_0.gguf",
     "checkpoints", "ltx-2.3-22b-distilled-Q8_0.gguf", 22.0),

    # --- VAE ---
    ("unsloth/LTX-2.3-GGUF", "vae/ltx-2.3-22b-dev_video_vae.safetensors",
     "vae", "ltx-2.3-22b-dev_video_vae.safetensors"),
    ("unsloth/LTX-2.3-GGUF", "vae/ltx-2.3-22b-dev_audio_vae.safetensors",
     "vae", "ltx-2.3-22b-dev_audio_vae.safetensors"),

    # --- Text encoder (embeddings connector) ---
    ("unsloth/LTX-2.3-GGUF", "text_encoders/ltx-2.3-22b-dev_embeddings_connectors.safetensors",
     "text_encoders", "ltx-2.3-22b-dev_embeddings_connectors.safetensors"),

    # --- Gemma 3 12B text encoder (shared with LTX-2, ~8 GB) ---
    ("Comfy-Org/ltx-2", "split_files/text_encoders/gemma_3_12B_it_fp4_mixed.safetensors",
     "text_encoders", "gemma_3_12B_it_fp4_mixed.safetensors", 8.0),

    # --- Spatial upscaler (2x, for upscaling generated frames) ---
    ("Lightricks/LTX-Video", "ltx-2-spatial-upscaler-x2-1.0.safetensors",
     "latent_upscale_models"),
]

SUBDIRS = ("checkpoints", "text_encoders", "loras", "latent_upscale_models", "vae")


def ensure_huggingface_hub():
    try:
        from huggingface_hub import hf_hub_download  # noqa: F401
    except ImportError:
        print("Installing huggingface_hub...", flush=True)
        import subprocess
        subprocess.check_call([sys.executable, "-m", "pip", "install", "-q", "huggingface_hub"])
        print("huggingface_hub installed.", flush=True)


def download(repo_id, filename, subdir, dest_name=None, min_size_gb=0.0):
    from huggingface_hub import hf_hub_download

    dest_name = dest_name or os.path.basename(filename)
    dest_path = os.path.join(MODELS_DIR, subdir, dest_name)

    if os.path.exists(dest_path):
        if min_size_gb > 0:
            size_gb = os.path.getsize(dest_path) / (1024 ** 3)
            if size_gb < min_size_gb:
                print(f"==> Incomplete ({size_gb:.1f} GB < {min_size_gb} GB), re-downloading: {dest_name}", flush=True)
                os.remove(dest_path)
            else:
                print(f"==> OK (exists): {dest_name}", flush=True)
                return True
        else:
            print(f"==> OK (exists): {dest_name}", flush=True)
            return True

    print(f"==> Downloading: {dest_name} (from {repo_id})", flush=True)
    try:
        cached = hf_hub_download(repo_id=repo_id, filename=filename)
        print(f"==> Copying to models dir: {dest_name}", flush=True)
        shutil.copy2(cached, dest_path)
        print(f"==> Saved: {dest_name}", flush=True)
        return True
    except Exception as e:
        print(f"ERROR: {dest_name}: {e}", flush=True)
        return False


def main():
    print("Setting up model directories...", flush=True)
    for sub in SUBDIRS:
        os.makedirs(os.path.join(MODELS_DIR, sub), exist_ok=True)

    ensure_huggingface_hub()

    total = len(DOWNLOADS)
    ok = True
    for i, item in enumerate(DOWNLOADS, 1):
        repo_id, filename, subdir = item[0], item[1], item[2]
        dest_name = item[3] if len(item) > 3 else None
        min_size_gb = item[4] if len(item) > 4 else 0.0
        print(f"--- [{i}/{total}] ---", flush=True)
        if not download(repo_id, filename, subdir, dest_name, min_size_gb):
            ok = False

    if ok:
        print("All LTX-2.3 ComfyUI models ready.", flush=True)
    else:
        print("Some downloads failed. Re-run to retry.", flush=True)
    return 0 if ok else 1


if __name__ == "__main__":
    sys.exit(main())
