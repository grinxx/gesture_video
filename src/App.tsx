import { useState, useRef, useEffect, useCallback } from 'react';
import { GestureRecognizer, FilesetResolver, DrawingUtils } from "@mediapipe/tasks-vision";

// --- 纯色背景配置 ---
const COLORS = [
  { id: 1, color: "#FF5733", title: "红色页面 (Red)" },
  { id: 2, color: "#33FF57", title: "绿色页面 (Green)" },
  { id: 3, color: "#3357FF", title: "蓝色页面 (Blue)" },
  { id: 4, color: "#F333FF", title: "紫色页面 (Purple)" },
];

const GestureController = ({ onSwipe, onStatus, debugMode }: any) => {
  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const lastYRef = useRef<number | null>(null);
  const isCooldownRef = useRef(false);
  
  // --- 关键修改 1: 使用 ref 追踪最新的回调函数，避免 useEffect 依赖变化 ---
  const latestOnSwipe = useRef(onSwipe);
  const latestOnStatus = useRef(onStatus);

  // 每次渲染都更新 ref，保证循环里调用的函数是最新的
  useEffect(() => { latestOnSwipe.current = onSwipe; }, [onSwipe]);
  useEffect(() => { latestOnStatus.current = onStatus; }, [onStatus]);

  useEffect(() => {
    let gestureRecognizer: GestureRecognizer | null = null;
    let requestRef: number;
    let isMounted = true; // 防止组件卸载后继续执行

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
              // --- 关键修改 2: 捕获 play() 的 AbortError ---
              await videoRef.current.play().catch(e => {
                  console.log("视频播放被打断 (正常现象):", e);
              });
              
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
                    console.log("检测到：向上挥手 (Next)");
                    latestOnSwipe.current('NEXT'); // 使用 ref 调用
                    triggerCooldown();
                  } else if (deltaY > threshold) {
                    console.log("检测到：向下挥手 (Prev)");
                    latestOnSwipe.current('PREV'); // 使用 ref 调用
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
      }, 1000);
    };

    setup();

    return () => {
      isMounted = false;
      cancelAnimationFrame(requestRef);
      if(gestureRecognizer) gestureRecognizer.close();
      // 停止摄像头流
      if (videoRef.current && videoRef.current.srcObject) {
          const stream = videoRef.current.srcObject as MediaStream;
          stream.getTracks().forEach(track => track.stop());
      }
    };
    // --- 关键修改 3: 依赖数组只保留 debugMode，移除 onSwipe/onStatus 以防止死循环 ---
  }, [debugMode]);

  return (
    <>
      <video ref={videoRef} style={{ display: 'none' }} playsInline muted autoPlay />
      <canvas ref={canvasRef} style={{ 
        position: 'fixed', top: 20, right: 20, 
        width: '160px', height: '120px', 
        zIndex: 9999, border: '4px solid lime', 
        borderRadius: '8px', 
        backgroundColor: 'rgba(0,0,0,0.5)',
        transform: 'scaleX(-1)' 
      }} />
    </>
  );
};

export default function App() {
  const [activeIndex, setActiveIndex] = useState(0);
  const [status, setStatus] = useState("初始化中...");
  const containerRef = useRef<HTMLDivElement>(null);

  // --- 关键修改 4: 使用 useCallback 保证函数引用稳定 ---
  const handleSwipe = useCallback((direction: 'NEXT' | 'PREV') => {
    setActiveIndex(prevIndex => {
        let newIndex = prevIndex;
        if (direction === 'NEXT' && prevIndex < COLORS.length - 1) {
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

  return (
    <div style={{ width: '100vw', height: '100vh', backgroundColor: '#111', overflow: 'hidden', position: 'relative' }}>
      
      {/* 状态提示 */}
      <div style={{ 
        position: 'absolute', top: 20, left: 20, zIndex: 100, 
        background: 'rgba(255,255,255,0.9)', padding: '10px 20px', borderRadius: '30px',
        color: '#000', fontWeight: 'bold', boxShadow: '0 4px 12px rgba(0,0,0,0.3)'
      }}>
        🤖 {status}
      </div>

      {/* 滚动容器 */}
      <div 
        ref={containerRef}
        style={{ 
          width: '100%', height: '100%', overflowY: 'hidden', scrollSnapType: 'y mandatory' 
        }}
      >
        {COLORS.map((item, index) => (
          <div key={item.id} style={{ 
            width: '100%', height: '100vh', 
            scrollSnapAlign: 'start',
            backgroundColor: item.color, 
            display: 'flex', flexDirection: 'column',
            justifyContent: 'center', alignItems: 'center',
            color: 'white', fontSize: '2rem', fontWeight: 'bold',
            textShadow: '0 2px 10px rgba(0,0,0,0.5)'
          }}>
            <h1>{item.title}</h1>
            <p style={{fontSize: '1rem', opacity: 0.8}}>请对着摄像头 上下挥手</p>
            {index === activeIndex && <div style={{fontSize: '3rem', marginTop: '20px'}}>👀 当前观看中</div>}
          </div>
        ))}
      </div>

      <GestureController onSwipe={handleSwipe} onStatus={setStatus} debugMode={true} />
    </div>
  );
}