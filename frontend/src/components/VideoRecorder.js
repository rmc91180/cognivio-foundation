import React, { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";

export function VideoRecorder({ onRecordingReady }) {
  const { t } = useTranslation();
  const videoRef = useRef(null);
  const mediaRecorderRef = useRef(null);
  const [stream, setStream] = useState(null);
  const [recordingState, setRecordingState] = useState("idle");
  const [chunks, setChunks] = useState([]);
  const [previewUrl, setPreviewUrl] = useState("");
  const [error, setError] = useState("");

  useEffect(() => {
    return () => {
      if (stream) {
        stream.getTracks().forEach((track) => track.stop());
      }
    };
  }, [stream]);

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
          setChunks((prev) => [...prev, event.data]);
        }
      };
      recorder.onstop = () => {
        const mimeType =
          recorder.mimeType && recorder.mimeType.length
            ? recorder.mimeType
            : "video/webm";
        const blob = new Blob(chunks, { type: mimeType });
        const url = URL.createObjectURL(blob);
        setPreviewUrl(url);
        setRecordingState("stopped");
        if (onRecordingReady) {
          onRecordingReady(blob, url);
        }
      };
      recorder.start(1000);
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
      {previewUrl && (
        <div className="rounded-xl border border-slate-200 bg-white p-3">
          <div className="mb-2 text-xs text-slate-500">{t("videoRecorder.preview")}</div>
          <video src={previewUrl} controls className="w-full rounded-lg" />
        </div>
      )}
      {error && <div className="text-xs text-rose-600">{error}</div>}
      <div className="flex flex-wrap gap-2">
        <button
          type="button"
          onClick={startRecording}
          className="rounded-md bg-primary px-3 py-2 text-xs font-medium text-white"
          disabled={recordingState === "recording"}
        >
          {t("videoRecorder.start")}
        </button>
        <button
          type="button"
          onClick={pauseRecording}
          className="rounded-md border border-slate-200 px-3 py-2 text-xs text-slate-700"
          disabled={recordingState !== "recording"}
        >
          {t("videoRecorder.pause")}
        </button>
        <button
          type="button"
          onClick={resumeRecording}
          className="rounded-md border border-slate-200 px-3 py-2 text-xs text-slate-700"
          disabled={recordingState !== "paused"}
        >
          {t("videoRecorder.resume")}
        </button>
        <button
          type="button"
          onClick={stopRecording}
          className="rounded-md border border-slate-200 px-3 py-2 text-xs text-slate-700"
          disabled={recordingState === "idle"}
        >
          {t("videoRecorder.stop")}
        </button>
      </div>
    </div>
  );
}
