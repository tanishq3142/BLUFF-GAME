// WebRTC Peer-to-Peer Voice Mesh for Bluff Game
// Enables in-browser voice chat with mute/unmute and live speaking volume indicators

class VoiceChatManager {
  constructor(socketClient) {
    this.wsClient = socketClient;
    this.localStream = null;
    this.peers = new Map(); // peerId -> { pc, audioEl }
    this.isMuted = true;
    this.audioContext = null;
    this.analyser = null;
    this.myId = null;
    this.isSpeaking = false;
    this.speakingInterval = null;

    // Public STUN servers for NAT traversal
    this.rtcConfig = {
      iceServers: [
        { urls: 'stun:stun.l.google.com:19302' },
        { urls: 'stun:stun1.l.google.com:19302' },
        { urls: 'stun:stun2.l.google.com:19302' }
      ]
    };
  }

  setMyId(id) {
    this.myId = id;
  }

  async initMicrophone() {
    try {
      this.localStream = await navigator.mediaDevices.getUserMedia({
        audio: {
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true
        },
        video: false
      });

      // Initially mute mic track until unmuted by user
      this.setMicrophoneEnabled(false);
      this.setupSpeakingDetector();
      return { success: true };
    } catch (err) {
      console.warn('Microphone access not available or denied:', err.message);
      return { success: false, error: err.message };
    }
  }

  setMicrophoneEnabled(enabled) {
    this.isMuted = !enabled;
    if (this.localStream) {
      this.localStream.getAudioTracks().forEach(track => {
        track.enabled = enabled;
      });
    }

    // Broadcast voice mute state to server
    this.wsClient.send({
      type: 'VOICE_STATE',
      payload: {
        isMuted: this.isMuted,
        isSpeaking: false
      }
    });

    return enabled;
  }

  toggleMute() {
    return this.setMicrophoneEnabled(this.isMuted);
  }

  setupSpeakingDetector() {
    if (!this.localStream) return;
    try {
      const AudioCtx = window.AudioContext || window.webkitAudioContext;
      this.audioContext = new AudioCtx();
      const source = this.audioContext.createMediaStreamSource(this.localStream);
      this.analyser = this.audioContext.createAnalyser();
      this.analyser.fftSize = 256;
      source.connect(this.analyser);

      const dataArray = new Uint8Array(this.analyser.frequencyBinCount);

      if (this.speakingInterval) clearInterval(this.speakingInterval);

      this.speakingInterval = setInterval(() => {
        if (this.isMuted || !this.analyser) {
          if (this.isSpeaking) {
            this.isSpeaking = false;
            this.sendSpeakingState(false);
          }
          return;
        }

        this.analyser.getByteFrequencyData(dataArray);
        let sum = 0;
        for (let i = 0; i < dataArray.length; i++) {
          sum += dataArray[i];
        }
        const avg = sum / dataArray.length;
        const nowSpeaking = avg > 20; // speaking threshold

        if (nowSpeaking !== this.isSpeaking) {
          this.isSpeaking = nowSpeaking;
          this.sendSpeakingState(nowSpeaking);
        }
      }, 150);
    } catch (e) {
      console.warn('Speaking detector setup failed:', e);
    }
  }

  sendSpeakingState(speaking) {
    this.wsClient.send({
      type: 'VOICE_STATE',
      payload: {
        isMuted: this.isMuted,
        isSpeaking: speaking
      }
    });
    // Trigger local avatar indicator
    if (this.onLocalSpeaking) {
      this.onLocalSpeaking(speaking);
    }
  }

  // Connect to a new peer that joined room
  async connectToPeer(peerId) {
    if (this.peers.has(peerId) || peerId === this.myId) return;

    const pc = new RTCPeerConnection(this.rtcConfig);
    this.setupPeerEvents(pc, peerId);

    // Add local tracks
    if (this.localStream) {
      this.localStream.getTracks().forEach(track => {
        pc.addTrack(track, this.localStream);
      });
    }

    this.peers.set(peerId, { pc });

    try {
      const offer = await pc.createOffer();
      await pc.setLocalDescription(offer);

      this.wsClient.send({
        type: 'RTC_SIGNAL',
        payload: {
          targetId: peerId,
          signal: { type: 'offer', sdp: offer.sdp }
        }
      });
    } catch (err) {
      console.error(`Error creating offer for ${peerId}:`, err);
    }
  }

  // Handle incoming RTC signal (offer, answer, ice-candidate)
  async handleSignal(senderId, signal) {
    if (senderId === this.myId) return;

    let peerObj = this.peers.get(senderId);
    if (!peerObj) {
      const pc = new RTCPeerConnection(this.rtcConfig);
      this.setupPeerEvents(pc, senderId);

      if (this.localStream) {
        this.localStream.getTracks().forEach(track => {
          pc.addTrack(track, this.localStream);
        });
      }

      peerObj = { pc };
      this.peers.set(senderId, peerObj);
    }

    const { pc } = peerObj;

    try {
      if (signal.type === 'offer') {
        await pc.setRemoteDescription(new RTCSessionDescription(signal));
        const answer = await pc.createAnswer();
        await pc.setLocalDescription(answer);

        this.wsClient.send({
          type: 'RTC_SIGNAL',
          payload: {
            targetId: senderId,
            signal: { type: 'answer', sdp: answer.sdp }
          }
        });
      } else if (signal.type === 'answer') {
        await pc.setRemoteDescription(new RTCSessionDescription(signal));
      } else if (signal.candidate) {
        await pc.addIceCandidate(new RTCIceCandidate(signal.candidate));
      }
    } catch (err) {
      console.error(`Error handling signal from ${senderId}:`, err);
    }
  }

  setupPeerEvents(pc, peerId) {
    pc.onicecandidate = (event) => {
      if (event.candidate) {
        this.wsClient.send({
          type: 'RTC_SIGNAL',
          payload: {
            targetId: peerId,
            signal: { candidate: event.candidate }
          }
        });
      }
    };

    pc.ontrack = (event) => {
      let audioEl = document.getElementById(`audio-peer-${peerId}`);
      if (!audioEl) {
        audioEl = document.createElement('audio');
        audioEl.id = `audio-peer-${peerId}`;
        audioEl.autoplay = true;
        audioEl.style.display = 'none';
        document.body.appendChild(audioEl);
      }
      audioEl.srcObject = event.streams[0];
    };

    pc.onconnectionstatechange = () => {
      if (pc.connectionState === 'disconnected' || pc.connectionState === 'failed' || pc.connectionState === 'closed') {
        this.removePeer(peerId);
      }
    };
  }

  removePeer(peerId) {
    const peerObj = this.peers.get(peerId);
    if (peerObj) {
      try {
        peerObj.pc.close();
      } catch (e) {}
      this.peers.delete(peerId);
    }

    const audioEl = document.getElementById(`audio-peer-${peerId}`);
    if (audioEl) {
      audioEl.remove();
    }
  }

  closeAll() {
    this.peers.forEach((peerObj, peerId) => {
      this.removePeer(peerId);
    });
    if (this.speakingInterval) clearInterval(this.speakingInterval);
    if (this.localStream) {
      this.localStream.getTracks().forEach(t => t.stop());
    }
  }
}

window.VoiceChatManager = VoiceChatManager;
