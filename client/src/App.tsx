import React, { useState, useEffect } from 'react';
import { WhiteboardCanvas } from './components/WhiteboardCanvas';
import { Toolbar } from './components/Toolbar';
import { LayerPanel } from './components/LayerPanel';
import { CursorOverlay } from './components/CursorOverlay';
import { Dashboard } from './components/Dashboard';
import { useWhiteboardStore } from './store/whiteboard';
import { socketService } from './services/socket';
import { Board, CursorPosition } from './types';

const App: React.FC = () => {
  const [currentView, setCurrentView] = useState<'dashboard' | 'board'>('dashboard');
  const [activeBoard, setActiveBoard] = useState<Board | null>(null);

  // 进入画板：立即把层列表/当前层/页面位置/在线成员切到目标画板，
  // 避免点击与 socket 握手之间的空窗期残留上一块画板的内容。
  const enterBoard = (boardItem: Board) => {
    useWhiteboardStore.getState().enterBoard(boardItem);
  };

  // 全局 socket 监听只注册一次（连接跨画板复用）。
  // 所有事件都带 boardId，处理时必须和当前画板一致，否则直接丢弃——
  // 这是防止快速来回切换、成员离开、远程调整时串板的最后一道防线。
  useEffect(() => {
    const store = useWhiteboardStore;
    const socket = socketService.connect();

    const onUserJoined = (data: { socketId: string; username: string; boardId: string }) => {
      const board = store.getState().board;
      if (board && board._id === data.boardId) {
        console.log(`${data.username} 加入了白板`);
      }
    };

    const onUserLeft = (data: { socketId: string; username: string; boardId: string }) => {
      store.getState().removeCursorFromBoard(data.boardId, data.socketId);
    };

    const onActiveUsers = (data: { boardId: string; users: CursorPosition[] }) => {
      store.getState().setCursorsForBoard(data.boardId, data.users);
    };

    const onCursorUpdate = (data: CursorPosition & { boardId: string }) => {
      const { boardId, ...cursor } = data;
      store.getState().updateCursorForBoard(boardId, cursor);
    };

    const onElementAdded = (data: { boardId: string; element: any; layerIndex: number }) => {
      store.getState().applyRemoteElement(data.boardId, data.element, data.layerIndex);
    };

    const onElementUpdated = (data: { boardId: string; elementId: string; updates: any; layerIndex: number }) => {
      store.getState().applyRemoteElementUpdate(data.boardId, data.elementId, data.updates, data.layerIndex);
    };

    const onElementDeleted = (data: { boardId: string; elementId: string; layerIndex: number }) => {
      store.getState().applyRemoteElementDelete(data.boardId, data.elementId, data.layerIndex);
    };

    const onStickyNoteAdded = (data: { boardId: string; note: any; layerIndex: number }) => {
      store.getState().applyRemoteElement(data.boardId, data.note, data.layerIndex);
    };

    const onShapeAdded = (data: { boardId: string; shape: any; layerIndex: number }) => {
      store.getState().applyRemoteElement(data.boardId, data.shape, data.layerIndex);
    };

    const onLayersUpdated = (data: { boardId: string; layers: any[] }) => {
      store.getState().applyRemoteLayers(data.boardId, data.layers);
    };

    const onCanvasTransformed = (data: { boardId: string; transform: any }) => {
      store.getState().applyRemoteTransform(data.boardId, data.transform);
    };

    socket.on('user-joined', onUserJoined);
    socket.on('user-left', onUserLeft);
    socket.on('active-users', onActiveUsers);
    socket.on('cursor-update', onCursorUpdate);
    socket.on('element-added', onElementAdded);
    socket.on('element-updated', onElementUpdated);
    socket.on('element-deleted', onElementDeleted);
    socket.on('sticky-note-added', onStickyNoteAdded);
    socket.on('shape-added', onShapeAdded);
    socket.on('layers-updated', onLayersUpdated);
    socket.on('canvas-transformed', onCanvasTransformed);

    return () => {
      socket.off('user-joined', onUserJoined);
      socket.off('user-left', onUserLeft);
      socket.off('active-users', onActiveUsers);
      socket.off('cursor-update', onCursorUpdate);
      socket.off('element-added', onElementAdded);
      socket.off('element-updated', onElementUpdated);
      socket.off('element-deleted', onElementDeleted);
      socket.off('sticky-note-added', onStickyNoteAdded);
      socket.off('shape-added', onShapeAdded);
      socket.off('layers-updated', onLayersUpdated);
      socket.off('canvas-transformed', onCanvasTransformed);
    };
  }, []);

  // 当前画板变化时加入对应房间（连接复用，服务端负责离开旧房间）
  useEffect(() => {
    if (currentView === 'board' && activeBoard) {
      socketService.connect();
      socketService.joinBoard(activeBoard._id, useWhiteboardStore.getState().username);
    }
  }, [currentView, activeBoard]);

  const handleBoardSelect = (boardItem: Board) => {
    enterBoard(boardItem);
    setActiveBoard(boardItem);
    setCurrentView('board');
  };

  const handleBackToDashboard = () => {
    // 缓存本画板的层/页面状态后彻底清空，断开连接，杜绝任何残留
    useWhiteboardStore.getState().leaveBoard();
    socketService.disconnect();
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
