// App.js
import React, { useState, useEffect, useRef } from 'react';
import {
  View,
  StyleSheet,
  Dimensions,
  Text,
  TouchableOpacity,
  Alert,
  Platform
} from 'react-native';
import { Video } from 'expo-av';
import * as FileSystem from 'expo-file-system';
import { StatusBar } from 'expo-status-bar';

// ASS Parser Component
class ASSParser {
  constructor(assContent) {
    this.assContent = assContent;
    this.styles = {};
    this.events = [];
    this.parseASS();
  }

  parseASS() {
    const lines = this.assContent.split('\n');
    let currentSection = null;

    for (let line of lines) {
      line = line.trim();
      
      if (line.startsWith('[') && line.endsWith(']')) {
        currentSection = line.slice(1, -1).toLowerCase();
        continue;
      }

      if (currentSection === 'v4+ styles' && line.startsWith('Style:')) {
        this.parseStyle(line);
      } else if (currentSection === 'events' && line.startsWith('Dialogue:')) {
        this.parseDialogue(line);
      }
    }

    // Sort events by start time
    this.events.sort((a, b) => a.start - b.start);
  }

  parseStyle(line) {
    const parts = line.replace('Style:', '').split(',');
    if (parts.length >= 16) {
      const style = {
        name: parts[0].trim(),
        fontName: parts[1].trim(),
        fontSize: parseInt(parts[2]) || 16,
        primaryColour: this.parseColor(parts[3]),
        secondaryColour: this.parseColor(parts[4]),
        outlineColour: this.parseColor(parts[5]),
        backColour: this.parseColor(parts[6]),
        bold: parts[7] === '-1',
        italic: parts[8] === '-1',
        underline: parts[9] === '-1',
        strikeOut: parts[10] === '-1',
        scaleX: parseFloat(parts[11]) || 100,
        scaleY: parseFloat(parts[12]) || 100,
        spacing: parseFloat(parts[13]) || 0,
        angle: parseFloat(parts[14]) || 0,
        borderStyle: parseInt(parts[15]) || 1,
        outline: parseFloat(parts[16]) || 0,
        shadow: parseFloat(parts[17]) || 0,
        alignment: parseInt(parts[18]) || 2,
        marginL: parseInt(parts[19]) || 0,
        marginR: parseInt(parts[20]) || 0,
        marginV: parseInt(parts[21]) || 0,
      };
      this.styles[style.name] = style;
    }
  }

  parseDialogue(line) {
    const parts = line.replace('Dialogue:', '').split(',');
    if (parts.length >= 10) {
      const event = {
        layer: parseInt(parts[0]) || 0,
        start: this.parseTime(parts[1].trim()),
        end: this.parseTime(parts[2].trim()),
        style: parts[3].trim(),
        name: parts[4].trim(),
        marginL: parseInt(parts[5]) || 0,
        marginR: parseInt(parts[6]) || 0,
        marginV: parseInt(parts[7]) || 0,
        effect: parts[8].trim(),
        text: parts.slice(9).join(',').trim()
      };
      this.events.push(event);
    }
  }

  parseTime(timeStr) {
    // Parse ASS time format: H:MM:SS.CC
    const parts = timeStr.split(':');
    if (parts.length !== 3) return 0;
    
    const hours = parseInt(parts[0]) || 0;
    const minutes = parseInt(parts[1]) || 0;
    const seconds = parseFloat(parts[2]) || 0;
    
    return (hours * 3600 + minutes * 60 + seconds) * 1000; // Convert to milliseconds
  }

  parseColor(colorStr) {
    // ASS colors are in &Hbbggrr& format or decimal
    if (colorStr.startsWith('&H') && colorStr.endsWith('&')) {
      const hex = colorStr.slice(2, -1);
      // Convert BGR to RGB
      const b = parseInt(hex.substr(0, 2), 16);
      const g = parseInt(hex.substr(2, 2), 16);
      const r = parseInt(hex.substr(4, 2), 16);
      return `rgb(${r}, ${g}, ${b})`;
    }
    return '#ffffff'; // Default white
  }

  getActiveSubtitles(currentTime) {
    return this.events.filter(event => 
      currentTime >= event.start && currentTime <= event.end
    );
  }
}

