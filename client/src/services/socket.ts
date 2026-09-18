import { io, Socket } from 'socket.io-client';
import { CursorPosition, BoardElement, Layer, CanvasTransform } from '../types';

const SERVER_URL = '/';

class SocketService {
  private socket: Socket | null = null;
  private boardId: string | null = null;
  private username: string | null = null;
  // 快速来回切换画板时，只以最后一次 join 的画板为准；
  // 连接尚未建立时挂起，connect 成功后再发送。
  private pendingBoardId: string | null = null;
  private pendingUsername: string | null = null;

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
        // 每次（重）连成功后都重新进入当前画板房间：socket.io 重连是全新的
        // 服务端会话，旧房间成员关系不会保留。以最近一次 join 的画板为准。
        const boardId = this.pendingBoardId ?? this.boardId;
        const username = this.pendingUsername ?? this.username;
        if (boardId) {
          this.socket?.emit('join-board', { boardId, username });
        }
        this.pendingBoardId = null;
        this.pendingUsername = null;
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
    this.pendingBoardId = null;
    this.pendingUsername = null;
  }

  private isReady(): boolean {
    return !!this.socket && this.socket.connected;
  }

  joinBoard(boardId: string, username: string): void {
    this.boardId = boardId;
    this.username = username;

    if (this.isReady()) {
      this.pendingBoardId = null;
      this.pendingUsername = null;
      // 服务端会先让该连接离开旧房间，再进入新房间，
      // 保证快速切换时不会同时订阅多块画板。
      this.socket?.emit('join-board', { boardId, username });
    } else {
      // connect() 尚未握手完成：挂起最新一次请求，连接建立后只进新画板
      this.pendingBoardId = boardId;
      this.pendingUsername = username;
    }
  }

  moveCursor(x: number, y: number): void {
    if (this.isReady() && this.boardId) {
      this.socket?.emit('cursor-move', { boardId: this.boardId, x, y });
    }
  }

  drawElement(element: BoardElement, layerIndex: number): void {
    if (this.isReady() && this.boardId) {
      this.socket?.emit('draw-element', { boardId: this.boardId, element, layerIndex });
    }
  }

  updateElement(elementId: string, updates: Partial<BoardElement>, layerIndex: number): void {
    if (this.isReady() && this.boardId) {
      this.socket?.emit('update-element', { boardId: this.boardId, elementId, updates, layerIndex });
    }
  }

  deleteElement(elementId: string, layerIndex: number): void {
    if (this.isReady() && this.boardId) {
      this.socket?.emit('delete-element', { boardId: this.boardId, elementId, layerIndex });
    }
  }

  addStickyNote(note: BoardElement, layerIndex: number): void {
    if (this.isReady() && this.boardId) {
      this.socket?.emit('add-sticky-note', { boardId: this.boardId, note, layerIndex });
    }
  }

  addShape(shape: BoardElement, layerIndex: number): void {
    if (this.isReady() && this.boardId) {
      this.socket?.emit('add-shape', { boardId: this.boardId, shape, layerIndex });
    }
  }

  updateLayers(layers: Layer[]): void {
    if (this.isReady() && this.boardId) {
      this.socket?.emit('layer-update', { boardId: this.boardId, layers });
    }
  }

  canvasTransform(transform: CanvasTransform): void {
    if (this.isReady() && this.boardId) {
      this.socket?.emit('canvas-transform', { boardId: this.boardId, transform });
    }
  }

  onUserJoined(callback: (data: { socketId: string; username: string; boardId: string }) => void): void {
    this.socket?.on('user-joined', callback);
  }

  onUserLeft(callback: (data: { socketId: string; username: string; boardId: string }) => void): void {
    this.socket?.on('user-left', callback);
  }

  onActiveUsers(callback: (data: { boardId: string; users: CursorPosition[] }) => void): void {
    this.socket?.on('active-users', callback);
  }

  onCursorUpdate(callback: (data: CursorPosition & { boardId: string }) => void): void {
    this.socket?.on('cursor-update', callback);
  }

  onElementAdded(callback: (data: { boardId: string; element: BoardElement; layerIndex: number }) => void): void {
    this.socket?.on('element-added', callback);
  }

  onElementUpdated(callback: (data: { boardId: string; elementId: string; updates: Partial<BoardElement>; layerIndex: number }) => void): void {
    this.socket?.on('element-updated', callback);
  }

  onElementDeleted(callback: (data: { boardId: string; elementId: string; layerIndex: number }) => void): void {
    this.socket?.on('element-deleted', callback);
  }

  onStickyNoteAdded(callback: (data: { boardId: string; note: BoardElement; layerIndex: number }) => void): void {
    this.socket?.on('sticky-note-added', callback);
  }

  onShapeAdded(callback: (data: { boardId: string; shape: BoardElement; layerIndex: number }) => void): void {
    this.socket?.on('shape-added', callback);
  }

  onLayersUpdated(callback: (data: { boardId: string; layers: Layer[] }) => void): void {
    this.socket?.on('layers-updated', callback);
  }

  onCanvasTransformed(callback: (data: { boardId: string; transform: CanvasTransform }) => void): void {
    this.socket?.on('canvas-transformed', callback);
  }

  getSocket(): Socket | null {
    return this.socket;
  }
}

export const socketService = new SocketService();
