"""AoTInductor compilation utilities for the VAD segmenter."""

import torch

from config import (
    AOTI_ENABLED, AOTI_MIN_AUDIO_MINUTES, AOTI_MAX_AUDIO_MINUTES,
    AOTI_HUB_REPO, AOTI_HUB_ENABLED,
)
from .segmenter_model import _segmenter_cache


# =============================================================================
# AoT Compilation Test
# =============================================================================

_aoti_cache = {
    "exported": None,
    "compiled": None,
    "tested": False,
}


def is_aoti_applied() -> bool:
    """Return True if a compiled AoTI model has been applied."""
    return bool(_aoti_cache.get("applied"))


def _get_aoti_hub_filename():
    """Generate Hub filename encoding min/max audio duration."""
    return f"vad_aoti_{AOTI_MIN_AUDIO_MINUTES}min_{AOTI_MAX_AUDIO_MINUTES}min.pt2"


def _try_load_aoti_from_hub(model):
    """
    Try to load a pre-compiled AoTI model from Hub.
    Returns True if successful, False otherwise.
    """
    import os
    import time

    if not AOTI_HUB_ENABLED:
        print("[AoTI] Hub persistence disabled")
        return False

    token = os.environ.get("HF_TOKEN")
    if not token:
        print("[AoTI] HF_TOKEN not set, cannot access Hub")
        return False

    filename = _get_aoti_hub_filename()
    print(f"[AoTI] Checking Hub for pre-compiled model: {AOTI_HUB_REPO}/{filename}")

    try:
        from huggingface_hub import hf_hub_download, HfApi

        # Check if file exists in repo
        api = HfApi(token=token)
        try:
            files = api.list_repo_files(AOTI_HUB_REPO, token=token)
            if filename not in files:
                print(f"[AoTI] Compiled model not found on Hub (available: {files})")
                return False
        except Exception as e:
            print(f"[AoTI] Could not list Hub repo: {e}")
            return False

        # Download the compiled graph
        t0 = time.time()
        compiled_graph_file = hf_hub_download(
            AOTI_HUB_REPO, filename, token=token
        )
        download_time = time.time() - t0
        print(f"[AoTI] Downloaded from Hub in {download_time:.1f}s: {compiled_graph_file}")

        # Load using ZeroGPU AOTI utilities
        from spaces.zero.torch.aoti import ZeroGPUCompiledModel, ZeroGPUWeights, drain_module_parameters

        state_dict = model.state_dict()
        zerogpu_weights = ZeroGPUWeights({name: weight for name, weight in state_dict.items()})
        compiled = ZeroGPUCompiledModel(compiled_graph_file, zerogpu_weights)

        # Replace forward method
        setattr(model, "forward", compiled)
        drain_module_parameters(model)

        _aoti_cache["compiled"] = compiled
        _aoti_cache["applied"] = True
        print(f"[AoTI] Loaded and applied compiled model from Hub")
        return True

    except Exception as e:
        print(f"[AoTI] Failed to load from Hub: {type(e).__name__}: {e}")
        import traceback
        traceback.print_exc()
        return False


def _push_aoti_to_hub(compiled):
    """
    Push compiled AoTI model to Hub for future reuse.
    """
    import os
    import time
    import tempfile

    if not AOTI_HUB_ENABLED:
        print("[AoTI] Hub persistence disabled, skipping upload")
        return False

    token = os.environ.get("HF_TOKEN")
    if not token:
        print("[AoTI] HF_TOKEN not set, cannot upload to Hub")
        return False

    filename = _get_aoti_hub_filename()
    print(f"[AoTI] Uploading compiled model to Hub: {AOTI_HUB_REPO}/{filename}")

    try:
        from huggingface_hub import HfApi, create_repo

        api = HfApi(token=token)

        # Create repo if it doesn't exist
        try:
            create_repo(AOTI_HUB_REPO, exist_ok=True, token=token)
        except Exception as e:
            print(f"[AoTI] Repo creation note: {e}")

        # Get the archive file from the compiled object
        archive = compiled.archive_file
        if archive is None:
            print("[AoTI] Compiled object has no archive_file, cannot upload")
            return False

        t0 = time.time()

        # Write archive to temp file and upload
        with tempfile.TemporaryDirectory() as tmpdir:
            output_path = os.path.join(tmpdir, filename)

            # archive is a BytesIO object
            with open(output_path, "wb") as f:
                f.write(archive.getvalue())

            info = api.upload_file(
                repo_id=AOTI_HUB_REPO,
                path_or_fileobj=output_path,
                path_in_repo=filename,
                commit_message=f"Add compiled VAD model ({AOTI_MIN_AUDIO_MINUTES}-{AOTI_MAX_AUDIO_MINUTES} min)",
                token=token,
            )

        upload_time = time.time() - t0
        print(f"[AoTI] Uploaded to Hub in {upload_time:.1f}s: {info}")
        return True

    except Exception as e:
        print(f"[AoTI] Failed to upload to Hub: {type(e).__name__}: {e}")
        import traceback
        traceback.print_exc()
        return False


