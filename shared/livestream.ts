export type StreamPlatform = 'youtube' | 'facebook' | 'tiktok' | 'custom';
export type StreamLayout = 'grid' | 'speaker' | 'screen';
export type StreamOrientation = 'landscape' | 'portrait';
export type StreamState = 'connecting' | 'live' | 'reconnecting' | 'stopping' | 'stopped' | 'failed';
export interface StreamDestination {
  id: number; label: string; platform: StreamPlatform; server_url: string; auth_type: 'key' | 'youtube';
  orientation: StreamOrientation; layout: StreamLayout; title: string; description: string; visibility: 'private' | 'unlisted' | 'public';
  tested_at: string | null; has_key: boolean; connected: boolean;
}
export interface StreamJob { id: number; destination_id: number; label: string; platform: StreamPlatform; status: StreamState; error: string | null; started_at: string | null; mine: number; orientation: StreamOrientation; layout: StreamLayout }
export interface LivestreamStatus { available?: boolean; active: boolean; live: boolean; count: number; destinations: StreamJob[] }
export const STREAM_LABEL: Record<StreamState, string> = { connecting: 'Connecting', live: 'Live', reconnecting: 'Reconnecting', stopping: 'Stopping', stopped: 'Stopped', failed: 'Failed' };
export const PLATFORM_LABEL: Record<StreamPlatform, string> = { youtube: 'YouTube Live', facebook: 'Facebook Live', tiktok: 'TikTok LIVE', custom: 'Custom RTMP / RTMPS' };
export const STREAM_GUIDANCE: Record<StreamPlatform, string> = {
  youtube: 'Enable live streaming on your YouTube channel first; activation and account restrictions may apply. Connect an account when your administrator has configured YouTube OAuth, or copy the server URL and stream key from YouTube Studio.',
  facebook: 'Open Facebook Live Producer on an eligible account or Page and choose streaming software to obtain a server URL and stream key. Direct account connection is unavailable in this deployment. Set the title, description and audience in Live Producer.',
  tiktok: 'TikTok LIVE and external streaming software access are required. Some eligible LIVE accounts still cannot obtain a stream key. Use the URL and key supplied by TikTok LIVE Center; direct account connection is not offered. Set broadcast details in TikTok.',
  custom: 'Use a public Internet RTMP or RTMPS endpoint and a stream key supplied by its operator. RTMPS encrypts the connection. Configure broadcast details at the destination.',
};
export function streamActive(state: StreamState): boolean { return ['connecting', 'live', 'reconnecting', 'stopping'].includes(state); }
