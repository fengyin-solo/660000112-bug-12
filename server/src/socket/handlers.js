const cursorPositions = new Map(); // socketId -> { x, y, username, boardId }

function setupSocketHandlers(io) {
  // 让连接离开当前画板房间，并通知旧房间的其他成员
  const leaveCurrentBoard = (socket) => {
    const pos = cursorPositions.get(socket.id);
    if (!pos) return;
    const { boardId, username } = pos;
    socket.leave(`board:${boardId}`);
    cursorPositions.delete(socket.id);
    socket.to(`board:${boardId}`).emit('user-left', { socketId: socket.id, username, boardId });
  };

  io.on('connection', (socket) => {
    console.log(`User connected: ${socket.id}`);

    socket.on('join-board', ({ boardId, username }) => {
      if (!boardId) return;

      // 快速来回切换：先离开旧房间，旧房间成员收到带 boardId 的 user-left；
      // 同一个连接任何时刻只属于一块画板，不可能同时向多块画板广播。
      leaveCurrentBoard(socket);

      socket.join(`board:${boardId}`);
      cursorPositions.set(socket.id, { x: 0, y: 0, username, boardId });

      // Notify others in the room
      socket.to(`board:${boardId}`).emit('user-joined', { socketId: socket.id, username, boardId });

      // Send current active users (of THIS board only) to the joiner
      const users = [];
      for (const [sid, data] of cursorPositions) {
        if (data.boardId === boardId && sid !== socket.id) {
          users.push({ socketId: sid, username: data.username, x: data.x, y: data.y });
        }
      }
      // 携带 boardId，客户端据此判断是否应用，避免切换空窗期错配
      socket.emit('active-users', { boardId, users });
    });

    socket.on('cursor-move', ({ x, y }) => {
      const pos = cursorPositions.get(socket.id);
      if (!pos) return; // 尚未加入任何画板，忽略
      pos.x = x;
      pos.y = y;
      socket.to(`board:${pos.boardId}`).emit('cursor-update', {
        socketId: socket.id,
        username: pos.username,
        boardId: pos.boardId,
        x, y
      });
    });

    // 统一校验：事件来源必须仍属于其声称的画板，且与服务端记录一致，
    // 防止快速切换时迟到的事件被投递到别的画板。
    const guard = (handler) => (payload = {}) => {
      const pos = cursorPositions.get(socket.id);
      if (!pos) return;
      if (payload.boardId && payload.boardId !== pos.boardId) return;
      handler(payload, pos.boardId);
    };

    socket.on('draw-element', guard(({ element, layerIndex }, boardId) => {
      socket.to(`board:${boardId}`).emit('element-added', { boardId, element, layerIndex });
    }));

    socket.on('update-element', guard(({ elementId, updates, layerIndex }, boardId) => {
      socket.to(`board:${boardId}`).emit('element-updated', { boardId, elementId, updates, layerIndex });
    }));

    socket.on('delete-element', guard(({ elementId, layerIndex }, boardId) => {
      socket.to(`board:${boardId}`).emit('element-deleted', { boardId, elementId, layerIndex });
    }));

    socket.on('add-sticky-note', guard(({ note, layerIndex }, boardId) => {
      socket.to(`board:${boardId}`).emit('sticky-note-added', { boardId, note, layerIndex });
    }));

    socket.on('add-shape', guard(({ shape, layerIndex }, boardId) => {
      socket.to(`board:${boardId}`).emit('shape-added', { boardId, shape, layerIndex });
    }));

    socket.on('layer-update', guard(({ layers }, boardId) => {
      socket.to(`board:${boardId}`).emit('layers-updated', { boardId, layers });
    }));

    socket.on('canvas-transform', guard(({ transform }, boardId) => {
      socket.to(`board:${boardId}`).emit('canvas-transformed', { boardId, transform });
    }));

    socket.on('disconnect', () => {
      // 成员中途离开（关页/断网）：只通知其所在画板，其他画板不受影响
      leaveCurrentBoard(socket);
      console.log(`User disconnected: ${socket.id}`);
    });
  });
}

module.exports = { setupSocketHandlers };
