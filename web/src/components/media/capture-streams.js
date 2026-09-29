// Media sources for the chat capture dialog (docs/chat-media.md). Loaded with
// the dialog chunk only.
//
// - Screenshot: one frame of a getDisplayMedia stream drawn to a canvas.
// - Recording: screen, screen + camera bubble (composited on a canvas and
//   re-captured with captureStream), or camera only. Microphone audio is mixed
//   with the shared tab/system audio when the browser provides both.

const MAX_CANVAS_WIDTH = 1920;
const BUBBLE_FPS = 30;

function stopAll(...streams) {
  for (const stream of streams) stream?.getTracks?.().forEach((track) => track.stop());
}

function videoFor(stream) {
  const video = document.createElement('video');
  video.muted = true;
  video.playsInline = true;
  video.srcObject = stream;
  return video;
}

async function playable(video) {
  if (video.readyState < 2) {
    await new Promise((resolve, reject) => {
      video.onloadeddata = () => resolve();
      video.onerror = () => reject(new Error('The capture could not start.'));
    });
  }
  await video.play().catch(() => {});
  return video;
}

/**
 * Ask for a screen, window or tab and return one frame of it as a canvas.
 * Throws the browser's NotAllowedError when the person cancels.
 */
export async function captureScreenFrame(mediaDevices = navigator.mediaDevices) {
  const stream = await mediaDevices.getDisplayMedia({ video: true, audio: false });
  try {
    const video = await playable(videoFor(stream));
    // Give the browser a frame to paint after the picker closes.
    await new Promise((resolve) => setTimeout(resolve, 150));
    const canvas = document.createElement('canvas');
    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;
    canvas.getContext('2d').drawImage(video, 0, 0, canvas.width, canvas.height);
    video.srcObject = null;
    return canvas;
  } finally {
    stopAll(stream);
  }
}

/**
 * A steady tick for the compositing loop. Timers in a worker keep running
 * when the recording tab is in the background (requestAnimationFrame stops
 * and page timers are throttled), which is the normal case while recording
 * another window. Falls back to setInterval.
 */
function createTicker(fps, onTick) {
  const interval = Math.round(1000 / fps);
  try {
    const source = `setInterval(() => postMessage(0), ${interval});`;
    const url = URL.createObjectURL(new Blob([source], { type: 'text/javascript' }));
    const worker = new Worker(url);
    worker.onmessage = onTick;
    return () => { worker.terminate(); URL.revokeObjectURL(url); };
  } catch {
    const id = setInterval(onTick, interval);
    return () => clearInterval(id);
  }
}

function mixAudio(streams) {
  const tracks = streams.flatMap((stream) => stream?.getAudioTracks?.() ?? []);
  if (tracks.length <= 1) return { tracks, dispose: () => {} };
  const AudioContextImpl = globalThis.AudioContext || globalThis.webkitAudioContext;
  if (!AudioContextImpl) return { tracks: [tracks[0]], dispose: () => {} };
  const context = new AudioContextImpl();
  const destination = context.createMediaStreamDestination();
  for (const track of tracks) context.createMediaStreamSource(new MediaStream([track])).connect(destination);
  return { tracks: destination.stream.getAudioTracks(), dispose: () => { context.close().catch?.(() => {}); } };
}

function drawCover(context, video, x, y, width, height) {
  const sourceWidth = video.videoWidth || width;
  const sourceHeight = video.videoHeight || height;
  const scale = Math.max(width / sourceWidth, height / sourceHeight);
  const cropWidth = width / scale;
  const cropHeight = height / scale;
  context.drawImage(video, (sourceWidth - cropWidth) / 2, (sourceHeight - cropHeight) / 2, cropWidth, cropHeight, x, y, width, height);
}

/**
 * Screen video with the camera composited as a round bubble in the bottom
 * left corner.
 */
