import { create } from 'zustand';
import { Board, BoardElement, CursorPosition, CanvasTransform, ToolType, Layer } from '../types';
import { socketService } from '../services/socket';

const IDENTITY_TRANSFORM: CanvasTransform = { scale: 1, translateX: 0, translateY: 0 };

interface BoardSessionState {
  activeLayerIndex: number;
  canvasTransform: CanvasTransform;
}

// 每块画板各自保存的本地会话状态（当前层、缩放/平移），
// 切换到其他画板时缓存，再切回时恢复本画板自己的状态。
const boardSessions = new Map<string, BoardSessionState>();

const clampLayerIndex = (board: Board, index: number): number => {
  if (board.layers.length === 0) return 0;
  return Math.min(Math.max(index, 0), board.layers.length - 1);
};

interface WhiteboardState {
  board: Board | null;
  activeTool: ToolType;
  strokeColor: string;
  fillColor: string;
  strokeWidth: number;
  activeLayerIndex: number;
  cursors: Map<string, CursorPosition>;
  canvasTransform: CanvasTransform;
  username: string;

  // Actions
  enterBoard: (board: Board) => void;
  leaveBoard: () => void;
  setActiveTool: (tool: ToolType) => void;
  setStrokeColor: (color: string) => void;
  setFillColor: (color: string) => void;
  setStrokeWidth: (width: number) => void;
  setActiveLayerIndex: (index: number) => void;
  addElement: (element: BoardElement) => void;
  updateElement: (elementId: string, updates: Partial<BoardElement>) => void;
  deleteElement: (elementId: string) => void;
  addLayer: (name: string) => void;
  toggleLayerVisibility: (index: number) => void;
  toggleLayerLock: (index: number) => void;
  // 本地用户的视图变换（会广播给同画板成员）
  setCanvasTransform: (transform: CanvasTransform) => void;
  // 远端事件，全部带 boardId 校验，绝不允许串到别的画板
  applyRemoteElement: (boardId: string, element: BoardElement, layerIndex: number) => void;
  applyRemoteElementUpdate: (boardId: string, elementId: string, updates: Partial<BoardElement>, layerIndex: number) => void;
  applyRemoteElementDelete: (boardId: string, elementId: string, layerIndex: number) => void;
  applyRemoteLayers: (boardId: string, layers: Layer[]) => void;
  applyRemoteTransform: (boardId: string, transform: CanvasTransform) => void;
  setCursorsForBoard: (boardId: string, cursors: CursorPosition[]) => void;
  updateCursorForBoard: (boardId: string, cursor: CursorPosition) => void;
  removeCursorFromBoard: (boardId: string, socketId: string) => void;
  setUsername: (name: string) => void;
}

