"""
parakeet_utils.py — NVIDIA Parakeet-TDT-0.6B transcription helpers.

Parakeet-TDT uses a Token-and-Duration Transducer architecture (frame-level
classification), giving inherently accurate timestamps with no hallucination
tendencies during silence. This is structurally different from Whisper's
autoregressive decoding, which can generate text when given silence.

Requirements:
    pip install nemo_toolkit[asr]
    (CUDA GPU required — no CPU/Apple Silicon fallback)

Model:
    nvidia/parakeet-tdt-0.6b (~1.2GB)
    HuggingFace: https://huggingface.co/nvidia/parakeet-tdt-0.6b

Key differences from Whisper:
    - CAN'T use vocab prompts (initial_prompt) to bias toward proper nouns
    - Built-in hallucination rejection during silence (structural, not post-hoc)
    - Inherently accurate word-level timestamps (TDT alignment, not DTW)
    - NVIDIA-only
"""

import re


def load_parakeet_model():
    """Load Parakeet-TDT-0.6B via NVIDIA NeMo. Returns the model on CUDA."""
    try:
        import nemo.collections.asr as nemo_asr  # noqa: F401
    except ImportError:
        raise ImportError(
            "NeMo ASR is not installed.\n"
            "Install with: pip install nemo_toolkit[asr]\n"
            "Note: this pulls in a large set of dependencies (~2GB)."
        )

    import torch
    if not torch.cuda.is_available():
        raise RuntimeError(
            "Parakeet-TDT requires a CUDA GPU. No CUDA device found.\n"
            "Use a Whisper model (e.g. large-v3) for CPU/Apple Silicon."
        )

    print("Loading Parakeet-TDT-0.6B (nvidia/parakeet-tdt-0.6b)...")
    model = nemo_asr.models.EncDecRNNTBPEModel.from_pretrained(
        "nvidia/parakeet-tdt-0.6b"
    )
    model = model.cuda()
    model.eval()
    # Tag so the worker can distinguish model types
    model._model_type = "parakeet"
    print("Parakeet model loaded.")
    return model


def transcribe_audio_parakeet(model, wav_path: str, **kwargs) -> dict:
    """
    Transcribe a WAV file using Parakeet-TDT and return the same dict format
    as whisper_utils.transcribe_audio: {"segments": [{start, end, text}, ...]}

    Parakeet outputs word-level timestamps; we group words into sentence-level
    segments at punctuation boundaries, matching the behaviour of
    whisper_utils._split_at_sentences.

    kwargs are accepted but largely ignored — Parakeet doesn't support
    initial_prompt, condition_on_previous_text, etc.
    """
    import torch

    initial_prompt = kwargs.get("initial_prompt")  # logged but not used
    if initial_prompt:
        print(f"      note: Parakeet does not support initial_prompt (vocab bias). "
              f"Ignoring {len(initial_prompt.split())} vocab words.")

    with torch.no_grad():
        hypotheses = model.transcribe([wav_path], timestamps=True)

    hypothesis = hypotheses[0] if hypotheses else None
    if not hypothesis or not hypothesis.text.strip():
        return {"segments": []}

    # Extract word-level timestamps from NeMo output
    word_timestamps: list[dict] = []
    if hasattr(hypothesis, "timestamp") and hypothesis.timestamp:
        word_timestamps = hypothesis.timestamp.get("word", [])

    if not word_timestamps:
        # Fallback: no word timestamps — return as a single segment with t=0
        text = hypothesis.text.strip()
        if text and len(text) >= 3:
            return {"segments": [{"start": 0.0, "end": 0.0, "text": text}]}
        return {"segments": []}

    # Group words into sentence-level segments at punctuation boundaries
    segments: list[dict] = []
    current_words: list[dict] = []

    for word_info in word_timestamps:
        word = word_info.get("word", "")
        start = float(word_info.get("start", 0.0))
        end = float(word_info.get("end", 0.0))
        current_words.append({"word": word, "start": start, "end": end})

        # Flush at sentence-ending punctuation
        if re.search(r'[.?!]["\'\u201d\u00bb]?$', word.strip()):
            text = "".join(w["word"] for w in current_words).strip()
            if text and len(text) >= 3:
                segments.append({
                    "start": current_words[0]["start"],
                    "end": end,
                    "text": text,
                })
            current_words = []

    # Remaining words (trailing fragment without sentence-ending punctuation)
    if current_words:
        text = "".join(w["word"] for w in current_words).strip()
        if text and len(text) >= 3:
            segments.append({
                "start": current_words[0]["start"],
                "end": current_words[-1]["end"],
                "text": text,
            })

    return {"segments": segments}
