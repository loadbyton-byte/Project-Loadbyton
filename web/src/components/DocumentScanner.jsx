import React, { useEffect, useRef, useState } from 'react';
import { Button } from './ui.jsx';
import { IconClose, IconCamera, IconCheck, IconUpload } from './icons.jsx';

// Live-camera capture UI (Stitch's document_scanner / interactive_document_
// scanner screens: viewfinder + corner brackets + scanning laser + a
// thumbnail bottom sheet) — replaces ScanWithAi's plain hidden-file-input
// trigger with an actual camera view. Feeds the same extractDocumentFields()
// OCR pipeline underneath (lib/puterOcr.js, unchanged) — this component only
// gets a photo (as a data URL) by whatever means the device allows and hands
// it back via onCapture; it has no opinion about what happens after.
//
// getUserMedia needs HTTPS/localhost and an actual camera — neither is
// guaranteed (desktop with no webcam, a sandboxed browser, permission
// denied). Falling back to a plain file input isn't an edge case here, it's
// the common path in a lot of real environments, so it's offered up front,
// not buried behind an error state.
export default function DocumentScanner({ onCapture, onClose }) {
  const videoRef = useRef(null);
  const streamRef = useRef(null);
  const [ready, setReady] = useState(false);
  const [cameraError, setCameraError] = useState('');
  const [shots, setShots] = useState([]);

  useEffect(() => {
    let cancelled = false;
    async function start() {
      if (!navigator.mediaDevices?.getUserMedia) {
        setCameraError('Camera capture is not available in this browser.');
        return;
      }
      try {
        const stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment' }, audio: false });
        if (cancelled) { stream.getTracks().forEach((t) => t.stop()); return; }
        streamRef.current = stream;
        if (videoRef.current) {
          videoRef.current.srcObject = stream;
          await videoRef.current.play();
        }
        setReady(true);
      } catch (err) {
        setCameraError(err?.message || 'Could not access the camera.');
      }
    }
    start();
    return () => {
      cancelled = true;
      streamRef.current?.getTracks().forEach((t) => t.stop());
    };
  }, []);

  function capture() {
    const video = videoRef.current;
    if (!video || !video.videoWidth) return;
    const canvas = document.createElement('canvas');
    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;
    canvas.getContext('2d').drawImage(video, 0, 0);
    setShots((s) => [...s, canvas.toDataURL('image/jpeg', 0.9)]);
  }

  function onFile(e) {
    const file = e.target.files[0];
    e.target.value = '';
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => setShots((s) => [...s, String(reader.result)]);
    reader.readAsDataURL(file);
  }

  return (
    <div className="fixed inset-0 z-50 flex flex-col bg-black" role="dialog" aria-modal="true" aria-label="Document scanner">
      <div className="relative flex-1 overflow-hidden">
        {ready && !cameraError ? (
          <>
            {/* Viewfinder */}
            <video ref={videoRef} className="h-full w-full object-cover" playsInline muted />
            <div className="pointer-events-none absolute inset-6 rounded-2xl border-2 border-white/70">
              <span className="absolute -left-0.5 -top-0.5 h-8 w-8 rounded-tl-2xl border-l-4 border-t-4" style={{ borderColor: 'var(--brand-accent)' }} />
              <span className="absolute -right-0.5 -top-0.5 h-8 w-8 rounded-tr-2xl border-r-4 border-t-4" style={{ borderColor: 'var(--brand-accent)' }} />
              <span className="absolute -bottom-0.5 -left-0.5 h-8 w-8 rounded-bl-2xl border-b-4 border-l-4" style={{ borderColor: 'var(--brand-accent)' }} />
              <span className="absolute -bottom-0.5 -right-0.5 h-8 w-8 rounded-br-2xl border-b-4 border-r-4" style={{ borderColor: 'var(--brand-accent)' }} />
              <span className="scanner-laser" style={{ background: 'var(--brand-accent)' }} />
            </div>
            <p className="absolute bottom-4 left-0 right-0 text-center text-sm font-medium text-white/90">Align the document within the frame</p>
          </>
        ) : (
          <div className="flex h-full flex-col items-center justify-center gap-4 px-8 text-center">
            <IconCamera size={40} className="text-white/40" />
            <p className="text-sm text-white/70">{cameraError || 'Starting camera…'}</p>
          </div>
        )}
        <button onClick={onClose} aria-label="Close scanner" className="absolute right-4 top-4 flex h-10 w-10 items-center justify-center rounded-full bg-black/50 text-white">
          <IconClose size={20} />
        </button>
      </div>

      {/* Bottom sheet — thumbnail gallery + capture/upload controls */}
      <div className="rounded-t-2xl bg-surface p-4">
        <div className="mx-auto mb-3 h-1 w-10 rounded-full" style={{ background: 'var(--outline-variant)' }} />
        {shots.length > 0 && (
          <div className="mb-3 flex gap-2 overflow-x-auto">
            {shots.map((s, i) => (
              <img key={i} src={s} alt={`Capture ${i + 1}`} className="h-16 w-16 shrink-0 rounded-lg object-cover" style={{ border: '1px solid var(--border-default)' }} />
            ))}
          </div>
        )}
        <div className="flex items-center justify-center gap-4">
          <label className="btn-secondary cursor-pointer">
            <IconUpload size={16} /> Upload instead
            <input type="file" accept="image/*" hidden onChange={onFile} />
          </label>
          {ready && !cameraError && (
            <button
              onClick={capture}
              aria-label="Capture photo"
              className="flex h-16 w-16 items-center justify-center rounded-full"
              style={{ background: 'var(--brand-accent)', color: 'var(--text-on-accent)' }}
            >
              <IconCamera size={26} />
            </button>
          )}
          <Button variant="accent" disabled={shots.length === 0} onClick={() => onCapture(shots[shots.length - 1])}>
            <IconCheck size={16} /> Use photo
          </Button>
        </div>
      </div>
    </div>
  );
}
