import React, { useEffect, useState, useRef } from 'react';
import {
  ConsoleLogger,
  DefaultDeviceController,
  DefaultMeetingSession,
  LogLevel,
  MeetingSession,
  MeetingSessionConfiguration,
  DefaultActiveSpeakerPolicy,
  MeetingSessionStatusCode
} from 'amazon-chime-sdk-js';

export default function ChimeDemo() {
  const [meetingSession, setMeetingSession] = useState<MeetingSession | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [isConnected, setIsConnected] = useState(false);
  const audioElement = useRef<HTMLAudioElement>(null);

  useEffect(() => {
    async function setupChime() {
      try {
        setIsLoading(true);

        // Call your Lambda + API Gateway
        const response = await fetch('https://on9xktq34e.execute-api.us-east-1.amazonaws.com/api/chime/start');
        if (!response.ok) {
          throw new Error(`API failed with status ${response.status}`);
        }

        const data = await response.json();
        const { meetingResponse, attendeeResponse } = data;

        // Create logger and device controller with ERROR level to reduce logging
        const logger = new ConsoleLogger('ChimeLogs', LogLevel.ERROR);
        const deviceController = new DefaultDeviceController(logger);

        // Create and configure the meeting session
        const configuration = new MeetingSessionConfiguration(meetingResponse, attendeeResponse);
        
        const session = new DefaultMeetingSession(configuration, logger, deviceController);
        setMeetingSession(session);

        // Bind audio element for output
        if (audioElement.current) {
          await session.audioVideo.bindAudioElement(audioElement.current);
          console.log('✅ Audio element bound successfully');
        }

        // Set up audio input (microphone)
        try {
          const audioInputDevices = await session.audioVideo.listAudioInputDevices();
          if (audioInputDevices.length > 0) {
            await session.audioVideo.chooseAudioInputDevice(audioInputDevices[0].deviceId);
            console.log('✅ Microphone selected:', audioInputDevices[0].label);
          }
        } catch (err) {
          console.warn('⚠️ Microphone access issue:', err);
        }

        // Set up audio output (speakers)
        try {
          const audioOutputDevices = await session.audioVideo.listAudioOutputDevices();
          if (audioOutputDevices.length > 0) {
            await session.audioVideo.chooseAudioOutputDevice(audioOutputDevices[0].deviceId);
            console.log('✅ Speaker selected:', audioOutputDevices[0].label);
          }
        } catch (err) {
          console.warn('⚠️ Speaker selection issue:', err);
        }

        // Add observer for basic audio events with proper error handling
        session.audioVideo.addObserver({
          audioVideoDidStart: () => {
            console.log('✅ Audio connected successfully');
            setIsConnected(true);
            setError(null); // Clear any previous errors
          },
          audioVideoDidStop: (sessionStatus) => {
            console.log('🛑 Audio disconnected', sessionStatus);
            setIsConnected(false);
            
            // Handle errors through the sessionStatus
            if (sessionStatus.statusCode() !== MeetingSessionStatusCode.OK) {
              const errorMessage = `Connection error: ${sessionStatus.statusCode()}`;
              console.error(errorMessage);
              setError(errorMessage);
            }
          },
          audioVideoDidStartConnecting: (reconnecting) => {
            if (reconnecting) {
              console.log('Attempting to reconnect...');
            }
          },
          // Add any other standard observer methods as needed
          connectionDidBecomePoor: () => {
            console.warn('⚠️ Connection quality is poor');
          },
          connectionDidSuggestStopVideo: () => {
            console.warn('⚠️ Connection suggests stopping video');
          }
        });

        // Properly implement the active speaker detector
        const activeSpeakerPolicy = new DefaultActiveSpeakerPolicy();
        session.audioVideo.subscribeToActiveSpeakerDetector(
          activeSpeakerPolicy,
          (activeSpeakers) => {
            if (activeSpeakers.length > 0) {
              console.log('Active speakers:', activeSpeakers);
            }
          }
        );

        // Try to intercept WebRTC errors with a monkey patch on the prototype
        try {
          const originalGetRTCStats = session.audioVideo.getRTCPeerConnectionStats;
          if (originalGetRTCStats) {
            // @ts-ignore - We're deliberately overriding this method
            session.audioVideo.getRTCPeerConnectionStats = async () => {
              try {
                return await originalGetRTCStats.call(session.audioVideo);
              } catch (err) {
                console.warn('Stats collection error (suppressed):', err);
                return new Map();
              }
            };
          }
        } catch (err) {
          console.warn('Could not patch stats collection:', err);
        }
        
        // Add a small delay before starting
        setTimeout(() => {
          try {
            session.audioVideo.start();
            console.log('🎯 Starting audio connection...');
          } catch (err) {
            console.error('Failed to start session:', err);
            setError('Failed to start audio session');
          }
        }, 1000);
        
      } catch (err: any) {
        console.error('❌ Error setting up audio:', err);
        setError(err.message || 'Unknown error');
      } finally {
        setIsLoading(false);
      }
    }

    setupChime();

    // Clean up when component unmounts
    return () => {
      if (meetingSession) {
        try {
          meetingSession.audioVideo.stop();
          console.log('🛑 Audio session stopped');
        } catch (err) {
          console.error('Error stopping session:', err);
        }
      }
    };
  }, []);

  return (
    <div style={{ padding: '2rem' }}>
      <h2>{isConnected ? '🎤 已連上語音服務' : '⏳ 正在連接語音服務...'}</h2>
      <p>{isConnected ? '目前正在語音通話中。' : '正在建立語音連接...'}</p>

      <audio ref={audioElement} style={{ display: 'none' }} />

      {isLoading && <div>Loading meeting resources...</div>}
      {error && <div style={{ color: 'red' }}>Error: {error}</div>}
      
      {/* Add retry button when connection fails */}
      {error && !isLoading && (
        <button 
          onClick={() => window.location.reload()}
          style={{ 
            marginTop: '10px',
            padding: '8px 16px',
            backgroundColor: '#4CAF50',
            color: 'white',
            border: 'none',
            borderRadius: '4px',
            cursor: 'pointer'
          }}
        >
          Retry Connection
        </button>
      )}
    </div>
  );
}
