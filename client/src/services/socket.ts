import { io, Socket } from 'socket.io-client';
import { CursorPosition, BoardElement, Layer, CanvasTransform } from '../types';

const SERVER_URL = '/';

// 服务端广播的事件都会携带 boardId，用于校验事件归属的画板
interface BoardScoped {
  boardId?: string;
}

class SocketService {
  private socket: Socket | null = null;
  private boardId: string | null = null;
  private username: string | null = null;

  connect(): Socket {
    if (!this.socket) {
      this.socket = io(SERVER_URL, {
        autoConnect: false,
        reconnection: true,
        reconnectionAttempts: 3,
        reconnectionDelay: 2000,
        timeout: 10000,
      });
      this.socket.on('connect', () => {
        // 断线重连后重新加入当前画板，恢复房间成员关系
        if (this.boardId && this.username) {
          this.socket?.emit('join-board', { boardId: this.boardId, username: this.username });
        }
      });
    }
    this.socket.connect();
    return this.socket;
  }

  disconnect(): void {
    if (this.socket) {
      this.socket.removeAllListeners();
      this.socket.disconnect();
      this.socket = null;
    }
    this.boardId = null;
    this.username = null;
  }

  joinBoard(boardId: string, username: string): void {
    // 先退出上一画板，避免房间成员关系残留导致跨画板串消息
    if (this.boardId && this.boardId !== boardId) {
      this.leaveBoard();
    }
    this.boardId = boardId;
    this.username = username;
    this.socket?.emit('join-board', { boardId, username });
  }

  leaveBoard(): void {
    if (this.boardId) {
      this.socket?.emit('leave-board', { boardId: this.boardId });
      this.boardId = null;
    }
  }

  getBoardId(): string | null {
    return this.boardId;
  }

  // 仅处理当前画板的事件，丢弃其他画板残留的广播
  private isCurrentBoard(boardId?: string): boolean {
    return !!boardId && boardId === this.boardId;
  }

  moveCursor(x: number, y: number): void {
    if (this.boardId) {
      this.socket?.emit('cursor-move', { boardId: this.boardId, x, y });
    }
  }

  drawElement(element: BoardElement, layerIndex: number): void {
    if (this.boardId) {
      this.socket?.emit('draw-element', { boardId: this.boardId, element, layerIndex });
    }
  }

  updateElement(elementId: string, updates: Partial<BoardElement>, layerIndex: number): void {
    if (this.boardId) {
      this.socket?.emit('update-element', { boardId: this.boardId, elementId, updates, layerIndex });
    }
  }

  deleteElement(elementId: string, layerIndex: number): void {
    if (this.boardId) {
      this.socket?.emit('delete-element', { boardId: this.boardId, elementId, layerIndex });
    }
  }

  addStickyNote(note: BoardElement, layerIndex: number): void {
    if (this.boardId) {
      this.socket?.emit('add-sticky-note', { boardId: this.boardId, note, layerIndex });
    }
  }

  addShape(shape: BoardElement, layerIndex: number): void {
    if (this.boardId) {
      this.socket?.emit('add-shape', { boardId: this.boardId, shape, layerIndex });
    }
  }

  updateLayers(layers: Layer[]): void {
    if (this.boardId) {
      this.socket?.emit('layer-update', { boardId: this.boardId, layers });
    }
  }

  canvasTransform(transform: CanvasTransform): void {
    if (this.boardId) {
      this.socket?.emit('canvas-transform', { boardId: this.boardId, transform });
    }
  }

  onUserJoined(callback: (data: { socketId: string; username: string }) => void): void {
    this.socket?.on('user-joined', (data: { socketId: string; username: string } & BoardScoped) => {
      if (this.isCurrentBoard(data.boardId)) callback(data);
    });
  }

  onUserLeft(callback: (data: { socketId: string; username: string }) => void): void {
    this.socket?.on('user-left', (data: { socketId: string; username: string } & BoardScoped) => {
      if (this.isCurrentBoard(data.boardId)) callback(data);
    });
  }

  onActiveUsers(callback: (users: CursorPosition[]) => void): void {
    this.socket?.on('active-users', (data: { users: CursorPosition[] } & BoardScoped) => {
      if (this.isCurrentBoard(data.boardId)) callback(data.users);
    });
  }

  onCursorUpdate(callback: (data: CursorPosition) => void): void {
    this.socket?.on('cursor-update', (data: CursorPosition & BoardScoped) => {
      if (this.isCurrentBoard(data.boardId)) callback(data);
    });
  }

  onElementAdded(callback: (data: { element: BoardElement; layerIndex: number }) => void): void {
    this.socket?.on('element-added', (data: { element: BoardElement; layerIndex: number } & BoardScoped) => {
      if (this.isCurrentBoard(data.boardId)) callback(data);
    });
  }

  onElementUpdated(callback: (data: { elementId: string; updates: Partial<BoardElement>; layerIndex: number }) => void): void {
    this.socket?.on('element-updated', (data: { elementId: string; updates: Partial<BoardElement>; layerIndex: number } & BoardScoped) => {
      if (this.isCurrentBoard(data.boardId)) callback(data);
    });
  }

  onElementDeleted(callback: (data: { elementId: string; layerIndex: number }) => void): void {
    this.socket?.on('element-deleted', (data: { elementId: string; layerIndex: number } & BoardScoped) => {
      if (this.isCurrentBoard(data.boardId)) callback(data);
    });
  }

  onStickyNoteAdded(callback: (data: { note: BoardElement; layerIndex: number }) => void): void {
    this.socket?.on('sticky-note-added', (data: { note: BoardElement; layerIndex: number } & BoardScoped) => {
      if (this.isCurrentBoard(data.boardId)) callback(data);
    });
  }

  onShapeAdded(callback: (data: { shape: BoardElement; layerIndex: number }) => void): void {
    this.socket?.on('shape-added', (data: { shape: BoardElement; layerIndex: number } & BoardScoped) => {
      if (this.isCurrentBoard(data.boardId)) callback(data);
    });
  }

  onLayersUpdated(callback: (data: { layers: Layer[] }) => void): void {
    this.socket?.on('layers-updated', (data: { layers: Layer[] } & BoardScoped) => {
      if (this.isCurrentBoard(data.boardId)) callback(data);
    });
  }

  onCanvasTransformed(callback: (data: { transform: CanvasTransform }) => void): void {
    this.socket?.on('canvas-transformed', (data: { transform: CanvasTransform } & BoardScoped) => {
      if (this.isCurrentBoard(data.boardId)) callback(data);
    });
  }

  off(event: string, callback?: (...args: unknown[]) => void): void {
    this.socket?.off(event, callback);
  }

  getSocket(): Socket | null {
    return this.socket;
  }
}

export const socketService = new SocketService();