def test_vad_aoti_export():
    """
    Test torch.export AoT compilation for VAD model using spaces.aoti_capture.
    Must be called AFTER model is on GPU (inside GPU-decorated function).

    Checks Hub for pre-compiled model first. If found, loads it directly.
    Otherwise, compiles fresh and uploads to Hub for future reuse.

    Uses aoti_capture to capture the EXACT call signature from a real inference
    call to segment_recitations, ensuring the export matches what the model
    actually receives during inference.

    Returns dict with test results and timing.
    """
    import time

    results = {
        "export_success": False,
        "export_time": 0.0,
        "compile_success": False,
        "compile_time": 0.0,
        "hub_loaded": False,
        "hub_uploaded": False,
        "error": None,
    }

    if not AOTI_ENABLED:
        results["error"] = "AoTI disabled in config"
        print("[AoTI] Disabled via AOTI_ENABLED=False")
        return results

    if _aoti_cache["tested"]:
        print("[AoTI] Already tested this session, skipping")
        return {"skipped": True, **results}

    _aoti_cache["tested"] = True

    # Check model is loaded and on GPU
    if not _segmenter_cache["loaded"] or _segmenter_cache["model"] is None:
        results["error"] = "Model not loaded"
        print(f"[AoTI] {results['error']}")
        return results

    model = _segmenter_cache["model"]
    processor = _segmenter_cache["processor"]
    device = next(model.parameters()).device
    dtype = next(model.parameters()).dtype

    if device.type != "cuda":
        results["error"] = f"Model not on GPU (device={device})"
        print(f"[AoTI] {results['error']}")
        return results

    print(f"[AoTI] Testing torch.export on VAD model (device={device}, dtype={dtype})")

    # Import spaces for aoti_capture
    try:
        import spaces
    except ImportError:
        results["error"] = "spaces module not available"
        print(f"[AoTI] {results['error']}")
        return results

    # Try to load pre-compiled model from Hub first
    if _try_load_aoti_from_hub(model):
        results["hub_loaded"] = True
        results["compile_success"] = True
        print("[AoTI] Using pre-compiled model from Hub")
        return results

    # No cached model found - compile fresh
    print("[AoTI] No cached model on Hub, compiling fresh...")

    # Convert config minutes to samples (16kHz audio)
    SAMPLES_PER_MINUTE = 16000 * 60
    min_samples = int(AOTI_MIN_AUDIO_MINUTES * SAMPLES_PER_MINUTE)
    max_samples = int(AOTI_MAX_AUDIO_MINUTES * SAMPLES_PER_MINUTE)

    # Create test audio for capture - use min duration to save memory
    # MUST be on CPU - segment_recitations moves to GPU internally
    test_audio = torch.randn(min_samples, device="cpu")
    print(f"[AoTI] Test audio: {min_samples} samples ({AOTI_MIN_AUDIO_MINUTES} min)")

    # Capture the exact args/kwargs used by segment_recitations
    try:
        from recitations_segmenter import segment_recitations

        print("[AoTI] Capturing call signature via aoti_capture...")
        with spaces.aoti_capture(model) as call:
            segment_recitations(
                [test_audio], model, processor,
                device=device, dtype=dtype, batch_size=1,
            )

        print(f"[AoTI] Captured args: {len(call.args)} positional, {list(call.kwargs.keys())} kwargs")

    except Exception as e:
        results["error"] = f"aoti_capture failed: {type(e).__name__}: {e}"
        print(f"[AoTI] {results['error']}")
        import traceback
        traceback.print_exc()
        return results

    # Build dynamic shapes from captured tensors
    # The sequence dimension (T) varies with audio length
    try:
        from torch.export import export, Dim

        # Derive frame rate from captured tensor (model's actual output rate)
        # Find the first 2D+ tensor to get the captured frame count
        captured_frames = None
        for val in list(call.kwargs.values()) + list(call.args):
            if isinstance(val, torch.Tensor) and val.dim() >= 2:
                captured_frames = val.shape[1]
                break

        if captured_frames is None:
            raise ValueError("No 2D+ tensor found in captured args/kwargs")

        # Calculate frames per minute from captured data
        frames_per_minute = captured_frames / AOTI_MIN_AUDIO_MINUTES
        min_frames = captured_frames  # Already at min duration
        max_frames = int(AOTI_MAX_AUDIO_MINUTES * frames_per_minute)
        dynamic_T = Dim("T", min=min_frames, max=max_frames)
        print(f"[AoTI] Captured {captured_frames} frames for {AOTI_MIN_AUDIO_MINUTES} min = {frames_per_minute:.1f} frames/min")
        print(f"[AoTI] Dynamic shape range: {min_frames}-{max_frames} frames")

        # Build dynamic_shapes dict matching the captured signature
        dynamic_shapes_args = []
        for arg in call.args:
            if isinstance(arg, torch.Tensor) and arg.dim() >= 2:
                # Assume sequence dim is dim 1 for 2D+ tensors
                dynamic_shapes_args.append({1: dynamic_T})
            else:
                dynamic_shapes_args.append(None)

        dynamic_shapes_kwargs = {}
        for key, val in call.kwargs.items():
            if isinstance(val, torch.Tensor) and val.dim() >= 2:
                dynamic_shapes_kwargs[key] = {1: dynamic_T}
            else:
                dynamic_shapes_kwargs[key] = None

        print(f"[AoTI] Dynamic shapes - args: {dynamic_shapes_args}, kwargs: {list(dynamic_shapes_kwargs.keys())}")

        t0 = time.time()
        # Export using captured signature - guarantees match with inference
        exported = export(
            model,
            args=call.args,
            kwargs=call.kwargs,
            dynamic_shapes=(dynamic_shapes_args, dynamic_shapes_kwargs) if dynamic_shapes_args else dynamic_shapes_kwargs,
            strict=False,
        )
        results["export_time"] = time.time() - t0
        results["export_success"] = True
        _aoti_cache["exported"] = exported
        print(f"[AoTI] torch.export SUCCESS in {results['export_time']:.1f}s")

    except Exception as e:
        results["error"] = f"torch.export failed: {type(e).__name__}: {e}"
        print(f"[AoTI] {results['error']}")
        import traceback
        traceback.print_exc()
        return results

    # Attempt spaces.aoti_compile
    try:
        t0 = time.time()
        compiled = spaces.aoti_compile(exported)
        results["compile_time"] = time.time() - t0
        results["compile_success"] = True
        _aoti_cache["compiled"] = compiled
        print(f"[AoTI] spaces.aoti_compile SUCCESS in {results['compile_time']:.1f}s")

        # Return compiled object - apply happens OUTSIDE GPU lease (in main process)
        results["compiled"] = compiled
        print(f"[AoTI] Compiled object ready for apply")

        # Upload to Hub for future reuse
        if _push_aoti_to_hub(compiled):
            results["hub_uploaded"] = True

    except Exception as e:
        results["error"] = f"aoti_compile failed: {type(e).__name__}: {e}"
        print(f"[AoTI] {results['error']}")
        import traceback
        traceback.print_exc()

    return results


def apply_aoti_compiled(compiled):
    """
    Apply AoTI compiled model to VAD segmenter.
    Must be called OUTSIDE GPU lease, in main process.
    """
    if compiled is None:
        print("[AoTI] No compiled object to apply")
        return False

    model = _segmenter_cache.get("model")
    if model is None:
        print("[AoTI] Model not loaded, cannot apply")
        return False

    try:
        import spaces
        spaces.aoti_apply(compiled, model)
        _aoti_cache["compiled"] = compiled
        _aoti_cache["applied"] = True
        print(f"[AoTI] Compiled model applied to VAD (model_id={id(model)})")
        return True
    except Exception as e:
        print(f"[AoTI] Apply failed: {e}")
        return False
