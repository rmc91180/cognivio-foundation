import React, { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";

const toSafeVideoBlobUrl = (url) => {
  try {
    const parsed = new URL(String(url || ""));
    return parsed.protocol === "blob:" ? parsed.href : "";
  } catch {
    return "";
  }
};

export function VideoRecorder({ onRecordingReady }) {
  const { t } = useTranslation();
  const videoRef = useRef(null);
  const fileInputRef = useRef(null);
  const mediaRecorderRef = useRef(null);
  const chunksRef = useRef([]);
  const [stream, setStream] = useState(null);
  const [recordingState, setRecordingState] = useState("idle");
  const [chunks, setChunks] = useState([]);
  const [previewUrl, setPreviewUrl] = useState("");
  const [selectedBlob, setSelectedBlob] = useState(null);
  const [error, setError] = useState("");
  const [isMobileCapture, setIsMobileCapture] = useState(false);

  useEffect(() => {
    const mediaQuery = window.matchMedia?.("(max-width: 767px), (pointer: coarse)");
    const updateMode = () => setIsMobileCapture(Boolean(mediaQuery?.matches));
    updateMode();
    mediaQuery?.addEventListener?.("change", updateMode);
    return () => mediaQuery?.removeEventListener?.("change", updateMode);
  }, []);

  useEffect(() => {
    return () => {
      if (stream) {
        stream.getTracks().forEach((track) => track.stop());
      }
    };
  }, [stream]);

  useEffect(() => {
    return () => {
      if (previewUrl) {
        URL.revokeObjectURL(previewUrl);
      }
    };
  }, [previewUrl]);

  const startRecording = async () => {
    setError("");
    if (!navigator.mediaDevices?.getUserMedia) {
      setError(t("videoRecorder.unsupported"));
      return;
    }
    try {
      const mediaStream = await navigator.mediaDevices.getUserMedia({
        video: true,
        audio: true,
      });
      setStream(mediaStream);
      if (videoRef.current) {
        videoRef.current.srcObject = mediaStream;
      }
      let options = undefined;
      if (MediaRecorder.isTypeSupported("video/webm;codecs=vp8,opus")) {
        options = { mimeType: "video/webm;codecs=vp8,opus" };
      } else if (MediaRecorder.isTypeSupported("video/webm")) {
        options = { mimeType: "video/webm" };
      }
      const recorder = options
        ? new MediaRecorder(mediaStream, options)
        : new MediaRecorder(mediaStream);
      mediaRecorderRef.current = recorder;
      recorder.ondataavailable = (event) => {
        if (event.data && event.data.size > 0) {
          chunksRef.current = [...chunksRef.current, event.data];
          setChunks((prev) => [...prev, event.data]);
        }
      };
      recorder.onstop = () => {
        const mimeType =
          recorder.mimeType && recorder.mimeType.length
            ? recorder.mimeType
            : "video/webm";
        const blob = new Blob(chunksRef.current.length ? chunksRef.current : chunks, { type: mimeType });
        const url = URL.createObjectURL(blob);
        setPreviewUrl(url);
        setRecordingState("stopped");
        if (onRecordingReady) {
          onRecordingReady(blob, url);
        }
      };
      recorder.start(1000);
      chunksRef.current = [];
      setChunks([]);
      setPreviewUrl("");
      setRecordingState("recording");
    } catch (err) {
      setError(t("videoRecorder.accessError"));
    }
  };

  const stopRecording = () => {
    const recorder = mediaRecorderRef.current;
    if (recorder && recorder.state !== "inactive") {
      recorder.stop();
    }
    if (stream) {
      stream.getTracks().forEach((track) => track.stop());
    }
  };

  const pauseRecording = () => {
    const recorder = mediaRecorderRef.current;
    if (recorder && recorder.state === "recording") {
      recorder.pause();
      setRecordingState("paused");
    }
  };

  const resumeRecording = () => {
    const recorder = mediaRecorderRef.current;
    if (recorder && recorder.state === "paused") {
      recorder.resume();
      setRecordingState("recording");
    }
  };

  const handleMobileSelection = (event) => {
    const file = event.target.files?.[0];
    if (!file) return;
    setError("");
    if (!String(file.type || "").startsWith("video/")) {
      setError("Choose a video file to continue.");
      resetMobileSelection();
      return;
    }
    if (previewUrl) {
      URL.revokeObjectURL(previewUrl);
    }
    const url = URL.createObjectURL(file);
    setSelectedBlob(file);
    setPreviewUrl(url);
    setRecordingState("stopped");
  };

  const useSelectedClip = () => {
    if (!selectedBlob) return;
    onRecordingReady?.(selectedBlob, previewUrl);
  };

  const resetMobileSelection = () => {
    if (previewUrl) {
      URL.revokeObjectURL(previewUrl);
    }
    setPreviewUrl("");
    setSelectedBlob(null);
    setRecordingState("idle");
    if (fileInputRef.current) {
      fileInputRef.current.value = "";
    }
  };

  if (isMobileCapture) {
    const safePreviewUrl = toSafeVideoBlobUrl(previewUrl);
    return (
      <div className="space-y-4">
        <div className="rounded-xl border border-slate-200 bg-white p-4">
          <div className="text-sm font-semibold text-slate-900">Record observation</div>
          <p className="mt-1 text-sm leading-6 text-slate-600">
            Use your phone camera or choose a saved video, then preview it before uploading.
          </p>
          <input
            ref={fileInputRef}
            type="file"
            accept="video/*"
            capture="environment"
            onChange={handleMobileSelection}
            className="sr-only"
          />
          <button
            type="button"
            onClick={() => fileInputRef.current?.click()}
            className="mt-4 inline-flex min-h-[44px] w-full items-center justify-center rounded-md bg-primary px-4 py-2 text-sm font-semibold text-white hover:bg-primary/90"
          >
            {previewUrl ? "Record again" : "Record observation or choose video"}
          </button>
          {error ? <div className="mt-3 text-sm text-rose-600">{error}</div> : null}
        </div>

        {safePreviewUrl ? (
          <div className="rounded-xl border border-slate-200 bg-white p-3">
            <div className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-500">
              Preview
            </div>
            <video src={safePreviewUrl} controls playsInline className="aspect-video w-full rounded-lg bg-black object-contain" />
            <div className="mt-3 grid gap-2 sm:grid-cols-3">
              <button
                type="button"
                onClick={useSelectedClip}
                className="min-h-[44px] rounded-md bg-slate-900 px-3 py-2 text-sm font-semibold text-white hover:bg-slate-800"
              >
                Use this clip
              </button>
              <button
                type="button"
                onClick={() => fileInputRef.current?.click()}
                className="min-h-[44px] rounded-md border border-slate-200 bg-white px-3 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-50"
              >
                Record again
              </button>
              <button
                type="button"
                onClick={resetMobileSelection}
                className="min-h-[44px] rounded-md border border-slate-200 bg-white px-3 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-50"
              >
                Cancel
              </button>
            </div>
          </div>
        ) : null}
      </div>
    );
  }

  const safePreviewUrl = toSafeVideoBlobUrl(previewUrl);

  return (
    <div className="space-y-3">
      <div className="overflow-hidden rounded-xl border border-slate-200 bg-black">
        <video
          ref={videoRef}
          autoPlay
          muted
          playsInline
          className="h-72 w-full object-cover"
        />
      </div>
      {safePreviewUrl && (
        <div className="rounded-xl border border-slate-200 bg-white p-3">
          <div className="mb-2 text-xs text-slate-500">{t("videoRecorder.preview")}</div>
          <video src={safePreviewUrl} controls className="w-full rounded-lg" />
        </div>
      )}
      {error && <div className="text-xs text-rose-600">{error}</div>}
      <div className="flex flex-wrap gap-2">
        <button
          type="button"
          onClick={startRecording}
          className="min-h-[44px] rounded-md bg-primary px-3 py-2 text-xs font-medium text-white"
          disabled={recordingState === "recording"}
        >
          {t("videoRecorder.start")}
        </button>
        <button
          type="button"
          onClick={pauseRecording}
          className="min-h-[44px] rounded-md border border-slate-200 px-3 py-2 text-xs text-slate-700"
          disabled={recordingState !== "recording"}
        >
          {t("videoRecorder.pause")}
        </button>
        <button
          type="button"
          onClick={resumeRecording}
          className="min-h-[44px] rounded-md border border-slate-200 px-3 py-2 text-xs text-slate-700"
          disabled={recordingState !== "paused"}
        >
          {t("videoRecorder.resume")}
        </button>
        <button
          type="button"
          onClick={stopRecording}
          className="min-h-[44px] rounded-md border border-slate-200 px-3 py-2 text-xs text-slate-700"
          disabled={recordingState === "idle"}
        >
          {t("videoRecorder.stop")}
        </button>
      </div>
    </div>
  );
}
