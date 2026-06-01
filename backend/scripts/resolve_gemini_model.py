"""Dev-only helper: resolve the Gemini model id to set as GEMINI_MODEL.

Run MANUALLY by a developer:

    cd backend
    GEMINI_API_KEY=... python scripts/resolve_gemini_model.py

It lists the account's available models and highlights the ``/flash/`` matches
so the human can copy the exact id (e.g. the "Gemini 3.5 Flash" id) into the
``GEMINI_MODEL`` env var in Railway.

This script is intentionally standalone:
  * It is NOT imported by ``app/analysis/gemini_engine.py``.
  * It is NOT part of any test (no test imports it; it touches the network).
  * The engine reads ``settings.ai.gemini_model`` — no model id is hardcoded
    anywhere in the engine.

If the network is unavailable (e.g. in CI/sandbox), it does not crash — it
prints the candidate id strings to verify manually in Google AI Studio.
"""

from __future__ import annotations

import os
import sys

# Candidate ids to try if listing is unavailable. VERIFY in Google AI Studio —
# do not assume; Google renames model ids between releases.
CANDIDATE_MODEL_IDS = [
    "gemini-3.5-flash",
    "models/gemini-3.5-flash",
    "gemini-flash-latest",
    "gemini-2.5-flash",
    "models/gemini-2.5-flash",
]


def _print_candidates() -> None:
    print("\nCandidate GEMINI_MODEL ids to try (verify in Google AI Studio):")
    for candidate in CANDIDATE_MODEL_IDS:
        print(f"  - {candidate}")
    print(
        "\nSet the confirmed id as GEMINI_MODEL in Railway. The engine reads "
        "settings.ai.gemini_model; nothing is hardcoded."
    )


def main() -> int:
    api_key = os.getenv("GEMINI_API_KEY", "").strip()
    if not api_key:
        print("GEMINI_API_KEY is not set — cannot list models.", file=sys.stderr)
        _print_candidates()
        return 2

    try:
        from google import genai

        client = genai.Client(api_key=api_key)
        models = list(client.models.list())
    except Exception as exc:  # network / auth / SDK problem — do not crash
        print(f"Could not list models ({exc!r}). Network may be unavailable.")
        _print_candidates()
        return 1

    def _name(model: object) -> str:
        return str(getattr(model, "name", "") or "")

    flash = [model for model in models if "flash" in _name(model).lower()]

    print("=== Models matching /flash/ ===")
    if flash:
        for model in flash:
            display = getattr(model, "display_name", "") or ""
            print(f"  {_name(model)}    {display}")
    else:
        print("  (none matched /flash/ — full model list follows)")
        for model in models:
            print(f"  {_name(model)}")

    print(
        "\nCopy the exact 'Gemini 3.5 Flash' id above into GEMINI_MODEL "
        "(Railway). The engine reads settings.ai.gemini_model."
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