// Subtitle Renderer Component
const SubtitleRenderer = ({ subtitle, style, screenDimensions }) => {
  const getTextStyle = () => {
    if (!style) return { color: 'white', fontSize: 16 };

    return {
      color: style.primaryColour || 'white',
      fontSize: style.fontSize || 16,
      fontWeight: style.bold ? 'bold' : 'normal',
      fontStyle: style.italic ? 'italic' : 'normal',
      textDecorationLine: style.underline ? 'underline' : 'none',
      textShadowColor: style.outlineColour || 'black',
      textShadowOffset: { width: 1, height: 1 },
      textShadowRadius: style.outline || 1,
      marginLeft: style.marginL || 0,
      marginRight: style.marginR || 0,
    };
  };

  const getPositionStyle = () => {
    if (!style) return {};

    const alignment = style.alignment || 2;
    let textAlign = 'center';
    let alignSelf = 'center';

    // ASS alignment: 1-3 (bottom), 4-6 (middle), 7-9 (top)
    // 1,4,7 = left, 2,5,8 = center, 3,6,9 = right
    if ([1, 4, 7].includes(alignment)) {
      textAlign = 'left';
      alignSelf = 'flex-start';
    } else if ([3, 6, 9].includes(alignment)) {
      textAlign = 'right';
      alignSelf = 'flex-end';
    }

    return {
      textAlign,
      alignSelf,
      width: '100%',
    };
  };

  // Remove ASS formatting tags for display
  const cleanText = (text) => {
    return text
      .replace(/\{[^}]*\}/g, '') // Remove override tags
      .replace(/\\N/g, '\n')     // Convert line breaks
      .replace(/\\n/g, '\n');    // Convert line breaks
  };

  return (
    <Text style={[getTextStyle(), getPositionStyle()]}>
      {cleanText(subtitle.text)}
    </Text>
  );
};

