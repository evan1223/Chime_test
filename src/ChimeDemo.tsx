import React, { useEffect, useState, useRef } from 'react';
import {
  ConsoleLogger,
  DefaultDeviceController,
  DefaultMeetingSession,
  LogLevel,
  MeetingSession,
  MeetingSessionConfiguration
} from 'amazon-chime-sdk-js';

export default function ChimeWithTranscribe() {
  const [meetingSession, setMeetingSession] = useState<MeetingSession | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [isConnected, setIsConnected] = useState(false);
  const [transcripts, setTranscripts] = useState<string[]>([]);
  const [latestTranscript, setLatestTranscript] = useState<string>('');
  const [isTranscribing, setIsTranscribing] = useState(false);
  const [microphoneDeviceId, setMicrophoneDeviceId] = useState<string | null>(null);

  const audioElement = useRef<HTMLAudioElement>(null);
  const webSocket = useRef<WebSocket | null>(null);
  const mediaRecorder = useRef<MediaRecorder | null>(null);
  const audioChunks = useRef<Blob[]>([]);

  // Set up Chime meeting
  useEffect(() => {
    async function setupChime() {
      try {
        setIsLoading(true);

        const response = await fetch('https://on9xktq34e.execute-api.us-east-1.amazonaws.com/api/chime/start');
        if (!response.ok) throw new Error(`API failed with status ${response.status}`);

        const data = await response.json();
        const { meetingResponse, attendeeResponse } = data;

        const logger = new ConsoleLogger('ChimeMVP', LogLevel.ERROR);
        const deviceController = new DefaultDeviceController(logger);
        const configuration = new MeetingSessionConfiguration(meetingResponse, attendeeResponse);
        const session = new DefaultMeetingSession(configuration, logger, deviceController);

        setMeetingSession(session);

        // Bind audio element for output
        if (audioElement.current) {
          await session.audioVideo.bindAudioElement(audioElement.current);
          console.log('✅ Audio element bound');
        }

        // Set up audio input (microphone)
        try {
          const audioInputDevices = await session.audioVideo.listAudioInputDevices();
          if (audioInputDevices.length > 0) {
            const deviceId = audioInputDevices[0].deviceId;
            await session.audioVideo.startAudioInput(deviceId);
            setMicrophoneDeviceId(deviceId);
            console.log('✅ Microphone selected:', audioInputDevices[0].label);
          }
        } catch (err) {
          console.warn('⚠️ Microphone access issue:', err);
        }

        // Set up audio output (speakers)
        try {
          const audioOutputDevices = await session.audioVideo.listAudioOutputDevices();
          if (audioOutputDevices.length > 0) {
            await session.audioVideo.chooseAudioOutput(audioOutputDevices[0].deviceId);
            console.log('✅ Speaker selected:', audioOutputDevices[0].label);
          }
        } catch (err) {
          console.warn('⚠️ Speaker selection issue:', err);
        }

        // Add observers for audio events
        session.audioVideo.addObserver({
          audioVideoDidStart: () => {
            console.log('✅ Audio connected successfully');
            setIsConnected(true);
            setError(null);
          },
          audioVideoDidStop: () => {
            console.log('🛑 Audio disconnected');
            setIsConnected(false);
            stopTranscription();
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
      stopTranscription();
    };
  }, []);

  // Start transcription when connected
  const startTranscription = async () => {
    if (!microphoneDeviceId || !isConnected) {
      setError('Microphone or connection not available');
      return;
    }

    try {
      // 1. Create WebSocket connection
      const ws = new WebSocket('wss://n3jip1fs7a.execute-api.us-east-1.amazonaws.com/production');
      ws.onopen = () => {
        console.log('WebSocket connection established');
        setIsTranscribing(true);
        startAudioCapture(ws);
      };

      ws.onmessage = (event) => {
        try {
          const data = JSON.parse(event.data);
          if (data.type === 'transcript') {
            if (!data.isPartial) {
              // Add complete utterance to transcript history
              setTranscripts(prev => [...prev, data.transcript]);
            }
            // Update latest transcript regardless if partial or complete
            setLatestTranscript(data.transcript);
          }
        } catch (err) {
          console.error('Error processing transcript:', err);
        }
      };

      ws.onerror = (error) => {
        console.error('WebSocket error:', error);
        setError('Transcription service error');
        setIsTranscribing(false);
      };

      ws.onclose = () => {
        console.log('WebSocket connection closed');
        setIsTranscribing(false);
      };

      webSocket.current = ws;
    } catch (err) {
      console.error('Failed to start transcription:', err);
      setError('Failed to start transcription');
    }
  };

  // Stop transcription
  const stopTranscription = () => {
    if (mediaRecorder.current && mediaRecorder.current.state !== 'inactive') {
      mediaRecorder.current.stop();
    }

    if (webSocket.current) {
      if (webSocket.current.readyState === WebSocket.OPEN) {
        webSocket.current.close();
      }
      webSocket.current = null;
    }

    setIsTranscribing(false);
    // That's it! No additional code needed here
  };
  // Capture audio for transcription
  const startAudioCapture = async (ws: WebSocket) => {
    try {
      if (!microphoneDeviceId) return;

      // Get audio stream
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: { deviceId: { exact: microphoneDeviceId } }
      });

      // Create MediaRecorder to capture audio
      const options = { mimeType: 'audio/webm' };
      const recorder = new MediaRecorder(stream, options);
      audioChunks.current = [];

      recorder.ondataavailable = (event) => {
        if (event.data.size > 0) {
          audioChunks.current.push(event.data);
        }

        // Convert blob to base64 and send to WebSocket
        const blob = new Blob(audioChunks.current, { type: 'audio/webm' });
        audioChunks.current = []; // Reset for next chunk

        // Only send if connection is open
        if (ws.readyState === WebSocket.OPEN) {
          const reader = new FileReader();
          reader.onloadend = () => {
            const base64data = (reader.result as string).split(',')[1];
            ws.send(JSON.stringify({
              action: 'startTranscription',
              audioData: base64data,
              languageCode: 'en-US'
            }));
          };
          reader.readAsDataURL(blob);
        }
      };

      // Start recording in 250ms chunks
      recorder.start(250);
      mediaRecorder.current = recorder;

    } catch (err) {
      console.error('Error capturing audio:', err);
      setError('Error capturing audio for transcription');
      setIsTranscribing(false);
    }
  };

  // Toggle transcription on/off
  const toggleTranscription = () => {
    if (isTranscribing) {
      stopTranscription();
    } else {
      startTranscription();
    }
  };

  return (
    <div style={{ padding: '2rem', maxWidth: '800px', margin: '0 auto' }}>
      <h1>Voice Chat with Real-time Transcription</h1>

      {/* Connection Status */}
      <div style={{
        padding: '15px',
        backgroundColor: isConnected ? '#e6f7e6' : '#f7e6e6',
        borderRadius: '8px',
        marginBottom: '20px',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between'
        }}>
        <div>
          <h2 style={{ margin: '0 0 10px 0' }}>
            {isConnected ? '🎤 Voice Connected' : '⏳ Connecting Voice...'}
          </h2>
          <p style={{ margin: '0' }}>
            {isConnected ? 'Voice chat is active.' : 'Establishing voice connection...'}
          </p>
        </div>

        {isConnected && (
          <button
            onClick={toggleTranscription}
            style={{
              backgroundColor: isTranscribing ? '#f44336' : '#4CAF50',
              border: 'none',
              color: 'white',
              padding: '10px 15px',
              borderRadius: '4px',
              cursor: 'pointer',
              fontSize: '16px'
            }}
          >
            {isTranscribing ? 'Stop Transcription' : 'Start Transcription'}
          </button>
        )}
      </div>

      {/* Hidden audio element */}
      <audio ref={audioElement} style={{ display: 'none' }} />

      {/* Loading and Error States */}
      {isLoading && (
        <div style={{ 
          padding: '20px', 
          textAlign: 'center', 
          backgroundColor: '#f0f0f0',
          borderRadius: '8px'
          }}>
          <div className="spinner" style={{
            border: '4px solid rgba(0, 0, 0, 0.1)',
            borderLeft: '4px solid #3498db',
            borderRadius: '50%',
            width: '30px',
            height: '30px',
            animation: 'spin 1s linear infinite',
            margin: '0 auto'
            }} />
          <p>Loading voice resources...</p>
          <style>{`
            @keyframes spin {
              0% { transform: rotate(0deg); }
              100% { transform: rotate(360deg); }
            }
            `}</style>
        </div>
      )}

      {error && (
        <div style={{ 
          backgroundColor: '#ffebee', 
          color: '#d32f2f',
          padding: '15px',
          borderRadius: '8px',
          marginTop: '20px' 
          }}>
          <h3 style={{ margin: '0 0 10px 0' }}>Error</h3>
          <p>{error}</p>
          <button 
            onClick={() => window.location.reload()}
            style={{ 
              backgroundColor: '#d32f2f',
              border: 'none',
              color: 'white',
              padding: '8px 16px',
              borderRadius: '4px',
              cursor: 'pointer'
            }}
          >
            Retry Connection
          </button>
        </div>
      )}

      {/* Live Transcription Display */}
      {isConnected && (
        <div style={{ marginTop: '30px' }}>
          <h2>Live Transcription</h2>

          {/* Current transcription */}
          {isTranscribing ? (
            <div style={{ 
              backgroundColor: '#f0f7ff', 
              padding: '15px', 
              borderRadius: '8px',
              minHeight: '60px',
              display: 'flex',
              alignItems: 'center'
              }}>
              <div style={{ marginRight: '15px', color: '#2196F3' }}>
                <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="currentColor">
                  <path d="M12 14c1.66 0 3-1.34 3-3V5c0-1.66-1.34-3-3-3S9 3.34 9 5v6c0 1.66 1.34 3 3 3z"/>
                  <path d="M17 11c0 2.76-2.24 5-5 5s-5-2.24-5-5H5c0 3.53 2.61 6.43 6 6.92V21h2v-3.08c3.39-.49 6-3.39 6-6.92h-2z"/>
                </svg>
              </div>
              <p style={{ fontSize: '18px', margin: 0 }}>
                {latestTranscript || "Listening..."}
              </p>
            </div>
          ) : (
            <div style={{ 
              backgroundColor: '#f5f5f5', 
              padding: '15px', 
              borderRadius: '8px',
              minHeight: '60px',
              display: 'flex',
              alignItems: 'center',
              color: '#757575'
              }}>
              <div style={{ marginRight: '15px' }}>
                <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="currentColor">
                  <path d="M19 11h-1.7c0 .74-.16 1.43-.43 2.05l1.23 1.23c.56-.98.9-2.09.9-3.28zm-4.02.17c0-.06.02-.11.02-.17V5c0-1.66-1.34-3-3-3S9 3.34 9 5v6c0 .06.02.11.02.17L5 17h14l-4.02-5.83zM12 22c1.1 0 2-.9 2-2h-4c0 1.1.9 2 2 2zm-5-3h10v-2H7v2z"/>
                </svg>
              </div>
              <p style={{ fontSize: '18px', margin: 0 }}>
                Transcription inactive. Click "Start Transcription" to begin.
              </p>
            </div>
          )}

          {/* Transcription History */}
          {transcripts.length > 0 && (
            <div style={{ marginTop: '20px' }}>
              <h3>Transcript History</h3>
              <div style={{
                maxHeight: '300px',
                overflowY: 'auto',
                border: '1px solid #e0e0e0',
                borderRadius: '8px',
                padding: '10px'
                }}>
                {transcripts.map((text, index) => (
                  <p key={index} style={{
                    padding: '8px',
                    margin: '5px 0',
                    backgroundColor: index % 2 === 0 ? '#f9f9f9' : 'white',
                    borderRadius: '4px'
                    }}>
                    {text}
                  </p>
                ))}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
