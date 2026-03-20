from typing import Any, Dict, List, Optional


def align_transcript_segments_to_moments(
    moments: List[Dict[str, Any]],
    transcript_segments: List[Dict[str, Any]],
) -> List[Dict[str, Any]]:
    aligned: List[Dict[str, Any]] = []
    transcript_segments = transcript_segments or []
    for moment in moments or []:
        start_sec = float(moment.get("start_sec", 0.0) or 0.0)
        end_sec = float(moment.get("end_sec", start_sec) or start_sec)
        matched_segments = []
        for segment in transcript_segments:
            seg_start = float(segment.get("start_sec", 0.0) or 0.0)
            seg_end = float(segment.get("end_sec", seg_start) or seg_start)
            overlaps = seg_start < end_sec and seg_end > start_sec
            if overlaps:
                matched_segments.append(segment)

        transcript_excerpt = " ".join(
            str(segment.get("text") or "").strip()
            for segment in matched_segments
            if str(segment.get("text") or "").strip()
        ).strip()
        aligned.append(
            {
                **moment,
                "transcript_segments": matched_segments,
                "transcript_excerpt": transcript_excerpt,
            }
        )
    return aligned


def build_multimodal_analysis_payload(
    frames: List[Dict[str, Any]],
    moment_manifest: Optional[Dict[str, Any]],
    transcript_doc: Optional[Dict[str, Any]],
    feature_doc: Optional[Dict[str, Any]],
) -> Dict[str, Any]:
    moments = list((moment_manifest or {}).get("moments") or [])
    transcript_segments = list((transcript_doc or {}).get("segments") or [])
    aligned_moments = align_transcript_segments_to_moments(moments, transcript_segments)

    modalities_used = ["vision"]
    if transcript_segments:
        modalities_used.append("audio")

    moment_by_id = {moment.get("moment_id"): moment for moment in aligned_moments if moment.get("moment_id")}
    enriched_frames: List[Dict[str, Any]] = []
    for frame in frames or []:
        moment_id = frame.get("moment_id")
        linked_moment = moment_by_id.get(moment_id)
        enriched_frames.append(
            {
                **frame,
                "transcript_excerpt": (linked_moment or {}).get("transcript_excerpt"),
            }
        )

    return {
        "modalities_used": modalities_used,
        "moments": aligned_moments,
        "audio_features": feature_doc or {},
        "frames": enriched_frames,
    }
