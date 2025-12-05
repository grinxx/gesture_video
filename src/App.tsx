import { useState, useRef, useEffect, useCallback } from 'react';
import { GestureRecognizer, FilesetResolver, DrawingUtils } from "@mediapipe/tasks-vision";

// --- 1. 定义视频数据 (对应 public/videos/ 下的文件) ---
const VIDEOS = [
  { 
    id: 1, 
    url: "https://storage.googleapis.com/gtv-videos-bucket/sample/BigBuckBunny.mp4", 
    title: "Big Buck Bunny",
    desc: "经典的开源动画测试视频"
  },
  { 
    id: 2, 
    url: "https://storage.googleapis.com/gtv-videos-bucket/sample/ElephantsDream.mp4", 
    title: "Elephants Dream",
    desc: "3D 建模测试"
  },
  { 
    id: 3, 
    url: "https://storage.googleapis.com/gtv-videos-bucket/sample/ForBiggerBlazes.mp4", 
    title: "For Bigger Blazes",
    desc: "高清风景演示"
  },
  { 
    id: 4, 
    url: "https://storage.googleapis.com/gtv-videos-bucket/sample/TearsOfSteel.mp4", 
    title: "Tears of Steel",
    desc: "科幻实拍合成"
  },
];

const GestureController = ({ onSwipe, onStatus, debugMode }: any) => {
  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const lastYRef = useRef<number | null>(null);
  const isCooldownRef = useRef(false);
  const latestOnSwipe = useRef(onSwipe);
  const latestOnStatus = useRef(onStatus);

  useEffect(() => { latestOnSwipe.current = onSwipe; }, [onSwipe]);
  useEffect(() => { latestOnStatus.current = onStatus; }, [onStatus]);

  useEffect(() => {
    let gestureRecognizer: GestureRecognizer | null = null;
    let requestRef: number;
    let isMounted = true;

    const setup = async () => {
      latestOnStatus.current("正在初始化 AI 引擎...");
      try {
        const vision = await FilesetResolver.forVisionTasks("https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.3/wasm");
        if (!isMounted) return;

        gestureRecognizer = await GestureRecognizer.createFromOptions(vision, {
          baseOptions: {
            modelAssetPath: "https://storage.googleapis.com/mediapipe-models/gesture_recognizer/gesture_recognizer/float16/1/gesture_recognizer.task",
            delegate: "GPU"
          },
          runningMode: "VIDEO",
          numHands: 1
        });

        if (navigator.mediaDevices && navigator.mediaDevices.getUserMedia) {
          try {
            const stream = await navigator.mediaDevices.getUserMedia({ video: true });
            if (videoRef.current && isMounted) {
              videoRef.current.srcObject = stream;
              await videoRef.current.play().catch(() => {});
              latestOnStatus.current("✅ 准备就绪：请对着摄像头挥手");
              predictWebcam();
            }
          } catch (e) {
            if (isMounted) latestOnStatus.current("❌ 摄像头权限被拒绝");
          }
        }
      } catch (err: any) {
        if (isMounted) latestOnStatus.current(`❌ 错误: ${err.message}`);
      }
    };

    const predictWebcam = () => {
      if (!isMounted) return;
      if (gestureRecognizer && videoRef.current && canvasRef.current) {
        if (videoRef.current.videoWidth > 0) {
          const results = gestureRecognizer.recognizeForVideo(videoRef.current, Date.now());
          const ctx = canvasRef.current.getContext("2d");
          
          if (ctx && debugMode) {
              ctx.clearRect(0, 0, canvasRef.current.width, canvasRef.current.height);
              canvasRef.current.width = videoRef.current.videoWidth; 
              canvasRef.current.height = videoRef.current.videoHeight;
              
              if (results.landmarks.length > 0) {
                const hand = results.landmarks[0];
                const wrist = hand[0];
                const currY = wrist.y;

                const drawingUtils = new DrawingUtils(ctx);
                drawingUtils.drawConnectors(hand, GestureRecognizer.HAND_CONNECTIONS, { color: "#00FF00", lineWidth: 3 });
                drawingUtils.drawLandmarks(hand, { color: "#FF0000", lineWidth: 1 });

                if (lastYRef.current !== null && !isCooldownRef.current) {
                  const deltaY = currY - lastYRef.current;
                  const threshold = 0.08; 

                  if (deltaY < -threshold) {
                    latestOnSwipe.current('NEXT');
                    triggerCooldown();
                  } else if (deltaY > threshold) {
                    latestOnSwipe.current('PREV');
                    triggerCooldown();
                  }
                }
                lastYRef.current = currY;
              } else {
                 lastYRef.current = null;
              }
          }
        }
        requestRef = requestAnimationFrame(predictWebcam);
      }
    };

    const triggerCooldown = () => {
      isCooldownRef.current = true;
      if(canvasRef.current) canvasRef.current.style.borderColor = 'red';
      setTimeout(() => {
        if (!isMounted) return;
        isCooldownRef.current = false;
        lastYRef.current = null;
        if(canvasRef.current) canvasRef.current.style.borderColor = 'lime';
      }, 1200);
    };

    setup();

    return () => {
      isMounted = false;
      cancelAnimationFrame(requestRef);
      if(gestureRecognizer) gestureRecognizer.close();
      if (videoRef.current && videoRef.current.srcObject) {
          const stream = videoRef.current.srcObject as MediaStream;
          stream.getTracks().forEach(track => track.stop());
      }
    };
  }, [debugMode]);

  return (
    <>
      <video ref={videoRef} style={{ display: 'none' }} playsInline muted autoPlay />
      <canvas ref={canvasRef} style={{ 
        position: 'fixed', top: 20, right: 20, 
        width: '120px', height: '90px', 
        zIndex: 9999, border: '2px solid lime', 
        borderRadius: '8px', 
        backgroundColor: 'rgba(0,0,0,0.5)',
        transform: 'scaleX(-1)' 
      }} />
    </>
  );
};