export const useWhiteboardStore = create<WhiteboardState>((set, get) => {
  const persistSession = (board: Board, patch: Partial<BoardSessionState>) => {
    const prev = boardSessions.get(board._id) ?? { activeLayerIndex: 0, canvasTransform: IDENTITY_TRANSFORM };
    boardSessions.set(board._id, { ...prev, ...patch });
  };

  return {
    board: null,
    activeTool: 'pen',
    strokeColor: '#000000',
    fillColor: 'transparent',
    strokeWidth: 2,
    activeLayerIndex: 0,
    cursors: new Map(),
    canvasTransform: { scale: 1, translateX: 0, translateY: 0 },
    username: `User_${Math.random().toString(36).substr(2, 6)}`,

    enterBoard: (board) => {
      const { board: previousBoard, activeLayerIndex, canvasTransform } = get();
      // 快速 A -> B 切换（不经工作台）时，先把 A 的会话状态落盘
      if (previousBoard && previousBoard._id !== board._id) {
        persistSession(previousBoard, { activeLayerIndex, canvasTransform });
      }

      const saved = boardSessions.get(board._id);
      // 校验层序号：旧画板残留的序号可能越界，远程删减图层后缓存同样可能失效
      const nextLayerIndex =
        saved && saved.activeLayerIndex >= 0 && saved.activeLayerIndex < board.layers.length
          ? saved.activeLayerIndex
          : clampLayerIndex(board, 0);
      const nextTransform = saved?.canvasTransform ?? IDENTITY_TRANSFORM;

      boardSessions.set(board._id, { activeLayerIndex: nextLayerIndex, canvasTransform: nextTransform });

      // 层列表、画板页面、在线成员全部切到当前画板：光标映射必须清空，
      // 等待本画板的 active-users 重新下发。
      set({
        board,
        activeLayerIndex: nextLayerIndex,
        canvasTransform: nextTransform,
        cursors: new Map(),
      });
    },

    leaveBoard: () => {
      const { board, activeLayerIndex, canvasTransform } = get();
      if (board) {
        persistSession(board, { activeLayerIndex, canvasTransform });
      }
      set({
        board: null,
        activeLayerIndex: 0,
        canvasTransform: IDENTITY_TRANSFORM,
        cursors: new Map(),
      });
    },

    setActiveTool: (tool) => set({ activeTool: tool }),
    setStrokeColor: (color) => set({ strokeColor: color }),
    setFillColor: (color) => set({ fillColor: color }),
    setStrokeWidth: (width) => set({ strokeWidth: width }),

    setActiveLayerIndex: (index) => {
      const { board } = get();
      if (!board) return;
      const safeIndex = clampLayerIndex(board, index);
      set({ activeLayerIndex: safeIndex });
      persistSession(board, { activeLayerIndex: safeIndex });
    },

    addElement: (element) => {
      const { board, activeLayerIndex } = get();
      if (!board) return;
      // 校验层数：序号越界（旧画板残留 / 远程删层）时先纠正，本次落笔丢弃，避免写入 undefined 层
      if (activeLayerIndex < 0 || activeLayerIndex >= board.layers.length) {
        const safeIndex = clampLayerIndex(board, activeLayerIndex);
        set({ activeLayerIndex: safeIndex });
        persistSession(board, { activeLayerIndex: safeIndex });
        return;
      }
      const layer = board.layers[activeLayerIndex];
      if (layer.locked || !layer.visible) return;

      const layers = [...board.layers];
      layers[activeLayerIndex] = {
        ...layer,
        elements: [...layer.elements, element]
      };
      set({ board: { ...board, layers } });
      socketService.drawElement(element, activeLayerIndex);
    },

    updateElement: (elementId, updates) => {
      const { board, activeLayerIndex } = get();
      if (!board) return;
      if (activeLayerIndex < 0 || activeLayerIndex >= board.layers.length) {
        const safeIndex = clampLayerIndex(board, activeLayerIndex);
        set({ activeLayerIndex: safeIndex });
        persistSession(board, { activeLayerIndex: safeIndex });
        return;
      }
      const layer = board.layers[activeLayerIndex];
      if (layer.locked) return;
      const elements = layer.elements.map(el =>
        el.id === elementId ? { ...el, ...updates } : el
      );
      const layers = [...board.layers];
      layers[activeLayerIndex] = { ...layer, elements };
      set({ board: { ...board, layers } });
      socketService.updateElement(elementId, updates, activeLayerIndex);
    },

    deleteElement: (elementId) => {
      const { board, activeLayerIndex } = get();
      if (!board) return;
      if (activeLayerIndex < 0 || activeLayerIndex >= board.layers.length) {
        const safeIndex = clampLayerIndex(board, activeLayerIndex);
        set({ activeLayerIndex: safeIndex });
        persistSession(board, { activeLayerIndex: safeIndex });
        return;
      }
      const layer = board.layers[activeLayerIndex];
      if (layer.locked) return;
      const elements = layer.elements.filter(el => el.id !== elementId);
      const layers = [...board.layers];
      layers[activeLayerIndex] = { ...layer, elements };
      set({ board: { ...board, layers } });
      socketService.deleteElement(elementId, activeLayerIndex);
    },

    addLayer: (name) => {
      const { board } = get();
      if (!board) return;
      const newLayer: Layer = { name, visible: true, locked: false, order: board.layers.length, elements: [] };
      const layers = [...board.layers, newLayer];
      const activeLayerIndex = layers.length - 1;
      set({ board: { ...board, layers }, activeLayerIndex });
      persistSession(board, { activeLayerIndex });
      socketService.updateLayers(layers);
    },

    toggleLayerVisibility: (index) => {
      const { board } = get();
      if (!board || index < 0 || index >= board.layers.length) return;
      const layers = [...board.layers];
      layers[index] = { ...layers[index], visible: !layers[index].visible };
      set({ board: { ...board, layers } });
      socketService.updateLayers(layers);
    },

    toggleLayerLock: (index) => {
      const { board } = get();
      if (!board || index < 0 || index >= board.layers.length) return;
      const layers = [...board.layers];
      layers[index] = { ...layers[index], locked: !layers[index].locked };
      set({ board: { ...board, layers } });
      socketService.updateLayers(layers);
    },

    setCanvasTransform: (transform) => {
      const { board } = get();
      set({ canvasTransform: transform });
      if (board) persistSession(board, { canvasTransform: transform });
      socketService.canvasTransform(transform);
    },

    // ---- 远端事件：先校验画板归属，再校验层序号 ----

    applyRemoteElement: (boardId, element, layerIndex) => {
      const { board } = get();
      if (!board || board._id !== boardId) return;
      if (layerIndex < 0 || layerIndex >= board.layers.length) return;
      const layers = [...board.layers];
      const layer = layers[layerIndex];
      if (layer.elements.some(el => el.id === element.id)) return;
      layers[layerIndex] = { ...layer, elements: [...layer.elements, element] };
      set({ board: { ...board, layers } });
    },

    applyRemoteElementUpdate: (boardId, elementId, updates, layerIndex) => {
      const { board } = get();
      if (!board || board._id !== boardId) return;
      if (layerIndex < 0 || layerIndex >= board.layers.length) return;
      const layers = [...board.layers];
      const elements = layers[layerIndex].elements.map(el =>
        el.id === elementId ? { ...el, ...updates } : el
      );
      layers[layerIndex] = { ...layers[layerIndex], elements };
      set({ board: { ...board, layers } });
    },

    applyRemoteElementDelete: (boardId, elementId, layerIndex) => {
      const { board } = get();
      if (!board || board._id !== boardId) return;
      if (layerIndex < 0 || layerIndex >= board.layers.length) return;
      const layers = [...board.layers];
      const elements = layers[layerIndex].elements.filter(el => el.id !== elementId);
      layers[layerIndex] = { ...layers[layerIndex], elements };
      set({ board: { ...board, layers } });
    },

    applyRemoteLayers: (boardId, layers) => {
      const { board, activeLayerIndex } = get();
      if (!board || board._id !== boardId) return;
      // 画板被远程调整（增删层）后，重新校验当前层序号
      const safeIndex = clampLayerIndex({ ...board, layers }, activeLayerIndex);
      set({ board: { ...board, layers }, activeLayerIndex: safeIndex });
      persistSession(board, { activeLayerIndex: safeIndex });
    },

    applyRemoteTransform: (boardId, transform) => {
      const { board } = get();
      if (!board || board._id !== boardId) return;
      // 只静默应用，绝不再广播回去（避免缩放回声/串位）
      set({ canvasTransform: transform });
      persistSession(board, { canvasTransform: transform });
    },

    setCursorsForBoard: (boardId, cursorsList) => {
      const { board } = get();
      if (!board || board._id !== boardId) return;
      const cursors = new Map();
      cursorsList.forEach(c => cursors.set(c.socketId, c));
      set({ cursors });
    },

    updateCursorForBoard: (boardId, cursor) => {
      const { board } = get();
      if (!board || board._id !== boardId) return;
      const cursors = new Map(get().cursors);
      cursors.set(cursor.socketId, cursor);
      set({ cursors });
    },

    removeCursorFromBoard: (boardId, socketId) => {
      const { board } = get();
      if (!board || board._id !== boardId) return;
      const cursors = new Map(get().cursors);
      cursors.delete(socketId);
      set({ cursors });
    },

    setUsername: (name) => set({ username: name }),
  };
});
