const DEFAULT_STORAGE_KEY = "pokemonQuiz.soundEnabled.v1";
const DEFAULT_MANIFEST_URL = new URL("../assets/audio/red-blue-sfx/manifest.json", import.meta.url).href;
const SAMPLE_GAIN = 0.42;

const FALLBACK_CUES = {
  cursor: [[440, 0, 0.035, "square", 0.018]],
  menu: [[523.25, 0, 0.045, "square", 0.022]],
  select: [[392, 0, 0.035, "square", 0.018], [587.33, 0.045, 0.04, "square", 0.02]],
  launch: [[261.63, 0, 0.055, "square", 0.018], [392, 0.065, 0.055, "square", 0.02], [523.25, 0.13, 0.08, "square", 0.024]],
  start: [[196, 0, 0.05, "square", 0.018], [392, 0.055, 0.05, "square", 0.02], [784, 0.11, 0.075, "square", 0.022]],
  scan: [[330, 0, 0.045, "triangle", 0.018], [415.3, 0.05, 0.045, "triangle", 0.018], [494, 0.1, 0.045, "triangle", 0.018]],
  confirm: [[523.25, 0, 0.05, "square", 0.02], [659.25, 0.055, 0.075, "square", 0.024]],
  correct: [[659.25, 0, 0.055, "square", 0.022], [783.99, 0.06, 0.055, "square", 0.024], [1046.5, 0.12, 0.1, "square", 0.026]],
  wrong: [[164.81, 0, 0.08, "sawtooth", 0.018], [130.81, 0.08, 0.11, "sawtooth", 0.016]],
  deny: [[110, 0, 0.11, "sawtooth", 0.018]],
  quit: [[293.66, 0, 0.045, "square", 0.016], [220, 0.055, 0.065, "square", 0.016]],
  close: [[220, 0, 0.05, "square", 0.016], [146.83, 0.06, 0.09, "square", 0.014]],
  next: [[392, 0, 0.04, "square", 0.018], [523.25, 0.045, 0.04, "square", 0.018]],
  lock: [[98, 0, 0.12, "sawtooth", 0.016], [73.42, 0.1, 0.12, "sawtooth", 0.014]],
  save: [[440, 0, 0.06, "square", 0.02], [554.37, 0.07, 0.08, "square", 0.022]],
  complete: [[523.25, 0, 0.06, "square", 0.022], [659.25, 0.07, 0.06, "square", 0.023], [783.99, 0.14, 0.06, "square", 0.024], [1046.5, 0.21, 0.14, "square", 0.025]],
};

export function createAudioController({
  manifestUrl = DEFAULT_MANIFEST_URL,
  storageKey = DEFAULT_STORAGE_KEY,
} = {}) {
  let enabled = readStoredEnabled(storageKey);
  let context = null;
  let manifest = null;
  let manifestPromise = null;
  const buffers = new Map();
  const pendingBuffers = new Map();

  function prime() {
    if (!enabled) return null;
    const AudioContextCtor = window.AudioContext || window.webkitAudioContext;
    if (!AudioContextCtor) return null;
    if (!context) context = new AudioContextCtor();
    if (context.state === "suspended") {
      context.resume().catch(() => {});
    }
    void loadManifest().then(() => preloadMappedSamples());
    return context;
  }

  function play(name) {
    const audioContext = prime();
    if (!audioContext) return;

    const sampleUrl = getSampleUrl(name);
    if (!sampleUrl) {
      playFallback(audioContext, name);
      return;
    }

    const buffer = buffers.get(sampleUrl);
    if (buffer) {
      playBuffer(audioContext, buffer);
      return;
    }

    void loadSample(sampleUrl);
    playFallback(audioContext, name);
  }

  function setEnabled(nextEnabled) {
    enabled = Boolean(nextEnabled);
    writeStoredEnabled(storageKey, enabled);
    if (!enabled && context?.state === "running") {
      context.suspend().catch(() => {});
    }
  }

  async function loadManifest() {
    if (manifest) return manifest;
    if (!manifestPromise) {
      manifestPromise = fetch(manifestUrl)
        .then((response) => {
          if (!response.ok) throw new Error(`Audio manifest load failed: ${response.status}`);
          return response.json();
        })
        .then((loaded) => {
          manifest = loaded;
          return manifest;
        })
        .catch(() => {
          manifest = { events: {} };
          return manifest;
        });
    }
    return manifestPromise;
  }

  function getSampleUrl(name) {
    if (!manifest?.events?.[name]) return "";
    const basePath = manifest.basePath || "";
    return new URL(`${basePath}${manifest.events[name]}`, manifestUrl).href;
  }

  async function preloadMappedSamples() {
    if (!manifest?.events || !context) return;
    const names = Object.values(manifest.events);
    await Promise.all(names.map((fileName) => {
      const url = new URL(`${manifest.basePath || ""}${fileName}`, manifestUrl).href;
      return loadSample(url);
    }));
  }

  async function loadSample(url) {
    if (!context || buffers.has(url)) return buffers.get(url);
    if (pendingBuffers.has(url)) return pendingBuffers.get(url);

    const promise = fetch(url)
      .then((response) => {
        if (!response.ok) throw new Error(`Audio sample load failed: ${response.status}`);
        return response.arrayBuffer();
      })
      .then((arrayBuffer) => context.decodeAudioData(arrayBuffer))
      .then((buffer) => {
        buffers.set(url, buffer);
        pendingBuffers.delete(url);
        return buffer;
      })
      .catch(() => {
        pendingBuffers.delete(url);
        return null;
      });
    pendingBuffers.set(url, promise);
    return promise;
  }

  return {
    get enabled() {
      return enabled;
    },
    prime,
    play,
    setEnabled,
  };
}

function playBuffer(context, buffer) {
  const source = context.createBufferSource();
  const gain = context.createGain();
  source.buffer = buffer;
  gain.gain.setValueAtTime(SAMPLE_GAIN, context.currentTime);
  source.connect(gain);
  gain.connect(context.destination);
  source.start();
}

function playFallback(context, name) {
  const cue = FALLBACK_CUES[name];
  if (!cue) return;
  const now = context.currentTime + 0.006;
  cue.forEach(([frequency, offset, duration, type, volume]) => {
    scheduleTone(context, frequency, now + offset, duration, type, volume);
  });
}

function scheduleTone(context, frequency, startAt, duration, type, volume) {
  const oscillator = context.createOscillator();
  const gain = context.createGain();
  oscillator.type = type;
  oscillator.frequency.setValueAtTime(frequency, startAt);
  gain.gain.setValueAtTime(0.0001, startAt);
  gain.gain.linearRampToValueAtTime(volume, startAt + 0.006);
  gain.gain.exponentialRampToValueAtTime(0.0001, startAt + duration);
  oscillator.connect(gain);
  gain.connect(context.destination);
  oscillator.start(startAt);
  oscillator.stop(startAt + duration + 0.015);
}

function readStoredEnabled(storageKey) {
  try {
    return localStorage.getItem(storageKey) !== "off";
  } catch {
    return true;
  }
}

function writeStoredEnabled(storageKey, enabled) {
  try {
    localStorage.setItem(storageKey, enabled ? "on" : "off");
  } catch {
    // The live setting still works when storage is unavailable.
  }
}
