'use client';

import { formatChatMessageLinks, RoomContext, VideoConference } from '@livekit/components-react';
import {
  ExternalE2EEKeyProvider,
  LogLevel,
  Room,
  RoomConnectOptions,
  RoomOptions,
  RoomEvent,
  VideoPresets,
  RemoteTrackPublication,
  type VideoCodec,
} from 'livekit-client';
import { DebugMode } from '@/lib/Debug';
import { useEffect, useMemo, useState } from 'react';
import { KeyboardShortcuts } from '@/lib/KeyboardShortcuts';
import { SettingsMenu } from '@/lib/SettingsMenu';
import { useSetupE2EE } from '@/lib/useSetupE2EE';
import { useLowCPUOptimizer } from '@/lib/usePerfomanceOptimiser';
import { isMeetStaging } from '@/lib/client-utils';

const AGENT_PARTICIPANT_ID =
  process.env.NEXT_PUBLIC_AGENT_PARTICIPANT_ID && process.env.NEXT_PUBLIC_AGENT_PARTICIPANT_ID.trim()
    ? process.env.NEXT_PUBLIC_AGENT_PARTICIPANT_ID.trim()
    : 'mediator';

export function VideoConferenceClientImpl(props: {
  liveKitUrl: string;
  token: string;
  codec: VideoCodec | undefined;
}) {
  const keyProvider = new ExternalE2EEKeyProvider();
  const { worker, e2eePassphrase } = useSetupE2EE();
  const e2eeEnabled = !!(e2eePassphrase && worker);

  const [e2eeSetupComplete, setE2eeSetupComplete] = useState(false);

  const roomOptions = useMemo((): RoomOptions => {
    return {
      publishDefaults: {
        videoSimulcastLayers: [VideoPresets.h540, VideoPresets.h216],
        red: !e2eeEnabled,
        videoCodec: props.codec,
      },
      adaptiveStream: { pixelDensity: 'screen' },
      dynacast: true,
      e2ee: e2eeEnabled
        ? {
            keyProvider,
            worker,
          }
        : undefined,
      singlePeerConnection: isMeetStaging(),
    };
  }, [e2eeEnabled, props.codec, keyProvider, worker]);

  const room = useMemo(() => new Room(roomOptions), [roomOptions]);

  const connectOptions = useMemo((): RoomConnectOptions => {
    return {
      autoSubscribe: false,
    };
  }, []);

  useEffect(() => {
    if (e2eeEnabled) {
      keyProvider.setKey(e2eePassphrase).then(() => {
        room.setE2EEEnabled(true).then(() => {
          setE2eeSetupComplete(true);
        });
      });
    } else {
      setE2eeSetupComplete(true);
    }
  }, [e2eeEnabled, e2eePassphrase, keyProvider, room, setE2eeSetupComplete]);

  useEffect(() => {
    let isCancelled = false;

    const ensureAudioSubscription = (publication: RemoteTrackPublication) => {
      if (!publication) {
        return;
      }
      if (publication.kind === 'audio') {
        publication.setSubscribed(true).catch((error) => console.error(error));
      } else if (publication.kind === 'video') {
        publication.setSubscribed(false).catch(() => {
          /* no-op */
        });
      }
    };

    const handleTrackPublished = (_participant: any, publication: RemoteTrackPublication) => {
      ensureAudioSubscription(publication);
    };

    room.on(RoomEvent.TrackPublished, handleTrackPublished);

    const connectAndConfigure = async () => {
      if (!e2eeSetupComplete) {
        return;
      }

      try {
        await room.connect(props.liveKitUrl, props.token, connectOptions);

        if (isCancelled) {
          return;
        }

        await room.localParticipant.setTrackSubscriptionPermissions({
          allParticipantsAllowed: false,
          trackPermissions: [
            {
              participantIdentity: AGENT_PARTICIPANT_ID,
              allTracks: true,
            },
            {
              trackType: 'audio',
            },
          ],
        });

        if (isCancelled) {
          return;
        }

        await room.localParticipant.enableCameraAndMicrophone();

        room.remoteParticipants.forEach((participant) => {
          participant.trackPublications.forEach((publication) => {
            ensureAudioSubscription(publication);
          });
        });
      } catch (error) {
        console.error(error);
      }
    };

    connectAndConfigure();

    return () => {
      isCancelled = true;
      room.off(RoomEvent.TrackPublished, handleTrackPublished);
    };
  }, [room, props.liveKitUrl, props.token, connectOptions, e2eeSetupComplete]);

  useLowCPUOptimizer(room);

  return (
    <div className="lk-room-container">
      <RoomContext.Provider value={room}>
        <KeyboardShortcuts />
        <VideoConference
          chatMessageFormatter={formatChatMessageLinks}
          SettingsComponent={
            process.env.NEXT_PUBLIC_SHOW_SETTINGS_MENU === 'true' ? SettingsMenu : undefined
          }
        />
        <DebugMode logLevel={LogLevel.debug} />
      </RoomContext.Provider>
    </div>
  );
}