async function compositeScreenAndCamera(screen, camera) {
  const screenVideo = await playable(videoFor(new MediaStream(screen.getVideoTracks())));
  const cameraVideo = await playable(videoFor(new MediaStream(camera.getVideoTracks())));
  const canvas = document.createElement('canvas');
  const scale = Math.min(1, MAX_CANVAS_WIDTH / (screenVideo.videoWidth || MAX_CANVAS_WIDTH));
  canvas.width = Math.round((screenVideo.videoWidth || 1280) * scale);
  canvas.height = Math.round((screenVideo.videoHeight || 720) * scale);
  const context = canvas.getContext('2d');
  const draw = () => {
    // The shared surface can change size (window resized, tab switched).
    context.drawImage(screenVideo, 0, 0, canvas.width, canvas.height);
    const diameter = Math.round(Math.min(canvas.width, canvas.height) * 0.24);
    const margin = Math.round(diameter * 0.12);
    const x = margin;
    const y = canvas.height - diameter - margin;
    context.save();
    context.beginPath();
    context.arc(x + diameter / 2, y + diameter / 2, diameter / 2, 0, Math.PI * 2);
    context.closePath();
    context.clip();
    drawCover(context, cameraVideo, x, y, diameter, diameter);
    context.restore();
    context.lineWidth = Math.max(2, Math.round(diameter * 0.02));
    context.strokeStyle = 'rgba(255,255,255,0.9)';
    context.beginPath();
    context.arc(x + diameter / 2, y + diameter / 2, diameter / 2, 0, Math.PI * 2);
    context.stroke();
  };
  draw();
  const stopTicker = createTicker(BUBBLE_FPS, draw);
  const output = canvas.captureStream(BUBBLE_FPS);
  return {
    videoTracks: output.getVideoTracks(),
    dispose: () => {
      stopTicker();
      output.getTracks().forEach((track) => track.stop());
      screenVideo.srcObject = null;
      cameraVideo.srcObject = null;
    },
  };
}

/**
 * Acquire the stream to record.
 *
 * @param {{ source: 'screen' | 'screen-camera' | 'camera', microphone: boolean, mediaDevices?: MediaDevices }} options
 * @returns {Promise<{ stream: MediaStream, preview: MediaStream | null, onSourceEnded: (callback: () => void) => void, dispose: () => void }>}
 */
export async function acquireRecordingStream({ source, microphone, mediaDevices = navigator.mediaDevices }) {
  const acquired = [];
  const disposers = [];
  const dispose = () => {
    disposers.forEach((disposer) => disposer());
    stopAll(...acquired);
  };
  try {
    let screen = null;
    let camera = null;
    let mic = null;
    if (source === 'screen' || source === 'screen-camera') {
      screen = await mediaDevices.getDisplayMedia({ video: true, audio: true });
      acquired.push(screen);
    }
    if (source === 'camera' || source === 'screen-camera') {
      camera = await mediaDevices.getUserMedia({
        video: source === 'camera' ? { width: { ideal: 1280 }, height: { ideal: 720 } } : { width: { ideal: 480 }, height: { ideal: 480 } },
        audio: Boolean(microphone),
      });
      acquired.push(camera);
    } else if (microphone) {
      try {
        mic = await mediaDevices.getUserMedia({ audio: true });
        acquired.push(mic);
      } catch {
        // Recording continues without narration; the dialog says so.
        mic = null;
      }
    }

    let videoTracks;
    if (source === 'screen-camera') {
      const composite = await compositeScreenAndCamera(screen, camera);
      disposers.push(composite.dispose);
      videoTracks = composite.videoTracks;
    } else {
      videoTracks = (screen ?? camera).getVideoTracks();
    }
    const audio = mixAudio([screen, camera, mic]);
    disposers.push(audio.dispose);
    const stream = new MediaStream([...videoTracks, ...audio.tracks]);
    const primary = (screen ?? camera).getVideoTracks()[0];
    return {
      stream,
      preview: camera && source === 'screen-camera' ? new MediaStream(camera.getVideoTracks()) : null,
      microphoneActive: Boolean(microphone && (mic || camera?.getAudioTracks().length)),
      onSourceEnded: (callback) => { if (primary) primary.addEventListener('ended', callback, { once: true }); },
      dispose,
    };
  } catch (error) {
    dispose();
    throw error;
  }
}

/** Load a File/Blob as an image for the markup editor. */
export function loadImage(file) {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const image = new Image();
    image.onload = () => { URL.revokeObjectURL(url); resolve(image); };
    image.onerror = () => { URL.revokeObjectURL(url); reject(new Error('This image could not be opened.')); };
    image.src = url;
  });
}
