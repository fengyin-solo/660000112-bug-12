import { create } from 'zustand';
import { Board, BoardElement, CursorPosition, CanvasTransform, ToolType, Layer } from '../types';
import { socketService } from '../services/socket';

const DEFAULT_TRANSFORM: CanvasTransform = { scale: 1, translateX: 0, translateY: 0 };

interface BoardSessionState {
  activeLayerIndex: number;
  canvasTransform: CanvasTransform;
}

// 每个画板各自的会话状态（当前图层、缩放位置），
// 切换画板时保存/恢复，避免不同画板之间互相串位
const boardSessionCache = new Map<string, BoardSessionState>();

// 校验层序号，确保落在给定层数范围内
const clampLayerIndex = (index: number, layerCount: number): number => {
  if (layerCount <= 0) return 0;
  return Math.min(Math.max(index, 0), layerCount - 1);
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
  setBoard: (board: Board) => void;
  openBoard: (board: Board) => void;
  closeBoard: () => void;
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
  setCanvasTransform: (transform: CanvasTransform) => void;
  applyCanvasTransform: (transform: CanvasTransform) => void;
  updateCursor: (cursor: CursorPosition) => void;
  removeCursor: (socketId: string) => void;
  setCursors: (cursors: CursorPosition[]) => void;
  setUsername: (name: string) => void;
}

export const useWhiteboardStore = create<WhiteboardState>((set, get) => ({
  board: null,
  activeTool: 'pen',
  strokeColor: '#000000',
  fillColor: 'transparent',
  strokeWidth: 2,
  activeLayerIndex: 0,
  cursors: new Map(),
  canvasTransform: { ...DEFAULT_TRANSFORM },
  username: `User_${Math.random().toString(36).substr(2, 6)}`,

  // 远程图层/画板更新入口：按新的层数校验当前层序号，防止越界残留
  setBoard: (board) => set((state) => ({
    board,
    activeLayerIndex: clampLayerIndex(state.activeLayerIndex, board.layers.length),
  })),

  // 打开画板：清空上一画板残留的光标，恢复本画板自己的图层与缩放状态
  openBoard: (board) => {
    const cached = boardSessionCache.get(board._id);
    set({
      board,
      cursors: new Map(),
      activeLayerIndex: clampLayerIndex(cached?.activeLayerIndex ?? 0, board.layers.length),
      canvasTransform: cached ? { ...cached.canvasTransform } : { ...DEFAULT_TRANSFORM },
    });
  },

  // 离开画板：保存本画板会话状态并重置全局状态，避免串到下一个画板
  closeBoard: () => {
    const { board, activeLayerIndex, canvasTransform } = get();
    if (board) {
      boardSessionCache.set(board._id, {
        activeLayerIndex: clampLayerIndex(activeLayerIndex, board.layers.length),
        canvasTransform: { ...canvasTransform },
      });
    }
    set({
      board: null,
      cursors: new Map(),
      activeLayerIndex: 0,
      canvasTransform: { ...DEFAULT_TRANSFORM },
    });
  },

  setActiveTool: (tool) => set({ activeTool: tool }),
  setStrokeColor: (color) => set({ strokeColor: color }),
  setFillColor: (color) => set({ fillColor: color }),
  setStrokeWidth: (width) => set({ strokeWidth: width }),

  setActiveLayerIndex: (index) => {
    const { board } = get();
    if (!board || board.layers.length === 0) return;
    set({ activeLayerIndex: clampLayerIndex(index, board.layers.length) });
  },

  addElement: (element) => {
    const { board, activeLayerIndex } = get();
    if (!board || board.layers.length === 0) return;
    const layerIndex = clampLayerIndex(activeLayerIndex, board.layers.length);
    const layers = [...board.layers];
    layers[layerIndex] = {
      ...layers[layerIndex],
      elements: [...layers[layerIndex].elements, element]
    };
    set({ board: { ...board, layers }, activeLayerIndex: layerIndex });
    socketService.drawElement(element, layerIndex);
  },

  updateElement: (elementId, updates) => {
    const { board, activeLayerIndex } = get();
    if (!board || board.layers.length === 0) return;
    const layerIndex = clampLayerIndex(activeLayerIndex, board.layers.length);
    const layers = [...board.layers];
    const elements = layers[layerIndex].elements.map(el =>
      el.id === elementId ? { ...el, ...updates } : el
    );
    layers[layerIndex] = { ...layers[layerIndex], elements };
    set({ board: { ...board, layers }, activeLayerIndex: layerIndex });
    socketService.updateElement(elementId, updates, layerIndex);
  },

  deleteElement: (elementId) => {
    const { board, activeLayerIndex } = get();
    if (!board || board.layers.length === 0) return;
    const layerIndex = clampLayerIndex(activeLayerIndex, board.layers.length);
    const layers = [...board.layers];
    const elements = layers[layerIndex].elements.filter(el => el.id !== elementId);
    layers[layerIndex] = { ...layers[layerIndex], elements };
    set({ board: { ...board, layers }, activeLayerIndex: layerIndex });
    socketService.deleteElement(elementId, layerIndex);
  },

  addLayer: (name) => {
    const { board } = get();
    if (!board) return;
    const newLayer: Layer = { name, visible: true, locked: false, order: board.layers.length, elements: [] };
    const layers = [...board.layers, newLayer];
    set({ board: { ...board, layers }, activeLayerIndex: layers.length - 1 });
    socketService.updateLayers(layers);
  },

  toggleLayerVisibility: (index) => {
    const { board } = get();
    if (!board) return;
    const layers = [...board.layers];
    layers[index] = { ...layers[index], visible: !layers[index].visible };
    set({ board: { ...board, layers } });
    socketService.updateLayers(layers);
  },

  toggleLayerLock: (index) => {
    const { board } = get();
    if (!board) return;
    const layers = [...board.layers];
    layers[index] = { ...layers[index], locked: !layers[index].locked };
    set({ board: { ...board, layers } });
    socketService.updateLayers(layers);
  },

  // 本地缩放/平移：更新状态并广播给本画板其他成员
  setCanvasTransform: (transform) => {
    set({ canvasTransform: transform });
    socketService.canvasTransform(transform);
  },

  // 远程同步来的缩放/平移：只更新本地状态，不再回传，避免来回广播
  applyCanvasTransform: (transform) => {
    set({ canvasTransform: transform });
  },

  updateCursor: (cursor) => {
    const cursors = new Map(get().cursors);
    cursors.set(cursor.socketId, cursor);
    set({ cursors });
  },

  removeCursor: (socketId) => {
    const cursors = new Map(get().cursors);
    cursors.delete(socketId);
    set({ cursors });
  },

  setCursors: (cursorsList) => {
    const cursors = new Map();
    cursorsList.forEach(c => cursors.set(c.socketId, c));
    set({ cursors });
  },

  setUsername: (name) => set({ username: name }),
}));