// Main Video Player Component
export default function App() {
  const [video, setVideo] = useState(null);
  const [status, setStatus] = useState({});
  const [subtitles, setSubtitles] = useState([]);
  const [assParser, setAssParser] = useState(null);
  const [screenData, setScreenData] = useState(Dimensions.get('window'));
  const videoRef = useRef(null);

  const VIDEO_URL = 'https://juxwcxgddeihfinsxxlz.supabase.co/storage/v1/object/public/ig/video.mp4';
  const SUBTITLE_URL = 'https://juxwcxgddeihfinsxxlz.supabase.co/storage/v1/object/public/ig/subtitles.ass'; 

  useEffect(() => {
    loadSubtitles();
    
    const subscription = Dimensions.addEventListener('change', ({ window }) => {
      setScreenData(window);
    });

    return () => subscription?.remove();
  }, []);

  const loadSubtitles = async () => {
    try {
      console.log('Loading subtitles from:', SUBTITLE_URL);
      
      // Fetch the ASS file from the URL
      const response = await fetch(SUBTITLE_URL);
      
      if (!response.ok) {
        throw new Error(`HTTP error! status: ${response.status}`);
      }
      
      const assContent = await response.text();
      console.log('ASS content loaded, length:', assContent.length);
      
      if (!assContent || assContent.trim().length === 0) {
        throw new Error('Empty subtitle file');
      }
      
      const parser = new ASSParser(assContent);
      setAssParser(parser);
      
      console.log('ASS parser created with', parser.events.length, 'events and', Object.keys(parser.styles).length, 'styles');
      
    } catch (error) {
      console.error('Error loading subtitles:', error);
      Alert.alert('Error', `Failed to load subtitles: ${error.message}`);
      
      // Optional: You can still create a fallback parser with empty content
      // const fallbackParser = new ASSParser('');
      // setAssParser(fallbackParser);
    }
  };

  const updateSubtitles = (playbackStatus) => {
    if (!assParser || !playbackStatus.positionMillis) return;

    const currentTime = playbackStatus.positionMillis;
    const activeSubtitles = assParser.getActiveSubtitles(currentTime);
    setSubtitles(activeSubtitles);
  };

  const handlePlaybackStatusUpdate = (playbackStatus) => {
    setStatus(playbackStatus);
    if (playbackStatus.isLoaded) {
      updateSubtitles(playbackStatus);
    }
  };

  const togglePlayPause = () => {
    if (status.isPlaying) {
      videoRef.current?.pauseAsync();
    } else {
      videoRef.current?.playAsync();
    }
  };

  const seekVideo = (seconds) => {
    if (status.isLoaded && status.durationMillis) {
      const newPosition = Math.max(0, Math.min(
        (status.positionMillis || 0) + (seconds * 1000),
        status.durationMillis
      ));
      videoRef.current?.setPositionAsync(newPosition);
    }
  };

  const formatTime = (milliseconds) => {
    if (!milliseconds) return '0:00';
    const totalSeconds = Math.floor(milliseconds / 1000);
    const minutes = Math.floor(totalSeconds / 60);
    const seconds = totalSeconds % 60;
    return `${minutes}:${seconds.toString().padStart(2, '0')}`;
  };

  return (
    <View style={styles.container}>
      <StatusBar style="light" />
      
      {/* Video Player */}
      <View style={styles.videoContainer}>
        <Video
          ref={videoRef}
          style={[styles.video, { 
            width: screenData.width, 
            height: screenData.width * (9/16) // 16:9 aspect ratio
          }]}
          source={{ uri: VIDEO_URL }}
          useNativeControls={false}
          resizeMode="contain"
          isLooping={false}
          onPlaybackStatusUpdate={handlePlaybackStatusUpdate}
          shouldPlay={false}
        />
        
        {/* Subtitle Overlay */}
        <View style={styles.subtitleContainer}>
          {subtitles.map((subtitle, index) => (
            <SubtitleRenderer
              key={`${subtitle.start}-${index}`}
              subtitle={subtitle}
              style={assParser?.styles[subtitle.style]}
              screenDimensions={screenData}
            />
          ))}
        </View>
      </View>

      {/* Custom Controls */}
      <View style={styles.controlsContainer}>
        <View style={styles.progressContainer}>
          <Text style={styles.timeText}>
            {formatTime(status.positionMillis)} / {formatTime(status.durationMillis)}
          </Text>
        </View>
        
        <View style={styles.buttonContainer}>
          <TouchableOpacity 
            style={styles.button} 
            onPress={() => seekVideo(-10)}
          >
            <Text style={styles.buttonText}>⏪ 10s</Text>
          </TouchableOpacity>
          
          <TouchableOpacity 
            style={styles.playButton} 
            onPress={togglePlayPause}
          >
            <Text style={styles.playButtonText}>
              {status.isPlaying ? '⏸️' : '▶️'}
            </Text>
          </TouchableOpacity>
          
          <TouchableOpacity 
            style={styles.button} 
            onPress={() => seekVideo(10)}
          >
            <Text style={styles.buttonText}>10s ⏩</Text>
          </TouchableOpacity>
        </View>
      </View>

      {/* Debug Info */}
      <View style={styles.debugContainer}>
        <Text style={styles.debugText}>
          Active Subtitles: {subtitles.length}
        </Text>
        <Text style={styles.debugText}>
          Total Events: {assParser ? assParser.events.length : 0}
        </Text>
        <Text style={styles.debugText}>
          Platform: {Platform.OS}
        </Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#000',
    justifyContent: 'center',
  },
  videoContainer: {
    position: 'relative',
    alignItems: 'center',
  },
  video: {
    backgroundColor: '#000',
  },
  subtitleContainer: {
    position: 'absolute',
    bottom: 20,
    left: 20,
    right: 20,
    alignItems: 'center',
    zIndex: 1,
  },
  controlsContainer: {
    padding: 20,
    backgroundColor: '#1a1a1a',
  },
  progressContainer: {
    alignItems: 'center',
    marginBottom: 15,
  },
  timeText: {
    color: 'white',
    fontSize: 14,
  },
  buttonContainer: {
    flexDirection: 'row',
    justifyContent: 'space-around',
    alignItems: 'center',
  },
  button: {
    backgroundColor: '#333',
    padding: 12,
    borderRadius: 8,
    minWidth: 80,
    alignItems: 'center',
  },
  buttonText: {
    color: 'white',
    fontSize: 14,
    fontWeight: 'bold',
  },
  playButton: {
    backgroundColor: '#007AFF',
    padding: 15,
    borderRadius: 30,
    minWidth: 60,
    alignItems: 'center',
  },
  playButtonText: {
    fontSize: 18,
  },
  debugContainer: {
    padding: 10,
    backgroundColor: '#2a2a2a',
  },
  debugText: {
    color: '#ccc',
    fontSize: 12,
    textAlign: 'center',
  },
});
