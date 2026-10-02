import { useEffect, useRef, useState, type ComponentProps, type RefObject } from 'react';
import type Hls from 'hls.js';

/** Only signed URLs reach the player. Never fetch the entire original into a Blob. */
export function VideoStream({
  mediaRef,
  source,
  hlsUrl,
  ...props
}: Omit<ComponentProps<'video'>, 'src' | 'ref'> & { mediaRef: RefObject<HTMLVideoElement | null>; source: string | null; hlsUrl: string | null }) {
  const engine = useRef<Hls | null>(null);
  const [levels, setLevels] = useState<Array<{ index: number; height: number }>>([]);
  const [quality, setQuality] = useState(-1);
  const [error, setError] = useState(false);
  const [retry, setRetry] = useState(0);
  useEffect(() => {
    const video = mediaRef.current;
    if (!video) return;
    let cancelled = false;
    setError(false);
    setLevels([]);
    setQuality(-1);
    if (!hlsUrl && source) video.src = source;
    if (hlsUrl) {
      void import('hls.js')
        .then(({ default: Player }) => {
          if (cancelled) return;
          if (Player.isSupported()) {
            const player = new Player({ maxBufferLength: 30, maxMaxBufferLength: 60, maxBufferSize: 32 * 1024 * 1024, backBufferLength: 20 });
            engine.current = player;
            player.on(Player.Events.MANIFEST_PARSED, () => setLevels(player.levels.map((level, index) => ({ index, height: level.height }))));
            player.on(Player.Events.ERROR, (_event, data) => {
              if (data.fatal) {
                player.stopLoad();
                setError(true);
              }
            });
            player.attachMedia(video);
            player.loadSource(hlsUrl);
          } else if (video.canPlayType('application/vnd.apple.mpegurl')) video.src = hlsUrl;
          else if (source) video.src = source;
          else setError(true);
        })
        .catch(() => {
          if (!cancelled) setError(true);
        });
    }
    return () => {
      cancelled = true;
      engine.current?.destroy();
      engine.current = null;
      // Release decoder, segment requests and progressive buffering on close/file change.
      video.pause();
      video.removeAttribute('src');
      video.load();
    };
  }, [mediaRef, source, hlsUrl, retry]);
  return (
    <div className="flex flex-col gap-2">
      <video {...props} ref={mediaRef} src={hlsUrl ? undefined : (source ?? undefined)} preload="metadata" />
      {levels.length > 0 ? (
        <select
          className="h-8 rounded border border-[#2A3A66] bg-[#16254F] px-2 text-white"
          aria-label="Video quality"
          value={quality}
          onChange={(e) => {
            const value = Number(e.target.value);
            setQuality(value);
            if (engine.current) engine.current.currentLevel = value;
          }}
        >
          <option value={-1}>Quality: Auto</option>
          {levels.map((level) => (
            <option key={level.index} value={level.index}>
              {level.height}p
            </option>
          ))}
        </select>
      ) : null}
      {error ? (
        <div role="alert">
          Streaming failed. Check your connection and try again.{' '}
          <button type="button" onClick={() => setRetry((n) => n + 1)}>
            Retry streaming
          </button>
        </div>
      ) : null}
    </div>
  );
}
