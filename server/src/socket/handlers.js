const activeUsers = new Map(); // boardId -> Set of socket ids
const cursorPositions = new Map(); // socketId -> { x, y, username, boardId }

function setupSocketHandlers(io) {
  io.on('connection', (socket) => {
    console.log(`User connected: ${socket.id}`);

    // 让 socket 退出其当前所在的画板房间，并通知该房间其他成员
    const leaveCurrentBoard = () => {
      const pos = cursorPositions.get(socket.id);
      if (!pos) return;
      const { boardId, username } = pos;

      socket.leave(`board:${boardId}`);
      const users = activeUsers.get(boardId);
      if (users) {
        users.delete(socket.id);
        if (users.size === 0) activeUsers.delete(boardId);
      }
      cursorPositions.delete(socket.id);
      socket.to(`board:${boardId}`).emit('user-left', { socketId: socket.id, username, boardId });
    };

    // 校验事件是否属于 socket 当前所在的画板，防止跨画板串消息
    const isInBoard = (boardId) => {
      const pos = cursorPositions.get(socket.id);
      return !!pos && pos.boardId === boardId;
    };

    socket.on('join-board', ({ boardId, username }) => {
      const pos = cursorPositions.get(socket.id);
      if (pos && pos.boardId === boardId) {
        return; // 已在该画板，忽略重复加入
      }
      // 加入新画板前先退出上一画板，避免房间成员关系残留
      if (pos) {
        leaveCurrentBoard();
      }

      socket.join(`board:${boardId}`);

      if (!activeUsers.has(boardId)) {
        activeUsers.set(boardId, new Set());
      }
      activeUsers.get(boardId).add(socket.id);

      cursorPositions.set(socket.id, { x: 0, y: 0, username, boardId });

      // Notify others in the room
      socket.to(`board:${boardId}`).emit('user-joined', { socketId: socket.id, username, boardId });

      // Send current active users to the joiner
      const users = [];
      for (const [sid, data] of cursorPositions) {
        if (data.boardId === boardId && sid !== socket.id) {
          users.push({ socketId: sid, username: data.username, x: data.x, y: data.y });
        }
      }
      socket.emit('active-users', { boardId, users });
    });

    socket.on('leave-board', ({ boardId }) => {
      if (isInBoard(boardId)) {
        leaveCurrentBoard();
      }
    });

    socket.on('cursor-move', ({ boardId, x, y }) => {
      if (!isInBoard(boardId)) return;
      const pos = cursorPositions.get(socket.id);
      pos.x = x;
      pos.y = y;
      socket.to(`board:${boardId}`).emit('cursor-update', {
        socketId: socket.id,
        username: pos.username,
        x, y,
        boardId
      });
    });

    socket.on('draw-element', ({ boardId, element, layerIndex }) => {
      if (!isInBoard(boardId)) return;
      socket.to(`board:${boardId}`).emit('element-added', { boardId, element, layerIndex });
    });

    socket.on('update-element', ({ boardId, elementId, updates, layerIndex }) => {
      if (!isInBoard(boardId)) return;
      socket.to(`board:${boardId}`).emit('element-updated', { boardId, elementId, updates, layerIndex });
    });

    socket.on('delete-element', ({ boardId, elementId, layerIndex }) => {
      if (!isInBoard(boardId)) return;
      socket.to(`board:${boardId}`).emit('element-deleted', { boardId, elementId, layerIndex });
    });

    socket.on('add-sticky-note', ({ boardId, note, layerIndex }) => {
      if (!isInBoard(boardId)) return;
      socket.to(`board:${boardId}`).emit('sticky-note-added', { boardId, note, layerIndex });
    });

    socket.on('add-shape', ({ boardId, shape, layerIndex }) => {
      if (!isInBoard(boardId)) return;
      socket.to(`board:${boardId}`).emit('shape-added', { boardId, shape, layerIndex });
    });

    socket.on('layer-update', ({ boardId, layers }) => {
      if (!isInBoard(boardId)) return;
      socket.to(`board:${boardId}`).emit('layers-updated', { boardId, layers });
    });

    socket.on('canvas-transform', ({ boardId, transform }) => {
      if (!isInBoard(boardId)) return;
      socket.to(`board:${boardId}`).emit('canvas-transformed', { boardId, transform });
    });

    socket.on('disconnect', () => {
      leaveCurrentBoard();
      console.log(`User disconnected: ${socket.id}`);
    });
  });
}

module.exports = { setupSocketHandlers };
