import React, { useState, useEffect } from 'react';
import { WhiteboardCanvas } from './components/WhiteboardCanvas';
import { Toolbar } from './components/Toolbar';
import { LayerPanel } from './components/LayerPanel';
import { CursorOverlay } from './components/CursorOverlay';
import { Dashboard } from './components/Dashboard';
import { useWhiteboardStore } from './store/whiteboard';
import { socketService } from './services/socket';
import { Board, BoardElement, CursorPosition, Layer, CanvasTransform, ViewType } from './types';

const App: React.FC = () => {
  const [currentView, setCurrentView] = useState<ViewType>('dashboard');
  const [activeBoard, setActiveBoard] = useState<Board | null>(null);
  const {
    openBoard, closeBoard, setBoard, updateCursor, removeCursor, setCursors, username
  } = useWhiteboardStore();

  useEffect(() => {
    if (currentView === 'board' && activeBoard) {
      // 打开画板：校验层数，恢复本画板自己的图层与缩放状态，清空上一画板残留
      openBoard(activeBoard);

      socketService.connect();
      socketService.joinBoard(activeBoard._id, username);

      socketService.onUserJoined((data) => {
        console.log(`${data.username} 加入了白板`);
      });
      socketService.onUserLeft((data) => {
        removeCursor(data.socketId);
      });
      socketService.onActiveUsers((users) => {
        setCursors(users);
      });
      socketService.onCursorUpdate((data: CursorPosition) => {
        updateCursor(data);
      });
      socketService.onElementAdded((data: { element: BoardElement; layerIndex: number }) => {
        const { board: currentBoard } = useWhiteboardStore.getState();
        // 校验画板与层序号，防止其他画板/过期状态的事件写进当前画板
        if (!currentBoard || currentBoard._id !== activeBoard._id) return;
        if (data.layerIndex < 0 || data.layerIndex >= currentBoard.layers.length) return;
        const layers = [...currentBoard.layers];
        layers[data.layerIndex] = {
          ...layers[data.layerIndex],
          elements: [...layers[data.layerIndex].elements, data.element]
        };
        setBoard({ ...currentBoard, layers });
      });
      socketService.onLayersUpdated((data: { layers: Layer[] }) => {
        const { board: currentBoard } = useWhiteboardStore.getState();
        if (currentBoard && currentBoard._id === activeBoard._id) {
          // setBoard 会按新的层数校验当前层序号
          setBoard({ ...currentBoard, layers: data.layers });
        }
      });
      socketService.onCanvasTransformed((data: { transform: CanvasTransform }) => {
        const { board: currentBoard } = useWhiteboardStore.getState();
        if (currentBoard && currentBoard._id === activeBoard._id) {
          // 只应用到本地，不再回传，避免客户端之间来回广播
          useWhiteboardStore.getState().applyCanvasTransform(data.transform);
        }
      });

      return () => {
        // 离开画板：保存本画板会话状态并断开连接，避免串到下一个画板
        closeBoard();
        socketService.disconnect();
      };
    }
  }, [currentView, activeBoard]);

  const handleBoardSelect = (boardItem: Board) => {
    setActiveBoard(boardItem);
    setCurrentView('board');
  };

  const handleBackToDashboard = () => {
    setCurrentView('dashboard');
    setActiveBoard(null);
  };

  if (currentView === 'dashboard') {
    return <Dashboard onBoardSelect={handleBoardSelect} />;
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100vh', width: '100vw', overflow: 'hidden' }}>
      <div style={{
        height: '48px',
        background: '#fff',
        borderBottom: '1px solid #e5e7eb',
        display: 'flex',
        alignItems: 'center',
        padding: '0 16px',
        gap: '12px',
      }}>
        <button
          onClick={handleBackToDashboard}
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: '6px',
            padding: '6px 12px',
            fontSize: '13px',
            fontWeight: 500,
            color: '#374151',
            background: '#f3f4f6',
            border: 'none',
            borderRadius: '6px',
            cursor: 'pointer',
          }}
          onMouseEnter={(e) => {
            e.currentTarget.style.background = '#e5e7eb';
          }}
          onMouseLeave={(e) => {
            e.currentTarget.style.background = '#f3f4f6';
          }}
        >
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <line x1="19" y1="12" x2="5" y2="12" />
            <polyline points="12 19 5 12 12 5" />
          </svg>
          返回工作台
        </button>
        <div style={{
          fontSize: '14px',
          fontWeight: 600,
          color: '#1a1a1a',
        }}>
          {activeBoard?.name}
        </div>
      </div>
      <div style={{ display: 'flex', flex: 1, overflow: 'hidden' }}>
        <Toolbar />
        <div style={{ flex: 1, position: 'relative', overflow: 'hidden' }}>
          <WhiteboardCanvas />
          <CursorOverlay />
        </div>
        <LayerPanel />
      </div>
    </div>
  );
};

export default App;