export default function TikTokApp() {
  const [activeIndex, setActiveIndex] = useState(0);
  const [status, setStatus] = useState("初始化中...");
  const containerRef = useRef<HTMLDivElement>(null);
  const videoRefs = useRef<(HTMLVideoElement | null)[]>([]);

  const handleSwipe = useCallback((direction: 'NEXT' | 'PREV') => {
    setActiveIndex(prevIndex => {
        let newIndex = prevIndex;
        if (direction === 'NEXT' && prevIndex < VIDEOS.length - 1) {
          newIndex = prevIndex + 1;
        } else if (direction === 'PREV' && prevIndex > 0) {
          newIndex = prevIndex - 1;
        }
        
        if (newIndex !== prevIndex) {
            containerRef.current?.scrollTo({
                top: newIndex * window.innerHeight,
                behavior: 'smooth'
            });
        }
        return newIndex;
    });
  }, []);

  useEffect(() => {
    videoRefs.current.forEach((video, index) => {
      if (!video) return;
      if (index === activeIndex) {
        video.muted = false; 
        video.play().catch(e => {
            console.log("自动播放被拦截，尝试静音播放:", e);
            video.muted = true;
            video.play();
        });
      } else {
        video.pause();
        video.currentTime = 0;
      }
    });
  }, [activeIndex]);

  return (
    <div style={{ width: '100vw', height: '100vh', backgroundColor: '#000', overflow: 'hidden', position: 'relative' }}>
      
      <div style={{ 
        position: 'absolute', top: 20, left: 20, zIndex: 100, 
        background: 'rgba(0,0,0,0.6)', padding: '8px 15px', borderRadius: '30px',
        color: '#fff', fontWeight: 'bold', backdropFilter: 'blur(4px)', border: '1px solid rgba(255,255,255,0.2)'
      }}>
        🤖 {status}
      </div>

      <div 
        ref={containerRef}
        style={{ 
          width: '100%', height: '100%', overflowY: 'hidden', scrollSnapType: 'y mandatory' 
        }}
      >
        {VIDEOS.map((item, index) => (
          <div key={item.id} style={{ 
            width: '100%', height: '100vh', 
            scrollSnapAlign: 'start',
            position: 'relative',
            backgroundColor: '#111'
          }}>
            {/* ▼▼▼ 修改了这里：加上了大括号 { } ▼▼▼ */}
            <video
              ref={(el) => { videoRefs.current[index] = el; }}
              src={item.url}
              loop
              playsInline
              style={{ width: '100%', height: '100%', objectFit: 'contain' }}
            />
            
            <div style={{
              position: 'absolute', bottom: '80px', left: '20px', right: '80px',
              textShadow: '0 1px 2px rgba(0,0,0,0.8)', color: 'white',
              pointerEvents: 'none'
            }}>
              <h3 style={{ margin: 0, fontSize: '18px' }}>@{item.title}</h3>
              <p style={{ margin: '8px 0', fontSize: '14px', lineHeight: '1.4', opacity: 0.9 }}>
                {item.desc}
              </p>
            </div>

            <div style={{
              position: 'absolute', bottom: '80px', right: '10px',
              display: 'flex', flexDirection: 'column', gap: '20px', alignItems: 'center'
            }}>
               <div style={{ width: 45, height: 45, borderRadius: '50%', background: '#333', border: '2px solid white' }}></div>
               <div style={{ color: 'white', fontSize: '30px' }}>❤️</div>
               <div style={{ color: 'white', fontSize: '30px' }}>💬</div>
               <div style={{ color: 'white', fontSize: '30px' }}>↪️</div>
            </div>
          </div>
        ))}
      </div>

      <GestureController onSwipe={handleSwipe} onStatus={setStatus} debugMode={true} />
    </div>
  );
}