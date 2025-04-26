import React, { useEffect, useState, useRef } from 'react';
import {
  ConsoleLogger,
  DefaultDeviceController,
  DefaultMeetingSession,
  LogLevel,
  MeetingSession,
  MeetingSessionConfiguration
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
        if (!response.ok) throw new Error(`API failed with status ${response.status}`);

        const data = await response.json();
        const { meetingResponse, attendeeResponse } = data;

        // Create logger with ERROR level
        const logger = new ConsoleLogger('ChimeMVP', LogLevel.ERROR);
        const deviceController = new DefaultDeviceController(logger);

        // Create the meeting configuration
        const configuration = new MeetingSessionConfiguration(meetingResponse, attendeeResponse);

        // Create the meeting session with updated config
        const session = new DefaultMeetingSession(configuration, logger, deviceController);
        setMeetingSession(session);

        // Bind audio element for output
        if (audioElement.current) {
          await session.audioVideo.bindAudioElement(audioElement.current);
          console.log('✅ Audio element bound');
        }

        // Set up audio input (microphone) - FIXED METHOD NAME
        try {
          const audioInputDevices = await session.audioVideo.listAudioInputDevices();
          if (audioInputDevices.length > 0) {
            // FIXED: using the correct method name for v3.27.1
            await session.audioVideo.startAudioInput(audioInputDevices[0].deviceId);
            console.log('✅ Microphone selected:', audioInputDevices[0].label);
          }
        } catch (err) {
          console.warn('⚠️ Microphone access issue:', err);
        }

        // Set up audio output (speakers) - FIXED METHOD NAME
        try {
          const audioOutputDevices = await session.audioVideo.listAudioOutputDevices();
          if (audioOutputDevices.length > 0) {
            // FIXED: using the correct method name for v3.27.1
            await session.audioVideo.chooseAudioOutput(audioOutputDevices[0].deviceId);
            console.log('✅ Speaker selected:', audioOutputDevices[0].label);
          }
        } catch (err) {
          console.warn('⚠️ Speaker selection issue:', err);
        }

        // Add observer for basic audio events
        session.audioVideo.addObserver({
          audioVideoDidStart: () => {
            console.log('✅ Audio connected successfully');
            setIsConnected(true);
            setError(null);
          },
          audioVideoDidStop: () => {
            console.log('🛑 Audio disconnected');
            setIsConnected(false);
          },
          audioVideoDidStartConnecting: (reconnecting) => {
            console.log(reconnecting ? 'Reconnecting...' : 'Connecting...');
          }
        });

        // Start the meeting
        session.audioVideo.start();
        console.log('🎯 Starting audio connection');
        
      } catch (err: any) {
        console.error('❌ Setup error:', err);
        setError(err.message || 'Unknown error');
      } finally {
        setIsLoading(false);
      }
    }

    setupChime();

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
      <h2>{isConnected ? '🎤 Voice Connected' : '⏳ Connecting Voice...'}</h2>
      <p>{isConnected ? 'Voice chat is active.' : 'Establishing voice connection...'}</p>

      <audio ref={audioElement} style={{ display: 'none' }} />

      {isLoading && <div>Loading voice resources...</div>}
      {error && (
        <div style={{ color: 'red', marginTop: '10px' }}>
          Error: {error}
          <button 
            onClick={() => window.location.reload()}
            style={{ 
              display: 'block', 
              marginTop: '10px',
              padding: '5px 10px'
            }}
          >
            Retry Connection
          </button>
        </div>
      )}
    </div>
  );
}
